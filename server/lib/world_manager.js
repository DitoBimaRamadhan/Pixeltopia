'use strict';
const crypto = require('crypto');
const rules = require('./rules');
const W = 64, H = 40;
const UNRIPE_GRACE_MS = 3000; // punching a seed this close to ready is refused instead of destroying it
const AIR = 0, DIRT = 1, GRASS = 2, STONE = 3, WOOD = 6, TORCH = 7, SAND = 9, WEATHER_MACHINE = 12, WORLD_LOCK = 20;

function surfaceY(rng, x, ground) {
  const bump = Math.floor(3 * Math.sin(x * 0.25 + rng() * 0.01) + 2 * Math.sin(x * 0.07));
  const cx = (W / 2) | 0;
  const dist = Math.abs(x - cx);
  let b = bump;
  if (dist < 8) b = Math.floor(bump * (dist / 8));
  return ground - b;
}
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function generateGrid(seedVal) {
  const seed = seedVal >>> 0 || 42;
  const rng = mulberry32(seed);
  const grid = new Int32Array(W * H);
  const ground = (H * 0.55) | 0;
  const idx = (x, y) => y * W + x;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gy = surfaceY(rng, x, ground);
    let id = AIR;
    if (y > gy + 5) id = STONE;
    else if (y > gy) id = DIRT;
    else if (y === gy) id = x < 14 && rng() < 0.55 ? SAND : GRASS;
    grid[idx(x, y)] = id;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gy = surfaceY(rng, x, ground);
    if (y <= gy) continue;
    if (y > gy + 2 && y < gy + 8) {
      const n = rng();
      if (n < 0.12) grid[idx(x, y)] = AIR;
      else if (n < 0.22 && y > gy + 4) grid[idx(x, y)] = STONE;
    }
  }
  let trees = 0, attempts = 0;
  while (trees < 7 && attempts < 40) {
    attempts++;
    const tx = 4 + ((rng() * (W - 9)) | 0);
    if (Math.abs(tx - ((W / 2) | 0)) < 6) continue;
    const gy = surfaceY(rng, tx, ground);
    const trunkH = 3 + ((rng() * 3) | 0);
    let blocked = false;
    for (let dy = 1; dy <= trunkH; dy++) {
      if (gy - dy < 0 || grid[idx(tx, gy - dy)] !== AIR) { blocked = true; break; }
    }
    if (blocked) continue;
    for (let dy = 1; dy <= trunkH; dy++) grid[idx(tx, gy - dy)] = WOOD;
    const top = gy - trunkH;
    if (tx - 1 >= 0 && grid[idx(tx - 1, top)] === AIR) grid[idx(tx - 1, top)] = WOOD;
    if (tx + 1 < W && grid[idx(tx + 1, top)] === AIR) grid[idx(tx + 1, top)] = WOOD;
    trees++;
  }
  const sx = (W / 2) | 0;
  const sgy = surfaceY(rng, sx, ground);
  const spawn = { x: sx, y: Math.max(sgy - 2, 1) };
  for (let dy = 1; dy <= 3; dy++) if (sgy - dy >= 0) grid[idx(sx, sgy - dy)] = AIR;
  if (sx - 5 >= 0 && sgy - 1 >= 0) grid[idx(sx - 5, sgy - 1)] = TORCH;
  if (sx + 3 < W && sgy - 1 >= 0) grid[idx(sx + 3, sgy - 1)] = WEATHER_MACHINE;
  return { grid, spawn, seed };
}
function normalizeWorldName(name) {
  const n = String(name || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 24);
  return n.length >= 2 ? n : '';
}
// ------------------------------------------------------------ pure world reducer
// Every world mutation (block edit, World Lock, access list) goes through applyEvent so the
// same ordered list of events always produces the same world, on any server instance.
// No I/O, no clock, no randomness: the result depends only on (world state, event).

/** World Lock access list: [{id, username}] — owner + listed players can edit. */
function hasAccess(world, playerId) {
  return (world.access || []).some((a) => a.id === playerId);
}
function canEdit(world, player) {
  if (!world.lockOwnerId) return true;
  return world.lockOwnerId === player.id || hasAccess(world, player.id);
}
function setTile(world, x, y, id) {
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  world.grid[y * W + x] = id | 0;
  world.dirty = true;
  return true;
}
function getTile(world, x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return STONE;
  return world.grid[y * W + x];
}

