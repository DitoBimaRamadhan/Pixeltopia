extends Node2D
## Pixeltopia — sandbox + multiplayer (shared server).

const SAVE_PATH := "user://pixeltopia_save.json"

@onready var world: Node2D = $World
@onready var inv: Node = $Inventory
@onready var player: Node2D = $Player
@onready var hud: CanvasLayer = $HUD
@onready var weather: CanvasModulate = $Weather
@onready var quests: Node = $QuestLog

var dirty: bool = false
var net: Node = null
var remotes: Node2D = null
var _mp_chat_log: PackedStringArray = PackedStringArray()
var _trade: Dictionary = {}

func _ready() -> void:
	var _who := Session.username if Session and Session.username else "player"
	var _mode := "offline" if Session and Session.offline_mode else "online"
	DisplayServer.window_set_title("Pixeltopia — v1.5 (%s / %s)" % [_who, _mode])
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
	_setup_multiplayer()

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
	net = Node.new()
	net.name = "GameSocket"
	net.set_script(load("res://scripts/net/game_socket.gd"))
	add_child(net)
	if player.has_method("set_net"):
		player.set_net(net)
	net.connected.connect(_on_net_connected)
	net.disconnected.connect(func ():
		if hud.has_method("set_mp_status"):
			hud.set_mp_status("Disconnected")
	)
	net.world_state.connect(_on_world_state)
	net.tile_update.connect(_on_tile_update)
	net.snap.connect(func (arr): remotes.apply_snap(arr))
	net.player_join.connect(func (p): remotes.add_player(p))
	net.player_left.connect(func (m): remotes.remove_player(str(m.get("id", ""))))
	net.chat_message.connect(_on_chat)
	net.trade_event.connect(_on_trade)
	net.net_error.connect(func (m):
		if hud.has_method("show_status"):
			hud.show_status(m)
	)
	net.connect_to_session()
	if hud.has_method("bind_net"):
		hud.bind_net(net, remotes)

func _on_net_connected() -> void:
	if hud.has_method("set_mp_status"):
		hud.set_mp_status("Online — joining…")
	var wname := str(Session.selected_server.get("world", "START"))
	net.join_world(wname, true)
	net.sync_inventory(inv)

func _on_world_state(data: Dictionary) -> void:
	var grid: Array = data.get("grid", [])
	if grid.size() == world.W * world.H:
		for i in range(grid.size()):
			world.grid[i] = int(grid[i])
		world.plant_times.clear()
		world.grow_boost.clear()
		world.drops.clear()
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
	# Apply inventory deltas on completed
	if str(data.get("event", "")) == "completed" and net:
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

func _process(_delta: float) -> void:
	if net and net.is_online():
		var t: Vector2i = world.world_to_tile(player.global_position)
		net.send_move(t.x, t.y, player.global_position.x, player.global_position.y)

func _mark_dirty() -> void:
	dirty = true
	if hud.has_method("set_dirty"):
		hud.set_dirty(true)

func _on_crops_harvested(n: int) -> void:
	quests.report("harvest_crops", n)

func notify_planted() -> void:
	quests.report("plant_seeds", 1)

func notify_spliced() -> void:
	quests.report("splice_seeds", 1)

func _on_pause(paused: bool) -> void:
	player.paused = paused

func save_game() -> void:
	var data := {
		"version": 5,
		"world": world.to_save(),
		"inventory": inv.to_save(),
		"player": {
			"x": player.global_position.x,
			"y": player.global_position.y,
			"avatar": player.look_to_save(),
		},
		"weather": weather.to_save(),
		"quests": quests.to_save(),
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
	hud.show_status("Saved (v5).")

func load_game() -> void:
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
	dirty = false
	if hud.has_method("set_dirty"):
		hud.set_dirty(false)
	hud.show_status("Loaded save.")
