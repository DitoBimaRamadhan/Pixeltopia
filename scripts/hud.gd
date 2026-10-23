extends CanvasLayer
## Hotbar + craft + shop + quests + pause/save for Pixeltopia.

const Items = preload("res://scripts/items.gd")
const RecipesData = preload("res://scripts/recipes.gd")
const SplicingData = preload("res://scripts/splicing.gd")
const ItemIcon = preload("res://scripts/item_icon.gd")

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
var shop_open: bool = false
var quest_open: bool = false
var splice_open: bool = false
var _backpack_pick: int = -1
var _dirty: bool = false
var _main: Node = null
var _gems_lbl: Label = null
var _shop_root: ColorRect = null
var _shop_list: VBoxContainer = null
var _shop_status: Label = null
var _quest_root: ColorRect = null
var _quest_list: VBoxContainer = null
var _quest_status: Label = null
var _splice_root: ColorRect = null
var _splice_list: VBoxContainer = null
var _splice_status: Label = null
var _splice_a: int = -1
var _splice_b: int = -1
var _splice_pick_slot: int = 0  ## 0 = picking A, 1 = picking B

signal pause_changed(paused: bool)
signal save_requested
signal load_requested

func bind_main(main: Node) -> void:
	_main = main

func set_dirty(v: bool) -> void:
	_dirty = v

func _ready() -> void:
	title.text = "Pixeltopia"
	hint.text = "A/D move · Jump · LMB/RMB · Q/G drop · C craft · Y splice · B bag · P store · Esc · Tap bag slots to equip"
	inv.changed.connect(_on_inv_changed)
	if inv.has_signal("gems_changed"):
		inv.gems_changed.connect(_on_gems_changed)
	pause_panel.visible = false
	craft_panel.visible = false
	$Root/Pause/Panel/BtnResume.pressed.connect(_resume)
	$Root/Pause/Panel/BtnCraft.pressed.connect(_open_craft_from_pause)
	$Root/Pause/Panel/BtnSave.pressed.connect(_on_save)
	$Root/Pause/Panel/BtnLoad.pressed.connect(_on_load)
	if has_node("Root/Pause/Panel/BtnMute"):
		$Root/Pause/Panel/BtnMute.pressed.connect(_on_mute)
	if has_node("Root/Pause/Panel/BtnAvatar"):
		$Root/Pause/Panel/BtnAvatar.pressed.connect(_open_avatar_from_pause)
	_layout_pause_circles()
	_refresh_mute_label()
	$Root/Craft/Panel/VBox/BtnClose.pressed.connect(close_craft)
	$Root/Craft/Panel/VBox/BtnClose.text = "Close"
	_rebuild_hotbar()
	_rebuild_craft_list()
	_setup_touch()
	_setup_weather_ui()
	_setup_avatar_ui()
	_setup_backpack_ui()
	_setup_gems_label()
	_build_shop_ui()
	_build_quest_ui()
	_build_splice_ui()
	_add_drop_touch_btn()
	_add_splice_btn()
	_add_store_btn()
	_add_bag_btn()
	_style_static_circles()
	if player.has_signal("weather_machine_used"):
		player.weather_machine_used.connect(open_weather)
	## Store opens from HUD button / key P (Mira NPC removed).
	if player.has_signal("shop_used"):
		player.shop_used.connect(open_shop)
	if player.has_signal("quest_used"):
		player.quest_used.connect(open_quest)
	_on_gems_changed(inv.gems)

func _setup_gems_label() -> void:
	_gems_lbl = Label.new()
	_gems_lbl.name = "GemsLabel"
	_gems_lbl.position = Vector2(720, 8)
	_gems_lbl.size = Vector2(220, 28)
	_gems_lbl.add_theme_font_size_override("font_size", 16)
	_gems_lbl.add_theme_color_override("font_color", Color(0.55, 1.0, 0.85))
	_gems_lbl.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.7))
	$Root.add_child(_gems_lbl)

func _on_gems_changed(amount: int) -> void:
	if _gems_lbl:
		_gems_lbl.text = "Gems: %d" % amount

func _add_drop_touch_btn() -> void:
	if not has_node("Root/TouchPad"):
		return
	var b := UiCircle.make_button("Drop", UiCircle.TOUCH_SIZE, Color(0.55, 0.35, 0.72))
	b.name = "BtnDrop"
	b.anchor_left = 1.0
	b.anchor_top = 1.0
	b.anchor_right = 1.0
	b.anchor_bottom = 1.0
	b.offset_left = -168.0
	b.offset_top = -220.0
	b.offset_right = -96.0
	b.offset_bottom = -148.0
	b.pressed.connect(func() -> void:
		player.touch_drop()
		Sfx.play_ui())
	$Root/TouchPad.add_child(b)

