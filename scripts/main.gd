extends Node2D
## Pixeltopia — single-player sandbox + shop/quests/drops.

const SAVE_PATH := "user://pixeltopia_save.json"

@onready var world: Node2D = $World
@onready var inv: Node = $Inventory
@onready var player: Node2D = $Player
@onready var hud: CanvasLayer = $HUD
@onready var weather: CanvasModulate = $Weather
@onready var quests: Node = $QuestLog

var dirty: bool = false

func _ready() -> void:
	var _who := Session.username if Session and Session.username else "player"
	var _mode := "offline" if Session and Session.offline_mode else "online"
	DisplayServer.window_set_title("Pixeltopia — v0.8 (%s / %s)" % [_who, _mode])
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

func _mark_dirty() -> void:
	dirty = true
	if hud.has_method("set_dirty"):
		hud.set_dirty(true)

func _on_crops_harvested(n: int) -> void:
	quests.report("harvest_crops", n)

func notify_planted() -> void:
	quests.report("plant_seeds", 1)

func _on_pause(paused: bool) -> void:
	player.paused = paused

func save_game() -> void:
	var data := {
		"version": 4,
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
	hud.show_status("Saved (v4) — gems, drops, quests included.")

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
