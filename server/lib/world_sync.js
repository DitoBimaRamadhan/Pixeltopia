'use strict';
/**
 * Multi-instance world sync over Postgres (works the same on the file store for local dev).
 *
 * Every loaded world keeps:
 *   base       authoritative state = DB snapshot + every logged event up to appliedSeq
 *   pending    this instance's own edits that are already shown to players but not yet seen
 *              back in the log (optimistic echo)
 *   world.*    visible state = base + pending (what local players see)
 * Edits are validated against the visible state, shown immediately, then appended to the log in
 * the background. A poll loop pulls new events (all instances, in seq order), applies them to base
 * with the same pure reducer, recomputes visible and sends only the tiles that changed. If one of
 * our edits loses a race (e.g. two World Locks), the reducer rejects it on every instance and the
 * diff corrects our players' screens.
 */
const crypto = require('crypto');
const { applyEvent, normalizeEvent, generateGrid, clonePlants, W } = require('./world_manager');
const rules = require('./rules');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createWorldSync({
  store, worlds, instanceId, broadcastWorld, deliverToPlayer, localPlayers, kickPlayer, log = console,
  pollMs = 150, presenceFastMs = 300, presenceSlowMs = 2000, presenceMaxAgeMs = 4000,
  sessionCheckMs = 1000, unloadIdleMs = 60000, onEventApplied = null,
}) {
  let eidCounter = 0;
  // eids feed inventory op_ids (place:<user>:<eid>), so they must never repeat across restarts even when
  // INSTANCE_ID is fixed: add a per-process random nonce.
  const bootNonce = crypto.randomBytes(3).toString('hex');
  let stopped = false;
  let lastSessionCheck = 0;
  const loading = new Map();
  const presencePublished = new Set(); // worlds with a presence row from this instance
  const stats = { polls: 0, applied: 0, reloads: 0, appendFailures: 0, rejectedOwn: 0 };

  const cloneBase = (src) => ({
    grid: Int32Array.from(src.grid), lockOwnerId: src.lockOwnerId || null, lockOwnerName: src.lockOwnerName || null,
    access: (src.access || []).map((a) => ({ id: a.id, username: a.username })), plants: clonePlants(src.plants), dirty: false,
  });
  function attach(world, row) {
    world.base = cloneBase(row);
    world.appliedSeq = Number(row.snapshotSeq) || 0;
    world.snapSeq = world.appliedSeq;
    world.headSeq = Number(row.headSeq) || 0;
    world.pending = [];
    world.remote = new Map();
    world.appendChain = Promise.resolve();
    world.lastActive = Date.now();
    world.presenceAt = 0;
    world.othersPresent = false;
    world.presenceDirty = true;
  }
  function recompute(world) {
    world.grid.set(world.base.grid);
    world.lockOwnerId = world.base.lockOwnerId;
    world.lockOwnerName = world.base.lockOwnerName;
    world.access = world.base.access.map((a) => ({ id: a.id, username: a.username }));
    world.plants = clonePlants(world.base.plants);
    for (const p of world.pending) applyEvent(world, p.ev); // a pending edit that no longer fits is simply skipped
  }
  const visibleKey = (w) => `${w.lockOwnerId}|${w.lockOwnerName}`;
  function emitDiff(world, beforeGrid, beforeLock, touched) {
    let sent = 0;
    for (let i = 0; i < world.grid.length; i++) {
      if (beforeGrid[i] === world.grid[i]) continue;
      const meta = touched.get(i);
      const msg = {
        t: 'tile', x: i % W, y: (i / W) | 0, id: world.grid[i], by: meta ? meta.by : null, action: meta ? meta.action : 'sync',
        lockOwnerId: world.lockOwnerId, lockOwnerName: world.lockOwnerName,
      };
      if (meta && meta.broke !== undefined) msg.broke = meta.broke;
      if (meta && meta.harvest !== undefined) msg.harvest = meta.harvest;
      const plant = rules.isSeed(world.grid[i]) && world.plants ? world.plants[String(i)] : null;
      if (plant) msg.readyIn = Math.round(plant.r - Date.now());
      broadcastWorld(world, msg);
      sent++;
    }
    if (!sent && beforeLock !== visibleKey(world)) {
      // Lock/owner changed without a visible tile change: refresh clients' lock label.
      broadcastWorld(world, { t: 'world_lock', lockOwnerId: world.lockOwnerId, lockOwnerName: world.lockOwnerName });
    }
  }

  /** Apply log events in seq order. Returns true if a gap was found (caller must reload the snapshot). */
  function applyBatch(world, evs) {
    const beforeGrid = Int32Array.from(world.grid);
    const beforeLock = visibleKey(world);
    const touched = new Map();
    let stateChanged = false;
    let gap = false;
    for (const ev of evs) {
      if (ev.seq <= world.appliedSeq) continue;          // already applied (overlapping fetches)
      if (ev.seq !== world.appliedSeq + 1) { gap = true; break; }
      world.appliedSeq = ev.seq;
      stats.applied++;
      const mine = ev.instanceId === instanceId;
      if (ev.kind === 'chat') {
        if (!mine) broadcastWorld(world, { t: 'chat', from: ev.from, id: ev.actorId || 'system', text: ev.text, world: world.name, ts: ev.ts || ev.createdAt });
        continue;
      }
      if (ev.kind === 'trade') {
        if (!mine && ev.toId && ev.payload) deliverToPlayer(ev.toId, ev.payload);
        continue;
      }
      const prevLockOwnerId = world.base.lockOwnerId || null;
      const r = applyEvent(world.base, ev);
      stateChanged = true;
      if (onEventApplied && (ev.kind === 'punch' || ev.kind === 'place' || ev.kind === 'fertilize')) {
        // Confirmed (logged) outcome, identical on every instance: inventory refunds/credits hang off this.
        try { onEventApplied(world, ev, r, { prevLockOwnerId, mine }); } catch (e) { log.error('[sync] onEventApplied failed:', e.message); }
      }
      if (mine && ev.eid) {
        const i = world.pending.findIndex((p) => p.eid === ev.eid);
        if (i >= 0) world.pending.splice(i, 1);
        if (r.error) {
          stats.rejectedOwn++;
          if (ev.actorId) deliverToPlayer(ev.actorId, { t: 'error', error: r.error });
        }
      }
      if (!r.error && !r.noop && (ev.kind === 'punch' || ev.kind === 'place')) {
        const meta = { by: ev.actorId, action: ev.kind };
        if (ev.kind === 'punch') meta.broke = r.broke;
        if (ev.kind === 'punch' && r.harvest !== undefined) meta.harvest = r.harvest;
        touched.set(r.y * W + r.x, meta);
      }
      if (!mine && !r.error && ev.kind === 'fertilize') {
        // Grid unchanged, so emitDiff would not show it: tell our players the new ready time.
        broadcastWorld(world, { t: 'plant', x: r.x, y: r.y, readyIn: Math.round(r.readyAt - Date.now()), boosted: true, by: ev.actorId });
      }
    }
    if (stateChanged) {
      recompute(world);
      emitDiff(world, beforeGrid, beforeLock, touched);
    }
    return gap;
  }

  /** 'reload' | 'more' | 'ok' | 'missing' */
  function processWorld(world, head, evs) {
    if (!head) return 'missing';
    world.headSeq = head.headSeq;
    if (evs.length && evs[0].seq > world.appliedSeq + 1) return 'reload';
    if (!evs.length && head.headSeq > world.appliedSeq) return 'reload';
    if (evs.length && applyBatch(world, evs)) return 'reload';
    return world.appliedSeq < head.headSeq ? 'more' : 'ok';
  }

  /** We fell behind the event cleanup (or a gap appeared): jump to the newer DB snapshot. */
  function reload(world) {
    if (world.reloading) return world.reloading;
    world.reloading = (async () => {
      const row = await store.loadWorld(world.name);
      if (!row) return;
      if (row.snapshotSeq > world.appliedSeq) {
        stats.reloads++;
        const beforeGrid = Int32Array.from(world.grid);
        const beforeLock = visibleKey(world);
        world.base = cloneBase(row);
        world.appliedSeq = row.snapshotSeq;
        world.snapSeq = Math.max(world.snapSeq, row.snapshotSeq);
        recompute(world);
        emitDiff(world, beforeGrid, beforeLock, new Map());
        log.log(`[sync] ${world.name} reloaded snapshot @${row.snapshotSeq}`);
      } else {
        log.warn(`[sync] ${world.name} gap after seq ${world.appliedSeq} but snapshot is @${row.snapshotSeq}`);
      }
    })().finally(() => { world.reloading = null; });
    return world.reloading;
  }

  async function catchUp(world) {
    for (let guard = 0; guard < 40; guard++) {
      const { heads, events } = await store.fetchEventsMulti([{ world: world.name, after: world.appliedSeq }]);
      const r = processWorld(world, heads[world.name], events[world.name] || []);
      if (r === 'reload') { await reload(world); continue; }
      if (r === 'more') continue;
      return;
    }
  }

  /** Load (or create) a world and bring it fully up to date before a player joins it. */
  async function ensureWorld(name, { create = false, creatorId = null } = {}) {
    if (loading.has(name)) { try { await loading.get(name); } catch { /* retry below */ } }
    const live = worlds.getWorld(name);
    if (live && live.base && live.players.size > 0) return { world: live, created: false }; // kept fresh by the poll loop
    const p = (async () => {
      let w = worlds.getWorld(name);
      let created = false;
      if (!w || !w.base) {
        let row = await store.loadWorld(name);
        if (!row) {
          if (!create) return { error: 'Dunia tidak ditemukan. Buat dulu atau cek nama.' };
          const gen = generateGrid(crypto.randomBytes(4).readUInt32BE(0));
          const res = await store.createWorldIfAbsent({
            name, seed: gen.seed, grid: gen.grid, spawn: gen.spawn, lockOwnerId: null, lockOwnerName: null,
            access: [], createdBy: creatorId, createdAt: Date.now(),
          });
          row = res.world; created = res.created;
          if (!row) return { error: 'Gagal membuat dunia.' };
        }
        w = worlds.getWorld(name) || worlds.hydrate(row);
        if (!w) return { error: 'Data dunia rusak.' };
        attach(w, row);
      }
      await catchUp(w);
      w.lastActive = Date.now();
      return { world: w, created };
    })();
    loading.set(name, p);
    try { return await p; } finally { loading.delete(name); }
  }

  /**
   * Append in order (per world). With `inv` the inventory change is applied in the SAME transaction
   * (store.appendEventInv): if it is refused (e.g. not enough items) nothing is appended and
   * onFail(error) runs; on success onInv(state) gets the new wallet state.
   */
  function appendLogged(world, ev, onFail, inv = null, onInv = null) {
    world.appendChain = world.appendChain.then(async () => {
      let res = null;
      let failure = null;
      try {
        if (inv) {
          const r = await store.appendEventInv(world.name, ev, instanceId, inv);
          if (r && r.ok) { res = r; if (onInv && r.state) onInv(r.state); } else if (r) { failure = r.error || 'inv_failed'; if (onInv && r.state) onInv(r.state); }
        } else {
          res = await store.appendEvent(world.name, ev, instanceId);
        }
      } catch (e) {
        log.error(`[sync] append ${ev.kind} to ${world.name} failed:`, e.message);
      }
      if (!res) { if (!failure) stats.appendFailures++; if (onFail) onFail(failure); }
    });
    return world.appendChain;
  }

  /**
   * Validate + apply an edit (punch/place/access) on the visible world, echo it locally right away
   * and append it to the log in the background. Returns the reducer result (same shape as before).
   */
  /**
   * opts.inv = {userId, ops, reason}: pay for this edit from the user's server inventory, atomically with
   * the log append (op_id `<reason>:<userId>:<eid>`, recorded in the event as invOp). opts.onInv(state)
   * receives the wallet state after the attempt; opts.failMessage(error) picks the error text sent to the
   * actor when the append/payment is refused (default: "server busy"). opts.onFail(error) runs when the
   * edit was not logged at all; opts.invOp = '<kind>:<userId>' marks an edit paid outside the DB (guests).
   */
  function submit(world, rawEv, opts = {}) {
    const eid = `${instanceId}:${bootNonce}:${++eidCounter}`;
    const inv = opts.inv ? { ...opts.inv, opId: `${opts.inv.reason || 'op'}:${opts.inv.userId}:${eid}` } : null;
    const withTs = rawEv.ts ? rawEv : { ...rawEv, ts: Date.now() }; // server time: plant ready times / harvests
    const ev = normalizeEvent(inv ? { ...withTs, invOp: inv.opId } : (opts.invOp ? { ...withTs, invOp: `${opts.invOp}:${eid}` } : withTs));
    const r = applyEvent(world, ev);
    if (r.error || r.noop) return r;
    const logged = { ...ev, eid };
    world.pending.push({ eid, ev: logged });
    world.lastActive = Date.now();
    appendLogged(world, logged, (failure) => {
      const i = world.pending.findIndex((p) => p.eid === eid);
      if (i < 0) return;
      const beforeGrid = Int32Array.from(world.grid);
      const beforeLock = visibleKey(world);
      world.pending.splice(i, 1);
      recompute(world);
      emitDiff(world, beforeGrid, beforeLock, new Map());
      if (opts.onFail) { try { opts.onFail(failure); } catch (e) { log.error('[sync] onFail failed:', e.message); } }
      const msg = (failure && opts.failMessage && opts.failMessage(failure)) || 'Server sibuk — perubahan dibatalkan, coba lagi.';
      if (ev.actorId) deliverToPlayer(ev.actorId, { t: 'error', error: msg });
    }, inv, opts.onInv || null);
    return r;
  }
  /** Chat line for players of this world on other instances (local players get it directly). */
  function publishChat(world, { from, id, text, ts }) {
    return appendLogged(world, { kind: 'chat', actorId: id, actorName: from, from, text, ts });
  }
  /** Deliver a message to a player connected to another instance, via the world's log. */
  function publishToPlayer(worldName, toId, payload) {
    const w = worlds.getWorld(worldName);
    const ev = { kind: 'trade', toId, payload };
    if (w && w.base) return appendLogged(w, ev);
    return store.appendEvent(worldName, ev, instanceId).catch((e) => log.error('[sync] publishToPlayer failed:', e.message));
  }

  function presencePlayers(world) {
    return [...world.players.values()].map((p) => ({ i: p.id, u: p.username, x: p.x, y: p.y, px: p.px, py: p.py }));
  }
  async function presenceRound(active, now) {
    const writes = [];
    for (const w of active) {
      if (!w.players.size) continue;
      const every = w.othersPresent ? presenceFastMs : presenceSlowMs;
      if (w.presenceDirty || now - w.presenceAt >= every) {
        w.presenceDirty = false;
        w.presenceAt = now;
        presencePublished.add(w.name);
        writes.push(store.upsertPresence(w.name, instanceId, presencePlayers(w)));
      }
    }
    for (const name of [...presencePublished]) {
      const w = worlds.getWorld(name);
      if (!w || !w.players.size) {
        presencePublished.delete(name);
        writes.push(store.deletePresence(name, instanceId));
      }
    }
    const names = active.filter((w) => w.players.size).map((w) => w.name);
    const read = names.length ? store.fetchPresence(names, { maxAgeMs: presenceMaxAgeMs, excludeInstance: instanceId }) : Promise.resolve([]);
    const [rows] = await Promise.all([read, Promise.all(writes)]);
    const byWorld = new Map();
    for (const row of rows) {
      if (!byWorld.has(row.world)) byWorld.set(row.world, []);
      byWorld.get(row.world).push(row);
    }
    for (const w of active) {
      if (!w.players.size) continue;
      const list = byWorld.get(w.name) || [];
      w.othersPresent = list.length > 0;
      const next = new Map();
      for (const row of list) {
        for (const p of row.players || []) {
          if (!p || !p.i || w.players.has(p.i)) continue;
          next.set(p.i, { i: p.i, u: p.u, x: p.x | 0, y: p.y | 0, px: p.px, py: p.py, inst: row.instanceId });
        }
      }
      for (const [id, p] of next) {
        if (!w.remote.has(id)) broadcastWorld(w, { t: 'player_join', player: { i: p.i, u: p.u, x: p.x, y: p.y } });
      }
      for (const [id, p] of w.remote) {
        if (!next.has(id) && !w.players.has(id)) broadcastWorld(w, { t: 'player_left', id, username: p.u });
      }
      w.remote = next;
    }
  }

  async function sessionRound() {
    const players = localPlayers().filter((p) => p.authed && p.connId);
    if (!players.length) return;
    const owners = await store.fetchSessionOwners([...new Set(players.map((p) => p.id))]);
    for (const p of players) {
      const owner = owners[p.id];
      if (owner && owner !== p.connId) kickPlayer(p);
    }
  }

  async function pollOnce() {
    const now = Date.now();
    const active = worlds.allWorlds().filter((w) => w.base && (w.players.size > 0 || w.pending.length > 0));
    const tasks = [];
    if (active.length) {
      stats.polls++;
      tasks.push(store.fetchEventsMulti(active.map((w) => ({ world: w.name, after: w.appliedSeq }))).then(({ heads, events }) => {
        for (const w of active) {
          const r = processWorld(w, heads[w.name], events[w.name] || []);
          if (r === 'reload') reload(w).catch((e) => log.error('[sync] reload failed:', e.message));
        }
      }));
    }
    if (active.length || presencePublished.size) tasks.push(presenceRound(active, now));
    if (now - lastSessionCheck >= sessionCheckMs) { lastSessionCheck = now; tasks.push(sessionRound()); }
    const results = await Promise.allSettled(tasks);
    for (const r of results) if (r.status === 'rejected') log.error('[sync] poll error:', r.reason && r.reason.message);
  }

  async function loop() {
    while (!stopped) {
      await pollOnce();
      await sleep(pollMs);
    }
  }

  /** Persist base state of worlds that advanced since their last snapshot; unload idle worlds. */
  async function snapshotAll({ unload = true } = {}) {
    const now = Date.now();
    for (const w of worlds.allWorlds()) {
      if (!w.base) continue;
      if (w.appliedSeq > w.snapSeq) {
        const seq = w.appliedSeq;
        try {
          await store.saveSnapshotIfNewer({ name: w.name, spawn: w.spawn, seed: w.seed, createdAt: w.createdAt, createdBy: w.createdBy, ...w.base }, seq);
          w.snapSeq = Math.max(w.snapSeq, seq); // also when another instance already stored a newer one
        } catch (e) { log.error(`[sync] snapshot ${w.name} failed:`, e.message); continue; }
      }
      if (unload && !w.players.size && !w.pending.length && now - w.lastActive > unloadIdleMs && !loading.has(w.name)) {
        worlds.unload(w.name);
      }
    }
  }
  async function maintenance() {
    const results = await Promise.allSettled([
      store.cleanupEvents({ olderThanMs: 10 * 60 * 1000 }), store.deleteStalePresence(60 * 1000), store.tradeExpire(),
    ]);
    for (const r of results) if (r.status === 'rejected') log.error('[sync] maintenance error:', r.reason && r.reason.message);
  }
  async function flushAppends() {
    await Promise.allSettled(worlds.allWorlds().filter((w) => w.base).map((w) => w.appendChain));
  }
  async function shutdown() {
    stopped = true;
    await flushAppends();
    await catchUpAll();
    await snapshotAll({ unload: false });
    await Promise.allSettled([...presencePublished].map((n) => store.deletePresence(n, instanceId)));
  }
  async function catchUpAll() {
    await Promise.allSettled(worlds.allWorlds().filter((w) => w.base).map((w) => catchUp(w)));
  }

  return {
    start() { loop(); }, stop() { stopped = true; }, shutdown, ensureWorld, submit, publishChat, publishToPlayer,
    snapshotAll, maintenance, flushAppends, catchUp, pollOnce, stats,
    markPresenceDirty(world) { if (world) world.presenceDirty = true; },
    remotePlayers(world) { return world && world.remote ? [...world.remote.values()] : []; },
  };
}

module.exports = { createWorldSync };