func _on_inv_changed() -> void:
	_rebuild_hotbar()
	if craft_open:
		_rebuild_craft_list()
	if backpack_open:
		_rebuild_backpack()
	if shop_open:
		_rebuild_shop()
	if splice_open:
		_rebuild_splice()
	if _gems_lbl:
		_gems_lbl.text = "Gems: %d" % inv.gems

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
		if event.keycode == KEY_P and not paused:
			if shop_open:
				close_shop()
			else:
				open_shop()
			get_viewport().set_input_as_handled()
			return
		if event.keycode == KEY_Y and not paused:
			if splice_open:
				close_splice()
			else:
				open_splice()
			get_viewport().set_input_as_handled()
			return
		if event.keycode == KEY_ESCAPE:
			if craft_open:
				close_craft()
			elif weather_open:
				close_weather()
			elif backpack_open:
				close_backpack()
			elif shop_open:
				close_shop()
			elif quest_open:
				close_quest()
			elif splice_open:
				close_splice()
			elif avatar_open:
				close_avatar()
			else:
				set_paused(not paused)
			get_viewport().set_input_as_handled()

func set_paused(v: bool) -> void:
	paused = v
	pause_panel.visible = paused
	if paused:
		if craft_open:
			_set_craft_visible(false)
		var dirty_txt := "Unsaved changes — Save before quitting." if _dirty else "All changes saved (or fresh world)."
		pause_status.text = "Paused — %s\nSave: user://pixeltopia_save.json" % dirty_txt
		_refresh_mute_label()
		Sfx.play_ui()
	_emit_block_input()

func _resume() -> void:
	set_paused(false)

func _on_save() -> void:
	save_requested.emit()

func _on_load() -> void:
	load_requested.emit()

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
	pause_changed.emit(paused or craft_open or weather_open or backpack_open or avatar_open or shop_open or quest_open or splice_open)

func _rebuild_hotbar() -> void:
	for c in bar.get_children():
		c.queue_free()
	for i in range(inv.hotbar_len()):
		var cell: Control
		if i == 0:
			cell = ItemIcon.make_fist_cell(i == inv.selected)
		else:
			var id: int = inv.slots[i] if i < inv.slots.size() else -1
			var n: int = inv.counts[i] if i < inv.counts.size() else 0
			cell = ItemIcon.make_cell(id if n > 0 else -1, n, i == inv.selected)
		var idx := i
		cell.gui_input.connect(func(ev: InputEvent) -> void:
			if ev is InputEventMouseButton and ev.pressed and ev.button_index == MOUSE_BUTTON_LEFT:
				inv.select(idx)
				Sfx.play_ui())
		## Keep touch size comfortable on phones.
		cell.custom_minimum_size = Vector2(maxf(ItemIcon.CELL, 48.0), maxf(ItemIcon.CELL, 48.0))
		bar.add_child(cell)
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
		var can: bool = inv.can_afford(recipe.get("ingredients", []))
		var accent := Color(0.25, 0.7, 0.4) if can else Color(0.4, 0.42, 0.45)
		var btn := UiCircle.make_button("Craft", UiCircle.COMPACT_SIZE, accent)
		btn.disabled = not can
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
	var mute := _pause_btn("BtnMute")
	if mute == null:
		return
	mute.text = "Unmute" if Sfx.muted else "Mute"

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
		var short: String = ["AM", "Noon", "PM", "Night"][i]
		var b := UiCircle.make_button(short, UiCircle.COMPACT_SIZE, Color(0.9, 0.7, 0.2))
		b.tooltip_text = periods[i]
		var pi := i
		b.pressed.connect(func() -> void:
			weather.set_period(pi)
			_refresh_weather_status()
			Sfx.play_ui())
		period_row.add_child(b)
	var moods := ["Clear", "Aurora", "City"]
	for i in range(moods.size()):
		var b2 := UiCircle.make_button(moods[i], UiCircle.ACTION_SIZE, Color(0.35, 0.55, 0.85))
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
	_close_overlays_except("weather")
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
	$Root/WeatherUI/Panel/VBox/BtnAuto.text = "Auto On" if weather.auto_cycle else "Auto Off"

