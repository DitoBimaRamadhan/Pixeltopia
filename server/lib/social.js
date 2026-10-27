'use strict';
/**
 * v1.8 WebSocket features: daily login reward + daily quests, leaderboard, friends and private messages.
 * Everything that moves gems goes through the store's idempotent, transactional functions, so a repeated
 * message, a second device or a second instance can never pay twice.
 */
const daily = require('./daily');
const abuse = require('./abuse');

const PM_MAX_LEN = 200;
const FRIEND_CAP = 100;
const LEADERBOARD_TTL_MS = 30000;
const PM_POLL_MS = 3000;

function createSocial({ store, safeSend, localPlayers, localPlayersById, applyPlayerOps, setSrvInv, walletReady, log = console }) {
  let lb = { at: 0, top: null, p: null };
  let pmCursor = null; // highest private_messages.id already delivered by this instance
  const delivered = new Set(); // pm ids pushed locally right after the insert (skip them in the poll)

  const err = (player, op, text) => safeSend(player.ws, { t: 'social_error', op, error: text });

  async function dailyState(player) {
    const now = Date.now();
    const day = daily.dayKey(now);
    const since = daily.dayStart(now);
    const rows = await store.ledgerByReason(player.id, 'daily', since - 400 * daily.DAY_MS);
    const keys = rows.map((r) => daily.dayFromOpId(r.opId));
    const s = daily.streakInfo(keys, day);
    const claimed = new Set(await store.questClaimedLike(player.id, `d:${day}:`));
    const quests = [];
    for (const q of daily.questsForDay(day)) {
      const qid = daily.dailyQid(day, q.key);
      quests.push({ qid, key: q.key, title: q.title, title_en: q.title_en, goal: q.goal, gems: q.gems,
        progress: Math.min(q.goal, await store.invProgressSince(player.id, q.reason, since)), claimed: claimed.has(qid) });
    }
    return {
      t: 'daily_state', day, claimedToday: s.claimedToday, streak: s.streak,
      reward: daily.loginReward(s.streak), nextReward: daily.loginReward(s.streak + (s.claimedToday ? 1 : 0)),
      resetsIn: since + daily.DAY_MS - now, quests,
    };
  }

  async function handle(player, t, msg) {
    if (!player.authed) return err(player, t, 'Login dulu untuk fitur ini.');
    if (!player.socialBucket.take()) return err(player, t, 'Pelan-pelan! Terlalu cepat.');
    try {
      switch (t) {
        case 'daily_state': return safeSend(player.ws, await dailyState(player));
        case 'daily_claim': {
          if (!(await walletReady(player))) return err(player, t, 'Inventori belum siap, coba lagi.');
          const st0 = await dailyState(player);
          if (st0.claimedToday) return safeSend(player.ws, { ...st0, claim: { ok: false, error: 'Hadiah harian sudah diambil hari ini.' } });
          const gems = daily.loginReward(st0.streak);
          const r = await applyPlayerOps(player, daily.loginOpId(player.id, st0.day), { gems }, 'daily');
          const st1 = await dailyState(player);
          const ok = r.ok && !r.dup;
          if (ok) log.log(`[daily] login user=${player.id} day=${st0.day} streak=${st0.streak} gems=${gems}`);
          return safeSend(player.ws, { ...st1, claim: ok ? { ok: true, gems, streak: st0.streak } : { ok: false, error: r.dup ? 'Hadiah harian sudah diambil hari ini.' : 'Gagal klaim, coba lagi.' } });
        }
        case 'daily_quest_claim': {
          if (!(await walletReady(player))) return err(player, t, 'Inventori belum siap, coba lagi.');
          const now = Date.now();
          const day = daily.dayKey(now);
          const q = daily.questsForDay(day).find((x) => x.key === String(msg.key || ''));
          if (!q) return err(player, t, 'Quest harian tidak dikenal (mungkin sudah berganti hari).');
          const qid = daily.dailyQid(day, q.key);
          const r = await store.questClaimSince(player.id, qid, { countReason: q.reason, goal: q.goal, since: daily.dayStart(now),
            opId: `dq:${player.id}:${day}:${q.key}`, ops: { gems: q.gems } });
          if (r.state) for (const p of localPlayersById(player.id)) setSrvInv(p, r.state);
          if (r.ok) log.log(`[daily] quest user=${player.id} qid=${qid}`);
          const st = await dailyState(player);
          const error = r.ok ? undefined : r.error === 'already_claimed' ? 'Sudah diklaim.' : r.error === 'not_complete' ? 'Belum selesai.' : 'Gagal klaim, coba lagi.';
          return safeSend(player.ws, { ...st, claim: { ok: r.ok, key: q.key, gems: r.ok ? q.gems : 0, error } });
        }
        case 'leaderboard': {
          const now = Date.now();
          if (!lb.top || now - lb.at > LEADERBOARD_TTL_MS) {
            if (!lb.p) lb.p = store.leaderboard(20).then((top) => { lb = { at: Date.now(), top, p: null }; }).catch((e) => { lb.p = null; throw e; });
            await lb.p;
          }
          const me = await store.gemsRank(player.id);
          return safeSend(player.ws, { t: 'leaderboard', top: lb.top, me, ttl: LEADERBOARD_TTL_MS });
        }
        case 'friend_list': {
          const fl = await store.friendList(player.id);
          const online = new Set(localPlayers().filter((p) => p.authed && !p.closed).map((p) => p.id));
          const mark = (a) => a.map((e) => ({ ...e, online: online.has(e.id) || undefined }));
          return safeSend(player.ws, { t: 'friends', friends: mark(fl.friends), incoming: fl.incoming, outgoing: fl.outgoing, unread: await store.pmUnread(player.id) });
        }
        case 'friend_add': {
          const name = String(msg.name || '').trim();
          if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return err(player, t, 'Nama pemain tidak valid.');
          const target = await store.getUser(name);
          if (!target) return err(player, t, `Pemain ${name} tidak ditemukan.`);
          if (target.id === player.id) return err(player, t, 'Itu kamu sendiri :)');
          if (!(await store.friendAdd(player.id, target.id, FRIEND_CAP))) return err(player, t, `Daftar teman penuh (maks ${FRIEND_CAP}).`);
          const mutual = await store.areFriends(player.id, target.id);
          for (const p of localPlayersById(target.id)) safeSend(p.ws, { t: 'friend_event', kind: mutual ? 'accepted' : 'request', id: player.id, username: player.username });
          safeSend(player.ws, { t: 'friend_event', kind: mutual ? 'accepted' : 'sent', id: target.id, username: target.username });
          return handle(player, 'friend_list', {});
        }
        case 'friend_remove': {
          const id = String(msg.id || '');
          if (!id) return err(player, t, 'Pemain tidak valid.');
          await store.friendRemove(player.id, id);
          return handle(player, 'friend_list', {});
        }
        case 'pm_send': {
          const to = String(msg.to || '');
          let text = String(msg.text || '').replace(/[\r\n\t]/g, ' ').trim();
          if (!to || !text) return;
          if (text.length > PM_MAX_LEN) text = text.slice(0, PM_MAX_LEN);
          const g = player.chatGuard.check(text);
          if (!g.ok) return err(player, t, g.reason === 'muted' ? `Kamu di-mute ${Math.ceil(g.retryMs / 1000)} detik.` : 'Terlalu cepat.');
          if (!(await store.areFriends(player.id, to))) return err(player, t, 'Pesan pribadi hanya untuk teman (saling add).');
          const f = abuse.filterChat(text);
          if (f.hits) { text = f.text; player.chatGuard.strike(); }
          const saved = await store.pmSend(player.id, player.username, to, text);
          const m = { t: 'pm', id: saved.id, from: player.id, fromName: player.username, to, text, ts: saved.ts };
          delivered.add(saved.id);
          for (const p of localPlayersById(to)) safeSend(p.ws, m);
          for (const p of localPlayersById(player.id)) safeSend(p.ws, m);
          return;
        }
        case 'pm_thread': {
          const other = String(msg.with || '');
          if (!other) return;
          const msgs = await store.pmThread(player.id, other, 50);
          await store.pmMarkRead(player.id, other);
          return safeSend(player.ws, { t: 'pm_thread', with: other, messages: msgs });
        }
        default: return undefined;
      }
    } catch (e) {
      log.error(`[social] ${t} failed:`, e.message);
      return err(player, t, 'Server sibuk, coba lagi.');
    }
  }

  /** Cross-instance PM delivery: poll for messages to players connected here. */
  async function pollPms() {
    if (!store.pmSince) return;
    if (pmCursor === null) { pmCursor = await store.pmMaxId(); return; }
    const ids = [...new Set(localPlayers().filter((p) => p.authed && !p.closed).map((p) => p.id))];
    const rows = ids.length ? await store.pmSince(ids, pmCursor) : [];
    if (!ids.length) { pmCursor = Math.max(pmCursor, await store.pmMaxId()); return; }
    for (const m of rows) {
      pmCursor = Math.max(pmCursor, m.id);
      if (delivered.delete(m.id)) continue;
      for (const p of localPlayersById(m.to)) safeSend(p.ws, { t: 'pm', ...m });
    }
    if (delivered.size > 5000) delivered.clear();
  }
  let timer = null;
  function start() {
    if (timer) return;
    const loop = () => { pollPms().catch((e) => log.warn("[social] pm poll failed", e.message)).finally(() => { timer = setTimeout(loop, PM_POLL_MS); if (timer.unref) timer.unref(); }); };
    timer = setTimeout(loop, 500);
    if (timer.unref) timer.unref();
  }
  function stop() { if (timer) clearTimeout(timer); timer = null; }

  const TYPES = new Set(['daily_state', 'daily_claim', 'daily_quest_claim', 'leaderboard', 'friend_list', 'friend_add', 'friend_remove', 'pm_send', 'pm_thread']);
  return { handle, TYPES, start, stop, pollPms, dailyState };
}

module.exports = { createSocial, PM_MAX_LEN, FRIEND_CAP };
