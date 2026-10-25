'use strict';
/**
 * Steps 4-8 end-to-end: two real server processes (SERVER_INV=1, MIN_PROTO=2) on one Postgres.
 * Drops exactly once, harvest + fertilize, craft/splice/shop, quest claims, atomic trades across
 * instances, guests, proto gate. Needs TEST_DATABASE_URL (never DATABASE_URL, never the prod host).
 * Test accounts are zz<rand> users; all their rows (and test worlds/trades) are deleted afterwards.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const WebSocket = require('ws');
const { createStore } = require('../lib/store');
const rules = require('../lib/rules');
const inv = require('../lib/inv_server');

const URL_ = process.env.TEST_DATABASE_URL || '';
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const prodHost = (() => {
  try {
    const m = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').match(/^\s*DATABASE_URL\s*=\s*['"]?([^'"\r\n]+)/m);
    return m ? hostOf(m[1]) : '';
  } catch { return ''; }
})();
const skip = !URL_ ? 'TEST_DATABASE_URL not set' : (prodHost && hostOf(URL_) === prodHost) ? 'refusing to run against production' : false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = rules.TILE;

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

async function startServer(tag, extraEnv) {
  const port = await freePort();
  const env = { ...process.env, NO_DOTENV: '1', DATABASE_URL: URL_, TEST_DATABASE_URL: '', PG_DRIVER: process.env.PG_DRIVER || 'pg',
    PORT: String(port), HOST: '127.0.0.1', INSTANCE_ID: `test-${tag}`, SAVE_INTERVAL_MS: '5000', DUP_LOGIN_SETTLE_MS: '300', ...extraEnv };
  if (extraEnv.SERVER_INV === undefined) delete env.SERVER_INV;
  const proc = spawn(process.execPath, ['index.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  const srv = { tag, port, proc, base: `http://127.0.0.1:${port}`, log: '' };
  proc.stdout.on('data', (d) => { srv.log += d; });
  proc.stderr.on('data', (d) => { srv.log += d; });
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    try { const r = await fetch(`${srv.base}/health`); if (r.ok) return srv; } catch { /* not up yet */ }
    if (proc.exitCode !== null) break;
    await sleep(200);
  }
  throw new Error(`server ${tag} did not start`);
}
async function post(base, p, body) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}
function connect(base, token, proto = 2) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?${proto ? `proto=${proto}&` : ''}${token ? `token=${encodeURIComponent(token)}` : ''}`);
    ws.inbox = [];
    ws.on('message', (m) => { const o = JSON.parse(String(m)); if (o.t !== 'snap') ws.inbox.push(o); });
    ws.waitFor = async (pred, ms = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const m = ws.inbox.find(pred); if (m) return m; await sleep(25); }
      throw new Error('timeout waiting for message');
    };
    ws.sendJ = (o) => ws.send(JSON.stringify(o));
    ws.closeCode = null; ws.on('close', (c) => { ws.closeCode = c; });
    ws.on('open', () => resolve(ws)); ws.on('error', reject);
  });
}
const linesFor = (srv, re) => srv.log.split('\n').filter((l) => re.test(l));

test('SERVER_INV steps 4-8 over two instances', { skip, timeout: 240000 }, async (t) => {
  const store = createStore({ databaseUrl: URL_ });
  await store.init();
  const rnd = crypto.randomBytes(3).toString('hex');
  const PW = crypto.randomBytes(9).toString('base64url');
  const names = { p1: `zzp${rnd}`, p2: `zzq${rnd}` };
  const WP = `ZZE${rnd.toUpperCase()}`;
  const ids = {}; const tok = {};
  const servers = []; const sockets = [];
  t.after(async () => {
    for (const ws of sockets) { try { ws.close(); } catch { /* ignore */ } }
    await Promise.all(servers.map((s) => new Promise((r) => { if (s.proc.exitCode !== null) return r(); s.proc.once('exit', r); s.proc.kill('SIGTERM'); setTimeout(() => { s.proc.kill('SIGKILL'); r(); }, 8000); })));
    const list = Object.values(ids);
    if (list.length) {
      await store._query('DELETE FROM trades WHERE a_id = ANY($1) OR b_id = ANY($1)', [list]);
      await store._query('DELETE FROM trade_sessions WHERE a_id = ANY($1) OR b_id = ANY($1)', [list]);
      for (const tbl of ['inventory_ledger', 'inventory_items', 'wallets', 'quest_claims', 'active_sessions', 'profiles']) {
        await store._query(`DELETE FROM ${tbl} WHERE user_id = ANY($1)`, [list]);
      }
      await store._query('DELETE FROM users WHERE id = ANY($1)', [list]);
      for (const tbl of ['world_events', 'world_presence']) await store._query(`DELETE FROM ${tbl} WHERE world LIKE $1`, [`${WP}%`]);
      await store._query('DELETE FROM worlds WHERE name LIKE $1', [`${WP}%`]);
      const left = await store._query(`SELECT (SELECT count(*) FROM wallets WHERE user_id = ANY($1)) + (SELECT count(*) FROM users WHERE id = ANY($1))
        + (SELECT count(*) FROM quest_claims WHERE user_id = ANY($1)) + (SELECT count(*) FROM trade_sessions WHERE a_id = ANY($1) OR b_id = ANY($1))
        + (SELECT count(*) FROM worlds WHERE name LIKE $2) AS c`, [list, `${WP}%`]);
      assert.equal(Number(left.rows[0].c), 0, 'test rows left behind');
    }
    await store.close();
  });

  const [A, B] = await Promise.all([startServer('A', { SERVER_INV: '1', MIN_PROTO: '2' }), startServer('B', { SERVER_INV: '1', MIN_PROTO: '2' })]);
  servers.push(A, B);

  await t.test('proto gate: old clients get 426 / update_required; v1.7 (proto=2) is let in', async () => {
    const old = await post(A.base, '/register', { username: `zzx${rnd}`, password: PW });
    assert.equal(old.status, 426);
    assert.equal(old.json.update, true);
    assert.match(old.json.error, /Update ke Pixeltopia v1\.7\.0/);
    assert.match(old.json.url, /github\.com\/DitoBimaRamadhan\/Pixeltopia\/releases/);
    assert.equal((await post(A.base, '/login', { username: 'x', password: 'y' })).status, 426);
    for (const [k, u] of Object.entries(names)) {
      const r = await post(A.base, '/register', { username: u, password: PW, proto: 2 });
      assert.equal(r.status, 201, `register ${k}`);
      ids[k] = r.json.userId; tok[k] = r.json.token;
    }
    const ws = await connect(B.base, tok.p1, 0); sockets.push(ws);
    const m = await ws.waitFor((x) => x.t === 'update_required');
    assert.match(m.url, /releases/);
    const t0 = Date.now(); while (ws.closeCode === null && Date.now() - t0 < 5000) await sleep(25);
    assert.equal(ws.closeCode, 4002);
    assert.ok(!ws.inbox.some((x) => x.t === 'welcome'));
  });

  const open = async (srv, k) => { const ws = await connect(srv.base, k ? tok[k] : ''); sockets.push(ws); await ws.waitFor((m) => m.t === 'inv'); return ws; };
  const join = async (ws, name, create) => {
    ws.sendJ({ t: create ? 'create_world' : 'join_world', name });
    return ws.waitFor((m) => m.t === 'world_state' && m.name === name);
  };
  const airOnSoil = (st, skipList = []) => {
    for (let i = st.w * 3; i < st.grid.length - st.w; i++) if (st.grid[i] === 0 && rules.isSoil(st.grid[i + st.w]) && !skipList.includes(i)) return { x: i % st.w, y: (i / st.w) | 0, i };
    throw new Error('no air');
  };
  const fresh = async (ws, name) => { ws.inbox.length = 0; return join(ws, name, false); };
  const grant = (u, ops) => store.invApply(`test:${u}:${crypto.randomBytes(4).toString('hex')}`, u, ops, 'test');
  const lastInv = (ws) => ws.inbox.filter((m) => m.t === 'inv').at(-1);

  let p1; let p2; let st; const WN = `${WP}W`;
  await t.test('setup: p1 on A creates a world, p2 on B joins', async () => {
    p1 = await open(A, 'p1'); p2 = await open(B, 'p2');
    st = await join(p1, WN, true);
    await join(p2, WN, false);
    await sleep(800);
  });

  await t.test('break drops: deterministic, credited exactly once across both instances, reward popup', async () => {
    const dirt = [];
    for (let i = 0; i < st.grid.length && dirt.length < 6; i++) if (st.grid[i] === T.DIRT && st.grid[i - st.w] === 0) dirt.push({ x: i % st.w, y: (i / st.w) | 0 });
    assert.equal(dirt.length, 6);
    const w0 = await store.invGet(ids.p1);
    p1.inbox.length = 0;
    for (const c of dirt) { p1.sendJ({ t: 'punch', x: c.x, y: c.y }); await p1.waitFor((m) => m.t === 'tile' && m.x === c.x && m.y === c.y && m.id === 0); }
    await sleep(2500);
    const { rows } = await store._query("SELECT op_id, reason, delta FROM inventory_ledger WHERE user_id = $1 AND op_id LIKE 'drop:%' ORDER BY op_id", [ids.p1]);
    assert.ok(rows.length >= 3 && rows.length <= 6, `drops ${rows.length}`);
    let dirtGain = 0;
    for (const r of rows) {
      const [, u, w, seq] = r.op_id.split(':');
      assert.deepEqual([u, w, r.reason], [ids.p1, WN, 'break']);
      // (the event row itself may already be compacted away after a snapshot)
      const head = Number((await store._query('SELECT head_seq FROM worlds WHERE name = $1', [WN])).rows[0].head_seq);
      assert.ok(Number(seq) >= 1 && Number(seq) <= head, 'drop seq is a log position');
      const roll = rules.rollBreak(T.DIRT, inv.dropRng(WN, Number(seq)));
      const items = {}; for (const it of roll.items) items[it.id] = (items[it.id] || 0) + it.n;
      assert.deepEqual(Object.fromEntries(Object.entries(r.delta.items || {}).map(([k, v]) => [k, Number(v)])), Object.fromEntries(Object.entries(items).map(([k, v]) => [String(k), v])));
      dirtGain += items[T.DIRT] || 0;
    }
    const w1 = await store.invGet(ids.p1);
    assert.equal((w1.items[T.DIRT] || 0) - (w0.items[T.DIRT] || 0), dirtGain);
    assert.equal(p1.inbox.filter((m) => m.t === 'reward').length, rows.length, 'one popup per drop');
    assert.equal(lastInv(p1).ver, w1.ver);
    assert.ok(!p2.inbox.some((m) => m.t === 'reward'), 'only the actor gets the popup');
  });

  await t.test('plant, fertilize (seen on B), grace refusal, harvest -> crop + seed into the wallet', async () => {
    await grant(ids.p1, { items: { [T.FERTILIZER]: 2 } }); // written straight to the DB: reconnect so A reloads the wallet
    p1.close(); p1 = await open(A, 'p1');
    st = await join(p1, WN, false);
    await sleep(300);
    const c = airOnSoil(st, []);
    p1.inbox.length = 0; p2.inbox.length = 0;
    p1.sendJ({ t: 'place', x: c.x, y: c.y, id: T.SEED });
    const tl = await p1.waitFor((m) => m.t === 'tile' && m.x === c.x && m.y === c.y && m.id === T.SEED);
    assert.ok(tl.readyIn > 6000 && tl.readyIn <= 8000, `readyIn ${tl.readyIn}`);
    p1.sendJ({ t: 'fertilize', x: c.x, y: c.y });
    const pl = await p1.waitFor((m) => m.t === 'plant' && m.x === c.x && m.y === c.y);
    assert.equal(pl.boosted, true);
    assert.ok(pl.readyIn < 4500, `boosted ${pl.readyIn}`);
    await p2.waitFor((m) => m.t === 'plant' && m.x === c.x && m.y === c.y);
    p1.sendJ({ t: 'fertilize', x: c.x, y: c.y });
    assert.match((await p1.waitFor((m) => m.t === 'error')).error, /Sudah dipupuk/);
    await sleep(Math.max(0, pl.readyIn - 2000));
    p1.inbox.length = 0;
    p1.sendJ({ t: 'punch', x: c.x, y: c.y });
    assert.match((await p1.waitFor((m) => m.t === 'error')).error, /Belum matang/);
    await sleep(2600);
    const w0 = await store.invGet(ids.p1);
    p1.inbox.length = 0;
    p1.sendJ({ t: 'punch', x: c.x, y: c.y });
    const h = await p1.waitFor((m) => m.t === 'tile' && m.x === c.x && m.y === c.y && m.id === 0);
    assert.equal(h.harvest, T.CROP);
    const rw = await p1.waitFor((m) => m.t === 'reward' && m.harvest);
    assert.ok(rw.items.some((it) => it.id === T.CROP));
    await sleep(800);
    const w1 = await store.invGet(ids.p1);
    assert.equal((w1.items[T.CROP] || 0) - (w0.items[T.CROP] || 0), 1);
    assert.equal(w1.items[T.FERTILIZER], 1, 'second fertilize was not charged');
    assert.equal(await store.invProgress(ids.p1, 'harvest'), 1);
  });

  await t.test('craft / splice / shop: validated server-side, atomic, replies + new inv', async () => {
    const w0 = await store.invGet(ids.p1);
    p1.inbox.length = 0;
    p1.sendJ({ t: 'craft', recipe: 'plank', req: 1 });
    const r1 = await p1.waitFor((m) => m.t === 'inv_result' && m.req === 1);
    assert.equal(r1.ok, true);
    p1.sendJ({ t: 'craft', recipe: 'weather_machine', req: 2 });
    const r2 = await p1.waitFor((m) => m.t === 'inv_result' && m.req === 2);
    assert.equal(r2.ok, false); assert.match(r2.error, /tidak cukup/);
    p1.sendJ({ t: 'splice', a: T.SEED, b: T.SEED_AZURE, req: 3 });
    assert.equal((await p1.waitFor((m) => m.t === 'inv_result' && m.req === 3)).ok, true);
    p1.sendJ({ t: 'shop_buy', id: T.DIRT, n: 3, req: 4 });
    assert.equal((await p1.waitFor((m) => m.t === 'inv_result' && m.req === 4)).ok, true);
    p1.sendJ({ t: 'shop_buy', id: T.WORLD_LOCK, n: 99, req: 5 });
    assert.equal((await p1.waitFor((m) => m.t === 'inv_result' && m.req === 5)).code, 'insufficient_gems');
    const w1 = await store.invGet(ids.p1);
    const d = (id) => (w1.items[id] || 0) - (w0.items[id] || 0);
    assert.deepEqual([d(T.WOOD), d(T.PLANK), d(T.SEED), d(T.SEED_AZURE), d(T.SEED_EMBER), d(T.DIRT)], [-2, 1, -1, -1, 1, 3]);
    assert.equal(w1.gems, w0.gems - 3 * rules.buyPrice(T.DIRT));
    assert.deepEqual(lastInv(p1).items, w1.items);
  });

  await t.test('quest claim: only when complete, once, reward credited', async () => {
    p1.inbox.length = 0;
    p1.sendJ({ t: 'quest_claim', qid: 'plant_5', req: 10 });
    const r0 = await p1.waitFor((m) => m.t === 'inv_result' && m.req === 10);
    assert.deepEqual([r0.ok, r0.code, r0.progress], [false, 'not_complete', 1]);
    st = await fresh(p1, WN);
    const used = [];
    for (let k = 0; k < 4; k++) {
      const c = airOnSoil(st, used); used.push(c.i);
      p1.sendJ({ t: 'place', x: c.x, y: c.y, id: T.SEED_AZURE });
      await p1.waitFor((m) => m.t === 'tile' && m.x === c.x && m.y === c.y && m.id === T.SEED_AZURE);
    }
    await sleep(500);
    const g0 = (await store.invGet(ids.p1)).gems;
    p1.sendJ({ t: 'quest_claim', qid: 'plant_5', req: 11 });
    const r1 = await p1.waitFor((m) => m.t === 'inv_result' && m.req === 11);
    assert.equal(r1.ok, true, JSON.stringify(r1));
    p1.sendJ({ t: 'quest_claim', qid: 'plant_5', req: 12 });
    const rA = await p1.waitFor((m) => m.t === 'inv_result' && m.req === 12);
    assert.equal(rA.code, 'already_claimed');
    assert.equal((await store.invGet(ids.p1)).gems, g0 + 25);
    p1.sendJ({ t: 'quest_state' });
    const qs = await p1.waitFor((m) => m.t === 'quest_state');
    assert.deepEqual(qs.claimed, ['plant_5']);
    assert.equal(qs.progress.plant_5, 5);
  });

  const tradeTo = async (offer1, offer2) => {
    p1.inbox.length = 0; p2.inbox.length = 0;
    p1.sendJ({ t: 'trade_request', to: ids.p2 });
    await p2.waitFor((m) => m.t === 'trade' && m.event === 'incoming');
    p2.sendJ({ t: 'trade_accept' });
    await p1.waitFor((m) => m.t === 'trade' && m.event === 'open');
    p1.sendJ({ t: 'trade_offer', ...offer1 });
    await p2.waitFor((m) => m.t === 'trade' && m.event === 'offer' && m.trade.offers[ids.p1].items.length === offer1.items.length);
    p2.sendJ({ t: 'trade_offer', ...offer2 });
    await p1.waitFor((m) => m.t === 'trade' && m.event === 'offer' && (m.trade.offers[ids.p2].gems || 0) === (offer2.gems || 0) && m.trade.offers[ids.p2].items.length === offer2.items.length);
    await sleep(300);
  };
  await t.test('trade across instances: atomic settle, both wallets updated, receivers refreshed', async () => {
    const a0 = await store.invGet(ids.p1); const b0 = await store.invGet(ids.p2);
    await tradeTo({ items: [{ id: T.DIRT, n: 5 }], gems: 0 }, { items: [], gems: 4 });
    p1.sendJ({ t: 'trade_ready', ready: true });
    await p2.waitFor((m) => m.t === 'trade' && m.event === 'ready');
    p2.sendJ({ t: 'trade_ready', ready: true });
    const done1 = await p1.waitFor((m) => m.t === 'trade' && m.event === 'completed');
    const done2 = await p2.waitFor((m) => m.t === 'trade' && m.event === 'completed');
    assert.equal(done1.serverInv, true); assert.equal(done2.serverInv, true);
    await sleep(800);
    const a1 = await store.invGet(ids.p1); const b1 = await store.invGet(ids.p2);
    assert.deepEqual([a1.items[T.DIRT] - a0.items[T.DIRT], a1.gems - a0.gems], [-5, 4]);
    assert.deepEqual([b1.items[T.DIRT] - b0.items[T.DIRT], b1.gems - b0.gems], [5, -4]);
    assert.equal(lastInv(p1).ver, a1.ver);
    assert.equal(lastInv(p2).ver, b1.ver, 'B-side receiver refreshed its wallet');
    const { rows } = await store._query("SELECT count(*)::int AS c FROM inventory_ledger WHERE op_id LIKE 'trade:%' AND user_id = ANY($1)", [[ids.p1, ids.p2]]);
    assert.equal(rows[0].c, 2);
  });

  await t.test('trade with an offer the wallet cannot cover: refused, nothing moves', async () => {
    const a0 = await store.invGet(ids.p1); const b0 = await store.invGet(ids.p2);
    await tradeTo({ items: [{ id: T.DIRT, n: 1 }], gems: 0 }, { items: [], gems: 9999 });
    p1.sendJ({ t: 'trade_ready', ready: true });
    await p2.waitFor((m) => m.t === 'trade' && m.event === 'ready');
    p2.sendJ({ t: 'trade_ready', ready: true });
    const f = await p2.waitFor((m) => m.t === 'trade' && m.event === 'failed');
    assert.match(f.error, /tidak cukup/);
    await sleep(500);
    assert.deepEqual(await store.invGet(ids.p1), a0);
    assert.deepEqual(await store.invGet(ids.p2), b0);
    p1.sendJ({ t: 'trade_cancel' });
    await p2.waitFor((m) => m.t === 'trade' && m.event === 'cancelled');
  });

  await t.test('guests: session kit, drops into the kit only, no trades either way, no World Lock', async () => {
    const g = await open(A, null);
    const gw = g.inbox.find((m) => m.t === 'welcome');
    const kit0 = g.inbox.find((m) => m.t === 'inv');
    assert.equal(kit0.guest, true);
    await join(g, WN, false);
    await sleep(500);
    g.inbox.length = 0;
    g.sendJ({ t: 'trade_request', to: ids.p1 });
    assert.match((await g.waitFor((m) => m.t === 'error')).error, /tamu/i);
    p1.inbox.length = 0;
    p1.sendJ({ t: 'trade_request', to: gw.you.id });
    assert.match((await p1.waitFor((m) => m.t === 'error')).error, /tamu/i);
    const gs = await fresh(g, WN);
    const cells = [];
    for (let i = 0; i < gs.grid.length && cells.length < 4; i++) if (gs.grid[i] === T.DIRT && gs.grid[i - gs.w] === 0) cells.push({ x: i % gs.w, y: (i / gs.w) | 0 });
    g.inbox.length = 0;
    for (const c of cells) { g.sendJ({ t: 'punch', x: c.x, y: c.y }); await g.waitFor((m) => m.t === 'tile' && m.x === c.x && m.y === c.y && m.id === 0); }
    await sleep(1500);
    const invs = g.inbox.filter((m) => m.t === 'inv');
    assert.ok(invs.length >= 1, 'guest kit updated by drops');
    assert.ok(invs.every((m) => m.guest === true));
    assert.ok(invs.at(-1).items[T.DIRT] > kit0.items[T.DIRT]);
    assert.equal(await store.invGet(gw.you.id), null);
    g.sendJ({ t: 'quest_claim', qid: 'plant_5', req: 1 });
    assert.match((await g.waitFor((m) => m.t === 'inv_result')).error, /Login/);
    g.close();
  });

  await t.test('servers logged no errors', () => {
    for (const s of servers) assert.equal(linesFor(s, /\[ws\] (welcome failed|handler error)|\[inv\] .*failed|unhandled/i).length, 0, s.log);
  });
});