func _setup_backpack_ui() -> void:
	if not has_node("Root/Backpack"):
		return
	$Root/Backpack/Panel/VBox/BtnClose.pressed.connect(close_backpack)
	## Detail + action row (GT-like: tap slot → inspect → equip/use).
	var vbox: VBoxContainer = $Root/Backpack/Panel/VBox
	if not vbox.has_node("Detail"):
		var detail := Label.new()
		detail.name = "Detail"
		detail.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		detail.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		detail.add_theme_font_size_override("font_size", 12)
		detail.add_theme_color_override("font_color", Color(0.9, 0.95, 1.0))
		detail.text = "Tap an item to inspect. Equip puts it on your hotbar."
		var actions := HBoxContainer.new()
		actions.name = "BagActions"
		actions.alignment = BoxContainer.ALIGNMENT_CENTER
		actions.add_theme_constant_override("separation", 10)
		var equip := UiCircle.make_button("Equip", UiCircle.COMPACT_SIZE, Color(0.25, 0.65, 0.45))
		equip.name = "BtnEquip"
		equip.pressed.connect(_backpack_equip)
		var use_btn := UiCircle.make_button("Use", UiCircle.COMPACT_SIZE, Color(0.35, 0.5, 0.85))
		use_btn.name = "BtnUse"
		use_btn.pressed.connect(_backpack_use)
		var drop_btn := UiCircle.make_button("Drop", UiCircle.COMPACT_SIZE, Color(0.7, 0.4, 0.35))
		drop_btn.name = "BtnDropOne"
		drop_btn.pressed.connect(_backpack_drop_one)
		actions.add_child(equip)
		actions.add_child(use_btn)
		actions.add_child(drop_btn)
		## Insert above Status
		var status_i := vbox.get_node("Status").get_index()
		vbox.add_child(detail)
		vbox.move_child(detail, status_i)
		vbox.add_child(actions)
		vbox.move_child(actions, status_i + 1)
	## Wrap Grid in ScrollContainer for long bags.
	if vbox.has_node("Grid") and not vbox.has_node("GridScroll"):
		var grid: GridContainer = vbox.get_node("Grid")
		var idx := grid.get_index()
		vbox.remove_child(grid)
		var scroll := ScrollContainer.new()
		scroll.name = "GridScroll"
		scroll.custom_minimum_size = Vector2(0, 220)
		scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
		scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		grid.columns = 6
		grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		scroll.add_child(grid)
		vbox.add_child(scroll)
		vbox.move_child(scroll, idx)

func open_backpack() -> void:
	if paused:
		return
	_close_overlays_except("backpack")
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
	var grid: GridContainer = $Root/Backpack/Panel/VBox/GridScroll/Grid if has_node("Root/Backpack/Panel/VBox/GridScroll/Grid") else $Root/Backpack/Panel/VBox/Grid
	var hot: HBoxContainer = $Root/Backpack/Panel/VBox/HotRow
	for c in grid.get_children():
		c.queue_free()
	for c in hot.get_children():
		c.queue_free()
	## Fist always shown first in hotbar row (locked).
	var fist := ItemIcon.make_fist_cell(inv.selected == 0)
	fist.gui_input.connect(func(ev: InputEvent) -> void:
		if ev is InputEventMouseButton and ev.pressed and ev.button_index == MOUSE_BUTTON_LEFT:
			inv.select(0)
			_backpack_pick = -1
			Sfx.play_ui()
			_rebuild_backpack())
	hot.add_child(fist)
	for i in range(1, inv.hotbar_len()):
		var id: int = inv.slots[i]
		var n: int = inv.counts[i]
		var picked := (i == _backpack_pick) or (i == inv.selected)
		var cell := ItemIcon.make_cell(id if n > 0 else -1, n, picked)
		var idx2 := i
		cell.gui_input.connect(func(ev: InputEvent) -> void:
			if ev is InputEventMouseButton and ev.pressed and ev.button_index == MOUSE_BUTTON_LEFT:
				_backpack_click(idx2))
		hot.add_child(cell)
	## Backpack grid: all bag slots (item-type slots with stack counts).
	for i in range(inv.backpack_start(), inv.slot_count()):
		var idb: int = inv.slots[i]
		var nb: int = inv.counts[i]
		var picked_b := (i == _backpack_pick)
		var cell_b := ItemIcon.make_cell(idb if nb > 0 else -1, nb, picked_b)
		var idxb := i
		cell_b.gui_input.connect(func(ev: InputEvent) -> void:
			if ev is InputEventMouseButton and ev.pressed and ev.button_index == MOUSE_BUTTON_LEFT:
				_backpack_click(idxb))
		grid.add_child(cell_b)
	_refresh_backpack_detail()

func _refresh_backpack_detail() -> void:
	if not has_node("Root/Backpack/Panel/VBox/Detail"):
		return
	var detail: Label = $Root/Backpack/Panel/VBox/Detail
	var st: Label = $Root/Backpack/Panel/VBox/Status
	var title: Label = $Root/Backpack/Panel/VBox/Title
	title.text = "Pixeltopia Pack  (%d slots)" % (inv.slot_count() - 1)
	if has_node("Root/Backpack/Panel/VBox/Hint"):
		$Root/Backpack/Panel/VBox/Hint.text = "Grid = item types · number = stack (max %d) · tap to select · Equip to hotbar" % inv.MAX_STACK
	if _backpack_pick < 0:
		detail.text = "No item selected. Tap a colored slot to inspect."
		st.text = "Hotbar row below: Fist is locked. Tap two slots to swap."
		return
	var i := _backpack_pick
	if i <= 0 or i >= inv.slot_count() or inv.counts[i] <= 0 or inv.slots[i] < 0:
		detail.text = "Empty slot."
		st.text = "Pick a filled slot."
		return
	var id: int = inv.slots[i]
	detail.text = "%s ×%d\n[%s]%s\n%s" % [
		Items.display_name(id),
		inv.counts[i],
		Items.rarity_name(id),
		" · Farmable" if Items.is_farmable(id) else "",
		Items.description(id),
	]
	detail.add_theme_color_override("font_color", Items.rarity_color(id))
	st.text = "Equip → hotbar hand · Use → select for punch/place · Drop → toss 1 · Tap another slot to swap."

