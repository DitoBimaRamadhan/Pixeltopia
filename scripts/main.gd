extends Node2D
## Pixeltopia Phase 1 — single-player block world + planting.

const SAVE_PATH := "user://pixeltopia_save.json"

@onready var world: Node2D = $World
@onready var inv: Node = $Inventory
@onready var player: Node2D = $Player
@onready var hud: CanvasLayer = $HUD

func _ready() -> void:
	DisplayServer.window_set_title("Pixeltopia — Phase 1 prototype")
	hud.pause_changed.connect(_on_pause)
	hud.save_requested.connect(save_game)
	hud.load_requested.connect(load_game)

func _on_pause(paused: bool) -> void:
	player.paused = paused

func save_game() -> void:
	var data := {
		"version": 1,
		"world": world.to_save(),
		"inventory": inv.to_save(),
		"player": {"x": player.global_position.x, "y": player.global_position.y},
	}
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f == null:
		hud.show_status("Save failed.")
		return
	f.store_string(JSON.stringify(data))
	f.close()
	hud.show_status("Saved to user://pixeltopia_save.json")

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
	hud.show_status("Loaded save.")
