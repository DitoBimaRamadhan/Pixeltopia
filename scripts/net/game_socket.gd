extends Node
## WebSocket client for Pixeltopia shared multiplayer server.
signal connected
signal disconnected
signal welcome(data: Dictionary)
signal world_state(data: Dictionary)
signal worlds_list(worlds: Array)
signal tile_update(data: Dictionary)
signal snap(players: Array)
signal player_join(data: Dictionary)
signal player_left(data: Dictionary)
signal chat_message(data: Dictionary)
signal trade_event(data: Dictionary)
signal net_error(message: String)
signal left_world
signal profile_loaded(profile: Dictionary)
## v1.7 server-authoritative inventory (SERVER_INV): the server's wallet is the truth online.
signal inv_state(data: Dictionary)
signal inv_result(data: Dictionary)
signal reward(data: Dictionary)
signal plant_update(data: Dictionary)
signal quest_state(data: Dictionary)
signal update_required(message: String, url: String)
signal tile_hit(data: Dictionary)  ## v1.8 server break progress {x, y, id, hits, need, by}
signal social_msg(data: Dictionary)  ## v1.8 daily_state / leaderboard / friends / friend_event / pm / pm_thread / social_error
signal world_settings(settings: Dictionary, by: String)  ## v1.8 owner changed {open, bg, welcome}

const CLIENT_PROTO := 4  ## v1.8.0: daily, friends/PM, leaderboard, world settings, content pack

var is_guest: bool = true
var storage: String = ""

var _peer: WebSocketPeer = WebSocketPeer.new()
var _active: bool = false
var my_id: String = ""
var my_username: String = ""
var current_world: String = ""
var lock_owner_id: String = ""
var lock_owner_name: String = ""
var online: bool = false
var was_kicked: bool = false
var _move_cd: float = 0.0
var _inv_cd: float = 0.0
## True once the server sent an `inv` message: it owns the inventory (no more inv_sync).
var server_inv: bool = false
var _inv_ver: int = 0
var _req_seq: int = 0
var update_url: String = ""
var current_settings: Dictionary = {}  ## v1.8 world settings of current_world

func is_online() -> bool:
	return online and _active and current_world != ""

func connect_to_session() -> void:
	if Session.offline_mode:
		online = false
		return
	var s: Dictionary = Session.selected_server
	if s.is_empty() or str(s.get("id", "")) == "offline":
		online = false
		return
	var base := Session.api_base_url.strip_edges()
	var ws_base := base.replace("https://", "wss://").replace("http://", "ws://")
	if ws_base.is_empty():
		ws_base = "ws://127.0.0.1:8787"
	var path := str(s.get("wsPath", "/ws?shard=%s" % str(s.get("id", "gateway-1"))))
	var url := "%s%s" % [ws_base.rstrip("/"), path]
	if url.find("token=") < 0:
		url += ("&" if url.find("?") >= 0 else "?") + "token=%s" % Session.token.uri_encode()
	if url.find("proto=") < 0:
		url += ("&" if url.find("?") >= 0 else "?") + "proto=%d" % CLIENT_PROTO
	server_inv = false
	_inv_ver = 0
	_peer = WebSocketPeer.new()
	var err := _peer.connect_to_url(url)
	if err != OK:
		net_error.emit("WS connect failed: %s" % err)
		online = false
		return
	_active = true

func disconnect_socket() -> void:
	_active = false
	online = false
	current_world = ""
	if _peer:
		_peer.close()
	disconnected.emit()

func _process(delta: float) -> void:
	if not _active:
		return
	_peer.poll()
	var st := _peer.get_ready_state()
	if st == WebSocketPeer.STATE_OPEN:
		if not online:
			online = true
			connected.emit()
		while _peer.get_available_packet_count() > 0:
			_handle(_peer.get_packet().get_string_from_utf8())
	elif st == WebSocketPeer.STATE_CLOSED:
		if online or _active:
			_active = false
			online = false
			disconnected.emit()
	_move_cd = maxf(_move_cd - delta, 0.0)
	_inv_cd = maxf(_inv_cd - delta, 0.0)

