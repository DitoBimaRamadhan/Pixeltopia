// Utilitas tes: menjalankan server sebagai child process & client WebSocket sederhana.
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');

let passed = 0, failed = 0;
const ok = (cond, label) => { if (cond) { passed++; console.log('  ✔ ' + label); } else { failed++; console.log('  ✘ ' + label); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = () => ({ passed, failed });

function startServer(env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = (d) => { out += d; if (/Server jalan/.test(out)) resolve(proc); };
    proc.stdout.on('data', onData); proc.stderr.on('data', (d) => { out += d; });
    proc.on('exit', (code) => reject(new Error('server exit ' + code + '\n' + out)));
    setTimeout(() => reject(new Error('server start timeout\n' + out)), 10000);
  });
}
function stopServer(proc) {
  return new Promise((r) => { if (proc.exitCode !== null) return r(); proc.removeAllListeners('exit'); proc.on('exit', r); proc.kill('SIGTERM'); });
}

function client(url, name) {
  const ws = new WebSocket(url);
  const c = { ws, name, msgs: [], waiters: [], closed: false };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw); c.msgs.push(m);
    c.waiters = c.waiters.filter((w) => { if (w.pred(m)) { clearTimeout(w.timer); w.resolve(m); return false; } return true; });
  });
  ws.on('close', () => { c.closed = true; });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = (pred, ms = 3000, label = '') => new Promise((resolve, reject) => {
    const found = c.msgs.find(pred); if (found) { c.msgs.splice(c.msgs.indexOf(found), 1); return resolve(found); }
    const w = { pred, resolve: (m) => { c.msgs.splice(c.msgs.indexOf(m), 1); resolve(m); } };
    w.timer = setTimeout(() => { c.waiters = c.waiters.filter((x) => x !== w); reject(new Error('timeout: ' + label)); }, ms);
    c.waiters.push(w);
  });
  c.open = new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  c.close = () => new Promise((r) => { if (c.closed) return r(); ws.once('close', r); ws.close(); });
  return c;
}

module.exports = { ok, sleep, result, startServer, stopServer, client };
