'use strict';
// File-store (local dev fallback) sync methods. No DB needed. Run: node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../lib/store');
const { generateGrid } = require('../lib/world_manager');

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxt-store-'));
  const store = createStore({ dataDir: dir, databaseUrl: '' });
  return { store, dir };
}
const newWorld = (name) => { const g = generateGrid(7); return { name, seed: g.seed, grid: g.grid, spawn: g.spawn, access: [], createdAt: 1 }; };

test('file store: create-if-absent, gapless append, fetch, snapshot guard, presence, cleanup', async () => {
  const { store, dir } = freshStore();
  try {
    await store.init();
    assert.equal(store.kind, 'file');
    const c1 = await store.createWorldIfAbsent(newWorld('FILEW'));
    assert.equal(c1.created, true);
    assert.equal(c1.world.headSeq, 0);
    assert.equal(c1.world.snapshotSeq, 0);
    const c2 = await store.createWorldIfAbsent({ ...newWorld('FILEW'), seed: 99 });
    assert.equal(c2.created, false);
    assert.equal(c2.world.seed, c1.world.seed);

    assert.equal(await store.appendEvent('NOPE', { kind: 'punch' }, 'i1'), null);
    for (let i = 0; i < 5; i++) await store.appendEvent('FILEW', { kind: 'place', actorId: 'a', actorName: 'A', x: i, y: 2, id: 6 }, 'i1');
    const evs = await store.fetchEvents('FILEW', 2, 10);
    assert.deepEqual(evs.map((e) => e.seq), [3, 4, 5]);
    assert.equal(evs[0].x, 2); // seq 3 was the third append (x=2)
    assert.equal(evs[0].kind, 'place');
    assert.equal(evs[0].instanceId, 'i1');

    const w = await store.loadWorld('FILEW');
    assert.equal(w.headSeq, 5);
    assert.equal(await store.saveSnapshotIfNewer(w, 3), true);
    assert.equal(await store.saveSnapshotIfNewer(w, 2), false, 'older snapshot rejected');
    assert.equal(await store.saveSnapshotIfNewer(w, 3), false, 'equal snapshot rejected');
    assert.equal(await store.saveSnapshotIfNewer(w, 6), false, 'snapshot ahead of log rejected');
    assert.equal((await store.loadWorld('FILEW')).snapshotSeq, 3);

    await store.upsertPresence('FILEW', 'i1', [{ i: 'a', x: 1, y: 2 }]);
    await store.upsertPresence('FILEW', 'i2', [{ i: 'b', x: 3, y: 4 }]);
    const pres = await store.fetchPresence(['FILEW'], { excludeInstance: 'i1' });
    assert.deepEqual(pres.map((p) => p.instanceId), ['i2']);
    await store.deletePresence('FILEW', 'i2');
    assert.equal((await store.fetchPresence(['FILEW'])).length, 1);

    assert.equal(await store.cleanupEvents({ olderThanMs: -1000 }), 3, 'only seqs <= snapshot_seq removed');
    assert.deepEqual((await store.fetchEvents('FILEW', 0)).map((e) => e.seq), [4, 5]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
