'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function createAuth({ dataDir, jwtSecret }) {
  const USERS_FILE = path.join(dataDir, 'users.json');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  function loadUsers() {
    try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return {}; }
  }
  function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  }
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
    const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
    const sig = crypto.createHmac('sha256', jwtSecret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
  }
  function verifyToken(token) {
    if (!token) return null;
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expect = crypto.createHmac('sha256', jwtSecret).update(`${header}.${body}`).digest('base64url');
    if (sig !== expect) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload;
    } catch { return null; }
  }
  return { loadUsers, saveUsers, scryptHash, scryptVerify, signToken, verifyToken };
}
module.exports = { createAuth };
