'use strict';
// Parity: server/lib/rules.js vs the Godot client rules, as exported by tools/export_rules.gd.
// Uses the checked-in fixture test/fixtures/rules_export.json. To re-export from the GDScript first:
//   GODOT_BIN=/path/to/godot node --test test/rules_parity.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const rules = require('../lib/rules');

function loadExport() {
  const fixture = path.join(__dirname, 'fixtures', 'rules_export.json');
  if (!process.env.GODOT_BIN) return JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const out = path.join(os.tmpdir(), `rules_export_${process.pid}.json`);
  execFileSync(process.env.GODOT_BIN, ['--headless', '--path', path.join(__dirname, '..', '..'),
    '--script', 'res://tools/export_rules.gd', '--', out], { stdio: 'ignore', timeout: 600000 });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}
const G = loadExport();
const ids = Object.keys(G.items).map(Number).sort((a, b) => a - b);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('tile ids match Tiles.Id', () => {
  assert.deepEqual({ ...rules.TILE }, G.tile_ids);
});

test('tile predicates and seed/crop/grow tables match tiles.gd', () => {
  for (const id of ids) {
    const g = G.tiles[id];
    const where = `id ${id}`;
    assert.equal(rules.TILE_NAMES[id] ?? '', g.name, where);
    assert.equal(rules.isSolid(id), g.is_solid, `${where} solid`);
    assert.equal(rules.isSoil(id), g.is_soil, `${where} soil`);
    assert.equal(rules.isPlaceable(id), g.is_placeable, `${where} placeable`);
    assert.equal(rules.isSeed(id), g.is_seed, `${where} seed`);
    assert.equal(rules.isCrop(id), g.is_crop, `${where} crop`);
    assert.equal(rules.isUsableItem(id), g.is_usable_item, `${where} usable`);
    assert.equal(rules.seedForCrop(id), g.seed_for_crop, `${where} seed_for_crop`);
    assert.equal(rules.cropForSeed(id), g.crop_for_seed, `${where} crop_for_seed`);
    assert.equal(rules.growSeconds(id), g.grow_seconds, `${where} grow_seconds`);
  }
});

test('item catalog, prices and drop chances match items.gd', () => {
  for (const id of ids) {
    const g = G.items[id];
    const where = `id ${id}`;
    assert.equal(rules.isKnownItem(id), g.in_catalog, `${where} in_catalog`);
    assert.equal(rules.getInfo(id).name, g.name, `${where} name`);
    assert.equal(rules.rarity(id), g.rarity, `${where} rarity`);
    assert.equal(rules.sellPrice(id), g.sell, `${where} sell`);
    assert.equal(rules.buyPrice(id), g.buy, `${where} buy`);
    assert.equal(rules.canDrop(id), g.can_drop, `${where} can_drop`);
    assert.equal(rules.isFarmable(id), g.farmable, `${where} farmable`);
    assert.equal(rules.seedDropFor(id), g.seed_drop, `${where} seed_drop`);
    assert.equal(rules.blockDropChance(id), g.block_drop_chance, `${where} block chance`);
    assert.equal(rules.seedDropChance(id), g.seed_drop_chance, `${where} seed chance`);
    assert.equal(rules.gemDropChance(id), g.gem_drop_chance, `${where} gem chance`);
  }
  assert.deepEqual(rules.storeStock(), G.store_stock);
});

test('gem amount ranges match Items.gem_drop_amount samples', () => {
  const rng = mulberry32(7);
  for (const [k, vals] of Object.entries(G.gem_amount_samples)) {
    const id = Number(k);
    const [lo, hi] = rules.gemDropRange(id);
    const expected = []; for (let v = lo; v <= hi; v++) expected.push(v);
    assert.deepEqual(vals, expected, `id ${id} godot range`);
    const seen = new Set(); for (let i = 0; i < 4000; i++) seen.add(rules.gemDropAmount(id, rng));
    assert.deepEqual([...seen].sort((a, b) => a - b), expected, `id ${id} js range`);
  }
});

test('recipes match recipes.gd', () => {
  const mine = rules.RECIPES.map((r) => ({ id: r.id, name: r.name, result: r.result, result_count: r.resultCount,
    ingredients: r.ingredients.map((i) => ({ id: i.id, count: i.count })) }));
  const theirs = G.recipes.map((r) => ({ id: r.id, name: r.name, result: r.result, result_count: r.result_count,
    ingredients: r.ingredients.map((i) => ({ id: i.id, count: i.count })) }));
  assert.deepEqual(mine, theirs);
  assert.equal(rules.recipeById('torch').resultCount, 2);
  assert.equal(rules.recipeById('nope'), null);
});

