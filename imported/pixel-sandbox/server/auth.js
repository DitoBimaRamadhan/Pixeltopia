// Password & token sesi memakai crypto bawaan Node (scrypt) - tanpa dependency native.
const crypto = require('crypto');
const N = 16384, R = 8, P = 1, KEYLEN = 64;

function scrypt(pass, salt, n = N, r = R, p = P) {
  return new Promise((res, rej) => crypto.scrypt(pass, salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
}
// Format: scrypt$N$r$p$saltHex$hashHex
async function hashPassword(pass) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pass), salt);
  return ['scrypt', N, R, P, salt.toString('hex'), key.toString('hex')].join('$');
}
async function verifyPassword(pass, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltHex, hashHex] = parts;
  const expected = Buffer.from(hashHex, 'hex');
  const key = await scrypt(String(pass), Buffer.from(saltHex, 'hex'), +n, +r, +p);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
// Token sesi acak; yang disimpan di storage hanya hash SHA-256-nya.
const newToken = () => crypto.randomBytes(24).toString('hex');
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
function verifyToken(token, storedHash) {
  const a = Buffer.from(hashToken(token), 'hex'), b = Buffer.from(String(storedHash || ''), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
module.exports = { hashPassword, verifyPassword, newToken, hashToken, verifyToken };
