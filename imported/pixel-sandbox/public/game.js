// Client game: HTML5 Canvas murni, tanpa library/CDN. Semua grafis digambar dengan kode.
(() => {
  const { TILE, BLOCKS, PHYS, SHOP, isSeed, blockOfSeed, itemName, COSMETICS, COS_SLOTS, COS_SLOT_NAMES, isCosmetic, SIGN_MAX, cleanText } = SHARED;
  const SND = window.SOUND || { play() {}, setSfx() {}, setMusic() {}, sfx: false, music: false };
  const $ = (id) => document.getElementById(id);
  const cv = $('c'), ctx = cv.getContext('2d');

  let ws = null, myId = null, world = null, clockOffset = 0;
  const players = new Map();   // id -> {name,x,y,tx,ty,f,bubble,bubbleAt}
  const me = { x: 0, y: 0, vx: 0, vy: 0, onGround: false, f: 1 };
  let inv = {}, gems = 0, selected = -1; // -1 = Tinju
  const hits = new Map();       // "x,y" -> {hits,hp,at}
  const floaters = [];          // teks melayang
  const keys = {};
  const mouse = { x: 0, y: 0, seen: false };
  let cam = { x: 0, y: 0 };
  let lastSent = { x: 0, y: 0, at: 0 };
  let myName = '';
  let myEquip = {};             // pakaianku: slot -> id
  let trade = null;             // state trade dari server (null = tidak trade)
  let draft = { items: {}, gems: 0 }; // tawaran lokal yang sedang disusun
  let friends = { list: [], reqs: [] };
  let worldList = [];
  let lastPm = '';              // untuk /r
  let panel = '';               // panel yang terbuka
  const reqs = [];              // permintaan masuk: {kind:'trade'|'friend', id, name}
  const drops = new Map();      // item tergeletak di world: k -> {k,id,n,x,y}
  const chatHist = [];          // riwayat chat (untuk strip atas & panel riwayat)
  // Sprite karakter (public/img/player.png, grid piksel asli 22x32). Fallback: gambar kotak lama bila belum termuat.
  const SPRITE = new Image(); let spriteOk = false;
  SPRITE.onload = () => { spriteOk = true; try { drawAvatar(); if (panel === 'cos' || panel === 'profile') renderPanel(); } catch (e) {} };
  SPRITE.src = 'img/player.png';
  // Posisi bagian tubuh (px dari atas hitbox) untuk menaruh pakaian: sprite baru vs gambar lama.
  const LAY_NEW = { mouth: 10, body: 14, leg: 22, cape: 13, wing: 15, rShoe: 11 };
  const LAY_OLD = { mouth: 8, body: 10, leg: 19, cape: 9, wing: 12, rShoe: PHYS.PW - 8 };
  const lay = () => (spriteOk ? LAY_NEW : LAY_OLD);
  let invOpen = localStorage.getItem('ps_inv') === '1';
  let invSel = null;            // item yang dipilih di inventori (untuk RECYCLE/DROP/INFO)
  let invQuery = '';
  let quick = []; try { quick = JSON.parse(localStorage.getItem('ps_quick') || '[]').filter(Number.isInteger).slice(0, 3); } catch (e) { quick = []; }
  let dlg = null;               // item untuk dialog drop/recycle/info

  // ---------- server (tetap, tidak bisa diubah pemain) ----------
  // APK / file:// -> selalu server online resmi. Web yang dilayani server game sendiri -> server asal halaman.
  const PS_DEFAULT_SERVER = 'https://pixel-sandbox-i1fv.onrender.com';
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ||
    (location.hostname === 'localhost' && !location.port && location.protocol === 'https:'); // WebView Capacitor = https://localhost
  const SERVER = (!isNative && /^https?:$/.test(location.protocol)) ? location.origin : (window.PS_DEFAULT_SERVER || PS_DEFAULT_SERVER);
  const WS_URL = SERVER.replace(/\/+$/, '').replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  // Bersihkan pengaturan lama (APK versi lama menyimpan alamat server / world di perangkat).
  for (const k of ['ps_server', 'ps_world']) localStorage.removeItem(k);

  // ---------- login ----------
  const DEFAULT_WORLD = 'START';
  const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
  $('name').value = localStorage.getItem('ps_name') || '';
  let pendingWorld = null, busy = false;
  const status = (msg, isErr) => { const el = $('loginErr'); el.textContent = msg || ''; el.className = isErr ? 'err' : 'info'; };
  const showLogin = (msg, isErr = true) => { $('login').style.display = 'flex'; document.body.classList.remove('ingame'); if (msg !== undefined) status(msg, isErr); };
  function setBusy(b) { busy = b; for (const id of ['go', 'reg']) $(id).disabled = b; }
  function friendly(msg) {
    msg = String(msg || '');
    if (/password salah/i.test(msg)) return 'Username atau password salah. Belum punya akun? Isi username & password lalu tekan Daftar.';
    if (/sudah dipakai/i.test(msg)) return 'Username sudah dipakai. Pilih nama lain, atau tekan Masuk jika itu akunmu.';
    if (/Sesi/i.test(msg)) return 'Sesi berakhir, silakan masuk lagi dengan password.';
    if (/Terlalu banyak/i.test(msg)) return 'Terlalu banyak percobaan salah. Tunggu 1 menit lalu coba lagi.';
    if (/Username 3-16/i.test(msg)) return 'Username harus 3-16 karakter (huruf, angka, atau _).';
    if (/Password 6-72/i.test(msg)) return 'Password minimal 6 karakter.';
    return msg;
  }
  function doAuth(kind) {
    const name = $('name').value.trim(), pass = $('pass').value;
    const tok = localStorage.getItem('ps_token');
    if (kind === 'login' && !pass && tok && localStorage.getItem('ps_tokname') === name.toLowerCase()) return request({ t: 'resume', name, token: tok });
    if (!NAME_RE.test(name)) return showLogin('Username harus 3-16 karakter (huruf, angka, atau _).');
    if (pass.length < 6) return showLogin(kind === 'register' ? 'Buat password minimal 6 karakter.' : 'Masukkan password (minimal 6 karakter).');
    localStorage.setItem('ps_name', name);
    request({ t: kind, name, pass });
  }
  $('go').onclick = () => doAuth('login');
  $('reg').onclick = () => doAuth('register');
  function logout() { localStorage.removeItem('ps_token'); localStorage.removeItem('ps_tokname'); stopConn(); pendingWorld = null; $('pass').value = ''; closePanel(); closeMenus(); showLogin('Sudah keluar dari akun.', false); }
  $('logout').onclick = logout;
  for (const el of [$('name'), $('pass')]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !busy) $('go').click(); });

  // ---------- koneksi (auto-retry: server gratis Render butuh ~50 dtk untuk bangun) ----------
  const RETRY_MS = 3000, GIVE_UP_MS = 100000;
  let fatalMsg = '', retryT = 0, connStart = 0, gen = 0, lastMsg = null;
  function stopConn() { gen++; clearTimeout(retryT); setBusy(false); if (ws) { ws.onclose = null; ws.onopen = null; ws.onmessage = null; try { ws.close(); } catch (e) {} } ws = null; world = null; }
  function request(msg) {
    lastMsg = msg;
    if (ws && ws.readyState === 1) { setBusy(true); status(msg.t === 'register' ? 'Mendaftarkan akun...' : 'Masuk...'); return ws.send(JSON.stringify(msg)); }
    stopConn(); setBusy(true); connStart = Date.now(); connect(gen);
  }
  function connect(g) {
    if (g !== gen) return;
    const waited = Date.now() - connStart;
    status('Menghubungkan ke server... (bisa sampai 1 menit)' + (waited > 4000 ? ` · ${Math.round(waited / 1000)} dtk` : ''));
    let sock;
    try { sock = new WebSocket(WS_URL); } catch (e) { return retry(g); }
    ws = sock; fatalMsg = '';
    let opened = false;
    const openT = setTimeout(() => { if (!opened && g === gen) { sock.onclose = null; try { sock.close(); } catch (e) {} retry(g); } }, 15000);
    sock.onopen = () => { opened = true; clearTimeout(openT); if (g !== gen) return; status(lastMsg.t === 'register' ? 'Mendaftarkan akun...' : 'Masuk...'); sock.send(JSON.stringify(lastMsg)); };
    sock.onmessage = (e) => { if (g === gen) onMsg(JSON.parse(e.data)); };
    sock.onerror = () => {};
    sock.onclose = () => {
      clearTimeout(openT);
      if (g !== gen) return;
      ws = null;
      if (fatalMsg) { world = null; setBusy(false); return showLogin(fatalMsg); }
      const wasIn = !!world; world = null;
      if (!opened || !wasIn) { if (busy) return retry(g); return; } // server belum siap / putus saat proses masuk -> coba lagi
      // Putus saat main -> sambung ulang otomatis dengan sesi tersimpan.
      const tok = localStorage.getItem('ps_token');
      if (tok) { showLogin('Koneksi terputus, menyambung ulang...', false); lastMsg = { t: 'resume', name: myName, token: tok }; setBusy(true); connStart = Date.now(); return retry(g, 500); }
      setBusy(false); showLogin('Koneksi terputus. Tekan Masuk untuk lanjut.');
    };
  }
  function retry(g, delay = RETRY_MS) {
    if (g !== gen) return;
    if (Date.now() - connStart > GIVE_UP_MS) { setBusy(false); return showLogin('Server tidak bisa dihubungi. Periksa internet lalu tekan Masuk untuk mencoba lagi.'); }
    retryT = setTimeout(() => connect(g), delay);
  }
  function join(w) { send({ t: 'join', world: w }); }
  const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  // Pemain lama: langsung masuk dengan sesi tersimpan.
  if (localStorage.getItem('ps_token') && $('name').value) setTimeout(() => doAuth('login'), 0);

  // ---------- network ----------
  function onMsg(m) {
    switch (m.t) {
      case 'auth':
        myName = m.name; localStorage.setItem('ps_token', m.token); localStorage.setItem('ps_tokname', m.name.toLowerCase());
        $('pass').value = ''; status('Masuk ke world...');
        join(pendingWorld || DEFAULT_WORLD);
        break;
      case 'autherr':
        if (/Sesi/.test(m.msg)) { localStorage.removeItem('ps_token'); localStorage.removeItem('ps_tokname'); }
        setBusy(false); showLogin(friendly(m.msg));
        break;
      case 'lock': if (world) { world.owner = m.owner; world.ownerName = m.ownerName; world.access = m.access; if (panel === 'world') renderPanel(); } break;
      case 'bought': toast(`Dibeli: ${itemName(m.id)} x${m.n}`); SND.play('pickup'); break;
      case 'drop': drops.set(m.d.k, m.d); break;
      case 'undrop': drops.delete(m.k); break;
      case 'picked': floaters.push({ text: `+${m.n} ${itemName(m.id)}`, x: me.x + PHYS.PW / 2, y: me.y - 10, at: Date.now() }); SND.play('pickup'); break;
      case 'trashed': toast(`Dibuang: ${itemName(m.id)} x${m.n}`); SND.play('break'); break;
      case 'peq': {
        if (m.id === myId) { myEquip = m.eq || {}; drawAvatar(); renderInv(); if (panel === 'cos' || panel === 'info') renderPanel(); }
        else { const p = players.get(m.id); if (p) p.eq = m.eq || {}; }
        break;
      }
      case 'sign': if (world) { const k = m.x + ',' + m.y; if (m.text) world.signs[k] = m.text; else delete world.signs[k]; } break;
      case 'signedit': openSignEditor(m.x, m.y); break;
      case 'tradereq': addReq({ kind: 'trade', id: m.from, name: m.name }); SND.play('trade'); break;
      case 'trade':
        if (m.st === 'open') {
          const first = !trade; trade = m;
          if (first) { draft = { items: {}, gems: 0 }; openPanel('trade'); SND.play('trade'); }
          else { if (!offerT) draft = { items: { ...m.me.items }, gems: m.me.gems }; if (panel === 'trade') renderPanel(); }
        } else {
          trade = null; draft = { items: {}, gems: 0 };
          if (m.st === 'done') { toast(`Trade dengan ${m.with} berhasil!`); SND.play('trade'); }
          else { toast(m.msg || 'Trade batal'); SND.play('error'); }
          if (panel === 'trade') renderPanel();
        }
        $('tradeBtn').classList.toggle('show', !!trade);
        break;
      case 'friends': friends = { list: m.list || [], reqs: m.reqs || [] }; $('friendDot').classList.toggle('show', friends.reqs.length > 0); updateMenuDot(); if (panel === 'friends') renderPanel(); break;
      case 'freq': addReq({ kind: 'friend', name: m.from }); SND.play('chat'); break;
      case 'pm': {
        const out = m.from === myName;
        if (!out) lastPm = m.from;
        addChat('pm', (out ? `→ ${m.to}: ` : `${m.from} → kamu: `) + m.msg);
        if (!out) SND.play('pm');
        break;
      }
      case 'worldlist': worldList = m.list || []; if (panel === 'worlds') renderPanel(); break;
      case 'welcome':
        myId = m.id; world = m.world; clockOffset = m.serverTime - Date.now();
        players.clear();
        for (const p of m.players) if (p.id !== myId) players.set(p.id, { ...p, tx: p.x, ty: p.y });
        world.signs = world.signs || {}; myEquip = m.equip || {};
        drops.clear(); for (const d of world.drops || []) drops.set(d.k, d);
        trade = null; $('tradeBtn').classList.remove('show'); reqs.length = 0; renderReqs(); closePm();
        if (panel === 'trade' || panel === 'sign') closePanel();
        const mine = m.players.find((p) => p.id === myId);
        me.x = mine.x; me.y = mine.y; me.vx = me.vy = 0;
        inv = m.inv; gems = m.gems; hits.clear();
        pendingWorld = world.name; setBusy(false); status('');
        $('login').style.display = 'none'; $('chatlog').innerHTML = ''; document.body.classList.add('ingame');
        setInv(invOpen); drawAvatar();
        renderInv(); addChat('*', `Selamat datang di world ${world.name}! (/world NAMA untuk pindah)`);
        break;
      case 'pjoin': players.set(m.p.id, { ...m.p, tx: m.p.x, ty: m.p.y }); if (panel === 'profile') renderPanel(); break;
      case 'pleave': players.delete(m.id); if (panel === 'profile') renderPanel(); break;
      case 'pmove': { const p = players.get(m.id); if (p) { p.tx = m.x; p.ty = m.y; p.f = m.f; } break; }
      case 'pos': me.x = m.x; me.y = m.y; me.vx = me.vy = 0; break;
      case 'tile': if (world) {
        world.tiles[m.y * world.w + m.x] = m.id; hits.delete(m.x + ',' + m.y);
        if (Math.hypot((m.x + .5) * TILE - me.x, (m.y + .5) * TILE - me.y) < 12 * TILE) SND.play(m.id ? (BLOCKS[m.id] && BLOCKS[m.id].liquid ? 'splash' : 'place') : 'break');
      } break;
      case 'tree': if (world) { if (m.tree) world.trees[m.x + ',' + m.y] = m.tree; else delete world.trees[m.x + ',' + m.y]; } break;
      case 'hit': hits.set(m.x + ',' + m.y, { hits: m.hits, hp: m.hp, at: Date.now() }); break;
      case 'inv': inv = m.inv; gems = m.gems; renderInv(); break;
      case 'loot': {
        let s = `+${m.gems}💎`;
        for (const [id, n] of m.items) if (n > 0) s += `  +${n} ${itemName(id)}`;
        floaters.push({ text: s, x: me.x + PHYS.PW / 2, y: me.y - 10, at: Date.now() });
        SND.play(m.items.some(([, n]) => n > 0) ? 'pickup' : 'gems');
        break;
      }
      case 'chat': {
        addChat(m.from, m.msg);
        if (m.from !== '*' && m.id !== myId) SND.play('chat');
        const p = m.id === myId ? null : players.get(m.id);
        if (m.id === myId) { me.bubble = m.msg; me.bubbleAt = Date.now(); }
        else if (p) { p.bubble = m.msg; p.bubbleAt = Date.now(); }
        break;
      }
      case 'err':
        if (m.fatal) { fatalMsg = m.msg; if (m.kicked) { localStorage.removeItem('ps_token'); world = null; } setBusy(false); showLogin(m.msg); }
        else if ($('login').style.display !== 'none') { setBusy(false); showLogin(m.msg); }
        else { toast(m.msg); SND.play('error'); }
        break;
    }
  }

  // ---------- UI ----------
  const hhmmss = (t) => new Date(t).toTimeString().slice(0, 8);
  function setTicker(e) {
    const el = $('tkText'); el.innerHTML = '';
    if (!e) return;
    el.append(h('span', { cls: 'w', textContent: `[${e.from === 'pm' ? 'PM' : 'W'}]` }), `[${hhmmss(e.at)}] `);
    if (e.from === '*') el.append(h('span', { cls: 'sys', textContent: e.msg }));
    else if (e.from === 'pm') el.append(h('span', { cls: 'nm', style: 'color:#ff9be0', textContent: e.msg }));
    else el.append(h('span', { cls: 'nm', style: `color:${nameColor(e.from)}`, textContent: `<${e.from}> ` }), e.msg);
  }
  function addChat(from, msg) {
    const e = { from, msg, at: Date.now() }; chatHist.push(e); if (chatHist.length > 60) chatHist.shift();
    setTicker(e); if (panel === 'log') renderPanel();
    const d = document.createElement('div');
    if (from === '*') { d.style.color = '#ffd54a'; d.textContent = msg; }
    else if (from === 'pm') { d.className = 'pm'; d.textContent = '✉ ' + msg; }
    else { const b = document.createElement('b'); b.textContent = from + ': '; b.style.color = nameColor(from); d.append(b, document.createTextNode(msg)); }
    const log = $('chatlog'); log.appendChild(d);
    while (log.children.length > 5) log.removeChild(log.firstChild);
    setTimeout(() => d.classList.add('old'), 12000);
  }
  let toastT = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => (t.style.display = 'none'), 1500); }

  function slots() { return [-1, ...Object.keys(inv).map(Number).filter((id) => !isCosmetic(id)).sort((a, b) => a - b)]; }
  function drawItem(g, id, s) {
    if (id === -1) drawFist(g, 0, 0, s);
    else if (isSeed(id)) drawSeed(g, blockOfSeed(id), 0, 0, s);
    else if (isCosmetic(id)) drawCosIcon(g, id, s);
    else drawTile(g, id, 0, 0, s, 0, 0);
  }
  function itemCanvas(id, s = 32) { const c = document.createElement('canvas'); c.width = c.height = s; drawItem(c.getContext('2d'), id, s); return c; }
  // Item spesial (badge bintang): World Lock & pakaian langka (hanya dari drop).
  const isSpecial = (id) => id === SHARED.WORLD_LOCK || (isCosmetic(id) && !(COSMETICS[id].price > 0));
  const fmtN = (n) => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K' : String(n);
  function slotEl(id, opts = {}) {
    const s = h('div', { cls: 'slot' + (opts.sel ? ' sel' : '') + (opts.pick ? ' pick' : '') + (id == null ? ' empty' : ''), title: id == null ? '' : id === -1 ? 'Tinju' : itemName(id) });
    if (id == null) return s;
    s.dataset.id = id;
    s.append(itemCanvas(id));
    if (id !== -1) s.append(h('span', { cls: 'n', textContent: inv[id] > 1 || !isCosmetic(id) ? inv[id] : '' }));
    if (isSpecial(id)) s.append(h('span', { cls: 'star', innerHTML: window.ICONS ? ICONS.svg('star', 15) : '' }));
    if (isCosmetic(id) && Object.values(myEquip).includes(id)) s.append(h('span', { cls: 'worn', title: 'Sedang dipakai' }));
    return s;
  }
  // Hotbar 4 slot: Tinju selalu pertama + 3 item terakhir yang dipilih.
  function hotIds() {
    const have = (id) => inv[id] > 0 && !isCosmetic(id);
    quick = quick.filter(have);
    for (const id of slots()) { if (quick.length >= 3) break; if (id !== -1 && !quick.includes(id)) quick.push(id); }
    return [-1, ...quick.slice(0, 3)];
  }
  function selectItem(id) {
    if (id !== -1 && isCosmetic(id)) return;
    selected = id;
    if (id !== -1 && !quick.includes(id)) { quick.unshift(id); quick = quick.slice(0, 3); }
    try { localStorage.setItem('ps_quick', JSON.stringify(quick)); } catch (e) {}
    renderInv();
  }
  function renderInv() {
    if (selected !== -1 && !inv[selected]) selected = -1;
    if (invSel !== null && invSel !== -1 && !inv[invSel]) invSel = null;
    const bar = $('hotbar'); bar.innerHTML = '';
    const ids = hotIds();
    for (let i = 0; i < 4; i++) {
      const id = ids[i];
      const el = slotEl(id === undefined ? null : id, { sel: id !== undefined && id === selected });
      if (id !== undefined) el.onclick = () => { invSel = id; selectItem(id); };
      bar.append(el);
    }
    renderGrid();
    $('gems').textContent = fmtN(gems);
    if (panel === 'shop' || panel === 'cos' || panel === 'trade' || panel === 'profile') renderPanel();
    if ((panel === 'drop' || panel === 'trash' || panel === 'info') && dlg !== -1 && !inv[dlg]) closePanel();
  }
  function renderGrid() {
    const grid = $('invgrid'); if (!grid) return;
    const top = grid.scrollTop; grid.innerHTML = '';
    const q = invQuery.trim().toLowerCase();
    const all = [-1, ...Object.keys(inv).map(Number).sort((a, b) => (isCosmetic(a) - isCosmetic(b)) || a - b)];
    const cur = invSel === null ? selected : invSel;
    let shown = 0;
    for (const id of all) {
      if (q && !(id === -1 ? 'tinju' : itemName(id).toLowerCase()).includes(q)) continue;
      const el = slotEl(id, { sel: id === cur });
      el.onclick = () => { invSel = id; if (!isCosmetic(id)) selectItem(id); else renderInv(); };
      el.ondblclick = () => { invSel = id; openDlg('info', id); };
      grid.append(el); shown++;
    }
    if (!shown) grid.append(h('div', { cls: 'empty-msg', textContent: q ? 'Tidak ada item yang cocok.' : 'Inventori kosong.' }));
    grid.scrollTop = top;
    const real = cur !== -1 && cur !== null && inv[cur] > 0;
    $('bRecycle').disabled = $('bDrop').disabled = !real;
    $('bInfo').disabled = cur === null;
  }
  function setInv(open) {
    invOpen = open; document.body.classList.toggle('inv-open', open);
    try { localStorage.setItem('ps_inv', open ? '1' : '0'); } catch (e) {}
  }
  $('invToggle').onclick = () => setInv(!invOpen);
  $('searchTg').onclick = () => {
    const on = !$('invsearch').classList.contains('on');
    $('invsearch').classList.toggle('on', on); $('searchTg').classList.toggle('on', on);
    if (on) $('invq').focus(); else { invQuery = ''; $('invq').value = ''; renderGrid(); }
  };
  $('invq').addEventListener('input', () => { invQuery = $('invq').value; renderGrid(); });
  $('invq').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' || e.key === 'Enter') $('invq').blur(); });
  const curItem = () => (invSel === null ? selected : invSel);
  function openDlg(kind, id) { dlg = id; openPanel(kind); }
  $('bRecycle').onclick = () => { const id = curItem(); if (id !== -1 && inv[id]) openDlg('trash', id); };
  $('bDrop').onclick = () => { const id = curItem(); if (id !== -1 && inv[id]) openDlg('drop', id); };
  $('bInfo').onclick = () => { const id = curItem(); if (id !== null) openDlg('info', id); };
  $('bStore').onclick = () => openPanel('shop');
  $('gemPlus').onclick = () => openPanel('shop');
  $('avatarBtn').onclick = () => togglePanel('cos');
  function drawAvatar() {
    const c = $('avatarCv'), g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = false;
    const eq = { ...myEquip }; delete eq.back;
    g.save(); g.scale(2, 2); drawPlayer(g, 4, 9, 1, myName || 'kamu', null, 0, eq, true); g.restore();
  }

  // ---------- Panel (Toko, Pakaian, Teman, Worlds, Trade, Suara, Papan) ----------
  const h = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const k in props) { if (k === 'on') e.onclick = props.on; else if (k === 'cls') e.className = props.cls; else if (k in e) e[k] = props[k]; else e.setAttribute(k, props[k]); }
    for (const c of kids.flat()) if (c != null) e.append(c);
    return e;
  };
  const TITLES = { shop: 'Toko Gem', cos: 'Pakaian', friends: 'Teman', worlds: 'Worlds', trade: 'Trade', sound: 'Suara', sign: 'Papan',
    profile: 'Profil', world: 'Pengaturan World', info: 'Info Item', drop: 'Jatuhkan Item', trash: 'Buang Item', help: 'Bantuan', log: 'Riwayat Chat' };
  const TICONS = { shop: 'cart', cos: 'shirt', friends: 'star', worlds: 'globe', trade: 'swap', sound: 'sound', sign: 'pencil', profile: 'person', world: 'wrench', info: 'info', drop: 'drop', trash: 'trash', help: 'help', log: 'chat' };
  let signTarget = null, pollT = 0;
  function openPanel(name) {
    panel = name; $('panel').style.display = 'block'; closeMenus(); closePm();
    clearInterval(pollT);
    if (name === 'friends') { send({ t: 'friend', op: 'list' }); pollT = setInterval(() => panel === 'friends' && send({ t: 'friend', op: 'list' }), 5000); }
    if (name === 'worlds') send({ t: 'worlds' });
    renderPanel();
  }
  function closePanel() { panel = ''; $('panel').style.display = 'none'; clearInterval(pollT); }
  function togglePanel(name) { if (panel === name) closePanel(); else openPanel(name); }
  $('panelClose').onclick = closePanel;
  function closeMenus() { $('menuItems').classList.remove('open'); $('emotes').classList.remove('open'); }
  const toggleMenu = () => { const o = !$('menuItems').classList.contains('open'); closeMenus(); $('menuItems').classList.toggle('open', o); };
  $('menuBtn').onclick = toggleMenu; $('menuBtn2').onclick = toggleMenu;
  for (const b of document.querySelectorAll('#menuItems button[data-panel], #lcol button[data-panel]')) b.onclick = () => togglePanel(b.dataset.panel);
  $('logoutBtn').onclick = () => { if (confirm('Keluar dari akun ini?')) logout(); };
  $('tradeBtn').onclick = () => openPanel('trade');
  $('chatBtn').onclick = () => openChat('');
  $('ticker').onclick = () => togglePanel('log');
  const EMOTES = ['😀', '😂', '😎', '😍', '😢', '😡', '😮', '🤔', '👍', '👋', '❤️', '🎉'];
  for (const em of EMOTES) $('emotes').append(h('button', { textContent: em, on: () => { send({ t: 'chat', msg: em }); closeMenus(); } }));
  $('emoteBtn').onclick = () => { const o = !$('emotes').classList.contains('open'); closeMenus(); $('emotes').classList.toggle('open', o); };
  // Bunyi klik untuk semua tombol UI.
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('button')) SND.play('click'); }, true);
  function updateMenuDot() { $('menuDot').classList.toggle('show', friends.reqs.length > 0 || reqs.length > 0); }

  function renderPanel() {
    if (!panel) return;
    const pt = $('panelTitle'); pt.innerHTML = window.ICONS ? ICONS.svg(TICONS[panel], 20).replace('class="ico"', 'class="ico" style="display:inline-block;vertical-align:-4px;margin-right:6px"') : '';
    pt.append(panel === 'trade' && trade ? `Trade dengan ${trade.with.name}` : TITLES[panel]);
    const body = $('panelBody');
    const keepFocus = document.activeElement && body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' ? document.activeElement.dataset.k : null;
    const keepVal = keepFocus ? document.activeElement.value : null;
    body.innerHTML = '';
    ({ shop: panelShop, cos: panelCos, friends: panelFriends, worlds: panelWorlds, trade: panelTrade, sound: panelSound, sign: panelSign,
      profile: panelProfile, world: panelWorld, info: panelInfo, drop: panelDrop, trash: panelTrash, help: panelHelp, log: panelLog }[panel])(body);
    if (keepFocus) { const i = body.querySelector(`[data-k="${keepFocus}"]`); if (i) { i.value = keepVal; i.focus(); } }
  }

  // ----- Profil: pemain sendiri + daftar pemain di world -----
  function panelProfile(body) {
    const pv = h('canvas', { width: 64, height: 76 }); const g = pv.getContext('2d'); g.imageSmoothingEnabled = false;
    g.save(); g.scale(2, 2); drawPlayer(g, 6, 8, 1, myName, null, 0, myEquip, true); g.restore();
    const kinds = Object.keys(inv).length, total = Object.values(inv).reduce((a, b) => a + b, 0);
    body.append(h('div', { cls: 'big-item' }, pv, h('div', { cls: 'kv' },
      h('span', { textContent: 'Nama' }), h('b', { textContent: myName }),
      h('span', { textContent: 'World' }), h('span', { textContent: world ? world.name : '-' }),
      h('span', { textContent: 'Gem' }), h('span', { textContent: String(gems) }),
      h('span', { textContent: 'Item' }), h('span', { textContent: `${kinds} jenis · ${total} total` }),
      h('span', { textContent: 'Teman' }), h('span', { textContent: `${friends.list.filter((f) => f.online).length} online / ${friends.list.length}` }))));
    body.append(h('div', { cls: 'prow' }, h('button', { cls: 'btn', textContent: 'Pakaian', on: () => openPanel('cos') }),
      h('button', { cls: 'btn s', textContent: 'Teman', on: () => openPanel('friends') }),
      h('button', { cls: 'btn r', textContent: 'Keluar akun', on: () => { if (confirm('Keluar dari akun ini?')) logout(); } })));
    const others = [...players.values()];
    body.append(h('h4', { textContent: `Pemain di world ini (${others.length + 1})` }));
    if (!others.length) body.append(h('p', { cls: 'muted', textContent: 'Hanya kamu di sini. Ajak teman lewat menu Teman.' }));
    for (const p of others) {
      const isFriend = friends.list.some((f) => f.name.toLowerCase() === p.name.toLowerCase());
      const av = h('canvas', { width: 32, height: 36, cls: 'pav' }); { const ag = av.getContext('2d'); ag.imageSmoothingEnabled = false; drawPlayer(ag, 6, 4, 1, p.name, null, 0, p.eq, true); }
      body.append(h('div', { cls: 'lrow' }, h('span', { cls: 'on-dot on' }), av, h('div', { cls: 'grow', textContent: p.name }),
        h('button', { cls: 'btn g', textContent: 'Trade', on: () => send({ t: 'trade', op: 'req', id: p.id }) }),
        isFriend ? null : h('button', { cls: 'btn', textContent: '+Teman', on: () => send({ t: 'friend', op: 'add', name: p.name }) }),
        h('button', { cls: 'btn s', textContent: 'PM', on: () => { closePanel(); openChat(`/msg ${p.name} `); } })));
    }
  }
  // ----- Kunci inggris: pengaturan world (World Lock & akses) -----
  function panelWorld(body) {
    if (!world) return;
    const k = myName.toLowerCase(), mine = world.owner === k;
    body.append(h('div', { cls: 'kv' },
      h('span', { textContent: 'World' }), h('b', { textContent: world.name }),
      h('span', { textContent: 'Pemain' }), h('span', { textContent: String(players.size + 1) }),
      h('span', { textContent: 'Status' }), h('span', { textContent: world.owner ? `Dikunci oleh ${world.ownerName}${mine ? ' (kamu)' : ''}` : 'Bebas (belum dikunci)' }),
      h('span', { textContent: 'Kamu' }), h('span', { textContent: canBuildMe() ? 'Boleh membangun' : 'Tidak boleh membangun' })));
    if (!world.owner) {
      body.append(h('p', { cls: 'muted', textContent: 'Taruh World Lock untuk mengunci world ini: hanya kamu & pemain yang diberi akses yang bisa membangun.' }));
      body.append(h('div', { cls: 'prow' }, inv[SHARED.WORLD_LOCK] > 0
        ? h('button', { cls: 'btn y', textContent: 'Pilih World Lock', on: () => { selectItem(SHARED.WORLD_LOCK); closePanel(); toast('World Lock dipilih - tap tile kosong untuk menaruh'); } })
        : h('button', { cls: 'btn y', textContent: 'Beli World Lock di Toko', on: () => openPanel('shop') })));
    } else {
      body.append(h('h4', { textContent: `Akses (${(world.access || []).length})` }));
      if (mine) {
        const inp = h('input', { placeholder: 'Nama pemain', maxLength: 16, autocapitalize: 'off' }); inp.dataset.k = 'acc';
        const add = () => { const n = inp.value.trim(); if (n) { send({ t: 'chat', msg: `/access add ${n}` }); inp.value = ''; } };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
        body.append(h('div', { cls: 'prow' }, inp, h('button', { cls: 'btn g', textContent: '+ Beri akses', on: add })));
      }
      if (!(world.access || []).length) body.append(h('p', { cls: 'muted', textContent: 'Belum ada pemain yang diberi akses.' }));
      for (const a of world.access || []) body.append(h('div', { cls: 'lrow' }, h('div', { cls: 'grow', textContent: a }),
        mine ? h('button', { cls: 'btn r', textContent: 'Cabut', on: () => send({ t: 'chat', msg: `/access remove ${a}` }) }) : null));
      if (mine) body.append(h('p', { cls: 'muted', textContent: 'Pukul World Lock sampai hancur untuk membuka kunci world.' }));
    }
  }
  // ----- Dialog item: INFO / DROP / RECYCLE -----
  function itemHead(id) {
    const c = itemCanvas(id, 32);
    const kind = id === -1 ? 'Alat' : isCosmetic(id) ? `Pakaian · ${COS_SLOT_NAMES[COSMETICS[id].slot]}` : isSeed(id) ? 'Seed' : id === SHARED.WORLD_LOCK ? 'Item spesial' : 'Blok';
    return h('div', { cls: 'big-item' }, c, h('div', {}, h('b', { textContent: id === -1 ? 'Tinju' : itemName(id) }), h('small', { cls: 'muted', style: 'display:block', textContent: kind + (id !== -1 ? ` · dimiliki ${inv[id] || 0}` : '') })));
  }
  function itemDesc(id) {
    if (id === -1) return 'Tinjumu. Pukul blok untuk menghancurkannya dan mendapat gem, seed, atau pakaian langka. Pukul pohon matang untuk panen.';
    const sh = SHOP.find((x) => x.id === id);
    if (isCosmetic(id)) { const c = COSMETICS[id]; return `Dipakai di slot ${COS_SLOT_NAMES[c.slot]}. ` + (c.price > 0 ? `Harga toko: ${c.price} gem.` : 'Langka: hanya didapat dari menghancurkan blok.'); }
    if (id === SHARED.WORLD_LOCK) return 'Taruh sekali per world untuk menjadi pemiliknya. Hanya pemilik & pemain dengan akses (/access) yang bisa membangun.';
    if (isSeed(id)) { const b = BLOCKS[blockOfSeed(id)]; return `Tanam di atas blok padat. Tumbuh jadi pohon ${b.name} dalam ${Math.round(b.growMs / 1000)} detik. Pukul pohon matang untuk panen. Tanam seed lain di pohon muda untuk splice!`; }
    const b = BLOCKS[id]; if (!b) return '';
    const parts = [b.door ? 'Pintu: bisa dilewati (di world terkunci hanya pemilik/akses).' : b.sign ? 'Papan: tulis pesan untuk pemain lain.' : b.liquid ? 'Air: tidak padat, bisa berenang di dalamnya.' : b.solid ? 'Blok padat.' : 'Blok latar.'];
    if (b.hp) parts.push(`Butuh ${b.hp} pukulan untuk hancur.`);
    if (sh) parts.push(`Tersedia di Toko (${sh.price} gem).`);
    return parts.join(' ');
  }
  function panelInfo(body) {
    const id = dlg; if (id == null) return closePanel();
    body.append(itemHead(id), h('p', { textContent: itemDesc(id) }));
    const row = h('div', { cls: 'prow' });
    if (id !== -1 && !isCosmetic(id) && inv[id]) row.append(h('button', { cls: 'btn g', textContent: id === selected ? 'Sedang dipakai' : 'Pakai', disabled: id === selected, on: () => { selectItem(id); closePanel(); } }));
    if (isCosmetic(id) && inv[id]) { const c = COSMETICS[id], worn = myEquip[c.slot] === id; row.append(h('button', { cls: 'btn ' + (worn ? 'r' : 'g'), textContent: worn ? 'Lepas' : 'Pakai', on: () => send({ t: 'equip', slot: c.slot, id: worn ? 0 : id }) })); }
    if (id !== -1 && inv[id]) row.append(h('button', { cls: 'btn', textContent: 'Drop', on: () => openDlg('drop', id) }), h('button', { cls: 'btn r', textContent: 'Recycle', on: () => openDlg('trash', id) }));
    body.append(row);
  }
  function amountPicker(id, onGo, label, cls, note) {
    const max = inv[id] || 0;
    const num = h('input', { type: 'number', min: 1, max, value: 1 }); num.dataset.k = 'amt';
    const rng = h('input', { type: 'range', min: 1, max, value: 1 });
    const clamp = (v) => Math.max(1, Math.min(max, Math.floor(+v || 1)));
    const set = (v) => { v = clamp(v); num.value = v; rng.value = v; };
    num.addEventListener('change', () => set(num.value)); rng.addEventListener('input', () => set(rng.value));
    return [h('div', { cls: 'amt' }, h('button', { cls: 'btn s', textContent: '−', on: () => set(+num.value - 1) }), num,
      h('button', { cls: 'btn s', textContent: '+', on: () => set(+num.value + 1) }), h('button', { cls: 'btn s', textContent: 'Semua', on: () => set(max) })),
      max > 1 ? h('div', { cls: 'amt' }, rng) : null,
      note ? h('p', { cls: 'muted', textContent: note }) : null,
      h('div', { cls: 'prow', style: 'justify-content:flex-end' }, h('button', { cls: 'btn s', textContent: 'Batal', on: closePanel }),
        h('button', { cls: 'btn ' + cls, textContent: label, on: () => { onGo(clamp(num.value)); closePanel(); } }))];
  }
  function panelDrop(body) {
    const id = dlg; if (id == null || id === -1 || !inv[id]) return closePanel();
    body.append(itemHead(id), ...amountPicker(id, (n) => send({ t: 'drop', id, n }), 'Jatuhkan', 'g', 'Item jatuh di depanmu dan bisa dipungut pemain mana pun yang melewatinya (hilang setelah 10 menit).'));
  }
  function panelTrash(body) {
    const id = dlg; if (id == null || id === -1 || !inv[id]) return closePanel();
    body.append(itemHead(id), ...amountPicker(id, (n) => send({ t: 'trash', id, n }), 'Buang permanen', 'r', 'Item yang dibuang hilang selamanya dan tidak bisa dikembalikan. Yakin?'));
  }
  function panelHelp(body) {
    body.append(h('div', { cls: 'help', innerHTML: $('login').querySelector('.help').innerHTML }),
      h('p', { cls: 'muted', textContent: 'Inventori: tekan tombol dua garis di samping hotbar. Tap slot untuk memakai item. RECYCLE = buang, STORE = toko, DROP = jatuhkan, INFO = keterangan.' }));
  }
  function panelLog(body) {
    const list = h('div', { cls: 'loglist' });
    if (!chatHist.length) list.append(h('div', { cls: 'muted', textContent: 'Belum ada chat.' }));
    for (const e of chatHist.slice().reverse()) {
      const d = h('div', {}, h('span', { cls: 'muted', textContent: `[${hhmmss(e.at)}] ` }));
      if (e.from === '*') d.append(h('span', { style: 'color:#ffd54a', textContent: e.msg }));
      else if (e.from === 'pm') d.append(h('span', { style: 'color:#ff9be0', textContent: '✉ ' + e.msg }));
      else d.append(h('b', { style: `color:${nameColor(e.from)}`, textContent: e.from + ': ' }), e.msg);
      list.append(d);
    }
    body.append(h('div', { cls: 'prow' }, h('button', { cls: 'btn g', textContent: 'Tulis pesan', on: () => { closePanel(); openChat(''); } })), list);
  }

  function panelShop(body) {
    SHOP.forEach((it, i) => {
      if (it.cos) return;
      const btn = h('button', { cls: 'btn g', textContent: `${it.price} gem`, disabled: gems < it.price, on: () => send({ t: 'buy', i }) });
      body.append(h('div', { cls: 'lrow' }, itemCanvas(it.id), h('div', { cls: 'grow' }, h('b', { textContent: `${itemName(it.id)} x${it.n}` }), h('small', { textContent: it.desc })), btn));
    });
    body.prepend(h('div', { cls: 'prow' }, h('span', { innerHTML: window.ICONS ? ICONS.svg('gem', 20) : '' }), h('b', { textContent: `${gems} gem` }), h('span', { cls: 'muted', textContent: '· dapatkan gem dengan menghancurkan blok' })));
    body.append(h('p', { cls: 'muted', textContent: 'Pakaian dijual di menu Pakaian.' }), h('button', { cls: 'btn', textContent: 'Buka Pakaian', on: () => openPanel('cos') }));
  }

  function panelCos(body) {
    const pv = h('canvas', { width: 96, height: 84 }); const g = pv.getContext('2d'); g.imageSmoothingEnabled = false;
    g.save(); g.scale(2, 2); drawPlayer(g, 14, 12, 1, myName || 'kamu', null, 0, myEquip, true); g.restore();
    body.append(h('div', { cls: 'prow', style: 'justify-content:center' }, pv));
    for (const slot of COS_SLOTS) {
      body.append(h('h4', { textContent: COS_SLOT_NAMES[slot] }));
      for (const id of Object.keys(COSMETICS).map(Number).filter((c) => COSMETICS[c].slot === slot)) {
        const c = COSMETICS[id], own = inv[id] > 0, worn = myEquip[slot] === id;
        const si = SHOP.findIndex((x) => x.id === id);
        let btn;
        if (own) btn = h('button', { cls: 'btn ' + (worn ? 'r' : 'g'), textContent: worn ? 'Lepas' : 'Pakai', on: () => send({ t: 'equip', slot, id: worn ? 0 : id }) });
        else if (si >= 0) btn = h('button', { cls: 'btn y', textContent: `${c.price} gem`, disabled: gems < c.price, on: () => send({ t: 'buy', i: si }) });
        else btn = h('span', { cls: 'muted', textContent: 'Drop langka' });
        body.append(h('div', { cls: 'lrow' }, itemCanvas(id), h('div', { cls: 'grow' }, h('b', { textContent: c.name }), h('small', { textContent: own ? (worn ? 'Sedang dipakai' : `Dimiliki x${inv[id]}`) : (si >= 0 ? 'Beli di toko' : 'Didapat dari menghancurkan blok') })), btn));
      }
    }
  }

  function panelFriends(body) {
    const inp = h('input', { placeholder: 'Nama pemain', maxLength: 16, autocapitalize: 'off' }); inp.dataset.k = 'fadd';
    const add = () => { const n = inp.value.trim(); if (n) { send({ t: 'friend', op: 'add', name: n }); inp.value = ''; } };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    body.append(h('div', { cls: 'prow' }, inp, h('button', { cls: 'btn g', textContent: '+ Tambah', on: add })));
    if (friends.reqs.length) {
      body.append(h('h4', { textContent: 'Permintaan teman' }));
      for (const n of friends.reqs) body.append(h('div', { cls: 'lrow' }, h('div', { cls: 'grow', textContent: n }),
        h('button', { cls: 'btn g', textContent: 'Terima', on: () => send({ t: 'friend', op: 'accept', name: n }) }),
        h('button', { cls: 'btn r', textContent: 'Tolak', on: () => send({ t: 'friend', op: 'decline', name: n }) })));
    }
    body.append(h('h4', { textContent: `Teman (${friends.list.length})` }));
    if (!friends.list.length) body.append(h('p', { cls: 'muted', textContent: 'Belum ada teman. Tambah lewat nama, tap pemain di world, atau ketik /teman add NAMA.' }));
    for (const f of friends.list) {
      const row = h('div', { cls: 'lrow' }, h('span', { cls: 'on-dot' + (f.online ? ' on' : '') }),
        h('div', { cls: 'grow' }, h('b', { textContent: f.name }), h('small', { textContent: f.online ? (f.world ? `Online · world ${f.world}` : 'Online') : 'Offline' })));
      if (f.online) row.append(h('button', { cls: 'btn', textContent: '✉', title: 'Pesan pribadi', on: () => { closePanel(); openChat(`/msg ${f.name} `); } }));
      if (f.online && f.world && (!world || f.world !== world.name)) row.append(h('button', { cls: 'btn g', textContent: 'Ikut', on: () => { closePanel(); join(f.world); } }));
      row.append(h('button', { cls: 'btn s', textContent: '✕', title: 'Hapus teman', on: () => { if (confirm(`Hapus ${f.name} dari teman?`)) send({ t: 'friend', op: 'remove', name: f.name }); } }));
      body.append(row);
    }
    body.append(h('p', { cls: 'muted', textContent: 'Pesan pribadi: /msg NAMA PESAN · balas: /r PESAN' }));
  }

  function ago(t) { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'baru saja' : m < 60 ? `${m} mnt lalu` : m < 1440 ? `${Math.round(m / 60)} jam lalu` : `${Math.round(m / 1440)} hari lalu`; }
  function panelWorlds(body) {
    const inp = h('input', { placeholder: 'Nama world (huruf/angka)', maxLength: 24, autocapitalize: 'characters' }); inp.dataset.k = 'wjoin';
    const go = () => { const n = inp.value.trim().toUpperCase(); if (!/^[A-Z0-9]{1,24}$/.test(n)) return toast('Nama world 1-24 huruf/angka'); closePanel(); join(n); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    body.append(h('div', { cls: 'prow' }, inp, h('button', { cls: 'btn g', textContent: 'Masuk', on: go })));
    body.append(h('div', { cls: 'prow', style: 'justify-content:space-between' }, h('h4', { textContent: 'World populer' }), h('button', { cls: 'btn s', textContent: '⟳ Muat ulang', on: () => send({ t: 'worlds' }) })));
    if (!worldList.length) body.append(h('p', { cls: 'muted', textContent: 'Memuat...' }));
    for (const w of worldList) {
      const here = world && w.name === world.name;
      body.append(h('div', { cls: 'lrow', style: 'cursor:pointer', on: () => { if (!here) { closePanel(); join(w.name); } } },
        h('div', { cls: 'grow' }, h('b', { textContent: w.name + (here ? ' (di sini)' : '') }), h('small', { textContent: w.players ? `Aktif ${ago(w.active)}` : `Terakhir aktif ${ago(w.active)}` })),
        h('span', { cls: 'badge', style: 'position:static', textContent: String(w.players) })));
    }
  }

  // Trade: tap item inventori = tambah 1 ke tawaran; tap item di tawaran = kurangi 1.
  let offerT = 0;
  function pushOffer() { clearTimeout(offerT); offerT = setTimeout(() => (offerT = 0, trade) && send({ t: 'trade', op: 'offer', items: draft.items, gems: draft.gems }), 200); }
  function chipList(items, onTap) {
    const box = h('div', { cls: 'chips' });
    const ids = Object.keys(items).map(Number);
    if (!ids.length) box.append(h('span', { cls: 'muted', textContent: '(kosong)', style: 'padding:10px' }));
    for (const id of ids) { const ch = h('div', { cls: 'chip', title: itemName(id), on: onTap ? () => onTap(id) : null }, itemCanvas(id, 32), h('span', { cls: 'n', textContent: items[id] })); box.append(ch); }
    return box;
  }
  function panelTrade(body) {
    if (!trade) {
      body.append(h('p', { textContent: 'Tidak sedang trade.' }),
        h('p', { cls: 'muted', textContent: 'Tap pemain lain di world lalu pilih "Trade", atau ketik /trade NAMA. Kedua pemain harus mengunci lalu konfirmasi.' }));
      const near = [...players.values()];
      if (near.length) body.append(h('h4', { textContent: 'Pemain di world ini' }));
      for (const p of near) body.append(h('div', { cls: 'lrow' }, h('div', { cls: 'grow', textContent: p.name }), h('button', { cls: 'btn g', textContent: 'Ajak trade', on: () => send({ t: 'trade', op: 'req', id: p.id }) })));
      return;
    }
    const T = trade, mine = draft;
    const st = (side, who) => h('div', { cls: 'tstat ' + (side.locked ? 'ok' : 'no'), textContent: `${who}: ${side.locked ? '🔒 terkunci' : 'belum dikunci'}${side.ok ? ' · ✅ konfirmasi' : ''}` });
    body.append(h('h4', { textContent: `Tawaran ${T.with.name}` }), chipList(T.them.items), h('div', { textContent: `+ ${T.them.gems} gem` }), st(T.them, T.with.name));
    body.append(h('h4', { textContent: 'Tawaranmu (tap untuk kurangi)' }), chipList(mine.items, (id) => { if (--mine.items[id] <= 0) delete mine.items[id]; renderPanel(); pushOffer(); }));
    const gi = h('input', { type: 'number', min: 0, max: gems, value: mine.gems || '', placeholder: 'Gem', style: 'width:110px' }); gi.dataset.k = 'tgems';
    gi.addEventListener('change', () => { mine.gems = Math.max(0, Math.min(gems, Math.floor(+gi.value || 0))); gi.value = mine.gems; pushOffer(); });
    body.append(h('div', { cls: 'prow' }, h('span', { innerHTML: window.ICONS ? ICONS.svg('gem', 20) : 'Gem' }), gi, h('span', { cls: 'muted', textContent: `dari ${gems}` })), st(T.me, 'Kamu'));
    body.append(h('h4', { textContent: 'Inventorimu (tap untuk tambah)' }));
    const avail = {}; for (const id in inv) { const left = inv[id] - (mine.items[id] || 0); if (left > 0) avail[id] = left; }
    body.append(chipList(avail, (id) => { if (Object.keys(mine.items).length >= 12 && !mine.items[id]) return toast('Maksimal 12 jenis item'); mine.items[id] = (mine.items[id] || 0) + 1; renderPanel(); pushOffer(); }));
    const both = T.me.locked && T.them.locked;
    body.append(h('div', { cls: 'prow', style: 'margin-top:10px' },
      h('button', { cls: 'btn y', textContent: T.me.locked ? '🔒 Terkunci' : '🔒 Kunci', disabled: T.me.locked, on: () => send({ t: 'trade', op: 'lock', v: T.v }) }),
      h('button', { cls: 'btn g', textContent: T.me.ok ? '✅ Menunggu...' : '✅ Konfirmasi', disabled: !both || T.me.ok, on: () => send({ t: 'trade', op: 'confirm', v: T.v }) }),
      h('button', { cls: 'btn r', textContent: '✖ Batal', on: () => send({ t: 'trade', op: 'cancel' }) })));
    body.append(h('p', { cls: 'muted', textContent: 'Mengubah tawaran akan membuka kunci kedua pihak. Trade batal otomatis jika salah satu keluar world.' }));
  }

  function panelSound(body) {
    const row = (label, on, set) => h('div', { cls: 'toggle' }, h('span', { textContent: label }),
      h('button', { cls: 'btn ' + (on ? 'g' : 's'), textContent: on ? 'AKTIF' : 'MATI', on: () => { set(!on); renderPanel(); } }));
    body.append(row('🔔 Efek suara', SND.sfx, (v) => { SND.setSfx(v); if (v) SND.play('gems'); }), row('🎵 Musik latar', SND.music, (v) => SND.setMusic(v)));
    body.append(h('p', { cls: 'muted', textContent: 'Semua suara dibuat langsung oleh game (WebAudio). Pengaturan disimpan di perangkat ini.' }));
  }

  function openSignEditor(x, y) { signTarget = { x, y }; openPanel('sign'); }
  function panelSign(body) {
    if (!signTarget || !world) return closePanel();
    const k = signTarget.x + ',' + signTarget.y;
    const ta = h('textarea', { rows: 3, maxLength: SIGN_MAX, value: world.signs[k] || '', placeholder: 'Tulis pesan untuk papan ini...' });
    const cnt = h('small', { cls: 'muted', textContent: `${ta.value.length}/${SIGN_MAX}` });
    ta.addEventListener('input', () => { cnt.textContent = `${ta.value.length}/${SIGN_MAX}`; });
    body.append(ta, h('div', { cls: 'prow', style: 'justify-content:space-between' }, cnt,
      h('button', { cls: 'btn g', textContent: 'Simpan', on: () => { send({ t: 'sign', x: signTarget.x, y: signTarget.y, text: cleanText(ta.value, SIGN_MAX) }); closePanel(); } })));
    setTimeout(() => ta.focus(), 50);
  }
  $('signBtn').onclick = () => { const s = nearSign(true); if (s) openSignEditor(s.x, s.y); };

  // ---------- Permintaan masuk (trade / teman) ----------
  function addReq(r) {
    const i = reqs.findIndex((x) => x.kind === r.kind && x.name === r.name); if (i >= 0) reqs.splice(i, 1);
    r.at = Date.now(); reqs.push(r); if (reqs.length > 3) reqs.shift(); renderReqs();
    setTimeout(() => { const j = reqs.indexOf(r); if (j >= 0) { reqs.splice(j, 1); renderReqs(); } }, r.kind === 'trade' ? 60000 : 30000);
  }
  function renderReqs() {
    const bar = $('reqbar'); bar.innerHTML = '';
    for (const r of reqs) {
      const done = () => { reqs.splice(reqs.indexOf(r), 1); renderReqs(); };
      const yes = r.kind === 'trade' ? () => send({ t: 'trade', op: 'accept', id: r.id }) : () => send({ t: 'friend', op: 'accept', name: r.name });
      const no = r.kind === 'trade' ? () => send({ t: 'trade', op: 'decline', id: r.id }) : () => send({ t: 'friend', op: 'decline', name: r.name });
      bar.append(h('div', { cls: 'req' }, h('span', { textContent: r.kind === 'trade' ? `🤝 ${r.name} mengajak trade` : `👥 ${r.name} ingin berteman` }),
        h('button', { cls: 'btn g', textContent: 'Terima', on: () => { yes(); done(); } }), h('button', { cls: 'btn r', textContent: 'Tolak', on: () => { no(); done(); } })));
    }
    updateMenuDot();
  }

  // ---------- Menu pemain (tap pemain lain) ----------
  function openPm(p, sx, sy) {
    const m = $('pmenu'); m.innerHTML = '';
    const isFriend = friends.list.some((f) => f.name.toLowerCase() === p.name.toLowerCase());
    m.append(h('b', { textContent: p.name }),
      h('button', { cls: 'btn g', textContent: '🤝 Ajak trade', on: () => { send({ t: 'trade', op: 'req', id: p.id }); closePm(); } }),
      isFriend ? null : h('button', { cls: 'btn', textContent: '👥 Tambah teman', on: () => { send({ t: 'friend', op: 'add', name: p.name }); closePm(); } }),
      h('button', { cls: 'btn s', textContent: '✉ Pesan pribadi', on: () => { closePm(); openChat(`/msg ${p.name} `); } }),
      h('button', { cls: 'btn s', textContent: 'Tutup', on: closePm }));
    m.style.display = 'flex';
    m.style.left = Math.max(4, Math.min(innerWidth - 170, sx - 75)) + 'px';
    m.style.top = Math.max(50, Math.min(innerHeight - 200, sy - 170)) + 'px';
  }
  function closePm() { $('pmenu').style.display = 'none'; }
  function openChat(prefill) { closeMenus(); const chat = $('chatin'); $('chatbar').classList.add('on'); chat.value = prefill || ''; chat.focus(); }
  function closeChat() { const chat = $('chatin'); chat.value = ''; chat.blur(); $('chatbar').classList.remove('on'); }
  function submitChat() {
    const chat = $('chatin'); const v = chat.value.trim(); closeChat();
    if (v.startsWith('/world ')) join(v.slice(7).trim().toUpperCase());
    else if (/^\/r\s/.test(v)) { if (lastPm) send({ t: 'pm', to: lastPm, msg: v.slice(3) }); else toast('Belum ada PM untuk dibalas'); }
    else if (/^\/worlds?$/.test(v)) openPanel('worlds');
    else if (v) send({ t: 'chat', msg: v });
  }
  $('chatSend').addEventListener('pointerdown', (e) => e.preventDefault()); // jangan tutup keyboard sebelum kirim
  $('chatSend').onclick = submitChat; $('chatX').onclick = closeChat;

  // ---------- drawing (pixel art via kode) ----------
  function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return (h ^ (h >>> 16)) >>> 0; }
  function drawTile(g, id, px, py, s, tx, ty) {
    const b = BLOCKS[id]; if (!b || !id) return;
    g.globalAlpha = b.alpha || 1;
    const u = s / 8;
    if (b.door) { // pintu kayu + gagang (+ gembok kecil jika world terkunci & kamu tanpa akses)
      g.fillStyle = b.dark; g.fillRect(px, py, s, s); g.fillStyle = b.color; g.fillRect(px + u, py + u * .5, s - 2 * u, s - u * .5);
      g.fillStyle = b.dark; g.fillRect(px + 1.6 * u, py + 1.2 * u, 2 * u, 2.4 * u); g.fillRect(px + 4.4 * u, py + 1.2 * u, 2 * u, 2.4 * u);
      g.fillRect(px + 1.6 * u, py + 4.4 * u, 2 * u, 2.6 * u); g.fillRect(px + 4.4 * u, py + 4.4 * u, 2 * u, 2.6 * u);
      g.fillStyle = '#ffd54a'; g.fillRect(px + 5.6 * u, py + 3.9 * u, u * .8, u * .8);
      if (g === ctx && world && world.owner && !canBuildMe()) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(px, py, s, s); g.fillStyle = '#f2c230'; g.fillRect(px + 3 * u, py + 3.5 * u, 2 * u, 1.6 * u); g.fillRect(px + 3.3 * u, py + 2.6 * u, 1.4 * u, u); }
      g.globalAlpha = 1; return;
    }
    if (b.sign) { // tiang + papan
      g.fillStyle = b.dark; g.fillRect(px + 3.5 * u, py + 4 * u, u, 4 * u);
      g.fillStyle = b.color; g.fillRect(px + .5 * u, py + u, 7 * u, 3.6 * u); g.fillStyle = b.dark; g.fillRect(px + .5 * u, py + 4.2 * u, 7 * u, .4 * u);
      g.fillStyle = 'rgba(60,40,20,.8)'; g.fillRect(px + 1.4 * u, py + 1.8 * u, 4.8 * u, .4 * u); g.fillRect(px + 1.4 * u, py + 2.8 * u, 3.6 * u, .4 * u);
      g.globalAlpha = 1; return;
    }
    if (b.liquid) { // air transparan + kilau
      const top = g === ctx && world && ty > 0 && !(BLOCKS[world.tiles[(ty - 1) * world.w + tx]] || {}).liquid;
      const off = top ? 2 * u + Math.sin(Date.now() / 300 + tx) * u * .5 : 0;
      g.fillStyle = b.color; g.fillRect(px, py + off, s, s - off);
      g.globalAlpha = 1;
      if (top) { g.fillStyle = 'rgba(170,220,255,.85)'; g.fillRect(px, py + off, s, u * .6); }
      else { g.globalAlpha = .35; g.fillStyle = '#bfe3ff'; g.fillRect(px + ((hash(tx, ty) >> 3) & 5) * u, py + 3 * u, 1.5 * u, u * .5); }
      g.globalAlpha = 1; return;
    }
    g.fillStyle = b.color; g.fillRect(px, py, s, s);
    g.fillStyle = b.dark;
    if (b.lock) { // World Lock: gembok emas
      g.fillStyle = '#5a4200'; g.fillRect(px, py, s, s); g.fillStyle = b.color;
      g.fillRect(px + 2 * u, py + 3.5 * u, 4 * u, 3.5 * u);
      g.fillRect(px + 2.5 * u, py + u, u * .8, 2.5 * u); g.fillRect(px + 4.7 * u, py + u, u * .8, 2.5 * u); g.fillRect(px + 2.5 * u, py + u, 3 * u, u * .8);
      g.fillStyle = b.dark; g.fillRect(px + 3.6 * u, py + 4.5 * u, u * .8, 1.5 * u);
      g.globalAlpha = 1; return;
    }
    if (id === 6) { // brick pattern
      for (let r = 0; r < 4; r++) { g.fillRect(px, py + r * 2 * u + 2 * u - u / 2, s, u / 2); const off = r % 2 ? 0 : 4 * u; g.fillRect(px + off, py + r * 2 * u, u / 2, 2 * u); }
    } else if (id === 5) { for (let i = 1; i < 4; i++) g.fillRect(px, py + i * 2 * u, s, u / 3); }
    else if (id === 7) { g.fillStyle = '#ffffff'; g.fillRect(px + u, py + u, u, 3 * u); g.fillRect(px + 2 * u, py + u, u, u); }
    else if (id === 8) { const h = hash(tx, ty); for (let i = 0; i < 4; i++) g.fillRect(px + ((h >> (i * 3)) & 7) * u, py + ((h >> (i * 3 + 12)) & 7) * u, u * 1.5, u); }
    else { const h = hash(tx, ty); for (let i = 0; i < 5; i++) g.fillRect(px + ((h >> (i * 3)) & 7) * u, py + ((h >> (i * 3 + 15)) & 7) * u, u, u); }
    if (b.top) { g.fillStyle = b.top; g.fillRect(px, py, s, 2 * u); g.fillRect(px + u, py + 2 * u, u, u); g.fillRect(px + 5 * u, py + 2 * u, u, u); }
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(px, py + s - u / 2, s, u / 2); g.fillRect(px + s - u / 2, py, u / 2, s);
    g.globalAlpha = 1;
  }
  function drawSeed(g, type, px, py, s) {
    const b = BLOCKS[type]; g.fillStyle = b.color;
    g.beginPath(); g.ellipse(px + s / 2, py + s / 2, s * 0.28, s * 0.36, 0.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = b.top || b.dark; g.fillRect(px + s * 0.4, py + s * 0.35, s / 8, s / 8); g.fillRect(px + s * 0.55, py + s * 0.55, s / 8, s / 8);
    g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke();
  }
  // Tinju piksel (16x16 grid): garis tepi gelap, kulit, bayangan jari.
  const FIST = ['....kkkkkkk.....', '...kooookoook...', '..kkoookooookk..', '.koookoooookook.', '.kooookoooooook.', '.kooooooooooook.',
    'kkkkoooooooooook', 'koookdoooooooook', 'kooooddooooooook', 'kooooooooooooook', '.kooooooooooook.', '.kddoooooooodk..', '..kdddddddddk...', '...kkkkkkkkk....'];
  function drawFist(g, px, py, s) {
    const u = s / 16, C = { k: '#3a2210', o: '#f2c79a', d: '#c9945f' };
    for (let y = 0; y < FIST.length; y++) for (let x = 0; x < 16; x++) { const c = FIST[y][x]; if (c && c !== '.') { g.fillStyle = C[c]; g.fillRect(px + x * u, py + (y + 1) * u, u + .05, u + .05); } }
    g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(px + 4 * u, py + 3 * u, 2 * u, u);
  }
  function drawTree(g, tree, px, py) {
    const now = Date.now() + clockOffset;
    const prog = Math.min(1, (now - tree.plantedAt) / tree.growMs);
    const b = BLOCKS[tree.type];
    const h = 6 + prog * 20;
    g.fillStyle = '#6b4a2b'; g.fillRect(px + 13, py + TILE - h, 6, h);
    const r = 4 + prog * 10;
    g.fillStyle = prog >= 1 ? '#3fa34d' : '#5cc26a';
    g.beginPath(); g.arc(px + 16, py + TILE - h, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = b.color; g.fillRect(px + 14, py + TILE - h - 2, 4, 4);
    if (prog >= 1) { // buah = mini blok
      for (const [ox, oy] of [[-8, -4], [5, -8], [2, 3]]) drawTile(g, tree.type, px + 13 + ox, py + TILE - h + oy, 8, 1, 1);
    } else {
      g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(px + 2, py + TILE - 4, TILE - 4, 3);
      g.fillStyle = '#ffd54a'; g.fillRect(px + 2, py + TILE - 4, (TILE - 4) * prog, 3);
    }
  }
  // Ikon pakaian (untuk inventori/panel): gambar karakter mini yang hanya memakai item itu.
  function drawCosIcon(g, id, s) {
    const c = COSMETICS[id]; if (!c) return;
    g.save(); const k = s / 32; g.scale(k, k);
    g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, 0, 32, 32);
    if (c.slot === 'hat' || c.slot === 'face') { g.fillStyle = spriteOk ? '#98746a' : '#f2c79a'; g.fillRect(spriteOk ? 7 : 9, 12, spriteOk ? 20 : 16, 14); drawCos(g, id, 7, 12, 1); }
    else if (c.slot === 'back') { drawCos(g, id, 6, 2, 1); }
    else { g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(6, 2, 20, 28); drawCos(g, id, 6, 2, 1); }
    g.restore();
  }
  // Gambar satu pakaian pada karakter di (x,y) (koordinat hitbox pemain), menghadap f.
  function drawCos(g, id, x, y, f) {
    const c = COSMETICS[id]; if (!c) return;
    const W = PHYS.PW, H = PHYS.PH, L = lay(), B = L.body, P = L.leg;
    switch (c.style) {
      case 'straw': g.fillStyle = c.c1; g.fillRect(x - 4, y - 1, W + 8, 3); g.fillRect(x + 3, y - 6, W - 6, 5); g.fillStyle = c.c2; g.fillRect(x + 3, y - 2, W - 6, 1); break;
      case 'crown': g.fillStyle = c.c1; g.fillRect(x + 2, y - 5, W - 4, 5); for (let i = 0; i < 3; i++) g.fillRect(x + 2 + i * 6, y - 9, 4, 4); g.fillStyle = '#e03a3a'; g.fillRect(x + 9, y - 4, 2, 2); break;
      case 'cone': g.fillStyle = c.c1; g.beginPath(); g.moveTo(x + 2, y + 1); g.lineTo(x + W - 2, y + 1); g.lineTo(x + W / 2 + f * 3, y - 14); g.closePath(); g.fill(); g.fillStyle = c.c2; g.fillRect(x + 8, y - 6, 3, 3); g.fillRect(x + 12, y - 2, 2, 2); break;
      case 'band': g.fillStyle = c.c1; g.fillRect(x + 2, y, W - 4, 4); g.fillRect(f > 0 ? x - 2 : x + W - 2, y + 1, 4, 5); g.fillStyle = c.c2; g.fillRect(x + 6, y + 1, 2, 2); g.fillRect(x + 12, y + 1, 2, 2); break;
      case 'shades': g.fillStyle = c.c1; g.fillRect(x + 3, y + 4, W - 6, 2); g.fillRect(x + (f > 0 ? 9 : 3), y + 4, 8, 4); g.fillStyle = c.c2; g.fillRect(x + (f > 0 ? 11 : 5), y + 5, 2, 1); break;
      case 'stache': { const m = L.mouth; g.fillStyle = c.c1; g.fillRect(x + (f > 0 ? 8 : 4), y + m, 9, 2); g.fillRect(x + (f > 0 ? 7 : 3), y + m + 1, 2, 2); g.fillRect(x + (f > 0 ? 16 : 12), y + m + 1, 2, 2); break; }
      case 'tee': g.fillStyle = c.c1; g.fillRect(x, y + B, W, 9); g.fillStyle = c.c2; g.fillRect(x + 7, y + B, 6, 2); break;
      case 'jacket': g.fillStyle = c.c1; g.fillRect(x, y + B, W, 10); g.fillStyle = c.c2; g.fillRect(x + 9, y + B, 2, 10); g.fillRect(x, y + B + 8, W, 2); break;
      case 'vest': g.fillStyle = c.c1; g.fillRect(x, y + B, W, 9); g.fillStyle = c.c2; g.fillRect(x + 8, y + B, 4, 9); g.fillStyle = '#a87b10'; g.fillRect(x + 9, y + B + 2, 2, 2); g.fillRect(x + 9, y + B + 6, 2, 2); break;
      case 'pants':
        if (spriteOk) { // dua kaki terpisah mengikuti sprite
          g.fillStyle = c.c1; g.fillRect(x + 1, y + P - 3, W - 2, 4); g.fillRect(x + 1, y + P, 7, H - P - 2); g.fillRect(x + 11, y + P, 7, H - P - 2);
          g.fillStyle = c.c2; g.fillRect(x + 1, y + P - 3, W - 2, 1); g.fillRect(x + 9, y + P - 1, 1, 2);
        } else { g.fillStyle = c.c1; g.fillRect(x, y + P, W, H - 23); g.fillStyle = c.c2; g.fillRect(x + 9, y + P + 2, 2, H - 25); g.fillRect(x, y + P, W, 1); }
        break;
      case 'boots': { const r = x + L.rShoe, bh = spriteOk ? 4 : 6; g.fillStyle = c.c1; g.fillRect(x + 1, y + H - bh, 7, bh); g.fillRect(r, y + H - bh, 7, bh); g.fillStyle = c.c2; g.fillRect(x + 1, y + H - 1, 7, 1); g.fillRect(r, y + H - 1, 7, 1); break; }
      case 'sneak': g.fillStyle = c.c1; g.fillRect(x + 1, y + H - 4, 8, 4); g.fillRect(x + W - 9, y + H - 4, 8, 4); g.fillStyle = c.c2; g.fillRect(x + 1, y + H - 2, 8, 1); g.fillRect(x + W - 9, y + H - 2, 8, 1); break;
      case 'cape': g.fillStyle = c.c2; g.fillRect(x + (f > 0 ? -5 : W - 3), y + L.cape, 8, H - L.cape); g.fillStyle = c.c1; g.fillRect(x + (f > 0 ? -4 : W - 2), y + L.cape + 1, 6, H - L.cape - 2); break;
      case 'wings': {
        const flap = Math.sin(Date.now() / 160) * 3;
        for (const side of [-1, 1]) {
          const bx = x + W / 2 + side * 4;
          const wy = y + L.wing - 12;
          g.fillStyle = c.c1; g.beginPath(); g.moveTo(bx, wy + 12); g.lineTo(bx + side * 16, wy + 2 - flap); g.lineTo(bx + side * 14, wy + 16); g.closePath(); g.fill();
          g.fillStyle = c.c2; g.beginPath(); g.moveTo(bx, wy + 15); g.lineTo(bx + side * 12, Math.min(y + PHYS.PH, wy + 24 + flap / 2)); g.lineTo(bx + side * 4, Math.min(y + PHYS.PH, wy + 24)); g.closePath(); g.fill();
        }
        break;
      }
    }
  }
  function nameColor(n) { let h = 0; for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) | 0; return `hsl(${Math.abs(h) % 360},70%,60%)`; }
  // Sprite digambar setinggi hitbox (kaki rata bawah), lebar mengikuti rasio sprite, di tengah hitbox.
  // Gambar asli menghadap KIRI (pupil di kiri) -> dibalik horizontal saat menghadap kanan (f > 0).
  function drawSprite(g, x, y, f) {
    const dh = PHYS.PH, dw = dh * SPRITE.width / SPRITE.height, dx = x + (PHYS.PW - dw) / 2;
    const sm = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
    if (f > 0) { g.save(); g.translate(dx + dw, y); g.scale(-1, 1); g.drawImage(SPRITE, 0, 0, dw, dh); g.restore(); }
    else g.drawImage(SPRITE, dx, y, dw, dh);
    g.imageSmoothingEnabled = sm;
  }
  function drawPlayer(g, x, y, f, name, bubble, bubbleAt, eq, noLabel) {
    eq = eq || {};
    if (eq.back) drawCos(g, eq.back, x, y, f);                                                 // punggung (di belakang)
    if (spriteOk) drawSprite(g, x, y, f);
    else { // fallback: karakter kotak lama
      g.fillStyle = nameColor(name); g.fillRect(x, y + 10, PHYS.PW, PHYS.PH - 10);            // badan
      g.fillStyle = '#f2c79a'; g.fillRect(x + 2, y, PHYS.PW - 4, 12);                           // kepala
      g.fillStyle = '#000'; g.fillRect(x + (f > 0 ? 11 : 5), y + 4, 3, 3);                      // mata
      g.fillStyle = '#333'; g.fillRect(x + 2, y + PHYS.PH - 4, 6, 4); g.fillRect(x + PHYS.PW - 8, y + PHYS.PH - 4, 6, 4);
    }
    for (const slot of ['pants', 'shirt', 'shoes', 'face', 'hat']) if (eq[slot]) drawCos(g, eq[slot], x, y, f);
    if (noLabel) return;
    g.font = 'bold 12px PixelUI, system-ui'; g.textAlign = 'center';
    g.lineWidth = 3; g.strokeStyle = '#0b1024'; g.lineJoin = 'round'; g.strokeText(name, x + PHYS.PW / 2, y - 6);
    g.fillStyle = '#fff'; g.fillText(name, x + PHYS.PW / 2, y - 6);
    if (bubble && Date.now() - bubbleAt < 5000) {
      g.font = '12px PixelUI, system-ui'; const bw = Math.min(220, g.measureText(bubble).width) + 10;
      g.fillStyle = 'rgba(255,255,255,.92)'; g.fillRect(x + PHYS.PW / 2 - bw / 2, y - 40, bw, 18);
      g.fillStyle = '#111'; g.fillText(bubble.length > 34 ? bubble.slice(0, 34) + '…' : bubble, x + PHYS.PW / 2, y - 27);
    }
  }

  // ---------- physics ----------
  function canBuildMe() { const k = myName.toLowerCase(); return !world.owner || world.owner === k || (world.access || []).includes(k); }
  function solidAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return true;
    const b = BLOCKS[world.tiles[ty * world.w + tx]];
    if (b && b.door) return !canBuildMe();
    return !!(b && b.solid);
  }
  function inWater(x, y) {
    const x0 = Math.floor(x / TILE), x1 = Math.floor((x + PHYS.PW - 0.01) / TILE);
    const y0 = Math.floor((y + 8) / TILE), y1 = Math.floor((y + PHYS.PH - 0.01) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) { const b = BLOCKS[world.tiles[ty * world.w + tx]]; if (b && b.liquid) return true; }
    return false;
  }
  function collides(x, y) {
    const x0 = Math.floor(x / TILE), x1 = Math.floor((x + PHYS.PW - 0.01) / TILE);
    const y0 = Math.floor(y / TILE), y1 = Math.floor((y + PHYS.PH - 0.01) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, ty)) return true;
    return false;
  }
  function physics(dt) {
    const chatting = document.activeElement === $('chatin');
    const L = !chatting && (keys.ArrowLeft || keys.KeyA || touch.L), R = !chatting && (keys.ArrowRight || keys.KeyD || touch.R);
    const J = !chatting && (keys.ArrowUp || keys.KeyW || keys.Space || touch.J);
    const wet = inWater(me.x, me.y);
    if (wet && !me.wet) SND.play('splash');
    me.wet = wet;
    me.vx = (R ? 1 : 0) - (L ? 1 : 0); me.vx *= PHYS.MOVE * (wet ? PHYS.WATER_MOVE : 1); if (me.vx) me.f = Math.sign(me.vx);
    if (wet) { // berenang: tahan lompat = naik pelan, lepas = tenggelam pelan
      if (J) me.vy = Math.max(-PHYS.SWIM, me.vy - PHYS.GRAVITY * 1.6 * dt);
      me.vy = Math.min(PHYS.WATER_MAX_FALL, me.vy + PHYS.GRAVITY * PHYS.WATER_GRAVITY * dt);
    } else {
      if (J && me.onGround) { me.vy = -PHYS.JUMP; SND.play('jump'); }
      me.vy = Math.min(PHYS.MAX_FALL, me.vy + PHYS.GRAVITY * dt);
    }
    // sumbu X
    let nx = me.x + me.vx * dt;
    if (collides(nx, me.y)) { nx = me.vx > 0 ? Math.floor((nx + PHYS.PW) / TILE) * TILE - PHYS.PW - 0.01 : Math.floor(nx / TILE + 1) * TILE + 0.01; if (collides(nx, me.y)) nx = me.x; }
    me.x = nx;
    // sumbu Y
    let ny = me.y + me.vy * dt; me.onGround = false;
    if (collides(me.x, ny)) {
      if (me.vy > 0) { ny = Math.floor((ny + PHYS.PH) / TILE) * TILE - PHYS.PH - 0.01; me.onGround = true; }
      else ny = Math.floor(ny / TILE + 1) * TILE + 0.01;
      if (collides(me.x, ny)) ny = me.y;
      me.vy = 0;
    }
    me.y = ny;
  }

  // ---------- input ----------
  addEventListener('keydown', (e) => {
    if (!world) return;
    const chat = $('chatin');
    if (document.activeElement === chat) {
      if (e.key === 'Enter') submitChat();
      else if (e.key === 'Escape') closeChat();
      return;
    }
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return; // sedang mengetik di panel
    if (e.key === 'Enter') { openChat(''); e.preventDefault(); return; }
    if (e.key === 'Escape') { closePanel(); closeMenus(); return; }
    if (e.code === 'KeyI') { setInv(!invOpen); return; }
    keys[e.code] = true;
    if (/^Digit[1-9]$/.test(e.code)) { const s = slots()[+e.code[5] - 1]; if (s !== undefined) { invSel = s; selectItem(s); } }
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  cv.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.seen = true; });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => { const s = slots(); let i = s.indexOf(selected); i = (i + (e.deltaY > 0 ? 1 : -1) + s.length) % s.length; invSel = s[i]; selectItem(s[i]); });
  let mouseDown = -1, lastAct = 0;
  // Pointer events = mouse + sentuhan. Tap/tahan di layar = pakai item terpilih (Tinju = pukul).
  function playerAt(sx, sy) {
    const wx = sx + cam.x, wy = sy + cam.y;
    for (const p of players.values()) if (wx >= p.x - 6 && wx <= p.x + PHYS.PW + 6 && wy >= p.y - 18 && wy <= p.y + PHYS.PH + 4) return p;
    return null;
  }
  cv.addEventListener('pointerdown', (e) => {
    closePm(); closeMenus();
    if (world && (e.pointerType !== 'mouse' || e.button === 0)) { const p = playerAt(e.clientX, e.clientY); if (p) { mouseDown = -1; openPm(p, e.clientX, e.clientY); return; } }
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.seen = true; mouseDown = e.pointerType === 'mouse' ? e.button : 0; lastAct = 0; if (e.pointerType !== 'mouse') cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  addEventListener('pointerup', () => { mouseDown = -1; });
  addEventListener('pointercancel', () => { mouseDown = -1; });

  // ---------- kontrol sentuh (HP / APK) ----------
  const touch = { L: false, R: false, J: false, P: false };
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) document.body.classList.add('touch');
  for (const [id, k] of [['tLeft', 'L'], ['tRight', 'R'], ['tJump', 'J'], ['tPunch', 'P']]) {
    const el = $(id);
    const on = (e) => { e.preventDefault(); touch[k] = true; el.classList.add('on'); if (k === 'P') lastAct = 0; };
    const off = (e) => { e.preventDefault(); touch[k] = false; el.classList.remove('on'); };
    el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off); el.addEventListener('pointercancel', off);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  function mouseTile() { return { x: Math.floor((mouse.x + cam.x) / TILE), y: Math.floor((mouse.y + cam.y) / TILE) }; }
  function inReach(tx, ty) {
    return Math.hypot((tx + .5) * TILE - (me.x + PHYS.PW / 2), (ty + .5) * TILE - (me.y + PHYS.PH / 2)) <= PHYS.REACH_TILES * TILE + TILE / 2;
  }
  // Target tombol tinju: tile di depan pemain (pukul: depan -> depan-bawah -> depan-atas; taruh: tile kosong terdekat di depan).
  function frontTarget() {
    const cx = Math.floor((me.x + PHYS.PW / 2) / TILE), cy = Math.floor((me.y + PHYS.PH - 2) / TILE);
    const fx = cx + (me.f < 0 ? -1 : 1);
    const at = (x, y) => (x < 0 || y < 0 || x >= world.w || y >= world.h) ? 1 : world.tiles[y * world.w + x];
    const cand = [[fx, cy], [fx, cy + 1], [fx, cy - 1], [cx, cy + 1]];
    if (selected === -1) { for (const [x, y] of cand) if (at(x, y) || world.trees[x + ',' + y]) return { x, y }; return { x: fx, y: cy }; }
    for (const [x, y] of [[fx, cy], [fx, cy - 1], [fx, cy + 1]]) if (!at(x, y)) return { x, y };
    return { x: fx, y: cy };
  }
  function act() { // tahan klik / tombol tinju = pukul/taruh berulang
    if ((mouseDown < 0 && !touch.P) || !world) return;
    const now = Date.now(); if (now - lastAct < 180) return; lastAct = now;
    const t = mouseDown < 0 ? frontTarget() : mouseTile(); if (!inReach(t.x, t.y)) return;
    if (mouseDown < 0) { me.aim = { ...t, at: now }; }
    if (mouseDown === 2 || selected === -1) { send({ t: 'punch', x: t.x, y: t.y }); SND.play('punch'); }
    else send({ t: 'place', x: t.x, y: t.y, item: selected });
    me.punchAt = now;
  }

  // ---------- loop ----------
  function resize() { cv.width = innerWidth; cv.height = innerHeight; }
  addEventListener('resize', resize); resize();
  let prev = performance.now();
  function frame(t) {
    const dt = Math.min(0.05, (t - prev) / 1000); prev = t;
    if (world) {
      physics(dt); act();
      const now = Date.now();
      if (now - lastSent.at > 50 && (Math.abs(me.x - lastSent.x) > 0.5 || Math.abs(me.y - lastSent.y) > 0.5)) {
        send({ t: 'move', x: Math.round(me.x * 100) / 100, y: Math.round(me.y * 100) / 100, f: me.f });
        lastSent = { x: me.x, y: me.y, at: now };
      }
      for (const p of players.values()) { p.x += (p.tx - p.x) * Math.min(1, dt * 15); p.y += (p.ty - p.y) * Math.min(1, dt * 15); }
      render();
    }
    requestAnimationFrame(frame);
  }
  function render() {
    const W = cv.width, H = cv.height;
    cam.x = Math.max(0, Math.min(world.w * TILE - W, me.x + PHYS.PW / 2 - W / 2));
    const covered = invOpen ? $('invpanel').offsetHeight : 0; // pusatkan pemain di area yang tidak tertutup inventori
    cam.y = Math.max(0, Math.min(world.h * TILE - H + covered, me.y + PHYS.PH / 2 - (H - covered) / 2));
    if (world.w * TILE < W) cam.x = (world.w * TILE - W) / 2;
    if (world.h * TILE < H) cam.y = (world.h * TILE - H) / 2;
    cam.x = Math.round(cam.x); cam.y = Math.round(cam.y);
    const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#4a86e8'); sky.addColorStop(1, '#a8dcff');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(-cam.x, -cam.y);
    const x0 = Math.max(0, Math.floor(cam.x / TILE)), x1 = Math.min(world.w - 1, Math.floor((cam.x + W) / TILE));
    const y0 = Math.max(0, Math.floor(cam.y / TILE)), y1 = Math.min(world.h - 1, Math.floor((cam.y + H) / TILE));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const id = world.tiles[y * world.w + x];
      if (id) drawTile(ctx, id, x * TILE, y * TILE, TILE, x, y);
      const h = hits.get(x + ',' + y);
      if (h && Date.now() - h.at < 5000) { // retakan
        ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2; ctx.beginPath();
        const k = h.hits / h.hp;
        ctx.moveTo(x * TILE + 16, y * TILE + 16); ctx.lineTo(x * TILE + 16 - 14 * k, y * TILE + 4);
        ctx.moveTo(x * TILE + 16, y * TILE + 16); ctx.lineTo(x * TILE + 28 * k + 4, y * TILE + 26);
        if (k > .5) { ctx.moveTo(x * TILE + 16, y * TILE + 16); ctx.lineTo(x * TILE + 6, y * TILE + 30); }
        ctx.stroke();
      }
    }
    for (const k in world.trees) { const [x, y] = k.split(',').map(Number); if (x >= x0 - 1 && x <= x1 + 1 && y >= y0 - 1 && y <= y1 + 1) drawTree(ctx, world.trees[k], x * TILE, y * TILE); }
    // item tergeletak (DROP): ikon kecil melayang + jumlah
    for (const d of drops.values()) {
      if (d.x < cam.x - 40 || d.x > cam.x + W + 40 || d.y < cam.y - 40 || d.y > cam.y + H + 40) continue;
      const bob = Math.sin(Date.now() / 300 + d.k) * 2;
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(d.x, d.y + 13, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(d.x - 10, d.y - 12 + bob);
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(-2, -2, 24, 24); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1; ctx.strokeRect(-2, -2, 24, 24);
      drawItem(ctx, d.id, 20); ctx.restore();
      if (d.n > 1) { ctx.font = 'bold 11px PixelUI, system-ui'; ctx.textAlign = 'right'; ctx.lineWidth = 3; ctx.strokeStyle = '#0b1024'; ctx.strokeText(d.n, d.x + 13, d.y + 12 + bob); ctx.fillStyle = '#fff'; ctx.fillText(d.n, d.x + 13, d.y + 12 + bob); }
    }
    for (const p of players.values()) drawPlayer(ctx, p.x, p.y, p.f, p.name, p.bubble, p.bubbleAt, p.eq);
    drawPlayer(ctx, me.x, me.y, me.f, myName, me.bubble, me.bubbleAt, myEquip);
    // teks papan: tampil saat pemain dekat atau papan diarahkan kursor
    const ct = mouseTile();
    for (const k in world.signs) {
      const [sx, sy] = k.split(',').map(Number);
      const near = Math.hypot((sx + .5) * TILE - (me.x + PHYS.PW / 2), (sy + .5) * TILE - (me.y + PHYS.PH / 2)) < 3.5 * TILE;
      if (near || (ct.x === sx && ct.y === sy)) drawSignText(world.signs[k], sx * TILE + TILE / 2, sy * TILE - 4);
    }
    if (me.punchAt && Date.now() - me.punchAt < 120) { ctx.fillStyle = spriteOk ? '#c29481' : '#f2c79a'; ctx.fillRect(me.x + (me.f > 0 ? PHYS.PW : -8), me.y + (spriteOk ? 16 : 12), 8, 6); }
    // kursor (dan sasaran tombol tinju)
    const t = mouseTile();
    if (me.aim && Date.now() - me.aim.at < 400) { ctx.strokeStyle = 'rgba(255,213,74,.95)'; ctx.lineWidth = 2; ctx.strokeRect(me.aim.x * TILE + 1, me.aim.y * TILE + 1, TILE - 2, TILE - 2); }
    if (mouse.seen) {
      ctx.strokeStyle = inReach(t.x, t.y) ? 'rgba(255,255,255,.9)' : 'rgba(255,60,60,.8)'; ctx.lineWidth = 2;
      ctx.strokeRect(t.x * TILE + 1, t.y * TILE + 1, TILE - 2, TILE - 2);
    }
    // teks loot
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i], age = (Date.now() - f.at) / 1000;
      if (age > 1.6) { floaters.splice(i, 1); continue; }
      ctx.globalAlpha = 1 - age / 1.6; ctx.font = 'bold 13px PixelUI, system-ui'; ctx.textAlign = 'center';
      ctx.fillStyle = '#000'; ctx.fillText(f.text, f.x + 1, f.y - age * 30 + 1); ctx.fillStyle = '#ffe36e'; ctx.fillText(f.text, f.x, f.y - age * 30);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // info tile/pohon di bawah kursor (label kecil di atas tile)
    if (mouse.seen && t.x >= 0 && t.y >= 0 && t.x < world.w && t.y < world.h) {
      const tr = world.trees[t.x + ',' + t.y]; let tip = '';
      if (tr) { const left = Math.ceil((tr.plantedAt + tr.growMs - Date.now() - clockOffset) / 1000); tip = `Pohon ${itemName(tr.type)}: ${left > 0 ? left + ' dtk' : 'SIAP PANEN'}`; }
      else if (world.tiles[t.y * world.w + t.x]) tip = itemName(world.tiles[t.y * world.w + t.x]);
      if (tip && !world.signs[t.x + ',' + t.y]) {
        ctx.font = 'bold 11px PixelUI, system-ui'; ctx.textAlign = 'center';
        const sx = t.x * TILE + TILE / 2 - cam.x, sy = t.y * TILE - cam.y - 4, tw = ctx.measureText(tip).width + 10;
        ctx.fillStyle = 'rgba(12,20,52,.85)'; ctx.fillRect(sx - tw / 2, sy - 15, tw, 15); ctx.strokeStyle = '#7fc4ff'; ctx.lineWidth = 1; ctx.strokeRect(sx - tw / 2 + .5, sy - 14.5, tw - 1, 14);
        ctx.fillStyle = '#fff'; ctx.fillText(tip, sx, sy - 4);
      }
    }
    // strip atas: nama world + jumlah pemain + gembok
    const wl = `${world.name}${world.owner ? ' 🔒' : ''} · ${players.size + 1}`;
    if ($('tkWorld').textContent !== wl) { $('tkWorld').textContent = wl; $('pBadge').textContent = players.size + 1; }
    const ns = nearSign(true);
    $('signBtn').classList.toggle('show', !!ns && !panel);
  }
  function drawSignText(text, cx, by) {
    ctx.font = '12px PixelUI, system-ui'; ctx.textAlign = 'center';
    const words = text.split(' '), lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > 170 && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    const lh = 14, bw = Math.min(180, Math.max(...lines.map((l) => ctx.measureText(l).width))) + 12, bh = lines.length * lh + 8;
    ctx.fillStyle = 'rgba(250,240,215,.95)'; ctx.fillRect(cx - bw / 2, by - bh, bw, bh);
    ctx.strokeStyle = '#7a5a2e'; ctx.lineWidth = 2; ctx.strokeRect(cx - bw / 2, by - bh, bw, bh);
    ctx.fillStyle = '#3a2a10'; lines.forEach((l, i) => ctx.fillText(l, cx, by - bh + 4 + lh * (i + 1) - 3));
  }
  // Papan terdekat dalam jangkauan (editable = hanya jika boleh membangun).
  function nearSign(editable) {
    if (!world || (editable && !canBuildMe())) return null;
    const cx = Math.floor((me.x + PHYS.PW / 2) / TILE), cy = Math.floor((me.y + PHYS.PH / 2) / TILE);
    let best = null, bd = 1e9;
    for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) {
      if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
      const b = BLOCKS[world.tiles[y * world.w + x]];
      if (b && b.sign && inReach(x, y)) { const d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = { x, y }; } }
    }
    return best;
  }
  // Pembacaan state untuk uji otomatis (hanya baca; server tetap otoritatif).
  window.PS_DEBUG = () => ({ me: { x: me.x, y: me.y, f: me.f, onGround: me.onGround }, selected, invOpen, inv: { ...inv }, gems, world: world && world.name,
    drops: drops.size, aim: me.aim || null, tile: (x, y) => world.tiles[y * world.w + x] });
  { const g = $('logoCv').getContext('2d'); g.imageSmoothingEnabled = false; drawTile(g, 4, 4, 4, 32, 3, 7); g.strokeStyle = '#0b1024'; g.lineWidth = 2; g.strokeRect(4, 4, 32, 32); }
  requestAnimationFrame(frame);
})();
