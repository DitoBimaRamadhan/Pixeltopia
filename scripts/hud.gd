extends CanvasLayer
## Hotbar + craft + selected item + pause/save for Pixeltopia.

const RecipesData = preload("res://scripts/recipes.gd")

@onready var inv: Node = get_parent().get_node("Inventory")
@onready var player: Node2D = get_parent().get_node("Player")
@onready var bar: HBoxContainer = $Root/Hotbar
@onready var hint: Label = $Root/Hint
@onready var title: Label = $Root/Title
@onready var selected_lbl: Label = $Root/Selected
@onready var pause_panel: Control = $Root/Pause
@onready var pause_status: Label = $Root/Pause/Panel/Status
@onready var craft_panel: Control = $Root/Craft
@onready var craft_list: VBoxContainer = $Root/Craft/Panel/VBox/Scroll/List
@onready var craft_status: Label = $Root/Craft/Panel/VBox/Status

var paused: bool = false
var craft_open: bool = false

signal pause_changed(paused: bool)
signal save_requested
signal load_requested

func _ready() -> void:
	title.text = "Pixeltopia"
	hint.text = "A/D move · W/Space jump · LMB punch/harvest · RMB place · 1-7 hotbar · C craft · B backpack · Esc pause · Touch pads on mobile"
	inv.changed.connect(_on_inv_changed)
	pause_panel.visible = false
	craft_panel.visible = false
	$Root/Pause/Panel/BtnResume.pressed.connect(_resume)
	$Root/Pause/Panel/BtnCraft.pressed.connect(_open_craft_from_pause)
	$Root/Pause/Panel/BtnSave.pressed.connect(_on_save)
	$Root/Pause/Panel/BtnLoad.pressed.connect(_on_load)
	if has_node("Root/Pause/Panel/BtnMute"):
		$Root/Pause/Panel/BtnMute.pressed.connect(_on_mute)
		_refresh_mute_label()
	$Root/Craft/Panel/VBox/BtnClose.pressed.connect(close_craft)
	_rebuild_hotbar()
	_rebuild_craft_list()
	_setup_touch()

func _on_inv_changed() -> void:
	_rebuild_hotbar()
	if craft_open:
		_rebuild_craft_list()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_WHEEL_UP:
			inv.select((inv.selected - 1 + inv.hotbar_len()) % inv.hotbar_len())
			Sfx.play_ui()
			get_viewport().set_input_as_handled()
			return
		if mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			inv.select((inv.selected + 1) % inv.hotbar_len())
			Sfx.play_ui()
			get_viewport().set_input_as_handled()
			return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_C and not paused:
			if craft_open:
				close_craft()
			else:
				open_craft()
			get_viewport().set_input_as_handled()
			return
		if event.keycode == KEY_ESCAPE:
			if craft_open:
				close_craft()
			else:
				set_paused(not paused)
			get_viewport().set_input_as_handled()

func set_paused(v: bool) -> void:
	paused = v
	pause_panel.visible = paused
	if paused:
		if craft_open:
			_set_craft_visible(false)
		pause_status.text = "Paused — progress saves to user://pixeltopia_save.json"
		_refresh_mute_label()
		Sfx.play_ui()
	_emit_block_input()

func _resume() -> void:
	set_paused(false)

func _on_save() -> void:
	save_requested.emit()
	pause_status.text = "Saved."

func _on_load() -> void:
	load_requested.emit()
	pause_status.text = "Loaded (or no save found)."

func show_status(msg: String) -> void:
	pause_status.text = msg

func _open_craft_from_pause() -> void:
	set_paused(false)
	open_craft()

func open_craft() -> void:
	_set_craft_visible(true)
	_rebuild_craft_list()
	craft_status.text = "Pick a recipe. Uses items from your hotbar."
	Sfx.play_ui()
	_emit_block_input()

func close_craft() -> void:
	_set_craft_visible(false)
	_emit_block_input()

func _set_craft_visible(v: bool) -> void:
	craft_open = v
	craft_panel.visible = v

func _emit_block_input() -> void:
	pause_changed.emit(paused or craft_open)

