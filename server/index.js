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
const { createWorldManager } = require('./lib/world_manager');
const { createTradeManager } = require('./lib/trade');
const { createStore } = require('./lib/store');

// Load server/.env (gitignored) without overriding real env vars from the host.
(function loadDotEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
})();

const PORT = Number(process.env.PORT || 8787);
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

const store = createStore({ dataDir: DATA_DIR });
const auth = createAuth({ jwtSecret: JWT_SECRET });
const worlds = createWorldManager();
const trades = createTradeManager();

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
function serverListPayload() {
  return shards.map((s) => ({
    id: s.id, name: s.name, shard: s.shard,
    host: process.env.PUBLIC_HOST || '127.0.0.1', port: PORT,
    wsPath: `/ws?shard=${encodeURIComponent(s.id)}`,
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
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true, mode: 'shared-process', storage: store.kind, shards: shards.length,
        worlds: worlds.listWorlds().length, connections: totalConnections(),
        capacity: SHARD_COUNT * MAX_CONN_PER_SHARD, tickHz: TICK_HZ,
      });
    }
    if (req.method === 'GET' && url.pathname === '/stats') {
      return sendJson(res, 200, {
        connections: totalConnections(), capacity: SHARD_COUNT * MAX_CONN_PER_SHARD,
        shards: serverListPayload(), worlds: worlds.listWorlds(),
        memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        tickHz: TICK_HZ, mode: 'shared-process', storage: store.kind,
      });
    }
    if (req.method === 'GET' && url.pathname === '/servers') {
      return sendJson(res, 200, {
        servers: serverListPayload(), balancer: 'least-connections',
        mode: 'shared-process', note: 'All gateways share one Node process and one world registry.',
      });
    }
    if (req.method === 'GET' && url.pathname === '/worlds') {
      return sendJson(res, 200, { worlds: worlds.listWorlds() });
    }
    if (req.method === 'POST' && url.pathname === '/register') {
      const body = await readBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (username.length < 3 || username.length > 24) return sendJson(res, 400, { error: 'Username 3–24 karakter.' });
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
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const row = username ? await store.getUser(username) : null;
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

// ---------------------------------------------------------------- persistence
const savingWorlds = new Set();
async function saveWorld(world, reason) {
  if (!world || !world.dirty || savingWorlds.has(world.name)) return;
  savingWorlds.add(world.name);
  world.dirty = false;
  try {
    await store.saveWorld(world);
  } catch (e) {
    world.dirty = true;
    console.error(`[store] save world ${world.name} (${reason}) failed:`, e.message);
  } finally { savingWorlds.delete(world.name); }
}
async function flushAllWorlds(reason) {
  await Promise.all(worlds.allWorlds().filter((w) => w.dirty).map((w) => saveWorld(w, reason)));
}
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
async function saveProfile(player) {
  if (!player.authed || !player.pendingProfile) return;
  const data = player.pendingProfile;
  player.pendingProfile = null;
  try { await store.saveProfile(player.id, data); } catch (e) {
    if (!player.pendingProfile) player.pendingProfile = data;
    console.error(`[store] save profile ${player.username} failed:`, e.message);
  }
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
function broadcastWorld(world, obj, exceptId) {
  if (!world) return;
  for (const p of world.players.values()) {
    if (exceptId && p.id === exceptId) continue;
    safeSend(p.ws, obj);
  }
}
function worldSnapshot(world) {
  return {
    t: 'world_state', name: world.name, w: worlds.W, h: worlds.H, seed: world.seed,
    grid: worlds.gridArray(world), spawn: world.spawn,
    lockOwnerId: world.lockOwnerId, lockOwnerName: world.lockOwnerName,
    players: [...world.players.values()].map((p) => ({ i: p.id, u: p.username, x: p.x, y: p.y })),
  };
}
function leaveCurrentWorld(player) {
  if (!player.worldName) return;
  const w = worlds.getWorld(player.worldName);
  if (w) {
    worlds.leave(w, player);
    broadcastWorld(w, { t: 'player_left', id: player.id, username: player.username });
    saveWorld(w, w.players.size === 0 ? 'empty' : 'leave');
  }
  player.worldName = null;
}
function joinNamedWorld(player, rawName, createIfMissing) {
  const name = worlds.normalizeWorldName(rawName) || 'START';
  let w = worlds.getWorld(name);
  if (!w) {
    if (!createIfMissing) return { error: 'Dunia tidak ditemukan. Buat dulu atau cek nama.' };
    const created = worlds.createWorld(name, player.id);
    if (created.error && !created.world) return { error: created.error };
    w = created.world || worlds.getWorld(name);
    if (created.created) saveWorld(w, 'create');
  }
  leaveCurrentWorld(player);
  worlds.join(w, player);
  safeSend(player.ws, worldSnapshot(w));
  broadcastWorld(w, { t: 'player_join', player: { i: player.id, u: player.username, x: player.x, y: player.y } }, player.id);
  return { world: w };
}
function findPlayerById(id) {
  for (const s of shards) for (const ws of s.connections) {
    if (ws._player && ws._player.id === id) return ws._player;
  }
  return null;
}
function canFulfill(player, offer) {
  if ((player.inv.gems | 0) < (offer.gems | 0)) return false;
  for (const it of offer.items || []) if ((player.inv.items[it.id] | 0) < (it.n | 0)) return false;
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
function notifyTrade(session, event) {
  const pub = trades.publicSession(session);
  const a = findPlayerById(session.a);
  const b = findPlayerById(session.b);
  if (a) safeSend(a.ws, { t: 'trade', event, trade: pub });
  if (b) safeSend(b.ws, { t: 'trade', event, trade: pub });
}
function broadcastAllGateways(obj) {
  for (const s of shards) for (const ws of s.connections) safeSend(ws, obj);
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/ws', `http://${req.headers.host || 'localhost'}`);
  const token = url.searchParams.get('token') || '';
  const authPayload = auth.verifyToken(token);
  const shard = findShard(url.searchParams.get('shard') || '');
  if (shard.connections.size >= shard.maxPlayers) { ws.close(1013, 'shard full'); return; }
  if (totalConnections() >= SHARD_COUNT * MAX_CONN_PER_SHARD) { ws.close(1013, 'server full'); return; }

  const player = {
    id: authPayload?.sub || crypto.randomBytes(4).toString('hex'),
    username: authPayload?.username || `guest-${Math.floor(Math.random() * 9999)}`,
    x: 32, y: 10, ws, shard, lastSeq: 0, worldName: null,
    inv: { items: {}, gems: 0 }, authed: !!authPayload?.sub, pendingProfile: null,
  };
  ws._player = player;
  shard.connections.add(ws);
  shard.players = shard.connections.size;

  const sendWelcome = (profile) => safeSend(ws, {
    t: 'welcome', mode: 'shared-process', shard: shard.id, storage: store.kind,
    you: { id: player.id, username: player.username, x: player.x, y: player.y, guest: !player.authed },
    tickHz: TICK_HZ, capacity: SHARD_COUNT * MAX_CONN_PER_SHARD, worlds: worlds.listWorlds(),
    profile: profile || null,
  });
  if (player.authed) {
    store.getProfile(player.id).then((p) => sendWelcome(p), (e) => {
      console.warn('[store] getProfile failed', e.message);
      sendWelcome(null);
    });
  } else sendWelcome(null);

  ws.on('message', (raw) => {
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
      player.inv = { items, gems: Math.max(0, msg.gems | 0) };
      return;
    }
    if (t === 'profile_save') {
      if (!player.authed) return;
      const prof = sanitizeProfile(msg.profile);
      if (!prof) return safeSend(ws, { t: 'error', error: 'Profil terlalu besar / tidak valid.' });
      player.pendingProfile = prof;
      if (msg.now) saveProfile(player);
      return;
    }
    if (t === 'list_worlds') { safeSend(ws, { t: 'worlds', worlds: worlds.listWorlds() }); return; }
    if (t === 'create_world') {
      const name = worlds.normalizeWorldName(msg.name);
      if (!name) return safeSend(ws, { t: 'error', error: 'Nama dunia tidak valid.' });
      const r = worlds.createWorld(name, player.id);
      if (r.error && !worlds.getWorld(name)) return safeSend(ws, { t: 'error', error: r.error });
      const joined = joinNamedWorld(player, name, false);
      if (joined.error) return safeSend(ws, { t: 'error', error: joined.error });
      broadcastAllGateways({ t: 'worlds', worlds: worlds.listWorlds() });
      return;
    }
    if (t === 'join_world' || t === 'travel') {
      const joined = joinNamedWorld(player, msg.name || 'START', !!msg.create);
      if (joined.error) return safeSend(ws, { t: 'error', error: joined.error });
      return;
    }
    if (t === 'leave_world') { leaveCurrentWorld(player); safeSend(ws, { t: 'left_world' }); return; }
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
      const r = worlds.punch(world, player, msg.x, msg.y);
      if (r.error) return safeSend(ws, { t: 'error', error: r.error });
      if (r.noop) return;
      broadcastWorld(world, {
        t: 'tile', x: r.x, y: r.y, id: r.id, by: player.id, action: 'punch', broke: r.broke,
        lockOwnerId: world.lockOwnerId, lockOwnerName: world.lockOwnerName,
      });
      return;
    }
    if (t === 'place') {
      if (!world) return safeSend(ws, { t: 'error', error: 'Join dunia dulu.' });
      const r = worlds.place(world, player, msg.x, msg.y, msg.id);
      if (r.error) return safeSend(ws, { t: 'error', error: r.error });
      broadcastWorld(world, {
        t: 'tile', x: r.x, y: r.y, id: r.id, by: player.id, action: 'place',
        lockOwnerId: world.lockOwnerId, lockOwnerName: world.lockOwnerName,
      });
      return;
    }
    if (t === 'chat') {
      if (!world) return safeSend(ws, { t: 'error', error: 'Join dunia dulu.' });
      let text = String(msg.text || '').replace(/[\r\n\t]/g, ' ').trim();
      if (!text) return;
      if (text.length > MAX_CHAT_LEN) text = text.slice(0, MAX_CHAT_LEN);
      const cmd = text.match(/^\/(access|unaccess|accesslist)\b\s*([A-Za-z0-9_]*)/i);
      if (cmd) { handleAccessCommand(player, world, cmd[1].toLowerCase(), cmd[2]); return; }
      broadcastWorld(world, { t: 'chat', from: player.username, id: player.id, text, world: world.name, ts: Date.now() });
      return;
    }
    if (t === 'trade_request') {
      if (!world) return safeSend(ws, { t: 'error', error: 'Join dunia dulu.' });
      const toId = String(msg.to || '');
      const target = world.players.get(toId);
      if (!target) return safeSend(ws, { t: 'error', error: 'Pemain tidak di dunia ini.' });
      const r = trades.request(player, toId);
      if (r.error) return safeSend(ws, { t: 'error', error: r.error });
      const pub = trades.publicSession(r.session);
      safeSend(ws, { t: 'trade', event: 'requested', trade: pub });
      safeSend(target.ws, { t: 'trade', event: 'incoming', trade: pub });
      return;
    }
    if (t === 'trade_accept') {
      const r = trades.accept(player, msg.id);
      if (r.error) return safeSend(ws, { t: 'error', error: r.error });
      const pub = trades.publicSession(r.session);
      const a = findPlayerById(r.session.a); const b = findPlayerById(r.session.b);
      if (a) safeSend(a.ws, { t: 'trade', event: 'open', trade: pub });
      if (b) safeSend(b.ws, { t: 'trade', event: 'open', trade: pub });
      return;
    }
    if (t === 'trade_cancel') {
      const r = trades.cancel(player);
      if (r.error) return safeSend(ws, { t: 'error', error: r.error });
      const pub = trades.publicSession(r.session);
      const a = findPlayerById(r.session.a); const b = findPlayerById(r.session.b);
      if (a) safeSend(a.ws, { t: 'trade', event: 'cancelled', trade: pub });
      if (b) safeSend(b.ws, { t: 'trade', event: 'cancelled', trade: pub });
      return;
    }
    if (t === 'trade_offer') {
      const r = trades.offer(player, msg.items, msg.gems);
      if (r.error) return safeSend(ws, { t: 'error', error: r.error });
      notifyTrade(r.session, 'offer');
      return;
    }
    if (t === 'trade_ready') {
      const r = trades.ready(player, msg.ready !== false);
      if (r.error) return safeSend(ws, { t: 'error', error: r.error });
      notifyTrade(r.session, 'ready');
      if (r.bothReady) {
        const s = r.session;
        const offerA = s.offers[s.a] || { items: [], gems: 0 };
        const offerB = s.offers[s.b] || { items: [], gems: 0 };
        const pa = findPlayerById(s.a); const pb = findPlayerById(s.b);
        if (!pa || !pb) { trades.complete(s.id); return; }
        if (!canFulfill(pa, offerA) || !canFulfill(pb, offerB)) {
          safeSend(pa.ws, { t: 'trade', event: 'failed', error: 'Inventori tidak cukup.', trade: trades.publicSession(s) });
          safeSend(pb.ws, { t: 'trade', event: 'failed', error: 'Inventori tidak cukup.', trade: trades.publicSession(s) });
          s.ready[s.a] = false; s.ready[s.b] = false;
          return;
        }
        applyOffer(pa, offerA, -1); applyOffer(pb, offerB, -1);
        applyOffer(pa, offerB, +1); applyOffer(pb, offerA, +1);
        const done = trades.complete(s.id);
        store.logTrade({ a: s.a, b: s.b, world: s.worldName, offerA, offerB })
          .catch((e) => console.warn('[store] logTrade failed', e.message));
        const payload = {
          t: 'trade', event: 'completed', trade: trades.publicSession(done),
          give: { [s.a]: offerB, [s.b]: offerA }, take: { [s.a]: offerA, [s.b]: offerB },
        };
        safeSend(pa.ws, payload); safeSend(pb.ws, payload);
      }
      return;
    }
  });

  ws.on('close', () => {
    leaveCurrentWorld(player);
    saveProfile(player);
    const open = trades.getOpenFor(player.id);
    if (open) {
      const otherId = open.a === player.id ? open.b : open.a;
      trades.cancel(player);
      const other = findPlayerById(otherId);
      if (other) safeSend(other.ws, { t: 'trade', event: 'cancelled', trade: trades.publicSession(open) });
    }
    shard.connections.delete(ws);
    shard.players = shard.connections.size;
  });
});

setInterval(() => {
  for (const winfo of worlds.listWorlds()) {
    const world = worlds.getWorld(winfo.name);
    if (!world || world.players.size === 0) continue;
    const snap = [];
    for (const p of world.players.values()) {
      snap.push({ i: p.id, u: p.username, x: p.x, y: p.y, px: p.px, py: p.py });
    }
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
    const r = worlds.grantAccess(world, player, { id: target.id, username: target.username });
    if (r.error) return reply(r.error);
    saveWorld(world, 'access');
    broadcastWorld(world, { t: 'chat', from: 'SYSTEM', id: 'system', text: `${target.username} diberi akses World Lock oleh ${player.username}.`, world: world.name, ts: Date.now() });
    return;
  }
  const r = worlds.revokeAccess(world, player, targetName);
  if (r.error) return reply(r.error);
  saveWorld(world, 'access');
  broadcastWorld(world, { t: 'chat', from: 'SYSTEM', id: 'system', text: `Akses ${targetName} dicabut.`, world: world.name, ts: Date.now() });
}

// Periodic persistence: dirty worlds + pending player profiles.
setInterval(() => {
  flushAllWorlds('interval');
  for (const s of shards) for (const ws of s.connections) if (ws._player) saveProfile(ws._player);
}, SAVE_INTERVAL_MS);

let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${sig} — saving worlds & profiles…`);
  const hard = setTimeout(() => process.exit(1), 10000);
  try {
    const pending = [];
    for (const s of shards) for (const ws of s.connections) if (ws._player) pending.push(saveProfile(ws._player));
    await Promise.all(pending);
    await flushAllWorlds('shutdown');
    await store.close();
  } catch (e) { console.error('[shutdown]', e.message); }
  clearTimeout(hard);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function start() {
  await store.init();
  const saved = await store.loadWorlds();
  let restored = 0;
  for (const w of saved) if (worlds.hydrate(w)) restored++;
  worlds.ensureStart();
  await flushAllWorlds('startup');
  console.log(`[store] backend=${store.kind} worlds restored=${restored}`);
  server.listen(PORT, HOST, onListening);
}
start().catch((e) => {
  console.error('[startup] failed:', e);
  process.exit(1);
});

function onListening() {
  console.log(`Pixeltopia SHARED server on http://${HOST}:${PORT}`);
  console.log(`mode=shared-process shards=${SHARD_COUNT} max/shard=${MAX_CONN_PER_SHARD} capacity=${SHARD_COUNT * MAX_CONN_PER_SHARD}`);
  console.log(`tick=${TICK_HZ}Hz interest=${INTEREST_RADIUS} worlds=${worlds.listWorlds().length}`);
  console.log('JWT_SECRET is', process.env.JWT_SECRET ? 'from env' : 'DEV DEFAULT — set JWT_SECRET in production');
}
