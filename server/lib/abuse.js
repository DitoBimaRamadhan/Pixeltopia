'use strict';
/**
 * v1.8 anti-abuse helpers (pure, clock injected so they are unit-testable):
 *   - createBucket: token-bucket rate limiter (per player, per action)
 *   - createHitTracker: multi-hit breaking (per player: the tile being punched + hits so far)
 *   - inReach: server-side reach check against the player's last reported tile
 *   - filterChat: basic Indonesian + English word filter (whole words, light leetspeak folding)
 *   - createChatGuard: chat rate limit with escalating mute
 */

/** Token bucket: `burst` tokens, refilled at `perSec`. take() → true if allowed. */
function createBucket(perSec, burst, now = Date.now) {
  let tokens = burst;
  let last = now();
  return {
    take(n = 1) {
      const t = now();
      tokens = Math.min(burst, tokens + ((t - last) / 1000) * perSec);
      last = t;
      if (tokens >= n) { tokens -= n; return true; }
      return false;
    },
    get tokens() { return tokens; },
  };
}

/**
 * Hit tracker for one player. hit(world, x, y, tileId, need) → { hits, need, done }.
 * Damage resets when the player switches tile/world, the tile id changes, or resetMs passes.
 */
function createHitTracker(resetMs, now = Date.now) {
  let cur = null; // { key, id, hits, at }
  return {
    hit(worldName, x, y, tileId, need) {
      const t = now();
      const key = `${worldName}:${x},${y}`;
      if (!cur || cur.key !== key || cur.id !== tileId || t - cur.at > resetMs) cur = { key, id: tileId, hits: 0, at: t };
      cur.hits += 1;
      cur.at = t;
      const done = cur.hits >= need;
      const out = { hits: Math.min(cur.hits, need), need, done };
      if (done) cur = null;
      return out;
    },
    reset() { cur = null; },
  };
}

/** Chebyshev distance check in tiles (client REACH = 3; `slack` covers movement/lag). */
function inReach(px, py, x, y, reach = 3, slack = 2) {
  if (![px, py, x, y].every(Number.isFinite)) return false;
  return Math.abs((x | 0) - (px | 0)) <= reach + slack && Math.abs((y | 0) - (py | 0)) <= reach + slack;
}

// Basic list (lowercase, after folding). Whole-word matches only, so "pantai"/"asumsi"/"dickens" stay intact.
const BAD_WORDS = [
  // English
  'fuck', 'fucking', 'fucker', 'fck', 'fuk', 'shit', 'bitch', 'bastard', 'asshole', 'cunt', 'dick', 'cock',
  'pussy', 'whore', 'slut', 'motherfucker', 'nigger', 'nigga', 'faggot', 'retard', 'stfu',
  // Indonesian
  'anjing', 'anjir', 'anjg', 'anj', 'njing', 'bangsat', 'bgst', 'kontol', 'kntl', 'memek', 'mmk', 'ngentot',
  'ngentod', 'entot', 'jancok', 'jancuk', 'cok', 'jembut', 'bajingan', 'keparat', 'goblok', 'goblog', 'gblk',
  'tolol', 'tlol', 'bego', 'babi', 'asu', 'tai', 'taik', 'kampret', 'pepek', 'perek', 'lonte',
  'pelacur', 'bencong', 'brengsek', 'monyet', 'kimak', 'pantek', 'puki',
];
const BAD = new Set(BAD_WORDS);
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i' };

/** Fold one token: lowercase, leetspeak → letters, collapse 3+ repeats ("anjiiing" → "anjing"). */
function fold(tok) {
  let s = tok.toLowerCase().replace(/[0-9@$!]/g, (c) => LEET[c] || c).replace(/[^a-z]/g, '');
  s = s.replace(/(.)\1{2,}/g, '$1');
  return s;
}
function isBad(tok) {
  const f = fold(tok);
  if (!f) return false;
  if (BAD.has(f)) return true;
  const d = f.replace(/(.)\1+/g, '$1'); // "kontoll" / "taii"
  return BAD.has(d);
}

/** Replace bad words with asterisks. Returns { text, hits }. */
function filterChat(text) {
  let hits = 0;
  // Tokens: runs of letters/digits/leet symbols. Also catches "a n j i n g" style spacing (single letters).
  let out = String(text).replace(/[A-Za-z0-9@$!]+/g, (tok) => {
    if (isBad(tok)) { hits++; return '*'.repeat(tok.length); }
    return tok;
  });
  out = out.replace(/\b(?:[A-Za-z]\s){2,}[A-Za-z]\b/g, (run) => {
    const joined = run.replace(/\s/g, '');
    if (isBad(joined)) { hits++; return run.replace(/[A-Za-z]/g, '*'); }
    return run;
  });
  return { text: out, hits };
}

/**
 * Chat guard: `burst` lines, refilled `perSec`; each blocked line is a strike. `strikes` strikes in
 * `strikeWindowMs` (or a repeated identical line) → muted for muteMs (doubling per mute, max 10 min).
 * check(text) → { ok } | { ok: false, reason: 'rate'|'muted'|'repeat', retryMs }.
 */
function createChatGuard(opts = {}, now = Date.now) {
  const { perSec = 0.5, burst = 4, strikes = 3, strikeWindowMs = 30000, muteMs = 30000, maxMuteMs = 600000 } = opts;
  const bucket = createBucket(perSec, burst, now);
  let strikeTimes = [];
  let mutedUntil = 0;
  let mutes = 0;
  let lastText = '';
  let repeats = 0;
  const strike = (t) => {
    strikeTimes = strikeTimes.filter((s) => t - s < strikeWindowMs);
    strikeTimes.push(t);
    if (strikeTimes.length >= strikes) {
      const dur = Math.min(maxMuteMs, muteMs * 2 ** mutes);
      mutes++;
      mutedUntil = t + dur;
      strikeTimes = [];
      return dur;
    }
    return 0;
  };
  return {
    check(text) {
      const t = now();
      if (t < mutedUntil) return { ok: false, reason: 'muted', retryMs: mutedUntil - t };
      const norm = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
      repeats = norm === lastText ? repeats + 1 : 0;
      lastText = norm;
      if (repeats >= 2) {
        const m = strike(t);
        return m ? { ok: false, reason: 'muted', retryMs: m } : { ok: false, reason: 'repeat', retryMs: 0 };
      }
      if (!bucket.take()) {
        const m = strike(t);
        return m ? { ok: false, reason: 'muted', retryMs: m } : { ok: false, reason: 'rate', retryMs: Math.ceil(1000 / perSec) };
      }
      return { ok: true };
    },
    /** A filtered (profane) line counts as a strike too; returns mute ms if it caused a mute. */
    strike() { return strike(now()); },
    get mutedUntil() { return mutedUntil; },
  };
}

module.exports = { createBucket, createHitTracker, inReach, filterChat, createChatGuard, BAD_WORDS, fold };
