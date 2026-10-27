#!/usr/bin/env node
/**
 * Pixeltopia shared multiplayer server (NOT serverless).
 * One Node.js process: auth + gateway shards + named worlds + realtime sync.
 * Capacity: SHARD_COUNT × MAX_CONN_PER_SHARD (default 4×250 = 1000).
 */
'use strict';

const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { WebSocketServer } = require('ws');
const { createAuth } = require('./lib/auth');
const { createWorldManager, plantsReadyIn } = require('./lib/world_manager');
const rules = require('./lib/rules');
const { createWorldSync } = require('./lib/world_sync');
const { createStore } = require('./lib/store');
const invServer = require('./lib/inv_server');
const abuse = require('./lib/abuse');
const { createSocial } = require('./lib/social');

// Load server/.env (gitignored) without overriding real env vars from the host.
(function loadDotEnv() {
  if (process.env.NO_DOTENV === '1') return; // tests: never pick up server/.env (production credentials)
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
})();

// Hosts inject PORT (Back4app/Zeabur/HF/Render…). Deno Deploy has no PORT var, so default to 8000 there.
const PORT = Number(process.env.PORT || (process.env.DENO_DEPLOY ? 8000 : 8787));
const HEARTBEAT_MS = Math.max(5000, Number(process.env.HEARTBEAT_MS || 25000));
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'pixeltopia-local-dev-only-change-me';
const TICK_HZ = Math.max(1, Math.min(20, Number(process.env.TICK_HZ || 10)));
const INTEREST_RADIUS = Number(process.env.INTEREST_RADIUS || 24);
const MAX_CONN_PER_SHARD = Number(process.env.MAX_CONN_PER_SHARD || 250);
const SHARD_COUNT = Math.max(1, Number(process.env.SHARD_COUNT || 4));
const DATA_DIR = path.join(__dirname, 'data');
const COMPRESS_WS = process.env.COMPRESS_WS !== '0';
const MAX_CHAT_LEN = 160;
const SAVE_INTERVAL_MS = Math.max(5000, Number(process.env.SAVE_INTERVAL_MS || 30000));
const TOKEN_TTL_SEC = 60 * 60 * 24 * 14;
const USERNAME_MIN = 3;
const USERNAME_MAX = 10;
const USERNAME_LEN_ERROR = `Username ${USERNAME_MIN}–${USERNAME_MAX} karakter.`;
// Multi-instance sync (Deno Deploy runs several isolates in several regions at once).
const INSTANCE_ID = process.env.INSTANCE_ID || `${process.env.DENO_REGION || 'local'}-${crypto.randomBytes(4).toString('hex')}`;
const SYNC_POLL_MS = Math.max(50, Number(process.env.SYNC_POLL_MS || 150));
const DUP_LOGIN_SETTLE_MS = Math.max(0, Number(process.env.DUP_LOGIN_SETTLE_MS || 1500));
const MAINTENANCE_MS = 5 * 60 * 1000;
// Server-authoritative inventory (see lib/inv_server.js and README "Server inventory"). OFF unless
// SERVER_INV=1. With it on the server owns every inventory change online: wallets in Postgres for
// accounts, a session-only kit for guests; client inventory writes (inv_sync / profile inventory) are ignored.
const SERVER_INV = process.env.SERVER_INV === '1';
// Clients older than MIN_PROTO (v1.7.0/1.7.1 send proto=2, v1.7.2 sends 3, v1.8.0 sends 4) are refused with an "update" message (0 = allow all).
const CLIENT_PROTO = 4;
const MIN_PROTO = Math.max(0, Number(process.env.MIN_PROTO || 0) | 0);
const UPDATE_URL = process.env.UPDATE_URL || 'https://github.com/DitoBimaRamadhan/Pixeltopia/releases/latest';
const UPDATE_MSG = `Versi game kamu sudah lama. Update Pixeltopia ke versi terbaru di ${UPDATE_URL}`;
// v1.8 anti-abuse (lib/abuse.js). Client punches at most ~5.5/s (hold) and REACH = 3 tiles.
const PUNCH_RATE = 7, PUNCH_BURST = 10;
const PLACE_RATE = 8, PLACE_BURST = 12;
const SOCIAL_RATE = 4, SOCIAL_BURST = 10; // daily / leaderboard / friends / PM / world settings requests
const REACH_TILES = 3, REACH_SLACK = 2;
const RATE_NOTICE_MS = 3000;
const clientProto = (v) => { const n = Number(v); return Number.isFinite(n) ? n | 0 : 0; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const store = createStore({ dataDir: DATA_DIR });
const auth = createAuth({ jwtSecret: JWT_SECRET });
const worlds = createWorldManager();

const shards = [];
for (let i = 0; i < SHARD_COUNT; i++) {
  shards.push({
    id: `gateway-${i + 1}`,
    name: `Pixeltopia Gateway ${i + 1}`,
    shard: `G${i + 1}`,
    players: 0,
    maxPlayers: MAX_CONN_PER_SHARD,
    connections: new Set(),
  });
}

function pickShardLeastConnections() {
  let best = shards[0];
  for (const s of shards) if (s.connections.size < best.connections.size) best = s;
  return best;
}
function findShard(id) {
  return shards.find((s) => s.id === id) || pickShardLeastConnections();
}
function totalConnections() {
  return shards.reduce((n, s) => n + s.connections.size, 0);
}
// Public address as seen by clients. Behind an HTTPS proxy (Deno Deploy, Back4app,
// Cloudflare tunnel…) we must advertise the proxy host + 443/wss, not the internal port.
function publicEndpoint(req) {
  const h = (req && req.headers) || {};
  const first = (v) => String(v || '').split(',')[0].trim();
  const proto = first(process.env.PUBLIC_PROTO || h['x-forwarded-proto'] || (h['cf-visitor'] && /https/.test(h['cf-visitor']) ? 'https' : '')) || 'http';
  const rawHost = first(process.env.PUBLIC_HOST || h['x-forwarded-host'] || h.host) || '127.0.0.1';
  const m = rawHost.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
  const host = m ? m[1] : rawHost;
  const secure = proto === 'https' || proto === 'wss';
  const port = Number(process.env.PUBLIC_PORT || first(h['x-forwarded-port']) || (m && m[2]) || (secure ? 443 : (h.host ? 80 : PORT)));
  const defPort = secure ? 443 : 80;
  const authority = port === defPort ? host : `${host}:${port}`;
  return { host, port, secure, httpBase: `${secure ? 'https' : 'http'}://${authority}`, wsBase: `${secure ? 'wss' : 'ws'}://${authority}` };
}
function serverListPayload(req) {
  const pub = publicEndpoint(req);
  return shards.map((s) => ({
    id: s.id, name: s.name, shard: s.shard,
    host: pub.host, port: pub.port, secure: pub.secure,
    wsPath: `/ws?shard=${encodeURIComponent(s.id)}`,
    wsUrl: `${pub.wsBase}/ws?shard=${encodeURIComponent(s.id)}`,
    players: s.connections.size, maxPlayers: s.maxPlayers,
    load: s.connections.size / Math.max(1, s.maxPlayers),
    tickHz: TICK_HZ, interestRadius: INTEREST_RADIUS,
    mode: 'shared-process', capacityTotal: SHARD_COUNT * MAX_CONN_PER_SHARD,
  })).sort((a, b) => a.players - b.players);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => {
      chunks.push(c);
      if (Buffer.concat(chunks).length > 1e6) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function sendJson(res, code, obj) {
  if (obj && obj.error) res._logError = obj.error;
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    });
    return res.end();
  }
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'POST' && (url.pathname === '/register' || url.pathname === '/login')) {
    const t0 = Date.now();
    res.on('finish', () => {
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '-';
      console.log(`[auth] ${url.pathname.slice(1)} status=${res.statusCode} user=${JSON.stringify(res._logUser || '')} ms=${Date.now() - t0} ip=${ip} ua=${JSON.stringify(String(req.headers['user-agent'] || '').slice(0, 80))}` + (res._logError ? ` error=${JSON.stringify(res._logError)}` : ''));
    });
  }
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true, mode: 'shared-process', storage: store.kind, shards: shards.length,
        worlds: worlds.allWorlds().length, connections: totalConnections(), instance: INSTANCE_ID, sync: sync.stats,
        capacity: SHARD_COUNT * MAX_CONN_PER_SHARD, tickHz: TICK_HZ,
        public: publicEndpoint(req).httpBase, runtime: typeof Deno !== 'undefined' ? 'deno' : 'node',
      });
    }
    if (req.method === 'GET' && url.pathname === '/stats') {
      return sendJson(res, 200, {
        connections: totalConnections(), capacity: SHARD_COUNT * MAX_CONN_PER_SHARD,
        shards: serverListPayload(req), worlds: await listWorldsShared(), instance: INSTANCE_ID,
        memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        tickHz: TICK_HZ, mode: 'shared-process', storage: store.kind,
      });
    }
    if (req.method === 'GET' && url.pathname === '/servers') {
      return sendJson(res, 200, {
        servers: serverListPayload(req), balancer: 'least-connections',
        mode: 'shared-process', note: 'All gateways share one Node process and one world registry.',
      });
    }
    if (req.method === 'GET' && url.pathname === '/worlds') {
      return sendJson(res, 200, { worlds: await listWorldsShared() });
    }
    if (req.method === 'POST' && url.pathname === '/register') {
      const body = await readBody(req);
      if (clientProto(body.proto) < MIN_PROTO) return sendJson(res, 426, { error: UPDATE_MSG, update: true, url: UPDATE_URL });
      const username = String(body.username || '').trim();
      res._logUser = username.slice(0, 32);
      const password = String(body.password || '');
      if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) return sendJson(res, 400, { error: USERNAME_LEN_ERROR });
      if (!/^[a-zA-Z0-9_]+$/.test(username)) return sendJson(res, 400, { error: 'Username hanya huruf/angka/_.' });
      if (password.length < 4) return sendJson(res, 400, { error: 'Password minimal 4 karakter.' });
      if (await store.getUser(username)) return sendJson(res, 409, { error: 'Username sudah dipakai.' });
      const id = crypto.randomBytes(8).toString('hex');
      const created = await store.createUser({ id, username, passwordHash: auth.scryptHash(password), createdAt: Date.now() });
      if (created.error) return sendJson(res, 409, { error: 'Username sudah dipakai.' });
      const token = await issueToken(id, username);
      return sendJson(res, 201, { token, username, userId: id });
    }
    if (req.method === 'POST' && url.pathname === '/login') {
      const body = await readBody(req);
      if (clientProto(body.proto) < MIN_PROTO) return sendJson(res, 426, { error: UPDATE_MSG, update: true, url: UPDATE_URL });
      const username = String(body.username || '').trim();
      res._logUser = username.slice(0, 32);
      const password = String(body.password || '');
      if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) return sendJson(res, 400, { error: USERNAME_LEN_ERROR });
      const row = await store.getUser(username);
      if (!row || !auth.scryptVerify(password, row.passwordHash)) {
        return sendJson(res, 401, { error: 'Username atau password salah.' });
      }
      const token = await issueToken(row.id, row.username);
      return sendJson(res, 200, { token, username: row.username, userId: row.id });
    }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error('[http]', e);
    return sendJson(res, 500, { error: 'Server error' });
  }
});

