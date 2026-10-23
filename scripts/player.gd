extends Node2D
## Pixeltopia player: move, jump, punch/break, place, plant/harvest, drop/pickup.

const Items = preload("res://scripts/items.gd")
const SPEED := 160.0
const JUMP_V := -320.0
const GRAVITY := 900.0
const REACH := 3  ## tiles
const BODY := Vector2(20, 28)

@onready var world: Node2D = get_parent().get_node("World")
@onready var inv: Node = get_parent().get_node("Inventory")
@onready var body_rect: ColorRect = $Body
@onready var float_layer: Node2D = get_parent().get_node("FloatLayer")
@onready var camera: Camera2D = $Camera2D

var velocity: Vector2 = Vector2.ZERO
var facing: int = 1
var on_floor: bool = false
var paused: bool = false
var look = null  ## AvatarLook
var _step_cd: float = 0.0
var _touch_dir: float = 0.0
var _touch_jump: bool = false
var _shake_t: float = 0.0
var _pickup_cd: float = 0.0
var net: Node = null  ## GameSocket when online

signal weather_machine_used
signal shop_used
signal quest_used
signal crops_harvested(count: int)
signal world_edited

func _ready() -> void:
	var AvatarLookScript = load("res://scripts/avatar.gd")
	look = AvatarLookScript.new()
	if body_rect:
		body_rect.visible = false
	_spawn_default()
	if world.has_signal("tile_broken"):
		world.tile_broken.connect(_on_tile_broken)
	queue_redraw()

func _spawn_default() -> void:
	var tx: int = int(world.W / 2)
	var spawn_y: int = 2
	if "spawn_tile" in world:
		tx = int(world.spawn_tile.x)
		spawn_y = int(world.spawn_tile.y)
	else:
		for y in range(world.H):
			if Tiles.is_solid(world.get_tile(tx, y)):
				spawn_y = maxi(y - 2, 1)
				break
	global_position = Vector2(tx * Tiles.SIZE + Tiles.SIZE * 0.5, spawn_y * Tiles.SIZE)

func apply_save_pos(pos: Vector2) -> void:
	global_position = pos
	velocity = Vector2.ZERO

func set_net(n: Node) -> void:
	net = n

func _net_online() -> bool:
	return net != null and net.has_method("is_online") and net.is_online()

func _physics_process(delta: float) -> void:
	if paused:
		_update_shake(delta)
		return
	var dir := _touch_dir
	if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
		dir -= 1.0
	if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
		dir += 1.0
	dir = clampf(dir, -1.0, 1.0)
	velocity.x = dir * SPEED
	if dir != 0.0:
		var nf := 1 if dir > 0.0 else -1
		if nf != facing:
			facing = nf
			queue_redraw()

	var want_jump := _touch_jump or Input.is_key_pressed(KEY_SPACE) or Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP)
	_touch_jump = false
	if not on_floor:
		velocity.y += GRAVITY * delta
	elif want_jump:
		velocity.y = JUMP_V
		on_floor = false
		Sfx.play_jump()

	_resolve_tiles(delta)
	_hotbar_keys()
	_footsteps(delta, dir)
	_try_auto_pickup(delta)
	_update_shake(delta)

func _unhandled_input(event: InputEvent) -> void:
	if paused:
		return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_Q or event.keycode == KEY_G:
			_drop_selected()
			get_viewport().set_input_as_handled()
			return
	if event is InputEventMouseButton and event.pressed:
		var mb := event as InputEventMouseButton
		var mouse := get_global_mouse_position()
		var t: Vector2i = world.world_to_tile(mouse)
		if not _in_reach(t):
			return
		if mb.button_index == MOUSE_BUTTON_LEFT:
			_punch_or_use(t)
		elif mb.button_index == MOUSE_BUTTON_RIGHT:
			_place(t)

func _hotbar_keys() -> void:
	for i in range(mini(9, inv.hotbar_len())):
		if Input.is_physical_key_pressed(KEY_1 + i):
			inv.select(i)

func _in_reach(t: Vector2i) -> bool:
	var pt: Vector2i = world.world_to_tile(global_position)
	return absi(t.x - pt.x) <= REACH and absi(t.y - pt.y) <= REACH

func _spawn_float(text: String, color: Color = Color(1.0, 0.92, 0.45)) -> void:
	var ft_script: Script = load("res://scripts/floating_text.gd")
	var ft: Node2D = Node2D.new()
	ft.set_script(ft_script)
	float_layer.add_child(ft)
	ft.global_position = global_position + Vector2(0, -24)
	ft.call("setup", text, color)

func _on_tile_broken(world_pos: Vector2) -> void:
	_shake(0.18, 4.0)
	world_edited.emit()

