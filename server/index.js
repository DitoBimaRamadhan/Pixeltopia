#!/usr/bin/env node
/**
 * Pixeltopia free-tier server gateway
 * - HTTP: /register /login /servers /health /stats
 * - WebSocket: shard rooms with interest culling + tick caps
 * Designed for 100–1000 concurrent connections on modest free VPS/PaaS.
 */
'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const zlib = require('zlib');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'pixeltopia-local-dev-only-change-me';
const TICK_HZ = Math.max(1, Math.min(20, Number(process.env.TICK_HZ || 10)));
const INTEREST_RADIUS = Number(process.env.INTEREST_RADIUS || 24); // tiles
const MAX_CONN_PER_SHARD = Number(process.env.MAX_CONN_PER_SHARD || 250);
const SHARD_COUNT = Math.max(1, Number(process.env.SHARD_COUNT || 4));
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const COMPRESS_WS = process.env.COMPRESS_WS !== '0';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function scryptHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}
function scryptVerify(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const next = crypto.scryptSync(password, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(next, 'hex'));
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}
function signToken(payload, ttlSec = 60 * 60 * 24 * 14) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expect = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (sig !== expect) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** @type {{id:string,name:string,shard:string,players:number,maxPlayers:number,connections:Set<any>}[]} */
const shards = [];
for (let i = 0; i < SHARD_COUNT; i++) {
  shards.push({
    id: `world-${i + 1}`,
    name: `Pixeltopia Dunia ${i + 1}`,
    shard: `S${i + 1}`,
    players: 0,
    maxPlayers: MAX_CONN_PER_SHARD,
    connections: new Set(),
  });
}

function pickShardLeastConnections() {
  let best = shards[0];
  for (const s of shards) {
    if (s.connections.size < best.connections.size) best = s;
  }
  return best;
}

function serverListPayload() {
  return shards.map((s) => ({
    id: s.id,
    name: s.name,
    shard: s.shard,
    host: process.env.PUBLIC_HOST || '127.0.0.1',
    port: PORT,
    wsPath: `/ws?shard=${encodeURIComponent(s.id)}`,
    players: s.connections.size,
    maxPlayers: s.maxPlayers,
    load: s.connections.size / Math.max(1, s.maxPlayers),
    tickHz: TICK_HZ,
    interestRadius: INTEREST_RADIUS,
  })).sort((a, b) => a.players - b.players);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => {
      chunks.push(c);
      if (Buffer.concat(chunks).length > 1e6) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
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
      return sendJson(res, 200, { ok: true, shards: shards.length, tickHz: TICK_HZ });
    }
    if (req.method === 'GET' && url.pathname === '/stats') {
      const total = shards.reduce((n, s) => n + s.connections.size, 0);
      return sendJson(res, 200, {
        connections: total,
        shards: serverListPayload(),
        memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        tickHz: TICK_HZ,
      });
    }
    if (req.method === 'GET' && url.pathname === '/servers') {
      return sendJson(res, 200, { servers: serverListPayload(), balancer: 'least-connections' });
    }
    if (req.method === 'POST' && url.pathname === '/register') {
      const body = await readBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (username.length < 3 || username.length > 24) return sendJson(res, 400, { error: 'Username 3–24 karakter.' });
      if (!/^[a-zA-Z0-9_]+$/.test(username)) return sendJson(res, 400, { error: 'Username hanya huruf/angka/_.' });
      if (password.length < 4) return sendJson(res, 400, { error: 'Password minimal 4 karakter.' });
      const users = loadUsers();
      const key = username.toLowerCase();
      if (users[key]) return sendJson(res, 409, { error: 'Username sudah dipakai.' });
      const id = crypto.randomBytes(8).toString('hex');
      users[key] = { id, username, passwordHash: scryptHash(password), createdAt: Date.now() };
      saveUsers(users);
      const token = signToken({ sub: id, username });
      return sendJson(res, 201, { token, username, userId: id });
    }
    if (req.method === 'POST' && url.pathname === '/login') {
      const body = await readBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const users = loadUsers();
      const row = users[username.toLowerCase()];
      if (!row || !scryptVerify(password, row.passwordHash)) {
        return sendJson(res, 401, { error: 'Username atau password salah.' });
      }
      const token = signToken({ sub: row.id, username: row.username });
      return sendJson(res, 200, { token, username: row.username, userId: row.id });
    }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    return sendJson(res, 500, { error: 'Server error', detail: String(e.message || e) });
  }
});