func _backpack_click(idx: int) -> void:
	if idx == 0:
		inv.select(0)
		_backpack_pick = -1
		Sfx.play_ui()
		_rebuild_backpack()
		return
	if _backpack_pick < 0:
		_backpack_pick = idx
		## Soft-select: also highlight as equipped hand if already on hotbar.
		if idx < inv.hotbar_len() and inv.counts[idx] > 0:
			inv.select(idx)
		Sfx.play_ui()
		_rebuild_backpack()
		return
	if _backpack_pick == idx:
		## Second tap on same slot = equip/use shortcut (GT-like tap-to-wield).
		_backpack_equip()
		return
	inv.swap_slots(_backpack_pick, idx)
	_backpack_pick = -1
	Sfx.play_ui()
	_rebuild_backpack()

func _backpack_equip() -> void:
	## Move/select picked item onto hotbar (equip to hand).
	if _backpack_pick < 0:
		return
	var src := _backpack_pick
	if src <= 0 or src >= inv.slot_count():
		return
	if inv.counts[src] <= 0 or inv.slots[src] < 0:
		return
	if src < inv.hotbar_len():
		inv.select(src)
		Sfx.play_ui()
		_rebuild_backpack()
		return
	## Find empty hotbar slot (1..hotbar_len-1) or replace selected non-fist.
	var dest := -1
	for i in range(1, inv.hotbar_len()):
		if inv.counts[i] <= 0 or inv.slots[i] < 0:
			dest = i
			break
	if dest < 0:
		dest = inv.selected if inv.selected > 0 else 1
	inv.swap_slots(src, dest)
	inv.select(dest)
	_backpack_pick = dest
	Sfx.play_ui()
	_rebuild_backpack()

func _backpack_use() -> void:
	## Select item as active tool (same as equip for placeables/consumables).
	_backpack_equip()

func _backpack_drop_one() -> void:
	if _backpack_pick <= 0:
		return
	var prev_sel := inv.selected
	inv.select(_backpack_pick)
	if player.has_method("touch_drop"):
		player.touch_drop()
	inv.select(prev_sel)
	_backpack_pick = -1
	Sfx.play_ui()
	_rebuild_backpack()

func _add_bag_btn() -> void:
	var b := UiCircle.make_button("Bag", UiCircle.ACTION_SIZE, Color(0.45, 0.55, 0.3))
	b.name = "BtnBag"
	b.position = Vector2(420, 8)
	b.pressed.connect(func() -> void:
		if backpack_open:
			close_backpack()
		else:
			open_backpack()
		Sfx.play_ui())
	$Root.add_child(b)

func _setup_avatar_ui() -> void:
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

func _close_overlays_except(keep: String) -> void:
	if keep != "craft" and craft_open:
		close_craft()
	if keep != "weather" and weather_open:
		close_weather()
	if keep != "backpack" and backpack_open:
		close_backpack()
	if keep != "avatar" and avatar_open:
		close_avatar()
	if keep != "shop" and shop_open:
		close_shop()
	if keep != "quest" and quest_open:
		close_quest()
	if keep != "splice" and splice_open:
		close_splice()

func _make_modal(name: String, title_text: String) -> Dictionary:
	var root := ColorRect.new()
	root.name = name
	root.visible = false
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_STOP
	root.color = Color(0.04, 0.08, 0.16, 0.65)
	var panel := PanelContainer.new()
	panel.set_anchors_preset(Control.PRESET_CENTER)
	panel.offset_left = -260
	panel.offset_top = -220
	panel.offset_right = 260
	panel.offset_bottom = 220
	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 8)
	var title_l := Label.new()
	title_l.text = title_text
	title_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title_l.add_theme_font_size_override("font_size", 20)
	title_l.add_theme_color_override("font_color", Color(1, 0.92, 0.55))
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(0, 280)
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var list := VBoxContainer.new()
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	list.add_theme_constant_override("separation", 8)
	scroll.add_child(list)
	var status := Label.new()
	status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	status.add_theme_font_size_override("font_size", 12)
	var btn_close := UiCircle.make_button("Close", UiCircle.ACTION_SIZE, Color(0.55, 0.3, 0.35))
	vbox.add_child(title_l)
	vbox.add_child(scroll)
	vbox.add_child(status)
	vbox.add_child(btn_close)
	panel.add_child(vbox)
	root.add_child(panel)
	$Root.add_child(root)
	return {"root": root, "list": list, "status": status, "close": btn_close}

