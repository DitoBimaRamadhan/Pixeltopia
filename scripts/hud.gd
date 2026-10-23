extends CanvasLayer
## Hotbar + craft + selected item + pause/save for Pixeltopia.

const RecipesData = preload("res://scripts/recipes.gd")

@onready var inv: Node = get_parent().get_node("Inventory")
@onready var player: Node2D = get_parent().get_node("Player")
@onready var weather: CanvasModulate = get_parent().get_node("Weather")
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
var weather_open: bool = false
var backpack_open: bool = false
var avatar_open: bool = false
var _backpack_pick: int = -1  ## selected backpack/hotbar index for swap

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
	_setup_weather_ui()
	_setup_avatar_ui()
	_setup_backpack_ui()
	if player.has_signal("weather_machine_used"):
		player.weather_machine_used.connect(open_weather)

func _on_inv_changed() -> void:
	_rebuild_hotbar()
	if craft_open:
		_rebuild_craft_list()
	if backpack_open:
		_rebuild_backpack()

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
		if event.keycode == KEY_B and not paused:
			if backpack_open:
				close_backpack()
			else:
				open_backpack()
			get_viewport().set_input_as_handled()
			return
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
			elif weather_open:
				close_weather()
			elif backpack_open:
				close_backpack()
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
	pause_changed.emit(paused or craft_open or weather_open or backpack_open or avatar_open)

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


func _setup_weather_ui() -> void:
	if not has_node("Root/WeatherUI"):
		return
	$Root/WeatherUI.visible = false
	$Root/WeatherUI/Panel/VBox/BtnClose.pressed.connect(close_weather)
	$Root/WeatherUI/Panel/VBox/BtnAuto.pressed.connect(_toggle_weather_auto)
	var period_row: HBoxContainer = $Root/WeatherUI/Panel/VBox/PeriodRow
	var mood_row: HBoxContainer = $Root/WeatherUI/Panel/VBox/MoodRow
	for c in period_row.get_children():
		c.queue_free()
	for c in mood_row.get_children():
		c.queue_free()
	var periods := ["Morning", "Noon", "Afternoon", "Night"]
	for i in range(periods.size()):
		var b := Button.new()
		b.text = periods[i]
		b.custom_minimum_size = Vector2(96, 32)
		var pi := i
		b.pressed.connect(func() -> void:
			weather.set_period(pi)
			_refresh_weather_status()
			Sfx.play_ui())
		period_row.add_child(b)
	var moods := ["Clear", "Aurora", "City"]
	for i in range(moods.size()):
		var b2 := Button.new()
		b2.text = moods[i]
		b2.custom_minimum_size = Vector2(110, 32)
		var mi := i
		b2.pressed.connect(func() -> void:
			weather.set_mood(mi)
			_refresh_weather_status()
			Sfx.play_ui())
		mood_row.add_child(b2)
	weather.changed.connect(_refresh_weather_status)

func open_weather() -> void:
	if paused:
		return
	if craft_open:
		close_craft()
	weather_open = true
	if has_node("Root/WeatherUI"):
		$Root/WeatherUI.visible = true
	_refresh_weather_status()
	Sfx.play_ui()
	_emit_block_input()

func close_weather() -> void:
	weather_open = false
	if has_node("Root/WeatherUI"):
		$Root/WeatherUI.visible = false
	_emit_block_input()

func _toggle_weather_auto() -> void:
	weather.set_auto(not weather.auto_cycle)
	_refresh_weather_status()
	Sfx.play_ui()

func _refresh_weather_status() -> void:
	if not has_node("Root/WeatherUI"):
		return
	$Root/WeatherUI/Panel/VBox/Status.text = weather.label() + " — sun is the only light source"
	$Root/WeatherUI/Panel/VBox/BtnAuto.text = "Auto cycle: On" if weather.auto_cycle else "Auto cycle: Off"

func _setup_backpack_ui() -> void:
	if not has_node("Root/Backpack"):
		return
	$Root/Backpack/Panel/VBox/BtnClose.pressed.connect(close_backpack)

