'use strict';
function createTradeManager() {
  const sessions = new Map();
  function sid(a, b) { return [a, b].sort().join(':'); }
  function getOpenFor(playerId) {
    for (const s of sessions.values()) {
      if (s.status === 'open' && (s.a === playerId || s.b === playerId)) return s;
    }
    return null;
  }
  function request(from, toId) {
    if (!toId || from.id === toId) return { error: 'Target trade tidak valid.' };
    if (getOpenFor(from.id)) return { error: 'Kamu sudah dalam trade.' };
    const id = sid(from.id, toId);
    if (sessions.has(id) && sessions.get(id).status === 'open') return { error: 'Trade sudah berjalan.' };
    const session = {
      id, a: from.id, b: toId, aName: from.username, bName: null,
      offers: { [from.id]: { items: [], gems: 0 }, [toId]: { items: [], gems: 0 } },
      ready: { [from.id]: false, [toId]: false },
      status: 'pending', worldName: from.worldName,
    };
    sessions.set(id, session);
    return { session };
  }
  function accept(player, sessionId) {
    const s = sessions.get(sessionId) || getOpenFor(player.id);
    if (!s) return { error: 'Trade tidak ditemukan.' };
    if (s.b !== player.id && s.a !== player.id) return { error: 'Bukan trade kamu.' };
    if (s.status === 'pending' && player.id === s.b) {
      s.status = 'open'; s.bName = player.username;
      return { session: s, accepted: true };
    }
    return { session: s };
  }
  function cancel(player) {
    const s = getOpenFor(player.id) || [...sessions.values()].find(
      (x) => x.status === 'pending' && (x.a === player.id || x.b === player.id)
    );
    if (!s) return { error: 'Tidak ada trade.' };
    sessions.delete(s.id);
    return { session: s, cancelled: true };
  }
  function offer(player, items, gems) {
    const s = getOpenFor(player.id);
    if (!s || s.status !== 'open') return { error: 'Tidak ada trade terbuka.' };
    const clean = [];
    if (Array.isArray(items)) {
      for (const it of items.slice(0, 8)) {
        const id = it.id | 0; const n = Math.max(1, Math.min(999, it.n | 0));
        if (id >= 0) clean.push({ id, n });
      }
    }
    s.offers[player.id] = { items: clean, gems: Math.max(0, gems | 0) };
    s.ready[player.id] = false; s.ready[s.a] = false; s.ready[s.b] = false;
    return { session: s };
  }
  function ready(player, isReady) {
    const s = getOpenFor(player.id);
    if (!s || s.status !== 'open') return { error: 'Tidak ada trade terbuka.' };
    s.ready[player.id] = !!isReady;
    return { session: s, bothReady: s.ready[s.a] && s.ready[s.b] };
  }
  function complete(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) return null;
    sessions.delete(sessionId);
    s.status = 'done';
    return s;
  }
  function publicSession(s) {
    if (!s) return null;
    return { id: s.id, a: s.a, b: s.b, aName: s.aName, bName: s.bName, status: s.status, offers: s.offers, ready: s.ready, worldName: s.worldName };
  }
  return { request, accept, cancel, offer, ready, complete, getOpenFor, publicSession, sessions };
}
module.exports = { createTradeManager };
