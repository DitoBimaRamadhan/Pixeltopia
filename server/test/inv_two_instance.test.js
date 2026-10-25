'use strict';
/**
 * Step 2 end-to-end: real server processes (index.js) against Postgres. Needs TEST_DATABASE_URL
 * (never DATABASE_URL; refuses the production host from server/.env).
 *   A, B: SERVER_INV=1 (two instances, same DB)      C: SERVER_INV unset (flag off)
 * Test accounts are zz<rand> users; all their rows are deleted afterwards.
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
function connect(base, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    ws.inbox = [];
    ws.on('message', (m) => { const o = JSON.parse(String(m)); if (o.t !== 'snap') ws.inbox.push(o); });
    ws.waitFor = async (pred, ms = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const m = ws.inbox.find(pred); if (m) return m; await sleep(25); }
      throw new Error('timeout waiting for message');
    };
    ws.sendJ = (o) => ws.send(JSON.stringify(o));
    ws.on('open', () => resolve(ws)); ws.on('error', reject);
  });
}
const linesFor = (srv, re) => srv.log.split('\n').filter((l) => re.test(l));

test('SERVER_INV steps 2-3: seeding, inv message, phase A, paid place, refunds, WL credit, guests, flag off', { skip, timeout: 180000 }, async (t) => {
  const store = createStore({ databaseUrl: URL_ });
  await store.init(); // migrations applied before the servers race on them
  const rnd = crypto.randomBytes(3).toString('hex');
  const PW = crypto.randomBytes(9).toString('base64url');
  const names = { fresh: `zzn${rnd}`, mig: `zzm${rnd}`, race: `zzr${rnd}`, off: `zzo${rnd}`, pa: `zza${rnd}`, pb: `zzb${rnd}` };
  const WP = `ZZT${rnd.toUpperCase()}`;
  const ids = {}; const tok = {};
  const servers = [];
  const sockets = [];
  t.after(async () => {
    for (const ws of sockets) { try { ws.close(); } catch { /* ignore */ } }
    await Promise.all(servers.map((s) => new Promise((r) => { if (s.proc.exitCode !== null) return r(); s.proc.once('exit', r); s.proc.kill('SIGTERM'); setTimeout(() => { s.proc.kill('SIGKILL'); r(); }, 8000); })));
    const list = Object.values(ids);
    if (list.length) {
      for (const tbl of ['inventory_ledger', 'inventory_items', 'wallets', 'quest_claims', 'active_sessions', 'profiles']) {
        await store._query(`DELETE FROM ${tbl} WHERE user_id = ANY($1)`, [list]);
      }
      await store._query('DELETE FROM users WHERE id = ANY($1)', [list]);
      for (const tbl of ['world_events', 'world_presence']) await store._query(`DELETE FROM ${tbl} WHERE world LIKE $1`, [`${WP}%`]);
      await store._query('DELETE FROM worlds WHERE name LIKE $1', [`${WP}%`]);
      const left = await store._query('SELECT (SELECT count(*) FROM wallets WHERE user_id = ANY($1)) + (SELECT count(*) FROM users WHERE id = ANY($1)) AS c', [list]);
      assert.equal(Number(left.rows[0].c), 0, 'test rows left behind');
    }
    await store.close();
  });

  const [A, B, C] = await Promise.all([
    startServer('A', { SERVER_INV: '1' }), startServer('B', { SERVER_INV: '1' }), startServer('C', {}),
  ]);
  servers.push(A, B, C);
  for (const [k, u] of Object.entries(names)) {
    const r = await post(A.base, '/register', { username: u, password: PW });
    assert.equal(r.status, 201, `register ${k}`);
    ids[k] = r.json.userId; tok[k] = r.json.token;
  }
  const open = async (srv, k) => { const ws = await connect(srv.base, k ? tok[k] : ''); sockets.push(ws); return ws; };

  await t.test('brand-new account gets the starter wallet and an inv message right after welcome', async () => {
    const ws = await open(A, 'fresh');
    const inv = await ws.waitFor((m) => m.t === 'inv');
    const iWelcome = ws.inbox.findIndex((m) => m.t === 'welcome');
    assert.ok(iWelcome >= 0 && iWelcome < ws.inbox.indexOf(inv), 'inv comes after welcome');
    const st = rules.starterInventory();
    assert.deepEqual(inv, { t: 'inv', ver: 1, items: Object.fromEntries(Object.entries(st.items).map(([k, v]) => [String(k), v])), gems: st.gems });
    const w = await store._query('SELECT seeded_from FROM wallets WHERE user_id = $1', [ids.fresh]);
    assert.equal(w.rows[0].seeded_from, 'starter');
    assert.equal(linesFor(A, new RegExp(`\\[inv\\] seeded user=${ids.fresh} from=starter`)).length, 1);
    ws.close();
  });

  await t.test('phase A: client inventory writes (inv_sync, profile inventory) never change the wallet', async () => {
    const ws = await open(A, 'fresh');
    await ws.waitFor((m) => m.t === 'inv');
    const st = rules.starterInventory();
    ws.sendJ({ t: 'inv_sync', items: { ...st.items, [T.DIRT]: 70 }, gems: 99 });
    ws.sendJ({ t: 'profile_save', profile: { inventory: { slots: [-1, T.DIRT], counts: [0, 5], gems: 1 } }, now: true });
    ws.sendJ({ t: 'ping' });
    await ws.waitFor((m) => m.t === 'pong');
    await sleep(300);
    assert.deepEqual(await store.invGet(ids.fresh), { ver: 1, gems: st.gems, items: Object.fromEntries(Object.entries(st.items).map(([k, v]) => [String(k), v])) });
    // the profile (slot layout, progress...) is still stored, but only as client data
    await sleep(500);
    const prof = await store.getProfile(ids.fresh);
    assert.deepEqual(prof.inventory.counts, [0, 5]);
    assert.ok(!ws.inbox.some((m) => m.t === 'error'));
    ws.close();
  });

  await t.test('migrating account is seeded from its profile inventory, sanitized + logged', async () => {
    await store.saveProfile(ids.mig, { inventory: { slots: [-1, T.DIRT, T.DIRT, T.WORLD_LOCK, 999, T.TORCH], counts: [0, 200, 120, 30, 4, 9], selected: 1, gems: 777 } }, Date.now());
    const ws = await open(B, 'mig');
    const inv = await ws.waitFor((m) => m.t === 'inv');
    assert.deepEqual(inv, { t: 'inv', ver: 1, items: { [T.DIRT]: 320, [T.TORCH]: 9, [T.WORLD_LOCK]: 20 }, gems: 777 });
    const w = await store._query('SELECT seeded_from FROM wallets WHERE user_id = $1', [ids.mig]);
    assert.equal(w.rows[0].seeded_from, 'profile');
    const sus = linesFor(B, new RegExp(`\\[inv\\] suspicious seed user=${ids.mig} `));
    assert.equal(sus.length, 1);
    assert.match(sus[0], /unknown_ids:1/);
    assert.match(sus[0], /cap:20:30>20/);
    ws.close();
  });

  await t.test('same account on A and B concurrently is seeded exactly once', async () => {
    await store.saveProfile(ids.race, { inventory: { slots: [-1, T.STONE], counts: [0, 42], gems: 3 } }, Date.now());
    const [a, b] = await Promise.all([open(A, 'race'), open(B, 'race')]);
    // newest login wins: the other socket may be kicked before (or after) its welcome
    const settled = (ws) => ws.waitFor((m) => m.t === 'welcome' || m.t === 'kicked');
    await Promise.all([settled(a), settled(b)]);
    await sleep(2500);
    const invs = [...a.inbox, ...b.inbox].filter((m) => m.t === 'inv');
    assert.ok(invs.length >= 1);
    for (const m of invs) assert.deepEqual(m, { t: 'inv', ver: 1, items: { [T.STONE]: 42 }, gems: 3 });
    const seeded = [...linesFor(A, new RegExp(`seeded user=${ids.race} `)), ...linesFor(B, new RegExp(`seeded user=${ids.race} `))];
    assert.equal(seeded.length, 1, seeded.join('\n'));
    const l = await store._query('SELECT count(*)::int AS c FROM inventory_ledger WHERE user_id = $1', [ids.race]);
    assert.equal(l.rows[0].c, 1);
    a.close(); b.close();
    // and the raw race the handshake relies on: two independent pools (≈ two instances) ensuring at once
    const other = createStore({ databaseUrl: URL_ });
    try {
      const u = `${ids.race}`; // reuse a test id so cleanup covers it
      await store._query('DELETE FROM inventory_items WHERE user_id = $1', [u]);
      await store._query('DELETE FROM inventory_ledger WHERE user_id = $1', [u]);
      await store._query('DELETE FROM wallets WHERE user_id = $1', [u]);
      const res = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? other : store).invEnsure(u, { gems: i, items: { [T.DIRT]: i + 1 } }, `p${i}`)));
      assert.equal(res.filter((r) => r.created).length, 1);
      const st = await store.invGet(u);
      for (const r of res) assert.deepEqual(r.state, st);
      const l2 = await store._query('SELECT count(*)::int AS c FROM inventory_ledger WHERE user_id = $1', [u]);
      assert.equal(l2.rows[0].c, 1);
    } finally { await other.close(); }
  });

  await t.test('guests get a session-only kit (starter minus World Lock), never a DB wallet', async () => {
    const ws = await open(A, null);
    const w = await ws.waitFor((m) => m.t === 'welcome');
    assert.equal(w.you.guest, true);
    const inv = await ws.waitFor((m) => m.t === 'inv');
    const kit = { ...rules.STARTER_ITEMS }; delete kit[T.WORLD_LOCK];
    assert.deepEqual(inv, { t: 'inv', ver: 1, items: Object.fromEntries(Object.entries(kit).map(([k, v]) => [String(k), v])), gems: rules.STARTER_GEMS, guest: true });
    ws.sendJ({ t: 'inv_sync', items: { 1: 5 }, gems: 1 });
    ws.sendJ({ t: 'ping' });
    await ws.waitFor((m) => m.t === 'pong');
    assert.equal(ws.inbox.filter((m) => m.t === 'inv').length, 1);
    assert.equal(await store.invGet(w.you.id), null);
    assert.equal(linesFor(A, new RegExp(`\\[inv\\].*user=${w.you.id}`)).length, 0);
    ws.close();
  });

  await t.test('flag off (instance C): no wallet, no inv message, no [inv] logs', async () => {
    const ws = await open(C, 'off');
    const w = await ws.waitFor((m) => m.t === 'welcome');
    assert.equal(w.you.guest, false);
    ws.sendJ({ t: 'inv_sync', items: { 1: 5 }, gems: 1 });
    ws.sendJ({ t: 'ping' });
    await ws.waitFor((m) => m.t === 'pong');
    await sleep(300);
    assert.ok(!ws.inbox.some((m) => m.t === 'inv'));
    assert.equal(await store.invGet(ids.off), null);
    assert.equal(linesFor(C, /\[inv\]/).length, 0);
    ws.close();
  });

  // ---------------------------------------------------------------- step 3: paid place, refunds, WL credit
  const join = async (ws, name, create) => {
    ws.sendJ({ t: create ? 'create_world' : 'join_world', name });
    return ws.waitFor((m) => m.t === 'world_state' && m.name === name);
  };
  const airOnSoil = (st, skip = []) => {
    for (let i = st.w * 3; i < st.grid.length - st.w; i++) if (st.grid[i] === 0 && rules.isSoil(st.grid[i + st.w]) && !skip.includes(i)) return { x: i % st.w, y: (i / st.w) | 0, i };
    throw new Error('no air');
  };
  const lastInv = (ws) => ws.inbox.filter((m) => m.t === 'inv').at(-1);
  const head = async (name) => Number((await store._query('SELECT head_seq FROM worlds WHERE name = $1', [name])).rows[0].head_seq);

  await t.test('race over two real instances: same tile from A and B, loser refunded, no double debit', async () => {
    const a = await open(A, 'pa'); const b = await open(B, 'pb');
    await Promise.all([a.waitFor((m) => m.t === 'inv'), b.waitFor((m) => m.t === 'inv')]);
    const name = `${WP}R`;
    const st = await join(a, name, true);
    await join(b, name, false);
    await sleep(500);
    const c = airOnSoil(st);
    const h0 = await head(name);
    a.sendJ({ t: 'place', x: c.x, y: c.y, id: T.DIRT });
    b.sendJ({ t: 'place', x: c.x, y: c.y, id: T.DIRT });
    await sleep(3000);
    assert.equal(await head(name), h0 + 2, 'both paid places reached the log');
    const [wa, wb] = [await store.invGet(ids.pa), await store.invGet(ids.pb)];
    const start = rules.STARTER_ITEMS[T.DIRT];
    assert.deepEqual([wa.items[T.DIRT], wb.items[T.DIRT]].sort(), [start - 1, start], 'exactly one paid');
    const loserIsA = wa.items[T.DIRT] === start;
    const [lws, lid] = loserIsA ? [a, ids.pa] : [b, ids.pb];
    const [wws] = loserIsA ? [b] : [a];
    assert.ok(lws.inbox.some((m) => m.t === 'error' && /Tile tidak kosong/.test(m.error)), 'loser told');
    assert.equal(lastInv(lws).items[T.DIRT], start, 'loser sees the refund');
    assert.equal(lastInv(wws).items[T.DIRT], start - 1, 'winner sees the debit');
    const { rows } = await store._query("SELECT split_part(op_id, ':', 1) AS k FROM inventory_ledger WHERE user_id = $1 AND op_id NOT LIKE 'seed:%' ORDER BY k", [lid]);
    assert.deepEqual(rows.map((r) => r.k), ['place', 'refund']);
    a.close(); b.close();
  });

  await t.test('not enough items / strict rule: refused, nothing appended', async () => {
    const b = await open(B, 'pb');
    await b.waitFor((m) => m.t === 'inv');
    const name = `${WP}N`;
    const st = await join(b, name, true);
    const c = airOnSoil(st);
    await sleep(300);
    const h0 = await head(name);
    b.sendJ({ t: 'place', x: c.x, y: c.y, id: T.PLANK }); // starter has no planks
    const e1 = await b.waitFor((m) => m.t === 'error');
    assert.equal(e1.error, 'Item tidak cukup');
    b.inbox.length = 0;
    b.sendJ({ t: 'place', x: c.x, y: 2, id: T.SEED }); // seed in mid-air
    const e2 = await b.waitFor((m) => m.t === 'error');
    assert.match(e2.error, /tidak bisa/);
    b.inbox.length = 0;
    b.sendJ({ t: 'place', x: c.x, y: c.y, id: T.FERTILIZER }); // not placeable (and not owned)
    await b.waitFor((m) => m.t === 'error');
    await sleep(500);
    assert.equal(await head(name), h0, 'nothing appended');
    assert.ok(!b.inbox.some((m) => m.t === 'tile'), 'no tile shown');
    b.close();
  });

  await t.test('owner breaks own World Lock online: credited back 100% (A places, logged, B-side state agrees)', async () => {
    const a = await open(A, 'pa');
    const inv0 = await a.waitFor((m) => m.t === 'inv');
    const wl0 = inv0.items[T.WORLD_LOCK] || 0;
    assert.ok(wl0 >= 1);
    const name = `${WP}L`;
    const st = await join(a, name, true);
    const c = airOnSoil(st);
    a.inbox.length = 0;
    a.sendJ({ t: 'place', x: c.x, y: c.y, id: T.WORLD_LOCK });
    await a.waitFor((m) => m.t === 'tile' && m.x === c.x && m.y === c.y && m.id === T.WORLD_LOCK);
    await a.waitFor((m) => m.t === 'inv' && (m.items[T.WORLD_LOCK] || 0) === wl0 - 1);
    await sleep(800);
    a.inbox.length = 0;
    a.sendJ({ t: 'punch', x: c.x, y: c.y });
    await a.waitFor((m) => m.t === 'tile' && m.x === c.x && m.y === c.y && m.id === 0);
    const back = await a.waitFor((m) => m.t === 'inv' && (m.items[T.WORLD_LOCK] || 0) === wl0, 10000);
    assert.ok(back);
    await sleep(1500); // both instances process the log; credit must still be exactly one
    assert.equal((await store.invGet(ids.pa)).items[T.WORLD_LOCK], wl0);
    const { rows } = await store._query("SELECT count(*)::int AS c FROM inventory_ledger WHERE user_id = $1 AND op_id LIKE 'wlbreak:%'", [ids.pa]);
    assert.equal(rows[0].c, 1);
    assert.equal(linesFor(A, new RegExp(`\\[inv\\] wl_break user=${ids.pa} `)).length, 1);
    a.close();
  });

  await t.test('flag off (C): placing works as before, wallets untouched', async () => {
    const ws = await open(C, 'off');
    await ws.waitFor((m) => m.t === 'welcome');
    const name = `${WP}O`;
    const st = await join(ws, name, true);
    const c = airOnSoil(st);
    ws.sendJ({ t: 'place', x: c.x, y: c.y, id: T.PLANK });
    await ws.waitFor((m) => m.t === 'tile' && m.x === c.x && m.y === c.y && m.id === T.PLANK);
    assert.ok(!ws.inbox.some((m) => m.t === 'inv' || m.t === 'error'));
    assert.equal(await store.invGet(ids.off), null);
    ws.close();
  });

  await t.test('guest with flag on: places pay from the session kit; strict rule; no World Lock; no DB wallet', async () => {
    const ws = await open(A, null);
    const w = await ws.waitFor((m) => m.t === 'welcome');
    await ws.waitFor((m) => m.t === 'inv');
    const name = `${WP}G`;
    const st = await join(ws, name, true);
    const c = airOnSoil(st);
    ws.sendJ({ t: 'place', x: c.x, y: c.y, id: T.DIRT });
    await ws.waitFor((m) => m.t === 'tile' && m.x === c.x && m.id === T.DIRT);
    await ws.waitFor((m) => m.t === 'inv' && m.items[T.DIRT] === rules.STARTER_ITEMS[T.DIRT] - 1);
    ws.sendJ({ t: 'place', x: c.x, y: 2, id: T.SEED });
    assert.match((await ws.waitFor((m) => m.t === 'error')).error, /tidak bisa/);
    ws.inbox.length = 0;
    ws.sendJ({ t: 'place', x: c.x, y: 3, id: T.WORLD_LOCK });
    assert.match((await ws.waitFor((m) => m.t === 'error')).error, /Login/);
    assert.equal(await store.invGet(w.you.id), null);
    ws.close();
  });

  await t.test('servers logged no errors', () => {
    for (const s of servers) assert.equal(linesFor(s, /\[ws\] (welcome failed|handler error)|\[inv\] ensure wallet failed/).length, 0, s.log);
  });
});
