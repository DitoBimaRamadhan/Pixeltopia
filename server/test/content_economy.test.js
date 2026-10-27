'use strict';
// v1.8 content pack sanity: ids, kinds and no buy->craft->sell gem loops.
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../lib/rules');

const ids = rules.CONTENT.tiles.map((d) => d.id);

test('content ids are unique, contiguous and do not collide with base tiles', () => {
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(Math.min(...ids) > rules.TILE.WORLD_LOCK);
  ids.forEach((id, i) => assert.equal(id, ids[0] + i));
  for (const d of rules.CONTENT.tiles) {
    assert.ok(rules.isKnownItem(d.id), d.key);
    assert.equal(rules.TILE[d.key], d.id);
    assert.ok(/^[0-9a-f]{6}$/i.test(d.color), d.key);
    assert.ok(d.name_id && d.name_id.length > 0, `${d.key} name_id`);
  }
});

test('kinds map to physics correctly', () => {
  for (const d of rules.CONTENT.tiles) {
    const solid = d.kind === 'block' || d.kind === 'glass';
    assert.equal(rules.isSolid(d.id), solid, d.key);
    assert.equal(rules.isPlaceable(d.id), d.kind !== 'crop', d.key);
  }
  for (const d of rules.CONTENT.tiles.filter((x) => x.kind === 'seed')) {
    assert.ok(rules.isCrop(d.crop));
    assert.equal(rules.cropForSeed(d.id), d.crop);
    assert.equal(rules.seedForCrop(d.crop), d.id);
    assert.ok(rules.growSeconds(d.id) > 0);
  }
});

test('every buyable item sells for less than it costs', () => {
  for (const id of Object.keys(rules.CATALOG).map(Number)) {
    const buy = rules.buyPrice(id);
    if (buy > 0) assert.ok(rules.sellPrice(id) < buy, `id ${id}`);
  }
});

// Cheapest gem cost of every item reachable from the store via recipes (fixpoint). Selling anything for
// at least that much would be an infinite buy -> craft -> sell loop.
function minCosts() {
  const cost = {};
  for (const id of Object.keys(rules.CATALOG).map(Number)) if (rules.buyPrice(id) > 0) cost[id] = rules.buyPrice(id);
  for (let changed = true; changed;) {
    changed = false;
    for (const r of rules.RECIPES) {
      if (!r.ingredients.every((i) => cost[i.id] !== undefined)) continue;
      const c = r.ingredients.reduce((s, i) => s + cost[i.id] * i.count, 0) / r.resultCount;
      if (cost[r.result] === undefined || c < cost[r.result] - 1e-9) { cost[r.result] = c; changed = true; }
    }
  }
  return cost;
}

test('no buy -> craft -> sell gem loop exists', () => {
  const cost = minCosts();
  for (const [id, c] of Object.entries(cost)) {
    assert.ok(rules.sellPrice(Number(id)) < c, `${rules.getInfo(Number(id)).name}: sells ${rules.sellPrice(Number(id))}, cheapest cost ${c}`);
  }
});