async function issueToken(userId, username) {
  const token = auth.signToken({ sub: userId, username }, TOKEN_TTL_SEC);
  const p = auth.decode(token);
  try {
    await store.recordSession({ userId, jti: p.jti, expiresAt: p.exp * 1000 });
  } catch (e) { console.warn('[store] recordSession failed', e.message); }
  return token;
}

// ---------------------------------------------------------------- persistence & multi-instance sync
function sanitizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const k of ['inventory', 'progress', 'achievements', 'avatar', 'quests']) {
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  const size = Buffer.byteLength(JSON.stringify(out));
  if (size > 64 * 1024) return null;
  return out;
}
// Serialize profile writes per player: concurrent UPSERTs could land out of order and
// overwrite a newer profile with an older one. A running save picks up the latest pending one.
// Each profile carries `rev` = when the server received it; the DB rejects anything older than
// what it already has, so a late save from an old/kicked connection on another instance is harmless.
function saveProfile(player) {
  if (!player.authed) return Promise.resolve();
  if (player.savingProfile) return player.savingProfile;
  if (!player.pendingProfile) return Promise.resolve();
  player.savingProfile = (async () => {
    while (player.pendingProfile) {
      const data = player.pendingProfile;
      const rev = player.pendingRev || Date.now();
      player.pendingProfile = null;
      try {
        const ok = await store.saveProfile(player.id, data, rev);
        if (ok === false) console.warn(`[store] stale profile save for ${player.username} ignored`);
      } catch (e) {
        if (!player.pendingProfile) { player.pendingProfile = data; player.pendingRev = rev; }
        console.error(`[store] save profile ${player.username} failed:`, e.message);
        break;
      }
    }
  })().finally(() => { player.savingProfile = null; });
  return player.savingProfile;
}

/**
 * SERVER_INV: create the account's wallet once (concurrent logins on several instances race on
 * INSERT .. ON CONFLICT DO NOTHING, so exactly one seeds). Migrating accounts are seeded from their stored
 * profile inventory (sanitized/capped), brand-new ones from the starter kit. Sets player.srvInv.
 */
async function ensureWallet(player, profile) {
  if (!SERVER_INV || !player.authed) return null;
  const plan = invServer.seedForProfile(profile);
  try {
    const r = await store.invEnsure(player.id, plan.seed, plan.seededFrom);
    player.srvInv = r.state;
    if (r.created) {
      const total = Object.values(r.state.items).reduce((a, b) => a + b, 0);
      console.log(`[inv] seeded user=${player.id} from=${plan.seededFrom} kinds=${Object.keys(r.state.items).length} total=${total} gems=${r.state.gems}`);
      if (plan.issues.length) console.warn(`[inv] suspicious seed user=${player.id} ${plan.issues.slice(0, 12).join(' ')}`);
    }
    return r.state;
  } catch (e) {
    console.warn(`[inv] ensure wallet failed user=${player.id}: ${e.message}`);
    return null;
  }
}
// ---- SERVER_INV step 3: place costs, refunds, owner World Lock credit -----------------------------
const INV_NO_ITEM = 'Item tidak cukup';
const INV_NOT_READY = 'Inventori server belum siap, coba lagi.';
/** Keep the newest wallet state for this connection and push it to the client as {t:'inv'}. */
function setSrvInv(player, st) {
  if (!st || player.closed) return;
  if (player.srvInv && Number(st.ver) < Number(player.srvInv.ver)) return; // older answer arrived late
  player.srvInv = st;
  safeSend(player.ws, { t: 'inv', ver: st.ver, items: st.items, gems: st.gems });
}
/**
 * No-wallet rule (SERVER_INV): a logged-in session without a wallet in memory (e.g. the DB hiccuped at
 * login) first retries the normal one-time ensure — which just LOADS the wallet if it already exists, or
 * seeds it exactly like login would (stored profile, same caps; never from an unreadable profile).
 * If that still fails, the action is REFUSED (fail closed): nothing is placed and nothing is spent.
 */
