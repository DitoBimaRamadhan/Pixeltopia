extends Node2D
## Pixeltopia — sandbox + multiplayer (shared server).

const SAVE_PATH := "user://pixeltopia_save.json"

@onready var world: Node2D = $World
@onready var inv: Node = $Inventory
@onready var player: Node2D = $Player
@onready var hud: CanvasLayer = $HUD
@onready var weather: CanvasModulate = $Weather
@onready var quests: Node = $QuestLog
@onready var progress: Node = $Progress
@onready var achievements: Node = $AchievementLog

var dirty: bool = false
var net: Node = null
var remotes: Node2D = null
var _mp_chat_log: PackedStringArray = PackedStringArray()
var _trade: Dictionary = {}
var _rain_secs: float = 0.0
var _night_logged: bool = false
var _profile_ready: bool = false
var _profile_cd: float = 0.0
const PROFILE_SAVE_SECS := 20.0

func _ready() -> void:
	var _who := Session.username if Session and Session.username else "player"
	var _mode := "offline" if Session and Session.offline_mode else "online"
	DisplayServer.window_set_title("Pixeltopia — v%s (%s / %s)" % [str(ProjectSettings.get_setting("application/config/version", "")), _who, _mode])
	hud.pause_changed.connect(_on_pause)
	hud.save_requested.connect(save_game)
	hud.load_requested.connect(load_game)
	if player.has_signal("world_edited"):
		player.world_edited.connect(_mark_dirty)
	if player.has_signal("crops_harvested"):
		player.crops_harvested.connect(_on_crops_harvested)
	world.world_changed.connect(_mark_dirty)
	inv.changed.connect(_mark_dirty)
	hud.bind_main(self)
	if inv.has_signal("gems_changed"):
		inv.gems_changed.connect(_on_gems_for_badge)
	if world.has_signal("tile_broken"):
		world.tile_broken.connect(func(_p): _on_block_broken())
	if progress.has_signal("leveled_up"):
		progress.leveled_up.connect(_on_leveled_up)
	if progress.has_signal("xp_changed"):
		progress.xp_changed.connect(func(lv, xp, need):
			if hud.has_method("set_xp_label"):
				hud.set_xp_label(lv, xp, need)
			achievements.report("reach_level", lv)
		)
	if achievements.has_signal("unlocked"):
		achievements.unlocked.connect(func(id, title):
			if hud.has_method("toast_badge"):
				hud.toast_badge(title)
		)
	if weather.has_signal("changed"):
		weather.changed.connect(_on_weather_changed)
	# Apply GT-inspired theme once HUD is ready
	if hud.has_method("apply_pixeltopia_theme"):
		hud.apply_pixeltopia_theme()
	if hud.has_method("set_xp_label"):
		hud.set_xp_label(progress.level, progress.xp, progress.xp_to_next())
	_setup_multiplayer()
	_rain_secs = 0.0

func _setup_multiplayer() -> void:
	remotes = Node2D.new()
	remotes.name = "RemotePlayers"
	remotes.z_index = 9
	remotes.set_script(load("res://scripts/net/remote_players.gd"))
	add_child(remotes)
	if Session.offline_mode:
		if hud.has_method("set_mp_status"):
			hud.set_mp_status("Offline")
		return
	if hud.has_method("set_online_mode"):
		hud.set_online_mode(true)
	net = Node.new()
	net.name = "GameSocket"
	net.set_script(load("res://scripts/net/game_socket.gd"))
	add_child(net)
	if player.has_method("set_net"):
		player.set_net(net)
	net.connected.connect(_on_net_connected)
	net.disconnected.connect(func ():
		if hud.has_method("set_mp_status"):
			hud.set_mp_status("Perlu update" if net.update_url != "" else ("Login di perangkat lain" if net.was_kicked else "Disconnected"))
	)
	net.world_state.connect(_on_world_state)
	net.tile_update.connect(_on_tile_update)
	net.tile_hit.connect(func (m):
		world.set_hit(int(m.get("x", -1)), int(m.get("y", -1)), int(m.get("hits", 0)), int(m.get("need", 0)))
	)
	net.snap.connect(func (arr): remotes.apply_snap(arr))
	net.player_join.connect(func (p): remotes.add_player(p))
	net.player_left.connect(func (m): remotes.remove_player(str(m.get("id", ""))))
	net.chat_message.connect(_on_chat)
	net.profile_loaded.connect(_on_profile_loaded)
	net.trade_event.connect(_on_trade)
	net.inv_state.connect(_on_inv_state)
	net.inv_result.connect(_on_inv_result)
	net.reward.connect(_on_reward)
	net.plant_update.connect(_on_plant_update)
	net.quest_state.connect(_on_quest_state)
	net.update_required.connect(func (m, url):
		if hud.has_method("show_update_required"):
			hud.show_update_required(m, url)
		if hud.has_method("set_mp_status"):
			hud.set_mp_status("Perlu update")
	)
	world.online_growth = true
	net.net_error.connect(func (m):
		if hud.has_method("show_status"):
			hud.show_status(m)
	)
	net.connect_to_session()
	if hud.has_method("bind_net"):
		hud.bind_net(net, remotes)