func _handle(raw: String) -> void:
	var data: Variant = JSON.parse_string(raw)
	if typeof(data) != TYPE_DICTIONARY:
		return
	var msg: Dictionary = data
	match str(msg.get("t", "")):
		"welcome":
			var you: Dictionary = msg.get("you", {})
			my_id = str(you.get("id", ""))
			my_username = str(you.get("username", Session.username))
			is_guest = bool(you.get("guest", false))
			_inv_ver = 0
			storage = str(msg.get("storage", ""))
			welcome.emit(msg)
			var prof: Variant = msg.get("profile", null)
			profile_loaded.emit(prof if typeof(prof) == TYPE_DICTIONARY else {})
			if msg.has("worlds"):
				worlds_list.emit(msg["worlds"])
		"world_state":
			current_world = str(msg.get("name", ""))
			lock_owner_id = str(msg.get("lockOwnerId", "") or "")
			lock_owner_name = str(msg.get("lockOwnerName", "") or "")
			var ws: Variant = msg.get("settings", {})
			current_settings = ws if typeof(ws) == TYPE_DICTIONARY else {}
			world_state.emit(msg)
		"worlds":
			worlds_list.emit(msg.get("worlds", []))
		"tile":
			if msg.has("lockOwnerId"):
				lock_owner_id = str(msg.get("lockOwnerId", "") or "")
				lock_owner_name = str(msg.get("lockOwnerName", "") or "")
			tile_update.emit(msg)
		"hit":
			tile_hit.emit(msg)
		"snap":
			snap.emit(msg.get("n", []))
		"player_join":
			player_join.emit(msg.get("player", msg))
		"player_left":
			player_left.emit(msg)
		"chat":
			chat_message.emit(msg)
		"trade":
			trade_event.emit(msg)
		"error":
			net_error.emit(str(msg.get("error", "error")))
		"left_world":
			current_world = ""
			left_world.emit()
		"world_lock":
			# Lock owner changed without a tile change (multi-server correction).
			lock_owner_id = str(msg.get("lockOwnerId", "") or "")
			lock_owner_name = str(msg.get("lockOwnerName", "") or "")
			tile_update.emit({"x": -1, "y": -1, "id": 0, "lockOwnerId": msg.get("lockOwnerId", null), "lockOwnerName": msg.get("lockOwnerName", null)})
		"kicked":
			# Same account logged in elsewhere (or this APK is too old): show why, close, do not reconnect.
			was_kicked = true
			if str(msg.get("reason", "")) != "update_required":
				net_error.emit(str(msg.get("error", "Akun ini login dari perangkat lain.")))
			disconnect_socket()
		"update_required":
			was_kicked = true
			update_url = str(msg.get("url", ""))
			update_required.emit(str(msg.get("error", "Versi game kamu sudah lama. Silakan update.")), update_url)
		"inv":
			var ver := int(msg.get("ver", 0))
			if ver < _inv_ver and not bool(msg.get("guest", false)):
				return  # an older state arrived late
			_inv_ver = ver
			server_inv = true
			inv_state.emit(msg)
		"inv_result":
			inv_result.emit(msg)
		"reward":
			reward.emit(msg)
		"plant":
			plant_update.emit(msg)
		"quest_state":
			quest_state.emit(msg)
		"daily_state", "leaderboard", "friends", "friend_event", "pm", "pm_thread", "social_error":
			social_msg.emit(msg)
		"world_settings":
			var st: Variant = msg.get("settings", {})
			current_settings = st if typeof(st) == TYPE_DICTIONARY else {}
			world_settings.emit(current_settings, str(msg.get("by", "")))

func send_social(t: String, fields: Dictionary = {}) -> void:
	var d := fields.duplicate()
	d["t"] = t
	send_dict(d)

func set_world_settings(settings: Dictionary) -> void:
	send_dict({"t": "world_settings_set", "settings": settings})

func send_dict(d: Dictionary) -> void:
	if not online:
		return
	_peer.send_text(JSON.stringify(d))

func list_worlds() -> void:
	send_dict({"t": "list_worlds"})

func create_world(wname: String) -> void:
	send_dict({"t": "create_world", "name": wname})

func join_world(wname: String, create_if_missing: bool = false) -> void:
	send_dict({"t": "join_world", "name": wname, "create": create_if_missing})

func travel(wname: String) -> void:
	send_dict({"t": "travel", "name": wname, "create": false})

func send_move(tx: int, ty: int, px: float = 0.0, py: float = 0.0) -> void:
	if _move_cd > 0.0:
		return
	_move_cd = 0.05
	send_dict({"t": "move", "tx": tx, "ty": ty, "px": px, "py": py, "seq": Time.get_ticks_msec()})

func send_punch(x: int, y: int) -> void:
	send_dict({"t": "punch", "x": x, "y": y})

func send_place(x: int, y: int, id: int) -> void:
	send_dict({"t": "place", "x": x, "y": y, "id": id})

func send_fertilize(x: int, y: int) -> void:
	send_dict({"t": "fertilize", "x": x, "y": y})

## craft {recipe} · splice {a, b} · shop_buy {id, n} · shop_sell {id, n} · quest_claim {qid} · quest_state
## The server answers {t:'inv_result', op, req, ok, error?} plus a fresh {t:'inv'}.
func send_inv_request(op: String, fields: Dictionary = {}) -> int:
	_req_seq += 1
	var d := fields.duplicate()
	d["t"] = op
	d["req"] = _req_seq
	send_dict(d)
	return _req_seq

func request_quest_state() -> void:
	if server_inv and not is_guest:
		send_dict({"t": "quest_state"})

func send_chat(text: String) -> void:
	send_dict({"t": "chat", "text": text})

## Legacy (pre-v1.7 servers only): report the local inventory. Once the server owns the
## inventory (`inv` received) this is never sent — the server would ignore it anyway.
func sync_inventory(inv: Node) -> void:
	if server_inv or _inv_cd > 0.0 or inv == null:
		return
	_inv_cd = 1.0
	var items := {}
	for i in range(1, inv.slots.size()):
		var id: int = int(inv.slots[i])
		var n: int = int(inv.counts[i])
		if id >= 0 and n > 0:
			items[str(id)] = int(items.get(str(id), 0)) + n
	send_dict({"t": "inv_sync", "items": items, "gems": inv.gems})

## Cloud save of the account profile (inventory/backpack, XP, badges, avatar).
func save_profile(profile: Dictionary, now: bool = false) -> void:
	if is_guest:
		return
	send_dict({"t": "profile_save", "profile": profile, "now": now})

func trade_request(to_id: String) -> void:
	send_dict({"t": "trade_request", "to": to_id})

func trade_accept(tid: String = "") -> void:
	send_dict({"t": "trade_accept", "id": tid})

func trade_cancel() -> void:
	send_dict({"t": "trade_cancel"})

func trade_offer(items: Array, gems: int) -> void:
	send_dict({"t": "trade_offer", "items": items, "gems": gems})

func trade_ready(is_ready: bool = true) -> void:
	send_dict({"t": "trade_ready", "ready": is_ready})