async function ensureWalletOnDemand(player) {
  if (!SERVER_INV || !player.authed || player.srvInv) return player.srvInv || null;
  if (!player.invEnsuring) {
    player.invEnsuring = (async () => {
      let prof;
      try { prof = await store.getProfile(player.id); } catch (e) { console.warn(`[inv] on-demand profile read failed user=${player.id}: ${e.message}`); return null; }
      const st = await ensureWallet(player, prof);
      if (st) setSrvInv(player, st);
      return st;
    })().finally(() => { player.invEnsuring = null; });
  }
  return player.invEnsuring;
}
/** Idempotent server-side inventory change with a few retries (op_id makes retries safe). */
async function invOpWithRetry(opId, userId, ops, reason) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await store.invApply(opId, userId, ops, reason);
      if (r.ok) {
        if (!r.dup) console.log(`[inv] ${reason} user=${userId} op=${opId} ver=${r.ver}`);
        for (const p of localPlayersById(userId)) setSrvInv(p, { ver: r.ver, gems: r.gems, items: r.items });
      } else {
        console.warn(`[inv] ${reason} refused user=${userId} op=${opId} error=${r.error}`);
      }
      return r;
    } catch (e) {
      console.warn(`[inv] ${reason} attempt ${attempt + 1} failed user=${userId} op=${opId}: ${e.message}`);
      await sleep(250 * 2 ** attempt);
    }
  }
  console.error(`[inv] ${reason} GAVE UP user=${userId} op=${opId}`);
  return null;
}
/** Push a guest's session inventory to its client. */
function pushGuestInv(player) {
  if (!player.guestInv || player.closed) return;
  const s = invServer.guestState(player.guestInv);
  safeSend(player.ws, { t: 'inv', ver: s.ver, items: s.items, gems: s.gems, guest: true });
}
/** Apply ops to an account wallet or a guest kit; returns {ok, dup?, error?, state}. */
async function applyPlayerOps(player, opId, ops, reason) {
  if (!player.authed) {
    const r = invServer.guestApply(player.guestInv, opId, ops);
    pushGuestInv(player);
    return r;
  }
  const r = await store.invApply(opId, player.id, ops, reason);
  const st = r.ver === undefined ? null : { ver: r.ver, gems: r.gems, items: r.items };
  if (st) for (const p of localPlayersById(player.id)) setSrvInv(p, st);
  if (r.ok && !r.dup) console.log(`[inv] ${reason} user=${player.id} op=${opId} ver=${r.ver}`);
  return { ok: r.ok, dup: r.dup, error: r.error, state: st };
}
const social = createSocial({
  store, safeSend, localPlayers, localPlayersById, applyPlayerOps, setSrvInv,
  walletReady: async (p) => !!(SERVER_INV && (p.srvInv || await ensureWalletOnDemand(p))),
});
const REWARD_FRESH_MS = 60000; // replays of old events (world reload) must not show reward popups again
function sendReward(userId, e, ev) {
  if (!e.reward || Date.now() - (Number(ev.createdAt) || Date.now()) > REWARD_FRESH_MS) return;
  for (const p of localPlayersById(userId)) safeSend(p.ws, { t: 'reward', ...e.reward, world: ev.world || p.worldName });
}
/**
 * Every punch/place/fertilize applied from the log (all instances): run its inventory effects (refunds,
 * WL credit, break/harvest drops). Account effects go to the DB (idempotent op ids, so N instances = once);
 * guest effects only on the instance holding that guest's session kit.
 */
function onInvEventApplied(world, ev, r, { prevLockOwnerId }) {
  if (!SERVER_INV) return;
  for (const e of invServer.invEffectsForEvent(world.name, ev, r, prevLockOwnerId)) {
    if (e.guest) {
      for (const p of localPlayersById(e.userId)) {
        if (p.authed || !p.guestInv) continue;
        const g = invServer.guestApply(p.guestInv, e.opId, e.ops);
        if (g.ok && !g.dup) { pushGuestInv(p); sendReward(e.userId, e, ev); }
      }
      continue;
    }
    invOpWithRetry(e.opId, e.userId, e.ops, e.reason).then((res) => { if (res && res.ok) sendReward(e.userId, e, ev); });
  }
}

/** Echo a confirmed-looking place/fertilize to the world (the log may still correct it later). */
function broadcastEdit(world, player, r, fert) {
  if (fert) {
    broadcastWorld(world, { t: 'plant', x: r.x, y: r.y, readyIn: Math.round(r.readyAt - Date.now()), boosted: true, by: player.id });
    return;
  }
  const tile = {
    t: 'tile', x: r.x, y: r.y, id: r.id, by: player.id, action: 'place',
    lockOwnerId: world.lockOwnerId, lockOwnerName: world.lockOwnerName,
  };
  if (r.readyAt) tile.readyIn = Math.round(r.readyAt - Date.now());
  broadcastWorld(world, tile);
}

/**
 * Step 5: shop / craft / splice / quest claims, validated and applied atomically on the server.
 * Reply: {t:'inv_result', op, req, ok, error?, result?} (+ the new {t:'inv'} state).
 * op_ids are server-generated (<reason>:<userId>:<random>), so a replayed client message cannot collide.
 */
async function handleInvRequest(player, t, msg) {
  const reply = (o) => safeSend(player.ws, { t: 'inv_result', op: t, req: msg.req ?? null, ...o });
  if (!SERVER_INV) return reply({ ok: false, error: 'Inventori server belum aktif.' });
  if (t === 'quest_state') {
    if (!player.authed) return safeSend(player.ws, { t: 'quest_state', progress: {}, claimed: [], guest: true });
    const progress = {};
    for (const q of rules.QUESTS) progress[q.id] = await store.invProgress(player.id, invServer.QUEST_PROGRESS_REASON[q.type]);
    return safeSend(player.ws, { t: 'quest_state', progress, claimed: await store.questClaimed(player.id) });
  }
  if (player.authed && !(player.srvInv || await ensureWalletOnDemand(player))) return reply({ ok: false, error: INV_NOT_READY });
  const nonce = crypto.randomBytes(6).toString('hex');
  if (t === 'quest_claim') {
    if (!player.authed) return reply({ ok: false, error: 'Login dulu untuk klaim hadiah quest.' });
    const plan = invServer.questClaimOps(msg.qid);
    if (plan.error) return reply({ ok: false, error: plan.error });
    const r = await store.questClaim(player.id, plan.quest.id, { countReason: plan.countReason, goal: plan.goal, opId: `quest:${player.id}:${plan.quest.id}`, ops: plan.ops });
    if (r.state) for (const p of localPlayersById(player.id)) setSrvInv(p, r.state);
    if (r.ok) console.log(`[inv] quest user=${player.id} qid=${plan.quest.id}`);
    return reply({ ok: r.ok, qid: plan.quest.id, progress: r.progress, error: r.ok ? undefined : invServer.invErrorText(r.error), code: r.error,
      result: r.ok ? { gems: plan.ops.gems || 0, items: plan.ops.items } : undefined });
  }
  const plan = t === 'craft' ? invServer.craftOps(msg.recipe ?? msg.id)
    : t === 'splice' ? invServer.spliceOps(msg.a, msg.b)
      : t === 'shop_buy' ? invServer.buyOps(msg.id, msg.n ?? 1)
        : invServer.sellOps(msg.id, msg.n ?? 1);
  if (plan.error) return reply({ ok: false, error: plan.error });
  const r = await applyPlayerOps(player, `${plan.reason}:${player.id}:${nonce}`, plan.ops, plan.reason);
  return reply({ ok: r.ok, error: r.ok ? undefined : invServer.invErrorText(r.error), code: r.error, result: r.ok ? plan.result : undefined });
}