func _add_store_btn() -> void:
	## Always-visible circular Store opener (replaces Mira NPC).
	var b := UiCircle.make_button("Store", UiCircle.ACTION_SIZE, Color(0.85, 0.55, 0.2))
	b.name = "BtnStore"
	b.position = Vector2(620, 8)
	b.pressed.connect(func() -> void:
		if shop_open:
			close_shop()
		else:
			open_shop()
		Sfx.play_ui())
	$Root.add_child(b)

func _build_shop_ui() -> void:
	var ui := _make_modal("ShopUI", "Pixeltopia Store")
	_shop_root = ui["root"]
	_shop_list = ui["list"]
	_shop_status = ui["status"]
	_shop_status.text = "Spend gems to buy seeds, blocks, and tools."
	ui["close"].pressed.connect(close_shop)
func _build_quest_ui() -> void:
	var ui := _make_modal("QuestUI", "Quill the Guide — Quests")
	_quest_root = ui["root"]
	_quest_list = ui["list"]
	_quest_status = ui["status"]
	_quest_status.text = "Accept a quest, complete it, claim rewards."
	ui["close"].pressed.connect(close_quest)

func open_shop() -> void:
	if paused:
		return
	_close_overlays_except("shop")
	shop_open = true
	_shop_root.visible = true
	_rebuild_shop()
	Sfx.play_ui()
	_emit_block_input()

func close_shop() -> void:
	shop_open = false
	if _shop_root:
		_shop_root.visible = false
	_emit_block_input()

func open_quest() -> void:
	if paused:
		return
	_close_overlays_except("quest")
	quest_open = true
	_quest_root.visible = true
	_rebuild_quest()
	Sfx.play_ui()
	_emit_block_input()

func close_quest() -> void:
	quest_open = false
	if _quest_root:
		_quest_root.visible = false
	_emit_block_input()

func _rebuild_shop() -> void:
	for c in _shop_list.get_children():
		c.queue_free()
	var gems_row := Label.new()
	gems_row.text = "Your gems: %d" % inv.gems
	gems_row.add_theme_color_override("font_color", Color(0.55, 1.0, 0.85))
	_shop_list.add_child(gems_row)
	var tip := Label.new()
	tip.text = "Farmable blocks drop more gems & seeds when broken."
	tip.add_theme_font_size_override("font_size", 11)
	tip.add_theme_color_override("font_color", Color(0.85, 0.9, 1.0))
	tip.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_shop_list.add_child(tip)
	var div := Label.new()
	div.text = "—— Buy with gems ——"
	div.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_shop_list.add_child(div)
	for info in Items.store_stock():
		var id: int = int(info["id"])
		var price: int = int(info["buy"])
		if price < 0:
			continue
		var row := HBoxContainer.new()
		var lab := Label.new()
		lab.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var farm_tag := " · Farmable" if Items.is_farmable(id) else ""
		lab.text = "%s — %d gems%s\n%s [%s]" % [
			Items.display_name(id), price, farm_tag, Items.description(id), Items.rarity_name(id)]
		lab.add_theme_font_size_override("font_size", 12)
		lab.add_theme_color_override("font_color", Items.rarity_color(id))
		lab.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		var buy := UiCircle.make_button("Buy", UiCircle.COMPACT_SIZE, Color(0.25, 0.7, 0.45))
		buy.disabled = inv.gems < price
		var iid := id
		var ip := price
		buy.pressed.connect(func() -> void: _shop_buy(iid, ip))
		row.add_child(lab)
		row.add_child(buy)
		_shop_list.add_child(row)

func _shop_buy(id: int, price: int) -> void:
	if not inv.spend_gems(price):
		_shop_status.text = "Not enough gems."
		Sfx.play_ui()
		_rebuild_shop()
		return
	inv.add_item(id, 1)
	_shop_status.text = "Bought 1× %s (−%d gems)." % [Items.display_name(id), price]
	Sfx.play_craft()
	_rebuild_shop()
func _quest_log() -> Node:
	return get_parent().get_node("QuestLog")

