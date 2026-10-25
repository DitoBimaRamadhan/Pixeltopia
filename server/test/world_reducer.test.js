'use strict';
// Unit tests for the pure world reducer (no DB, no network). Run: node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorldManager, applyEvent, W, H, AIR, WORLD_LOCK } = require('../lib/world_manager');

const DIRT = 1, WOOD = 6;
const alice = { id: 'a1', username: 'alice' };
const bob = { id: 'b2', username: 'bob' };
const carol = { id: 'c3', username: 'carol' };

function blankWorld(name = 'TEST') {
  const wm = createWorldManager();
  const grid = new Array(W * H).fill(AIR);
  for (let x = 0; x < W; x++) grid[(H - 1) * W + x] = DIRT; // floor row
  return { wm, world: wm.hydrate({ name, seed: 1, grid, spawn: { x: 1, y: 1 } }) };
}
const tile = (w, x, y) => w.grid[y * W + x];
const place = (p, x, y, id) => ({ kind: 'place', actorId: p.id, actorName: p.username, x, y, id });
const punch = (p, x, y) => ({ kind: 'punch', actorId: p.id, actorName: p.username, x, y });
const stateOf = (w) => JSON.stringify({ g: Array.from(w.grid), o: w.lockOwnerId, n: w.lockOwnerName, a: w.access });

test('place on empty tile succeeds and marks world dirty', () => {
  const { world } = blankWorld();
  const r = applyEvent(world, place(alice, 3, 4, WOOD));
  assert.deepEqual(r, { ok: true, x: 3, y: 4, id: WOOD });
  assert.equal(tile(world, 3, 4), WOOD);
  assert.equal(world.dirty, true);
});

test('place on occupied tile is rejected and leaves world unchanged', () => {
  const { world } = blankWorld();
  applyEvent(world, place(alice, 3, 4, WOOD));
  const before = stateOf(world);
  assert.deepEqual(applyEvent(world, place(bob, 3, 4, DIRT)), { error: 'Tile tidak kosong' });
  assert.equal(stateOf(world), before);
});

test('out of bounds place/punch are rejected', () => {
  const { world } = blankWorld();
  assert.deepEqual(applyEvent(world, place(alice, W, 0, WOOD)), { error: 'Out of bounds' });
  assert.deepEqual(applyEvent(world, punch(alice, -1, 0)), { error: 'Out of bounds' });
});

test('punch breaks a block; punching air is a noop', () => {
  const { world } = blankWorld();
  assert.deepEqual(applyEvent(world, punch(alice, 0, H - 1)), { ok: true, x: 0, y: H - 1, id: AIR, broke: DIRT });
  assert.equal(tile(world, 0, H - 1), AIR);
  assert.deepEqual(applyEvent(world, punch(alice, 0, H - 1)), { ok: true, id: AIR, x: 0, y: H - 1, noop: true });
});

test('World Lock: placing locks the world; non-owner cannot edit or break the lock', () => {
  const { world } = blankWorld();
  assert.equal(applyEvent(world, place(alice, 5, 5, WORLD_LOCK)).ok, true);
  assert.equal(world.lockOwnerId, alice.id);
  assert.equal(world.lockOwnerName, alice.username);
  const locked = { error: 'Dunia terkunci — hanya pemilik World Lock yang bisa edit.' };
  assert.deepEqual(applyEvent(world, place(bob, 6, 6, WOOD)), locked);
  assert.deepEqual(applyEvent(world, punch(bob, 5, 5)), locked);
  assert.deepEqual(applyEvent(world, place(alice, 7, 7, WORLD_LOCK)), { error: 'Dunia sudah terkunci.' });
  assert.equal(applyEvent(world, place(alice, 6, 6, WOOD)).ok, true);
});

test('World Lock: owner breaking the lock unlocks and clears access', () => {
  const { world } = blankWorld();
  applyEvent(world, place(alice, 5, 5, WORLD_LOCK));
  applyEvent(world, { kind: 'access_grant', actorId: alice.id, target: bob });
  const r = applyEvent(world, punch(alice, 5, 5));
  assert.equal(r.broke, WORLD_LOCK);
  assert.equal(world.lockOwnerId, null);
  assert.deepEqual(world.access, []);
  assert.equal(applyEvent(world, place(carol, 1, 1, WOOD)).ok, true);
});

