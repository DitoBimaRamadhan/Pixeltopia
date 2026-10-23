extends CanvasLayer
## Hotbar + craft + shop + quests + pause/save for Pixeltopia.

const Items = preload("res://scripts/items.gd")
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
var shop_open: bool = false
var quest_open: bool = false
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

signal pause_changed(paused: bool)
signal save_requested
signal load_requested

func bind_main(main: Node) -> void:
	_main = main

func set_dirty(v: bool) -> void:
	_dirty = v

func _ready() -> void:
	title.text = "Pixeltopia"
	hint.text = "A/D move · Jump · LMB punch · RMB place · Q/G drop · 1-7 hotbar · C craft · B bag · Esc · Punch Mira=shop Quill=quest"
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
		_refresh_mute_label()
	$Root/Craft/Panel/VBox/BtnClose.pressed.connect(close_craft)
	_rebuild_hotbar()
	_rebuild_craft_list()
	_setup_touch()
	_setup_weather_ui()
	_setup_avatar_ui()
	_setup_backpack_ui()
	_setup_gems_label()
	_build_shop_ui()
	_build_quest_ui()
	_add_drop_touch_btn()
	if player.has_signal("weather_machine_used"):
		player.weather_machine_used.connect(open_weather)
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
	var b := Button.new()
	b.name = "BtnDrop"
	b.text = "Drop"
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
	pause_changed.emit(paused or craft_open or weather_open or backpack_open or avatar_open or shop_open or quest_open)

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
	$Root/WeatherUI/Panel/VBox/BtnAuto.text = "Auto cycle: On" if weather.auto_cycle else "Auto cycle: Off"

func _setup_backpack_ui() -> void:
	if not has_node("Root/Backpack"):
		return
	$Root/Backpack/Panel/VBox/BtnClose.pressed.connect(close_backpack)

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
	var grid: GridContainer = $Root/Backpack/Panel/VBox/Grid
	var hot: HBoxContainer = $Root/Backpack/Panel/VBox/HotRow
	for c in grid.get_children():
		c.queue_free()
	for c in hot.get_children():
		c.queue_free()
	for i in range(inv.backpack_start(), inv.slot_count()):
		var b := Button.new()
		b.custom_minimum_size = Vector2(120, 36)
		b.text = inv.label_for(i) if inv.counts[i] > 0 and inv.slots[i] >= 0 else "—"
		var idx := i
		b.pressed.connect(func() -> void: _backpack_click(idx))
		if i == _backpack_pick:
			b.modulate = Color(1.3, 1.2, 0.7)
		grid.add_child(b)
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
		st.text = "Select an item, then a hotbar slot to move it. Q/G drops selected."
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
	var btn_close := Button.new()
	btn_close.text = "Close (Esc)"
	vbox.add_child(title_l)
	vbox.add_child(scroll)
	vbox.add_child(status)
	vbox.add_child(btn_close)
	panel.add_child(vbox)
	root.add_child(panel)
	$Root.add_child(root)
	return {"root": root, "list": list, "status": status, "close": btn_close}

func _build_shop_ui() -> void:
	var ui := _make_modal("ShopUI", "Mira the Merchant")
	_shop_root = ui["root"]
	_shop_list = ui["list"]
	_shop_status = ui["status"]
	_shop_status.text = "Buy with gems · Sell selected hotbar item"
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
	## Sell selected
	var sell_box := HBoxContainer.new()
	var sell_info := Label.new()
	sell_info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if inv.is_fist():
		sell_info.text = "Select a hotbar item to sell"
	else:
		var sid: int = inv.get_selected_id()
		sell_info.text = "Sell 1× %s for %d gems [%s]" % [
			Items.display_name(sid), Items.sell_price(sid), Items.rarity_name(sid)]
	var sell_btn := Button.new()
	sell_btn.text = "Sell 1"
	sell_btn.disabled = inv.is_fist() or inv.get_selected_id() < 0
	sell_btn.pressed.connect(_shop_sell_one)
	sell_box.add_child(sell_info)
	sell_box.add_child(sell_btn)
	_shop_list.add_child(sell_box)
	var div := Label.new()
	div.text = "—— Shop stock ——"
	div.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_shop_list.add_child(div)
	for info in Items.shop_stock():
		var id: int = int(info["id"])
		var price: int = int(info["buy"])
		if price < 0:
			continue
		var row := HBoxContainer.new()
		var lab := Label.new()
		lab.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		lab.text = "%s — %d gems\n%s [%s]" % [
			Items.display_name(id), price, Items.description(id), Items.rarity_name(id)]
		lab.add_theme_font_size_override("font_size", 12)
		lab.add_theme_color_override("font_color", Items.rarity_color(id))
		lab.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		var buy := Button.new()
		buy.text = "Buy"
		buy.custom_minimum_size = Vector2(72, 36)
		buy.disabled = inv.gems < price
		var iid := id
		var ip := price
		buy.pressed.connect(func() -> void: _shop_buy(iid, ip))
		row.add_child(lab)
		row.add_child(buy)
		_shop_list.add_child(row)

func _shop_sell_one() -> void:
	if inv.is_fist():
		_shop_status.text = "Nothing selected."
		return
	var id: int = inv.get_selected_id()
	var price: int = Items.sell_price(id)
	if price <= 0 or not inv.consume_selected(1):
		_shop_status.text = "Cannot sell that."
		Sfx.play_ui()
		return
	inv.add_gems(price)
	_shop_status.text = "Sold 1× %s for %d gems." % [Items.display_name(id), price]
	Sfx.play_craft()
	_rebuild_shop()

func _shop_buy(id: int, price: int) -> void:
	if not inv.spend_gems(price):
		_shop_status.text = "Not enough gems."
		Sfx.play_ui()
		_rebuild_shop()
		return
	inv.add_item(id, 1)
	_shop_status.text = "Bought 1× %s." % Items.display_name(id)
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
		var acc := Button.new()
		acc.text = "Accept"
		acc.disabled = ql.is_accepted(qid) or ql.is_claimed(qid)
		acc.pressed.connect(func() -> void:
			if ql.accept(qid):
				_quest_status.text = "Accepted: %s" % str(d["title"])
				Sfx.play_ui()
				_rebuild_quest())
		var claim := Button.new()
		claim.text = "Claim"
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
