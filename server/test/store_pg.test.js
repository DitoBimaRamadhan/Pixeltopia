'use strict';
/**
 * Postgres integration tests for the v2 sync store methods.
 * Runs ONLY when TEST_DATABASE_URL is set (deliberately NOT DATABASE_URL, so a loaded server/.env
 * can never point these tests at production). Example:
 *   set -a; . /path/to/sync-test.env; set +a
 *   TEST_DATABASE_URL="$DATABASE_URL" node --test server/test
 * All rows use a random ZZTEST_ world prefix and are deleted afterwards.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createStore } = require('../lib/store');
const { generateGrid, applyEvent, createWorldManager } = require('../lib/world_manager');

const URL_ = process.env.TEST_DATABASE_URL || '';
// Never run against the production database configured in server/.env (compared by host, never printed).
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const prodHost = (() => {
  try {
    const m = require('fs').readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8').match(/^\s*DATABASE_URL\s*=\s*['"]?([^'"\r\n]+)/m);
    return m ? hostOf(m[1]) : '';
  } catch { return ''; }
})();
const skip = !URL_ ? 'TEST_DATABASE_URL not set' : (prodHost && hostOf(URL_) === prodHost) ? 'refusing to run against production' : false;

const PREFIX = `ZZTEST_${crypto.randomBytes(3).toString('hex').toUpperCase()}_`;
const newWorld = (name, seed = 7) => { const g = generateGrid(seed); return { name, seed: g.seed, grid: g.grid, spawn: g.spawn, access: [], createdAt: Date.now() }; };

test('pg sync store', { skip }, async (t) => {
  const store = createStore({ databaseUrl: URL_ });
  const raw = (sql, params) => store._query(sql, params);
  await store.init();
  await store.init(); // idempotent: second boot must not re-apply / fail
  t.after(async () => {
    await raw('DELETE FROM world_events WHERE world LIKE $1', [`${PREFIX}%`]);
    await raw('DELETE FROM world_presence WHERE world LIKE $1', [`${PREFIX}%`]);
    await raw('DELETE FROM worlds WHERE name LIKE $1', [`${PREFIX}%`]);
    await raw('DELETE FROM trade_sessions WHERE a_id LIKE $1 OR b_id LIKE $1', [`${PREFIX}%`]);
    await raw('DELETE FROM active_sessions WHERE user_id LIKE $1', [`${PREFIX}%`]);
    await raw('DELETE FROM users WHERE id LIKE $1', [`${PREFIX}%`]); // cascades to profiles
    await store.close();
  });

  await t.test('migration v2 applied once', async () => {
    const { rows } = await raw('SELECT version FROM schema_migrations ORDER BY version');
    assert.deepEqual(rows.map((r) => Number(r.version)), [1, 2, 3, 4, 5, 6, 7]);
    const cols = await raw(`SELECT table_name, column_name FROM information_schema.columns
      WHERE (table_name='worlds' AND column_name IN ('head_seq','snapshot_seq')) OR (table_name='profiles' AND column_name='rev')`);
    assert.equal(cols.rows.length, 3);
    const tabs = await raw(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('world_events','world_presence','trade_sessions')`);
    assert.equal(tabs.rows.length, 3);
    const v7 = await raw(`SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name='worlds' AND column_name='settings')
      + (SELECT count(*) FROM information_schema.tables WHERE table_name IN ('friends','private_messages')) AS c`);
    assert.equal(Number(v7.rows[0].c), 3);
  });

  await t.test('existing worlds still load via loadWorlds (old path unchanged)', async () => {
    const all = await store.loadWorlds();
    assert.ok(all.some((w) => w.name === 'START'));
  });

  await t.test('createWorldIfAbsent: first wins, second returns stored world', async () => {
    const name = `${PREFIX}CREATE`;
    const [a, b] = await Promise.all([store.createWorldIfAbsent(newWorld(name, 1)), store.createWorldIfAbsent(newWorld(name, 2))]);
    assert.equal([a.created, b.created].filter(Boolean).length, 1);
    assert.equal(a.world.seed, b.world.seed);
    assert.equal(a.world.headSeq, 0);
    assert.equal(a.world.snapshotSeq, 0);
    assert.equal(a.world.grid.length, 64 * 40);
  });

  await t.test('appendEvent on missing world returns null and writes nothing', async () => {
    assert.equal(await store.appendEvent(`${PREFIX}MISSING`, { kind: 'punch', x: 1, y: 1 }, 'A'), null);
    assert.equal((await store.fetchEvents(`${PREFIX}MISSING`, 0)).length, 0);
  });

  await t.test('50 parallel appendEvent → seqs 1..50 gapless, no duplicates', async () => {
    const name = `${PREFIX}CONC`;
    await store.createWorldIfAbsent(newWorld(name));
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) =>
      store.appendEvent(name, { kind: 'place', actorId: `p${i % 3}`, actorName: `P${i % 3}`, x: i % 64, y: 5, id: 6 }, i % 2 ? 'A' : 'B')));
    const seqs = results.map((r) => r.seq).sort((x, y) => x - y);
    assert.deepEqual(seqs, Array.from({ length: 50 }, (_, i) => i + 1));
    const fetched = await store.fetchEvents(name, 0, 100);
    assert.deepEqual(fetched.map((e) => e.seq), seqs);
    assert.equal((await store.loadWorld(name)).headSeq, 50);
    const page = await store.fetchEvents(name, 45, 3);
    assert.deepEqual(page.map((e) => e.seq), [46, 47, 48]);
    const e = fetched[0];
    assert.equal(e.kind, 'place'); assert.equal(typeof e.x, 'number'); assert.ok(['A', 'B'].includes(e.instanceId));
  });

  await t.test('event round-trip feeds the reducer identically on two instances', async () => {
    const name = `${PREFIX}REPLAY`;
    const { world: stored } = await store.createWorldIfAbsent(newWorld(name, 3));
    await store.appendEvent(name, { kind: 'place', actorId: 'b', actorName: 'bob', x: 1, y: 1, id: 20 }, 'A');
    await store.appendEvent(name, { kind: 'place', actorId: 'a', actorName: 'al', x: 2, y: 1, id: 6 }, 'B');
    await store.appendEvent(name, { kind: 'access_grant', actorId: 'b', target: { id: 'a', username: 'al' } }, 'A');
    await store.appendEvent(name, { kind: 'place', actorId: 'a', actorName: 'al', x: 2, y: 1, id: 6 }, 'B');
    const evs = await store.fetchEvents(name, 0);
    const states = [0, 1].map(() => {
      const w = createWorldManager().hydrate(stored);
      const res = evs.map((ev) => !!applyEvent(w, ev).ok);
      return JSON.stringify({ res, g: Array.from(w.grid), o: w.lockOwnerId, a: w.access });
    });
    assert.equal(states[0], states[1]);
    assert.deepEqual(JSON.parse(states[0]).res, [true, false, true, true]);
  });

  await t.test('saveSnapshotIfNewer: newer accepted, older/equal/ahead-of-log rejected', async () => {
    const name = `${PREFIX}SNAP`;
    const { world } = await store.createWorldIfAbsent(newWorld(name));
    for (let i = 0; i < 4; i++) await store.appendEvent(name, { kind: 'punch', actorId: 'a', x: i, y: 30 }, 'A');
    const w3 = { ...world, grid: Int32Array.from(world.grid) }; w3.grid[0] = 6;
    assert.equal(await store.saveSnapshotIfNewer(w3, 3), true);
    const stale = { ...world, grid: Int32Array.from(world.grid) }; stale.grid[0] = 9;
    assert.equal(await store.saveSnapshotIfNewer(stale, 2), false, 'older rejected');
    assert.equal(await store.saveSnapshotIfNewer(stale, 3), false, 'equal rejected');
    assert.equal(await store.saveSnapshotIfNewer(stale, 5), false, 'ahead of head_seq rejected');
    const after = await store.loadWorld(name);
    assert.equal(after.snapshotSeq, 3);
    assert.equal(after.grid[0], 6, 'stale grid did not overwrite');
    const [r1, r2] = await Promise.all([store.saveSnapshotIfNewer(w3, 4), store.saveSnapshotIfNewer(w3, 4)]);
    assert.equal([r1, r2].filter(Boolean).length, 1, 'racing equal snapshots: exactly one wins');
  });

  await t.test('cleanupEvents removes only events covered by the snapshot', async () => {
    const name = `${PREFIX}SNAP`; // snapshot_seq=4, head_seq=4 from previous test
    await store.appendEvent(name, { kind: 'punch', actorId: 'a', x: 9, y: 30 }, 'A'); // seq 5, not covered
    await store.cleanupEvents({ olderThanMs: -60000 });
    assert.deepEqual((await store.fetchEvents(name, 0)).map((e) => e.seq), [5]);
  });

  await t.test('presence upsert / fetch (age + exclude) / delete / stale cleanup', async () => {
    const name = `${PREFIX}PRES`;
    await store.upsertPresence(name, 'A', [{ i: 'p1', u: 'one', x: 1, y: 2 }]);
    await store.upsertPresence(name, 'B', [{ i: 'p2', u: 'two', x: 3, y: 4 }]);
    await store.upsertPresence(name, 'B', [{ i: 'p2', u: 'two', x: 5, y: 6 }]);
    let p = await store.fetchPresence([name], { maxAgeMs: 60000, excludeInstance: 'A' });
    assert.equal(p.length, 1); assert.equal(p[0].instanceId, 'B'); assert.equal(p[0].players[0].x, 5);
    assert.equal((await store.fetchPresence([name], { maxAgeMs: 60000 })).length, 2);
    assert.deepEqual(await store.fetchPresence([], {}), []);
    await raw('UPDATE world_presence SET updated_at = updated_at - 120000 WHERE world = $1 AND instance_id = $2', [name, 'A']);
    assert.equal((await store.fetchPresence([name], { maxAgeMs: 60000 })).length, 1, 'old row filtered by age');
    await store.deleteStalePresence(60000);
    await store.deletePresence(name, 'B');
    assert.equal((await raw('SELECT count(*)::int n FROM world_presence WHERE world = $1', [name])).rows[0].n, 0);
  });

  await t.test('fetchEventsMulti: heads + events for several worlds in one query', async () => {
    const a = `${PREFIX}MA`, b = `${PREFIX}MB`;
    await store.createWorldIfAbsent(newWorld(a)); await store.createWorldIfAbsent(newWorld(b));
    for (let i = 0; i < 3; i++) await store.appendEvent(a, { kind: 'place', actorId: 'x', x: i, y: 1, id: 6 }, 'I');
    await store.appendEvent(b, { kind: 'chat', actorId: 'x', from: 'X', text: 'hi' }, 'I');
    const r = await store.fetchEventsMulti([{ world: a, after: 1 }, { world: b, after: 0 }, { world: `${PREFIX}NONE`, after: 0 }]);
    assert.equal(r.heads[a].headSeq, 3);
    assert.deepEqual(r.events[a].map((e) => e.seq), [2, 3]);
    assert.equal(r.events[b][0].text, 'hi');
    assert.equal(r.heads[`${PREFIX}NONE`], undefined);
    const list = await store.listWorldSummaries();
    assert.ok(list.some((w) => w.name === a && w.players === 0));
  });

  await t.test('active_sessions: newest connection wins', async () => {
    const u = `${PREFIX}U1`;
    assert.equal(await store.claimSession(u, 'c1', 'I1'), null);
    const prev = await store.claimSession(u, 'c2', 'I2');
    assert.equal(prev.prevConnId, 'c1'); assert.equal(prev.prevInstanceId, 'I1');
    assert.deepEqual(await store.fetchSessionOwners([u]), { [u]: 'c2' });
    await store.releaseSession(u, 'c1'); // stale release must not remove the newer session
    assert.deepEqual(await store.fetchSessionOwners([u]), { [u]: 'c2' });
    await store.releaseSession(u, 'c2');
    assert.deepEqual(await store.fetchSessionOwners([u]), {});
  });

  await t.test('profile rev guard: older save never overwrites newer', async () => {
    const id = `${PREFIX}P1`;
    await raw('INSERT INTO users(id, username, username_lower, password_hash, created_at) VALUES ($1,$2,$3,$4,$5)', [id, 'zz', id.toLowerCase(), 'x', Date.now()]);
    assert.equal(await store.saveProfile(id, { inventory: { gems: 5 } }, 2000), true);
    assert.equal(await store.saveProfile(id, { inventory: { gems: 1 } }, 1000), false);
    assert.equal((await store.getProfile(id)).inventory.gems, 5);
    assert.equal(await store.saveProfile(id, { inventory: { gems: 9 } }, 3000), true);
    assert.equal((await store.getProfile(id)).inventory.gems, 9);
  });

  await t.test('trade sessions: versioned updates and exactly-once completion', async () => {
    const A = `${PREFIX}TA`, B = `${PREFIX}TB`, C = `${PREFIX}TC`;
    const mk = (id, a, b) => ({ id: `${PREFIX}${id}`, a, b, aName: 'a', worldName: `${PREFIX}W`, offers: { [a]: { items: [], gems: 0 }, [b]: { items: [], gems: 0 } }, ready: {} });
    const t1 = await store.tradeCreate(mk('T1', A, B));
    assert.equal(t1.status, 'pending');
    let o = await store.tradeUpdate(t1.id, t1.version, { status: 'open', bName: 'b' });
    assert.equal(o.status, 'open');
    assert.equal(await store.tradeUpdate(t1.id, t1.version, { status: 'cancelled' }), null, 'stale version rejected');
    assert.equal(await store.tradeCreate(mk('T2', C, A)), null, 'A already in an open trade');
    assert.equal((await store.tradeActiveFor(B)).id, t1.id);
    o = await store.tradeUpdate(o.id, o.version, { offers: { [A]: { items: [{ id: 6, n: 2 }], gems: 0 }, [B]: { items: [], gems: 3 } } });
    o = await store.tradeUpdate(o.id, o.version, { ready: { [A]: true, [B]: false } });
    assert.equal(await store.tradeComplete(o.id, o.version), null, 'not both ready');
    o = await store.tradeUpdate(o.id, o.version, { ready: { [A]: true, [B]: true } });
    const results = await Promise.all(Array.from({ length: 10 }, () => store.tradeComplete(o.id, o.version)));
    assert.equal(results.filter(Boolean).length, 1, 'exactly one completion');
    assert.equal(results.find(Boolean).offers[A].items[0].n, 2);
    assert.equal(await store.tradeActiveFor(A), null);
    assert.equal(await store.tradeUpdate(o.id, o.version + 1, { status: 'cancelled' }), null, 'done trade is final');
  });
});