func _shake(duration: float, magnitude: float) -> void:
	_shake_t = maxf(_shake_t, duration)
	if camera:
		camera.offset = Vector2(randf_range(-magnitude, magnitude), randf_range(-magnitude, magnitude))

func _update_shake(delta: float) -> void:
	if _shake_t <= 0.0:
		if camera and camera.offset != Vector2.ZERO:
			camera.offset = Vector2.ZERO
		return
	_shake_t -= delta
	if camera:
		var m := 3.0 * (_shake_t / 0.18)
		camera.offset = Vector2(randf_range(-m, m), randf_range(-m, m))
		if _shake_t <= 0.0:
			camera.offset = Vector2.ZERO

func _try_auto_pickup(delta: float) -> void:
	_pickup_cd = maxf(_pickup_cd - delta, 0.0)
	if _pickup_cd > 0.0:
		return
	var n: int = world.try_pickup_at(global_position, inv)
	if n > 0:
		_pickup_cd = 0.12
		_spawn_float("Picked up ×%d" % n, Color(0.7, 1.0, 0.75))
		Sfx.play_harvest()

func _drop_selected() -> void:
	var result: Dictionary = inv.drop_selected(1)
	if result.is_empty():
		_spawn_float("Can't drop", Color(1.0, 0.5, 0.5))
		Sfx.play_ui()
		return
	var ahead := global_position + Vector2(facing * Tiles.SIZE * 0.9, 0)
	var t: Vector2i = world.world_to_tile(ahead)
	world.spawn_drop(t.x, t.y, int(result["id"]), int(result["n"]))
	var id: int = int(result["id"])
	_spawn_float("Dropped %s" % Items.display_name(id), Items.rarity_color(id))
	Sfx.play_place()
	world_edited.emit()

func _npc_at(t: Vector2i) -> String:
	if not world.has_method("npc_at"):
		return ""
	return str(world.npc_at(t.x, t.y))

func _punch_or_use(t: Vector2i) -> void:
	var npc_role := _npc_at(t)
	## Shop NPC removed — Store is opened from the HUD (Store button / key P).
	if npc_role == "quest":
		quest_used.emit()
		Sfx.play_ui()
		return
	var id: int = world.get_tile(t.x, t.y)
	if id == Tiles.Id.WEATHER_MACHINE:
		weather_machine_used.emit()
		Sfx.play_ui()
		return
	## Fertilizer on sprout
	if Tiles.is_seed(id) and not inv.is_fist() and inv.get_selected_id() == Tiles.Id.FERTILIZER:
		if world.try_fertilize(t.x, t.y):
			inv.consume_selected(1)
			_spawn_float("Fertilized!", Color(0.6, 0.95, 0.4))
			Sfx.play_craft()
			world_edited.emit()
		else:
			_spawn_float("Already boosted", Color(1.0, 0.8, 0.4))
			Sfx.play_ui()
		return
	if Tiles.is_crop(id):
		if _net_online():
			net.send_punch(t.x, t.y)
			Sfx.play_harvest()
			crops_harvested.emit(1)
			return
		var hr: Dictionary = world.try_harvest(t.x, t.y, true, inv)
		if int(hr.get("block", -1)) >= 0:
			_announce_break_rewards(hr)
			Sfx.play_harvest()
			crops_harvested.emit(1)
			world_edited.emit()
		return
	if id != Tiles.Id.AIR:
		if _net_online():
			net.send_punch(t.x, t.y)
			Sfx.play_break()
			return
		var br: Dictionary = world.break_tile(t.x, t.y, true, inv)
		_announce_break_rewards(br)
		Sfx.play_break()
		world_edited.emit()
		return
	if not inv.is_fist():
		_place(t)

func _announce_break_rewards(r: Dictionary) -> void:
	var bits: PackedStringArray = PackedStringArray()
	var bid := int(r.get("block", -1))
	var sid := int(r.get("seed", -1))
	var gems := int(r.get("gems", 0))
	if bid >= 0:
		bits.append(Items.display_name(bid))
	if sid >= 0:
		bits.append("seed")
	if gems > 0:
		bits.append("+%dg" % gems)
	if bits.is_empty():
		_spawn_float("Broke", Color(0.75, 0.75, 0.8))
	else:
		var col := Items.rarity_color(bid) if bid >= 0 else Color(0.55, 1.0, 0.85)
		_spawn_float("+%s" % " · ".join(bits), col)