func _profile_dict() -> Dictionary:
	return {
		"inventory": inv.to_save(),
		"progress": progress.to_save(),
		"achievements": achievements.to_save(),
		"quests": quests.to_save(),
		"avatar": player.look_to_save(),
	}

## Server sent this account's cloud profile (or {} for a brand-new account).
func _on_profile_loaded(profile: Dictionary) -> void:
	if not profile.is_empty():
		if profile.has("inventory"):
			inv.from_save(profile["inventory"])
		if profile.has("progress"):
			progress.from_save(profile["progress"])
		if profile.has("achievements"):
			achievements.from_save(profile["achievements"])
		if profile.has("quests"):
			quests.from_save(profile["quests"])
		if profile.has("avatar"):
			player.set_look_from_dict(profile["avatar"])
		if hud.has_method("set_xp_label"):
			hud.set_xp_label(progress.level, progress.xp, progress.xp_to_next())
		if hud.has_method("show_status"):
			hud.show_status("Profil online dimuat (Lv %d)." % progress.level)
	_profile_ready = true
	_push_profile(true)

func _push_profile(now: bool = false) -> void:
	if net == null or not is_instance_valid(net) or not _profile_ready or not net.online:
		return
	net.save_profile(_profile_dict(), now)
	_profile_cd = PROFILE_SAVE_SECS

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_APPLICATION_PAUSED \
			or what == NOTIFICATION_WM_GO_BACK_REQUEST or what == NOTIFICATION_EXIT_TREE:
		_push_profile(true)

func _on_net_connected() -> void:
	if hud.has_method("set_mp_status"):
		hud.set_mp_status("Online — joining…")
	var wname := str(Session.selected_server.get("world", "START"))
	net.join_world(wname, true)
	net.sync_inventory(inv)

## v1.7: the server's wallet (account or guest session kit) is the source of truth online.
func _on_inv_state(data: Dictionary) -> void:
	var first: bool = not inv.server_mode
	inv.apply_server_state(data.get("items", {}), int(data.get("gems", 0)))
	if first:
		net.request_quest_state()

func _on_inv_result(data: Dictionary) -> void:
	if hud.has_method("on_inv_result"):
		hud.on_inv_result(data)
	if not bool(data.get("ok", false)):
		return
	match str(data.get("op", "")):
		"splice":
			notify_spliced()
			net.request_quest_state()
		"quest_claim":
			quests.mark_claimed(str(data.get("qid", "")))
			net.request_quest_state()

func _on_reward(data: Dictionary) -> void:
	if str(data.get("world", net.current_world)) != net.current_world:
		return
	if player.has_method("show_server_reward"):
		player.show_server_reward(data)
	if bool(data.get("harvest", false)):
		_on_crops_harvested(1)
		net.request_quest_state()

func _on_plant_update(data: Dictionary) -> void:
	world.set_plant_ready_in(int(data.get("x", -1)), int(data.get("y", -1)), float(data.get("readyIn", 0)), bool(data.get("boosted", false)))
	if str(data.get("by", "")) == net.my_id and player.has_method("_spawn_float"):
		player._spawn_float("Fertilized!", Color(0.6, 0.95, 0.4))