/**
 * Apply one event to a world, re-validating against the world's CURRENT state.
 *   { kind: 'punch',  actorId, actorName, x, y }
 *   { kind: 'place',  actorId, actorName, x, y, id, strict?, invOp?, ts? }
 *   { kind: 'fertilize', actorId, actorName, x, y, ts, invOp? }
 * world.plants = { "<y*W+x>": { r: readyAtMs, f: 0|1 } } for seeds planted by events with `ts`.
 *   { kind: 'access_grant',  actorId, target: { id, username } }
 *   { kind: 'access_revoke', actorId, target: usernameOrId }
 * Returns { ok, ... } on success (world mutated) or { error } (world untouched).
 * Punch/place results: { ok, x, y, id, broke? , noop? } exactly as the old punch()/place().
 */
function applyEvent(world, ev) {
  if (!world || !ev) return { error: 'Event tidak valid.' };
  const actor = { id: ev.actorId, username: ev.actorName };
  switch (ev.kind) {
    case 'punch': {
      if (!canEdit(world, actor)) return { error: 'Dunia terkunci — hanya pemilik World Lock yang bisa edit.' };
      const x = ev.x | 0, y = ev.y | 0;
      if (x < 0 || y < 0 || x >= W || y >= H) return { error: 'Out of bounds' };
      const id = getTile(world, x, y);
      if (id === AIR) return { ok: true, id: AIR, x, y, noop: true };
      if (id === WORLD_LOCK && world.lockOwnerId && world.lockOwnerId !== actor.id) {
        return { error: 'Tidak bisa memecah World Lock milik orang lain.' };
      }
      // Harvest (events with a server timestamp only, so old logs replay exactly as before):
      // a mature seed (ready time passed, or planted before plant times were tracked) or a crop tile.
      let harvest;
      const key = String(y * W + x);
      if (ev.ts) {
        const ts = Number(ev.ts);
        const plant = world.plants ? world.plants[key] : null;
        if (rules.isSeed(id)) {
          if (!plant || plant.r <= ts) harvest = rules.cropForSeed(id);
          else if (plant.r - ts <= UNRIPE_GRACE_MS) return { error: 'Belum matang, tunggu sebentar.' };
        } else if (rules.isCrop(id)) harvest = id;
      }
      setTile(world, x, y, AIR);
      if (world.plants) delete world.plants[key];
      if (id === WORLD_LOCK) { world.lockOwnerId = null; world.lockOwnerName = null; world.access = []; }
      const out = { ok: true, x, y, id: AIR, broke: id };
      if (harvest !== undefined) out.harvest = harvest;
      return out;
    }
    case 'place': {
      if (!canEdit(world, actor)) return { error: 'Dunia terkunci — hanya pemilik World Lock yang bisa edit.' };
      const x = ev.x | 0, y = ev.y | 0, tileId = ev.id | 0;
      if (x < 0 || y < 0 || x >= W || y >= H) return { error: 'Out of bounds' };
      if (getTile(world, x, y) !== AIR) return { error: 'Tile tidak kosong' };
      // strict (SERVER_INV): only placeable item ids, seeds only on soil (rules.canPlace, same as the client).
      // Carried in the event itself so every instance decides the same way whatever its own env.
      if (ev.strict && !rules.canPlace(tileId, AIR, y + 1 < H ? getTile(world, x, y + 1) : null)) {
        return { error: 'Item ini tidak bisa ditaruh di sini.' };
      }
      if (tileId === WORLD_LOCK) {
        if (world.lockOwnerId) return { error: 'Dunia sudah terkunci.' };
        world.lockOwnerId = actor.id;
        world.lockOwnerName = actor.username;
        world.access = [];
      }
      setTile(world, x, y, tileId);
      const out = { ok: true, x, y, id: tileId };
      if (rules.isSeed(tileId) && ev.ts) {
        if (!world.plants) world.plants = {};
        const r = Number(ev.ts) + rules.growSeconds(tileId) * 1000;
        world.plants[String(y * W + x)] = { r, f: 0 };
        out.readyAt = r;
      }
      return out;
    }
    case 'fertilize': {
      // Halve the remaining grow time of a planted seed, once (World.try_fertilize).
      if (!canEdit(world, actor)) return { error: 'Dunia terkunci — hanya pemilik World Lock yang bisa edit.' };
      const x = ev.x | 0, y = ev.y | 0;
      if (x < 0 || y < 0 || x >= W || y >= H) return { error: 'Out of bounds' };
      const id = getTile(world, x, y);
      if (!rules.isSeed(id)) return { error: 'Pupuk hanya untuk tanaman yang sedang tumbuh.' };
      const ts = Number(ev.ts) || 0;
      const key = String(y * W + x);
      const plant = world.plants ? world.plants[key] : null;
      if (!ts || !plant || plant.r <= ts) return { error: 'Tanaman ini sudah matang.' };
      if (plant.f) return { error: 'Sudah dipupuk.' };
      const r = ts + Math.floor((plant.r - ts) * rules.FERTILIZER_FACTOR);
      world.plants[key] = { r, f: 1 };
      world.dirty = true;
      return { ok: true, x, y, id, fertilized: true, readyAt: r };
    }
    case 'access_grant': {
      const target = ev.target || {};
      if (!world.lockOwnerId || world.lockOwnerId !== actor.id) return { error: 'Hanya pemilik World Lock yang bisa memberi akses.' };
      if (target.id === actor.id) return { error: 'Kamu sudah pemilik dunia ini.' };
      if (hasAccess(world, target.id)) return { error: `${target.username} sudah punya akses.` };
      if ((world.access || []).length >= 64) return { error: 'Daftar akses penuh (maks 64).' };
      world.access = [...(world.access || []), { id: target.id, username: target.username }];
      world.dirty = true;
      return { ok: true };
    }
    case 'access_revoke': {
      if (!world.lockOwnerId || world.lockOwnerId !== actor.id) return { error: 'Hanya pemilik World Lock yang bisa mencabut akses.' };
      const usernameOrId = ev.target;
      const key = String(usernameOrId).toLowerCase();
      const before = (world.access || []).length;
      world.access = (world.access || []).filter((a) => a.id !== usernameOrId && String(a.username).toLowerCase() !== key);
      if (world.access.length === before) return { error: 'Pemain tidak ada di daftar akses.' };
      world.dirty = true;
      return { ok: true };
    }
    default:
      return { error: 'Event tidak dikenal.' };
  }
}

