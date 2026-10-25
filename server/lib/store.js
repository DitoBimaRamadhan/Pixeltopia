'use strict';
/**
 * Persistence layer for Pixeltopia.
 *  - Postgres (via `pg`) when DATABASE_URL is set (e.g. Neon / Supabase).
 *  - JSON files under server/data otherwise (local dev fallback).
 *
 * Every method is async so both backends share one interface:
 *   init(), close(), kind
 *   getUser(usernameLower), createUser({id, username, passwordHash, createdAt})
 *   getUserById(id), recordSession({userId, jti, expiresAt})
 *   loadWorlds() -> [{name, seed, grid(Int32Array), spawn, lockOwnerId, lockOwnerName, access[], createdBy, createdAt}]
 *   saveWorld(world)
 *   getProfile(userId) -> object|null, saveProfile(userId, data)
 *   logTrade(entry)
 *
 * Multi-instance world sync (migration v2; not yet used by index.js):
 *   loadWorld(name) -> world + {snapshotSeq, headSeq} | null
 *   createWorldIfAbsent(world) -> {created, world}
 *   appendEvent(worldName, ev, instanceId) -> {seq, ...ev} | null   (gapless per-world seq)
 *   fetchEvents(worldName, afterSeq, limit) -> [{seq, kind, actorId, ..., instanceId, createdAt}]
 *   saveSnapshotIfNewer(world, seq) -> boolean
 *   upsertPresence(worldName, instanceId, players), fetchPresence(worldNames[], {maxAgeMs, excludeInstance})
 *   deletePresence(worldName, instanceId), deleteStalePresence(maxAgeMs) -> count
 *   cleanupEvents({olderThanMs}) -> count   (only events already covered by a snapshot)
 */
const fs = require('fs');
const path = require('path');