func _on_quest_state(data: Dictionary) -> void:
	if data.has("progress"):
		quests.apply_server_state(data.get("progress", {}), data.get("claimed", []))

func _on_world_state(data: Dictionary) -> void:
	var grid: Array = data.get("grid", [])
	if grid.size() == world.W * world.H:
		for i in range(grid.size()):
			world.grid[i] = int(grid[i])
		world.plant_times.clear()
		world.grow_boost.clear()
		world.drops.clear()
		# Seed grow times from the server (index -> ms until ready); seeds without one are mature.
		var plants: Dictionary = data.get("plants", {}) if typeof(data.get("plants", {})) == TYPE_DICTIONARY else {}
		if net.server_inv or not plants.is_empty():
			for i in range(grid.size()):
				if Tiles.is_seed(world.grid[i]):
					world.set_plant_ready_in(i % world.W, i / world.W, float(plants.get(str(i), 0)))
		if data.has("spawn"):
			var sp: Dictionary = data["spawn"]
			world.spawn_tile = Vector2i(int(sp.get("x", 32)), int(sp.get("y", 10)))
		world.world_changed.emit()
		world.queue_redraw()
		player.apply_save_pos(Vector2(
			world.spawn_tile.x * Tiles.SIZE + Tiles.SIZE * 0.5,
			world.spawn_tile.y * Tiles.SIZE
		))
	remotes.clear_all()
	for p in data.get("players", []):
		if str(p.get("i", "")) == net.my_id:
			continue
		remotes.add_player(p)
	var lock := ""
	if str(data.get("lockOwnerName", "")) != "":
		lock = " 🔒 %s" % data.get("lockOwnerName")
	if hud.has_method("set_mp_status"):
		hud.set_mp_status("World %s%s" % [data.get("name", "?"), lock])
	net.sync_inventory(inv)

func _on_tile_update(data: Dictionary) -> void:
	var x := int(data.get("x", -1))
	var y := int(data.get("y", -1))
	var id := int(data.get("id", 0))
	if world.in_bounds(x, y):
		world.set_tile(x, y, id)
		if data.has("readyIn"):
			world.set_plant_ready_in(x, y, float(data.get("readyIn", 0)))
		if Tiles.is_seed(id) and str(data.get("by", "")) == net.my_id and net.server_inv:
			net.request_quest_state()
	var lock_n := str(data.get("lockOwnerName", "") or "")
	if hud.has_method("set_mp_status") and net:
		var lock := (" 🔒 %s" % lock_n) if lock_n != "" else ""
		hud.set_mp_status("World %s%s" % [net.current_world, lock])

func _on_chat(data: Dictionary) -> void:
	var line := "%s: %s" % [data.get("from", "?"), data.get("text", "")]
	_mp_chat_log.append(line)
	if _mp_chat_log.size() > 40:
		_mp_chat_log = _mp_chat_log.slice(_mp_chat_log.size() - 40)
	if hud.has_method("append_chat"):
		hud.append_chat(line)

func _on_trade(data: Dictionary) -> void:
	_trade = data
	if hud.has_method("on_trade_event"):
		hud.on_trade_event(data)
	# Apply inventory deltas on completed (pre-v1.7 servers only; with serverInv the new
	# wallet arrives as an `inv` message instead).
	if str(data.get("event", "")) == "completed" and net:
		progress.report_trade()
		achievements.report("trade_done", 1)
		var _sfx = get_node_or_null("/root/Sfx")
		if _sfx and _sfx.has_method("play_trade"):
			_sfx.play_trade()
		if bool(data.get("serverInv", false)) or net.server_inv:
			return
		var take: Dictionary = data.get("take", {}).get(net.my_id, {})
		var give: Dictionary = data.get("give", {}).get(net.my_id, {})
		for it in take.get("items", []):
			inv.consume_item(int(it.get("id", -1)), int(it.get("n", 1)))
		if int(take.get("gems", 0)) > 0:
			inv.spend_gems(int(take.get("gems", 0)))
		for it in give.get("items", []):
			inv.add_item(int(it.get("id", -1)), int(it.get("n", 1)))
		if int(give.get("gems", 0)) > 0:
			inv.add_gems(int(give.get("gems", 0)))
		net.sync_inventory(inv)

