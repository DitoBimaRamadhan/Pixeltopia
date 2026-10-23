// Entry point: HTTP static server + WebSocket game server (satu proses).
//
// SKALABILITAS (ringkas, detail di README):
//  - Semua state game hidup di objek `World` (server/world.js), satu per nama world.
//  - Proses ini adalah "world host": ia memuat world sesuai permintaan & membongkarnya saat kosong.
//  - Untuk banyak server: jalankan N proses/instance; tiap world dimiliki tepat 1 proses.
//    Gateway/lobby menanyakan Redis "world:<NAME> -> host" (SET NX + TTL sebagai lease),
//    lalu mengarahkan client ke host itu. Chat global/friend lewat Redis Pub/Sub,
//    data pemain & world disimpan di Redis/Postgres/S3 alih-alih file JSON lokal.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { World } = require('./world');
const { createStorage } = require('./storage');
const auth = require('./auth');
const storage = createStorage();
const S = require('../public/shared');

const PORT = Number(process.env.PORT) || 3000;
const VERSION = '1.4';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

// ---------- HTTP (static files) ----------
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, v: VERSION, worlds: worlds.size, players: clients.size })); }
  const file = path.normalize(path.join(PUBLIC_DIR, url === '/' ? 'index.html' : url));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------- World manager ----------
const worlds = new Map();   // name -> World
const loading = new Map();  // name -> Promise<World> (hindari muat ganda saat 2 pemain masuk bersamaan)
const clients = new Map();  // id -> { ws, account, player, world }
const START_GEMS = Number(process.env.START_GEMS) || 0;
const START_INV = () => ({ 2: 20, 102: 4, 103: 2 });

const io = {
  broadcast(world, msg, exceptId) {
    const data = JSON.stringify(msg);
    for (const id of world.players.keys()) {
      if (id === exceptId) continue;
      const c = clients.get(id);
      if (c && c.ws.readyState === 1) c.ws.send(data);
    }
  },
  sendTo(id, msg) {
    const c = clients.get(id);
    if (c && c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
  },
  savePlayer(id) { const c = clients.get(id); return c ? savePlayer(c) : Promise.resolve(); }
};

async function getWorld(name) {
  if (worlds.has(name)) return worlds.get(name);
  if (!loading.has(name)) {
    loading.set(name, World.load(name, io, storage).then((w) => {
      worlds.set(name, w); loading.delete(name); console.log(`[world] loaded ${name}`); return w;
    }, (e) => { loading.delete(name); throw e; }));
  }
  return loading.get(name);
}

// Simpan data pemain (inventori/gem) tanpa menimpa hash password & sesi terbaru.
function savePlayer(c) {
  const p = c.player; if (!p) return Promise.resolve();
  p.dirty = false;
  const inv = { ...p.inv }, gems = p.gems, equip = { ...(p.equip || {}) };
  return storage.updatePlayer(p.key, (rec) => { rec.inv = inv; rec.gems = gems; rec.equip = equip; rec.savedAt = Date.now(); })
    .catch((e) => { p.dirty = true; console.error('[player] gagal simpan', p.key, e.message); }); // gagal -> coba lagi di flush berikutnya
}

function leaveWorld(c) {
  if (!c.world) return;
  const w = c.world;
  w.removePlayer(c.id);
  c.world = null;
  if (w.players.size === 0) { // unload world kosong agar memori tetap kecil
    worlds.delete(w.name);
    if (w.dirty) w.save();
    console.log(`[world] unloaded ${w.name}`);
  }
}

// Simpan berkala.
setInterval(() => {
  for (const w of worlds.values()) if (w.dirty) w.save();
  for (const c of clients.values()) if (c.player && c.player.dirty) savePlayer(c);
}, 5000).unref();

// ---------- Akun ----------
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const WORLD_RE = /^[A-Z0-9]{1,24}$/;
const fails = new Map(); // key -> { n, until } : kunci sementara setelah 5x salah password

// Satu sesi per akun: putuskan koneksi lain milik akun yang sama.
async function kickOthers(c, key) {
  for (const o of clients.values()) {
    if (o === c || !o.account || o.account.key !== key) continue;
    io.sendTo(o.id, { t: 'err', fatal: true, kicked: true, msg: 'Akun ini login dari perangkat lain' });
    leaveWorld(o);
    await savePlayer(o);
    o.account = null; o.player = null;
    o.ws.close();
  }
}

// Auth untuk akun yang sama diproses berurutan (2 login bersamaan tetap menghasilkan 1 sesi).
const authChains = new Map();
function handleAuth(c, m) {
  const key = String(m.name || '').toLowerCase();
  const prev = authChains.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => doAuth(c, m));
  const tail = run.catch(() => {}); authChains.set(key, tail);
  tail.then(() => { if (authChains.get(key) === tail) authChains.delete(key); });
  return run;
}