func open_backpack() -> void:
	if paused:
		return
	if craft_open:
		close_craft()
	if weather_open:
		close_weather()
	if avatar_open:
		close_avatar()
	backpack_open = true
	_backpack_pick = -1
	if has_node("Root/Backpack"):
		$Root/Backpack.visible = true
	_rebuild_backpack()
	Sfx.play_ui()
	_emit_block_input()

func close_backpack() -> void:
	backpack_open = false
	_backpack_pick = -1
	if has_node("Root/Backpack"):
		$Root/Backpack.visible = false
	_emit_block_input()

func _rebuild_backpack() -> void:
	if not has_node("Root/Backpack"):
		return
	var grid: GridContainer = $Root/Backpack/Panel/VBox/Grid
	var hot: HBoxContainer = $Root/Backpack/Panel/VBox/HotRow
	for c in grid.get_children():
		c.queue_free()
	for c in hot.get_children():
		c.queue_free()
	# Backpack slots
	for i in range(inv.backpack_start(), inv.slot_count()):
		var b := Button.new()
		b.custom_minimum_size = Vector2(120, 36)
		b.text = inv.label_for(i) if inv.counts[i] > 0 and inv.slots[i] >= 0 else "—"
		var idx := i
		b.pressed.connect(func() -> void: _backpack_click(idx))
		if i == _backpack_pick:
			b.modulate = Color(1.3, 1.2, 0.7)
		grid.add_child(b)
	# Hotbar targets (skip fist)
	for i in range(1, inv.hotbar_len()):
		var b2 := Button.new()
		b2.custom_minimum_size = Vector2(72, 36)
		b2.text = inv.label_for(i)
		var idx2 := i
		b2.pressed.connect(func() -> void: _backpack_click(idx2))
		if i == _backpack_pick:
			b2.modulate = Color(1.3, 1.2, 0.7)
		hot.add_child(b2)
	var st: Label = $Root/Backpack/Panel/VBox/Status
	if _backpack_pick < 0:
		st.text = "Select an item, then a hotbar slot to move it."
	else:
		st.text = "Selected slot %d — tap hotbar or another slot to swap." % _backpack_pick

func _backpack_click(idx: int) -> void:
	if idx == 0:
		return
	if _backpack_pick < 0:
		_backpack_pick = idx
		Sfx.play_ui()
		_rebuild_backpack()
		return
	if _backpack_pick == idx:
		_backpack_pick = -1
		Sfx.play_ui()
		_rebuild_backpack()
		return
	inv.swap_slots(_backpack_pick, idx)
	_backpack_pick = -1
	Sfx.play_ui()
	_rebuild_backpack()


func _setup_avatar_ui() -> void:
	if has_node("Root/Pause/Panel/BtnAvatar"):
		$Root/Pause/Panel/BtnAvatar.pressed.connect(_open_avatar_from_pause)
	if not has_node("Root/AvatarUI"):
		return
	$Root/AvatarUI/Panel/VBox/BtnClose.pressed.connect(close_avatar)
	$Root/AvatarUI/Panel/VBox/BtnSkin.pressed.connect(func() -> void:
		player.cycle_look("skin"); Sfx.play_ui())
	$Root/AvatarUI/Panel/VBox/BtnHair.pressed.connect(func() -> void:
		player.cycle_look("hair"); Sfx.play_ui())
	$Root/AvatarUI/Panel/VBox/BtnClothes.pressed.connect(func() -> void:
		player.cycle_look("clothes"); Sfx.play_ui())
	$Root/AvatarUI/Panel/VBox/BtnAccessory.pressed.connect(func() -> void:
		player.cycle_look("accessory"); Sfx.play_ui())

func _open_avatar_from_pause() -> void:
	set_paused(false)
	open_avatar()

func open_avatar() -> void:
	avatar_open = true
	if has_node("Root/AvatarUI"):
		$Root/AvatarUI.visible = true
	Sfx.play_ui()
	_emit_block_input()

func close_avatar() -> void:
	avatar_open = false
	if has_node("Root/AvatarUI"):
		$Root/AvatarUI.visible = false
	_emit_block_input()