/** Canonical, JSON-safe form of an edit event: exactly what the reducer will see on every instance. */
function normalizeEvent(ev) {
  const out = { kind: String(ev.kind), actorId: ev.actorId == null ? null : String(ev.actorId) };
  if (ev.actorName != null) out.actorName = String(ev.actorName);
  const tileKind = ev.kind === 'punch' || ev.kind === 'place' || ev.kind === 'fertilize';
  if (tileKind) { out.x = ev.x | 0; out.y = ev.y | 0; }
  if (ev.kind === 'place') out.id = ev.id | 0;
  // SERVER_INV markers (only present when set, so old events/logs are byte-identical):
  //   strict   place validated with rules.canPlace      invOp    place was paid for by this ledger op_id
  //   invCredit  punch by a logged-in player whose own World Lock break is credited back
  if ((ev.kind === 'punch' || ev.kind === 'place') && ev.strict) out.strict = true;
  //   ts       server time of the edit (plant ready times / harvest), set by world_sync.submit
  //   guest    edit by a guest (session-only inventory, handled on the guest's own instance)
  if ((ev.kind === 'place' || ev.kind === 'fertilize') && ev.invOp) out.invOp = String(ev.invOp);
  if (ev.kind === 'punch' && ev.invCredit) out.invCredit = true;
  if (tileKind && Number.isSafeInteger(Number(ev.ts)) && Number(ev.ts) > 0) out.ts = Number(ev.ts);
  if (tileKind && ev.guest) out.guest = true;
  if (ev.kind === 'access_grant') {
    const t = ev.target || {};
    out.target = { id: t.id == null ? null : String(t.id), username: t.username == null ? null : String(t.username) };
  }
  if (ev.kind === 'access_revoke') out.target = String(ev.target);
  return out;
}