async function doAuth(c, m) {
  const name = String(m.name || '');
  const key = name.toLowerCase();
  const fail = (msg) => io.sendTo(c.id, { t: 'autherr', msg });
  if (!NAME_RE.test(name)) return fail('Username 3-16 karakter (huruf/angka/_)');
  const f = fails.get(key);
  if (f && f.until > Date.now()) return fail('Terlalu banyak percobaan. Tunggu 1 menit.');

  if (m.t === 'register') {
    const pass = String(m.pass || '');
    if (pass.length < 6 || pass.length > 72) return fail('Password 6-72 karakter');
    const rec = { name, passHash: await auth.hashPassword(pass), session: null, inv: START_INV(), gems: START_GEMS, createdAt: Date.now() };
    if (!(await storage.createPlayer(key, rec))) return fail('Username sudah dipakai');
  } else {
    const rec = await storage.loadPlayer(key);
    let good = false;
    if (rec && m.t === 'login') good = !!rec.passHash && await auth.verifyPassword(String(m.pass || ''), rec.passHash);
    if (rec && m.t === 'resume') good = !!(rec.session && m.token) && auth.verifyToken(String(m.token), rec.session.hash);
    if (!good) {
      if (m.t === 'login') { const g = fails.get(key) || { n: 0, until: 0 }; g.n++; if (g.n >= 5) { g.n = 0; g.until = Date.now() + 60000; } fails.set(key, g); }
      return fail(m.t === 'resume' ? 'Sesi kedaluwarsa, silakan login lagi' : 'Username atau password salah');
    }
    fails.delete(key);
  }
  if (c.closed) return;
  // Jika koneksi ini sudah login akun lain, keluar dulu.
  if (c.account && c.account.key !== key) { leaveWorld(c); await savePlayer(c); c.player = null; }
  await kickOthers(c, key);
  // Baca ulang (setelah sesi lama tersimpan), lalu terbitkan token baru -> token lama otomatis tidak berlaku.
  const token = auth.newToken();
  const rec = await storage.updatePlayer(key, (r) => { r.session = { hash: auth.hashToken(token), at: Date.now() }; });
  if (c.closed || !rec) return;
  c.account = { key, name: rec.name || name };
  const equip = {};
  for (const [slot, id] of Object.entries(rec.equip || {})) if (S.COSMETICS[id] && S.COSMETICS[id].slot === slot) equip[slot] = id;
  c.player = { id: c.id, key, name: c.account.name, inv: rec.inv || START_INV(), gems: rec.gems || 0, equip, dirty: false };
  c.friends = Array.isArray(rec.friends) ? rec.friends : [];
  c.freqs = Array.isArray(rec.freqs) ? rec.freqs : [];
  io.sendTo(c.id, { t: 'auth', name: c.account.name, token });
  sendFriends(c);
  // Kabari teman yang sedang online.
  for (const o of clients.values()) if (o !== c && o.player && has(o.friends, key)) io.sendTo(o.id, { t: 'chat', from: '*', msg: `Teman ${c.account.name} sekarang online` });
}

