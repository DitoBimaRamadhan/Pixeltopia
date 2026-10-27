'use strict';
/**
 * v1.8 social/daily end-to-end on two real server processes sharing one Postgres: daily login reward
 * (streak, exactly once across instances), daily quests, leaderboard, friends + private messages across
 * instances, owner-only world settings synced across instances and persisted in the snapshot.
 * Needs TEST_DATABASE_URL (never the prod host). zz<rand> accounts; every row is deleted afterwards.
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
const daily = require('../lib/daily');

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
function connect(base, token, proto = 3) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?${proto ? `proto=${proto}&` : ''}${token ? `token=${encodeURIComponent(token)}` : ''}`);
    ws.inbox = [];
    // v1.8: the server checks reach and needs several hits per block. Edits first "walk" to the tile, and
    // a punch keeps hitting (spaced under the rate limit) while the server answers with `hit` progress.
    ws.punching = new Set();
    ws.on('message', (m) => {
      const o = JSON.parse(String(m));
      if (o.t === 'snap') return;
      ws.inbox.push(o);
      const k = `${o.x},${o.y}`;
      if (o.t === 'hit' && ws.punching.has(k)) setTimeout(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'punch', x: o.x, y: o.y })); }, 160);
      else if ((o.t === 'tile' || o.t === 'error') && ws.punching.has(k)) ws.punching.delete(k);
      else if (o.t === 'error') ws.punching.clear();
    });
    ws.waitFor = async (pred, ms = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const m = ws.inbox.find(pred); if (m) return m; await sleep(25); }
      throw new Error('timeout waiting for message');
    };
    ws.sendJ = (o) => {
      if ((o.t === 'punch' || o.t === 'place' || o.t === 'fertilize') && Number.isInteger(o.x)) {
        ws.send(JSON.stringify({ t: 'move', tx: o.x, ty: o.y }));
        if (o.t === 'punch') ws.punching.add(`${o.x},${o.y}`);
      }
      ws.send(JSON.stringify(o));
    };
    ws.closeCode = null; ws.on('close', (c) => { ws.closeCode = c; });
    ws.on('open', () => resolve(ws)); ws.on('error', reject);
  });
}

test('v1.8 daily, leaderboard, friends/PM and world settings over two instances', { skip, timeout: 240000 }, async (t) => {
  const store = createStore({ databaseUrl: URL_ });
  await store.init();
  const rnd = crypto.randomBytes(3).toString('hex');
  const PW = crypto.randomBytes(9).toString('base64url');
  const names = { p1: `zzs${rnd}`, p2: `zzt${rnd}` };
  const WP = `ZZS${rnd.toUpperCase()}`;
  const ids = {}; const tok = {};
  const servers = []; const sockets = [];
  t.after(async () => {
    for (const ws of sockets) { try { ws.close(); } catch { /* ignore */ } }
    await Promise.all(servers.map((s) => new Promise((r) => { if (s.proc.exitCode !== null) return r(); s.proc.once('exit', r); s.proc.kill('SIGTERM'); setTimeout(() => { s.proc.kill('SIGKILL'); r(); }, 8000); })));
    const list = Object.values(ids);
    if (list.length) {
      for (const tbl of ['inventory_ledger', 'inventory_items', 'wallets', 'quest_claims', 'active_sessions', 'profiles', 'friends']) {
        await store._query(`DELETE FROM ${tbl} WHERE user_id = ANY($1)`, [list]);
      }
      await store._query('DELETE FROM private_messages WHERE from_id = ANY($1) OR to_id = ANY($1)', [list]);
      await store._query('DELETE FROM users WHERE id = ANY($1)', [list]);
      for (const tbl of ['world_events', 'world_presence']) await store._query(`DELETE FROM ${tbl} WHERE world LIKE $1`, [`${WP}%`]);
      await store._query('DELETE FROM worlds WHERE name LIKE $1', [`${WP}%`]);
      const left = await store._query(`SELECT (SELECT count(*) FROM wallets WHERE user_id = ANY($1)) + (SELECT count(*) FROM users WHERE id = ANY($1))
        + (SELECT count(*) FROM friends WHERE user_id = ANY($1) OR friend_id = ANY($1))
        + (SELECT count(*) FROM private_messages WHERE from_id = ANY($1) OR to_id = ANY($1))
        + (SELECT count(*) FROM inventory_ledger WHERE user_id = ANY($1))
        + (SELECT count(*) FROM worlds WHERE name LIKE $2) AS c`, [list, `${WP}%`]);
      assert.equal(Number(left.rows[0].c), 0, 'test rows left behind');
    }
    await store.close();
  });

  const [A, B] = await Promise.all([startServer('A', { SERVER_INV: '1', MIN_PROTO: '3' }), startServer('B', { SERVER_INV: '1', MIN_PROTO: '3' })]);
  servers.push(A, B);
  for (const [k, u] of Object.entries(names)) {
    const r = await post(A.base, '/register', { username: u, password: PW, proto: 3 });
    assert.equal(r.status, 201, `register ${k}`);
    ids[k] = r.json.userId; tok[k] = r.json.token;
  }
  const open = async (srv, k) => { const ws = await connect(srv.base, tok[k]); sockets.push(ws); await ws.waitFor((m) => m.t === 'inv'); return ws; };
  const lastInv = (ws) => ws.inbox.filter((m) => m.t === 'inv').at(-1);
  const gemsOf = async (u) => Number((await store.invGet(u)).gems);
  const grant = (u, ops, reason = 'test', opId) => store.invApply(opId || `test:${u}:${crypto.randomBytes(4).toString('hex')}`, u, ops, reason);

  let p1 = await open(A, 'p1');
  let p2 = await open(B, 'p2');
  const today = daily.dayKey();

  await t.test('daily login: streak from yesterday, paid exactly once across sockets and instances', async () => {
    p1.inbox.length = 0;
    p1.sendJ({ t: 'daily_state' });
    let st = await p1.waitFor((m) => m.t === 'daily_state');
    assert.equal(st.day, today);
    assert.equal(st.claimedToday, false);
    assert.equal(st.streak, 1);
    assert.equal(st.reward, 15);
    assert.equal(st.quests.length, daily.DAILY_COUNT);
    // yesterday's claim (written like the server does) makes today streak day 2
    const yday = daily.prevDayKey(today);
    assert.ok((await grant(ids.p1, { gems: 1 }, 'daily', daily.loginOpId(ids.p1, yday))).ok);
    await store._query('UPDATE inventory_ledger SET created_at = $2 WHERE op_id = $1', [daily.loginOpId(ids.p1, yday), daily.dayStart() - 3600e3]);
    p1.inbox.length = 0;
    p1.sendJ({ t: 'daily_state' });
    st = await p1.waitFor((m) => m.t === 'daily_state');
    assert.equal(st.streak, 2);
    assert.equal(st.reward, 20);
    const g0 = await gemsOf(ids.p1);
    p1.inbox.length = 0;
    for (let i = 0; i < 3; i++) p1.sendJ({ t: 'daily_claim' });
    for (let t0 = Date.now(); p1.inbox.filter((m) => m.t === 'daily_state' && m.claim).length < 3 && Date.now() - t0 < 20000;) await sleep(50);
    const claims = p1.inbox.filter((m) => m.t === 'daily_state' && m.claim);
    assert.equal(claims.length, 3);
    assert.equal(claims.filter((m) => m.claim.ok).length, 1, 'one success');
    assert.equal(await gemsOf(ids.p1), g0 + 20);
    assert.equal(lastInv(p1).gems, g0 + 20);
    // same account on the other instance (the old connection gets kicked): still no second payment
    p1 = await open(B, 'p1');
    p1.sendJ({ t: 'daily_claim' });
    const again = await p1.waitFor((m) => m.t === 'daily_state' && m.claim);
    assert.equal(again.claim.ok, false);
    assert.equal(again.claimedToday, true);
    assert.equal(again.streak, 2);
    assert.equal(await gemsOf(ids.p1), g0 + 20);
    const { rows } = await store._query("SELECT count(*)::int AS n FROM inventory_ledger WHERE user_id = $1 AND reason = 'daily' AND op_id = $2", [ids.p1, daily.loginOpId(ids.p1, today)]);
    assert.equal(rows[0].n, 1);
  });

  await t.test('daily quests: today-only progress, claim exactly once', async () => {
    const q = daily.questsForDay(today)[0];
    for (let i = 0; i < q.goal - 1; i++) assert.ok((await grant(ids.p1, { gems: 1 }, q.reason)).ok);
    // a row from yesterday does not count
    const old = await grant(ids.p1, { gems: 1 }, q.reason, `test:${ids.p1}:old`);
    assert.ok(old.ok);
    await store._query('UPDATE inventory_ledger SET created_at = $2 WHERE op_id = $1', [`test:${ids.p1}:old`, daily.dayStart() - 1000]);
    p1.inbox.length = 0;
    p1.sendJ({ t: 'daily_quest_claim', key: q.key });
    let r = await p1.waitFor((m) => m.t === 'daily_state' && m.claim && m.claim.key === q.key);
    assert.equal(r.claim.ok, false);
    assert.equal(r.claim.error, 'Belum selesai.');
    assert.equal(r.quests.find((x) => x.key === q.key).progress, q.goal - 1);
    assert.ok((await grant(ids.p1, { gems: 1 }, q.reason)).ok);
    const g0 = await gemsOf(ids.p1);
    p1.inbox.length = 0;
    p1.sendJ({ t: 'daily_quest_claim', key: q.key });
    p1.sendJ({ t: 'daily_quest_claim', key: q.key });
    for (let t0 = Date.now(); p1.inbox.filter((m) => m.t === 'daily_state' && m.claim).length < 2 && Date.now() - t0 < 20000;) await sleep(50);
    const res = p1.inbox.filter((m) => m.t === 'daily_state' && m.claim);
    assert.equal(res.filter((m) => m.claim.ok).length, 1);
    assert.equal(await gemsOf(ids.p1), g0 + q.gems);
    r = res.at(-1);
    assert.equal(r.quests.find((x) => x.key === q.key).claimed, true);
    p1.inbox.length = 0;
    p1.sendJ({ t: 'daily_quest_claim', key: 'nope' });
    assert.match((await p1.waitFor((m) => m.t === 'social_error')).error, /tidak dikenal/);
  });

  await t.test('leaderboard lists the richest players and my rank', async () => {
    await grant(ids.p2, { gems: 1 });
    p2.inbox.length = 0;
    p2.sendJ({ t: 'leaderboard' });
    const lb = await p2.waitFor((m) => m.t === 'leaderboard');
    assert.ok(Array.isArray(lb.top) && lb.top.length >= 1 && lb.top.length <= 20);
    for (let i = 1; i < lb.top.length; i++) assert.ok(lb.top[i - 1].gems >= lb.top[i].gems);
    assert.ok(lb.me && lb.me.rank >= 1 && lb.me.gems === await gemsOf(ids.p2));
    assert.ok(!JSON.stringify(lb).includes('password'));
  });

  await t.test('friends: request, mutual, PM only between friends, delivered once across instances', async () => {
    p1 = await open(A, 'p1');
    p1.inbox.length = 0; p2.inbox.length = 0;
    p1.sendJ({ t: 'friend_add', name: names.p2 });
    let fl = await p1.waitFor((m) => m.t === 'friends');
    assert.deepEqual(fl.outgoing.map((e) => e.username), [names.p2]);
    p1.sendJ({ t: 'pm_send', to: ids.p2, text: 'halo' });
    assert.match((await p1.waitFor((m) => m.t === 'social_error')).error, /teman/);
    p2.sendJ({ t: 'friend_list' });
    fl = await p2.waitFor((m) => m.t === 'friends');
    assert.deepEqual(fl.incoming.map((e) => e.username), [names.p1]);
    p2.inbox.length = 0;
    p2.sendJ({ t: 'friend_add', name: names.p1 });
    fl = await p2.waitFor((m) => m.t === 'friends');
    assert.deepEqual(fl.friends.map((e) => e.username), [names.p1]);
    p1.inbox.length = 0; p2.inbox.length = 0;
    p1.sendJ({ t: 'pm_send', to: ids.p2, text: 'halo teman' });
    const got = await p2.waitFor((m) => m.t === 'pm', 15000);
    assert.equal(got.text, 'halo teman');
    assert.equal(got.fromName, names.p1);
    await p1.waitFor((m) => m.t === 'pm'); // echo to the sender
    await sleep(4000);
    assert.equal(p2.inbox.filter((m) => m.t === 'pm').length, 1, 'delivered once');
    p2.sendJ({ t: 'friend_list' });
    fl = await p2.waitFor((m) => m.t === 'friends' && m.unread);
    assert.equal(fl.unread.find((u) => u.from === ids.p1).n, 1);
    p2.inbox.length = 0;
    p2.sendJ({ t: 'pm_thread', with: ids.p1 });
    const th = await p2.waitFor((m) => m.t === 'pm_thread');
    assert.deepEqual(th.messages.map((m) => m.text), ['halo teman']);
    p2.sendJ({ t: 'friend_list' });
    fl = await p2.waitFor((m) => m.t === 'friends' && m !== th);
    assert.equal((fl.unread || []).length, 0);
    p1.inbox.length = 0;
    p1.sendJ({ t: 'friend_remove', id: ids.p2 });
    fl = await p1.waitFor((m) => m.t === 'friends');
    assert.equal(fl.friends.length + fl.outgoing.length + fl.incoming.length, 0);
  });

  await t.test('world settings: owner only, synced to the other instance, persisted', async () => {
    const WN = `${WP}W`;
    await grant(ids.p1, { items: { [T.WORLD_LOCK]: 1, [T.DIRT]: 0 } });
    p1.close(); p1 = await open(A, 'p1');
    p1.sendJ({ t: 'create_world', name: WN });
    const st = await p1.waitFor((m) => m.t === 'world_state' && m.name === WN);
    assert.deepEqual(st.settings, {});
    let spot = null;
    for (let i = st.w * 3; i < st.grid.length - st.w; i++) if (st.grid[i] === 0 && st.grid[i + st.w] !== 0) { spot = { x: i % st.w, y: (i / st.w) | 0 }; break; }
    p1.sendJ({ t: 'place', x: spot.x, y: spot.y, id: T.WORLD_LOCK });
    await p1.waitFor((m) => m.t === 'tile' && m.id === T.WORLD_LOCK);
    p2.inbox.length = 0;
    p2.sendJ({ t: 'join_world', name: WN });
    await p2.waitFor((m) => m.t === 'world_state' && m.name === WN);
    p2.sendJ({ t: 'world_settings_set', settings: { open: true } });
    assert.match((await p2.waitFor((m) => m.t === 'error')).error, /pemilik/);
    p1.inbox.length = 0; p2.inbox.length = 0;
    p1.sendJ({ t: 'world_settings_set', settings: { open: true, bg: 2, welcome: 'Selamat datang\nbro', junk: 5 } });
    const mine = await p1.waitFor((m) => m.t === 'world_settings');
    assert.deepEqual(mine.settings, { open: true, bg: 2, welcome: 'Selamat datang bro' });
    const theirs = await p2.waitFor((m) => m.t === 'world_settings', 15000);
    assert.deepEqual(theirs.settings, mine.settings);
    // open world: the non-owner on the other instance may build
    await grant(ids.p2, { items: { [T.DIRT]: 2 } });
    p2.close(); p2 = await open(B, 'p2');
    p2.sendJ({ t: 'join_world', name: WN });
    const st2 = await p2.waitFor((m) => m.t === 'world_state' && m.name === WN);
    assert.deepEqual(st2.settings, mine.settings);
    let air = null;
    for (let i = st2.w * 3; i < st2.grid.length - st2.w; i++) if (st2.grid[i] === 0 && st2.grid[i + st2.w] !== 0 && (i % st2.w) !== spot.x) { air = { x: i % st2.w, y: (i / st2.w) | 0 }; break; }
    p2.sendJ({ t: 'place', x: air.x, y: air.y, id: T.DIRT });
    await p2.waitFor((m) => m.t === 'tile' && m.x === air.x && m.y === air.y && m.id === T.DIRT);
    await sleep(7000); // snapshot interval
    const { rows } = await store._query('SELECT settings FROM worlds WHERE name = $1', [WN]);
    assert.deepEqual(rows[0].settings, mine.settings);
    // closed again: the non-owner is refused
    p1.sendJ({ t: 'world_settings_set', settings: { open: false } });
    await p2.waitFor((m) => m.t === 'world_settings' && !m.settings.open, 15000);
    p2.inbox.length = 0;
    p2.sendJ({ t: 'punch', x: air.x, y: air.y });
    assert.match((await p2.waitFor((m) => m.t === 'error')).error, /terkunci/);
  });
});