const wss = new WebSocketServer({
  server, path: '/ws',
  perMessageDeflate: COMPRESS_WS ? {
    zlibDeflateOptions: { chunkSize: 1024, memLevel: 7, level: 3 }, threshold: 128,
  } : false,
});

function safeSend(ws, obj) {
  if (!ws || ws.readyState !== 1) return;
  try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
}
/** Drop a rate-limited action; tell the player at most every RATE_NOTICE_MS and log the count. */
function rateLimited(player, kind) {
  player.rateDrops++;
  const now = Date.now();
  if (now - player.rateNoticeAt < RATE_NOTICE_MS) return;
  player.rateNoticeAt = now;
  console.warn(`[rate] ${kind} limited user=${player.id} drops=${player.rateDrops}`);
  safeSend(player.ws, { t: 'error', error: 'Pelan-pelan! Terlalu cepat.', rate: kind });
}

function broadcastWorld(world, obj, exceptId) {
  if (!world) return;
  for (const p of world.players.values()) {
    if (exceptId && p.id === exceptId) continue;
    safeSend(p.ws, obj);
  }
}
function localPlayers() {
  const out = [];
  for (const s of shards) for (const ws of s.connections) if (ws._player) out.push(ws._player);
  return out;
}
function localPlayersById(id) { return localPlayers().filter((p) => p.id === id && !p.kicked); }
function findPlayerById(id) { return localPlayersById(id)[0] || null; }

function canFulfill(player, offer) {
  if ((player.inv.gems | 0) < (offer.gems | 0)) return false;
  for (const it of offer.items || []) if ((player.inv.items[it.id] | 0) < (it.n | 0)) return false;
  return true;
}
function walletCanFulfill(st, offer) {
  if ((Number(st.gems) || 0) < (offer.gems | 0)) return false;
  const need = invServer.offerItems(offer);
  for (const [id, n] of Object.entries(need)) if ((Number(st.items[id]) || 0) < n) return false;
  return true;
}
function applyOffer(player, offer, sign) {
  player.inv.gems = Math.max(0, (player.inv.gems | 0) + sign * (offer.gems | 0));
  for (const it of offer.items || []) {
    const next = (player.inv.items[it.id] | 0) + sign * (it.n | 0);
    if (next <= 0) delete player.inv.items[it.id];
    else player.inv.items[it.id] = next;
  }
}
function deliverTradePayload(p, payload) {
  if (payload && payload.t === 'trade' && payload.event === 'completed' && payload.serverInv) {
    // Settled in the DB (trade_settle): just refresh this player's wallet from there.
    if (p.authed) store.invGet(p.id).then((st) => setSrvInv(p, st)).catch((e) => console.warn('[trade] wallet refresh failed', e.message));
  } else if (payload && payload.t === 'trade' && payload.event === 'completed') {
    // Keep the server's view of this player's inventory in step with the client (as before).
    applyOffer(p, (payload.take || {})[p.id] || { items: [], gems: 0 }, -1);
    applyOffer(p, (payload.give || {})[p.id] || { items: [], gems: 0 }, +1);
  }
  safeSend(p.ws, payload);
}
/** Deliver to a player on this instance (used for messages relayed through the world log). */
function deliverToPlayer(id, obj) {
  for (const p of localPlayersById(id)) {
    if (obj && obj.t === 'trade') deliverTradePayload(p, obj);
    else safeSend(p.ws, obj);
  }
}

const sync = createWorldSync({
  store, worlds, instanceId: INSTANCE_ID, broadcastWorld, deliverToPlayer, localPlayers,
  kickPlayer: (p) => kickPlayer(p), pollMs: SYNC_POLL_MS,
  onEventApplied: (world, ev, r, ctx) => onInvEventApplied(world, ev, r, ctx),
});

// World list (all instances): DB summary with live player counts from presence, cached briefly.
let worldListCache = { at: 0, list: null, p: null };
function withLocalCounts(list) {
  // Our own players (and the remote ones we already see) count immediately, even if the cached
  // presence summary is a moment old.
  return list.map((w) => {
    const local = worlds.getWorld(w.name);
    if (!local || !local.players.size) return w;
    return { ...w, players: Math.max(w.players, local.players.size + (local.remote ? local.remote.size : 0)) };
  });
}
async function listWorldsShared(maxAgeMs = 2000) {
  if (worldListCache.list && Date.now() - worldListCache.at < maxAgeMs) return withLocalCounts(worldListCache.list);
  if (!worldListCache.p) {
    worldListCache.p = store.listWorldSummaries({ presenceMaxAgeMs: 5000 })
      .then((list) => { worldListCache = { at: Date.now(), list, p: null }; return list; })
      .catch((e) => { console.warn('[store] listWorldSummaries failed', e.message); worldListCache.p = null; return worlds.listWorlds(); });
  }
  return withLocalCounts(await worldListCache.p);
}

function worldSnapshot(world) {
  const players = [...world.players.values()].map((p) => ({ i: p.id, u: p.username, x: p.x, y: p.y }));
  for (const r of sync.remotePlayers(world)) players.push({ i: r.i, u: r.u, x: r.x, y: r.y });
  return {
    t: 'world_state', name: world.name, w: worlds.W, h: worlds.H, seed: world.seed,
    grid: worlds.gridArray(world), spawn: world.spawn,
    lockOwnerId: world.lockOwnerId, lockOwnerName: world.lockOwnerName,
    plants: plantsReadyIn(world), // tile index -> ms until ready (<= 0: ready to harvest)
    settings: world.settings || {},
    players,
  };
}
function leaveCurrentWorld(player, { cancelTrade = false } = {}) {
  if (!player.worldName) return;
  const w = worlds.getWorld(player.worldName);
  if (w) {
    const wasMember = w.players.get(player.id) === player;
    worlds.leave(w, player);
    if (wasMember) broadcastWorld(w, { t: 'player_left', id: player.id, username: player.username });
    w.lastActive = Date.now();
    sync.markPresenceDirty(w);
  }
  player.worldName = null;
  if (cancelTrade) cancelTradeFor(player).catch((e) => console.warn('[trade] cancel on leave failed', e.message));
}
async function joinNamedWorld(player, rawName, createIfMissing) {
  const name = worlds.normalizeWorldName(rawName) || 'START';
  const res = await sync.ensureWorld(name, { create: createIfMissing, creatorId: player.id });
  if (res.error) return res;
  if (player.closed || player.kicked) return { error: 'closed' };
  const w = res.world;
  leaveCurrentWorld(player, { cancelTrade: player.worldName && player.worldName !== w.name });
  worlds.join(w, player);
  w.lastActive = Date.now();
  sync.markPresenceDirty(w);
  safeSend(player.ws, worldSnapshot(w));
  broadcastWorld(w, { t: 'player_join', player: { i: player.id, u: player.username, x: player.x, y: player.y } }, player.id);
  if (res.created) worldListCache.at = 0;
  return { world: w, created: res.created };
}
async function broadcastAllGateways(obj) {
  for (const s of shards) for (const ws of s.connections) safeSend(ws, obj);
}

