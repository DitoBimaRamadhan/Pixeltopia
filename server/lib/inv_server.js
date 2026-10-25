'use strict';
/**
 * Server-authoritative inventory helpers (seeding, diffing, guest kits, request ops). Pure functions, no I/O.
 *
 * Gated in index.js by SERVER_INV=1 (on in production since v1.7.0; see server/README.md). Historical notes
 * from step 2 follow (since step 7 the client's inv_sync is ignored, so no shadow diffs are logged). With the flag on, for logged-in players only:
 *   1. after the welcome handshake, the wallet is created once (store.invEnsure): from the stored profile's
 *      inventory when there is one (migrating account), else rules.starterInventory() (seeded_from='starter');
 *   2. {t:'inv', ver, items, gems} is sent right after `welcome`;
 *   3. inv_sync / profile_save are compared against the wallet and differences are logged
 *      ("[inv] shadow diff ...", rate-limited). Nothing is enforced and gameplay is unchanged.
 *
 * Seed caps (migration of client-reported profiles; chosen in step 2):
 *   SEED_ITEM_CAP  = 4000 per item id (20 full stacks of MAX_STACK=200). The default bag is 8 hotbar + 16
 *                    backpack slots, so a legit total above this needs >20 slots of one item.
 *   SEED_WL_CAP    = 20 World Locks (each costs 200 gems; starter has 1).
 *   SEED_GEMS_CAP  = 200000 gems (≈1000 World Locks of store purchases).
 *   Values above a cap are clamped (not zeroed) and logged. Lower "suspicious" thresholds only log:
 *   any id > SUSPECT_ITEM (1000), World Locks > SUSPECT_WL (5), gems > SUSPECT_GEMS (20000), a single slot
 *   above MAX_STACK, unknown/invalid ids, non-integer counts, slots/counts length mismatch.
 */
const crypto = require('crypto');
const rules = require('./rules');
const { mulberry32 } = require('./world_manager');
const { TILE } = rules;

const SEED_ITEM_CAP = 4000;
const SEED_WL_CAP = 20;
const SEED_GEMS_CAP = 200000;
const SUSPECT_ITEM = 1000;
const SUSPECT_WL = 5;
const SUSPECT_GEMS = 20000;
const WL = rules.TILE.WORLD_LOCK;

const itemCap = (id) => (id === WL ? SEED_WL_CAP : SEED_ITEM_CAP);

/**
 * Totals per item id from a client inventory save ({slots, counts, gems}) — same counting as the client's
 * GameSocket.sync_inventory (slot 0 = fist is skipped). Returns {items, gems, issues[]} where items/gems
 * are sanitized and (unless cap:false, used for shadow comparison) capped. Never throws.
 */
function parseProfileInventory(inv, { cap = true } = {}) {
  const issues = [];
  const totals = {};
  const slots = Array.isArray(inv && inv.slots) ? inv.slots : [];
  const counts = Array.isArray(inv && inv.counts) ? inv.counts : [];
  if (slots.length !== counts.length) issues.push(`len_mismatch:${slots.length}/${counts.length}`);
  const len = Math.min(slots.length, counts.length, 4096);
  if (Math.max(slots.length, counts.length) > 4096) issues.push('too_many_slots');
  let unknown = 0;
  let badCount = 0;
  let overStack = 0;
  for (let i = 1; i < len; i++) {
    const id = Number(slots[i]);
    const n = Number(counts[i]);
    if (!Number.isInteger(id) || id < 0) continue; // empty slot (-1)
    if (!Number.isFinite(n) || n <= 0) continue;
    if (!Number.isInteger(n)) { badCount++; continue; }
    if (!rules.isKnownItem(id)) { unknown++; continue; }
    if (n > rules.MAX_STACK) overStack++;
    totals[id] = (totals[id] || 0) + n;
  }
  if (unknown) issues.push(`unknown_ids:${unknown}`);
  if (badCount) issues.push(`non_integer:${badCount}`);
  if (overStack) issues.push(`slot_over_stack:${overStack}`);
  const items = {};
  for (const [k, v] of Object.entries(totals)) {
    const id = Number(k);
    const c = itemCap(id);
    if (v > c) issues.push(`cap:${id}:${v}>${c}`);
    else if (v > (id === WL ? SUSPECT_WL : SUSPECT_ITEM)) issues.push(`high:${id}:${v}`);
    items[id] = cap ? Math.min(v, c) : v;
  }
  let gems = Number(inv && inv.gems);
  if (!Number.isFinite(gems) || gems < 0) { if (inv && inv.gems !== undefined) issues.push('bad_gems'); gems = 0; }
  gems = Math.floor(gems);
  if (gems > SEED_GEMS_CAP) { issues.push(`cap:gems:${gems}>${SEED_GEMS_CAP}`); if (cap) gems = SEED_GEMS_CAP; } else if (gems > SUSPECT_GEMS) issues.push(`high:gems:${gems}`);
  return { items, gems, issues };
}

