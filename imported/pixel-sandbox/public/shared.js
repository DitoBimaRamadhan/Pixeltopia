// Definisi bersama (dipakai server Node.js DAN client browser).
// Semua grafis digambar dengan kode - tidak ada aset eksternal.
(function (root) {
  const TILE = 32;
  const WORLD_W = 100;
  const WORLD_H = 60;

  // Blok: id 0..99. hp = jumlah pukulan untuk hancur (0 = tak bisa dihancurkan).
  // growMs = lama pohon dari seed blok ini tumbuh.
  const BLOCKS = {
    0: { name: 'Air', solid: false, hp: 0 },
    1: { name: 'Bedrock', solid: true, hp: 0, color: '#2b2b33', dark: '#16161c' },
    2: { name: 'Dirt', solid: true, hp: 3, color: '#8a5a2b', dark: '#6b431e', growMs: 30000 },
    3: { name: 'Rock', solid: true, hp: 6, color: '#7d7f86', dark: '#5c5e64', growMs: 60000 },
    4: { name: 'Grass', solid: true, hp: 3, color: '#8a5a2b', dark: '#6b431e', top: '#4caf3f', growMs: 30000 },
    5: { name: 'Wood', solid: true, hp: 4, color: '#b07a3e', dark: '#8c5d2c', growMs: 45000 },
    6: { name: 'Brick', solid: true, hp: 8, color: '#b0473a', dark: '#7e2f26', growMs: 90000 },
    7: { name: 'Glass', solid: true, hp: 2, color: '#a9e3f5', dark: '#6cc3dd', growMs: 60000, alpha: 0.6 },
    8: { name: 'Lava Rock', solid: true, hp: 10, color: '#4a2320', dark: '#e2581c', growMs: 120000 },
    // Pintu: bisa dilewati. Di world terkunci hanya pemilik & /access yang bisa lewat (bagi yang lain = padat).
    9: { name: 'Door', solid: false, door: true, hp: 4, color: '#8c5a2b', dark: '#5e3a17', growMs: 60000 },
    // Papan: teks bisa diubah (maks SIGN_MAX karakter), tampil saat pemain dekat / diarahkan.
    10: { name: 'Sign', solid: false, sign: true, hp: 3, color: '#c9a063', dark: '#7a5a2e', growMs: 45000 },
    // Air: tidak padat, memperlambat gerak & bisa berenang. Digambar transparan.
    11: { name: 'Water', solid: false, liquid: true, hp: 1, color: '#2f7fe0', dark: '#1d5fb3', growMs: 40000, alpha: 0.55 },
    // World Lock: ditaruh sekali per world -> penaruh jadi pemilik world. Tak punya seed.
    200: { name: 'World Lock', solid: true, hp: 4, color: '#f2c230', dark: '#a87b10', lock: true }
  };
  const WORLD_LOCK = 200;

  // Toko gem: beli item dengan gem (server memvalidasi harga & stok gem).
  const SHOP = [
    { id: 200, n: 1, price: 100, desc: 'Kunci world-mu (hanya kamu & /access yang bisa membangun)' },
    { id: 105, n: 1, price: 15, desc: 'Wood Seed' },
    { id: 107, n: 1, price: 25, desc: 'Glass Seed' },
    { id: 2, n: 10, price: 10, desc: '10 Dirt' },
    { id: 9, n: 1, price: 20, desc: 'Pintu - bisa dilewati (di world terkunci: hanya pemilik/akses)' },
    { id: 10, n: 1, price: 10, desc: 'Papan - tulis pesan untuk pemain lain' },
    { id: 11, n: 5, price: 15, desc: '5 Air - bisa berenang di dalamnya' },
    { id: 111, n: 1, price: 20, desc: 'Water Seed' }
  ];

  // Pakaian / kosmetik: id 300..399. slot = tempat dipakai. price 0 = hanya dari drop.
  // drop = bobot peluang muncul saat menghancurkan blok (0 = tidak pernah drop).
  const COS_SLOTS = ['hat', 'face', 'shirt', 'pants', 'shoes', 'back'];
  const COS_SLOT_NAMES = { hat: 'Topi', face: 'Wajah', shirt: 'Baju', pants: 'Celana', shoes: 'Sepatu', back: 'Punggung' };
  const COSMETICS = {
    300: { name: 'Topi Jerami', slot: 'hat', style: 'straw', c1: '#e8c35a', c2: '#b8902c', price: 40, drop: 3 },
    301: { name: 'Mahkota Kardus', slot: 'hat', style: 'crown', c1: '#d9a54a', c2: '#a7742a', price: 120, drop: 1 },
    302: { name: 'Topi Kerucut Bintang', slot: 'hat', style: 'cone', c1: '#3b4fd8', c2: '#ffe36e', price: 0, drop: 2 },
    303: { name: 'Bandana Merah', slot: 'hat', style: 'band', c1: '#d8343b', c2: '#ffffff', price: 30, drop: 3 },
    310: { name: 'Kacamata Hitam', slot: 'face', style: 'shades', c1: '#111111', c2: '#555555', price: 50, drop: 2 },
    311: { name: 'Kumis Tebal', slot: 'face', style: 'stache', c1: '#4a2c12', c2: '#4a2c12', price: 25, drop: 3 },
    320: { name: 'Kaos Merah', slot: 'shirt', style: 'tee', c1: '#d8343b', c2: '#a62128', price: 20, drop: 4 },
    321: { name: 'Jaket Hijau', slot: 'shirt', style: 'jacket', c1: '#2f9e55', c2: '#1d6b38', price: 45, drop: 3 },
    322: { name: 'Rompi Emas', slot: 'shirt', style: 'vest', c1: '#f2c230', c2: '#fff6c8', price: 0, drop: 1 },
    330: { name: 'Celana Jeans', slot: 'pants', style: 'pants', c1: '#2d4f8f', c2: '#1d3666', price: 20, drop: 4 },
    331: { name: 'Celana Ungu', slot: 'pants', style: 'pants', c1: '#7b3fb8', c2: '#552a82', price: 30, drop: 3 },
    340: { name: 'Sepatu Bot', slot: 'shoes', style: 'boots', c1: '#6b3f1d', c2: '#3f230e', price: 20, drop: 4 },
    341: { name: 'Sepatu Kets Putih', slot: 'shoes', style: 'sneak', c1: '#f4f4f4', c2: '#d8343b', price: 30, drop: 3 },
    350: { name: 'Jubah Merah', slot: 'back', style: 'cape', c1: '#c0262e', c2: '#7d1419', price: 80, drop: 2 },
    351: { name: 'Sayap Kupu Pelangi', slot: 'back', style: 'wings', c1: '#ff7ad9', c2: '#7af0ff', price: 0, drop: 1 },
    352: { name: 'Sayap Bara', slot: 'back', style: 'wings', c1: '#ff6a1c', c2: '#ffd54a', price: 400, drop: 0 }
  };
  const isCosmetic = (id) => id >= 300 && id < 400 && !!COSMETICS[id];
  // Kosmetik yang dijual masuk ke SHOP (ditandai cos: true -> tampil di panel Pakaian, bukan Toko).
  for (const id of Object.keys(COSMETICS).map(Number)) {
    const c = COSMETICS[id];
    if (c.price > 0) SHOP.push({ id, n: 1, price: c.price, desc: COS_SLOT_NAMES[c.slot], cos: true });
  }
  const SIGN_MAX = 100;
  // Bersihkan teks papan / pesan: buang karakter kontrol & tag, rapikan spasi, potong panjang.
  function cleanText(t, max) {
    return String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
      .replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  // Item: id < 100 = blok, 100..199 = seed (seed dari blok = 100 + blockId), 200+ = item spesial (World Lock).
  const SEED_OFFSET = 100;
  const isSeed = (id) => id >= SEED_OFFSET && id < 200;
  const seedOf = (blockId) => blockId + SEED_OFFSET;
  const blockOfSeed = (seedId) => seedId - SEED_OFFSET;
  function itemName(id) {
    if (isSeed(id)) { const b = BLOCKS[blockOfSeed(id)]; return b ? b.name + ' Seed' : '?'; }
    if (isCosmetic(id)) return COSMETICS[id].name;
    return BLOCKS[id] ? BLOCKS[id].name : '?';
  }

  // Splicing: tanam seed B di atas pohon A yang belum matang -> pohon hasil.
  const SPLICE = {
    '2+3': 6, // Dirt + Rock  = Brick
    '2+4': 5, // Dirt + Grass = Wood
    '3+5': 7, // Rock + Wood  = Glass
    '3+6': 8, // Rock + Brick = Lava Rock
    '5+6': 9, // Wood + Brick = Door
    '2+5': 10, // Dirt + Wood = Sign
    '4+7': 11  // Grass + Glass = Water
  };
  function spliceResult(a, b) { return SPLICE[Math.min(a, b) + '+' + Math.max(a, b)] || 0; }

  const PHYS = {
    PW: 20, PH: 28,          // ukuran hitbox pemain (px)
    GRAVITY: 1800,           // px/s^2
    MOVE: 220,               // px/s
    JUMP: 620,               // px/s
    MAX_FALL: 900,
    REACH_TILES: 5,          // jarak jangkauan pukul/taruh (tile)
    WATER_MOVE: 0.55,        // pengali kecepatan jalan di air
    WATER_GRAVITY: 0.3,      // pengali gravitasi di air
    WATER_MAX_FALL: 150,     // tenggelam pelan
    SWIM: 260                // dorongan ke atas saat berenang (tekan lompat)
  };

  const api = { COSMETICS, COS_SLOTS, COS_SLOT_NAMES, isCosmetic, SIGN_MAX, cleanText, WORLD_LOCK, SHOP, TILE, WORLD_W, WORLD_H, BLOCKS, SEED_OFFSET, isSeed, seedOf, blockOfSeed, itemName, SPLICE, spliceResult, PHYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SHARED = api;
})(typeof window !== 'undefined' ? window : globalThis);