/** Newest connection of an account wins; older ones (here or on another instance) are closed. */
function kickPlayer(p) {
  if (p.kicked) return p.savingProfile || Promise.resolve();
  p.kicked = true;
  safeSend(p.ws, { t: 'kicked', reason: 'duplicate_login', error: 'Akun ini login dari perangkat/sesi lain.' });
  const saving = saveProfile(p);
  setTimeout(() => { try { p.ws.close(4001, 'duplicate login'); } catch { /* ignore */ } }, 100);
  console.log(`[session] kicked older connection of ${p.username}`);
  return saving;
}

// ---------------------------------------------------------------- trades (shared via DB)
const TRADE_CONFLICT = 'Trade berubah, coba lagi.';
const emptyOffer = () => ({ items: [], gems: 0 });
function tradePublic(t) {
  if (!t) return null;
  return { id: t.id, a: t.a, b: t.b, aName: t.aName, bName: t.bName, status: t.status, offers: t.offers, ready: t.ready, worldName: t.worldName };
}
/** Send to both parties: directly if connected here, otherwise through the trade world's log. */
function notifyTradeParties(t, payloadFor) {
  for (const id of [t.a, t.b]) {
    const payload = typeof payloadFor === 'function' ? payloadFor(id) : payloadFor;
    if (!payload) continue;
    const locals = localPlayersById(id);
    if (locals.length) for (const p of locals) deliverTradePayload(p, payload);
    else if (t.worldName) sync.publishToPlayer(t.worldName, id, payload);
  }
}
async function cancelTradeFor(player) {
  for (let i = 0; i < 4; i++) {
    const t = await store.tradeActiveFor(player.id);
    if (!t) return null;
    const u = await store.tradeUpdate(t.id, t.version, { status: 'cancelled' });
    if (!u) continue;
    notifyTradeParties(u, { t: 'trade', event: 'cancelled', trade: tradePublic(u) });
    return u;
  }
  return null;
}
async function handleTrade(player, ws, world, t, msg) {
  const err = (error) => safeSend(ws, { t: 'error', error });
  if (!player.authed) return err('Login dulu untuk trade (tamu tidak bisa trade).');
  if (t === 'trade_request') {
    if (!world) return err('Join dunia dulu.');
    const toId = String(msg.to || '');
    const target = world.players.get(toId) || (world.remote && world.remote.get(toId));
    if (!target) return err('Pemain tidak di dunia ini.');
    if (!toId || toId === player.id) return err('Target trade tidak valid.');
    const localTarget = world.players.get(toId);
    const targetAuthed = localTarget ? localTarget.authed : !!(await store.getUserById(toId));
    if (!targetAuthed) return err('Pemain itu tamu — tamu tidak bisa trade.');
    const mine = await store.tradeActiveFor(player.id);
    if (mine && mine.status === 'open') return err('Kamu sudah dalam trade.');
    const created = await store.tradeCreate({
      id: crypto.randomBytes(6).toString('hex'), a: player.id, b: toId, aName: player.username, bName: null,
      worldName: world.name, offers: { [player.id]: emptyOffer(), [toId]: emptyOffer() }, ready: { [player.id]: false, [toId]: false },
    });
    if (!created) return err('Trade sudah berjalan.');
    const pub = tradePublic(created);
    notifyTradeParties(created, (id) => ({ t: 'trade', event: id === player.id ? 'requested' : 'incoming', trade: pub }));
    return;
  }
  if (t === 'trade_cancel') {
    const u = await cancelTradeFor(player);
    if (!u) return err('Tidak ada trade.');
    return;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    if (t === 'trade_accept') {
      let s = msg.id ? await store.tradeGet(msg.id) : null;
      if (!s || (s.status !== 'pending' && s.status !== 'open')) s = await store.tradeActiveFor(player.id);
      if (!s) return err('Trade tidak ditemukan.');
      if (s.b !== player.id && s.a !== player.id) return err('Bukan trade kamu.');
      if (s.status === 'pending' && player.id === s.b) {
        const u = await store.tradeUpdate(s.id, s.version, { status: 'open', bName: player.username });
        if (!u) continue;
        s = u;
      }
      notifyTradeParties(s, { t: 'trade', event: 'open', trade: tradePublic(s) });
      return;
    }
    const s = await store.tradeActiveFor(player.id);
    if (!s || s.status !== 'open') return err('Tidak ada trade terbuka.');
    if (t === 'trade_offer') {
      const clean = [];
      if (Array.isArray(msg.items)) {
        for (const it of msg.items.slice(0, 8)) {
          const id = it.id | 0; const n = Math.max(1, Math.min(999, it.n | 0));
          if (id >= 0) clean.push({ id, n });
        }
      }
      const offers = { ...s.offers, [player.id]: { items: clean, gems: Math.max(0, msg.gems | 0) } };
      const u = await store.tradeUpdate(s.id, s.version, { offers, ready: { [s.a]: false, [s.b]: false } });
      if (!u) continue;
      notifyTradeParties(u, { t: 'trade', event: 'offer', trade: tradePublic(u) });
      return;
    }
    if (t === 'trade_ready') {
      const isReady = msg.ready !== false;
      let fulfil = true;
      if (isReady && SERVER_INV) {
        const st = player.srvInv || await ensureWalletOnDemand(player);
        fulfil = !!st && walletCanFulfill(st, s.offers[player.id] || emptyOffer());
      } else if (isReady) fulfil = canFulfill(player, s.offers[player.id] || emptyOffer());
      if (isReady && !fulfil) {
        const u = await store.tradeUpdate(s.id, s.version, { ready: { [s.a]: false, [s.b]: false } });
        if (!u) continue;
        notifyTradeParties(u, { t: 'trade', event: 'failed', error: 'Inventori tidak cukup.', trade: tradePublic(u) });
        return;
      }
      const u = await store.tradeUpdate(s.id, s.version, { ready: { ...s.ready, [player.id]: isReady } });
      if (!u) continue;
      notifyTradeParties(u, { t: 'trade', event: 'ready', trade: tradePublic(u) });
      if (u.ready[u.a] && u.ready[u.b] && SERVER_INV) {
        // Both wallets + status in ONE transaction (trade_settle): all or nothing, exactly once.
        const offerA = u.offers[u.a] || emptyOffer();
        const offerB = u.offers[u.b] || emptyOffer();
        const ops = invServer.tradeOps(offerA, offerB);
        const res = await store.tradeSettle(u.id, u.version, ops.a, ops.b);
        if (!res.ok) {
          if (res.error === 'conflict') return;
          console.warn(`[trade] settle refused trade=${u.id} side=${res.side || '-'} error=${res.error}`);
          const f = await store.tradeUpdate(u.id, u.version, { ready: { [u.a]: false, [u.b]: false } });
          if (f) notifyTradeParties(f, { t: 'trade', event: 'failed', error: 'Inventori tidak cukup.', trade: tradePublic(f) });
          return;
        }
        const done = res.trade;
        console.log(`[inv] trade settled trade=${done.id} a=${done.a} b=${done.b}`);
        if (res.invA) for (const p of localPlayersById(done.a)) setSrvInv(p, res.invA);
        if (res.invB) for (const p of localPlayersById(done.b)) setSrvInv(p, res.invB);
        store.logTrade({ a: done.a, b: done.b, world: done.worldName, offerA, offerB })
          .catch((e) => console.warn('[store] logTrade failed', e.message));
        notifyTradeParties(done, {
          t: 'trade', event: 'completed', serverInv: true, trade: tradePublic(done),
          give: { [done.a]: offerB, [done.b]: offerA }, take: { [done.a]: offerA, [done.b]: offerB },
        });
        return;
      }
      if (u.ready[u.a] && u.ready[u.b]) {
        // Exactly one caller can flip open → done, so items are handed over once.
        const done = await store.tradeComplete(u.id, u.version);
        if (!done) return;
        const offerA = done.offers[done.a] || emptyOffer();
        const offerB = done.offers[done.b] || emptyOffer();
        store.logTrade({ a: done.a, b: done.b, world: done.worldName, offerA, offerB })
          .catch((e) => console.warn('[store] logTrade failed', e.message));
        notifyTradeParties(done, {
          t: 'trade', event: 'completed', trade: tradePublic(done),
          give: { [done.a]: offerB, [done.b]: offerA }, take: { [done.a]: offerA, [done.b]: offerB },
        });
      }
      return;
    }
    return;
  }
  return err(TRADE_CONFLICT);
}

