'use strict';
const crypto = require('crypto');

/** Password hashing + HS256 tokens. Storage of users lives in lib/store.js. */
function createAuth({ jwtSecret }) {
  function scryptHash(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(password, salt, 32).toString('hex');
    return `${salt}:${hash}`;
  }
  function scryptVerify(password, stored) {
    const [salt, hash] = String(stored).split(':');
    if (!salt || !hash) return false;
    const next = crypto.scryptSync(password, salt, 32).toString('hex');
    try { return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(next, 'hex')); } catch { return false; }
  }
  function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
  function signToken(payload, ttlSec = 60 * 60 * 24 * 14) {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const jti = payload.jti || crypto.randomBytes(9).toString('base64url');
    const body = b64url(JSON.stringify({ ...payload, jti, exp: Math.floor(Date.now() / 1000) + ttlSec }));
    const sig = crypto.createHmac('sha256', jwtSecret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
  }
  function verifyToken(token) {
    if (!token) return null;
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expect = crypto.createHmac('sha256', jwtSecret).update(`${header}.${body}`).digest('base64url');
    if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload;
    } catch { return null; }
  }
  function decode(token) {
    try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
  }
  return { decode, scryptHash, scryptVerify, signToken, verifyToken };
}
module.exports = { createAuth };