/** Has the stored profile an inventory to migrate? (A profile saved by the client always has one.) */
function profileHasInventory(profile) {
  const inv = profile && profile.inventory;
  return !!(inv && typeof inv === 'object' && Array.isArray(inv.slots));
}

/** What to seed a new wallet with: {seededFrom, seed:{items,gems}, issues[]}. */
function seedForProfile(profile) {
  if (!profileHasInventory(profile)) return { seededFrom: 'starter', seed: rules.starterInventory(), issues: [] };
  const p = parseProfileInventory(profile.inventory);
  return { seededFrom: 'profile', seed: { items: p.items, gems: p.gems }, issues: p.issues };
}

/** Client-reported inv_sync payload ({items:{id:n}, gems}) -> known ids only, positive integer totals. */
function parseSyncItems(raw) {
  const items = {};
  for (const [k, v] of Object.entries((raw && typeof raw === 'object') ? raw : {})) {
    const id = Number(k); const n = Number(v);
    if (Number.isInteger(id) && rules.isKnownItem(id) && Number.isInteger(n) && n > 0) items[id] = n;
  }
  return items;
}

/**
 * client - server per item id and gems. Returns null when equal, else
 * {items:{id: clientMinusServer}, gems: clientMinusServer, summary}.
 */
function diffInventory(client, server) {
  const ci = (client && client.items) || {};
  const si = (server && server.items) || {};
  const out = {};
  const ids = new Set([...Object.keys(ci), ...Object.keys(si)].map(Number));
  for (const id of [...ids].sort((a, b) => a - b)) {
    const d = (Number(ci[id]) || 0) - (Number(si[id]) || 0);
    if (d) out[id] = d;
  }
  const g = (Number(client && client.gems) || 0) - (Number(server && server.gems) || 0);
  if (!Object.keys(out).length && !g) return null;
  const parts = Object.entries(out).map(([id, d]) => `${rules.TILE_NAMES[id] || id}#${id}:${d > 0 ? '+' : ''}${d}`);
  if (g) parts.push(`gems:${g > 0 ? '+' : ''}${g}`);
  return { items: out, gems: g, summary: parts.join(' ') };
}

/**
 * Per-user rate limit for shadow logs: at most one line per `intervalMs`, and a line is only due when the
 * diff summary changed since the last logged one. `now` injectable for tests.
 */
function createShadowLimiter({ intervalMs = 60000, maxUsers = 5000 } = {}) {
  const last = new Map(); // userId -> {at, summary}
  return {
    shouldLog(userId, summary, now = Date.now()) {
      const prev = last.get(userId);
      if (prev && (prev.summary === summary || now - prev.at < intervalMs)) return false;
      if (last.size >= maxUsers && !prev) last.delete(last.keys().next().value);
      last.set(userId, { at: now, summary });
      return true;
    },
    forget(userId) { last.delete(userId); },
    size() { return last.size; },
  };
}

/** Deterministic drop RNG for log event `seq` of `worldName`: identical on every instance. */
function dropRng(worldName, seq) {
  const h = crypto.createHash('sha256').update(`${worldName}:${seq}`).digest();
  return mulberry32(h.readUInt32LE(0));
}

/** Kind of a paid edit -> item it consumed (refunded when the reducer rejects it from the log). */
function paidItem(ev) {
  if (ev.kind === 'place') return ev.id | 0;
  if (ev.kind === 'fertilize') return TILE.FERTILIZER;
  return null;
}

/**
 * Inventory side effects of one punch/place/fertilize as applied FROM THE LOG (confirmed order). Pure and
 * deterministic, so every instance computes the same list; the op_ids make repeats no-ops.
 *  - a paid edit (ev.invOp) the reducer rejected (lost a race, world got locked, ...) -> refund the item
 *    (reason refund_<op kind>, e.g. refund_place / refund_plant / refund_fertilize)
 *  - the lock owner broke their own World Lock (punch marked invCredit) -> +1 World Lock
 *    (rules.OWNER_BREAK_RETURNS_WORLD_LOCK: 100% online). An ownerless World Lock tile gives nothing back,
 *    and World Locks never roll normal drops.
 *  - step 4: any other successful break by a logged-in player (invCredit) or guest (guest) with a server
 *    timestamp -> rules.rollBreak / rules.rollHarvest seeded by hash(world, seq), credited once with
 *    op_id drop:<userId>:<world>:<seq> (reason 'harvest' for crops/mature seeds, else 'break').
 * Effects of guest events carry guest:true (applied in memory by the guest's own instance, never the DB).
 * Returns [{opId, userId, ops, reason, guest?, reward?}].
 */
