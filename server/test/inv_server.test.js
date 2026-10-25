'use strict';
// Unit tests for lib/inv_server.js (step 2: seeding + shadow comparison). No I/O.
const test = require('node:test');
const assert = require('node:assert/strict');
const inv = require('../lib/inv_server');
const rules = require('../lib/rules');

const T = rules.TILE;
const save = (pairs, gems = 25) => ({
  slots: [-1, ...pairs.map((p) => p[0])], counts: [0, ...pairs.map((p) => p[1])], selected: 0, gems,
});

test('brand-new account (no profile / no inventory) seeds the starter kit', () => {
  for (const p of [null, undefined, {}, { avatar: { skin: 1 } }, { inventory: { gems: 5 } }]) {
    const r = inv.seedForProfile(p);
    assert.equal(r.seededFrom, 'starter');
    assert.deepEqual(r.seed, rules.starterInventory());
    assert.deepEqual(r.issues, []);
  }
});

test('client default inventory (inventory.gd _ready) parses to exactly the starter kit', () => {
  // slots/counts exactly as the client builds them, World Lock goes into the first empty backpack slot.
  const slots = [-1, T.DIRT, T.GRASS, T.STONE, T.SEED, T.WOOD, T.TORCH, T.SAND, T.SEED_AZURE, T.WORLD_LOCK, ...Array(15).fill(-1)];
  const counts = [0, 64, 32, 16, 16, 32, 8, 24, 8, 1, ...Array(15).fill(0)];
  const r = inv.seedForProfile({ inventory: { slots, counts, selected: 0, gems: 25 } });
  assert.equal(r.seededFrom, 'profile');
  assert.deepEqual(r.seed, rules.starterInventory());
  assert.deepEqual(r.issues, []);
});

test('migrating profile: totals per id, fist slot skipped, unknown/invalid dropped, caps applied + logged', () => {
  const p = save([[T.DIRT, 200], [T.DIRT, 150], [T.WORLD_LOCK, 30], [999, 5], [T.AIR, 3], [-1, 7], [T.STONE, 2.5], [T.SAND, 0]], 300000);
  p.slots[0] = T.TORCH; p.counts[0] = 50; // slot 0 is the fist; the client never counts it
  const r = inv.seedForProfile({ inventory: p });
  assert.equal(r.seededFrom, 'profile');
  assert.deepEqual(r.seed, { items: { [T.DIRT]: 350, [T.WORLD_LOCK]: inv.SEED_WL_CAP }, gems: inv.SEED_GEMS_CAP });
  assert.ok(r.issues.includes('unknown_ids:2'), r.issues.join(' '));
  assert.ok(r.issues.includes('non_integer:1'));
  assert.ok(r.issues.includes(`cap:${T.WORLD_LOCK}:30>${inv.SEED_WL_CAP}`));
  assert.ok(r.issues.includes(`cap:gems:300000>${inv.SEED_GEMS_CAP}`));
});

test('suspicious-but-allowed amounts are kept and flagged; over-stack slots flagged; length mismatch tolerated', () => {
  const r = inv.parseProfileInventory({ slots: [-1, T.DIRT, T.WORLD_LOCK, T.WOOD], counts: [0, 1500, 6, 999, 4], gems: 25000 });
  assert.deepEqual(r.items, { [T.DIRT]: 1500, [T.WORLD_LOCK]: 6, [T.WOOD]: 999 });
  assert.equal(r.gems, 25000);
  for (const s of ['len_mismatch:4/5', `high:${T.DIRT}:1500`, `high:${T.WORLD_LOCK}:6`, 'high:gems:25000', 'slot_over_stack:2']) assert.ok(r.issues.includes(s), s);
  const big = inv.parseProfileInventory({ slots: [-1, T.DIRT], counts: [0, 999999], gems: 'x' });
  assert.deepEqual(big.items, { [T.DIRT]: inv.SEED_ITEM_CAP });
  assert.equal(big.gems, 0);
  assert.ok(big.issues.includes('bad_gems'));
  assert.deepEqual(inv.parseProfileInventory({ slots: [-1, T.DIRT], counts: [0, 999999] }, { cap: false }).items, { [T.DIRT]: 999999 });
  assert.deepEqual(inv.parseProfileInventory('garbage'), { items: {}, gems: 0, issues: [] });
});

test('diffInventory and inv_sync parsing', () => {
  const server = { ver: 1, gems: 25, items: { 1: 64, 20: 1 } };
  assert.equal(inv.diffInventory({ items: { 1: 64, 20: 1 }, gems: 25 }, server), null);
  const d = inv.diffInventory({ items: { 1: 60, 7: 3, 20: 2 }, gems: 30 }, server);
  assert.deepEqual(d.items, { 1: -4, 7: 3, 20: 1 });
  assert.equal(d.gems, 5);
  assert.equal(d.summary, 'Dirt#1:-4 Torch#7:+3 World Lock#20:+1 gems:+5');
  assert.deepEqual(inv.parseSyncItems({ 1: 5, 999: 3, 2: -1, 3: 1.5, x: 2, 20: '2' }), { 1: 5, 20: 2 });
  assert.deepEqual(inv.parseSyncItems(null), {});
});

test('shadow limiter: one line per interval per user, only when the summary changed', () => {
  const l = inv.createShadowLimiter({ intervalMs: 1000, maxUsers: 2 });
  assert.equal(l.shouldLog('u1', 'a', 0), true);
  assert.equal(l.shouldLog('u1', 'a', 5000), false); // unchanged
  assert.equal(l.shouldLog('u1', 'b', 500), false); // too soon
  assert.equal(l.shouldLog('u1', 'b', 1500), true);
  assert.equal(l.shouldLog('u2', 'a', 1500), true);
  assert.equal(l.shouldLog('u3', 'a', 1500), true); // evicts oldest, bounded memory
  assert.equal(l.size(), 2);
});

test('makeOpId always carries the user id as a segment', () => {
  assert.equal(inv.makeOpId('drop', 'abc123', 'WORLD', 42), 'drop:abc123:WORLD:42');
});