/** Copy of a plants map with only well-formed entries. */
function clonePlants(src) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const [k, v] of Object.entries(src)) {
    const i = Number(k);
    if (Number.isInteger(i) && i >= 0 && i < W * H && v && Number.isFinite(Number(v.r))) out[String(i)] = { r: Number(v.r), f: v.f ? 1 : 0 };
  }
  return out;
}
/** ms until each seed is ready (<=0: ready), for clients: { "<idx>": ms }. */
function plantsReadyIn(world, now = Date.now()) {
  const out = {};
  for (const [k, v] of Object.entries(world.plants || {})) if (rules.isSeed(world.grid[Number(k)])) out[k] = Math.round(v.r - now);
  return out;
}

function createWorldManager() {
  const worlds = new Map();
  function ensureStart() { if (!worlds.has('START')) createWorld('START', 'system'); }
  function createWorld(rawName, ownerId) {
    const name = normalizeWorldName(rawName);
    if (!name) return { error: 'Nama dunia 2–24 huruf/angka/_.' };
    if (worlds.has(name)) return { error: 'Dunia sudah ada.', world: worlds.get(name) };
    const seed = crypto.randomBytes(4).readUInt32BE(0);
    const gen = generateGrid(seed);
    const world = {
      name, seed: gen.seed, grid: gen.grid, spawn: gen.spawn,
      lockOwnerId: null, lockOwnerName: null, access: [], plants: {}, createdBy: ownerId || null,
      createdAt: Date.now(), players: new Map(), dirty: true,
    };
    worlds.set(name, world);
    return { world, created: true };
  }
  /** Restore a persisted world (from Postgres / file store). */
  function hydrate(data) {
    const name = normalizeWorldName(data.name);
    if (!name || !data.grid || data.grid.length !== W * H) return null;
    const world = {
      name, seed: data.seed >>> 0, grid: Int32Array.from(data.grid), spawn: data.spawn || { x: 32, y: 10 },
      lockOwnerId: data.lockOwnerId || null, lockOwnerName: data.lockOwnerName || null,
      access: Array.isArray(data.access) ? data.access.slice(0, 64) : [],
      plants: clonePlants(data.plants),
      createdBy: data.createdBy || null, createdAt: data.createdAt || Date.now(),
      players: new Map(), dirty: false,
    };
    worlds.set(name, world);
    return world;
  }
  function allWorlds() { return [...worlds.values()]; }
  function unload(name) { return worlds.delete(normalizeWorldName(name)); }
  function grantAccess(world, owner, target) {
    return applyEvent(world, { kind: 'access_grant', actorId: owner.id, target: { id: target.id, username: target.username } });
  }
  function revokeAccess(world, owner, usernameOrId) {
    return applyEvent(world, { kind: 'access_revoke', actorId: owner.id, target: usernameOrId });
  }
  function getWorld(name) { return worlds.get(normalizeWorldName(name)); }
  function listWorlds() {
    const out = [];
    for (const w of worlds.values()) {
      out.push({ name: w.name, players: w.players.size, locked: !!w.lockOwnerId, lockOwner: w.lockOwnerName || null, seed: w.seed, access: (w.access || []).map((a) => a.username) });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }
  function gridArray(world) { return Array.from(world.grid); }
  function punch(world, player, x, y) {
    return applyEvent(world, { kind: 'punch', actorId: player.id, actorName: player.username, x, y });
  }
  function place(world, player, x, y, tileId) {
    return applyEvent(world, { kind: 'place', actorId: player.id, actorName: player.username, x, y, id: tileId });
  }
  function join(world, player) {
    world.players.set(player.id, player);
    player.worldName = world.name;
    player.x = world.spawn.x;
    player.y = world.spawn.y;
  }
  function leave(world, player) {
    if (!world) return;
    // Only remove this exact connection: a newer connection of the same account may have replaced it.
    if (world.players.get(player.id) === player) world.players.delete(player.id);
    if (player.worldName === world.name) player.worldName = null;
  }
  return {
    W, H, WORLD_LOCK, AIR, ensureStart, createWorld, getWorld, listWorlds, hydrate, allWorlds, unload,
    hasAccess, grantAccess, revokeAccess, applyEvent,
    gridArray, canEdit, punch, place, join, leave, normalizeWorldName,
  };
}
module.exports = { createWorldManager, normalizeWorldName, mulberry32, applyEvent, normalizeEvent, generateGrid, clonePlants, plantsReadyIn, W, H, AIR, WORLD_LOCK, UNRIPE_GRACE_MS };
