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
    async getProfile(userId) { return readJson(PROFILES, {})[userId] || null; },
    async saveProfile(userId, data) {
      const all = readJson(PROFILES, {});
      all[userId] = { ...data, updatedAt: Date.now() };
      writeJson(PROFILES, all);
    },
    async logTrade(entry) { fs.appendFileSync(TRADES, JSON.stringify({ ...entry, ts: Date.now() }) + '\n'); },
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
    async init() {
      const c = await pool.connect();
      try {
        await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at BIGINT NOT NULL)');
        const { rows } = await c.query('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations');
        const current = Number(rows[0].v);
        for (let v = current + 1; v <= MIGRATIONS.length; v++) {
          await c.query('BEGIN');
          try {
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
    async saveProfile(userId, data) {
      await q(
        `INSERT INTO profiles(user_id, data, updated_at) VALUES ($1,$2,$3)
         ON CONFLICT (user_id) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at`,
        [userId, JSON.stringify(data), Date.now()],
      );
    },
    async logTrade(e) {
      await q('INSERT INTO trades(a_id, b_id, world, offer_a, offer_b, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [e.a, e.b, e.world || null, JSON.stringify(e.offerA || {}), JSON.stringify(e.offerB || {}), Date.now()]);
    },
  };
}

function createStore({ dataDir, databaseUrl = process.env.DATABASE_URL } = {}) {
  if (databaseUrl) return createPgStore({ databaseUrl });
  return createFileStore({ dataDir });
}

module.exports = { createStore, gridToB64, b64ToGrid };