func _process(delta: float) -> void:
	if _profile_ready:
		_profile_cd -= delta
		if _profile_cd <= 0.0:
			_push_profile(false)
	if net and net.is_online():
		var t: Vector2i = world.world_to_tile(player.global_position)
		net.send_move(t.x, t.y, player.global_position.x, player.global_position.y)
	if weather and weather.has_method("is_raining") and weather.is_raining():
		_rain_secs += delta
		if _rain_secs >= 1.0:
			var whole := int(_rain_secs)
			_rain_secs -= float(whole)
			achievements.report("rain_time", whole)
	if weather and int(weather.period) == 3 and not _night_logged:
		_night_logged = true
		achievements.report("night_seen", 1)
	elif weather and int(weather.period) != 3:
		_night_logged = false

func _mark_dirty() -> void:
	dirty = true
	if hud.has_method("set_dirty"):
		hud.set_dirty(true)

func _on_crops_harvested(n: int) -> void:
	quests.report("harvest_crops", n)
	achievements.report("harvest_crops", n)
	progress.report_harvest()

func _on_block_broken() -> void:
	achievements.report("break_blocks", 1)
	progress.report_break()

func _on_leveled_up(lv: int) -> void:
	if hud.has_method("show_status"):
		hud.show_status("Level up! Now Lv %d" % lv)
	achievements.report("reach_level", lv)

func _on_gems_for_badge(amount: int) -> void:
	achievements.report("gems_held", amount)

func _on_weather_changed() -> void:
	if hud.has_method("refresh_clock"):
		hud.refresh_clock()

func notify_planted() -> void:
	quests.report("plant_seeds", 1)

func notify_spliced() -> void:
	quests.report("splice_seeds", 1)
	achievements.report("splice_seeds", 1)
	progress.report_splice()
	var _sfx = get_node_or_null("/root/Sfx")
	if _sfx and _sfx.has_method("play_splice"):
		_sfx.play_splice()

func _on_pause(paused: bool) -> void:
	player.paused = paused

func save_game() -> void:
	var data := {
		"version": 6,
		"world": world.to_save(),
		"inventory": inv.to_save(),
		"player": {
			"x": player.global_position.x,
			"y": player.global_position.y,
			"avatar": player.look_to_save(),
		},
		"weather": weather.to_save(),
		"quests": quests.to_save(),
		"progress": progress.to_save(),
		"achievements": achievements.to_save(),
	}
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f == null:
		hud.show_status("Save failed.")
		return
	f.store_string(JSON.stringify(data))
	f.close()
	dirty = false
	if hud.has_method("set_dirty"):
		hud.set_dirty(false)
	hud.show_status("Saved (v6).")

func load_game() -> void:
	if net != null:
		## v1.7: online the server owns the world + inventory; a local save cannot be loaded over it.
		hud.show_status("Load hanya di mode offline.")
		return
	if not FileAccess.file_exists(SAVE_PATH):
		hud.show_status("No save file yet.")
		return
	var f := FileAccess.open(SAVE_PATH, FileAccess.READ)
	if f == null:
		hud.show_status("Could not read save.")
		return
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	f.close()
	if typeof(parsed) != TYPE_DICTIONARY:
		hud.show_status("Corrupt save.")
		return
	var data: Dictionary = parsed
	if data.has("world"):
		world.from_save(data["world"])
	if data.has("inventory"):
		inv.from_save(data["inventory"])
	if data.has("player"):
		var p: Dictionary = data["player"]
		player.apply_save_pos(Vector2(float(p.get("x", 0)), float(p.get("y", 0))))
		if p.has("avatar"):
			player.set_look_from_dict(p["avatar"])
	if data.has("weather"):
		weather.from_save(data["weather"])
	if data.has("quests"):
		quests.from_save(data["quests"])
	if data.has("progress"):
		progress.from_save(data["progress"])
	if data.has("achievements"):
		achievements.from_save(data["achievements"])
	if hud.has_method("set_xp_label"):
		hud.set_xp_label(progress.level, progress.xp, progress.xp_to_next())
	dirty = false
	if hud.has_method("set_dirty"):
		hud.set_dirty(false)
	hud.show_status("Loaded save.")
