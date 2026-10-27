'use strict';
/**
 * v1.8 anti-abuse: multi-hit breaking, reach check, punch/place/chat rate limits, chat filter, and the
 * Dirt/Grass/Sand drop nerf that makes a place/break loop lose blocks instead of minting gems.
 * Unit parts always run; the end-to-end part needs TEST_DATABASE_URL (never the production host).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const WebSocket = require('ws');
const abuse = require('../lib/abuse');
const rules = require('../lib/rules');
const { mulberry32 } = require('../lib/world_manager');

const T = rules.TILE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('token bucket: burst then refill', () => {
  let now = 0; const b = abuse.createBucket(5, 3, () => now);
  assert.deepEqual([b.take(), b.take(), b.take(), b.take()], [true, true, true, false]);
  now = 200; assert.equal(b.take(), true); assert.equal(b.take(), false);
});

test('hit tracker: needs N hits on the same tile, resets on switch / tile change / timeout', () => {
  let now = 0; const h = abuse.createHitTracker(4000, () => now);
  assert.deepEqual(h.hit('W', 1, 1, T.DIRT, 3), { hits: 1, need: 3, done: false });
  assert.deepEqual(h.hit('W', 1, 1, T.DIRT, 3), { hits: 2, need: 3, done: false });
  assert.equal(h.hit('W', 1, 1, T.DIRT, 3).done, true);
  h.hit('W', 1, 1, T.DIRT, 3); h.hit('W', 2, 1, T.DIRT, 3); // switched tile
  assert.equal(h.hit('W', 2, 1, T.DIRT, 3).hits, 2);
  assert.equal(h.hit('W', 2, 1, T.STONE, 5).hits, 1); // tile replaced
  now = 5000; assert.equal(h.hit('W', 2, 1, T.STONE, 5).hits, 1); // healed
  assert.equal(h.hit('W', 9, 9, T.SEED, rules.hitsToBreak(T.SEED)).done, true);
});

test('toughness table', () => {
  assert.equal(rules.hitsToBreak(T.AIR), 0);
  assert.equal(rules.hitsToBreak(T.DIRT), 3);
  assert.equal(rules.hitsToBreak(T.STONE), 5);
  assert.equal(rules.hitsToBreak(T.WORLD_LOCK), 6);
  for (const id of [T.SEED, T.CROP, T.TORCH, T.CROP_CRYSTAL]) assert.equal(rules.hitsToBreak(id), 1);
});

test('reach check', () => {
  assert.equal(abuse.inReach(10, 10, 15, 10), true);
  assert.equal(abuse.inReach(10, 10, 16, 10), false);
  assert.equal(abuse.inReach(10, 10, 10, 4), false);
  assert.equal(abuse.inReach(10, 10, NaN, 4), false);
});

test('chat filter: Indonesian + English, whole words, leetspeak, spaced letters', () => {
  const f = (s) => abuse.filterChat(s);
  assert.equal(f('halo anjing lu').text, 'halo ****** lu');
  assert.equal(f('ANJIIIING').hits, 1);
  assert.equal(f('k0nt0l').hits, 1);
  assert.equal(f('what the fuck').text, 'what the ****');
  assert.equal(f('a n j i n g').hits, 1);
  for (const ok of ['pantai indah', 'asumsi saya', 'dickens', 'main yuk', 'cocok', 'tahu tempe', 'babak baru']) assert.equal(f(ok).hits, 0, ok);
});

test('chat guard: rate limit, repeat block, escalating mute', () => {
  let now = 0; const g = abuse.createChatGuard({ perSec: 1, burst: 3, strikes: 3, muteMs: 30000 }, () => now);
  assert.equal(g.check('a').ok, true); assert.equal(g.check('b').ok, true); assert.equal(g.check('c').ok, true);
  assert.equal(g.check('d').reason, 'rate');
  assert.equal(g.check('e').reason, 'rate');
  const m = g.check('f');
  assert.equal(m.reason, 'muted'); assert.equal(m.retryMs, 30000);
  now = 10000; assert.equal(g.check('g').reason, 'muted');
  now = 31000; assert.equal(g.check('h').ok, true);
  assert.equal(g.check('h').ok, true); assert.equal(g.check('h').reason, 'repeat'); // 3rd identical line
  assert.equal(g.strike(), 0); assert.equal(g.strike(), 60000); // 3 strikes again → 2nd mute doubles
  assert.equal(g.check('i').reason, 'muted');
  assert.equal(g.mutedUntil - now, 60000);
});

test('place/break loop economics: Dirt gems per cycle are far lower and the loop burns Dirt', () => {
  // v1.7 Dirt: block 0.92, seed 0.42, gems 0.55 x U{1..3}. v1.8: block 0.6, seed 0.12, gems 0.18 x 1.
  const oldRoll = (rng) => {
    const block = rng() < 0.92 ? 1 : 0; const seed = rng() < 0.42 ? 1 : 0;
    const gems = rng() < 0.55 ? 1 + Math.min(2, Math.floor(rng() * 3)) : 0;
    return { block, seed, gems };
  };
  const N = 20000; const a = mulberry32(7), b = mulberry32(7);
  const old = { gems: 0, block: 0, seed: 0 }, now = { gems: 0, block: 0, seed: 0 };
  for (let i = 0; i < N; i++) {
    const o = oldRoll(a); old.gems += o.gems; old.block += o.block; old.seed += o.seed;
    const r = rules.rollBreak(T.DIRT, b); now.gems += r.gems; now.block += r.block >= 0 ? 1 : 0; now.seed += r.seed >= 0 ? 1 : 0;
  }
  const per = (x) => x / N;
  // Value of one cycle at Store sell prices, minus the Dirt that did not come back.
  const value = (s) => per(s.gems) + per(s.seed) * rules.sellPrice(T.SEED) - (1 - per(s.block)) * rules.sellPrice(T.DIRT);
  const valueAtBuy = (s) => per(s.gems) + per(s.seed) * rules.sellPrice(T.SEED) - (1 - per(s.block)) * rules.buyPrice(T.DIRT);
  assert.ok(per(old.gems) > 1.0 && per(now.gems) < 0.2, `gems/cycle old ${per(old.gems)} new ${per(now.gems)}`);
  assert.ok(per(now.gems) < per(old.gems) / 5);
  assert.ok(value(old) > 2, `old cycle value ${value(old)}`);
  assert.ok(value(now) < 0.3, `new cycle value ${value(now)}`);
  assert.ok(valueAtBuy(now) < 0, 'buying Dirt to loop loses gems');
  // With 3 hits per Dirt at <= 7 punches/s the loop is also capped at ~2.3 breaks/s (was unlimited).
});

// ------------------------------------------------------------------ end to end (real server + Postgres)
const URL_ = process.env.TEST_DATABASE_URL || '';
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const prodHost = (() => {
  try {
    const m = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').match(/^\s*DATABASE_URL\s*=\s*['"]?([^'"\r\n]+)/m);
    return m ? hostOf(m[1]) : '';
  } catch { return ''; }
})();
const skip = !URL_ ? 'TEST_DATABASE_URL not set' : (prodHost && hostOf(URL_) === prodHost) ? 'refusing to run against production' : false;
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

test('e2e: fast scripted place/break loop is throttled and earns almost nothing; reach + chat guards', { skip, timeout: 120000 }, async (t) => {
  const { createStore } = require('../lib/store');
  const store = createStore({ databaseUrl: URL_ });
  await store.init();
  const rnd = crypto.randomBytes(3).toString('hex');
  const WP = `ZZA${rnd.toUpperCase()}`;
  const ids = [];
  let proc = null; let ws = null; let log = '';
  t.after(async () => {
    try { ws && ws.close(); } catch { /* ignore */ }
    if (proc && proc.exitCode === null) await new Promise((r) => { proc.once('exit', r); proc.kill('SIGTERM'); setTimeout(() => { proc.kill('SIGKILL'); r(); }, 8000); });
    if (ids.length) {
      for (const tbl of ['inventory_ledger', 'inventory_items', 'wallets', 'quest_claims', 'active_sessions', 'profiles']) await store._query(`DELETE FROM ${tbl} WHERE user_id = ANY($1)`, [ids]);
      await store._query('DELETE FROM users WHERE id = ANY($1)', [ids]);
    }
    for (const tbl of ['world_events', 'world_presence']) await store._query(`DELETE FROM ${tbl} WHERE world LIKE $1`, [`${WP}%`]);
    await store._query('DELETE FROM worlds WHERE name LIKE $1', [`${WP}%`]);
    const left = await store._query('SELECT (SELECT count(*) FROM users WHERE id = ANY($1)) + (SELECT count(*) FROM wallets WHERE user_id = ANY($1)) + (SELECT count(*) FROM worlds WHERE name LIKE $2) AS c', [ids, `${WP}%`]);
    assert.equal(Number(left.rows[0].c), 0, 'test rows left behind');
    await store.close();
  });

  const port = await freePort();
  const env = { ...process.env, NO_DOTENV: '1', DATABASE_URL: URL_, TEST_DATABASE_URL: '', PG_DRIVER: process.env.PG_DRIVER || 'pg',
    PORT: String(port), HOST: '127.0.0.1', INSTANCE_ID: `test-abuse-${rnd}`, SAVE_INTERVAL_MS: '5000', SERVER_INV: '1', MIN_PROTO: '3' };
  proc = spawn(process.execPath, ['index.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) { try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* starting */ } await sleep(200); }

  const reg = await (await fetch(`${base}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `zza${rnd}`, password: crypto.randomBytes(9).toString('base64url'), proto: 3 }) })).json();
  assert.ok(reg.token); ids.push(reg.userId);
  ws = await new Promise((resolve, reject) => {
    const s = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?proto=3&token=${encodeURIComponent(reg.token)}`);
    s.inbox = []; s.on('message', (m) => { const o = JSON.parse(String(m)); if (o.t !== 'snap') s.inbox.push(o); });
    s.on('open', () => resolve(s)); s.on('error', reject);
  });
  const send = (o) => ws.send(JSON.stringify(o));
  const waitFor = async (pred, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = ws.inbox.find(pred); if (m) return m; await sleep(20); } throw new Error('timeout'); };
  await waitFor((m) => m.t === 'inv');
  send({ t: 'create_world', name: WP });
  const st = await waitFor((m) => m.t === 'world_state' && m.name === WP);
  let c = null;
  for (let i = st.w * 4; i < st.grid.length && !c; i++) if (st.grid[i] === T.DIRT && st.grid[i - st.w] === 0) c = { x: i % st.w, y: (i / st.w) | 0 };
  assert.ok(c);
  await sleep(300);

  await t.test('reach: punching 8 tiles away is refused', async () => {
    ws.inbox.length = 0;
    send({ t: 'move', tx: c.x >= 32 ? c.x - 8 : c.x + 8, ty: c.y }); send({ t: 'punch', x: c.x, y: c.y });
    assert.match((await waitFor((m) => m.t === 'error')).error, /Terlalu jauh/);
    send({ t: 'move', tx: c.x, ty: c.y - 1 }); await sleep(200);
  });

  await t.test('multi-hit: Dirt needs 3 hits; hit progress is broadcast', async () => {
    ws.inbox.length = 0;
    send({ t: 'punch', x: c.x, y: c.y });
    assert.deepEqual((({ hits, need }) => ({ hits, need }))(await waitFor((m) => m.t === 'hit')), { hits: 1, need: 3 });
    send({ t: 'punch', x: c.x, y: c.y });
    await waitFor((m) => m.t === 'hit' && m.hits === 2);
    assert.ok(!ws.inbox.some((m) => m.t === 'tile'), 'not broken after 2 hits');
    send({ t: 'punch', x: c.x, y: c.y });
    await waitFor((m) => m.t === 'tile' && m.x === c.x && m.y === c.y && m.id === 0);
    await sleep(1500); // refill the punch bucket
  });

  await t.test('scripted fast place/break loop: rate-limited, few breaks, ~no gems', async () => {
    await sleep(1500);
    const w0 = await store.invGet(reg.userId);
    ws.inbox.length = 0;
    const SECS = 6; const t0 = Date.now(); let cycles = 0;
    // A bot fires place + 3 punches every 10 ms (~400 actions/s) without waiting for answers.
    while (Date.now() - t0 < SECS * 1000) {
      send({ t: 'place', x: c.x, y: c.y, id: T.DIRT });
      for (let k = 0; k < 3; k++) send({ t: 'punch', x: c.x, y: c.y });
      cycles++;
      await sleep(10);
    }
    await sleep(3000);
    const w1 = await store.invGet(reg.userId);
    const breaks = ws.inbox.filter((m) => m.t === 'tile' && m.x === c.x && m.y === c.y && m.id === 0).length;
    const limited = ws.inbox.filter((m) => m.t === 'error' && m.rate).length;
    const gems = w1.gems - w0.gems;
    const dirt = (w1.items[T.DIRT] || 0) - (w0.items[T.DIRT] || 0);
    // v1.7 server: every place+punch pair broke the block → `cycles` breaks x 1.1 gems.
    const oldGems = cycles * 1.1;
    t.diagnostic(`cycles=${cycles} breaks=${breaks} gems=${gems} dirtDelta=${dirt} rateErrors=${limited} v1.7-estimate≈${Math.round(oldGems)} gems`);
    assert.ok(limited >= 1, 'got a rate-limit notice');
    assert.ok(/\[rate\] (punch|place) limited/.test(log), 'rate limit logged');
    assert.ok(breaks <= Math.ceil((7 * (SECS + 3) + 10) / 3) + 1, `breaks ${breaks}`);
    assert.ok(gems <= Math.max(6, oldGems / 50), `gems ${gems} vs v1.7 ≈${oldGems}`);
  });

  await t.test('chat: filter, rate limit, mute', async () => {
    await sleep(2500);
    ws.inbox.length = 0;
    send({ t: 'chat', text: 'halo anjing' });
    assert.equal((await waitFor((m) => m.t === 'chat' && m.from !== 'SYSTEM')).text, 'halo ******');
    for (let i = 0; i < 10; i++) send({ t: 'chat', text: `spam ${i}` });
    await waitFor((m) => m.t === 'chat' && m.from === 'SYSTEM' && /di-mute/.test(m.text));
    assert.ok(ws.inbox.some((m) => m.t === 'chat' && m.from === 'SYSTEM' && /Terlalu cepat/.test(m.text)));
    const delivered = ws.inbox.filter((m) => m.t === 'chat' && m.from !== 'SYSTEM').length;
    assert.ok(delivered <= 6, `delivered ${delivered}`);
  });
});