function invEffectsForEvent(worldName, ev, result, prevLockOwnerId) {
  if (!ev || !ev.actorId || !result) return [];
  const guest = !!ev.guest;
  const g = guest ? { guest: true } : {};
  const item = paidItem(ev);
  if (item !== null && result.error && ev.invOp) {
    const kind = String(ev.invOp).split(':')[0] || 'place';
    return [{ opId: `refund:${ev.actorId}:${ev.invOp}`, userId: ev.actorId, ops: { items: { [item]: 1 } }, reason: `refund_${kind}`, ...g }];
  }
  if (ev.kind !== 'punch' || result.error || result.noop || !ev.seq) return [];
  if (result.broke === WL) {
    if (ev.invCredit && rules.OWNER_BREAK_RETURNS_WORLD_LOCK && prevLockOwnerId && prevLockOwnerId === ev.actorId) {
      return [{ opId: makeOpId('wlbreak', ev.actorId, worldName, ev.seq), userId: ev.actorId, ops: { items: { [WL]: 1 } }, reason: 'wl_break' }];
    }
    return [];
  }
  if (!(ev.invCredit || guest) || !ev.ts) return []; // events from before step 4 never had drops online
  const rng = dropRng(worldName, ev.seq);
  const harvest = result.harvest !== undefined && result.harvest !== null;
  const roll = harvest ? rules.rollHarvest(result.harvest, rng) : rules.rollBreak(result.broke, rng);
  if (!roll) return [];
  const items = {};
  for (const it of roll.items) items[it.id] = (items[it.id] || 0) + it.n;
  if (!Object.keys(items).length && !roll.gems) return [];
  const ops = { items };
  if (roll.gems) ops.gems = roll.gems;
  return [{
    opId: makeOpId('drop', ev.actorId, worldName, ev.seq), userId: ev.actorId, ops, reason: harvest ? 'harvest' : 'break',
    reward: { x: result.x, y: result.y, items: roll.items.map((i) => ({ id: i.id, n: i.n })), gems: roll.gems || 0, harvest }, ...g,
  }];
}

/** Merge item deltas: {id: n} + {id: m}. Zero entries are dropped. */
function addItems(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) { out[k] = (out[k] || 0) + v; if (!out[k]) delete out[k]; }
  return out;
}

/**
 * Step 5: wallet ops for client requests (validated here, applied atomically by store.invApply).
 * Each returns {ops, reason} or {error} (Indonesian, shown to the player).
 */
function craftOps(recipeId) {
  const r = rules.recipeById(String(recipeId));
  if (!r) return { error: 'Resep tidak dikenal.' };
  let items = {};
  for (const ing of r.ingredients) items = addItems(items, { [ing.id]: -ing.count });
  items = addItems(items, { [r.result]: r.resultCount });
  return { ops: { items }, reason: 'craft', result: { id: r.result, n: r.resultCount } };
}
function spliceOps(a, b) {
  a = Number(a); b = Number(b);
  const res = rules.spliceResult(a, b);
  if (res < 0) return { error: 'Kombinasi benih ini tidak menghasilkan apa-apa.' };
  return { ops: { items: addItems({ [a]: -1, [b]: -1 }, { [res]: 1 }) }, reason: 'splice', result: { id: res, n: 1 } };
}
const SHOP_MAX_QTY = 100;
function buyOps(id, qty = 1) {
  id = Number(id); qty = Number(qty);
  if (!Number.isInteger(id) || !rules.isKnownItem(id) || rules.buyPrice(id) < 0) return { error: 'Item ini tidak dijual.' };
  if (!Number.isInteger(qty) || qty < 1 || qty > SHOP_MAX_QTY) return { error: 'Jumlah tidak valid.' };
  return { ops: { items: { [id]: qty }, gems: -rules.buyPrice(id) * qty }, reason: 'buy', result: { id, n: qty } };
}
function sellOps(id, qty = 1) {
  id = Number(id); qty = Number(qty);
  if (!Number.isInteger(id) || !rules.isKnownItem(id) || rules.sellPrice(id) <= 0) return { error: 'Item ini tidak bisa dijual.' };
  if (!Number.isInteger(qty) || qty < 1 || qty > SHOP_MAX_QTY) return { error: 'Jumlah tidak valid.' };
  return { ops: { items: { [id]: -qty }, gems: rules.sellPrice(id) * qty }, reason: 'sell', result: { id, n: qty } };
}
/** Ledger reason counted for each quest type (progress = rows(reason) - rows(refund_<reason>)). */
const QUEST_PROGRESS_REASON = { harvest_crops: 'harvest', plant_seeds: 'plant', splice_seeds: 'splice' };
function questClaimOps(qid) {
  const q = rules.questById(String(qid));
  if (!q) return { error: 'Quest tidak dikenal.' };
  const ops = { items: {} };
  if (q.rewardGems) ops.gems = q.rewardGems;
  if (q.rewardItem >= 0 && q.rewardCount > 0) ops.items[q.rewardItem] = q.rewardCount;
  return { ops, reason: 'quest', countReason: QUEST_PROGRESS_REASON[q.type], goal: q.goal, quest: q };
}
/**
 * Step 6: both wallet deltas of a completed trade. offer = {items: {id: n}|[{id,count}], gems}.
 * A gives offerA and receives offerB (and vice versa).
 */