// Server-side heartbeat: keeps proxies (Cloudflare ~100s idle, Deno Deploy idle shutdown)
// from dropping quiet sockets, and reaps dead clients.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws._alive === false) { try { ws.terminate(); } catch { /* ignore */ } continue; }
    ws._alive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(heartbeat));

wss.on('connection', (ws, req) => {
  ws._alive = true;
  ws.on('pong', () => { ws._alive = true; });
  ws.on('message', () => { ws._alive = true; });
  const url = new URL(req.url || '/ws', `http://${req.headers.host || 'localhost'}`);
  const token = url.searchParams.get('token') || '';
  const authPayload = auth.verifyToken(token);
  const shard = findShard(url.searchParams.get('shard') || '');
  if (shard.connections.size >= shard.maxPlayers) { ws.close(1013, 'shard full'); return; }
  if (totalConnections() >= SHARD_COUNT * MAX_CONN_PER_SHARD) { ws.close(1013, 'server full'); return; }

  if (clientProto(url.searchParams.get('proto')) < MIN_PROTO) {
    // Old APK: v1.6 shows `kicked` errors in its status line; v1.7+ also understands update_required.
    safeSend(ws, { t: 'update_required', error: UPDATE_MSG, url: UPDATE_URL, minProto: MIN_PROTO });
    safeSend(ws, { t: 'kicked', reason: 'update_required', error: UPDATE_MSG });
    setTimeout(() => { try { ws.close(4002, 'update required'); } catch { /* ignore */ } }, 200);
    return;
  }
  const player = {
    id: authPayload?.sub || crypto.randomBytes(4).toString('hex'),
    username: authPayload?.username || `guest-${Math.floor(Math.random() * 9999)}`,
    x: 32, y: 10, ws, shard, lastSeq: 0, worldName: null,
    inv: { items: {}, gems: 0 }, authed: !!authPayload?.sub, pendingProfile: null, pendingRev: 0,
    connId: crypto.randomBytes(6).toString('hex'), kicked: false, closed: false,
  };
  // Guests (SERVER_INV): session-only kit, starter minus the World Lock; reset on every connect, never saved.
  if (SERVER_INV && !player.authed) player.guestInv = invServer.createGuestWallet();
  player.opCounter = 0;
  player.punchBucket = abuse.createBucket(PUNCH_RATE, PUNCH_BURST);
  player.placeBucket = abuse.createBucket(PLACE_RATE, PLACE_BURST);
  player.socialBucket = abuse.createBucket(SOCIAL_RATE, SOCIAL_BURST);
  player.hits = abuse.createHitTracker(rules.HIT_RESET_SEC * 1000);
  player.chatGuard = abuse.createChatGuard({ perSec: 0.8, burst: 5 });
  player.rateNoticeAt = 0;
  player.rateDrops = 0;
  ws._player = player;
  shard.connections.add(ws);
  shard.players = shard.connections.size;

  const sendWelcome = async (profile) => safeSend(ws, {
    t: 'welcome', mode: 'shared-process', shard: shard.id, storage: store.kind,
    you: { id: player.id, username: player.username, x: player.x, y: player.y, guest: !player.authed },
    tickHz: TICK_HZ, capacity: SHARD_COUNT * MAX_CONN_PER_SHARD, worlds: await listWorldsShared(),
    profile: profile || null,
  });
  // Everything this connection sends is handled strictly in order, after the welcome.
  player.chain = (async () => {
    if (!player.authed) { await sendWelcome(null); pushGuestInv(player); return; }
    // Kick older connections of this account (same instance now; other instances on their next check),
    // and let them flush their profile before we read it.
    const waits = localPlayers().filter((o) => o !== player && o.id === player.id).map((o) => kickPlayer(o));
    let claim = null;
    try { claim = await store.claimSession(player.id, player.connId, INSTANCE_ID); } catch (e) { console.warn('[store] claimSession failed', e.message); }
    if (claim && claim.prevConnId && claim.prevInstanceId !== INSTANCE_ID) await sleep(DUP_LOGIN_SETTLE_MS);
    await Promise.allSettled(waits);
    let prof = null;
    let profOk = false;
    try { prof = await store.getProfile(player.id); profOk = true; } catch (e) { console.warn('[store] getProfile failed', e.message); }
    // Seed only from a profile we could actually read: a failed read must not seed an old account as 'starter'.
    if (SERVER_INV && profOk && !player.closed && !player.kicked) await ensureWallet(player, prof);
    await sendWelcome(prof);
    if (player.srvInv) {
      const s = player.srvInv;
      safeSend(ws, { t: 'inv', ver: s.ver, items: s.items, gems: s.gems });
    }
  })().catch((e) => console.error('[ws] welcome failed', e.message));

  ws.on('message', (raw) => {
    player.chain = player.chain.then(() => handleMessage(raw)).catch((e) => {
      console.error('[ws] handler error', e && e.message);
      safeSend(ws, { t: 'error', error: 'Server sibuk, coba lagi.' });
    });
  });

  async function handleMessage(raw) {
    if (player.closed || player.kicked) return;
    let msg; try { msg = JSON.parse(String(raw)); } catch { return; }
    const t = msg.t;
    if (t === 'ping') { safeSend(ws, { t: 'pong', ts: Date.now() }); return; }
    if (t === 'inv_sync') {
      const items = {};
      if (msg.items && typeof msg.items === 'object') {
        for (const [k, v] of Object.entries(msg.items)) {
          const id = Number(k) | 0; const n = Math.max(0, Math.min(9999, Number(v) | 0));
          if (id >= 0 && n > 0) items[id] = n;
        }
      }
      if (SERVER_INV) return; // server owns the inventory: client-reported totals are ignored
      player.inv = { items, gems: Math.max(0, msg.gems | 0) };
      return;
    }
    if (t === 'profile_save') {
      if (!player.authed) return;
      const prof = sanitizeProfile(msg.profile);
      if (!prof) return safeSend(ws, { t: 'error', error: 'Profil terlalu besar / tidak valid.' });
      // SERVER_INV: the stored profile inventory is only the client's slot layout, never trusted (the wallet
      // is authoritative and is seeded once). Before the wallet exists the save is skipped so a client
      // write can never become the seed of a migrating account.
      if (SERVER_INV && !player.srvInv) { console.warn(`[inv] profile_save before wallet ignored user=${player.id}`); return; }
      player.pendingProfile = prof;
      player.pendingRev = Math.max(Date.now(), (player.pendingRev || 0) + 1);
      if (msg.now) saveProfile(player);
      return;
    }
    if (t === 'list_worlds') { safeSend(ws, { t: 'worlds', worlds: await listWorldsShared() }); return; }
    if (t === 'create_world') {
      const name = worlds.normalizeWorldName(msg.name);
      if (!name) return safeSend(ws, { t: 'error', error: 'Nama dunia tidak valid.' });
      const joined = await joinNamedWorld(player, name, true);
      if (joined.error) return joined.error === 'closed' ? undefined : safeSend(ws, { t: 'error', error: joined.error });
      worldListCache.at = 0;
      broadcastAllGateways({ t: 'worlds', worlds: await listWorldsShared() });
      return;
    }
    if (t === 'join_world' || t === 'travel') {
      const joined = await joinNamedWorld(player, msg.name || 'START', !!msg.create);
      if (joined.error) return joined.error === 'closed' ? undefined : safeSend(ws, { t: 'error', error: joined.error });
      return;
    }
    if (t === 'leave_world') { leaveCurrentWorld(player, { cancelTrade: true }); safeSend(ws, { t: 'left_world' }); return; }
    if (t === 'move') {
      let tx = typeof msg.tx === 'number' ? msg.tx : msg.x;
      let ty = typeof msg.ty === 'number' ? msg.ty : msg.y;
      if (typeof tx === 'number' && typeof ty === 'number') {
        if (tx > worlds.W || ty > worlds.H) { tx = (tx / 32) | 0; ty = (ty / 32) | 0; }
        player.x = Math.max(0, Math.min(worlds.W - 1, tx | 0));
        player.y = Math.max(0, Math.min(worlds.H - 1, ty | 0));
      }
      if (typeof msg.px === 'number') player.px = msg.px;
      if (typeof msg.py === 'number') player.py = msg.py;
      player.lastSeq = msg.seq | 0;
      return;
    }
    const world = player.worldName ? worlds.getWorld(player.worldName) : null;
    if (t === 'punch') {
      if (!world) return safeSend(ws, { t: 'error', error: 'Join dunia dulu.' });
      if (!player.punchBucket.take()) return rateLimited(player, 'punch');
      const x = Number(msg.x), y = Number(msg.y);
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= worlds.W || y >= worlds.H) return;
      if (!abuse.inReach(player.x, player.y, x, y, REACH_TILES, REACH_SLACK)) return safeSend(ws, { t: 'error', error: 'Terlalu jauh.' });
      const cur = world.grid[y * worlds.W + x] | 0;
      if (cur === rules.TILE.AIR) return;
      // Multi-hit breaking: only the last hit becomes a world event. Locked tiles skip straight to the
      // reducer so the player gets the usual "locked" error on the first hit.
      if (worlds.canEdit(world, player)) {
        const h = player.hits.hit(world.name, x, y, cur, rules.hitsToBreak(cur));
        if (!h.done) { broadcastWorld(world, { t: 'hit', x, y, id: cur, hits: h.hits, need: h.need, by: player.id }); return; }
      }
      const ev = { kind: 'punch', actorId: player.id, actorName: player.username, x: msg.x, y: msg.y };
      if (SERVER_INV) { if (player.authed) ev.invCredit = true; else ev.guest = true; }
      const r = sync.submit(world, ev);
      if (r.error) return safeSend(ws, { t: 'error', error: r.error });
      if (r.noop) return;
      const tile = {
        t: 'tile', x: r.x, y: r.y, id: r.id, by: player.id, action: 'punch', broke: r.broke,
        lockOwnerId: world.lockOwnerId, lockOwnerName: world.lockOwnerName,
      };
      if (r.harvest !== undefined) tile.harvest = r.harvest;
      broadcastWorld(world, tile);
      return;
    }
    if (t === 'place' || t === 'fertilize') {
      if (!world) return safeSend(ws, { t: 'error', error: 'Join dunia dulu.' });
      const fert = t === 'fertilize';
      if (!player.placeBucket.take()) return rateLimited(player, t);
      if (!abuse.inReach(player.x, player.y, Number(msg.x), Number(msg.y), REACH_TILES, REACH_SLACK)) return safeSend(ws, { t: 'error', error: 'Terlalu jauh.' });
      if (fert && !SERVER_INV) return safeSend(ws, { t: 'error', error: 'Pupuk online belum aktif.' });
      const id = fert ? rules.TILE.FERTILIZER : msg.id | 0;
      const ev = fert
        ? { kind: 'fertilize', actorId: player.id, actorName: player.username, x: msg.x, y: msg.y }
        : { kind: 'place', actorId: player.id, actorName: player.username, x: msg.x, y: msg.y, id };
      let opts = {};
      if (SERVER_INV) {
        if (!fert) ev.strict = true; // placeable ids only, seeds only on soil (guests too)
        const reason = fert ? 'fertilize' : rules.isSeed(id) ? 'plant' : 'place';
        if (player.authed) {
          const st = player.srvInv || await ensureWalletOnDemand(player);
          if (!st) return safeSend(ws, { t: 'error', error: INV_NOT_READY });
          if (!((Number(st.items[id]) || 0) >= 1)) { setSrvInv(player, st); return safeSend(ws, { t: 'error', error: INV_NO_ITEM }); }
          opts = {
            inv: { userId: player.id, ops: { items: { [id]: -1 } }, reason },
            onInv: (s2) => setSrvInv(player, s2),
            failMessage: (e) => (String(e).startsWith('insufficient_item') ? INV_NO_ITEM : e === 'no_wallet' ? INV_NOT_READY : null),
          };
        } else {
          // Guest: pay from the session kit now; refunded in memory if the log rejects it or the append fails.
          if (id === rules.TILE.WORLD_LOCK) return safeSend(ws, { t: 'error', error: 'Login dulu untuk memakai World Lock.' });
          const g = player.guestInv;
          if (!((Number(g.items[id]) || 0) >= 1)) { pushGuestInv(player); return safeSend(ws, { t: 'error', error: INV_NO_ITEM }); }
          ev.guest = true;
          const payId = `g${reason}:${player.id}:${++player.opCounter}`;
          const paid = invServer.guestApply(g, payId, { items: { [id]: -1 } });
          if (!paid.ok) { pushGuestInv(player); return safeSend(ws, { t: 'error', error: INV_NO_ITEM }); }
          const refund = () => { invServer.guestApply(g, `refund:${payId}`, { items: { [id]: 1 } }); pushGuestInv(player); };
          // invOp marks the event as paid: a log rejection is refunded via invEffectsForEvent (guest:true).
          opts = { invOp: `g${reason}:${player.id}`, onFail: refund };
          const r = sync.submit(world, ev, opts);
          if (r.error) { refund(); return safeSend(ws, { t: 'error', error: r.error }); }
          pushGuestInv(player);
          return broadcastEdit(world, player, r, fert);
        }
      }
      const r = sync.submit(world, ev, opts);
      if (r.error) return safeSend(ws, { t: 'error', error: r.error });
      return broadcastEdit(world, player, r, fert);
    }
    if (t === 'craft' || t === 'splice' || t === 'shop_buy' || t === 'shop_sell' || t === 'quest_claim' || t === 'quest_state') {
      await handleInvRequest(player, t, msg);
      return;
    }
    if (social.TYPES.has(t)) { await social.handle(player, t, msg); return; }
    if (t === 'world_settings_set') {
      if (!world) return safeSend(ws, { t: 'error', error: 'Join dunia dulu.' });
      if (!player.authed) return safeSend(ws, { t: 'error', error: 'Login dulu.' });
      if (!player.socialBucket.take()) return rateLimited(player, t);
      const want = msg.settings && typeof msg.settings === 'object' ? { ...msg.settings } : {};
      if (want.welcome) want.welcome = abuse.filterChat(String(want.welcome).slice(0, 80)).text;
      const r = sync.submit(world, { kind: 'settings', actorId: player.id, actorName: player.username, settings: want });
      if (r.error) return safeSend(ws, { t: 'error', error: r.error });
      broadcastWorld(world, { t: 'world_settings', settings: r.settings, by: player.username });
      return;
    }
    if (t === 'chat') {
      if (!world) return safeSend(ws, { t: 'error', error: 'Join dunia dulu.' });
      let text = String(msg.text || '').replace(/[\r\n\t]/g, ' ').trim();
      if (!text) return;
      if (text.length > MAX_CHAT_LEN) text = text.slice(0, MAX_CHAT_LEN);
      const sys = (txt) => safeSend(ws, { t: 'chat', from: 'SYSTEM', id: 'system', text: txt, world: world.name, ts: Date.now() });
      const g = player.chatGuard.check(text);
      if (!g.ok) {
        if (g.reason === 'muted') return sys(`Kamu di-mute ${Math.ceil(g.retryMs / 1000)} detik karena spam.`);
        return sys(g.reason === 'repeat' ? 'Jangan kirim pesan yang sama berulang-ulang.' : 'Terlalu cepat. Tunggu sebentar sebelum chat lagi.');
      }
      const filtered = abuse.filterChat(text);
      if (filtered.hits) {
        text = filtered.text;
        const m = player.chatGuard.strike();
        if (m) sys(`Jaga bahasa ya. Kamu di-mute ${Math.ceil(m / 1000)} detik.`);
      }
      const cmd = text.match(/^\/(access|unaccess|accesslist)\b\s*([A-Za-z0-9_]*)/i);
      if (cmd) { await handleAccessCommand(player, world, cmd[1].toLowerCase(), cmd[2]); return; }
      const line = { t: 'chat', from: player.username, id: player.id, text, world: world.name, ts: Date.now() };
      broadcastWorld(world, line);
      sync.publishChat(world, line);
      return;
    }
    if (t.startsWith && t.startsWith('trade_')) {
      if (['trade_request', 'trade_accept', 'trade_cancel', 'trade_offer', 'trade_ready'].includes(t)) await handleTrade(player, ws, world, t, msg);
      return;
    }
  }

  ws.on('close', () => {
    player.closed = true;
    leaveCurrentWorld(player);
    saveProfile(player);
    if (player.authed) store.releaseSession(player.id, player.connId).catch(() => {});
    if (!player.kicked) cancelTradeFor(player).catch((e) => console.warn('[trade] cancel on close failed', e.message));
    shard.connections.delete(ws);
    shard.players = shard.connections.size;
  });
});

