'use strict';
/**
 * v1.8 daily systems (pure, no I/O): login reward with streak + 3 rotating daily quests.
 * Days are Asia/Jakarta calendar days (UTC+7), the same for every player and instance.
 * Exactly-once: the login reward is ledger op `daily:<user>:<day>` (inventory_ledger PK), a daily
 * quest is quest_claims row `d:<day>:<key>` written in the same transaction as its credit.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const TZ_OFFSET_MS = 7 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' of the game day containing `now`. */
function dayKey(now = Date.now()) { return new Date(now + TZ_OFFSET_MS).toISOString().slice(0, 10); }
/** UTC ms when that game day started. */
function dayStart(now = Date.now()) { return Math.floor((now + TZ_OFFSET_MS) / DAY_MS) * DAY_MS - TZ_OFFSET_MS; }
function prevDayKey(key) { return dayKey(Date.parse(`${key}T12:00:00Z`) - TZ_OFFSET_MS - DAY_MS); }

const REWARD_BASE = 15;
const REWARD_STEP = 5;
const STREAK_CAP = 7;
/** Gems for claiming on streak day n (1-based): 15, 20, ... 45 from day 7 on. */
function loginReward(streak) { return REWARD_BASE + REWARD_STEP * (Math.min(STREAK_CAP, Math.max(1, streak)) - 1); }

/**
 * Streak if the player claims today, from the day keys already claimed (any order).
 * Returns { claimedToday, streak } where streak counts today when claimedToday, else the streak
 * today's claim would make.
 */
function streakInfo(claimedKeys, today) {
  const set = new Set(claimedKeys);
  const claimedToday = set.has(today);
  let n = 1;
  let k = prevDayKey(today);
  while (set.has(k) && n < 400) { n++; k = prevDayKey(k); }
  return { claimedToday, streak: n };
}
const loginOpId = (userId, day) => `daily:${userId}:${day}`;
const dayFromOpId = (opId) => String(opId).split(':').pop();

/** Daily quest pool: progress = ledger rows of `reason` today (minus refunds), like the story quests. */
const DAILY_POOL = Object.freeze([
  { key: 'plant', reason: 'plant', goal: 10, gems: 30, title: 'Tanam 10 benih', title_en: 'Plant 10 seeds' },
  { key: 'harvest', reason: 'harvest', goal: 8, gems: 35, title: 'Panen 8 tanaman', title_en: 'Harvest 8 crops' },
  { key: 'place', reason: 'place', goal: 40, gems: 25, title: 'Pasang 40 blok', title_en: 'Place 40 blocks' },
  { key: 'craft', reason: 'craft', goal: 3, gems: 30, title: 'Craft 3 kali', title_en: 'Craft 3 times' },
  { key: 'sell', reason: 'sell', goal: 3, gems: 20, title: 'Jual ke toko 3 kali', title_en: 'Sell to the shop 3 times' },
  { key: 'splice', reason: 'splice', goal: 1, gems: 40, title: 'Splice 1 benih', title_en: 'Splice 1 seed' },
  { key: 'buy', reason: 'buy', goal: 2, gems: 15, title: 'Beli 2 kali di toko', title_en: 'Buy from the shop twice' },
].map(Object.freeze));
const DAILY_COUNT = 3;

function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
/** The 3 quests of a day: a deterministic shuffle of the pool seeded by the day key. */
function questsForDay(day) {
  const arr = DAILY_POOL.slice();
  let h = hash32(`pixeltopia:${day}`);
  for (let i = arr.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    const j = h % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, DAILY_COUNT);
}
const dailyQid = (day, key) => `d:${day}:${key}`;

module.exports = {
  DAY_MS, dayKey, dayStart, prevDayKey, loginReward, streakInfo, loginOpId, dayFromOpId,
  DAILY_POOL, DAILY_COUNT, questsForDay, dailyQid, STREAK_CAP,
};