test('splicing matches Splicing.result_of for every id pair', () => {
  for (const a of ids) for (const b of ids) {
    const g = G.splice.results[`${a},${b}`] ?? -1;
    assert.equal(rules.spliceResult(a, b), g, `${a}+${b}`);
  }
  assert.deepEqual([...rules.ALL_SEED_IDS], G.splice.seed_ids);
});

test('quests match quests.gd', () => {
  const mine = rules.QUESTS.map((q) => ({ id: q.id, title: q.title, goal: q.goal, type: q.type,
    reward_gems: q.rewardGems, reward_item: q.rewardItem, reward_count: q.rewardCount }));
  const theirs = G.quests.map((q) => ({ id: q.id, title: q.title, goal: q.goal, type: q.type,
    reward_gems: q.reward_gems, reward_item: q.reward_item, reward_count: q.reward_count }));
  assert.deepEqual(mine, theirs);
});

test('starter kit and inventory limits match inventory.gd', () => {
  const inv = G.inventory;
  assert.equal(rules.MAX_STACK, inv.MAX_STACK);
  assert.equal(rules.HOTBAR_LEN, inv.HOTBAR_LEN);
  assert.equal(rules.BASE_BACKPACK_SLOTS, inv.BASE_BACKPACK_SLOTS);
  const counts = {};
  inv.slots.forEach((id, i) => { if (id >= 0 && inv.counts[i] > 0) counts[id] = (counts[id] || 0) + inv.counts[i]; });
  const s = rules.starterInventory();
  assert.equal(s.gems, inv.gems);
  assert.deepEqual(Object.fromEntries(Object.entries(s.items).map(([k, v]) => [k, v])), Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v])));
  s.items[1] = 0; // a fresh copy each call
  assert.equal(rules.starterInventory().items[1], 64);
});

test('world constants match world.gd', () => {
  assert.equal(rules.WORLD_W, G.world.W);
  assert.equal(rules.WORLD_H, G.world.H);
  assert.equal(rules.FERTILIZER_FACTOR, G.world.FERTILIZER_FACTOR);
});

// ----------------------------------------------------------------- drop rolls
// Exact outcome distribution derived independently from the chance tables, keyed like the exporter:
// "block|seed|gems|dropCount".
function exactBreak(id) {
  const dist = new Map();
  const add = (k, p) => dist.set(k, (dist.get(k) || 0) + p);
  const pBlock = (!rules.isSeed(id) && rules.canDrop(id)) ? rules.blockDropChance(id) : 0;
  const seedId = rules.seedDropFor(id);
  const pSeed = seedId >= 0 ? rules.seedDropChance(id) : 0;
  const pGem = rules.gemDropChance(id);
  const [lo, hi] = rules.gemDropRange(id);
  for (const b of [true, false]) for (const s of [true, false]) {
    const pb = b ? pBlock : 1 - pBlock; const ps = s ? pSeed : 1 - pSeed;
    if (!pb || !ps) continue;
    const drops = (b ? 1 : 0) + (s ? 1 : 0);
    const base = `${b ? id : -1}|${s ? seedId : -1}`;
    add(`${base}|0|${drops}`, pb * ps * (1 - pGem));
    for (let g = lo; g <= hi; g++) add(`${base}|${g}|${drops}`, pb * ps * pGem / (hi - lo + 1));
  }
  return dist;
}
function exactHarvest(id) {
  const dist = new Map();
  const seedId = rules.seedForCrop(id);
  const pExtra = rules.isFarmable(id) ? rules.HARVEST_EXTRA_SEED_CHANCE : 0;
  const pGem = rules.gemDropChance(id);
  const [lo, hi] = rules.gemDropRange(id);
  for (const extra of [false, true]) {
    const pe = extra ? pExtra : 1 - pExtra;
    if (!pe) continue;
    const base = `${id}|${seedId}`; const drops = extra ? 3 : 2;
    dist.set(`${base}|0|${drops}`, pe * (1 - pGem));
    for (let g = lo; g <= hi; g++) dist.set(`${base}|${g}|${drops}`, pe * pGem / (hi - lo + 1));
  }
  return dist;
}
function tvd(exact, hist, n) {
  const keys = new Set([...exact.keys(), ...Object.keys(hist)]);
  let d = 0;
  for (const k of keys) d += Math.abs((exact.get(k) || 0) - (hist[k] || 0) / n);
  return d / 2;
}
const keyOf = (r) => `${r.block}|${r.seed}|${r.gems}|${r.items.length}`;

test('Godot break_tile / try_harvest Monte Carlo matches the exact distribution (support + TVD)', () => {
  const n = G.mc_trials;
  const check = (exact, hist, where) => {
    for (const k of Object.keys(hist)) assert.ok(exact.has(k), `${where}: godot outcome ${k} impossible in rules.js`);
    const d = tvd(exact, hist, n);
    assert.ok(d < 0.03, `${where}: total variation ${d.toFixed(4)} too large`);
  };
  for (const [k, hist] of Object.entries(G.break_mc)) check(exactBreak(Number(k)), hist, `break ${k}`);
  for (const [k, hist] of Object.entries(G.harvest_mc)) check(exactHarvest(Number(k)), hist, `harvest ${k}`);
  assert.ok(Object.keys(G.break_mc).length >= 15 && Object.keys(G.harvest_mc).length === 5);
});