// ---------- Teman & pesan pribadi ----------
// Disimpan di record pemain: friends = [nama], freqs = [nama peminta]. Semua perubahan lewat
// storage.updatePlayer (atomik per pemain) agar tidak ada data yang tertimpa, termasuk untuk pemain offline.
const MAX_FRIENDS = 100, MAX_FREQS = 50;
const lc = (s) => String(s || '').toLowerCase();
const has = (arr, k) => (arr || []).some((n) => lc(n) === k);
const without = (arr, k) => (arr || []).filter((n) => lc(n) !== k);
const online = (key) => { for (const o of clients.values()) if (o.player && o.player.key === key) return o; return null; };
const say = (c, msg) => io.sendTo(c.id, { t: 'chat', from: '*', msg });

function sendFriends(c) {
  if (!c.player) return;
  const list = c.friends.map((n) => { const o = online(lc(n)); return { name: o ? o.player.name : n, online: !!o, world: o && o.world ? o.world.name : null }; })
    .sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
  io.sendTo(c.id, { t: 'friends', list, reqs: c.freqs.slice() });
}
function refreshCache(key, rec) { const o = online(key); if (o && rec) { o.friends = rec.friends || []; o.freqs = rec.freqs || []; sendFriends(o); } }

async function friendOp(c, op, name) {
  const me = c.player;
  name = String(name || '');
  if (op === 'list') return sendFriends(c);
  if (!NAME_RE.test(name)) return say(c, 'Pakai: /teman add|accept|decline|remove NAMA');
  const k = lc(name);
  if (k === me.key) return say(c, 'Tidak bisa berteman dengan diri sendiri');
  const target = await storage.loadPlayer(k);
  if (!target) return say(c, `Pemain ${name} tidak ditemukan`);
  const tname = target.name || name;
  if (op === 'add') {
    if (has(c.friends, k)) return say(c, `${tname} sudah jadi temanmu`);
    if (has(c.freqs, k)) op = 'accept'; // dia sudah meminta duluan -> langsung terima
    else {
      if (c.friends.length >= MAX_FRIENDS) return say(c, 'Daftar teman penuh');
      let full = false;
      const rec = await storage.updatePlayer(k, (r) => {
        if (has(r.friends, me.key)) return false;
        r.freqs = without(r.freqs, me.key);
        if (r.freqs.length >= MAX_FREQS) { full = true; return false; }
        r.freqs.push(me.name);
      });
      if (full) return say(c, `Permintaan teman ${tname} penuh`);
      if (rec) { refreshCache(k, rec); const o = online(k); if (o) io.sendTo(o.id, { t: 'freq', from: me.name }); }
      return say(c, `Permintaan teman dikirim ke ${tname}`);
    }
  }
  if (op === 'accept') {
    const mine = await storage.updatePlayer(me.key, (r) => {
      if (!has(r.freqs, k)) return false;
      r.freqs = without(r.freqs, k); r.friends = without(r.friends, k).concat([tname]);
    });
    if (!mine) return say(c, `Tidak ada permintaan teman dari ${tname}`);
    const theirs = await storage.updatePlayer(k, (r) => { r.freqs = without(r.freqs, me.key); r.friends = without(r.friends, me.key).concat([me.name]); });
    refreshCache(me.key, mine); refreshCache(k, theirs);
    const o = online(k); if (o) say(o, `${me.name} menerima permintaan temanmu`);
    return say(c, `Sekarang kamu berteman dengan ${tname}`);
  }
  if (op === 'decline') {
    const mine = await storage.updatePlayer(me.key, (r) => { r.freqs = without(r.freqs, k); });
    refreshCache(me.key, mine);
    return say(c, `Permintaan dari ${tname} ditolak`);
  }
  if (op === 'remove') {
    const mine = await storage.updatePlayer(me.key, (r) => { r.friends = without(r.friends, k); r.freqs = without(r.freqs, k); });
    const theirs = await storage.updatePlayer(k, (r) => { r.friends = without(r.friends, me.key); r.freqs = without(r.freqs, me.key); });
    refreshCache(me.key, mine); refreshCache(k, theirs);
    return say(c, `${tname} dihapus dari teman`);
  }
  say(c, 'Pakai: /teman add|accept|decline|remove NAMA');
}