func _rebuild_quest() -> void:
	for c in _quest_list.get_children():
		c.queue_free()
	var ql := _quest_log()
	for d in ql.defs():
		var qid: String = str(d["id"])
		var row := VBoxContainer.new()
		var title_l := Label.new()
		title_l.text = str(d["title"])
		title_l.add_theme_font_size_override("font_size", 16)
		title_l.add_theme_color_override("font_color", Color(1, 0.95, 0.7))
		var blurb := Label.new()
		blurb.text = str(d.get("blurb", ""))
		blurb.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		blurb.add_theme_font_size_override("font_size", 12)
		var prog := Label.new()
		var cur: int = ql.progress_of(qid)
		var goal := int(d.get("goal", 1))
		var status_txt := "Not accepted"
		if ql.is_claimed(qid):
			status_txt = "Claimed ✓"
		elif ql.is_accepted(qid):
			status_txt = "Progress %d / %d" % [cur, goal]
			if ql.is_complete(qid):
				status_txt += " — READY"
		prog.text = status_txt
		prog.add_theme_color_override("font_color", Color(0.7, 1.0, 0.8))
		var reward := Label.new()
		reward.text = "Reward: %d gems + %dx %s" % [
			int(d.get("reward_gems", 0)),
			int(d.get("reward_count", 0)),
			Items.display_name(int(d.get("reward_item", -1))),
		]
		reward.add_theme_font_size_override("font_size", 12)
		var btns := HBoxContainer.new()
		var acc := UiCircle.make_button("Accept", UiCircle.COMPACT_SIZE, Color(0.3, 0.55, 0.85))
		acc.disabled = ql.is_accepted(qid) or ql.is_claimed(qid)
		acc.pressed.connect(func() -> void:
			if ql.accept(qid):
				_quest_status.text = "Accepted: %s" % str(d["title"])
				Sfx.play_ui()
				_rebuild_quest())
		var claim := UiCircle.make_button("Claim", UiCircle.COMPACT_SIZE, Color(0.85, 0.65, 0.2))
		claim.disabled = not ql.is_complete(qid) or ql.is_claimed(qid)
		claim.pressed.connect(func() -> void:
			if ql.claim(qid, inv):
				_quest_status.text = "Reward claimed!"
				Sfx.play_craft()
				_rebuild_quest()
			else:
				_quest_status.text = "Cannot claim yet."
				Sfx.play_ui())
		btns.add_child(acc)
		btns.add_child(claim)
		row.add_child(title_l)
		row.add_child(blurb)
		row.add_child(prog)
		row.add_child(reward)
		row.add_child(btns)
		_quest_list.add_child(row)


func _add_splice_btn() -> void:
	var b := UiCircle.make_button("Splice", UiCircle.ACTION_SIZE, Color(0.55, 0.35, 0.85))
	b.name = "BtnSplice"
	b.position = Vector2(520, 8)
	b.pressed.connect(func() -> void:
		if splice_open:
			close_splice()
		else:
			open_splice()
		Sfx.play_ui())
	$Root.add_child(b)

func _build_splice_ui() -> void:
	var ui := _make_modal("SpliceUI", "Seed Splice — Discovery")
	_splice_root = ui["root"]
	_splice_list = ui["list"]
	_splice_status = ui["status"]
	_splice_status.text = "Pick two different seeds, then Splice. Result goes to your backpack."
	ui["close"].pressed.connect(close_splice)

func open_splice() -> void:
	if paused:
		return
	_close_overlays_except("splice")
	splice_open = true
	_splice_a = -1
	_splice_b = -1
	_splice_pick_slot = 0
	_splice_root.visible = true
	_rebuild_splice()
	Sfx.play_ui()
	_emit_block_input()

func close_splice() -> void:
	splice_open = false
	_splice_a = -1
	_splice_b = -1
	_splice_pick_slot = 0
	if _splice_root:
		_splice_root.visible = false
	_emit_block_input()