function gridToB64(grid) {
  const a = grid instanceof Int32Array ? grid : Int32Array.from(grid || []);
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
}
function b64ToGrid(b64) {
  const buf = Buffer.from(String(b64 || ''), 'base64');
  const out = new Int32Array(buf.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt32LE(i * 4);
  return out;
}
function worldRow(w) {
  return {
    name: w.name, seed: w.seed >>> 0, grid: gridToB64(w.grid), spawn: w.spawn || { x: 32, y: 10 },
    lockOwnerId: w.lockOwnerId || null, lockOwnerName: w.lockOwnerName || null,
    access: Array.isArray(w.access) ? w.access : [],
    createdBy: w.createdBy || null, createdAt: Number(w.createdAt) || Date.now(), updatedAt: Date.now(),
  };
}
function rowToWorld(r) {
  return {
    name: r.name, seed: Number(r.seed) >>> 0, grid: b64ToGrid(r.grid), spawn: r.spawn || { x: 32, y: 10 },
    lockOwnerId: r.lockOwnerId || null, lockOwnerName: r.lockOwnerName || null,
    access: Array.isArray(r.access) ? r.access : [],
    createdBy: r.createdBy || null, createdAt: Number(r.createdAt) || Date.now(),
  };
}

const EVENT_COLUMNS = ['kind', 'actorId', 'actorName', 'toId', 'seq', 'instanceId', 'createdAt'];
/** Split an event into indexed columns + a JSON payload (everything else, e.g. x/y/id/target/text). */
function eventPayload(ev) {
  const data = {};
  for (const [k, v] of Object.entries(ev || {})) if (!EVENT_COLUMNS.includes(k) && v !== undefined) data[k] = v;
  return data;
}
function toEvent({ seq, kind, actorId, actorName, toId, data, instanceId, createdAt }) {
  const ev = { ...(data || {}), seq: Number(seq), kind };
  if (actorId != null) ev.actorId = actorId;
  if (actorName != null) ev.actorName = actorName;
  if (toId != null) ev.toId = toId;
  ev.instanceId = instanceId || null;
  ev.createdAt = Number(createdAt) || 0;
  return ev;
}
const clampLimit = (n) => Math.max(1, Math.min(5000, Number(n) || 500));
const TRADE_PENDING_TTL_MS = 60 * 1000;
const TRADE_OPEN_TTL_MS = 15 * 60 * 1000;
function tradeFromRow(r) {
  if (!r) return null;
  return {
    id: r.id, a: r.a_id, b: r.b_id, aName: r.a_name || null, bName: r.b_name || null, worldName: r.world || null,
    status: r.status, offers: r.offers || {}, ready: r.ready || {}, version: Number(r.version) || 0,
    createdAt: Number(r.created_at) || 0, updatedAt: Number(r.updated_at) || 0,
  };
}

// ---------------------------------------------------------------- file store
function createFileStore({ dataDir }) {
  const USERS = path.join(dataDir, 'users.json');
  const PROFILES = path.join(dataDir, 'profiles.json');
  const WORLDS_DIR = path.join(dataDir, 'worlds');
  const TRADES = path.join(dataDir, 'trades.log');
  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const writeJson = (f, obj) => {
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, f);
  };
  // Sync state for the single-process dev fallback: per-world seq counters and event log live in
  // memory; snapshot/head seqs are persisted inside each world file.
  const events = new Map();   // world -> [event]
  const presence = new Map(); // `${world}\u0000${instance}` -> {world, instanceId, players, updatedAt}
  const sessionsMem = new Map(); // userId -> {connId, instanceId, updatedAt}
  const tradesMem = new Map();   // id -> trade
  const worldFile = (name) => path.join(WORLDS_DIR, `${name}.json`);
  const readWorld = (name) => readJson(worldFile(name), null);
  return {
    kind: 'file',
    async init() { fs.mkdirSync(WORLDS_DIR, { recursive: true }); },
    async close() {},
    async getUser(key) { return readJson(USERS, {})[String(key).toLowerCase()] || null; },
    async getUserById(id) { return Object.values(readJson(USERS, {})).find((u) => u.id === id) || null; },
    async createUser(row) {
      const users = readJson(USERS, {});
      const key = row.username.toLowerCase();
      if (users[key]) return { error: 'exists' };
      users[key] = row;
      writeJson(USERS, users);
      return { ok: true };
    },
    async recordSession() { /* JWT is stateless; sessions are only logged in Postgres */ },
    async loadWorlds() {
      const out = [];
      for (const f of fs.readdirSync(WORLDS_DIR)) {
        if (!f.endsWith('.json')) continue;
        const r = readJson(path.join(WORLDS_DIR, f), null);
        if (r && r.name && r.grid) out.push(rowToWorld(r));
      }
      return out;
    },
    async saveWorld(w) { writeJson(path.join(WORLDS_DIR, `${w.name}.json`), worldRow(w)); },
    async getProfile(userId) {
      const p = readJson(PROFILES, {})[userId];
      if (!p) return null;
      const { _rev, ...rest } = p;
      return rest;
    },
    async saveProfile(userId, data, rev = Date.now()) {
      const all = readJson(PROFILES, {});
      const prevRev = Number((all[userId] || {})._rev) || 0;
      if (prevRev >= rev) return false;
      all[userId] = { ...data, updatedAt: Date.now(), _rev: rev };
      writeJson(PROFILES, all);
      return true;
    },
    async logTrade(entry) { fs.appendFileSync(TRADES, JSON.stringify({ ...entry, ts: Date.now() }) + '\n'); },

    async loadWorld(name) {
      const r = readWorld(name);
      if (!r || !r.name || !r.grid) return null;
      return { ...rowToWorld(r), snapshotSeq: Number(r.snapshotSeq) || 0, headSeq: Number(r.headSeq) || 0 };
    },
    async createWorldIfAbsent(w) {
      if (readWorld(w.name)) return { created: false, world: await this.loadWorld(w.name) };
      writeJson(worldFile(w.name), { ...worldRow(w), snapshotSeq: 0, headSeq: 0 });
      return { created: true, world: await this.loadWorld(w.name) };
    },
    async appendEvent(worldName, ev, instanceId) {
      const r = readWorld(worldName);
      if (!r) return null;
      r.headSeq = (Number(r.headSeq) || 0) + 1;
      writeJson(worldFile(worldName), r);
      const row = toEvent({ seq: r.headSeq, kind: ev.kind, actorId: ev.actorId, actorName: ev.actorName, toId: ev.toId,
        data: eventPayload(ev), instanceId, createdAt: Date.now() });
      if (!events.has(worldName)) events.set(worldName, []);
      events.get(worldName).push(row);
      return row;
    },
    async fetchEvents(worldName, afterSeq = 0, limit = 500) {
      return (events.get(worldName) || []).filter((e) => e.seq > afterSeq).slice(0, clampLimit(limit));
    },
    async saveSnapshotIfNewer(w, seq) {
      const r = readWorld(w.name);
      seq = Number(seq) || 0;
      if (!r || (Number(r.snapshotSeq) || 0) >= seq || seq > (Number(r.headSeq) || 0)) return false;
      writeJson(worldFile(w.name), { ...r, ...worldRow(w), createdAt: r.createdAt, seed: r.seed, snapshotSeq: seq, headSeq: r.headSeq });
      return true;
    },
    async upsertPresence(worldName, instanceId, players) {
      presence.set(`${worldName}\u0000${instanceId}`, { world: worldName, instanceId, players: players || [], updatedAt: Date.now() });
    },
    async fetchPresence(worldNames, { maxAgeMs = 5000, excludeInstance = null } = {}) {
      const cutoff = Date.now() - maxAgeMs;
      return [...presence.values()].filter((p) => worldNames.includes(p.world) && p.updatedAt >= cutoff && p.instanceId !== excludeInstance);
    },
    async deletePresence(worldName, instanceId) { presence.delete(`${worldName}\u0000${instanceId}`); },
    async deleteStalePresence(maxAgeMs = 30000) {
      const cutoff = Date.now() - maxAgeMs; let n = 0;
      for (const [k, p] of presence) if (p.updatedAt < cutoff) { presence.delete(k); n++; }
      return n;
    },
    async fetchEventsMulti(cursors, limit = 500) {
      const heads = {}; const out = {};
      for (const { world, after } of cursors || []) {
        const r = readWorld(world);
        if (!r) continue;
        heads[world] = { headSeq: Number(r.headSeq) || 0, snapshotSeq: Number(r.snapshotSeq) || 0 };
        out[world] = await this.fetchEvents(world, after, limit);
      }
      return { heads, events: out };
    },
    async listWorldSummaries({ presenceMaxAgeMs = 5000 } = {}) {
      const cutoff = Date.now() - presenceMaxAgeMs;
      const counts = {};
      for (const p of presence.values()) if (p.updatedAt >= cutoff) counts[p.world] = (counts[p.world] || 0) + (p.players || []).length;
      const out = [];
      for (const f of fs.readdirSync(WORLDS_DIR)) {
        if (!f.endsWith('.json')) continue;
        const r = readJson(path.join(WORLDS_DIR, f), null);
        if (!r || !r.name) continue;
        out.push({ name: r.name, seed: Number(r.seed) >>> 0, lockOwner: r.lockOwnerName || null, locked: !!r.lockOwnerId,
          access: (Array.isArray(r.access) ? r.access : []).map((a) => a.username), players: counts[r.name] || 0 });
      }
      out.sort((a, b) => a.name.localeCompare(b.name));
      return out;
    },
    async claimSession(userId, connId, instanceId) {
      const prev = sessionsMem.get(userId) || null;
      sessionsMem.set(userId, { connId, instanceId, updatedAt: Date.now() });
      return prev ? { prevConnId: prev.connId, prevInstanceId: prev.instanceId } : null;
    },
    async fetchSessionOwners(userIds) {
      const out = {};
      for (const id of userIds || []) if (sessionsMem.has(id)) out[id] = sessionsMem.get(id).connId;
      return out;
    },
    async releaseSession(userId, connId) {
      const cur = sessionsMem.get(userId);
      if (cur && cur.connId === connId) sessionsMem.delete(userId);
    },
    async tradeExpire() {
      const now = Date.now();
      for (const t of tradesMem.values()) {
        if ((t.status === 'pending' && now - t.updatedAt > TRADE_PENDING_TTL_MS) || (t.status === 'open' && now - t.updatedAt > TRADE_OPEN_TTL_MS)) {
          t.status = 'cancelled'; t.version++; t.updatedAt = now;
        }
      }
    },
    async tradeGet(id) { const t = tradesMem.get(String(id)); return t ? JSON.parse(JSON.stringify(t)) : null; },
    async tradeActiveFor(playerId) {
      await this.tradeExpire();
      const list = [...tradesMem.values()].filter((t) => (t.status === 'pending' || t.status === 'open') && (t.a === playerId || t.b === playerId));
      list.sort((x, y) => (x.status === 'open' ? 0 : 1) - (y.status === 'open' ? 0 : 1) || y.updatedAt - x.updatedAt);
      return list[0] ? JSON.parse(JSON.stringify(list[0])) : null;
    },
    async tradeCreate(t) {
      await this.tradeExpire();
      for (const x of tradesMem.values()) {
        if (x.status === 'pending' && x.a === t.a) { x.status = 'cancelled'; x.version++; x.updatedAt = Date.now(); }
      }
      if ([...tradesMem.values()].some((x) => x.status === 'open' && [t.a, t.b].some((id) => x.a === id || x.b === id))) return null;
      const row = { ...t, status: 'pending', version: 0, createdAt: Date.now(), updatedAt: Date.now() };
      tradesMem.set(row.id, row);
      return JSON.parse(JSON.stringify(row));
    },
    async tradeUpdate(id, version, patch) {
      const t = tradesMem.get(String(id));
      if (!t || t.version !== version || t.status === 'done' || t.status === 'cancelled') return null;
      Object.assign(t, patch, { version: t.version + 1, updatedAt: Date.now() });
      return JSON.parse(JSON.stringify(t));
    },
    async tradeComplete(id, version) {
      const t = tradesMem.get(String(id));
      if (!t || t.version !== version || t.status !== 'open' || !t.ready[t.a] || !t.ready[t.b]) return null;
      Object.assign(t, { status: 'done', version: t.version + 1, updatedAt: Date.now() });
      return JSON.parse(JSON.stringify(t));
    },
    async cleanupEvents({ olderThanMs = 10 * 60 * 1000 } = {}) {
      const cutoff = Date.now() - olderThanMs; let n = 0;
      for (const [name, list] of events) {
        const snap = Number((readWorld(name) || {}).snapshotSeq) || 0;
        const keep = list.filter((e) => !(e.seq <= snap && e.createdAt < cutoff));
        n += list.length - keep.length;
        events.set(name, keep);
      }
      return n;
    },
  };
}