test('rules.rollBreak / rollHarvest with a seeded rng match the exact distribution', () => {
  const n = 40000;
  for (const id of ids.filter((i) => i > 0)) {
    const rng = mulberry32(1000 + id);
    const crop = rules.isCrop(id);
    const hist = {};
    for (let i = 0; i < n; i++) {
      const r = crop ? rules.rollHarvest(id, rng) : rules.rollBreak(id, rng);
      hist[keyOf(r)] = (hist[keyOf(r)] || 0) + 1;
    }
    const exact = crop ? exactHarvest(id) : exactBreak(id);
    for (const k of Object.keys(hist)) assert.ok(exact.has(k), `id ${id}: outcome ${k}`);
    assert.ok(tvd(exact, hist, n) < 0.02, `id ${id}`);
  }
});

test('rolls are deterministic and consume rng in GDScript order', () => {
  const scripted = (vals) => { let i = 0; const f = () => { if (i >= vals.length) throw new Error('rng over-consumed'); return vals[i++]; }; f.used = () => i; return f; };
  // Dirt: block roll, seed roll, gem roll, gem amount (farmable)
  let rng = scripted([0.0, 0.0, 0.0, 0.99]);
  assert.deepEqual(rules.rollBreak(rules.TILE.DIRT, rng), { block: 1, seed: 4, gems: 3, items: [{ id: 1, n: 1 }, { id: 4, n: 1 }] });
  assert.equal(rng.used(), 4);
  // Stone: no seed_drop → no seed roll; non-farmable gem amount uses no rng
  rng = scripted([0.37, 0.11]);
  assert.deepEqual(rules.rollBreak(rules.TILE.STONE, rng), { block: 3, seed: -1, gems: 1, items: [{ id: 3, n: 1 }] });
  assert.equal(rng.used(), 2);
  // Unripe seed: no block roll at all
  rng = scripted([0.99, 0.99]);
  assert.deepEqual(rules.rollBreak(rules.TILE.SEED, rng), { block: -1, seed: -1, gems: 0, items: [] });
  assert.equal(rng.used(), 2);
  // Crop harvest: extra-seed roll then gem roll (+ amount)
  rng = scripted([0.24, 0.0, 0.0]);
  const h = rules.rollHarvest(rules.TILE.CROP_CRYSTAL, rng);
  assert.deepEqual(h, { block: 19, seed: 18, gems: 3, items: [{ id: 19, n: 1 }, { id: 18, n: 1 }, { id: 18, n: 1 }] });
  assert.equal(rules.rollHarvest(rules.TILE.DIRT, mulberry32(1)), null);
  assert.deepEqual(rules.rollBreak(rules.TILE.AIR, scripted([])), { block: -1, seed: -1, gems: 0, items: [] });
  // Same seed → same results
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 200; i++) assert.deepEqual(rules.rollBreak(i % 21, a), rules.rollBreak(i % 21, b));
  // randiRange inclusive and clamped at rng→1
  assert.equal(rules.randiRange(() => 0.9999999999, 3, 6), 6);
  assert.equal(rules.randiRange(() => 0, 3, 6), 3);
});

test('canPlace mirrors World.place_tile checks', () => {
  const T = rules.TILE;
  assert.equal(rules.canPlace(T.DIRT, T.AIR, T.STONE), true);
  assert.equal(rules.canPlace(T.DIRT, T.STONE, T.STONE), false);
  assert.equal(rules.canPlace(T.FERTILIZER, T.AIR, T.DIRT), false);
  assert.equal(rules.canPlace(T.SEED, T.AIR, T.GRASS), true);
  assert.equal(rules.canPlace(T.SEED, T.AIR, T.STONE), false);
  assert.equal(rules.canPlace(T.SEED_CRYSTAL, T.AIR, null), false);
  assert.equal(rules.canPlace(T.CROP, T.AIR, T.DIRT), false);
  assert.equal(rules.canPlace(T.WORLD_LOCK, T.AIR, T.AIR), true);
  assert.equal(rules.canPlace(99, T.AIR, T.DIRT), false);
  for (const id of ids) {
    const expect = id !== T.AIR && G.tiles[id].is_placeable && !G.tiles[id].is_usable_item && !G.tiles[id].is_crop;
    if (!G.tiles[id].is_seed) assert.equal(rules.canPlace(id, T.AIR, T.STONE), expect, `id ${id}`);
  }
});