func _rebuild_splice() -> void:
	for c in _splice_list.get_children():
		c.queue_free()
	var pick_lbl := Label.new()
	var slot_name := "Seed 1" if _splice_pick_slot == 0 else "Seed 2"
	pick_lbl.text = "Selecting: %s  |  Seed1: %s  ·  Seed2: %s" % [
		slot_name,
		Items.display_name(_splice_a) if _splice_a >= 0 else "—",
		Items.display_name(_splice_b) if _splice_b >= 0 else "—",
	]
	pick_lbl.add_theme_font_size_override("font_size", 13)
	pick_lbl.add_theme_color_override("font_color", Color(1.0, 0.92, 0.65))
	pick_lbl.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_splice_list.add_child(pick_lbl)

	var tip := Label.new()
	tip.text = "Spliced seeds keep farmable gem/seed drops. Higher rarity = more gems."
	tip.add_theme_font_size_override("font_size", 11)
	tip.add_theme_color_override("font_color", Color(0.8, 0.9, 1.0))
	tip.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_splice_list.add_child(tip)

	var seed_ids: Array = SplicingData.all_seed_ids()
	for sid in seed_ids:
		var have: int = inv.count_of(int(sid))
		var row := HBoxContainer.new()
		var lab := Label.new()
		lab.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		lab.text = "%s ×%d  [%s]\n%s" % [
			Items.display_name(int(sid)), have,
			Items.rarity_name(int(sid)),
			Items.description(int(sid)),
		]
		lab.add_theme_font_size_override("font_size", 12)
		lab.add_theme_color_override("font_color", Items.rarity_color(int(sid)))
		lab.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		var pick := UiCircle.make_button("Use", UiCircle.COMPACT_SIZE, Color(0.4, 0.45, 0.85))
		pick.disabled = have < 1
		var id_copy: int = int(sid)
		pick.pressed.connect(func() -> void: _splice_pick(id_copy))
		row.add_child(lab)
		row.add_child(pick)
		_splice_list.add_child(row)

	var preview := Label.new()
	var res_id: int = SplicingData.result_of(_splice_a, _splice_b) if _splice_a >= 0 and _splice_b >= 0 else -1
	if res_id >= 0:
		preview.text = "Result preview: %s [%s]" % [Items.display_name(res_id), Items.rarity_name(res_id)]
		preview.add_theme_color_override("font_color", Items.rarity_color(res_id))
	elif _splice_a >= 0 and _splice_b >= 0:
		preview.text = "No known splice for that pair."
		preview.add_theme_color_override("font_color", Color(1.0, 0.55, 0.45))
	else:
		preview.text = "Pick Seed 1 and Seed 2 to preview the discovery."
		preview.add_theme_color_override("font_color", Color(0.85, 0.9, 1.0))
	preview.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	preview.add_theme_font_size_override("font_size", 14)
	_splice_list.add_child(preview)

	var actions := HBoxContainer.new()
	actions.alignment = BoxContainer.ALIGNMENT_CENTER
	var clear_btn := UiCircle.make_button("Clear", UiCircle.COMPACT_SIZE, Color(0.5, 0.4, 0.4))
	clear_btn.pressed.connect(func() -> void:
		_splice_a = -1
		_splice_b = -1
		_splice_pick_slot = 0
		_splice_status.text = "Cleared. Pick two seeds."
		Sfx.play_ui()
		_rebuild_splice())
	var do_btn := UiCircle.make_button("Splice", UiCircle.ACTION_SIZE, Color(0.55, 0.3, 0.85))
	do_btn.disabled = res_id < 0
	do_btn.pressed.connect(_do_splice)
	actions.add_child(clear_btn)
	actions.add_child(do_btn)
	_splice_list.add_child(actions)

	var known := Label.new()
	known.text = "—— Known recipes ——"
	known.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_splice_list.add_child(known)
	for pair in SplicingData.known_pairs():
		var pl := Label.new()
		pl.text = str(pair.get("blurb", ""))
		pl.add_theme_font_size_override("font_size", 11)
		pl.add_theme_color_override("font_color", Color(0.75, 0.85, 1.0))
		_splice_list.add_child(pl)

func _splice_pick(seed_id: int) -> void:
	if inv.count_of(seed_id) < 1:
		_splice_status.text = "You do not have that seed."
		Sfx.play_ui()
		return
	if _splice_pick_slot == 0:
		_splice_a = seed_id
		_splice_pick_slot = 1
		_splice_status.text = "Seed 1 set. Now pick Seed 2 (must be different)."
	else:
		if seed_id == _splice_a:
			_splice_status.text = "Pick a different seed for Seed 2."
			Sfx.play_ui()
			_rebuild_splice()
			return
		_splice_b = seed_id
		_splice_pick_slot = 0
		var res: int = SplicingData.result_of(_splice_a, _splice_b)
		if res >= 0:
			_splice_status.text = "Ready! Result: %s" % Items.display_name(res)
		else:
			_splice_status.text = "Unknown pair — try another combination."
	Sfx.play_ui()
	_rebuild_splice()

func _do_splice() -> void:
	var out: Dictionary = inv.try_splice(_splice_a, _splice_b)
	if bool(out.get("ok", false)):
		var rid: int = int(out["result"])
		_splice_status.text = "Discovered %s [%s]! Added to backpack." % [
			Items.display_name(rid), Items.rarity_name(rid)]
		Sfx.play_craft()
		_splice_a = -1
		_splice_b = -1
		_splice_pick_slot = 0
		if _main != null and _main.has_method("notify_spliced"):
			_main.notify_spliced()
	else:
		_splice_status.text = str(out.get("error", "Splice failed."))
		Sfx.play_ui()
	_rebuild_splice()

func _pause_btn(name: String) -> Button:
	var p2 := "Root/Pause/Panel/CircleActions/%s" % name
	var p1 := "Root/Pause/Panel/%s" % name
	if has_node(p2):
		return get_node(p2)
	if has_node(p1):
		return get_node(p1)
	return null

func _layout_pause_circles() -> void:
	## Re-pack pause actions into a centered flow of true circular buttons.
	var panel: VBoxContainer = $Root/Pause/Panel
	var names := ["BtnResume", "BtnCraft", "BtnSave", "BtnLoad", "BtnMute", "BtnAvatar"]
	var labels := {
		"BtnResume": "Resume",
		"BtnCraft": "Craft",
		"BtnSave": "Save",
		"BtnLoad": "Load",
		"BtnMute": "Mute",
		"BtnAvatar": "Avatar",
	}
	var accents := {
		"BtnResume": Color(0.25, 0.65, 0.4),
		"BtnCraft": Color(0.7, 0.5, 0.2),
		"BtnSave": Color(0.25, 0.5, 0.8),
		"BtnLoad": Color(0.35, 0.45, 0.75),
		"BtnMute": Color(0.5, 0.35, 0.65),
		"BtnAvatar": Color(0.75, 0.4, 0.55),
	}
	if panel.has_node("CircleActions"):
		return
	var flow := HFlowContainer.new()
	flow.name = "CircleActions"
	flow.alignment = FlowContainer.ALIGNMENT_CENTER
	flow.add_theme_constant_override("h_separation", 10)
	flow.add_theme_constant_override("v_separation", 10)
	panel.add_child(flow)
	panel.move_child(flow, 2)
	for n in names:
		if not panel.has_node(n):
			continue
		var b: Button = panel.get_node(n)
		panel.remove_child(b)
		flow.add_child(b)
		b.text = str(labels.get(n, b.text))
		UiCircle.apply(b, UiCircle.ACTION_SIZE, accents.get(n, Color(0.22, 0.48, 0.78)))