function offerItems(offer) {
  const out = {};
  const raw = (offer && offer.items) || {};
  const list = Array.isArray(raw) ? raw.map((e) => [e && e.id, e && (e.count ?? e.n)]) : Object.entries(raw);
  for (const [k, v] of list) {
    const id = Number(k); const n = Number(v);
    if (Number.isInteger(id) && rules.isKnownItem(id) && Number.isInteger(n) && n > 0) out[id] = (out[id] || 0) + n;
  }
  return out;
}
function tradeOps(offerA, offerB) {
  const ia = offerItems(offerA), ib = offerItems(offerB);
  const ga = Math.max(0, Math.floor(Number(offerA && offerA.gems) || 0));
  const gb = Math.max(0, Math.floor(Number(offerB && offerB.gems) || 0));
  const neg = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, -v]));
  return {
    a: { items: addItems(neg(ia), ib), gems: gb - ga },
    b: { items: addItems(neg(ib), ia), gems: ga - gb },
  };
}

/**
 * Guest session inventory (step 6 decision): guests get an in-memory kit (starter minus the World Lock),
 * reset on every connect and never persisted. Same op semantics as the DB wallet (idempotent op ids,
 * all-or-nothing, insufficient_item:<id> / insufficient_gems errors).
 */
function createGuestWallet() {
  const items = { ...rules.STARTER_ITEMS };
  delete items[WL];
  const w = { items, gems: rules.STARTER_GEMS, ver: 1, seen: new Set() };
  return w;
}
function guestApply(w, opId, ops) {
  if (w.seen.has(opId)) return { ok: true, dup: true, state: guestState(w) };
  const next = { ...w.items };
  for (const [k, d] of Object.entries((ops && ops.items) || {})) {
    const v = (next[k] || 0) + d;
    if (v < 0) return { ok: false, error: `insufficient_item:${k}`, state: guestState(w) };
    if (v > rules.INV_ITEM_MAX) return { ok: false, error: `cap_item:${k}`, state: guestState(w) };
    if (v) next[k] = v; else delete next[k];
  }
  const gems = w.gems + (Number(ops && ops.gems) || 0);
  if (gems < 0) return { ok: false, error: 'insufficient_gems', state: guestState(w) };
  if (gems > rules.INV_GEMS_MAX) return { ok: false, error: 'cap_gems', state: guestState(w) };
  w.items = next; w.gems = gems; w.ver++;
  w.seen.add(opId);
  if (w.seen.size > 5000) w.seen.delete(w.seen.values().next().value);
  return { ok: true, dup: false, state: guestState(w) };
}
function guestState(w) { return { ver: w.ver, items: { ...w.items }, gems: w.gems }; }

/** Player-facing text for an inventory op error code. */
function invErrorText(error) {
  const e = String(error || '');
  if (e.startsWith('insufficient_item:')) {
    const id = Number(e.split(':')[1]);
    return `Item tidak cukup: ${(rules.CATALOG[id] && rules.CATALOG[id].name) || rules.TILE_NAMES[id] || id}.`;
  }
  if (e === 'insufficient_gems') return 'Gems tidak cukup.';
  if (e.startsWith('cap_')) return 'Inventori penuh untuk item ini.';
  if (e === 'no_wallet') return 'Inventori server belum siap, coba lagi.';
  if (e === 'already_claimed') return 'Hadiah quest ini sudah diambil.';
  if (e === 'not_complete') return 'Quest belum selesai.';
  return 'Gagal, coba lagi.';
}

/** Build an op_id that always carries the user id (required by store.invApply). */
function makeOpId(kind, userId, ...parts) {
  return [kind, userId, ...parts].map((x) => String(x)).join(':');
}

module.exports = {
  SEED_ITEM_CAP, SEED_WL_CAP, SEED_GEMS_CAP, SUSPECT_ITEM, SUSPECT_WL, SUSPECT_GEMS,
  parseProfileInventory, profileHasInventory, seedForProfile, parseSyncItems, diffInventory,
  createShadowLimiter, makeOpId, invEffectsForEvent, dropRng, addItems,
  craftOps, spliceOps, buyOps, sellOps, questClaimOps, QUEST_PROGRESS_REASON, offerItems, tradeOps, SHOP_MAX_QTY,
  createGuestWallet, guestApply, guestState, invErrorText,
};