const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: COMPRESS_WS ? {
  zlibDeflateOptions: { chunkSize: 1024, memLevel: 7, level: 3 },
  threshold: 128,
} : false });

function findShard(id) {
  return shards.find((s) => s.id === id) || pickShardLeastConnections();
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/ws', `http://${req.headers.host || 'localhost'}`);
  const token = url.searchParams.get('token') || '';
  const auth = verifyToken(token);
  const shard = findShard(url.searchParams.get('shard') || '');
  if (shard.connections.size >= shard.maxPlayers) {
    ws.close(1013, 'shard full');
    return;
  }

  const player = {
    id: auth?.sub || crypto.randomBytes(4).toString('hex'),
    username: auth?.username || `guest-${Math.floor(Math.random() * 9999)}`,
    x: Math.floor(Math.random() * 40),
    y: Math.floor(Math.random() * 20),
    ws,
    shard,
    lastSeq: 0,
  };
  ws._player = player;
  shard.connections.add(ws);
  shard.players = shard.connections.size;

  safeSend(ws, { t: 'welcome', shard: shard.id, you: { id: player.id, username: player.username, x: player.x, y: player.y }, tickHz: TICK_HZ });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.t === 'move' && typeof msg.x === 'number' && typeof msg.y === 'number') {
      player.x = Math.max(-512, Math.min(512, msg.x | 0));
      player.y = Math.max(-512, Math.min(512, msg.y | 0));
      player.lastSeq = msg.seq | 0;
    } else if (msg.t === 'ping') {
      safeSend(ws, { t: 'pong', ts: Date.now() });
    }
  });

  ws.on('close', () => {
    shard.connections.delete(ws);
    shard.players = shard.connections.size;
  });
});

function safeSend(ws, obj) {
  if (ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch { /* ignore */ }
}

/** Interest management tick: each player only receives nearby peers (compact JSON). */
setInterval(() => {
  for (const shard of shards) {
    const snap = [];
    for (const ws of shard.connections) {
      const p = ws._player;
      if (!p) continue;
      snap.push({ i: p.id, u: p.username, x: p.x, y: p.y });
    }
    for (const ws of shard.connections) {
      const me = ws._player;
      if (!me) continue;
      const nearby = [];
      for (const o of snap) {
        if (o.i === me.id) continue;
        const dx = o.x - me.x;
        const dy = o.y - me.y;
        if (dx * dx + dy * dy <= INTEREST_RADIUS * INTEREST_RADIUS) nearby.push(o);
      }
      // Cap payload size under load
      if (nearby.length > 64) nearby.length = 64;
      safeSend(ws, { t: 'snap', n: nearby });
    }
  }
}, Math.floor(1000 / TICK_HZ));

// Soft scale-down: if RSS too high, lower tick (free-tier guard)
setInterval(() => {
  const mb = process.memoryUsage().rss / 1024 / 1024;
  if (mb > 450) {
    console.warn('[scale-down] high RSS', Math.round(mb), 'MB — consider fewer shards / lower TICK_HZ');
  }
}, 15000);

server.listen(PORT, HOST, () => {
  console.log(`Pixeltopia server on http://${HOST}:${PORT}`);
  console.log(`shards=${SHARD_COUNT} max/shard=${MAX_CONN_PER_SHARD} tick=${TICK_HZ}Hz interest=${INTEREST_RADIUS}`);
  console.log('JWT_SECRET is', process.env.JWT_SECRET ? 'from env' : 'DEV DEFAULT — set JWT_SECRET in production');
});