func _rebuild_hotbar() -> void:
	for c in bar.get_children():
		c.queue_free()
	for i in range(inv.hotbar_len()):
		var b := Button.new()
		b.custom_minimum_size = Vector2(72, 40)
		b.toggle_mode = true
		b.button_pressed = (i == inv.selected)
		b.text = inv.label_for(i)
		var idx := i
		b.pressed.connect(func() -> void:
			inv.select(idx)
			Sfx.play_ui())
		if i == inv.selected:
			b.modulate = Color(1.25, 1.2, 0.85)
		else:
			b.modulate = Color(1.05, 1.05, 1.0)
		bar.add_child(b)
	selected_lbl.text = "Selected: %s" % inv.selected_name()

func _rebuild_craft_list() -> void:
	for c in craft_list.get_children():
		c.queue_free()
	for recipe in RecipesData.all():
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		var info := VBoxContainer.new()
		info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var name_lbl := Label.new()
		name_lbl.text = str(recipe["name"])
		name_lbl.add_theme_font_size_override("font_size", 16)
		name_lbl.add_theme_color_override("font_color", Color(1.0, 0.95, 0.75))
		var blurb := Label.new()
		blurb.text = str(recipe.get("blurb", ""))
		blurb.add_theme_font_size_override("font_size", 12)
		blurb.add_theme_color_override("font_color", Color(0.85, 0.9, 1.0))
		info.add_child(name_lbl)
		info.add_child(blurb)
		var btn := Button.new()
		btn.text = "Craft"
		btn.custom_minimum_size = Vector2(88, 36)
		var can: bool = inv.can_afford(recipe.get("ingredients", []))
		btn.disabled = not can
		btn.modulate = Color(0.55, 1.0, 0.65) if can else Color(0.7, 0.7, 0.7)
		var r: Dictionary = recipe
		btn.pressed.connect(func() -> void: _craft(r))
		row.add_child(info)
		row.add_child(btn)
		craft_list.add_child(row)

func _craft(recipe: Dictionary) -> void:
	if inv.try_craft(recipe):
		craft_status.text = "Crafted %s ×%d!" % [str(recipe["name"]), int(recipe.get("result_count", 1))]
		Sfx.play_craft()
	else:
		craft_status.text = "Not enough materials."
		Sfx.play_ui()
	_rebuild_craft_list()


func _on_mute() -> void:
	Sfx.toggle_mute()
	_refresh_mute_label()
	Sfx.play_ui()

func _refresh_mute_label() -> void:
	if not has_node("Root/Pause/Panel/BtnMute"):
		return
	$Root/Pause/Panel/BtnMute.text = "Unmute SFX" if Sfx.muted else "Mute SFX"


func _setup_touch() -> void:
	if not has_node("Root/TouchPad"):
		return
	var left: Button = $Root/TouchPad/BtnLeft
	var right: Button = $Root/TouchPad/BtnRight
	var jump: Button = $Root/TouchPad/BtnJump
	var punch: Button = $Root/TouchPad/BtnPunch
	var place: Button = $Root/TouchPad/BtnPlace
	var prev: Button = $Root/TouchPad/BtnHotPrev
	var nextb: Button = $Root/TouchPad/BtnHotNext
	# Hold-to-move
	left.button_down.connect(func() -> void: player.set_touch_dir(-1.0))
	left.button_up.connect(func() -> void: player.set_touch_dir(0.0))
	right.button_down.connect(func() -> void: player.set_touch_dir(1.0))
	right.button_up.connect(func() -> void: player.set_touch_dir(0.0))
	jump.pressed.connect(func() -> void:
		player.request_touch_jump()
		Sfx.play_ui())
	punch.pressed.connect(_touch_punch)
	place.pressed.connect(_touch_place)
	prev.pressed.connect(func() -> void:
		inv.select((inv.selected - 1 + inv.hotbar_len()) % inv.hotbar_len())
		Sfx.play_ui())
	nextb.pressed.connect(func() -> void:
		inv.select((inv.selected + 1) % inv.hotbar_len())
		Sfx.play_ui())

func _touch_punch() -> void:
	var ahead := player.global_position + Vector2(player.facing * Tiles.SIZE * 1.2, 0)
	player.touch_punch_at(ahead)
	Sfx.play_ui()

func _touch_place() -> void:
	var ahead := player.global_position + Vector2(player.facing * Tiles.SIZE * 1.2, 0)
	player.touch_place_at(ahead)
	Sfx.play_ui()
