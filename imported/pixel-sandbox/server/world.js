// Satu World = satu unit state yang otoritatif. Semua aturan game untuk satu world ada di sini.
// Desain "world-per-process friendly": World tidak tahu apa-apa soal socket/HTTP; ia hanya
// menerima aksi (playerId, data) dan memanggil callback `broadcast`/`sendTo`. Karena itu
// sebuah World bisa dipindah ke proses/server lain (lihat README) tanpa mengubah logikanya.
const S = require('../public/shared');
const { TILE, WORLD_W, WORLD_H, BLOCKS, PHYS } = S;

const MAX_STACK = 200;
const MAX_SLOTS = 24;
const DAMAGE_RESET_MS = 5000;
const TRADE_MAX_KINDS = 12;     // maks jenis item per tawaran
const TRADE_ASK_MS = 60000;     // permintaan trade kedaluwarsa setelah 60 dtk
const DROP_MAX = 150;           // maks item tergeletak per world
const DROP_TTL_MS = 10 * 60000; // item yang dijatuhkan hilang setelah 10 menit
const DROP_SELF_MS = 1500;      // penjatuh tidak langsung memungut lagi itemnya
const slotCount = (inv) => Object.keys(inv).filter((k) => !S.isCosmetic(+k)).length; // pakaian tidak makan slot
const isInt = (n) => Number.isInteger(n);

function rand(n) { return Math.floor(Math.random() * n); }

function generateTiles(w, h) {
  const tiles = new Array(w * h).fill(0);
  const p1 = Math.random() * 10, p2 = Math.random() * 10;
  for (let x = 0; x < w; x++) {
    const surface = Math.round(26 + Math.sin(x / 9 + p1) * 3 + Math.sin(x / 4 + p2) * 1.2);
    for (let y = 0; y < h; y++) {
      let id = 0;
      if (y >= h - 2) id = 1;                         // bedrock
      else if (y === surface) id = 4;                 // grass
      else if (y > surface && y <= surface + 6) id = 2; // dirt
      else if (y > surface + 6) id = (y > h - 10 && Math.random() < 0.15) ? 8 : (Math.random() < 0.06 ? 2 : 3); // rock
      tiles[y * w + x] = id;
    }
  }
  return tiles;
}

class World {
  // Muat dari storage (async) lalu buat World. `storage` = objek dari server/storage.js.
  static async load(name, io, storage) {
    const saved = await storage.loadWorld(name);
    return new World(name, io, storage, saved);
  }

  constructor(name, io, storage, saved) {
    this.name = name;
    this.io = io; // { broadcast(world, msg, exceptId), sendTo(playerId, msg) }
    this.storage = storage;
    this.players = new Map(); // id -> player
    this.damage = new Map();  // "x,y" -> { hits, last }
    this.dirty = false;
    this.owner = null;        // key (lowercase) akun pemilik World Lock, null = world bebas
    this.ownerName = null;    // nama tampilan pemilik
    this.lockAt = null;       // "x,y" posisi World Lock
    this.access = [];         // key akun yang diberi /access
    this.signs = {};          // "x,y" -> teks papan
    this.trades = new Map();  // playerId -> trade aktif (objek yang sama untuk kedua pihak)
    this.asks = new Map();    // playerId peminta -> { to, at } permintaan trade tertunda
    this.drops = new Map();   // k -> { k, id, n, x, y, at, by } item tergeletak (ikut disimpan agar tidak hilang saat server restart)
    this.dropSeq = 1;
    this.lastActive = Date.now();
    if (saved && Array.isArray(saved.tiles) && saved.tiles.length === saved.w * saved.h) {
      this.w = saved.w; this.h = saved.h; this.tiles = saved.tiles; this.trees = saved.trees || {};
      this.createdAt = saved.createdAt || Date.now();
      if (saved.signs && typeof saved.signs === 'object') this.signs = saved.signs;
      if (Array.isArray(saved.drops)) for (const d of saved.drops) {
        if (!d || !isInt(d.id) || !isInt(d.n) || d.n < 1 || !Number.isFinite(d.x) || !Number.isFinite(d.y)) continue;
        const k = this.dropSeq++; this.drops.set(k, { k, id: d.id, n: d.n, x: d.x, y: d.y, at: Number(d.at) || Date.now(), by: null });
      }
      if (saved.owner) { this.owner = saved.owner; this.ownerName = saved.ownerName || saved.owner; this.lockAt = saved.lockAt || null; this.access = Array.isArray(saved.access) ? saved.access : []; }
    } else {
      this.w = WORLD_W; this.h = WORLD_H; this.tiles = generateTiles(this.w, this.h); this.trees = {};
      this.createdAt = Date.now(); this.dirty = true;
    }
  }