func _place(t: Vector2i) -> void:
	if inv.is_fist():
		return
	var id: int = inv.get_selected_id()
	if inv.selected <= 0 or inv.counts[inv.selected] <= 0:
		return
	if Tiles.is_usable_item(id):
		## Usable items are applied via punch, not placed
		return
	if _net_online():
		net.send_place(t.x, t.y, id)
		inv.consume_selected(1)
		Sfx.play_place()
		if Tiles.is_seed(id):
			var mainn := get_parent()
			if mainn.has_method("notify_planted"):
				mainn.notify_planted()
		if net.has_method("sync_inventory"):
			net.sync_inventory(inv)
		return
	if world.place_tile(t.x, t.y, id):
		inv.consume_selected(1)
		Sfx.play_place()
		if Tiles.is_seed(id):
			var main := get_parent()
			if main.has_method("notify_planted"):
				main.notify_planted()
		world_edited.emit()

func _resolve_tiles(delta: float) -> void:
	var pos := global_position
	pos.x += velocity.x * delta
	pos = _separate(pos, true)
	var before_y := pos.y
	pos.y += velocity.y * delta
	pos = _separate(pos, false)
	on_floor = false
	if velocity.y >= 0.0 and pos.y <= before_y + 0.01:
		if _feet_on_ground(pos):
			on_floor = true
			velocity.y = 0.0
	if pos.y > before_y + 0.01 and velocity.y < 0.0:
		velocity.y = 0.0
	pos.x = clampf(pos.x, BODY.x * 0.5, world.W * Tiles.SIZE - BODY.x * 0.5)
	pos.y = clampf(pos.y, BODY.y * 0.5, world.H * Tiles.SIZE - BODY.y * 0.5)
	global_position = pos

func _feet_on_ground(pos: Vector2) -> bool:
	var foot: Vector2 = pos + Vector2(0, BODY.y * 0.5 + 1.0)
	var t: Vector2i = world.world_to_tile(foot)
	return Tiles.is_solid(world.get_tile(t.x, t.y))

func _separate(pos: Vector2, horizontal: bool) -> Vector2:
	var half := BODY * 0.5
	var min_t: Vector2i = world.world_to_tile(pos - half)
	var max_t: Vector2i = world.world_to_tile(pos + half - Vector2(0.01, 0.01))
	for ty in range(min_t.y, max_t.y + 1):
		for tx in range(min_t.x, max_t.x + 1):
			if not Tiles.is_solid(world.get_tile(tx, ty)):
				continue
			var tile_r := Rect2(tx * Tiles.SIZE, ty * Tiles.SIZE, Tiles.SIZE, Tiles.SIZE)
			var body_r := Rect2(pos - half, BODY)
			if not body_r.intersects(tile_r):
				continue
			if horizontal:
				if velocity.x > 0.0:
					pos.x = tile_r.position.x - half.x
				elif velocity.x < 0.0:
					pos.x = tile_r.end.x + half.x
			else:
				if velocity.y > 0.0:
					pos.y = tile_r.position.y - half.y
					on_floor = true
				elif velocity.y < 0.0:
					pos.y = tile_r.end.y + half.y
	return pos

func set_touch_dir(d: float) -> void:
	_touch_dir = clampf(d, -1.0, 1.0)

func request_touch_jump() -> void:
	_touch_jump = true

func touch_punch_at(world_pos: Vector2) -> void:
	var t: Vector2i = world.world_to_tile(world_pos)
	if _in_reach(t):
		_punch_or_use(t)

func touch_place_at(world_pos: Vector2) -> void:
	var t: Vector2i = world.world_to_tile(world_pos)
	if _in_reach(t):
		_place(t)

func touch_drop() -> void:
	_drop_selected()

func _footsteps(delta: float, dir: float) -> void:
	_step_cd = maxf(_step_cd - delta, 0.0)
	if on_floor and absf(dir) > 0.1 and _step_cd <= 0.0:
		Sfx.play_footstep()
		_step_cd = 0.28

func _draw() -> void:
	if look == null:
		return
	var AvatarLookScript = load("res://scripts/avatar.gd")
	AvatarLookScript.draw_look(self, look, facing)

func set_look_from_dict(data: Dictionary) -> void:
	if look == null:
		var AvatarLookScript = load("res://scripts/avatar.gd")
		look = AvatarLookScript.new()
	look.from_save(data)
	queue_redraw()

func look_to_save() -> Dictionary:
	if look == null:
		return {}
	return look.to_save()

func cycle_look(part: String, delta: int = 1) -> void:
	if look == null:
		return
	match part:
		"skin":
			look.skin_i = (look.skin_i + delta) % look.SKIN.size()
		"hair":
			look.hair_i = (look.hair_i + delta) % look.HAIR.size()
		"clothes":
			look.clothes_i = (look.clothes_i + delta) % look.CLOTHES.size()
		"accessory":
			look.accessory_i = (look.accessory_i + delta) % look.ACCESSORY.size()
	queue_redraw()