function privateMsg(c, name, text) {
  const msg = S.cleanText(text, 120);
  if (!NAME_RE.test(String(name || '')) || !msg) return say(c, 'Pakai: /msg NAMA PESAN');
  const o = online(lc(name));
  if (!o) return say(c, `${name} tidak sedang online`);
  if (o === c) return say(c, 'Tidak bisa mengirim pesan ke diri sendiri');
  const m = { t: 'pm', from: c.player.name, to: o.player.name, msg };
  io.sendTo(o.id, m); io.sendTo(c.id, m);
}

// ---------- Daftar world populer ----------
async function worldList() {
  const map = new Map();
  for (const w of worlds.values()) map.set(w.name, { name: w.name, players: w.players.size, active: w.lastActive || Date.now() });
  try {
    for (const r of await storage.listWorlds(40)) if (!map.has(r.name)) map.set(r.name, { name: r.name, players: 0, active: r.updatedAt });
  } catch (e) { console.error('[worlds] list gagal', e.message); }
  return [...map.values()].sort((a, b) => (b.players - a.players) || (b.active - a.active)).slice(0, 30);
}

// Perintah chat lintas-world (ditangani di sini, bukan di World).
function globalCommand(c, msg) {
  const parts = msg.trim().split(/\s+/), cmd = parts[0].toLowerCase();
  if (cmd === '/msg' || cmd === '/pm' || cmd === '/w') { privateMsg(c, parts[1], parts.slice(2).join(' ')); return true; }
  if (cmd === '/teman' || cmd === '/friend') { friendOp(c, (parts[1] || 'list').toLowerCase(), parts[2]).catch((e) => console.error('[friend]', e)); return true; }
  if (cmd === '/trade') { if (c.world) c.world.trade(c.player, { op: 'req', name: parts[1] }); return true; }
  if (cmd === '/worlds') { worldList().then((list) => io.sendTo(c.id, { t: 'worldlist', list })); return true; }
  return false;
}

async function handleJoin(c, m) {
  const wname = String(m.world || '').toUpperCase();
  if (!WORLD_RE.test(wname)) return io.sendTo(c.id, { t: 'err', msg: 'Nama world 1-24 huruf/angka' });
  if (c.joining) return;
  c.joining = true;
  try {
    leaveWorld(c);
    const w = await getWorld(wname);
    if (c.closed || !c.player) return;
    c.world = w;
    w.addPlayer(c.player);
    io.sendTo(c.id, {
      t: 'welcome', id: c.id, name: c.player.name, world: w.snapshot(), serverTime: Date.now(),
      players: [...w.players.values()].map((p) => w.pub(p)),
      inv: c.player.inv, gems: c.player.gems, equip: c.player.equip
    });
    w.io.broadcast(w, { t: 'chat', from: '*', msg: `${c.player.name} masuk ke world ${wname}` });
  } finally { c.joining = false; }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, maxPayload: 4096 });
const COOLDOWN = { punch: 120, place: 90, chat: 400, buy: 200, login: 800, register: 800, resume: 300, join: 500,
  trade: 60, friend: 250, pm: 400, worlds: 800, equip: 150, sign: 300, drop: 250, trash: 250 };