setInterval(() => {
  for (const world of worlds.allWorlds()) {
    if (!world || world.players.size === 0) continue;
    const snap = [];
    for (const p of world.players.values()) {
      snap.push({ i: p.id, u: p.username, x: p.x, y: p.y, px: p.px, py: p.py });
    }
    for (const r of sync.remotePlayers(world)) snap.push({ i: r.i, u: r.u, x: r.x, y: r.y, px: r.px, py: r.py });
    for (const p of world.players.values()) {
      const nearby = [];
      for (const o of snap) {
        if (o.i === p.id) continue;
        const dx = o.x - p.x, dy = o.y - p.y;
        if (dx * dx + dy * dy <= INTEREST_RADIUS * INTEREST_RADIUS) nearby.push(o);
      }
      if (nearby.length > 64) nearby.length = 64;
      safeSend(p.ws, { t: 'snap', world: world.name, n: nearby });
    }
  }
}, Math.floor(1000 / TICK_HZ));

setInterval(() => {
  const mb = process.memoryUsage().rss / 1024 / 1024;
  if (mb > 450) console.warn('[scale-down] high RSS', Math.round(mb), 'MB');
}, 15000);

async function handleAccessCommand(player, world, cmd, targetName) {
  const reply = (text) => safeSend(player.ws, { t: 'chat', from: 'SYSTEM', id: 'system', text, world: world.name, ts: Date.now() });
  const announce = (text) => {
    const line = { t: 'chat', from: 'SYSTEM', id: 'system', text, world: world.name, ts: Date.now() };
    broadcastWorld(world, line);
    sync.publishChat(world, line);
  };
  if (cmd === 'accesslist') {
    const names = (world.access || []).map((a) => a.username);
    return reply(world.lockOwnerId
      ? `Pemilik: ${world.lockOwnerName}. Akses: ${names.length ? names.join(', ') : '(kosong)'}`
      : 'Dunia ini belum dikunci World Lock.');
  }
  if (!player.authed) return reply('Login dulu untuk mengatur akses.');
  if (!targetName) return reply(`Pakai: /${cmd} <username>`);
  if (cmd === 'access') {
    let target = null;
    try { target = await store.getUser(targetName); } catch (e) { return reply('Database sibuk, coba lagi.'); }
    if (!target) return reply(`Pemain ${targetName} tidak ditemukan.`);
    const r = sync.submit(world, { kind: 'access_grant', actorId: player.id, actorName: player.username, target: { id: target.id, username: target.username } });
    if (r.error) return reply(r.error);
    announce(`${target.username} diberi akses World Lock oleh ${player.username}.`);
    return;
  }
  const r = sync.submit(world, { kind: 'access_revoke', actorId: player.id, actorName: player.username, target: targetName });
  if (r.error) return reply(r.error);
  announce(`Akses ${targetName} dicabut.`);
}