func _style_static_circles() -> void:
	## Style all remaining scene buttons as true circles (≥48dp).
	var touch_accent := Color(0.2, 0.45, 0.75)
	if has_node("Root/TouchPad"):
		for n in ["BtnLeft", "BtnRight", "BtnJump", "BtnPunch", "BtnPlace", "BtnHotPrev", "BtnHotNext"]:
			if not has_node("Root/TouchPad/%s" % n):
				continue
			var b: Button = get_node("Root/TouchPad/%s" % n)
			var sz := UiCircle.TOUCH_SIZE
			if n in ["BtnHotPrev", "BtnHotNext"]:
				sz = UiCircle.HOTBAR_SIZE
			UiCircle.apply(b, sz, touch_accent)
			var w := sz
			var h := sz
			if n == "BtnLeft":
				b.offset_left = 16.0
				b.offset_right = 16.0 + w
				b.offset_top = -16.0 - h
				b.offset_bottom = -16.0
			elif n == "BtnRight":
				b.offset_left = 16.0 + w + 8.0
				b.offset_right = 16.0 + w + 8.0 + w
				b.offset_top = -16.0 - h
				b.offset_bottom = -16.0
			elif n == "BtnJump":
				b.offset_left = -16.0 - w
				b.offset_right = -16.0
				b.offset_top = -16.0 - h
				b.offset_bottom = -16.0
			elif n == "BtnPunch":
				b.offset_left = -16.0 - w * 2.0 - 8.0
				b.offset_right = -16.0 - w - 8.0
				b.offset_top = -16.0 - h
				b.offset_bottom = -16.0
			elif n == "BtnPlace":
				b.offset_left = -16.0 - w * 2.0 - 8.0
				b.offset_right = -16.0 - w - 8.0
				b.offset_top = -16.0 - h * 2.0 - 8.0
				b.offset_bottom = -16.0 - h - 8.0
			elif n == "BtnHotPrev":
				b.offset_left = -340.0 - w
				b.offset_right = -340.0
				b.offset_top = -12.0 - h
				b.offset_bottom = -12.0
			elif n == "BtnHotNext":
				b.offset_left = 340.0
				b.offset_right = 340.0 + w
				b.offset_top = -12.0 - h
				b.offset_bottom = -12.0
	if has_node("Root/Craft/Panel/VBox/BtnClose"):
		UiCircle.apply($Root/Craft/Panel/VBox/BtnClose, UiCircle.ACTION_SIZE, Color(0.55, 0.3, 0.35))
	if has_node("Root/WeatherUI/Panel/VBox/BtnAuto"):
		UiCircle.apply($Root/WeatherUI/Panel/VBox/BtnAuto, UiCircle.ACTION_SIZE, Color(0.85, 0.65, 0.2))
	if has_node("Root/WeatherUI/Panel/VBox/BtnClose"):
		$Root/WeatherUI/Panel/VBox/BtnClose.text = "Close"
		UiCircle.apply($Root/WeatherUI/Panel/VBox/BtnClose, UiCircle.ACTION_SIZE, Color(0.55, 0.3, 0.35))
	if has_node("Root/AvatarUI/Panel/VBox"):
		for n in ["BtnSkin", "BtnHair", "BtnClothes", "BtnAccessory", "BtnClose"]:
			if not has_node("Root/AvatarUI/Panel/VBox/%s" % n):
				continue
			var ab: Button = get_node("Root/AvatarUI/Panel/VBox/%s" % n)
			match n:
				"BtnSkin":
					ab.text = "Skin"
				"BtnHair":
					ab.text = "Hair"
				"BtnClothes":
					ab.text = "Fit"
				"BtnAccessory":
					ab.text = "Acc"
				"BtnClose":
					ab.text = "Done"
			UiCircle.apply(ab, UiCircle.ACTION_SIZE, Color(0.7, 0.4, 0.55))
	if has_node("Root/Backpack/Panel/VBox/BtnClose"):
		$Root/Backpack/Panel/VBox/BtnClose.text = "Close"
		UiCircle.apply($Root/Backpack/Panel/VBox/BtnClose, UiCircle.ACTION_SIZE, Color(0.55, 0.3, 0.35))

