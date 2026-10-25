'use strict';
/**
 * Server-authoritative inventory store (migration v4): invGet / invEnsure / invApply.
 * The same scenarios run against the file store (always) and Postgres (only when TEST_DATABASE_URL is
 * set — never DATABASE_URL — and never against the production host from server/.env).
 * Postgres rows use a random ZZTEST_ user prefix and are deleted afterwards.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore, MIGRATIONS } = require('../lib/store');
const rules = require('../lib/rules');

const URL_ = process.env.TEST_DATABASE_URL || '';
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const prodHost = (() => {
  try {
    const m = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').match(/^\s*DATABASE_URL\s*=\s*['"]?([^'"\r\n]+)/m);
    return m ? hostOf(m[1]) : '';
  } catch { return ''; }
})();
const pgSkip = !URL_ ? 'TEST_DATABASE_URL not set' : (prodHost && hostOf(URL_) === prodHost) ? 'refusing to run against production' : false;

const T = rules.TILE;
const PREFIX = `ZZTEST_${crypto.randomBytes(3).toString('hex').toUpperCase()}_`;
let n = 0;
const uid = () => `${PREFIX}u${++n}`;
const op = (u, s) => `test:${u}:${s}`;

async function scenarios(t, store, { pg = false } = {}) {
  await t.test('invGet null without wallet; invEnsure creates once and never overwrites', async () => {
    const u = uid();
    assert.equal(await store.invGet(u), null);
    const a = await store.invEnsure(u, rules.starterInventory(), 'starter');
    assert.equal(a.created, true);
    assert.deepEqual(a.state, { ver: 1, gems: 25, items: Object.fromEntries(Object.entries(rules.STARTER_ITEMS).map(([k, v]) => [k, v])) });
    const b = await store.invEnsure(u, { gems: 999, items: { [T.WORLD_LOCK]: 50 } }, 'profile');
    assert.equal(b.created, false);
    assert.deepEqual(b.state, a.state);
    if (pg) {
      const { rows } = await store._query('SELECT op_id, reason, delta FROM inventory_ledger WHERE user_id = $1', [u]);
      assert.deepEqual(rows.map((r) => [r.op_id, r.reason]), [[`seed:${u}`, 'seed:starter']]);
      assert.deepEqual(rows[0].delta, rules.starterInventory());
    }
    // seed sanitizing: unknown ids / non-positive counts dropped, clamped to caps
    const u2 = uid();
    const c = await store.invEnsure(u2, { gems: -5, items: { 999: 3, [T.DIRT]: 0, [T.STONE]: 10 ** 9, [T.AIR]: 4 } });
    assert.deepEqual(c.state, { ver: 1, gems: 0, items: { [T.STONE]: rules.INV_ITEM_MAX } });
  });

  await t.test('credit/debit items and gems; ver bumps once per applied op', async () => {
    const u = uid();
    await store.invEnsure(u, { gems: 10, items: { [T.DIRT]: 5 } });
    const r1 = await store.invApply(op(u, 1), u, { items: { [T.DIRT]: -2, [T.TORCH]: 3 }, gems: 7 }, 'test');
    assert.deepEqual(r1, { ok: true, dup: false, ver: 2, gems: 17, items: { [T.DIRT]: 3, [T.TORCH]: 3 } });
    const r2 = await store.invApply(op(u, 2), u, { items: { [T.DIRT]: -3 }, gems: -17 }, 'test');
    assert.deepEqual(r2, { ok: true, dup: false, ver: 3, gems: 0, items: { [T.TORCH]: 3 } }); // zero rows disappear
    assert.deepEqual(await store.invGet(u), { ver: 3, gems: 0, items: { [T.TORCH]: 3 } });
  });

  await t.test('same op_id twice is applied once', async () => {
    const u = uid();
    await store.invEnsure(u, { gems: 0, items: {} });
    const a = await store.invApply(op(u, 'x'), u, { items: { [T.WORLD_LOCK]: 1 }, gems: 5 });
    const b = await store.invApply(op(u, 'x'), u, { items: { [T.WORLD_LOCK]: 1 }, gems: 5 });
    assert.equal(a.dup, false);
    assert.deepEqual(b, { ...a, dup: true });
    assert.deepEqual(await store.invGet(u), { ver: 2, gems: 5, items: { [T.WORLD_LOCK]: 1 } });
  });

  await t.test('multi-op atomicity: one short op => nothing applied; failed op_id can be retried', async () => {
    const u = uid();
    await store.invEnsure(u, { gems: 50, items: { [T.DIRT]: 4, [T.WOOD]: 2 } });
    const before = await store.invGet(u);
    const r = await store.invApply(op(u, 'a'), u, { items: { [T.DIRT]: -1, [T.WOOD]: -1, [T.FERTILIZER]: -1, [T.PLANK]: 2 }, gems: -10 });
    assert.equal(r.ok, false);
    assert.equal(r.error, `insufficient_item:${T.FERTILIZER}`);
    assert.deepEqual(await store.invGet(u), before);
    const g = await store.invApply(op(u, 'b'), u, { items: { [T.PLANK]: 1, [T.DIRT]: -1 }, gems: -51 });
    assert.equal(g.error, 'insufficient_gems');
    assert.deepEqual(await store.invGet(u), before);
    await store.invApply(op(u, 'c'), u, { items: { [T.FERTILIZER]: 1 } });
    const retry = await store.invApply(op(u, 'a'), u, { items: { [T.DIRT]: -1, [T.WOOD]: -1, [T.FERTILIZER]: -1, [T.PLANK]: 2 }, gems: -10 });
    assert.deepEqual(retry, { ok: true, dup: false, ver: before.ver + 2, gems: 40, items: { [T.DIRT]: 3, [T.WOOD]: 1, [T.PLANK]: 2 } });
  });

  await t.test('negative balances impossible; caps enforced all-or-nothing', async () => {
    const u = uid();
    await store.invEnsure(u, { gems: 1, items: { [T.SAND]: 1 } });
    assert.equal((await store.invApply(op(u, 1), u, { items: { [T.SAND]: -2 } })).error, `insufficient_item:${T.SAND}`);
    assert.equal((await store.invApply(op(u, 2), u, { items: { [T.STONE]: -1 } })).error, `insufficient_item:${T.STONE}`);
    assert.equal((await store.invApply(op(u, 3), u, { gems: -2 })).error, 'insufficient_gems');
    const cap = await store.invApply(op(u, 4), u, { items: { [T.SAND]: rules.INV_ITEM_MAX, [T.DIRT]: 1 } });
    assert.equal(cap.error, `cap_item:${T.SAND}`);
    await store.invApply(op(u, 5), u, { gems: rules.INV_GEMS_MAX - 1 });
    assert.equal((await store.invApply(op(u, 6), u, { gems: 1, items: { [T.DIRT]: 1 } })).error, 'cap_gems');
    assert.deepEqual(await store.invGet(u), { ver: 2, gems: rules.INV_GEMS_MAX, items: { [T.SAND]: 1 } });
    if (pg) {
      await assert.rejects(store._query('UPDATE inventory_items SET n = -1 WHERE user_id = $1', [u]), /check/i);
      await assert.rejects(store._query('UPDATE wallets SET gems = -1 WHERE user_id = $1', [u]), /check/i);
    }
  });

  await t.test('invalid input rejected before touching the store', async () => {
    const u = uid();
    assert.equal((await store.invApply(op(u, 1), u, { gems: 1 })).error, 'no_wallet');
    await store.invEnsure(u, { gems: 0, items: {} });
    assert.equal((await store.invApply(op(u, 2), u, { items: { 999: 1 } })).error, 'bad_item');
    assert.equal((await store.invApply(op(u, 3), u, { items: { [T.AIR]: 1 } })).error, 'bad_item');
    assert.equal((await store.invApply(op(u, 4), u, { items: { [T.DIRT]: 1.5 } })).error, 'bad_ops');
    assert.equal((await store.invApply(op(u, 5), u, { gems: 'x' })).error, 'bad_ops');
    assert.equal((await store.invApply(op(u, 6), u, null)).error, 'bad_ops');
    assert.equal((await store.invApply('', u, { gems: 1 })).error, 'bad_op_id');
    assert.equal((await store.invApply('x'.repeat(201), u, { gems: 1 })).error, 'bad_op_id');
    assert.equal((await store.invApply('test:someone-else:1', u, { gems: 1 })).error, 'bad_op_id'); // op_id must carry the user id
    assert.equal((await store.invApply(`test${u}:1`, u, { gems: 1 })).error, 'bad_op_id'); // as a whole ':' segment
    assert.deepEqual(await store.invGet(u), { ver: 1, gems: 0, items: {} });
  });

  await t.test('parallel decrements of the last item: exactly one succeeds', async () => {
    const u = uid();
    await store.invEnsure(u, { gems: 0, items: { [T.WORLD_LOCK]: 1 } });
    const res = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      store.invApply(op(u, `place${i}`), u, { items: { [T.WORLD_LOCK]: -1 } }, 'place')));
    assert.equal(res.filter((r) => r.ok).length, 1);
    assert.equal(res.filter((r) => r.error === `insufficient_item:${T.WORLD_LOCK}`).length, 7);
    assert.deepEqual(await store.invGet(u), { ver: 2, gems: 0, items: {} });
  });

  await t.test('parallel same op_id: applied exactly once', async () => {
    const u = uid();
    await store.invEnsure(u, { gems: 0, items: {} });
    const res = await Promise.all(Array.from({ length: 6 }, () =>
      store.invApply(op(u, 'same'), u, { gems: 3, items: { [T.TORCH]: 2 } }, 'reward')));
    assert.ok(res.every((r) => r.ok));
    assert.equal(res.filter((r) => !r.dup).length, 1);
    assert.deepEqual(await store.invGet(u), { ver: 2, gems: 3, items: { [T.TORCH]: 2 } });
    if (pg) {
      const { rows } = await store._query("SELECT reason, delta FROM inventory_ledger WHERE user_id = $1 AND op_id NOT LIKE 'seed:%'", [u]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].reason, 'reward');
      assert.deepEqual(rows[0].delta, { items: { [T.TORCH]: 2 }, gems: 3 });
    }
  });

  await t.test('two users are independent', async () => {
    const a = uid(); const b = uid();
    await store.invEnsure(a, { gems: 5, items: {} });
    await store.invEnsure(b, { gems: 5, items: {} });
    await Promise.all([store.invApply(op(a, 1), a, { gems: -5 }), store.invApply(op(b, 1), b, { gems: 5 })]);
    assert.equal((await store.invGet(a)).gems, 0);
    assert.equal((await store.invGet(b)).gems, 10);
  });
}

test('inventory store: file backend', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxt-inv-'));
  const store = createStore({ dataDir: dir, databaseUrl: '' });
  await store.init();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await scenarios(t, store);
  // persisted across a fresh store instance on the same dir
  const again = createStore({ dataDir: dir, databaseUrl: '' });
  assert.equal((await again.invGet(`${PREFIX}u2`)).items[T.STONE], rules.INV_ITEM_MAX);
});

test('inventory store: postgres backend (migration v4 + inv_apply)', { skip: pgSkip }, async (t) => {
  const store = createStore({ databaseUrl: URL_ });
  await store.init();
  await store.init(); // idempotent
  t.after(async () => {
    for (const tbl of ['inventory_ledger', 'inventory_items', 'wallets', 'quest_claims']) {
      await store._query(`DELETE FROM ${tbl} WHERE user_id LIKE $1`, [`${PREFIX}%`]);
      const left = await store._query(`SELECT count(*)::int AS c FROM ${tbl} WHERE user_id LIKE $1`, [`${PREFIX}%`]);
      assert.equal(left.rows[0].c, 0, `${tbl} test rows left`);
    }
    await store.close();
  });
  await t.test('schema present', async () => {
    const { rows } = await store._query(`SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('wallets','inventory_items','inventory_ledger','quest_claims') ORDER BY 1`);
    assert.deepEqual(rows.map((r) => r.table_name), ['inventory_items', 'inventory_ledger', 'quest_claims', 'wallets']);
    const f = await store._query(`SELECT proname FROM pg_proc WHERE proname IN ('inv_apply','inv_state') ORDER BY 1`);
    assert.deepEqual(f.rows.map((r) => r.proname), ['inv_apply', 'inv_state']);
  });
  await t.test('migration v4 SQL is re-runnable (CREATE IF NOT EXISTS / OR REPLACE), checked in a rolled-back txn', async () => {
    const v4 = MIGRATIONS[3];
    assert.match(v4, /CREATE OR REPLACE FUNCTION inv_apply/);
    await store._query(`BEGIN; ${v4}; ${v4}; ROLLBACK;`);
  });
  await scenarios(t, store, { pg: true });
});
