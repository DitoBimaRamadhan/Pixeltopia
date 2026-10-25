'use strict';
// Two "instances" (two world managers + two sync engines) sharing one file store in one process.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../lib/store');
const { createWorldManager, WORLD_LOCK } = require('../lib/world_manager');
const { createWorldSync } = require('../lib/world_sync');

const quiet = { log() {}, warn() {}, error() {} };
function instance(store, id) {
  const worlds = createWorldManager();
  const sent = [];
  const players = [];
  const sync = createWorldSync({
    store, worlds, instanceId: id, log: quiet,
    broadcastWorld: (w, msg) => { for (const p of w.players.values()) sent.push({ to: p.id, msg }); },
    deliverToPlayer: (pid, msg) => sent.push({ to: pid, msg }),
    localPlayers: () => players, kickPlayer: (p) => { p.kicked = true; },
  });
  const addPlayer = (w, pid) => { const p = { id: pid, username: pid, x: 0, y: 0 }; players.push(p); worlds.join(w, p); sync.markPresenceDirty(w); return p; };
  return { worlds, sync, sent, players, addPlayer };
}

test('two instances converge; lock race has a single winner; chat + presence cross over', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxt-sync-'));
  const store = createStore({ dataDir: dir, databaseUrl: '' });
  try {
    await store.init();
    const A = instance(store, 'A'), B = instance(store, 'B');
    const ra = await A.sync.ensureWorld('SYNCW', { create: true });
    const rb = await B.sync.ensureWorld('SYNCW', { create: true });
    assert.equal(ra.created, true); assert.equal(rb.created, false);
    const wa = ra.world, wb = rb.world;
    assert.deepEqual(Array.from(wa.grid), Array.from(wb.grid));
    A.addPlayer(wa, 'pa'); B.addPlayer(wb, 'pb');

    // find an air cell
    let x = -1, y = -1;
    for (let i = 0; i < wa.grid.length; i++) if (wa.grid[i] === 0 && wa.grid[i + 64] !== 0) { x = i % 64; y = (i / 64) | 0; break; }
    assert.equal(A.sync.submit(wa, { kind: 'place', actorId: 'pa', actorName: 'pa', x, y, id: 6 }).error, undefined);
    assert.equal(wa.grid[y * 64 + x], 6, 'optimistic echo');
    await A.sync.flushAppends();
    await B.sync.pollOnce();
    assert.equal(wb.grid[y * 64 + x], 6, 'B sees A\'s block');
    assert.ok(B.sent.some((s) => s.msg.t === 'tile' && s.msg.x === x && s.msg.by === 'pa'));

    // World Lock race at the same time on both instances
    const ra2 = A.sync.submit(wa, { kind: 'place', actorId: 'pa', actorName: 'pa', x: x + 1, y, id: WORLD_LOCK });
    const rb2 = B.sync.submit(wb, { kind: 'place', actorId: 'pb', actorName: 'pb', x: x + 2, y, id: WORLD_LOCK });
    assert.ok(!ra2.error && !rb2.error, 'both optimistic');
    await Promise.all([A.sync.flushAppends(), B.sync.flushAppends()]);
    await A.sync.pollOnce(); await B.sync.pollOnce();
    assert.equal(wa.lockOwnerId, wb.lockOwnerId);
    assert.deepEqual(Array.from(wa.grid), Array.from(wb.grid));
    assert.equal(Array.from(wa.grid).filter((v) => v === WORLD_LOCK).length, 1, 'exactly one lock');
    const loser = wa.lockOwnerId === 'pa' ? B : A;
    assert.ok(loser.sent.some((s) => s.msg.t === 'error'), 'loser told');

    // chat + presence
    await B.sync.publishChat(wb, { from: 'pb', id: 'pb', text: 'halo', ts: 1 });
    await A.sync.pollOnce(); await A.sync.pollOnce();
    assert.ok(A.sent.some((s) => s.msg.t === 'chat' && s.msg.text === 'halo'));
    assert.ok(!B.sent.some((s) => s.msg.t === 'chat'), 'own chat not echoed back by sync');
    assert.ok(A.sync.remotePlayers(wa).some((p) => p.i === 'pb'));
    assert.ok(A.sent.some((s) => s.msg.t === 'player_join' && s.msg.player.i === 'pb'));

    // snapshot then a fresh instance loads snapshot + tail and matches
    await A.sync.snapshotAll({ unload: false });
    await B.sync.submit(wb, { kind: 'punch', actorId: 'pb', actorName: 'pb', x, y });
    await B.sync.flushAppends();
    const C = instance(store, 'C');
    const wc = (await C.sync.ensureWorld('SYNCW')).world;
    await B.sync.pollOnce();
    assert.deepEqual(Array.from(wc.grid), Array.from(wb.grid));

    // duplicate session: newest wins, older local player kicked
    const old = { id: 'u1', username: 'u1', authed: true, connId: 'c-old' };
    A.players.push(old);
    await store.claimSession('u1', 'c-old', 'A');
    await store.claimSession('u1', 'c-new', 'B');
    await new Promise((r) => setTimeout(r, 1100));
    await A.sync.pollOnce();
    assert.equal(old.kicked, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
