// Suara & musik prosedural (WebAudio) - tanpa file audio, semuanya disintesis dengan kode.
// Browser HP hanya mengizinkan audio setelah sentuhan pertama -> AudioContext dibuat/di-resume saat tap/klik/tombol pertama.
(function (root) {
  const LS_SFX = 'ps_sfx', LS_MUSIC = 'ps_music';
  let ac = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  const state = {
    sfx: localStorage.getItem(LS_SFX) !== '0',
    music: localStorage.getItem(LS_MUSIC) !== '0'
  };

  function ensure() {
    if (!ac) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      try { ac = new AC(); } catch (e) { return null; }
      master = ac.createGain(); master.gain.value = 0.8; master.connect(ac.destination);
      sfxBus = ac.createGain(); sfxBus.gain.value = state.sfx ? 0.6 : 0; sfxBus.connect(master);
      musicBus = ac.createGain(); musicBus.gain.value = state.music ? 0.16 : 0; musicBus.connect(master);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }
  // Buka kunci audio pada interaksi pertama (wajib untuk Android/iOS).
  const unlock = () => { if (ensure()) { startMusic(); } };
  for (const ev of ['pointerdown', 'touchstart', 'keydown', 'click']) root.addEventListener(ev, unlock, { capture: true, passive: true });

  function tone(freq, dur, { type = 'square', vol = 0.3, slide = 0, delay = 0, bus } = {}) {
    if (!ac || ac.state !== 'running') return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || sfxBus); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, { vol = 0.3, freq = 1200, q = 1, delay = 0 } = {}) {
    if (!ac || ac.state !== 'running') return;
    const t = ac.currentTime + delay;
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t); s.stop(t + dur + 0.02);
  }
  const SFX = {
    punch() { noise(0.07, { vol: 0.35, freq: 500, q: 0.8 }); tone(140, 0.06, { type: 'triangle', vol: 0.25, slide: 0.6 }); },
    break() { noise(0.22, { vol: 0.4, freq: 900, q: 0.6 }); tone(220, 0.18, { type: 'square', vol: 0.12, slide: 0.4 }); },
    place() { tone(330, 0.06, { type: 'triangle', vol: 0.25 }); noise(0.05, { vol: 0.15, freq: 2000 }); },
    pickup() { tone(880, 0.07, { type: 'square', vol: 0.12 }); tone(1320, 0.1, { type: 'square', vol: 0.12, delay: 0.06 }); },
    gems() { [988, 1319, 1760].forEach((f, i) => tone(f, 0.09, { type: 'triangle', vol: 0.18, delay: i * 0.05 })); },
    chat() { tone(660, 0.05, { type: 'sine', vol: 0.15 }); tone(990, 0.07, { type: 'sine', vol: 0.12, delay: 0.05 }); },
    pm() { tone(523, 0.08, { type: 'sine', vol: 0.18 }); tone(784, 0.08, { type: 'sine', vol: 0.18, delay: 0.08 }); tone(1047, 0.12, { type: 'sine', vol: 0.15, delay: 0.16 }); },
    trade() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, { type: 'square', vol: 0.12, delay: i * 0.07 })); },
    click() { tone(1200, 0.03, { type: 'square', vol: 0.08 }); },
    error() { tone(200, 0.15, { type: 'sawtooth', vol: 0.12, slide: 0.7 }); },
    splash() { noise(0.25, { vol: 0.25, freq: 600, q: 0.5 }); },
    jump() { tone(300, 0.1, { type: 'square', vol: 0.08, slide: 2 }); }
  };
  function play(name) { if (!state.sfx || !ensure() || !SFX[name]) return; try { SFX[name](); } catch (e) {} }

  // ---------- musik latar: loop pentatonik sederhana yang dijadwalkan di depan ----------
  const SCALE = [0, 2, 4, 7, 9];
  const CHORDS = [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]]; // I - vi - IV - V
  const BASE = 261.63; // C4
  const hz = (semi) => BASE * Math.pow(2, semi / 12);
  let musicT = 0, step = 0, timer = 0, seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  function schedule() {
    if (!ac || !state.music) return;
    const beat = 0.28;
    if (musicT < ac.currentTime) musicT = ac.currentTime + 0.05;
    while (musicT < ac.currentTime + 1.2) {
      const bar = Math.floor(step / 8) % CHORDS.length, ch = CHORDS[bar];
      const d = musicT - ac.currentTime;
      if (step % 8 === 0) tone(hz(ch[0] - 24), beat * 7.5, { type: 'triangle', vol: 0.35, delay: d, bus: musicBus }); // bass
      if (step % 2 === 0) tone(hz(ch[(step / 2) % 3] - 12), beat * 1.6, { type: 'sine', vol: 0.18, delay: d, bus: musicBus }); // arpeggio
      if (rnd() < 0.55) { const n = SCALE[Math.floor(rnd() * SCALE.length)] + (rnd() < 0.3 ? 12 : 0); tone(hz(n), beat * 0.9, { type: 'square', vol: 0.07, delay: d, bus: musicBus }); } // melodi
      musicT += beat; step++;
    }
  }
  function startMusic() { if (timer || !state.music || !ac) return; schedule(); timer = setInterval(schedule, 400); }
  function stopMusic() { clearInterval(timer); timer = 0; }

  function setSfx(on) {
    state.sfx = !!on; localStorage.setItem(LS_SFX, on ? '1' : '0');
    if (sfxBus) sfxBus.gain.value = on ? 0.6 : 0;
  }
  function setMusic(on) {
    state.music = !!on; localStorage.setItem(LS_MUSIC, on ? '1' : '0');
    if (musicBus && ac) musicBus.gain.setTargetAtTime(on ? 0.16 : 0, ac.currentTime, 0.1);
    if (on) { ensure(); startMusic(); } else stopMusic();
  }
  root.SOUND = { play, setSfx, setMusic, get sfx() { return state.sfx; }, get music() { return state.music; }, get running() { return !!ac && ac.state === 'running'; } };
})(window);
