'use strict';
/**
 * Server inventory steps 4-6 (pure parts + store): plant times / harvest / fertilize in the reducer,
 * deterministic break & harvest drops, request op builders, guest kit, quest claims and atomic trades.
 * Store scenarios run on the file store always and on Postgres only with TEST_DATABASE_URL (never
 * DATABASE_URL, never the production host). Postgres rows use a random ZZTEST_ prefix and are deleted.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../lib/store');
const rules = require('../lib/rules');
const inv = require('../lib/inv_server');
const { applyEvent, normalizeEvent, clonePlants, plantsReadyIn, W, UNRIPE_GRACE_MS } = require('../lib/world_manager');

const T = rules.TILE;
const URL_ = process.env.TEST_DATABASE_URL || '';
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const prodHost = (() => {
  try {
    const m = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').match(/^\s*DATABASE_URL\s*=\s*['"]?([^'"\r\n]+)/m);
    return m ? hostOf(m[1]) : '';
  } catch { return ''; }
})();
const pgSkip = !URL_ ? 'TEST_DATABASE_URL not set' : (prodHost && hostOf(URL_) === prodHost) ? 'refusing to run against production' : false;

function flatWorld() {
  const grid = new Int32Array(64 * 40);
  for (let x = 0; x < 64; x++) grid[20 * 64 + x] = T.GRASS; // soil row at y=20, air above
  return { grid, lockOwnerId: null, lockOwnerName: null, access: [], plants: {} };
}
const A = { actorId: 'ua', actorName: 'alice' };

test('reducer: seeds record a ready time; harvest when mature, grace refusal, unripe break, legacy events', () => {
  const w = flatWorld();
  const t0 = 1_000_000;
  const p = applyEvent(w, normalizeEvent({ kind: 'place', ...A, x: 5, y: 19, id: T.SEED, strict: true, ts: t0 }));
  assert.equal(p.ok, true);
  assert.equal(p.readyAt, t0 + rules.growSeconds(T.SEED) * 1000);
  assert.deepEqual(w.plants[String(19 * W + 5)], { r: p.readyAt, f: 0 });
  assert.deepEqual(plantsReadyIn(w, t0), { [String(19 * W + 5)]: rules.growSeconds(T.SEED) * 1000 });
  // close to ready: refused (nothing changes)
  const g = applyEvent(w, normalizeEvent({ kind: 'punch', ...A, x: 5, y: 19, ts: p.readyAt - UNRIPE_GRACE_MS + 10 }));
  assert.match(g.error, /Belum matang/);
  assert.equal(w.grid[19 * W + 5], T.SEED);
  // mature: harvest of the matching crop
  const h = applyEvent(w, normalizeEvent({ kind: 'punch', ...A, x: 5, y: 19, ts: p.readyAt }));
  assert.deepEqual(h, { ok: true, x: 5, y: 19, id: 0, broke: T.SEED, harvest: T.CROP });
  assert.equal(w.plants[String(19 * W + 5)], undefined);
  // unripe (far from ready): destroyed, no harvest
  applyEvent(w, normalizeEvent({ kind: 'place', ...A, x: 6, y: 19, id: T.SEED_AZURE, strict: true, ts: t0 }));
  const u = applyEvent(w, normalizeEvent({ kind: 'punch', ...A, x: 6, y: 19, ts: t0 + 1000 }));
  assert.equal(u.ok, true); assert.equal(u.harvest, undefined); assert.equal(u.broke, T.SEED_AZURE);
  // a seed without a plant record (placed before plant tracking) counts as mature
  w.grid[19 * W + 7] = T.SEED_EMBER;
  assert.equal(applyEvent(w, normalizeEvent({ kind: 'punch', ...A, x: 7, y: 19, ts: t0 })).harvest, T.CROP_EMBER);
  // crop tile: harvest itself
  w.grid[19 * W + 8] = T.CROP_MOON;
  assert.equal(applyEvent(w, normalizeEvent({ kind: 'punch', ...A, x: 8, y: 19, ts: t0 })).harvest, T.CROP_MOON);
  // legacy events (no ts): exactly the old behaviour, no plant records, no harvest flag
  const l1 = applyEvent(w, normalizeEvent({ kind: 'place', ...A, x: 9, y: 19, id: T.SEED }));
  assert.deepEqual(l1, { ok: true, x: 9, y: 19, id: T.SEED });
  assert.deepEqual(applyEvent(w, normalizeEvent({ kind: 'punch', ...A, x: 9, y: 19 })), { ok: true, x: 9, y: 19, id: 0, broke: T.SEED });
});

test('reducer: fertilize halves the remaining time once; only on growing seeds', () => {
  const w = flatWorld();
  const t0 = 5_000_000;
  const p = applyEvent(w, normalizeEvent({ kind: 'place', ...A, x: 3, y: 19, id: T.SEED_CRYSTAL, strict: true, ts: t0 }));
  const f = applyEvent(w, normalizeEvent({ kind: 'fertilize', ...A, x: 3, y: 19, ts: t0 + 4000, invOp: 'fertilize:ua:e1' }));
  assert.equal(f.ok, true);
  assert.equal(f.readyAt, t0 + 4000 + Math.floor((p.readyAt - t0 - 4000) * rules.FERTILIZER_FACTOR));
  assert.match(applyEvent(w, normalizeEvent({ kind: 'fertilize', ...A, x: 3, y: 19, ts: t0 + 5000 })).error, /Sudah dipupuk/);
  assert.match(applyEvent(w, normalizeEvent({ kind: 'fertilize', ...A, x: 4, y: 19, ts: t0 })).error, /Pupuk hanya/);
  assert.match(applyEvent(w, normalizeEvent({ kind: 'fertilize', ...A, x: 3, y: 19, ts: f.readyAt + 1 })).error, /Sudah dipupuk|sudah matang/);
  // locked world: only the owner edits
  w.lockOwnerId = 'other';
  assert.match(applyEvent(w, normalizeEvent({ kind: 'fertilize', ...A, x: 3, y: 19, ts: t0 })).error, /terkunci/);
  // normalizeEvent keeps the markers, clonePlants filters junk
  assert.deepEqual(normalizeEvent({ kind: 'fertilize', ...A, x: 1, y: 2, ts: 9, invOp: 'fertilize:ua:x', guest: true, junk: 1 }),
    { kind: 'fertilize', actorId: 'ua', actorName: 'alice', x: 1, y: 2, invOp: 'fertilize:ua:x', ts: 9, guest: true });
  assert.deepEqual(clonePlants({ 5: { r: 10, f: 1 }, x: { r: 1 }, 99999: { r: 1 }, 6: { r: 'no' } }), { 5: { r: 10, f: 1 } });
});

test('drops: deterministic per (world, seq), op id drop:<user>:<world>:<seq>, rules.rollBreak / rollHarvest', () => {
  const ev = { kind: 'punch', actorId: 'ua', x: 1, y: 2, seq: 42, ts: 1, invCredit: true };
  const r = { ok: true, x: 1, y: 2, id: 0, broke: T.DIRT };
  const e1 = inv.invEffectsForEvent('WORLDX', ev, r, null);
  const e2 = inv.invEffectsForEvent('WORLDX', ev, r, null);
  assert.deepEqual(e1, e2);
  const roll = rules.rollBreak(T.DIRT, inv.dropRng('WORLDX', 42));
  const items = {}; for (const it of roll.items) items[it.id] = (items[it.id] || 0) + it.n;
  if (roll.items.length || roll.gems) {
    assert.equal(e1.length, 1);
    assert.equal(e1[0].opId, 'drop:ua:WORLDX:42');
    assert.equal(e1[0].reason, 'break');
    assert.deepEqual(e1[0].ops.items, items);
    assert.equal(e1[0].ops.gems || 0, roll.gems);
  } else assert.deepEqual(e1, []);
  // over many seqs: dirt (farmable 0.92) drops itself most of the time; distribution sane
  let dirt = 0;
  for (let s = 1; s <= 2000; s++) {
    const e = inv.invEffectsForEvent('W', { ...ev, seq: s }, r, null)[0];
    if (e && e.ops.items[T.DIRT]) dirt++;
  }
  assert.ok(dirt > 1700 && dirt < 1980, `dirt drops ${dirt}`);
  // harvest: always crop + seed, reason harvest
  const h = inv.invEffectsForEvent('W', ev, { ok: true, x: 1, y: 2, id: 0, broke: T.SEED, harvest: T.CROP }, null)[0];
  assert.equal(h.reason, 'harvest');
  assert.ok(h.ops.items[T.CROP] === 1 && h.ops.items[T.SEED] >= 1);
  assert.equal(h.reward.harvest, true);
  // no drops: legacy event (no ts), not credited, guest flag carried, World Lock never rolls
  assert.deepEqual(inv.invEffectsForEvent('W', { ...ev, ts: undefined }, r, null), []);
  assert.deepEqual(inv.invEffectsForEvent('W', { ...ev, invCredit: false }, r, null), []);
  const ge = inv.invEffectsForEvent('W', { ...ev, invCredit: false, guest: true, seq: 7 }, r, null);
  assert.ok(ge.every((e) => e.guest === true));
  assert.deepEqual(inv.invEffectsForEvent('W', ev, { ...r, broke: T.WORLD_LOCK }, 'someone'), []);
  assert.equal(inv.invEffectsForEvent('W', ev, { ...r, broke: T.WORLD_LOCK }, 'ua')[0].reason, 'wl_break');
  // refunds: reason from the op kind; fertilize refunds a fertilizer
  assert.deepEqual(inv.invEffectsForEvent('W', { kind: 'fertilize', actorId: 'ua', invOp: 'fertilize:ua:e9' }, { error: 'x' }, null),
    [{ opId: 'refund:ua:fertilize:ua:e9', userId: 'ua', ops: { items: { [T.FERTILIZER]: 1 } }, reason: 'refund_fertilize' }]);
  assert.equal(inv.invEffectsForEvent('W', { kind: 'place', id: T.SEED, actorId: 'ua', invOp: 'plant:ua:e1' }, { error: 'x' }, null)[0].reason, 'refund_plant');
});

test('request ops: craft, splice, shop, quests, trades; error texts', () => {
  assert.deepEqual(inv.craftOps('plank').ops, { items: { [T.WOOD]: -2, [T.PLANK]: 1 } });
  assert.deepEqual(inv.craftOps('fertilizer').ops, { items: { [T.CROP]: -1, [T.DIRT]: -1, [T.FERTILIZER]: 2 } });
  assert.ok(inv.craftOps('nope').error);
  assert.deepEqual(inv.spliceOps(T.SEED, T.SEED_AZURE).ops, { items: { [T.SEED]: -1, [T.SEED_AZURE]: -1, [T.SEED_EMBER]: 1 } });
  assert.ok(inv.spliceOps(T.SEED, T.SEED).error);
  const sold = rules.storeStock()[0];
  assert.deepEqual(inv.buyOps(sold, 2).ops, { items: { [sold]: 2 }, gems: -2 * rules.buyPrice(sold) });
  assert.ok(inv.buyOps(T.CROP).error || rules.buyPrice(T.CROP) >= 0);
  assert.ok(inv.buyOps(sold, 0).error && inv.buyOps(sold, 101).error && inv.buyOps(9999).error);
  assert.deepEqual(inv.sellOps(T.DIRT, 3).ops, { items: { [T.DIRT]: -3 }, gems: 3 * rules.sellPrice(T.DIRT) });
  const q = inv.questClaimOps('plant_5');
  assert.deepEqual([q.countReason, q.goal, q.ops], ['plant', 5, { gems: 25, items: { [T.SEED_AZURE]: 4 } }]);
  assert.ok(inv.questClaimOps('x').error);
  const tr = inv.tradeOps({ items: [{ id: T.DIRT, n: 5 }], gems: 0 }, { items: [{ id: T.STONE, n: 2 }], gems: 7 });
  assert.deepEqual(tr, { a: { items: { [T.DIRT]: -5, [T.STONE]: 2 }, gems: 7 }, b: { items: { [T.STONE]: -2, [T.DIRT]: 5 }, gems: -7 } });
  assert.match(inv.invErrorText(`insufficient_item:${T.WOOD}`), /Wood/);
  assert.equal(inv.invErrorText('insufficient_gems'), 'Gems tidak cukup.');
});

test('guest kit: starter minus World Lock, idempotent, all-or-nothing', () => {
  const g = inv.createGuestWallet();
  assert.equal(g.items[T.WORLD_LOCK], undefined);
  assert.equal(g.items[T.DIRT], rules.STARTER_ITEMS[T.DIRT]);
  assert.deepEqual(inv.guestApply(g, 'a', { items: { [T.DIRT]: -1 } }).state.items[T.DIRT], rules.STARTER_ITEMS[T.DIRT] - 1);
  assert.equal(inv.guestApply(g, 'a', { items: { [T.DIRT]: -1 } }).dup, true);
  const bad = inv.guestApply(g, 'b', { items: { [T.DIRT]: -1, [T.PLANK]: -1 } });
  assert.equal(bad.error, `insufficient_item:${T.PLANK}`);
  assert.equal(g.items[T.DIRT], rules.STARTER_ITEMS[T.DIRT] - 1, 'nothing applied');
  assert.equal(inv.guestApply(g, 'c', { gems: -1000 }).error, 'insufficient_gems');
});

async function storeScenarios(t, store, { pg }) {
  const PREFIX = `ZZTEST_${crypto.randomBytes(3).toString('hex').toUpperCase()}_`;
  let n = 0;
  const uid = () => `${PREFIX}u${++n}`;
  const users = []; const trades = [];
  t.after(async () => {
    if (!pg) return;
    for (const tbl of ['inventory_ledger', 'inventory_items', 'wallets', 'quest_claims']) await store._query(`DELETE FROM ${tbl} WHERE user_id LIKE $1`, [`${PREFIX}%`]);
    await store._query('DELETE FROM trade_sessions WHERE id = ANY($1)', [trades]);
    const left = await store._query(`SELECT (SELECT count(*) FROM wallets WHERE user_id LIKE $1) + (SELECT count(*) FROM inventory_ledger WHERE user_id LIKE $1)
      + (SELECT count(*) FROM quest_claims WHERE user_id LIKE $1) + (SELECT count(*) FROM trade_sessions WHERE id = ANY($2)) AS c`, [`${PREFIX}%`, trades]);
    assert.equal(Number(left.rows[0].c), 0, 'test rows left behind');
  });
  const mk = async (items, gems = 0) => { const u = uid(); users.push(u); await store.invEnsure(u, { items, gems }); return u; };

  await t.test('quest claim: progress from ledger reasons (minus refunds), one-time, atomic', async () => {
    const u = await mk({ [T.SEED]: 10 });
    for (let i = 0; i < 4; i++) assert.equal((await store.invApply(`plant:${u}:${i}`, u, { items: { [T.SEED]: -1 } }, 'plant')).ok, true);
    await store.invApply(`refund:${u}:plant:${u}:3`, u, { items: { [T.SEED]: 1 } }, 'refund_plant');
    assert.equal(await store.invProgress(u, 'plant'), 3);
    const plan = inv.questClaimOps('plant_5');
    const args = { countReason: plan.countReason, goal: plan.goal, opId: `quest:${u}:plant_5`, ops: plan.ops };
    const r0 = await store.questClaim(u, 'plant_5', args);
    assert.deepEqual([r0.ok, r0.error, r0.progress], [false, 'not_complete', 3]);
    for (let i = 4; i < 6; i++) await store.invApply(`plant:${u}:${i}`, u, { items: { [T.SEED]: -1 } }, 'plant');
    const before = await store.invGet(u);
    const r1 = await store.questClaim(u, 'plant_5', args);
    assert.equal(r1.ok, true);
    assert.equal(r1.state.gems, before.gems + 25);
    assert.equal(r1.state.items[T.SEED_AZURE], 4);
    const r2 = await store.questClaim(u, 'plant_5', args);
    assert.equal(r2.error, 'already_claimed');
    assert.deepEqual(await store.questClaimed(u), ['plant_5']);
    assert.deepEqual((await store.invGet(u)).gems, before.gems + 25, 'credited once');
    if (pg) {
      // concurrent claims from two pools: exactly one wins
      const u2 = await mk({ [T.SEED]: 10 });
      for (let i = 0; i < 5; i++) await store.invApply(`plant:${u2}:${i}`, u2, { items: { [T.SEED]: -1 } }, 'plant');
      const other = createStore({ databaseUrl: URL_ });
      try {
        const a2 = { ...args, opId: `quest:${u2}:plant_5` };
        const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 ? other : store).questClaim(u2, 'plant_5', a2)));
        assert.equal(rs.filter((r) => r.ok).length, 1);
        assert.equal((await store.invGet(u2)).gems, 25);
      } finally { await other.close(); }
    }
  });

  const openTrade = async (a, b, offers) => {
    const id = crypto.randomBytes(6).toString('hex'); trades.push(id);
    let tr = await store.tradeCreate({ id, a, b, aName: 'a', bName: null, worldName: null, offers, ready: { [a]: false, [b]: false } });
    tr = await store.tradeUpdate(id, tr.version, { status: 'open' });
    tr = await store.tradeUpdate(id, tr.version, { ready: { [a]: true, [b]: true } });
    return tr;
  };
  await t.test('trade settle: both wallets + status atomically; insufficient side leaves everything unchanged', async () => {
    const a = await mk({ [T.DIRT]: 10 }, 5); const b = await mk({ [T.STONE]: 4 }, 20);
    const offers = { [a]: { items: [{ id: T.DIRT, n: 6 }], gems: 0 }, [b]: { items: [{ id: T.STONE, n: 3 }], gems: 9 } };
    const tr = await openTrade(a, b, offers);
    const ops = inv.tradeOps(offers[a], offers[b]);
    const r = await store.tradeSettle(tr.id, tr.version, ops.a, ops.b);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.trade.status, 'done');
    assert.deepEqual([r.invA.items, r.invA.gems], [{ [T.DIRT]: 4, [T.STONE]: 3 }, 14]);
    assert.deepEqual([r.invB.items, r.invB.gems], [{ [T.STONE]: 1, [T.DIRT]: 6 }, 11]);
    assert.equal((await store.tradeSettle(tr.id, tr.version, ops.a, ops.b)).error, 'conflict', 'settles once');
    // B no longer has the stones it offered -> nothing moves, trade stays open
    const tr2 = await openTrade(a, b, { [a]: { items: [{ id: T.DIRT, n: 1 }], gems: 0 }, [b]: { items: [{ id: T.STONE, n: 3 }], gems: 0 } });
    const ops2 = inv.tradeOps(tr2.offers[a], tr2.offers[b]);
    const wa = await store.invGet(a); const wb = await store.invGet(b);
    const bad = await store.tradeSettle(tr2.id, tr2.version, ops2.a, ops2.b);
    assert.deepEqual([bad.ok, bad.side, bad.error], [false, 'b', `insufficient_item:${T.STONE}`]);
    assert.deepEqual(await store.invGet(a), wa);
    assert.deepEqual(await store.invGet(b), wb);
    assert.equal((await store.tradeGet(tr2.id)).status, 'open');
    if (pg) {
      const { rows } = await store._query("SELECT count(*)::int AS c FROM inventory_ledger WHERE op_id LIKE $1", [`trade:%:${tr2.id}`]);
      assert.equal(rows[0].c, 0, 'no ledger rows from the failed settle');
    }
  });
}

test('steps 4-6 store: file backend', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-steps-'));
  const store = createStore({ dataDir: dir, databaseUrl: '' });
  await store.init();
  try { await storeScenarios(t, store, { pg: false }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('steps 4-6 store: postgres backend (migration v6)', { skip: pgSkip, timeout: 120000 }, async (t) => {
  const store = createStore({ databaseUrl: URL_ });
  await store.init();
  try { await storeScenarios(t, store, { pg: true }); } finally { /* closed after cleanup */ }
  t.after(() => store.close());
});