test('access grant lets a player edit; access holder still cannot break the lock; revoke removes it', () => {
  const { world } = blankWorld();
  applyEvent(world, place(alice, 5, 5, WORLD_LOCK));
  assert.deepEqual(applyEvent(world, { kind: 'access_grant', actorId: bob.id, target: carol }), { error: 'Hanya pemilik World Lock yang bisa memberi akses.' });
  assert.deepEqual(applyEvent(world, { kind: 'access_grant', actorId: alice.id, target: bob }), { ok: true });
  assert.deepEqual(applyEvent(world, { kind: 'access_grant', actorId: alice.id, target: bob }), { error: 'bob sudah punya akses.' });
  assert.deepEqual(applyEvent(world, { kind: 'access_grant', actorId: alice.id, target: alice }), { error: 'Kamu sudah pemilik dunia ini.' });
  assert.equal(applyEvent(world, place(bob, 6, 6, WOOD)).ok, true);
  assert.deepEqual(applyEvent(world, punch(bob, 5, 5)), { error: 'Tidak bisa memecah World Lock milik orang lain.' });
  assert.deepEqual(applyEvent(world, { kind: 'access_revoke', actorId: bob.id, target: 'bob' }), { error: 'Hanya pemilik World Lock yang bisa mencabut akses.' });
  assert.deepEqual(applyEvent(world, { kind: 'access_revoke', actorId: alice.id, target: 'BOB' }), { ok: true });
  assert.deepEqual(applyEvent(world, { kind: 'access_revoke', actorId: alice.id, target: 'bob' }), { error: 'Pemain tidak ada di daftar akses.' });
  assert.deepEqual(applyEvent(world, place(bob, 7, 7, WOOD)), { error: 'Dunia terkunci — hanya pemilik World Lock yang bisa edit.' });
});

test('access list is capped at 64', () => {
  const { world } = blankWorld();
  applyEvent(world, place(alice, 5, 5, WORLD_LOCK));
  for (let i = 0; i < 64; i++) assert.equal(applyEvent(world, { kind: 'access_grant', actorId: alice.id, target: { id: `u${i}`, username: `u${i}` } }).ok, true);
  assert.deepEqual(applyEvent(world, { kind: 'access_grant', actorId: alice.id, target: bob }), { error: 'Daftar akses penuh (maks 64).' });
});

test('unknown / missing events are rejected without mutation', () => {
  const { world } = blankWorld();
  const before = stateOf(world);
  assert.ok(applyEvent(world, { kind: 'explode' }).error);
  assert.ok(applyEvent(world, null).error);
  assert.equal(stateOf(world), before);
});

test('conflicting events applied in the same order give identical results on every instance', () => {
  // Two players race for the same tile and for the World Lock; both instances replay the same ordered log.
  const log = [
    place(alice, 10, 10, WOOD),
    place(bob, 10, 10, DIRT),          // loses: tile no longer empty
    place(bob, 20, 20, WORLD_LOCK),    // bob locks first
    place(alice, 21, 21, WORLD_LOCK),  // loses: already locked
    punch(alice, 10, 10),              // loses: alice has no access now
    { kind: 'access_grant', actorId: bob.id, target: alice },
    punch(alice, 10, 10),              // now allowed
  ];
  const A = blankWorld('RACE').world;
  const B = blankWorld('RACE').world;
  const ra = log.map((ev) => applyEvent(A, ev));
  const rb = log.map((ev) => applyEvent(B, JSON.parse(JSON.stringify(ev)))); // as if received from the DB
  assert.deepEqual(ra, rb);
  assert.equal(stateOf(A), stateOf(B));
  assert.equal(tile(A, 10, 10), AIR);
  assert.equal(A.lockOwnerId, bob.id);
  assert.deepEqual(ra.map((r) => !!r.ok), [true, false, true, false, false, true, true]);
});

test('manager punch/place/grant/revoke wrappers delegate to applyEvent', () => {
  const { wm, world } = blankWorld();
  assert.deepEqual(wm.place(world, alice, '3', 4.7, '6'), { ok: true, x: 3, y: 4, id: WOOD });
  assert.deepEqual(wm.punch(world, alice, 3, 4), { ok: true, x: 3, y: 4, id: AIR, broke: WOOD });
  wm.place(world, alice, 5, 5, WORLD_LOCK);
  assert.deepEqual(wm.grantAccess(world, alice, bob), { ok: true });
  assert.equal(wm.canEdit(world, bob), true);
  assert.deepEqual(wm.revokeAccess(world, alice, bob.id), { ok: true });
  assert.equal(wm.canEdit(world, bob), false);
});
