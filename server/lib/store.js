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
 *
 * Server-authoritative inventory (migrations v4–v6; used by index.js behind SERVER_INV=1):
 *   invGet(userId) -> {ver, gems, items:{id:n}} | null
 *   invEnsure(userId, {gems, items}, seededFrom) -> {created, state}   (creates once + ledger `seed:<userId>`, never overwrites)
 *   invApply(opId, userId, {items:{id:delta}, gems:delta}, reason)   (opId must contain userId as a ':' segment)
 *     -> {ok:true, dup, ver, gems, items} | {ok:false, error, ver?, gems?, items?}
 *     all-or-nothing; a repeated opId is not applied again (returns current state, dup:true).
 *   appendEventInv(worldName, ev, instanceId, {opId, userId, ops, reason})   (migration v5; SERVER_INV place)
 *     -> {ok:true, dup, event|null, state} | {ok:false, error, state} | null (world missing)
 *     ONE transaction: the inventory change and the world event append both happen or neither does.
 *     Insufficient items => nothing appended. A repeated opId => nothing applied/appended (dup:true).
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
    plants: (w.plants && typeof w.plants === 'object') ? w.plants : {},
    settings: (w.settings && typeof w.settings === 'object') ? w.settings : {},
    createdBy: w.createdBy || null, createdAt: Number(w.createdAt) || Date.now(), updatedAt: Date.now(),
  };
}
function rowToWorld(r) {
  return {
    name: r.name, seed: Number(r.seed) >>> 0, grid: b64ToGrid(r.grid), spawn: r.spawn || { x: 32, y: 10 },
    lockOwnerId: r.lockOwnerId || null, lockOwnerName: r.lockOwnerName || null,
    access: Array.isArray(r.access) ? r.access : [],
    plants: (r.plants && typeof r.plants === 'object') ? r.plants : {},
    settings: (r.settings && typeof r.settings === 'object') ? r.settings : {},
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

// ---------------------------------------------------------------- inventory ops (shared)
const rules = require('./rules');
const MAX_OP_ID_LEN = 200;
/**
 * Validate an inventory op: {items: {itemId: delta}, gems: delta}. Deltas are non-zero safe integers,
 * item ids must be known catalog items. Returns {ok, ops} with zero deltas dropped, or {ok:false, error}.
 */
function normalizeInvOps(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'bad_ops' };
  const items = {};
  const src = raw.items == null ? {} : raw.items;
  if (typeof src !== 'object' || Array.isArray(src)) return { ok: false, error: 'bad_ops' };
  for (const [k, v] of Object.entries(src)) {
    const id = Number(k); const d = Number(v);
    if (!Number.isInteger(id) || !rules.isKnownItem(id)) return { ok: false, error: 'bad_item' };
    if (!Number.isSafeInteger(d) || Math.abs(d) > rules.INV_ITEM_MAX) return { ok: false, error: 'bad_ops' };
    if (d !== 0) items[id] = d;
  }
  const gems = raw.gems == null ? 0 : Number(raw.gems);
  if (!Number.isSafeInteger(gems) || Math.abs(gems) > rules.INV_GEMS_MAX) return { ok: false, error: 'bad_ops' };
  return { ok: true, ops: { items, gems } };
}
/**
 * op_ids are global (inventory_ledger PK), so every op_id must carry the owning user id as one of its
 * ':'-separated segments (e.g. `drop:<world>:<seq>:<userId>`): two users can never collide on an op_id.
 * User ids are hex (see /auth/register), so they never contain ':'.
 */
function validOpId(opId, userId) {
  return typeof opId === 'string' && opId.length > 0 && opId.length <= MAX_OP_ID_LEN
    && typeof userId === 'string' && userId.length > 0 && opId.split(':').includes(userId);
}
/** Ledger op_id of the one-time wallet seed. */
const seedOpId = (userId) => `seed:${userId}`;
/** Sanitize a seed inventory for invEnsure (step 2 will decide what to trust from old profiles). */
function normalizeSeed(seed) {
  const items = {};
  for (const [k, v] of Object.entries((seed && seed.items) || {})) {
    const id = Number(k); const n = Number(v);
    if (Number.isInteger(id) && rules.isKnownItem(id) && Number.isSafeInteger(n) && n > 0) items[id] = Math.min(n, rules.INV_ITEM_MAX);
  }
  const g = Number(seed && seed.gems);
  return { items, gems: Number.isSafeInteger(g) && g > 0 ? Math.min(g, rules.INV_GEMS_MAX) : 0 };
}
function invStateFromJson(j) {
  if (!j) return null;
  const items = {};
  for (const [k, v] of Object.entries(j.items || {})) if (Number(v) > 0) items[k] = Number(v);
  return { ver: Number(j.ver) || 0, gems: Number(j.gems) || 0, items };
}

// ---------------------------------------------------------------- file store
function createFileStore({ dataDir }) {
  const social = { friends: new Set(), pms: [], pmSeq: 0 };
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
  const INVENTORY = path.join(dataDir, 'inventory.json');
  // {wallets: {userId: {ver, gems, items, seededFrom, createdAt}}, ledger: {opId: {userId, reason, delta, createdAt}}}
  // Single process + synchronous read-modify-write, so each op is trivially atomic.
  const readInv = () => { const d = readJson(INVENTORY, {}); return { ...d, wallets: d.wallets || {}, ledger: d.ledger || {} }; };
  const pubInv = (w) => (w ? invStateFromJson(w) : null);
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
    async appendEventInv(worldName, ev, instanceId, inv) {
      if (!readWorld(worldName)) return null;
      const r = await this.invApply(inv.opId, inv.userId, inv.ops, inv.reason); // synchronous inside: no interleaving
      const state = invStateFromJson(r.ver === undefined ? null : r);
      if (!r.ok) return { ok: false, error: r.error, state };
      if (r.dup) return { ok: true, dup: true, event: null, state };
      const event = await this.appendEvent(worldName, ev, instanceId);
      return { ok: true, dup: false, event, state };
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
    async invGet(userId) { return pubInv(readInv().wallets[userId]); },
    async invEnsure(userId, seed, seededFrom = 'starter') {
      const d = readInv();
      if (d.wallets[userId]) return { created: false, state: pubInv(d.wallets[userId]) };
      const s0 = normalizeSeed(seed);
      d.wallets[userId] = { ver: 1, gems: s0.gems, items: s0.items, seededFrom: String(seededFrom || ''), createdAt: Date.now() };
      d.ledger[seedOpId(userId)] = { userId, reason: `seed:${String(seededFrom || '')}`, delta: s0, createdAt: Date.now() };
      writeJson(INVENTORY, d);
      return { created: true, state: pubInv(d.wallets[userId]) };
    },
    async invApply(opId, userId, rawOps, reason = '') {
      if (!validOpId(opId, userId)) return { ok: false, error: 'bad_op_id' };
      const norm = normalizeInvOps(rawOps);
      if (!norm.ok) return norm;
      const d = readInv();
      const w = d.wallets[userId];
      if (!w) return { ok: false, error: 'no_wallet' };
      if (d.ledger[opId]) return { ok: true, dup: true, ...pubInv(w) };
      const { items, gems } = norm.ops;
      const next = { ...w.items };
      for (const id of Object.keys(items).sort((a, b) => a - b)) {
        const n = (Number(next[id]) || 0) + items[id];
        if (n < 0) return { ok: false, error: `insufficient_item:${id}`, ...pubInv(w) };
        if (n > rules.INV_ITEM_MAX) return { ok: false, error: `cap_item:${id}`, ...pubInv(w) };
        if (n === 0) delete next[id]; else next[id] = n;
      }
      const g = w.gems + gems;
      if (g < 0) return { ok: false, error: 'insufficient_gems', ...pubInv(w) };
      if (g > rules.INV_GEMS_MAX) return { ok: false, error: 'cap_gems', ...pubInv(w) };
      d.wallets[userId] = { ...w, items: next, gems: g, ver: w.ver + 1 };
      d.ledger[opId] = { userId, reason: String(reason || ''), delta: norm.ops, createdAt: Date.now() };
      writeJson(INVENTORY, d);
      return { ok: true, dup: false, ...pubInv(d.wallets[userId]) };
    },
    async invProgress(userId, reason) {
      const { ledger } = readInv();
      let n = 0;
      for (const e of Object.values(ledger)) {
        if (e.userId !== userId) continue;
        if (e.reason === reason) n++; else if (e.reason === `refund_${reason}`) n--;
      }
      return Math.max(0, n);
    },
    async questClaimed(userId) {
      return Object.keys((readInv().questClaims || {})[userId] || {});
    },
    async questClaim(userId, qid, { countReason, goal, opId, ops }) {
      if (!validOpId(opId, userId)) return { ok: false, error: 'bad_op_id' };
      const d0 = readInv();
      if (!d0.wallets[userId]) return { ok: false, error: 'no_wallet' };
      const state0 = pubInv(d0.wallets[userId]);
      if (((d0.questClaims || {})[userId] || {})[qid]) return { ok: false, error: 'already_claimed', state: state0 };
      const progress = await this.invProgress(userId, countReason);
      if (progress < goal) return { ok: false, error: 'not_complete', progress, state: state0 };
      const r = await this.invApply(opId, userId, ops, 'quest');
      if (!r.ok) return { ok: false, error: r.error, state: invStateFromJson(r.ver === undefined ? null : r) };
      const d = readInv();
      d.questClaims = d.questClaims || {};
      d.questClaims[userId] = { ...(d.questClaims[userId] || {}), [qid]: Date.now() };
      writeJson(INVENTORY, d);
      return { ok: true, progress, state: invStateFromJson(r) };
    },
    // v1.8 social / daily (file store: in memory, local dev only)
    async ledgerByReason(userId, reason, sinceMs) {
      return Object.entries(readInv().ledger || {}).filter(([, e]) => e.userId === userId && e.reason === reason && (e.createdAt || 0) >= sinceMs)
        .map(([opId, e]) => ({ opId, createdAt: e.createdAt || 0 }));
    },
    async invProgressSince(userId, reason, sinceMs) {
      let n = 0;
      for (const e of Object.values(readInv().ledger || {})) {
        if (e.userId !== userId || (e.createdAt || 0) < sinceMs) continue;
        if (e.reason === reason) n++; else if (e.reason === `refund_${reason}`) n--;
      }
      return Math.max(0, n);
    },
    async questClaimedLike(userId, prefix) { return (await this.questClaimed(userId)).filter((x) => x.startsWith(prefix)); },
    async questClaimSince(userId, qid, { countReason, goal, since, opId, ops }) {
      if ((await this.questClaimed(userId)).includes(qid)) return { ok: false, error: 'already_claimed', state: await this.invGet(userId) };
      const progress = await this.invProgressSince(userId, countReason, since);
      if (progress < goal) return { ok: false, error: 'not_complete', progress, state: await this.invGet(userId) };
      const r = await this.invApply(opId, userId, ops, 'daily_quest');
      if (!r.ok) return { ok: false, error: r.error, state: invStateFromJson(r.ver === undefined ? null : r) };
      const d = readInv(); d.questClaims = d.questClaims || {};
      d.questClaims[userId] = { ...(d.questClaims[userId] || {}), [qid]: Date.now() }; writeJson(INVENTORY, d);
      return { ok: true, progress, state: invStateFromJson(r) };
    },
    async leaderboard(limit = 20) {
      const users = readJson(USERS, {}); const w = readInv().wallets || {};
      return Object.values(users).map((u) => ({ username: u.username, gems: Number((w[u.id] || {}).gems) || 0 }))
        .sort((a, b) => b.gems - a.gems).slice(0, limit);
    },
    async gemsRank() { return null; },
    async getUserById(id) { return Object.values(readJson(USERS, {})).find((u) => u.id === id) || null; },
    async friendAdd(userId, friendId) { social.friends.add(`${userId}>${friendId}`); return true; },
    async friendRemove(userId, friendId) { social.friends.delete(`${userId}>${friendId}`); social.friends.delete(`${friendId}>${userId}`); },
    async friendList(userId) {
      const out = { friends: [], incoming: [], outgoing: [] }; const seen = new Set();
      for (const k of social.friends) {
        const [a, b] = k.split('>'); const other = a === userId ? b : b === userId ? a : null;
        if (!other || seen.has(other)) continue; seen.add(other);
        const u = await this.getUserById(other); const e = { id: other, username: u ? u.username : other };
        const mine = social.friends.has(`${userId}>${other}`), theirs = social.friends.has(`${other}>${userId}`);
        (mine && theirs ? out.friends : mine ? out.outgoing : out.incoming).push(e);
      }
      return out;
    },
    async areFriends(a, b) { return social.friends.has(`${a}>${b}`) && social.friends.has(`${b}>${a}`); },
    async pmSend(fromId, fromName, toId, text) { const m = { id: ++social.pmSeq, from: fromId, fromName, to: toId, text, ts: Date.now() }; social.pms.push(m); return { id: m.id, ts: m.ts }; },
    async pmThread(userId, otherId, limit = 50) {
      return social.pms.filter((m) => (m.from === userId && m.to === otherId) || (m.from === otherId && m.to === userId)).slice(-limit);
    },
    async pmMarkRead(userId, otherId) { for (const m of social.pms) if (m.to === userId && m.from === otherId) m.read = true; },
    async pmUnread(userId) {
      const by = {};
      for (const m of social.pms) if (m.to === userId && !m.read) { by[m.from] = by[m.from] || { from: m.from, fromName: m.fromName, n: 0, lastId: 0 }; by[m.from].n++; by[m.from].lastId = m.id; }
      return Object.values(by);
    },
    async pmSince(userIds, afterId) { return social.pms.filter((m) => m.id > afterId && userIds.includes(m.to)); },
    async pmMaxId() { return social.pmSeq; },
    async tradeSettle(id, version, opsA, opsB) {
      const t = tradesMem.get(String(id));
      if (!t || t.version !== version || t.status !== 'open' || !t.ready[t.a] || !t.ready[t.b]) return { ok: false, error: 'conflict' };
      const na = normalizeInvOps(opsA); const nb = normalizeInvOps(opsB);
      if (!na.ok || !nb.ok) return { ok: false, error: 'bad_ops' };
      // Dry run both sides first (single process, no awaits between check and write): all or nothing.
      const d = readInv();
      const check = (uid, ops) => {
        const w = d.wallets[uid];
        if (!w) return 'no_wallet';
        for (const [k, v] of Object.entries(ops.items)) {
          const n = (Number(w.items[k]) || 0) + v;
          if (n < 0) return `insufficient_item:${k}`;
          if (n > rules.INV_ITEM_MAX) return `cap_item:${k}`;
        }
        const g = w.gems + ops.gems;
        if (g < 0) return 'insufficient_gems';
        if (g > rules.INV_GEMS_MAX) return 'cap_gems';
        return null;
      };
      const ea = check(t.a, na.ops); const eb = ea ? null : check(t.b, nb.ops);
      if (ea || eb) return { ok: false, side: ea ? 'a' : 'b', error: ea || eb, invA: pubInv(d.wallets[t.a]), invB: pubInv(d.wallets[t.b]) };
      const ra = await this.invApply(`trade:${t.a}:${id}`, t.a, na.ops, 'trade');
      const rb = await this.invApply(`trade:${t.b}:${id}`, t.b, nb.ops, 'trade');
      Object.assign(t, { status: 'done', version: t.version + 1, updatedAt: Date.now() });
      return { ok: true, trade: JSON.parse(JSON.stringify(t)), invA: invStateFromJson(ra), invB: invStateFromJson(rb) };
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
  // v4 — server-authoritative inventory. One total per (user, item) (stack/slot layout stays a client
  // concern), a wallet row per user that also serializes that user's ops (row lock) and carries `ver`,
  // an idempotency/audit ledger keyed by op_id, and one-time quest claims. inv_apply() is the only
  // writer: all-or-nothing, idempotent on op_id. Additive + idempotent; nothing reads it yet.
  `CREATE TABLE IF NOT EXISTS wallets (
     user_id TEXT PRIMARY KEY,
     gems BIGINT NOT NULL DEFAULT 0 CHECK (gems >= 0),
     ver BIGINT NOT NULL DEFAULT 0,
     seeded_from TEXT,
     created_at BIGINT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS inventory_items (
     user_id TEXT NOT NULL,
     item_id INT NOT NULL,
     n INT NOT NULL CHECK (n >= 0),
     PRIMARY KEY (user_id, item_id)
   );
   CREATE TABLE IF NOT EXISTS inventory_ledger (
     op_id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     reason TEXT,
     delta JSONB NOT NULL,
     created_at BIGINT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS inventory_ledger_user_idx ON inventory_ledger(user_id, created_at);
   CREATE TABLE IF NOT EXISTS quest_claims (
     user_id TEXT NOT NULL,
     qid TEXT NOT NULL,
     claimed_at BIGINT NOT NULL,
     PRIMARY KEY (user_id, qid)
   );
   CREATE OR REPLACE FUNCTION inv_state(p_user TEXT) RETURNS JSONB LANGUAGE sql STABLE AS $fn$
     SELECT jsonb_build_object('ver', w.ver, 'gems', w.gems, 'items',
       COALESCE((SELECT jsonb_object_agg(i.item_id::text, i.n) FROM inventory_items i
                 WHERE i.user_id = w.user_id AND i.n > 0), '{}'::jsonb))
     FROM wallets w WHERE w.user_id = p_user
   $fn$;
   CREATE OR REPLACE FUNCTION inv_apply(p_op_id TEXT, p_user TEXT, p_ops JSONB, p_reason TEXT,
       p_now BIGINT, p_item_max INT, p_gems_max BIGINT) RETURNS JSONB LANGUAGE plpgsql AS $fn$
   DECLARE
     v_gems BIGINT;
     v_dgems BIGINT := COALESCE((p_ops->>'gems')::BIGINT, 0);
     r RECORD;
     v_n INT;
   BEGIN
     -- Lock the wallet first: serializes every op of this user (and fails fast without a wallet).
     SELECT gems INTO v_gems FROM wallets WHERE user_id = p_user FOR UPDATE;
     IF NOT FOUND THEN
       RETURN jsonb_build_object('ok', false, 'error', 'no_wallet');
     END IF;
     IF EXISTS (SELECT 1 FROM inventory_ledger WHERE op_id = p_op_id) THEN
       RETURN jsonb_build_object('ok', true, 'dup', true) || inv_state(p_user);
     END IF;
     BEGIN  -- subtransaction: any RAISE below undoes every write of this op
       INSERT INTO inventory_ledger(op_id, user_id, reason, delta, created_at)
         VALUES (p_op_id, p_user, p_reason, p_ops, p_now);
       FOR r IN SELECT key::INT AS item_id, value::TEXT::INT AS d
                FROM jsonb_each(COALESCE(p_ops->'items', '{}'::jsonb)) ORDER BY 1 LOOP
         IF r.d < 0 THEN
           UPDATE inventory_items SET n = n + r.d
             WHERE user_id = p_user AND item_id = r.item_id AND n + r.d >= 0;
           IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_item:%', r.item_id USING ERRCODE = 'P0001'; END IF;
         ELSIF r.d > 0 THEN
           INSERT INTO inventory_items(user_id, item_id, n) VALUES (p_user, r.item_id, r.d)
             ON CONFLICT (user_id, item_id) DO UPDATE SET n = inventory_items.n + EXCLUDED.n
             RETURNING n INTO v_n;
           IF v_n > p_item_max THEN RAISE EXCEPTION 'cap_item:%', r.item_id USING ERRCODE = 'P0001'; END IF;
         END IF;
       END LOOP;
       DELETE FROM inventory_items WHERE user_id = p_user AND n = 0;
       IF v_gems + v_dgems < 0 THEN RAISE EXCEPTION 'insufficient_gems' USING ERRCODE = 'P0001'; END IF;
       IF v_gems + v_dgems > p_gems_max THEN RAISE EXCEPTION 'cap_gems' USING ERRCODE = 'P0001'; END IF;
       UPDATE wallets SET gems = gems + v_dgems, ver = ver + 1 WHERE user_id = p_user;
     EXCEPTION WHEN raise_exception THEN
       RETURN jsonb_build_object('ok', false, 'error', SQLERRM) || inv_state(p_user);
     WHEN unique_violation THEN
       -- same op_id committed concurrently by another session (after our EXISTS check)
       RETURN jsonb_build_object('ok', true, 'dup', true) || inv_state(p_user);
     END;
     RETURN jsonb_build_object('ok', true, 'dup', false) || inv_state(p_user);
   END
   $fn$;`,
  // v5 — append a world event and apply an inventory change in ONE transaction (SERVER_INV place cost).
  // Lock order is always world row -> wallet row (appendEvent only locks the world, inv_apply only the
  // wallet), so no deadlock. Additive + idempotent (CREATE OR REPLACE).
  `CREATE OR REPLACE FUNCTION append_event_inv(
     p_world TEXT, p_kind TEXT, p_actor_id TEXT, p_actor_name TEXT, p_to_id TEXT, p_data JSONB,
     p_instance TEXT, p_now BIGINT, p_op_id TEXT, p_user TEXT, p_ops JSONB, p_reason TEXT,
     p_item_max INT, p_gems_max BIGINT)
   RETURNS JSONB LANGUAGE plpgsql AS $fn$
   DECLARE
     v_inv JSONB;
     v_seq BIGINT;
   BEGIN
     PERFORM 1 FROM worlds WHERE name = p_world FOR UPDATE;
     IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'no_world'); END IF;
     v_inv := inv_apply(p_op_id, p_user, p_ops, p_reason, p_now, p_item_max, p_gems_max);
     IF NOT COALESCE((v_inv->>'ok')::BOOLEAN, false) THEN
       RETURN jsonb_build_object('ok', false, 'error', v_inv->>'error', 'inv', v_inv);
     END IF;
     IF COALESCE((v_inv->>'dup')::BOOLEAN, false) THEN
       RETURN jsonb_build_object('ok', true, 'dup', true, 'inv', v_inv);
     END IF;
     UPDATE worlds SET head_seq = head_seq + 1 WHERE name = p_world RETURNING head_seq INTO v_seq;
     INSERT INTO world_events(world, seq, kind, actor_id, actor_name, to_id, data, instance_id, created_at)
       VALUES (p_world, v_seq, p_kind, p_actor_id, p_actor_name, p_to_id, COALESCE(p_data, '{}'::jsonb), p_instance, p_now);
     RETURN jsonb_build_object('ok', true, 'dup', false, 'inv', v_inv, 'seq', v_seq);
   END
   $fn$;`,
  // v6 — server inventory steps 4-6: plant ready times in world snapshots, atomic quest claims and trade
  // settlement. Additive + idempotent (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE).
  // Lock order everywhere: trade row -> wallets in user_id order (inv_apply re-locking an already locked
  // wallet is a no-op), so no deadlocks with append_event_inv (world -> one wallet).
  `ALTER TABLE worlds ADD COLUMN IF NOT EXISTS plants JSONB NOT NULL DEFAULT '{}'::jsonb;
   CREATE OR REPLACE FUNCTION inv_progress(p_user TEXT, p_reason TEXT) RETURNS INT LANGUAGE sql STABLE AS $fn$
     SELECT GREATEST(0,
       (SELECT count(*) FROM inventory_ledger WHERE user_id = p_user AND reason = p_reason)
       - (SELECT count(*) FROM inventory_ledger WHERE user_id = p_user AND reason = 'refund_' || p_reason))::INT
   $fn$;
   CREATE OR REPLACE FUNCTION quest_claim(p_user TEXT, p_qid TEXT, p_count_reason TEXT, p_goal INT, p_op_id TEXT,
       p_ops JSONB, p_now BIGINT, p_item_max INT, p_gems_max BIGINT) RETURNS JSONB LANGUAGE plpgsql AS $fn$
   DECLARE
     v_n INT;
     v_inv JSONB;
   BEGIN
     PERFORM 1 FROM wallets WHERE user_id = p_user FOR UPDATE;
     IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'no_wallet'); END IF;
     IF EXISTS (SELECT 1 FROM quest_claims WHERE user_id = p_user AND qid = p_qid) THEN
       RETURN jsonb_build_object('ok', false, 'error', 'already_claimed', 'inv', inv_state(p_user));
     END IF;
     v_n := inv_progress(p_user, p_count_reason);
     IF v_n < p_goal THEN
       RETURN jsonb_build_object('ok', false, 'error', 'not_complete', 'progress', v_n, 'inv', inv_state(p_user));
     END IF;
     v_inv := inv_apply(p_op_id, p_user, p_ops, 'quest', p_now, p_item_max, p_gems_max);
     IF NOT COALESCE((v_inv->>'ok')::BOOLEAN, false) THEN
       RETURN jsonb_build_object('ok', false, 'error', v_inv->>'error', 'inv', v_inv);
     END IF;
     INSERT INTO quest_claims(user_id, qid, claimed_at) VALUES (p_user, p_qid, p_now) ON CONFLICT DO NOTHING;
     RETURN jsonb_build_object('ok', true, 'progress', v_n, 'inv', v_inv);
   END
   $fn$;
   CREATE OR REPLACE FUNCTION trade_settle(p_id TEXT, p_version INT, p_op_a TEXT, p_op_b TEXT, p_ops_a JSONB, p_ops_b JSONB,
       p_now BIGINT, p_item_max INT, p_gems_max BIGINT) RETURNS JSONB LANGUAGE plpgsql AS $fn$
   DECLARE
     t trade_sessions%ROWTYPE;
     ra JSONB;
     rb JSONB;
     v_err TEXT;
   BEGIN
     SELECT * INTO t FROM trade_sessions WHERE id = p_id FOR UPDATE;
     IF NOT FOUND OR t.version <> p_version OR t.status <> 'open'
        OR NOT COALESCE((t.ready->>t.a_id)::boolean, false) OR NOT COALESCE((t.ready->>t.b_id)::boolean, false) THEN
       RETURN jsonb_build_object('ok', false, 'error', 'conflict');
     END IF;
     PERFORM 1 FROM wallets WHERE user_id IN (t.a_id, t.b_id) ORDER BY user_id FOR UPDATE;
     BEGIN  -- subtransaction: if either side fails, neither wallet nor the trade row changes
       ra := inv_apply(p_op_a, t.a_id, p_ops_a, 'trade', p_now, p_item_max, p_gems_max);
       IF NOT COALESCE((ra->>'ok')::BOOLEAN, false) THEN RAISE EXCEPTION 'a|%', ra->>'error' USING ERRCODE = 'P0001'; END IF;
       rb := inv_apply(p_op_b, t.b_id, p_ops_b, 'trade', p_now, p_item_max, p_gems_max);
       IF NOT COALESCE((rb->>'ok')::BOOLEAN, false) THEN RAISE EXCEPTION 'b|%', rb->>'error' USING ERRCODE = 'P0001'; END IF;
       UPDATE trade_sessions SET status = 'done', version = version + 1, updated_at = p_now WHERE id = p_id RETURNING * INTO t;
     EXCEPTION WHEN raise_exception THEN
       v_err := SQLERRM;
       RETURN jsonb_build_object('ok', false, 'side', split_part(v_err, '|', 1), 'error', split_part(v_err, '|', 2),
         'invA', inv_state(t.a_id), 'invB', inv_state(t.b_id));
     END;
     RETURN jsonb_build_object('ok', true, 'trade', to_jsonb(t), 'invA', ra, 'invB', rb);
   END
   $fn$;`,
  // v7 — v1.8: world settings, friends, private messages, per-day quest progress. Additive + idempotent.
  `ALTER TABLE worlds ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;
   CREATE TABLE IF NOT EXISTS friends (
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at BIGINT NOT NULL,
     PRIMARY KEY (user_id, friend_id)
   );
   CREATE INDEX IF NOT EXISTS friends_friend_idx ON friends(friend_id);
   CREATE TABLE IF NOT EXISTS private_messages (
     id BIGSERIAL PRIMARY KEY,
     from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     from_name TEXT NOT NULL,
     to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     text TEXT NOT NULL,
     created_at BIGINT NOT NULL,
     read_at BIGINT
   );
   CREATE INDEX IF NOT EXISTS pm_to_idx ON private_messages(to_id, id);
   CREATE INDEX IF NOT EXISTS pm_from_idx ON private_messages(from_id, id);
   CREATE INDEX IF NOT EXISTS inventory_ledger_reason_idx ON inventory_ledger(user_id, reason, created_at);
   CREATE OR REPLACE FUNCTION inv_progress_since(p_user TEXT, p_reason TEXT, p_since BIGINT) RETURNS INT LANGUAGE sql STABLE AS $fn$
     SELECT GREATEST(0,
       (SELECT count(*) FROM inventory_ledger WHERE user_id = p_user AND reason = p_reason AND created_at >= p_since)
       - (SELECT count(*) FROM inventory_ledger WHERE user_id = p_user AND reason = 'refund_' || p_reason AND created_at >= p_since))::INT
   $fn$;
   CREATE OR REPLACE FUNCTION quest_claim_since(p_user TEXT, p_qid TEXT, p_count_reason TEXT, p_goal INT, p_since BIGINT,
       p_op_id TEXT, p_ops JSONB, p_now BIGINT, p_item_max INT, p_gems_max BIGINT) RETURNS JSONB LANGUAGE plpgsql AS $fn$
   DECLARE
     v_n INT;
     v_inv JSONB;
   BEGIN
     PERFORM 1 FROM wallets WHERE user_id = p_user FOR UPDATE;
     IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'no_wallet'); END IF;
     IF EXISTS (SELECT 1 FROM quest_claims WHERE user_id = p_user AND qid = p_qid) THEN
       RETURN jsonb_build_object('ok', false, 'error', 'already_claimed', 'inv', inv_state(p_user));
     END IF;
     v_n := inv_progress_since(p_user, p_count_reason, p_since);
     IF v_n < p_goal THEN
       RETURN jsonb_build_object('ok', false, 'error', 'not_complete', 'progress', v_n, 'inv', inv_state(p_user));
     END IF;
     v_inv := inv_apply(p_op_id, p_user, p_ops, 'daily_quest', p_now, p_item_max, p_gems_max);
     IF NOT COALESCE((v_inv->>'ok')::BOOLEAN, false) THEN
       RETURN jsonb_build_object('ok', false, 'error', v_inv->>'error', 'inv', v_inv);
     END IF;
     INSERT INTO quest_claims(user_id, qid, claimed_at) VALUES (p_user, p_qid, p_now) ON CONFLICT DO NOTHING;
     RETURN jsonb_build_object('ok', true, 'progress', v_n, 'inv', v_inv);
   END
   $fn$;`,
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
        lockOwnerName: r.lock_owner_name, access: r.access, plants: r.plants, settings: r.settings, createdBy: r.created_by, createdAt: r.created_at,
      }));
    },
    async saveWorld(w) {
      const r = worldRow(w);
      await q(
        `INSERT INTO worlds(name, seed, grid, spawn, lock_owner_id, lock_owner_name, access, created_by, created_at, updated_at, plants, settings)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (name) DO UPDATE SET grid=EXCLUDED.grid, spawn=EXCLUDED.spawn,
           lock_owner_id=EXCLUDED.lock_owner_id, lock_owner_name=EXCLUDED.lock_owner_name,
           access=EXCLUDED.access, updated_at=EXCLUDED.updated_at, plants=EXCLUDED.plants, settings=EXCLUDED.settings`,
        [r.name, r.seed, r.grid, JSON.stringify(r.spawn), r.lockOwnerId, r.lockOwnerName,
          JSON.stringify(r.access), r.createdBy, r.createdAt, r.updatedAt, JSON.stringify(r.plants), JSON.stringify(r.settings)],
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
          lockOwnerName: r.lock_owner_name, access: r.access, plants: r.plants, settings: r.settings, createdBy: r.created_by, createdAt: r.created_at,
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
    /** World event + inventory change in one DB transaction (append_event_inv, migration v5). */
    async appendEventInv(worldName, ev, instanceId, inv) {
      if (!validOpId(inv.opId, inv.userId)) return { ok: false, error: 'bad_op_id', state: null };
      const norm = normalizeInvOps(inv.ops);
      if (!norm.ok) return { ok: false, error: norm.error, state: null };
      const now = Date.now();
      const data = eventPayload(ev);
      const { rows } = await q('SELECT append_event_inv($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb,$12,$13,$14) AS r',
        [worldName, String(ev.kind), ev.actorId ?? null, ev.actorName ?? null, ev.toId ?? null, JSON.stringify(data),
          instanceId || null, now, inv.opId, inv.userId, JSON.stringify(norm.ops), String(inv.reason || ''),
          rules.INV_ITEM_MAX, rules.INV_GEMS_MAX]);
      const r = rows[0].r || {};
      if (r.error === 'no_world') return null;
      const st = invStateFromJson(r.inv && r.inv.ver !== undefined ? r.inv : null);
      if (!r.ok) return { ok: false, error: r.error, state: st };
      if (r.dup) return { ok: true, dup: true, event: null, state: st };
      const event = toEvent({ seq: r.seq, kind: String(ev.kind), actorId: ev.actorId ?? null, actorName: ev.actorName ?? null,
        toId: ev.toId ?? null, data, instanceId: instanceId || null, createdAt: now });
      return { ok: true, dup: false, event, state: st };
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
        `UPDATE worlds SET grid=$2, spawn=$3, lock_owner_id=$4, lock_owner_name=$5, access=$6, updated_at=$7, snapshot_seq=$8, plants=$9,
           settings=$10
         WHERE name=$1 AND snapshot_seq < $8 AND $8 <= head_seq`,
        [r.name, r.grid, JSON.stringify(r.spawn), r.lockOwnerId, r.lockOwnerName, JSON.stringify(r.access), r.updatedAt, Number(seq) || 0,
          JSON.stringify(r.plants), JSON.stringify(r.settings)],
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
    // ------------------------------------------------ server-authoritative inventory (v4)
    async invGet(userId) {
      const { rows } = await q('SELECT inv_state($1) AS s', [userId]);
      return invStateFromJson(rows[0] && rows[0].s);
    },
    /** Create the wallet + items + `seed:<userId>` ledger row once (single statement); an existing wallet is never touched. */
    async invEnsure(userId, seed, seededFrom = 'starter') {
      const s0 = normalizeSeed(seed);
      const { rows } = await q(
        `WITH w AS (
           INSERT INTO wallets(user_id, gems, ver, seeded_from, created_at) VALUES ($1, $2, 1, $3, $4)
           ON CONFLICT (user_id) DO NOTHING RETURNING user_id),
         i AS (
           INSERT INTO inventory_items(user_id, item_id, n)
           SELECT w.user_id, e.key::INT, e.value::TEXT::INT FROM w, jsonb_each($5::jsonb) e
           RETURNING 1),
         l AS (
           INSERT INTO inventory_ledger(op_id, user_id, reason, delta, created_at)
           SELECT $6, w.user_id, 'seed:' || $3, $7::jsonb, $4 FROM w
           ON CONFLICT (op_id) DO NOTHING RETURNING 1)
         SELECT (SELECT count(*) FROM w) AS created, (SELECT count(*) FROM i) AS n_items, (SELECT count(*) FROM l) AS n_ledger`,
        [userId, s0.gems, String(seededFrom || ''), Date.now(), JSON.stringify(s0.items), seedOpId(userId), JSON.stringify(s0)],
      );
      return { created: Number(rows[0].created) === 1, state: await this.invGet(userId) };
    },
    /** All-or-nothing, idempotent inventory change; see inv_apply() in migration v4. */
    async invApply(opId, userId, rawOps, reason = '') {
      if (!validOpId(opId, userId)) return { ok: false, error: 'bad_op_id' };
      const norm = normalizeInvOps(rawOps);
      if (!norm.ok) return norm;
      const { rows } = await q('SELECT inv_apply($1, $2, $3::jsonb, $4, $5, $6, $7) AS r',
        [opId, userId, JSON.stringify(norm.ops), String(reason || ''), Date.now(), rules.INV_ITEM_MAX, rules.INV_GEMS_MAX]);
      const r = rows[0].r || {};
      const st = invStateFromJson(r.ver === undefined ? null : r);
      return { ok: !!r.ok, ...(r.ok ? { dup: !!r.dup } : { error: r.error }), ...(st || {}) };
    },
    /** Quest progress (ledger rows of `reason` minus their refunds) since the wallet was created. */
    async invProgress(userId, reason) {
      const { rows } = await q('SELECT inv_progress($1, $2) AS n', [userId, String(reason)]);
      return Number(rows[0].n) || 0;
    },
    async questClaimed(userId) {
      const { rows } = await q('SELECT qid FROM quest_claims WHERE user_id = $1', [userId]);
      return rows.map((r) => r.qid);
    },
    /** One-time quest reward: progress check + claim row + credit in one transaction (quest_claim, v6). */
    async questClaim(userId, qid, { countReason, goal, opId, ops }) {
      if (!validOpId(opId, userId)) return { ok: false, error: 'bad_op_id' };
      const norm = normalizeInvOps(ops);
      if (!norm.ok) return norm;
      const { rows } = await q('SELECT quest_claim($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) AS r',
        [userId, String(qid), String(countReason), Number(goal) | 0, opId, JSON.stringify(norm.ops), Date.now(), rules.INV_ITEM_MAX, rules.INV_GEMS_MAX]);
      const r = rows[0].r || {};
      const st = invStateFromJson(r.inv && r.inv.ver !== undefined ? r.inv : null);
      return { ok: !!r.ok, ...(r.ok ? {} : { error: r.error }), progress: r.progress == null ? undefined : Number(r.progress), state: st };
    },
    /**
     * Settle an open, both-ready trade atomically (trade_settle, v6): both wallet deltas + status 'done', or
     * nothing. opsA/opsB = {items, gems} deltas; op ids trade:<user>:<tradeId>.
     * Returns {ok, trade, invA, invB} or {ok:false, error, side?, invA?, invB?} (error 'conflict' = trade moved on).
     */
    async tradeSettle(id, version, opsA, opsB) {
      const t = await this.tradeGet(id);
      if (!t) return { ok: false, error: 'conflict' };
      const na = normalizeInvOps(opsA); const nb = normalizeInvOps(opsB);
      if (!na.ok || !nb.ok) return { ok: false, error: 'bad_ops' };
      const { rows } = await q('SELECT trade_settle($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9) AS r',
        [String(id), version, `trade:${t.a}:${id}`, `trade:${t.b}:${id}`, JSON.stringify(na.ops), JSON.stringify(nb.ops),
          Date.now(), rules.INV_ITEM_MAX, rules.INV_GEMS_MAX]);
      const r = rows[0].r || {};
      const st = (j) => invStateFromJson(j && j.ver !== undefined ? j : null);
      if (!r.ok) return { ok: false, error: r.error, side: r.side || undefined, invA: st(r.invA), invB: st(r.invB) };
      return { ok: true, trade: tradeFromRow(r.trade), invA: st(r.invA), invB: st(r.invB) };
    },
    // ------------------------------------------------ v1.8 social / daily (v7)
    /** Ledger rows of one reason since `sinceMs`: [{opId, createdAt}] (daily login streaks). */
    async ledgerByReason(userId, reason, sinceMs) {
      const { rows } = await q('SELECT op_id, created_at FROM inventory_ledger WHERE user_id = $1 AND reason = $2 AND created_at >= $3 ORDER BY created_at DESC LIMIT 400',
        [userId, String(reason), Number(sinceMs) || 0]);
      return rows.map((r) => ({ opId: r.op_id, createdAt: Number(r.created_at) }));
    },
    async invProgressSince(userId, reason, sinceMs) {
      const { rows } = await q('SELECT inv_progress_since($1, $2, $3) AS n', [userId, String(reason), Number(sinceMs) || 0]);
      return Number(rows[0].n) || 0;
    },
    async questClaimedLike(userId, prefix) {
      const { rows } = await q("SELECT qid FROM quest_claims WHERE user_id = $1 AND qid LIKE $2 || '%'", [userId, String(prefix)]);
      return rows.map((r) => r.qid);
    },
    /** Per-day quest reward: progress since `since` + claim row + credit in one transaction (quest_claim_since, v7). */
    async questClaimSince(userId, qid, { countReason, goal, since, opId, ops }) {
      if (!validOpId(opId, userId)) return { ok: false, error: 'bad_op_id' };
      const norm = normalizeInvOps(ops);
      if (!norm.ok) return norm;
      const { rows } = await q('SELECT quest_claim_since($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) AS r',
        [userId, String(qid), String(countReason), Number(goal) | 0, Number(since) || 0, opId, JSON.stringify(norm.ops), Date.now(), rules.INV_ITEM_MAX, rules.INV_GEMS_MAX]);
      const r = rows[0].r || {};
      const st = invStateFromJson(r.inv && r.inv.ver !== undefined ? r.inv : null);
      return { ok: !!r.ok, ...(r.ok ? {} : { error: r.error }), progress: r.progress == null ? undefined : Number(r.progress), state: st };
    },
    /** Richest players (wallet gems). */
    async leaderboard(limit = 20) {
      const { rows } = await q(
        `SELECT u.username, w.gems FROM wallets w JOIN users u ON u.id = w.user_id
         ORDER BY w.gems DESC, u.username_lower LIMIT $1`, [Math.max(1, Math.min(50, limit | 0))]);
      return rows.map((r) => ({ username: r.username, gems: Number(r.gems) }));
    },
    async gemsRank(userId) {
      const { rows } = await q(
        `SELECT 1 + (SELECT count(*) FROM wallets o WHERE o.gems > w.gems) AS rank, w.gems FROM wallets w WHERE w.user_id = $1`, [userId]);
      return rows[0] ? { rank: Number(rows[0].rank), gems: Number(rows[0].gems) } : null;
    },
    async getUserById(id) {
      const { rows } = await q('SELECT * FROM users WHERE id = $1', [id]);
      return userRow(rows[0]) || null;
    },
    /** One-way "I added you"; a friendship is both directions present. Returns false when the cap is hit. */
    async friendAdd(userId, friendId, cap = 100) {
      const { rows } = await q(
        `INSERT INTO friends(user_id, friend_id, created_at)
         SELECT $1, $2, $3 WHERE (SELECT count(*) FROM friends WHERE user_id = $1) < $4
         ON CONFLICT DO NOTHING RETURNING 1`, [userId, friendId, Date.now(), cap]);
      if (rows.length) return true;
      const ex = await q('SELECT 1 FROM friends WHERE user_id = $1 AND friend_id = $2', [userId, friendId]);
      return ex.rows.length > 0;
    },
    async friendRemove(userId, friendId) {
      await q('DELETE FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)', [userId, friendId]);
    },
    /** { friends: [{id, username}], incoming: [...], outgoing: [...] } */
    async friendList(userId) {
      const { rows } = await q(
        `SELECT u.id, u.username,
                EXISTS (SELECT 1 FROM friends a WHERE a.user_id = $1 AND a.friend_id = u.id) AS mine,
                EXISTS (SELECT 1 FROM friends b WHERE b.user_id = u.id AND b.friend_id = $1) AS theirs
         FROM users u
         WHERE u.id IN (SELECT friend_id FROM friends WHERE user_id = $1 UNION SELECT user_id FROM friends WHERE friend_id = $1)
         ORDER BY u.username_lower LIMIT 300`, [userId]);
      const out = { friends: [], incoming: [], outgoing: [] };
      for (const r of rows) {
        const e = { id: r.id, username: r.username };
        if (r.mine && r.theirs) out.friends.push(e); else if (r.mine) out.outgoing.push(e); else out.incoming.push(e);
      }
      return out;
    },
    async areFriends(a, b) {
      const { rows } = await q(
        'SELECT count(*)::int AS n FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)', [a, b]);
      return rows[0].n === 2;
    },
    async pmSend(fromId, fromName, toId, text) {
      const { rows } = await q(
        'INSERT INTO private_messages(from_id, from_name, to_id, text, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at',
        [fromId, fromName, toId, text, Date.now()]);
      return { id: Number(rows[0].id), ts: Number(rows[0].created_at) };
    },
    /** Conversation between two users, oldest first (last `limit`). */
    async pmThread(userId, otherId, limit = 50) {
      const { rows } = await q(
        `SELECT id, from_id, from_name, to_id, text, created_at FROM private_messages
         WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1) ORDER BY id DESC LIMIT $3`,
        [userId, otherId, Math.max(1, Math.min(100, limit | 0))]);
      return rows.reverse().map((r) => ({ id: Number(r.id), from: r.from_id, fromName: r.from_name, to: r.to_id, text: r.text, ts: Number(r.created_at) }));
    },
    async pmMarkRead(userId, otherId) {
      await q('UPDATE private_messages SET read_at = $3 WHERE to_id = $1 AND from_id = $2 AND read_at IS NULL', [userId, otherId, Date.now()]);
    },
    /** Unread counts per sender: [{from, fromName, n, lastId}] */
    async pmUnread(userId) {
      const { rows } = await q(
        `SELECT from_id, max(from_name) AS from_name, count(*)::int AS n, max(id) AS last_id FROM private_messages
         WHERE to_id = $1 AND read_at IS NULL GROUP BY from_id ORDER BY max(id) DESC LIMIT 50`, [userId]);
      return rows.map((r) => ({ from: r.from_id, fromName: r.from_name, n: r.n, lastId: Number(r.last_id) }));
    },
    /** Messages sent to the user after `afterId` (cross-instance delivery poll). */
    async pmSince(userIds, afterId) {
      if (!userIds.length) return [];
      const { rows } = await q(
        `SELECT id, from_id, from_name, to_id, text, created_at FROM private_messages
         WHERE id > $2 AND to_id = ANY($1::text[]) ORDER BY id LIMIT 500`, [userIds, Number(afterId) || 0]);
      return rows.map((r) => ({ id: Number(r.id), from: r.from_id, fromName: r.from_name, to: r.to_id, text: r.text, ts: Number(r.created_at) }));
    },
    async pmMaxId() {
      const { rows } = await q('SELECT COALESCE(max(id), 0) AS m FROM private_messages');
      return Number(rows[0].m) || 0;
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

module.exports = { createStore, gridToB64, b64ToGrid, MIGRATIONS };
