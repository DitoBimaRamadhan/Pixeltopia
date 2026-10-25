'use strict';
/**
 * SERVER_INV step 3: paid place (debit + log append in one transaction), refunds for paid places that
 * lose in the log, owner World Lock break credit, strict placement. Two sync "instances" share one store:
 * the file store always, Postgres only with TEST_DATABASE_URL (never DATABASE_URL / the production host).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../lib/store');
const { createWorldManager, applyEvent, normalizeEvent, W } = require('../lib/world_manager');
const { createWorldSync } = require('../lib/world_sync');
const inv = require('../lib/inv_server');
const rules = require('../lib/rules');

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
const RND = crypto.randomBytes(3).toString('hex').toUpperCase();
const PREFIX = `ZZTEST_${RND}_`;
const quiet = { log() {}, warn() {}, error() {} };

// ------------------------------------------------------------------ pure parts
function blankWorld() {
  const grid = new Int32Array(W * 40);
  for (let x = 0; x < W; x++) { grid[30 * W + x] = T.DIRT; grid[31 * W + x] = T.STONE; }
  return { grid, lockOwnerId: null, lockOwnerName: null, access: [] };
}
test('strict place: placeable ids only, seeds only on soil; non-strict events unchanged', () => {
  const w = blankWorld();
  const place = (x, y, id, strict = true) => applyEvent(w, { kind: 'place', actorId: 'p', actorName: 'p', x, y, id, strict });
  assert.ok(place(1, 29, T.SEED).ok, 'seed on dirt');
  assert.match(place(2, 20, T.SEED).error, /tidak bisa/, 'seed in mid-air');
  assert.ok(place(3, 20, T.DIRT).ok, 'block anywhere');
  for (const bad of [T.AIR, T.FERTILIZER, T.CROP, 999, -3]) assert.match(place(4, 20, bad).error, /tidak bisa/, `id ${bad}`);
  assert.ok(place(5, 20, T.FERTILIZER, false).ok, 'old events (no strict) keep the old rule');
  const e = normalizeEvent({ kind: 'place', actorId: 'p', x: 1, y: 2, id: 3 });
  assert.deepEqual(Object.keys(e).sort(), ['actorId', 'id', 'kind', 'x', 'y'], 'no markers unless set');
  assert.deepEqual(normalizeEvent({ kind: 'place', actorId: 'p', x: 1, y: 2, id: 3, strict: 1, invOp: 'place:p:1' }).invOp, 'place:p:1');
  assert.equal(normalizeEvent({ kind: 'punch', actorId: 'p', x: 1, y: 2, invCredit: true }).invCredit, true);
  assert.equal(normalizeEvent({ kind: 'punch', actorId: 'p', x: 1, y: 2, invOp: 'x' }).invOp, undefined);
});

test('invEffectsForEvent: refund rejected paid places, credit owner World Lock breaks only', () => {
  const place = { kind: 'place', actorId: 'u1', id: T.DIRT, invOp: 'place:u1:A:n:1', seq: 7 };
  assert.deepEqual(inv.invEffectsForEvent('W', place, { error: 'Tile tidak kosong' }, null),
    [{ opId: 'refund:u1:place:u1:A:n:1', userId: 'u1', ops: { items: { [T.DIRT]: 1 } }, reason: 'refund_place' }]);
  assert.deepEqual(inv.invEffectsForEvent('W', place, { ok: true }, null), []);
  assert.deepEqual(inv.invEffectsForEvent('W', { ...place, invOp: undefined }, { error: 'x' }, null), [], 'unpaid place: nothing');
  const punch = { kind: 'punch', actorId: 'u1', invCredit: true, seq: 9 };
  const broke = { ok: true, broke: T.WORLD_LOCK };
  assert.deepEqual(inv.invEffectsForEvent('W', punch, broke, 'u1'),
    [{ opId: 'wlbreak:u1:W:9', userId: 'u1', ops: { items: { [T.WORLD_LOCK]: 1 } }, reason: 'wl_break' }]);
  assert.deepEqual(inv.invEffectsForEvent('W', punch, broke, null), [], 'ownerless lock tile');
  assert.deepEqual(inv.invEffectsForEvent('W', punch, broke, 'u2'), [], 'not the owner');
  assert.deepEqual(inv.invEffectsForEvent('W', { ...punch, invCredit: false }, broke, 'u1'), [], 'unmarked (flag off / guest)');
  assert.deepEqual(inv.invEffectsForEvent('W', punch, { ok: true, broke: T.DIRT }, 'u1'), []);
});

// ------------------------------------------------------------------ two instances on one store
function instance(store, id) {
  const worlds = createWorldManager();
  const sent = [];
  const effects = [];
  const sync = createWorldSync({
    store, worlds, instanceId: id, log: quiet,
    broadcastWorld: (w, msg) => { for (const p of w.players.values()) sent.push({ to: p.id, msg }); },
    deliverToPlayer: (pid, msg) => sent.push({ to: pid, msg }),
    localPlayers: () => [], kickPlayer: () => {},
    // mirrors index.js onInvEventApplied
    onEventApplied: (w, ev, r, ctx) => { for (const e of inv.invEffectsForEvent(w.name, ev, r, ctx.prevLockOwnerId)) effects.push(store.invApply(e.opId, e.userId, e.ops, e.reason)); },
  });
  const join = (w, pid) => { worlds.join(w, { id: pid, username: pid, x: 0, y: 0 }); };
  // mirrors the index.js place handler with SERVER_INV=1
  const paidPlace = (w, pid, x, y, id, invLog) => sync.submit(w, { kind: 'place', actorId: pid, actorName: pid, x, y, id, strict: true }, {
    inv: { userId: pid, ops: { items: { [id]: -1 } }, reason: 'place' },
    onInv: (st) => invLog && invLog.push(st),
    failMessage: (e) => (String(e).startsWith('insufficient_item') ? 'Item tidak cukup' : null),
  });
  return { worlds, sync, sent, effects, join, paidPlace, id };
}
const findAir = (grid, skip = []) => {
  for (let i = W * 3; i < grid.length - W; i++) {
    if (grid[i] === 0 && rules.isSoil(grid[i + W]) && !skip.includes(i)) return { x: i % W, y: (i / W) | 0, i };
  }
  throw new Error('no air');
};
async function settle(A, B) {
  await Promise.all([A.sync.flushAppends(), B.sync.flushAppends()]);
  await A.sync.pollOnce(); await B.sync.pollOnce();
  await Promise.all([...A.effects, ...B.effects]);
}

async function scenarios(t, storeA, storeB, { pg = false, worldPrefix }) {
  const A = instance(storeA, `A-${RND}`); const B = instance(storeB, `B-${RND}`);
  const uid = (s) => `${PREFIX}${s}`;
  const headOf = async (name) => (await storeA.fetchEventsMulti([{ world: name, after: 0 }])).heads[name].headSeq;

  await t.test('race: both place on the same tile, loser is refunded, nobody pays twice', async () => {
    const pa = uid('ra'); const pb = uid('rb');
    await storeA.invEnsure(pa, { gems: 0, items: { [T.DIRT]: 1 } });
    await storeA.invEnsure(pb, { gems: 0, items: { [T.DIRT]: 1 } });
    const name = `${worldPrefix}R`;
    const wa = (await A.sync.ensureWorld(name, { create: true })).world;
    const wb = (await B.sync.ensureWorld(name, { create: true })).world;
    A.join(wa, pa); B.join(wb, pb);
    const c = findAir(wa.grid);
    const head0 = await headOf(name);
    assert.ok(!A.paidPlace(wa, pa, c.x, c.y, T.DIRT).error);
    assert.ok(!B.paidPlace(wb, pb, c.x, c.y, T.DIRT).error, 'both optimistic');
    await settle(A, B);
    assert.equal(await headOf(name), head0 + 2, 'both paid places were appended');
    assert.deepEqual(Array.from(wa.grid), Array.from(wb.grid));
    assert.equal(wa.grid[c.i], T.DIRT);
    const [sa, sb] = [await storeA.invGet(pa), await storeA.invGet(pb)];
    assert.deepEqual([sa.items[T.DIRT] || 0, sb.items[T.DIRT] || 0].sort(), [0, 1], 'one paid, the other refunded');
    const loser = (sa.items[T.DIRT] || 0) === 1 ? pa : pb;
    assert.equal((loser === pa ? sa : sb).ver, 3, 'loser: seed ver1 -> debit ver2 -> refund ver3 (refund applied once although both instances ran it)');
    assert.equal((loser === pa ? sb : sa).ver, 2);
    const loserInst = loser === pa ? A : B;
    assert.ok(loserInst.sent.some((s) => s.to === loser && s.msg.t === 'error' && /Tile tidak kosong/.test(s.msg.error)), 'loser told');
    if (pg) {
      const { rows } = await storeA._query("SELECT split_part(op_id, ':', 1) AS k FROM inventory_ledger WHERE user_id = $1 AND op_id NOT LIKE 'seed:%' ORDER BY k", [loser]);
      assert.deepEqual(rows.map((r) => r.k), ['place', 'refund']);
    }
    // replaying the log (fresh instance loading the world) must not refund again
    const C = instance(storeB, `C-${RND}`);
    await C.sync.ensureWorld(name);
    await Promise.all(C.effects);
    assert.ok(C.effects.length >= 1, 'replay recomputed the refund');
    assert.equal((await storeA.invGet(loser)).ver, 3, 'but it was a no-op (same op_id)');
  });

  await t.test('not enough items: nothing appended, tile reverted, "Item tidak cukup"', async () => {
    const pc = uid('nc');
    await storeA.invEnsure(pc, { gems: 0, items: { [T.STONE]: 1 } });
    const name = `${worldPrefix}N`;
    const wa = (await A.sync.ensureWorld(name, { create: true })).world;
    A.join(wa, pc);
    const c = findAir(wa.grid);
    const head0 = await headOf(name);
    const invs = [];
    assert.ok(!A.paidPlace(wa, pc, c.x, c.y, T.DIRT, invs).error, 'optimistic echo');
    assert.equal(wa.grid[c.i], T.DIRT);
    await A.sync.flushAppends();
    assert.equal(wa.grid[c.i], 0, 'reverted');
    assert.equal(await headOf(name), head0, 'no event appended');
    assert.ok(A.sent.some((s) => s.to === pc && s.msg.t === 'error' && s.msg.error === 'Item tidak cukup'));
    assert.ok(A.sent.some((s) => s.msg.t === 'tile' && s.msg.x === c.x && s.msg.y === c.y && s.msg.id === 0), 'correction broadcast');
    assert.deepEqual(invs.at(-1), { ver: 1, gems: 0, items: { [T.STONE]: 1 } }, 'wallet state pushed back');
    // strict rule is checked before paying: seed in mid-air is refused immediately
    const r = A.paidPlace(wa, pc, c.x, 3, T.SEED);
    assert.match(r.error, /tidak bisa/);
    await A.sync.flushAppends();
    assert.equal(await headOf(name), head0);
    // no wallet at all: refused the same way, nothing appended
    const ghost = uid('ghost');
    assert.ok(!A.paidPlace(wa, ghost, c.x, c.y, T.DIRT).error);
    await A.sync.flushAppends();
    assert.equal(await headOf(name), head0);
    assert.equal(wa.grid[c.i], 0);
  });

  await t.test('owner breaking their own World Lock gets it back (100%), exactly once', async () => {
    const po = uid('wl'); const px = uid('wx');
    await storeA.invEnsure(po, { gems: 0, items: { [T.WORLD_LOCK]: 1 } });
    await storeA.invEnsure(px, { gems: 0, items: { [T.WORLD_LOCK]: 1 } });
    const name = `${worldPrefix}L`;
    const wa = (await A.sync.ensureWorld(name, { create: true })).world;
    const wb = (await B.sync.ensureWorld(name, { create: true })).world;
    A.join(wa, po); B.join(wb, px);
    const c = findAir(wa.grid);
    const invs = [];
    assert.ok(!A.paidPlace(wa, po, c.x, c.y, T.WORLD_LOCK, invs).error);
    await settle(A, B);
    assert.equal(wb.lockOwnerId, po);
    assert.equal((await storeA.invGet(po)).items[T.WORLD_LOCK] || 0, 0, 'paid');
    assert.equal(invs.at(-1).items[T.WORLD_LOCK] || 0, 0, 'pushed');
    // someone else cannot break it (reducer), and gets nothing
    assert.ok(B.sync.submit(wb, { kind: 'punch', actorId: px, actorName: px, x: c.x, y: c.y, invCredit: true }).error);
    // owner breaks it
    assert.ok(!A.sync.submit(wa, { kind: 'punch', actorId: po, actorName: po, x: c.x, y: c.y, invCredit: true }).error);
    await settle(A, B);
    assert.equal(wb.lockOwnerId, null);
    const st = await storeA.invGet(po);
    assert.equal(st.items[T.WORLD_LOCK], 1, 'World Lock back');
    assert.equal(st.ver, 3);
    assert.equal((await storeA.invGet(px)).items[T.WORLD_LOCK], 1, 'bystander unchanged');
    // place again + break WITHOUT the credit marker (guest / flag off): no credit
    assert.ok(!A.paidPlace(wa, po, c.x, c.y, T.WORLD_LOCK).error);
    await settle(A, B);
    assert.ok(!A.sync.submit(wa, { kind: 'punch', actorId: po, actorName: po, x: c.x, y: c.y }).error);
    await settle(A, B);
    assert.equal((await storeA.invGet(po)).items[T.WORLD_LOCK] || 0, 0);
  });

  await t.test('double-paid race on the last item: two places, one item => one appended, one "Item tidak cukup"', async () => {
    const pd = uid('dd');
    await storeA.invEnsure(pd, { gems: 0, items: { [T.WOOD]: 1 } });
    const name = `${worldPrefix}D`;
    const wa = (await A.sync.ensureWorld(name, { create: true })).world;
    const wb = (await B.sync.ensureWorld(name, { create: true })).world;
    A.join(wa, pd); B.join(wb, pd);
    const c1 = findAir(wa.grid); const c2 = findAir(wa.grid, [c1.i]);
    const head0 = await headOf(name);
    A.paidPlace(wa, pd, c1.x, c1.y, T.WOOD); B.paidPlace(wb, pd, c2.x, c2.y, T.WOOD);
    await settle(A, B);
    assert.equal(await headOf(name), head0 + 1);
    assert.equal(Array.from(wa.grid).filter((v, i) => (i === c1.i || i === c2.i) && v === T.WOOD).length, 1);
    assert.deepEqual(Array.from(wa.grid), Array.from(wb.grid));
    assert.equal((await storeA.invGet(pd)).items[T.WOOD] || 0, 0);
    assert.equal([...A.sent, ...B.sent].filter((s) => s.to === pd && s.msg.error === 'Item tidak cukup').length, 1);
  });
  return { A, B };
}

test('paid place + refunds: file store (two instances)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxt-invplace-'));
  const store = createStore({ dataDir: dir, databaseUrl: '' });
  await store.init();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await scenarios(t, store, store, { worldPrefix: `ZZT${RND}` });
  await t.test('appendEventInv: dup op_id appends nothing; missing world => null, no debit', async () => {
    const u = `${PREFIX}fs`;
    await store.invEnsure(u, { gems: 0, items: { [T.DIRT]: 5 } });
    await store.createWorldIfAbsent({ name: `ZZT${RND}X`, seed: 1, grid: new Int32Array(W * 40), spawn: { x: 1, y: 1 }, access: [], createdAt: Date.now() });
    const ev = { kind: 'place', actorId: u, actorName: u, x: 1, y: 1, id: T.DIRT };
    const one = { opId: `place:${u}:1`, userId: u, ops: { items: { [T.DIRT]: -1 } }, reason: 'place' };
    const a = await store.appendEventInv(`ZZT${RND}X`, ev, 'i', one);
    const b = await store.appendEventInv(`ZZT${RND}X`, ev, 'i', one);
    assert.equal(a.ok && !a.dup && a.event.seq, 1);
    assert.deepEqual([b.ok, b.dup, b.event], [true, true, null]);
    assert.equal(await store.appendEventInv(`ZZT${RND}NOPE`, ev, 'i', { ...one, opId: `place:${u}:2` }), null);
    assert.equal((await store.invGet(u)).items[T.DIRT], 4);
  });
});

test('paid place + refunds: postgres (two instances, two pools)', { skip: pgSkip, timeout: 120000 }, async (t) => {
  const s1 = createStore({ databaseUrl: URL_ });
  const s2 = createStore({ databaseUrl: URL_ });
  await s1.init(); await s2.init();
  const wp = `ZZT${RND}`;
  t.after(async () => {
    for (const tbl of ['inventory_ledger', 'inventory_items', 'wallets']) await s1._query(`DELETE FROM ${tbl} WHERE user_id LIKE $1`, [`${PREFIX}%`]);
    await s1._query('DELETE FROM world_events WHERE world LIKE $1', [`${wp}%`]);
    await s1._query('DELETE FROM world_presence WHERE world LIKE $1', [`${wp}%`]);
    await s1._query('DELETE FROM worlds WHERE name LIKE $1', [`${wp}%`]);
    const left = await s1._query(`SELECT (SELECT count(*) FROM wallets WHERE user_id LIKE $1) + (SELECT count(*) FROM inventory_ledger WHERE user_id LIKE $1)
      + (SELECT count(*) FROM worlds WHERE name LIKE $2) + (SELECT count(*) FROM world_events WHERE world LIKE $2) AS c`, [`${PREFIX}%`, `${wp}%`]);
    assert.equal(Number(left.rows[0].c), 0, 'test rows left behind');
    await s1.close(); await s2.close();
  });
  await t.test('append_event_inv present (migration v5)', async () => {
    const { rows } = await s1._query("SELECT 1 FROM pg_proc WHERE proname = 'append_event_inv'");
    assert.equal(rows.length, 1);
  });
  await scenarios(t, s1, s2, { pg: true, worldPrefix: wp });
  await t.test('raw: 10 parallel paid appends of the last item over two pools => exactly one event, one debit', async () => {
    const u = `${PREFIX}raw`;
    await s1.invEnsure(u, { gems: 0, items: { [T.TORCH]: 1 } });
    const name = `${wp}P`;
    await s1.createWorldIfAbsent({ name, seed: 1, grid: new Int32Array(W * 40), spawn: { x: 1, y: 1 }, access: [], createdAt: Date.now() });
    const head0 = (await s1.fetchEventsMulti([{ world: name, after: 0 }])).heads[name].headSeq;
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? s2 : s1).appendEventInv(name,
      { kind: 'place', actorId: u, actorName: u, x: i, y: 1, id: T.TORCH }, 'raw', { opId: `place:${u}:${i}`, userId: u, ops: { items: { [T.TORCH]: -1 } }, reason: 'place' })));
    assert.equal(res.filter((r) => r && r.ok).length, 1);
    assert.equal(res.filter((r) => r && r.error === `insufficient_item:${T.TORCH}`).length, 9);
    const head1 = (await s1.fetchEventsMulti([{ world: name, after: 0 }])).heads[name].headSeq;
    assert.equal(head1, head0 + 1, 'only the paid one was appended');
    assert.equal((await s1.invGet(u)).items[T.TORCH] || 0, 0);
    // missing world: whole transaction rolled back (no debit)
    await s1.invApply(`grant:${u}:1`, u, { items: { [T.TORCH]: 1 } });
    assert.equal(await s1.appendEventInv(`${wp}NOPE`, { kind: 'place', actorId: u, x: 1, y: 1, id: T.TORCH }, 'raw',
      { opId: `place:${u}:x`, userId: u, ops: { items: { [T.TORCH]: -1 } }, reason: 'place' }), null);
    assert.equal((await s1.invGet(u)).items[T.TORCH], 1);
  });
});