// Periodic persistence: world snapshots (authoritative state only) + pending player profiles.
setInterval(() => {
  sync.snapshotAll().catch((e) => console.error('[sync] snapshotAll', e.message));
  for (const p of localPlayers()) saveProfile(p);
}, SAVE_INTERVAL_MS);
setInterval(() => { sync.maintenance(); }, MAINTENANCE_MS);

let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${sig} — saving worlds & profiles…`);
  const hard = setTimeout(() => process.exit(1), 10000);
  try {
    const pending = [];
    for (const p of localPlayers()) {
      pending.push(saveProfile(p));
      if (p.authed) pending.push(store.releaseSession(p.id, p.connId).catch(() => {}));
    }
    await Promise.all(pending);
    await sync.shutdown();
    await store.close();
  } catch (e) { console.error('[shutdown]', e.message); }
  clearTimeout(hard);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function start() {
  await store.init();
  const r = await sync.ensureWorld('START', { create: true, creatorId: 'system' });
  if (r.error) throw new Error(`START world: ${r.error}`);
  sync.start();
  social.start();
  console.log(`[store] backend=${store.kind} instance=${INSTANCE_ID} START@${r.world.appliedSeq}`);
  server.listen(PORT, HOST, onListening);
}
start().catch((e) => {
  console.error('[startup] failed:', e);
  process.exit(1);
});

function onListening() {
  console.log(`Pixeltopia SHARED server on http://${HOST}:${PORT}`);
  console.log(`mode=shared-process shards=${SHARD_COUNT} max/shard=${MAX_CONN_PER_SHARD} capacity=${SHARD_COUNT * MAX_CONN_PER_SHARD}`);
  console.log(`tick=${TICK_HZ}Hz interest=${INTEREST_RADIUS} sync-poll=${SYNC_POLL_MS}ms`);
  console.log('JWT_SECRET is', process.env.JWT_SECRET ? 'from env' : 'DEV DEFAULT — set JWT_SECRET in production');
}