// ------------------------------------------------------------ postgres store
const MIGRATIONS = [
  // v1 — initial schema
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL,
     username_lower TEXT NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     created_at BIGINT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS sessions (
     jti TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at BIGINT NOT NULL,
     expires_at BIGINT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
   CREATE TABLE IF NOT EXISTS worlds (
     name TEXT PRIMARY KEY,
     seed BIGINT NOT NULL,
     grid TEXT NOT NULL,
     spawn JSONB NOT NULL,
     lock_owner_id TEXT,
     lock_owner_name TEXT,
     access JSONB NOT NULL DEFAULT '[]'::jsonb,
     created_by TEXT,
     created_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS profiles (
     user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     data JSONB NOT NULL,
     updated_at BIGINT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS trades (
     id BIGSERIAL PRIMARY KEY,
     a_id TEXT NOT NULL,
     b_id TEXT NOT NULL,
     world TEXT,
     offer_a JSONB NOT NULL,
     offer_b JSONB NOT NULL,
     created_at BIGINT NOT NULL
   );`,
  // v2 — multi-instance world sync: per-world gapless event log, snapshot cursor, presence,
  // shared trade sessions, profile revision guard. Additive + idempotent; existing rows keep working.
  `ALTER TABLE worlds ADD COLUMN IF NOT EXISTS head_seq BIGINT NOT NULL DEFAULT 0;
   ALTER TABLE worlds ADD COLUMN IF NOT EXISTS snapshot_seq BIGINT NOT NULL DEFAULT 0;
   CREATE TABLE IF NOT EXISTS world_events (
     world TEXT NOT NULL,
     seq BIGINT NOT NULL,
     kind TEXT NOT NULL,
     actor_id TEXT,
     actor_name TEXT,
     to_id TEXT,
     data JSONB NOT NULL DEFAULT '{}'::jsonb,
     instance_id TEXT,
     created_at BIGINT NOT NULL,
     PRIMARY KEY (world, seq)
   );
   CREATE INDEX IF NOT EXISTS world_events_created_idx ON world_events(created_at);
   CREATE TABLE IF NOT EXISTS world_presence (
     world TEXT NOT NULL,
     instance_id TEXT NOT NULL,
     players JSONB NOT NULL DEFAULT '[]'::jsonb,
     updated_at BIGINT NOT NULL,
     PRIMARY KEY (world, instance_id)
   );
   CREATE INDEX IF NOT EXISTS world_presence_updated_idx ON world_presence(updated_at);
   CREATE TABLE IF NOT EXISTS trade_sessions (
     id TEXT PRIMARY KEY,
     a_id TEXT NOT NULL,
     b_id TEXT NOT NULL,
     a_name TEXT,
     b_name TEXT,
     world TEXT,
     status TEXT NOT NULL DEFAULT 'pending',
     offers JSONB NOT NULL DEFAULT '{}'::jsonb,
     ready JSONB NOT NULL DEFAULT '{}'::jsonb,
     version INT NOT NULL DEFAULT 0,
     created_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS trade_sessions_a_idx ON trade_sessions(a_id);
   CREATE INDEX IF NOT EXISTS trade_sessions_b_idx ON trade_sessions(b_id);
   ALTER TABLE profiles ADD COLUMN IF NOT EXISTS rev BIGINT NOT NULL DEFAULT 0;`,
  // v3 — one live connection per account across instances (newest wins, older ones get kicked).
  `CREATE TABLE IF NOT EXISTS active_sessions (
     user_id TEXT PRIMARY KEY,
     conn_id TEXT NOT NULL,
     instance_id TEXT NOT NULL,
     updated_at BIGINT NOT NULL
   );`,
];

/**
 * PG_DRIVER=pg   (default) node-postgres over TCP :5432.
 * PG_DRIVER=neon Neon serverless driver (pg-compatible Pool over WebSocket :443) —
 *                useful where outbound :5432 is blocked.
 */
function makePool(databaseUrl) {
  const driver = (process.env.PG_DRIVER || 'pg').toLowerCase();
  const max = Number(process.env.PG_POOL_MAX || 5);
  if (driver === 'neon') {
    const { Pool, neonConfig } = require('@neondatabase/serverless');
    neonConfig.webSocketConstructor = require('ws');
    return new Pool({ connectionString: databaseUrl, max, idleTimeoutMillis: 30000 });
  }
  const { Pool } = require('pg');
  const u = new URL(databaseUrl);
  const local = /^(localhost|127\.0\.0\.1)$/.test(u.hostname) || u.searchParams.get('sslmode') === 'disable';
  // TLS is configured explicitly below, so drop libpq-only params that pg would reinterpret.
  for (const k of ['sslmode', 'channel_binding', 'uselibpqcompat']) u.searchParams.delete(k);
  return new Pool({
    connectionString: u.toString(),
    max,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    ssl: local ? undefined : { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED === '1' },
  });
}

function createPgStore({ databaseUrl }) {
  const pool = makePool(databaseUrl);
  pool.on('error', (e) => console.error('[pg] idle client error', e.message));
  const q = (text, params) => pool.query(text, params);
  const userRow = (r) => r && ({ id: r.id, username: r.username, passwordHash: r.password_hash, createdAt: Number(r.created_at) });
  return {
    kind: 'postgres',
    /** Raw query hook for maintenance scripts and integration tests. */
    _query: q,
    async init() {
      const c = await pool.connect();
      try {
        await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at BIGINT NOT NULL)');
        const { rows } = await c.query('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations');
        const current = Number(rows[0].v);
        for (let v = current + 1; v <= MIGRATIONS.length; v++) {
          await c.query('BEGIN');
          try {
            // Several instances may boot at once: serialize migrators (transaction-scoped lock works
            // through PgBouncer) and skip a version another instance applied meanwhile.
            await c.query('SELECT pg_advisory_xact_lock(727274001)');
            const done = await c.query('SELECT 1 FROM schema_migrations WHERE version = $1', [v]);
            if (done.rowCount) { await c.query('COMMIT'); continue; }
            await c.query(MIGRATIONS[v - 1]);
            await c.query('INSERT INTO schema_migrations(version, applied_at) VALUES ($1, $2)', [v, Date.now()]);
            await c.query('COMMIT');
            console.log(`[pg] applied migration v${v}`);
          } catch (e) { await c.query('ROLLBACK'); throw e; }
        }
      } finally { c.release(); }
    },
    async close() { await pool.end(); },
    async getUser(key) {
      const { rows } = await q('SELECT * FROM users WHERE username_lower = $1', [String(key).toLowerCase()]);
      return userRow(rows[0]) || null;
    },
    async getUserById(id) {
      const { rows } = await q('SELECT * FROM users WHERE id = $1', [id]);
      return userRow(rows[0]) || null;
    },
    async createUser(row) {
      const r = await q(
        `INSERT INTO users(id, username, username_lower, password_hash, created_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (username_lower) DO NOTHING`,
        [row.id, row.username, row.username.toLowerCase(), row.passwordHash, row.createdAt],
      );
      return r.rowCount ? { ok: true } : { error: 'exists' };
    },
    async recordSession({ userId, jti, expiresAt }) {
      await q('INSERT INTO sessions(jti, user_id, created_at, expires_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [jti, userId, Date.now(), expiresAt]);
      await q('DELETE FROM sessions WHERE expires_at < $1', [Date.now()]);
    },
    async loadWorlds() {
      const { rows } = await q('SELECT * FROM worlds');
      return rows.map((r) => rowToWorld({
        name: r.name, seed: r.seed, grid: r.grid, spawn: r.spawn, lockOwnerId: r.lock_owner_id,
        lockOwnerName: r.lock_owner_name, access: r.access, createdBy: r.created_by, createdAt: r.created_at,
      }));
    },
    async saveWorld(w) {
      const r = worldRow(w);
      await q(
        `INSERT INTO worlds(name, seed, grid, spawn, lock_owner_id, lock_owner_name, access, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (name) DO UPDATE SET grid=EXCLUDED.grid, spawn=EXCLUDED.spawn,
           lock_owner_id=EXCLUDED.lock_owner_id, lock_owner_name=EXCLUDED.lock_owner_name,
           access=EXCLUDED.access, updated_at=EXCLUDED.updated_at`,
        [r.name, r.seed, r.grid, JSON.stringify(r.spawn), r.lockOwnerId, r.lockOwnerName,
          JSON.stringify(r.access), r.createdBy, r.createdAt, r.updatedAt],
      );
    },
    async getProfile(userId) {
      const { rows } = await q('SELECT data FROM profiles WHERE user_id = $1', [userId]);
      return rows[0] ? rows[0].data : null;
    },
    /**
     * Upsert a profile only if `rev` (when the server received that data) is newer than the stored
     * one, so a late save from an old/kicked connection can never overwrite newer progress.
     * Returns false when the write was rejected as stale.
     */
    async saveProfile(userId, data, rev = Date.now()) {
      const r = await q(
        `INSERT INTO profiles(user_id, data, updated_at, rev) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at, rev=EXCLUDED.rev
         WHERE profiles.rev < EXCLUDED.rev`,
        [userId, JSON.stringify(data), Date.now(), Number(rev) || Date.now()],
      );
      return r.rowCount === 1;
    },
    async logTrade(e) {
      await q('INSERT INTO trades(a_id, b_id, world, offer_a, offer_b, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [e.a, e.b, e.world || null, JSON.stringify(e.offerA || {}), JSON.stringify(e.offerB || {}), Date.now()]);
    },

    // ------------------------------------------------ multi-instance world sync (v2)
    async loadWorld(name) {
      const { rows } = await q('SELECT * FROM worlds WHERE name = $1', [name]);
      const r = rows[0];
      if (!r) return null;
      return {
        ...rowToWorld({
          name: r.name, seed: r.seed, grid: r.grid, spawn: r.spawn, lockOwnerId: r.lock_owner_id,
          lockOwnerName: r.lock_owner_name, access: r.access, createdBy: r.created_by, createdAt: r.created_at,
        }),
        snapshotSeq: Number(r.snapshot_seq) || 0, headSeq: Number(r.head_seq) || 0,
      };
    },
    /** Insert a freshly generated world unless another instance created it first; returns the stored one. */
    async createWorldIfAbsent(w) {
      const r = worldRow(w);
      const ins = await q(
        `INSERT INTO worlds(name, seed, grid, spawn, lock_owner_id, lock_owner_name, access, created_by, created_at, updated_at, head_seq, snapshot_seq)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,0) ON CONFLICT (name) DO NOTHING`,
        [r.name, r.seed, r.grid, JSON.stringify(r.spawn), r.lockOwnerId, r.lockOwnerName,
          JSON.stringify(r.access), r.createdBy, r.createdAt, r.updatedAt],
      );
      return { created: ins.rowCount === 1, world: await this.loadWorld(r.name) };
    },
    /**
     * Append one event with the next per-world seq, in ONE statement: the UPDATE row-locks the
     * world until commit, so seqs are gapless and commit in seq order (no BIGSERIAL reordering).
     * Returns null if the world row does not exist.
     */
    async appendEvent(worldName, ev, instanceId) {
      const { rows } = await q(
        `WITH s AS (UPDATE worlds SET head_seq = head_seq + 1 WHERE name = $1 RETURNING head_seq)
         INSERT INTO world_events(world, seq, kind, actor_id, actor_name, to_id, data, instance_id, created_at)
         SELECT $1, s.head_seq, $2, $3, $4, $5, $6, $7, $8 FROM s
         RETURNING seq, kind, actor_id, actor_name, to_id, data, instance_id, created_at`,
        [worldName, String(ev.kind), ev.actorId ?? null, ev.actorName ?? null, ev.toId ?? null,
          JSON.stringify(eventPayload(ev)), instanceId || null, Date.now()],
      );
      const r = rows[0];
      return r ? toEvent({ seq: r.seq, kind: r.kind, actorId: r.actor_id, actorName: r.actor_name, toId: r.to_id,
        data: r.data, instanceId: r.instance_id, createdAt: r.created_at }) : null;
    },
    async fetchEvents(worldName, afterSeq = 0, limit = 500) {
      const { rows } = await q(
        `SELECT seq, kind, actor_id, actor_name, to_id, data, instance_id, created_at FROM world_events
         WHERE world = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
        [worldName, Number(afterSeq) || 0, clampLimit(limit)],
      );
      return rows.map((r) => toEvent({ seq: r.seq, kind: r.kind, actorId: r.actor_id, actorName: r.actor_name,
        toId: r.to_id, data: r.data, instanceId: r.instance_id, createdAt: r.created_at }));
    },
    /** Write grid/meta as of `seq` only if it is newer than the stored snapshot (and not ahead of the log). */
    async saveSnapshotIfNewer(w, seq) {
      const r = worldRow(w);
      const res = await q(
        `UPDATE worlds SET grid=$2, spawn=$3, lock_owner_id=$4, lock_owner_name=$5, access=$6, updated_at=$7, snapshot_seq=$8
         WHERE name=$1 AND snapshot_seq < $8 AND $8 <= head_seq`,
        [r.name, r.grid, JSON.stringify(r.spawn), r.lockOwnerId, r.lockOwnerName, JSON.stringify(r.access), r.updatedAt, Number(seq) || 0],
      );
      return res.rowCount === 1;
    },
    async upsertPresence(worldName, instanceId, players) {
      await q(
        `INSERT INTO world_presence(world, instance_id, players, updated_at) VALUES ($1,$2,$3,$4)
         ON CONFLICT (world, instance_id) DO UPDATE SET players=EXCLUDED.players, updated_at=EXCLUDED.updated_at`,
        [worldName, instanceId, JSON.stringify(players || []), Date.now()],
      );
    },
    async fetchPresence(worldNames, { maxAgeMs = 5000, excludeInstance = null } = {}) {
      if (!worldNames || !worldNames.length) return [];
      const { rows } = await q(
        `SELECT world, instance_id, players, updated_at FROM world_presence
         WHERE world = ANY($1::text[]) AND updated_at >= $2 AND ($3::text IS NULL OR instance_id <> $3)`,
        [worldNames, Date.now() - maxAgeMs, excludeInstance],
      );
      return rows.map((r) => ({ world: r.world, instanceId: r.instance_id, players: r.players || [], updatedAt: Number(r.updated_at) }));
    },
    async deletePresence(worldName, instanceId) {
      await q('DELETE FROM world_presence WHERE world = $1 AND instance_id = $2', [worldName, instanceId]);
    },
    async deleteStalePresence(maxAgeMs = 30000) {
      const r = await q('DELETE FROM world_presence WHERE updated_at < $1', [Date.now() - maxAgeMs]);
      return r.rowCount;
    },
    /** One round trip for the sync loop: head/snapshot seqs + new events for every active world. */
    async fetchEventsMulti(cursors, limit = 500) {
      const heads = {}; const out = {};
      if (!cursors || !cursors.length) return { heads, events: out };
      const { rows } = await q(
        `SELECT w.name, w.head_seq, w.snapshot_seq, e.seq, e.kind, e.actor_id, e.actor_name, e.to_id, e.data, e.instance_id, e.created_at
         FROM unnest($1::text[], $2::bigint[]) AS c(world, after)
         JOIN worlds w ON w.name = c.world
         LEFT JOIN LATERAL (
           SELECT * FROM world_events ev WHERE ev.world = c.world AND ev.seq > c.after ORDER BY ev.seq LIMIT $3
         ) e ON true
         ORDER BY w.name, e.seq`,
        [cursors.map((c) => c.world), cursors.map((c) => Number(c.after) || 0), clampLimit(limit)],
      );
      for (const r of rows) {
        heads[r.name] = { headSeq: Number(r.head_seq) || 0, snapshotSeq: Number(r.snapshot_seq) || 0 };
        if (!out[r.name]) out[r.name] = [];
        if (r.seq != null) {
          out[r.name].push(toEvent({ seq: r.seq, kind: r.kind, actorId: r.actor_id, actorName: r.actor_name, toId: r.to_id,
            data: r.data, instanceId: r.instance_id, createdAt: r.created_at }));
        }
      }
      return { heads, events: out };
    },
    async listWorldSummaries({ presenceMaxAgeMs = 5000 } = {}) {
      const { rows } = await q(
        `SELECT w.name, w.seed, w.lock_owner_id, w.lock_owner_name, w.access, COALESCE(p.n, 0)::int AS players
         FROM worlds w LEFT JOIN (
           SELECT world, SUM(jsonb_array_length(players)) AS n FROM world_presence WHERE updated_at >= $1 GROUP BY world
         ) p ON p.world = w.name
         ORDER BY w.name LIMIT 500`,
        [Date.now() - presenceMaxAgeMs],
      );
      return rows.map((r) => ({ name: r.name, seed: Number(r.seed) >>> 0, locked: !!r.lock_owner_id, lockOwner: r.lock_owner_name || null,
        access: (Array.isArray(r.access) ? r.access : []).map((a) => a.username), players: r.players }));
    },
    /** Register this connection as the account's live one; returns the previous owner (to be kicked). */
    async claimSession(userId, connId, instanceId) {
      const { rows } = await q(
        `WITH prev AS (SELECT conn_id, instance_id FROM active_sessions WHERE user_id = $1),
         up AS (INSERT INTO active_sessions(user_id, conn_id, instance_id, updated_at) VALUES ($1,$2,$3,$4)
                ON CONFLICT (user_id) DO UPDATE SET conn_id=EXCLUDED.conn_id, instance_id=EXCLUDED.instance_id, updated_at=EXCLUDED.updated_at)
         SELECT conn_id, instance_id FROM prev`,
        [userId, connId, instanceId, Date.now()],
      );
      return rows[0] ? { prevConnId: rows[0].conn_id, prevInstanceId: rows[0].instance_id } : null;
    },
    async fetchSessionOwners(userIds) {
      if (!userIds || !userIds.length) return {};
      const { rows } = await q('SELECT user_id, conn_id FROM active_sessions WHERE user_id = ANY($1::text[])', [userIds]);
      const out = {};
      for (const r of rows) out[r.user_id] = r.conn_id;
      return out;
    },
    async releaseSession(userId, connId) {
      await q('DELETE FROM active_sessions WHERE user_id = $1 AND conn_id = $2', [userId, connId]);
    },
    // ---- trades shared across instances; every write is a single conditional statement (version check)
    async tradeExpire() {
      const now = Date.now();
      await q(
        `UPDATE trade_sessions SET status='cancelled', version=version+1, updated_at=$1
         WHERE (status='pending' AND updated_at < $2) OR (status='open' AND updated_at < $3)`,
        [now, now - TRADE_PENDING_TTL_MS, now - TRADE_OPEN_TTL_MS],
      );
    },
    async tradeGet(id) {
      const { rows } = await q('SELECT * FROM trade_sessions WHERE id = $1', [String(id)]);
      return tradeFromRow(rows[0]);
    },
    async tradeActiveFor(playerId) {
      const now = Date.now();
      const { rows } = await q(
        `SELECT * FROM trade_sessions WHERE (a_id = $1 OR b_id = $1)
           AND ((status='pending' AND updated_at >= $2) OR (status='open' AND updated_at >= $3))
         ORDER BY (status='open') DESC, updated_at DESC LIMIT 1`,
        [playerId, now - TRADE_PENDING_TTL_MS, now - TRADE_OPEN_TTL_MS],
      );
      return tradeFromRow(rows[0]);
    },
    /** Create a pending trade unless either player is already in an open one. Cancels the requester's older pending requests. */
    async tradeCreate(t) {
      const now = Date.now();
      await q(`UPDATE trade_sessions SET status='cancelled', version=version+1, updated_at=$2 WHERE status='pending' AND a_id=$1`, [t.a, now]);
      const { rows } = await q(
        `INSERT INTO trade_sessions(id, a_id, b_id, a_name, b_name, world, status, offers, ready, version, created_at, updated_at)
         SELECT $1,$2,$3,$4,$5,$6,'pending',$7,$8,0,$9,$9
         WHERE NOT EXISTS (SELECT 1 FROM trade_sessions WHERE status='open' AND updated_at >= $10
                           AND (a_id IN ($2,$3) OR b_id IN ($2,$3)))
         RETURNING *`,
        [t.id, t.a, t.b, t.aName || null, t.bName || null, t.worldName || null, JSON.stringify(t.offers || {}),
          JSON.stringify(t.ready || {}), now, now - TRADE_OPEN_TTL_MS],
      );
      return tradeFromRow(rows[0]);
    },
    /** Optimistic-concurrency update; returns the new row, or null if the version moved or the trade is finished. */
    async tradeUpdate(id, version, patch) {
      const { rows } = await q(
        `UPDATE trade_sessions SET status=COALESCE($3, status), b_name=COALESCE($4, b_name),
           offers=COALESCE($5::jsonb, offers), ready=COALESCE($6::jsonb, ready), version=version+1, updated_at=$7
         WHERE id=$1 AND version=$2 AND status IN ('pending','open') RETURNING *`,
        [String(id), version, patch.status ?? null, patch.bName ?? null,
          patch.offers ? JSON.stringify(patch.offers) : null, patch.ready ? JSON.stringify(patch.ready) : null, Date.now()],
      );
      return tradeFromRow(rows[0]);
    },
    /** Atomically mark an open, both-ready trade done. Exactly one caller can win. */
    async tradeComplete(id, version) {
      const { rows } = await q(
        `UPDATE trade_sessions SET status='done', version=version+1, updated_at=$3
         WHERE id=$1 AND version=$2 AND status='open'
           AND COALESCE((ready->>a_id)::boolean, false) AND COALESCE((ready->>b_id)::boolean, false)
         RETURNING *`,
        [String(id), version, Date.now()],
      );
      return tradeFromRow(rows[0]);
    },
    /** Drop events already folded into a snapshot and older than `olderThanMs` (late joiners replay from snapshot). */
    async cleanupEvents({ olderThanMs = 10 * 60 * 1000 } = {}) {
      const r = await q(
        `DELETE FROM world_events e USING worlds w
         WHERE e.world = w.name AND e.seq <= w.snapshot_seq AND e.created_at < $1`,
        [Date.now() - olderThanMs],
      );
      return r.rowCount;
    },
  };
}

function createStore({ dataDir, databaseUrl = process.env.DATABASE_URL } = {}) {
  if (databaseUrl) return createPgStore({ databaseUrl });
  return createFileStore({ dataDir });
}

module.exports = { createStore, gridToB64, b64ToGrid };