  // ---------- helpers ----------
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.inBounds(x, y) ? this.tiles[y * this.w + x] : 1; }
  set(x, y, id) { this.tiles[y * this.w + x] = id; this.dirty = true; }
  isSolid(x, y) { const b = BLOCKS[this.get(x, y)]; return !!(b && b.solid); }
  // Padat untuk pemain tertentu: pintu menghalangi pemain tanpa izin di world terkunci.
  isSolidFor(p, x, y) {
    const b = BLOCKS[this.get(x, y)];
    if (!b) return false;
    if (b.door) return !!this.owner && !(p && this.canBuild(p));
    return !!b.solid;
  }
  key(x, y) { return x + ',' + y; }

  rectHitsSolid(px, py, pw, ph, p) {
    const x0 = Math.floor(px / TILE), x1 = Math.floor((px + pw - 0.01) / TILE);
    const y0 = Math.floor(py / TILE), y1 = Math.floor((py + ph - 0.01) / TILE);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.isSolidFor(p, x, y)) return true;
    return false;
  }

  spawnPoint() {
    const x = Math.floor(this.w / 2);
    for (let y = 0; y < this.h; y++) {
      if (this.isSolid(x, y)) return { x: x * TILE + (TILE - PHYS.PW) / 2, y: (y - 1) * TILE + (TILE - PHYS.PH) };
    }
    return { x: x * TILE, y: 0 };
  }

  lockInfo() { return { owner: this.owner, ownerName: this.ownerName, access: this.access }; }
  snapshot() {
    this.sweepDrops();
    return { name: this.name, w: this.w, h: this.h, tiles: this.tiles, trees: this.trees, signs: this.signs, drops: [...this.drops.values()].map(this.pubDrop), ...this.lockInfo() };
  }
  toJSON() {
    return { name: this.name, w: this.w, h: this.h, tiles: this.tiles.slice(), trees: { ...this.trees }, signs: { ...this.signs }, createdAt: this.createdAt,
      owner: this.owner, ownerName: this.ownerName, lockAt: this.lockAt, access: this.access.slice(),
      drops: [...this.drops.values()].map((d) => ({ id: d.id, n: d.n, x: d.x, y: d.y, at: d.at })), savedAt: Date.now() };
  }
  save() { this.dirty = false; return this.storage.saveWorld(this.name, this.toJSON()).catch((e) => { this.dirty = true; console.error(`[world] gagal simpan ${this.name}:`, e.message); }); }

  // ---------- World Lock / izin ----------
  // Boleh membangun/menghancurkan jika world tak dikunci, atau pemain = pemilik / punya /access.
  canBuild(p) { return !this.owner || p.key === this.owner || this.access.includes(p.key); }
  denyMsg() { return `World ini dikunci oleh ${this.ownerName}`; }
  broadcastLock() { this.io.broadcast(this, { t: 'lock', ...this.lockInfo() }); }

  // ---------- players ----------
  addPlayer(p) {
    const sp = this.spawnPoint();
    p.x = sp.x; p.y = sp.y; p.lastMoveAt = Date.now(); p.facing = 1;
    this.players.set(p.id, p);
    this.io.broadcast(this, { t: 'pjoin', p: this.pub(p) }, p.id);
  }
  removePlayer(id) {
    if (!this.players.has(id)) return;
    this.cancelTrade(id, 'Trade batal: pemain keluar dari world');
    this.asks.delete(id);
    for (const [from, a] of this.asks) if (a.to === id) this.asks.delete(from);
    this.players.delete(id);
    this.io.broadcast(this, { t: 'pleave', id });
  }
  pub(p) { return { id: p.id, name: p.name, x: p.x, y: p.y, f: p.facing, eq: p.equip || {} }; }
  findByName(name) { const k = String(name || '').toLowerCase(); for (const o of this.players.values()) if (o.key === k) return o; return null; }

  // Validasi gerakan: kecepatan maksimum + tidak boleh menembus blok.
  // (Client menghitung fisika agar responsif; server hanya menolak gerakan yang mustahil.)
  move(p, d) {
    const nx = Number(d.x), ny = Number(d.y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
    const now = Date.now();
    const dt = Math.min(1, (now - p.lastMoveAt) / 1000) + 0.05;
    const maxDx = PHYS.MOVE * dt * 1.35 + 6;
    const maxDy = PHYS.MAX_FALL * dt * 1.35 + 16;
    const ok = Math.abs(nx - p.x) <= maxDx && Math.abs(ny - p.y) <= maxDy &&
      nx >= 0 && ny >= 0 && nx + PHYS.PW <= this.w * TILE && ny + PHYS.PH <= this.h * TILE &&
      !this.rectHitsSolid(nx, ny, PHYS.PW, PHYS.PH, p);
    p.lastMoveAt = now;
    if (!ok) { this.io.sendTo(p.id, { t: 'pos', x: p.x, y: p.y }); return; }
    p.x = nx; p.y = ny; p.facing = d.f === -1 ? -1 : 1;
    this.io.broadcast(this, { t: 'pmove', id: p.id, x: p.x, y: p.y, f: p.facing }, p.id);
    if (this.drops.size) this.pickup(p);
  }

  // ---------- item tergeletak (DROP) ----------
  pubDrop(d) { return { k: d.k, id: d.id, n: d.n, x: d.x, y: d.y }; }
  sweepDrops() {
    const now = Date.now();
    for (const d of this.drops.values()) if (now - d.at > DROP_TTL_MS) { this.drops.delete(d.k); this.io.broadcast(this, { t: 'undrop', k: d.k }); }
  }
  // Jatuhkan n item ke depan pemain (bisa dipungut siapa saja yang melewatinya).
  drop(p, id, n) {
    id = Number(id); n = Number(n);
    if (!isInt(id) || !isInt(n) || n < 1) return;
    if ((p.inv[id] || 0) < n) return this.err(p, 'Item tidak cukup');
    if (this.trades.has(p.id)) return this.err(p, 'Selesaikan trade dulu');
    this.sweepDrops();
    if (this.drops.size >= DROP_MAX) return this.err(p, 'Terlalu banyak item tergeletak di world ini');
    // Cari tile kosong di depan pemain (atau di tempatnya berdiri).
    const cx = Math.floor((p.x + PHYS.PW / 2) / TILE), cy = Math.floor((p.y + PHYS.PH - 1) / TILE);
    let tx = cx;
    const fx = cx + (p.facing === -1 ? -1 : 1);
    if (this.inBounds(fx, cy) && !this.isSolid(fx, cy)) tx = fx;
    this.take(p, id, n);
    const d = { k: this.dropSeq++, id, n, x: tx * TILE + TILE / 2, y: cy * TILE + TILE / 2, at: Date.now(), by: p.id };
    this.drops.set(d.k, d); this.dirty = true;
    this.sendInv(p);
    this.io.broadcast(this, { t: 'drop', d: this.pubDrop(d) });
  }
  // Pungut item yang bersentuhan dengan hitbox pemain.
  pickup(p) {
    const now = Date.now();
    for (const d of this.drops.values()) {
      if (d.by === p.id && now - d.at < DROP_SELF_MS) continue;
      if (now - d.at > DROP_TTL_MS) { this.drops.delete(d.k); this.io.broadcast(this, { t: 'undrop', k: d.k }); continue; }
      if (d.x < p.x - 8 || d.x > p.x + PHYS.PW + 8 || d.y < p.y - 8 || d.y > p.y + PHYS.PH + 8) continue;
      const got = this.give(p, d.id, d.n);
      if (!got) continue;
      d.n -= got; this.dirty = true;
      if (d.n <= 0) { this.drops.delete(d.k); this.io.broadcast(this, { t: 'undrop', k: d.k }); }
      else this.io.broadcast(this, { t: 'drop', d: this.pubDrop(d) });
      this.sendInv(p);
      this.io.sendTo(p.id, { t: 'picked', id: d.id, n: got });
    }
  }
  // Buang (hapus permanen) item dari inventori.
  trash(p, id, n) {
    id = Number(id); n = Number(n);
    if (!isInt(id) || !isInt(n) || n < 1) return;
    if ((p.inv[id] || 0) < n) return this.err(p, 'Item tidak cukup');
    if (this.trades.has(p.id)) return this.err(p, 'Selesaikan trade dulu');
    this.take(p, id, n); this.sendInv(p);
    this.io.sendTo(p.id, { t: 'trashed', id, n });
  }

  inReach(p, tx, ty) {
    const cx = p.x + PHYS.PW / 2, cy = p.y + PHYS.PH / 2;
    const dx = (tx + 0.5) * TILE - cx, dy = (ty + 0.5) * TILE - cy;
    return Math.hypot(dx, dy) <= PHYS.REACH_TILES * TILE + TILE / 2;
  }

  // ---------- inventory ----------
  give(p, id, n) { return World.giveInv(p.inv, id, n); }
  static giveInv(inv, id, n) {
    if (n <= 0) return 0;
    const cur = inv[id] || 0;
    if (!cur && !S.isCosmetic(id) && slotCount(inv) >= MAX_SLOTS) return 0;
    const add = Math.min(n, MAX_STACK - cur);
    if (add > 0) inv[id] = cur + add;
    return add;
  }
  take(p, id, n) {
    if ((p.inv[id] || 0) < n) return false;
    p.inv[id] -= n; if (p.inv[id] <= 0) delete p.inv[id];
    return true;
  }
  sendInv(p) { this.io.sendTo(p.id, { t: 'inv', inv: p.inv, gems: p.gems }); p.dirty = true; this.checkEquip(p); }

  // ---------- pakaian ----------
  // Lepas otomatis pakaian yang sudah tidak dimiliki (mis. setelah di-trade).
  checkEquip(p) {
    if (!p.equip) return;
    let changed = false;
    for (const slot of Object.keys(p.equip)) if (!(p.inv[p.equip[slot]] > 0)) { delete p.equip[slot]; changed = true; }
    if (changed) { p.dirty = true; this.io.broadcast(this, { t: 'peq', id: p.id, eq: p.equip }); }
  }
  equip(p, slot, id) {
    slot = String(slot || ''); id = Number(id) | 0;
    if (!S.COS_SLOTS.includes(slot)) return;
    p.equip = p.equip || {};
    if (id === 0) delete p.equip[slot];
    else {
      const c = S.COSMETICS[id];
      if (!S.isCosmetic(id) || c.slot !== slot) return this.err(p, 'Pakaian tidak cocok untuk slot itu');
      if (!(p.inv[id] > 0)) return this.err(p, 'Kamu belum punya pakaian itu');
      p.equip[slot] = id;
    }
    p.dirty = true;
    this.io.broadcast(this, { t: 'peq', id: p.id, eq: p.equip });
  }

  // ---------- papan (sign) ----------
  setSign(p, tx, ty, text) {
    tx |= 0; ty |= 0;
    if (!this.inBounds(tx, ty) || !(BLOCKS[this.get(tx, ty)] || {}).sign) return this.err(p, 'Itu bukan papan');
    if (!this.inReach(p, tx, ty)) return this.err(p, 'Terlalu jauh!');
    if (!this.canBuild(p)) return this.err(p, this.denyMsg());
    const clean = S.cleanText(text, S.SIGN_MAX);
    const k = this.key(tx, ty);
    if (clean) this.signs[k] = clean; else delete this.signs[k];
    this.dirty = true; this.lastActive = Date.now();
    this.io.broadcast(this, { t: 'sign', x: tx, y: ty, text: clean });
  }

  err(p, msg) { this.io.sendTo(p.id, { t: 'err', msg }); }

  // ---------- actions ----------
  punch(p, tx, ty) {
    tx |= 0; ty |= 0;
    if (!this.inBounds(tx, ty)) return;
    if (!this.inReach(p, tx, ty)) return this.err(p, 'Terlalu jauh!');
    if (!this.canBuild(p)) return this.err(p, this.denyMsg());
    const k = this.key(tx, ty);
    const now = Date.now();

    // Pohon: panen kalau sudah matang.
    const tree = this.trees[k];
    if (tree) {
      const left = tree.plantedAt + tree.growMs - now;
      if (left > 0) return this.err(p, `${S.itemName(tree.type)} tree: ${Math.ceil(left / 1000)} dtk lagi`);
      delete this.trees[k]; this.dirty = true;
      const blocks = 1 + rand(4), seeds = rand(3), gems = 1 + rand(3);
      const gotB = this.give(p, tree.type, blocks);
      const gotS = this.give(p, S.seedOf(tree.type), seeds);
      p.gems += gems;
      this.sendInv(p);
      this.io.broadcast(this, { t: 'tree', x: tx, y: ty, tree: null });
      this.io.broadcast(this, { t: 'fx', kind: 'harvest', x: tx, y: ty, by: p.id });
      this.io.sendTo(p.id, { t: 'loot', items: [[tree.type, gotB], [S.seedOf(tree.type), gotS]], gems });
      return;
    }

    const id = this.get(tx, ty);
    const b = BLOCKS[id];
    if (!id || !b || !b.hp) return; // air / bedrock
    if (this.trees[this.key(tx, ty - 1)]) return this.err(p, 'Panen pohon di atasnya dulu');
    if (b.lock && p.key !== this.owner) return this.err(p, 'Hanya pemilik yang bisa mencabut World Lock');

    let d = this.damage.get(k);
    if (!d || now - d.last > DAMAGE_RESET_MS) d = { hits: 0, last: now };
    d.hits++; d.last = now;
    if (d.hits < b.hp) {
      this.damage.set(k, d);
      this.io.broadcast(this, { t: 'hit', x: tx, y: ty, hits: d.hits, hp: b.hp });
      return;
    }
    this.damage.delete(k);
    this.set(tx, ty, 0); this.lastActive = now;
    this.io.broadcast(this, { t: 'tile', x: tx, y: ty, id: 0 });
    if (this.signs[k] !== undefined) { delete this.signs[k]; this.io.broadcast(this, { t: 'sign', x: tx, y: ty, text: '' }); }
    if (b.lock) { // pemilik mencabut World Lock -> world bebas lagi, lock kembali ke inventori
      this.owner = this.ownerName = this.lockAt = null; this.access = []; this.dirty = true;
      this.give(p, id, 1); this.sendInv(p); this.broadcastLock();
      this.io.broadcast(this, { t: 'chat', from: '*', msg: `${p.name} membuka kunci world ${this.name}` });
      return;
    }
    // Drop: gem selalu, seed kadang, blok kadang.
    const loot = [];
    const gems = 1 + rand(id === 8 ? 6 : 3);
    p.gems += gems;
    if (Math.random() < 0.3) loot.push([S.seedOf(id), this.give(p, S.seedOf(id), 1)]);
    if (Math.random() < 0.2) loot.push([id, this.give(p, id, 1)]);
    // Drop pakaian langka (Lava Rock lebih sering).
    if (Math.random() < (id === 8 ? 0.05 : 0.015)) {
      const pool = Object.keys(S.COSMETICS).map(Number).filter((c) => S.COSMETICS[c].drop > 0);
      let r = Math.random() * pool.reduce((a, c) => a + S.COSMETICS[c].drop, 0);
      const pick = pool.find((c) => (r -= S.COSMETICS[c].drop) < 0) || pool[0];
      const got = this.give(p, pick, 1);
      if (got) { loot.push([pick, got]); this.io.broadcast(this, { t: 'chat', from: '*', msg: `${p.name} menemukan ${S.itemName(pick)}!` }); }
    }
    this.sendInv(p);
    this.io.sendTo(p.id, { t: 'loot', items: loot, gems });
  }

  place(p, tx, ty, item) {
    tx |= 0; ty |= 0; item |= 0;
    if (!this.inBounds(tx, ty)) return;
    if (!this.inReach(p, tx, ty)) return this.err(p, 'Terlalu jauh!');
    if (!(p.inv[item] > 0)) return this.err(p, 'Item tidak ada di inventori');
    if (!this.canBuild(p)) return this.err(p, this.denyMsg());
    const k = this.key(tx, ty);
    if (BLOCKS[item] && BLOCKS[item].lock && this.owner) return this.err(p, 'World ini sudah punya World Lock');

    if (S.isSeed(item)) {
      const type = S.blockOfSeed(item);
      if (!BLOCKS[type] || !BLOCKS[type].growMs) return;
      const existing = this.trees[k];
      if (existing) {
        // Splicing
        const res = S.spliceResult(existing.type, type);
        const ripe = Date.now() >= existing.plantedAt + existing.growMs;
        if (!res || ripe || existing.spliced) return this.err(p, 'Tidak bisa displice');
        this.take(p, item, 1);
        this.trees[k] = { type: res, plantedAt: Date.now(), growMs: BLOCKS[res].growMs, spliced: true };
        this.dirty = true; this.sendInv(p);
        this.io.broadcast(this, { t: 'tree', x: tx, y: ty, tree: this.trees[k] });
        this.io.broadcast(this, { t: 'chat', from: '*', msg: `${p.name} men-splice pohon ${S.itemName(res)}!` });
        return;
      }
      if (this.get(tx, ty) !== 0) return this.err(p, 'Tempat terisi');
      if (!this.isSolid(tx, ty + 1)) return this.err(p, 'Seed harus ditanam di atas blok');
      this.take(p, item, 1);
      this.trees[k] = { type, plantedAt: Date.now(), growMs: BLOCKS[type].growMs };
      this.dirty = true; this.sendInv(p);
      this.io.broadcast(this, { t: 'tree', x: tx, y: ty, tree: this.trees[k] });
      return;
    }

    const b = BLOCKS[item];
    if (!b || !b.hp || S.isCosmetic(item)) return;
    if (this.get(tx, ty) !== 0 || this.trees[k]) return this.err(p, 'Tempat terisi');
    // Tidak boleh menaruh blok padat di dalam tubuh pemain mana pun (pintu/papan/air boleh).
    if (b.solid) for (const o of this.players.values()) {
      if (o.x < (tx + 1) * TILE && o.x + PHYS.PW > tx * TILE && o.y < (ty + 1) * TILE && o.y + PHYS.PH > ty * TILE) {
        return this.err(p, 'Ada pemain di situ');
      }
    }
    this.take(p, item, 1);
    this.set(tx, ty, item); this.lastActive = Date.now();
    this.sendInv(p);
    this.io.broadcast(this, { t: 'tile', x: tx, y: ty, id: item });
    if (b.sign) this.io.sendTo(p.id, { t: 'signedit', x: tx, y: ty });
    if (b.lock) {
      this.owner = p.key; this.ownerName = p.name; this.lockAt = k; this.access = []; this.dirty = true;
      this.broadcastLock();
      this.io.broadcast(this, { t: 'chat', from: '*', msg: `${p.name} mengunci world ${this.name}!` });
    }
  }

  // ---------- toko gem ----------
  buy(p, idx) {
    const s = S.SHOP[idx | 0];
    if (!s) return;
    if (p.gems < s.price) return this.err(p, `Gem kurang (butuh ${s.price})`);
    const cur = p.inv[s.id] || 0;
    if ((!cur && !S.isCosmetic(s.id) && slotCount(p.inv) >= MAX_SLOTS) || cur + s.n > MAX_STACK) return this.err(p, 'Inventori penuh');
    p.gems -= s.price; this.give(p, s.id, s.n); this.sendInv(p);
    this.io.sendTo(p.id, { t: 'bought', id: s.id, n: s.n });
  }

  // ---------- perintah chat (/access ...) ----------
  command(p, msg) {
    const [cmd, sub, arg] = msg.trim().split(/\s+/);
    const say = (m) => this.io.sendTo(p.id, { t: 'chat', from: '*', msg: m });
    if (cmd === '/access') {
      if (!this.owner) return say('World ini belum dikunci. Taruh World Lock dulu (beli di Toko).');
      if (sub === 'list' || !sub) return say(`Pemilik: ${this.ownerName}. Akses: ${this.access.length ? this.access.join(', ') : '(tidak ada)'}`);
      if (p.key !== this.owner) return say('Hanya pemilik world yang bisa mengatur akses');
      const who = String(arg || '').toLowerCase();
      if (!/^[a-z0-9_]{3,16}$/.test(who)) return say('Pakai: /access add NAMA | /access remove NAMA | /access list');
      if (sub === 'add') {
        if (who === this.owner) return say('Kamu sudah pemilik');
        if (!this.access.includes(who)) { if (this.access.length >= 50) return say('Maksimal 50 akses'); this.access.push(who); this.dirty = true; }
        this.broadcastLock(); return say(`${who} sekarang bisa membangun di ${this.name}`);
      }
      if (sub === 'remove') {
        this.access = this.access.filter((a) => a !== who); this.dirty = true;
        this.broadcastLock(); return say(`Akses ${who} dicabut`);
      }
      return say('Pakai: /access add NAMA | /access remove NAMA | /access list');
    }
    if (cmd === '/sign') { // /sign TEKS -> ubah papan terdekat dalam jangkauan
      const text = msg.replace(/^\/sign\s*/, '');
      let best = null, bd = 1e9;
      for (const kk of Object.keys(this.signs).concat(this.signPositionsNear(p))) {
        const [sx, sy] = kk.split(',').map(Number);
        const d = Math.hypot(sx * TILE - p.x, sy * TILE - p.y);
        if (d < bd && this.inReach(p, sx, sy)) { bd = d; best = [sx, sy]; }
      }
      if (!best) return say('Tidak ada papan dalam jangkauan');
      return this.setSign(p, best[0], best[1], text);
    }
    if (cmd === '/help') return say('Perintah: /world NAMA · /access add|remove|list NAMA · /trade NAMA · /msg NAMA PESAN · /r PESAN · /teman add|accept|remove NAMA · /sign TEKS · /worlds');
    say('Perintah tidak dikenal. Ketik /help');
  }

  signPositionsNear(p) {
    const out = [], cx = Math.floor((p.x + PHYS.PW / 2) / TILE), cy = Math.floor((p.y + PHYS.PH / 2) / TILE), R = PHYS.REACH_TILES + 1;
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) if ((BLOCKS[this.get(x, y)] || {}).sign) out.push(this.key(x, y));
    return out;
  }

  // ---------- TRADE ----------
  // Alur: req -> (pihak lain req/accept) -> open -> offer* -> lock (kedua pihak) -> confirm (kedua pihak) -> swap atomik.
  // Anti-duplikasi: setiap perubahan tawaran menaikkan versi `v` dan mereset lock/konfirmasi; lock & confirm wajib
  // menyebut versi terbaru; saat eksekusi semua isi divalidasi ulang terhadap inventori SAAT ITU dan swap dihitung
  // pada salinan dulu (all-or-nothing). Trade dihapus dari map sebelum swap sehingga konfirmasi ganda tak bisa memicu 2x.
  tradeView(t, forId) {
    const other = forId === t.a ? t.b : t.a;
    const o = this.players.get(other);
    const side = (id) => ({ items: t.off[id].items, gems: t.off[id].gems, locked: !!t.lock[id], ok: !!t.ok[id] });
    return { t: 'trade', st: 'open', v: t.v, with: { id: other, name: o ? o.name : '?' }, me: side(forId), them: side(other) };
  }
  sendTrade(t) { this.io.sendTo(t.a, this.tradeView(t, t.a)); this.io.sendTo(t.b, this.tradeView(t, t.b)); }
  cancelTrade(pid, msg) {
    const t = this.trades.get(pid);
    if (!t) return false;
    this.trades.delete(t.a); this.trades.delete(t.b);
    for (const id of [t.a, t.b]) this.io.sendTo(id, { t: 'trade', st: 'cancel', msg: msg || 'Trade dibatalkan' });
    return true;
  }
  tradeRequest(p, target) {
    const o = typeof target === 'string' && this.players.has(target) ? this.players.get(target) : this.findByName(target);
    if (!o) return this.err(p, 'Pemain itu tidak ada di world ini');
    if (o.id === p.id) return this.err(p, 'Tidak bisa trade dengan diri sendiri');
    if (this.trades.has(p.id)) return this.err(p, 'Kamu sedang trade');
    if (this.trades.has(o.id)) return this.err(p, `${o.name} sedang trade dengan orang lain`);
    const now = Date.now();
    const ask = this.asks.get(o.id);
    if (ask && ask.to === p.id && now - ask.at < TRADE_ASK_MS) { // pihak lain sudah meminta -> buka trade
      this.asks.delete(o.id); this.asks.delete(p.id);
      const t = { a: o.id, b: p.id, v: 1, off: { [o.id]: { items: {}, gems: 0 }, [p.id]: { items: {}, gems: 0 } }, lock: {}, ok: {} };
      this.trades.set(o.id, t); this.trades.set(p.id, t);
      this.sendTrade(t);
      return;
    }
    this.asks.set(p.id, { to: o.id, at: now });
    this.io.sendTo(o.id, { t: 'tradereq', from: p.id, name: p.name });
    this.io.sendTo(p.id, { t: 'chat', from: '*', msg: `Permintaan trade dikirim ke ${o.name}` });
  }
  trade(p, m) {
    const op = String(m.op || '');
    if (op === 'req' || op === 'accept') return this.tradeRequest(p, m.op === 'accept' ? String(m.id || '') : (m.id ? String(m.id) : String(m.name || '')));
    if (op === 'decline') {
      const ask = this.asks.get(String(m.id || ''));
      if (ask && ask.to === p.id) { this.asks.delete(String(m.id)); this.io.sendTo(String(m.id), { t: 'chat', from: '*', msg: `${p.name} menolak trade` }); }
      return;
    }
    const t = this.trades.get(p.id);
    if (!t) return this.err(p, 'Tidak sedang trade');
    if (op === 'cancel') return this.cancelTrade(p.id, `Trade dibatalkan oleh ${p.name}`);
    if (op === 'offer') {
      const items = {}, src = m.items && typeof m.items === 'object' ? m.items : {};
      const keys = Object.keys(src);
      if (keys.length > TRADE_MAX_KINDS) return this.err(p, `Maksimal ${TRADE_MAX_KINDS} jenis item`);
      for (const k of keys) {
        const id = Number(k), n = Number(src[k]);
        if (!isInt(id) || !isInt(n) || n <= 0 || n > MAX_STACK) return this.err(p, 'Jumlah item tidak valid');
        if (!((p.inv[id] || 0) >= n)) return this.err(p, `Item ${S.itemName(id)} tidak cukup`);
        items[id] = n;
      }
      const gems = Number(m.gems || 0);
      if (!isInt(gems) || gems < 0) return this.err(p, 'Jumlah gem tidak valid');
      if (gems > p.gems) return this.err(p, 'Gem tidak cukup');
      t.off[p.id] = { items, gems };
      t.v++; t.lock = {}; t.ok = {}; // perubahan apa pun -> kedua pihak harus kunci & konfirmasi ulang
      return this.sendTrade(t);
    }
    if (op === 'lock') {
      if (m.v !== t.v) return this.sendTrade(t);
      t.lock[p.id] = true;
      return this.sendTrade(t);
    }
    if (op === 'confirm') {
      if (m.v !== t.v) return this.sendTrade(t);
      if (!t.lock[t.a] || !t.lock[t.b]) return this.err(p, 'Kedua pemain harus mengunci tawaran dulu');
      t.ok[p.id] = true;
      if (t.ok[t.a] && t.ok[t.b]) return this.execTrade(t);
      return this.sendTrade(t);
    }
  }
  execTrade(t) {
    this.trades.delete(t.a); this.trades.delete(t.b); // hapus dulu -> konfirmasi ganda tidak bisa mengeksekusi 2x
    const A = this.players.get(t.a), B = this.players.get(t.b);
    const fail = (msg) => { for (const id of [t.a, t.b]) this.io.sendTo(id, { t: 'trade', st: 'cancel', msg }); };
    if (!A || !B) return fail('Trade batal: pemain tidak ada');
    const oa = t.off[t.a], ob = t.off[t.b];
    // Validasi ulang terhadap inventori sekarang.
    for (const [P, o] of [[A, oa], [B, ob]]) {
      if (P.gems < o.gems) return fail(`Trade batal: gem ${P.name} tidak cukup`);
      for (const id in o.items) if ((P.inv[id] || 0) < o.items[id]) return fail(`Trade batal: ${P.name} tidak punya ${S.itemName(+id)} x${o.items[id]} lagi`);
    }
    // Hitung di salinan (all-or-nothing).
    const ia = { ...A.inv }, ib = { ...B.inv };
    const sub = (inv, o) => { for (const id in o.items) { inv[id] -= o.items[id]; if (inv[id] <= 0) delete inv[id]; } };
    sub(ia, oa); sub(ib, ob);
    const add = (inv, o) => { for (const id in o.items) if (World.giveInv(inv, +id, o.items[id]) !== o.items[id]) return false; return true; };
    if (!add(ia, ob)) return fail(`Trade batal: inventori ${A.name} penuh`);
    if (!add(ib, oa)) return fail(`Trade batal: inventori ${B.name} penuh`);
    A.inv = ia; B.inv = ib;
    A.gems = A.gems - oa.gems + ob.gems; B.gems = B.gems - ob.gems + oa.gems;
    for (const [P, other, got, gave] of [[A, B, ob, oa], [B, A, oa, ob]]) {
      this.sendInv(P);
      this.io.sendTo(P.id, { t: 'trade', st: 'done', with: other.name, got, gave });
      if (this.io.savePlayer) this.io.savePlayer(P.id); // simpan segera agar crash tidak menimbulkan duplikasi
    }
    this.io.broadcast(this, { t: 'chat', from: '*', msg: `${A.name} dan ${B.name} berhasil trade` });
  }

  chat(p, msg) {
    msg = String(msg || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120);
    if (!msg) return;
    if (msg[0] === '/') return this.command(p, msg);
    this.io.broadcast(this, { t: 'chat', from: p.name, id: p.id, msg });
  }
}

module.exports = { World };