wss.on('connection', (ws) => {
  const id = crypto.randomBytes(6).toString('hex');
  const c = { id, ws, account: null, player: null, world: null, last: {}, bucket: 60, bucketAt: Date.now() };
  clients.set(id, c);

  ws.on('message', (raw) => {
    // Rate limit sederhana (token bucket: 60 pesan/detik)
    const now = Date.now();
    c.bucket = Math.min(60, c.bucket + (now - c.bucketAt) * 0.06); c.bucketAt = now;
    if (c.bucket < 1) return; c.bucket--;

    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    if (COOLDOWN[m.t]) { if (now - (c.last[m.t] || 0) < COOLDOWN[m.t]) return; c.last[m.t] = now; }

    const onErr = (e) => { console.error('[ws]', m.t, e); io.sendTo(id, { t: 'err', msg: 'Server error, coba lagi' }); };
    if (m.t === 'register' || m.t === 'login' || m.t === 'resume') return void handleAuth(c, m).catch(onErr);
    if (m.t === 'ping') return io.sendTo(id, { t: 'pong', ts: m.ts });
    if (!c.player) return io.sendTo(id, { t: 'autherr', msg: 'Silakan login dulu' });
    if (m.t === 'join') return void handleJoin(c, m).catch(onErr);
    if (m.t === 'friend') return void friendOp(c, String(m.op || ''), m.name).catch(onErr);
    if (m.t === 'pm') return privateMsg(c, m.to, m.msg);
    if (m.t === 'worlds') return void worldList().then((list) => io.sendTo(id, { t: 'worldlist', list })).catch(onErr);
    if (m.t === 'chat' && typeof m.msg === 'string' && m.msg[0] === '/' && globalCommand(c, m.msg.slice(0, 160))) return;

    const w = c.world, p = c.player;
    if (!w) return;
    switch (m.t) {
      case 'move': w.move(p, m); break;
      case 'punch': w.punch(p, m.x, m.y); break;
      case 'place': w.place(p, m.x, m.y, m.item); break;
      case 'chat': w.chat(p, m.msg); break;
      case 'buy': w.buy(p, m.i); break;
      case 'trade': w.trade(p, m); break;
      case 'equip': w.equip(p, m.slot, m.id); break;
      case 'sign': w.setSign(p, m.x, m.y, m.text); break;
      case 'drop': w.drop(p, m.id, m.n); break;
      case 'trash': w.trash(p, m.id, m.n); break;
    }
  });

  ws.on('close', () => { c.closed = true; if (stopping) { clients.delete(id); return; } leaveWorld(c); savePlayer(c); clients.delete(id); });
  ws.on('error', () => {});
});

// Shutdown aman (Render mengirim SIGTERM sebelum redeploy/restart): berhenti menerima koneksi,
// simpan SEMUA pemain online + world yang dimuat (juga yang masih antre di storage), lalu keluar.
let stopping = false;
async function shutdown(sig) {
  if (stopping) return; stopping = true;
  console.log(`[shutdown] ${sig}: menyimpan ${clients.size} koneksi & ${worlds.size} world...`);
  const hard = setTimeout(() => { console.error('[shutdown] timeout, keluar paksa'); process.exit(1); }, 20000); hard.unref();
  try { wss.close(); server.close(); } catch (e) {}
  const jobs = [];
  for (const w of worlds.values()) jobs.push(w.save());
  for (const c of clients.values()) if (c.player) jobs.push(savePlayer(c));
  await Promise.all(jobs);
  await storage.flush().catch(() => {});
  for (const c of clients.values()) { try { c.ws.close(1012, 'Server restart'); } catch (e) {} }
  await storage.close().catch(() => {});
  console.log(`[shutdown] selesai, ${jobs.length} data tersimpan`);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

storage.init().then(() => {
  server.listen(PORT, () => console.log(`Server jalan di http://localhost:${PORT} (storage: ${storage.kind} ${storage.where})`));
}).catch((e) => { console.error('Gagal inisialisasi storage:', e.message); process.exit(1); });
