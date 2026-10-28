extends Node2D
## Pixeltopia player: move, jump, punch/break, place, plant/harvest, drop/pickup.

const Items = preload("res://scripts/items.gd")
const SPEED := 160.0  ## max run speed (px/s) — unchanged so online position updates stay plausible
const JUMP_V := -320.0  ## full-hold jump: ~1.8 tiles, same apex as v1.8
const GRAVITY := 900.0
## v1.9 movement feel
const ACCEL_GROUND := 1500.0  ## px/s² toward the target speed while grounded
const FRICTION_GROUND := 2000.0  ## px/s² braking when no direction is held on the ground
const ACCEL_AIR := 1150.0  ## air control: you can steer left/right while jumping/falling
const DRAG_AIR := 420.0  ## gentle slow-down in the air when no direction is held
const FALL_GRAVITY_MULT := 1.35  ## fall a bit faster than you rise (snappier arcs)
const JUMP_CUT := 0.45  ## releasing jump early keeps this fraction of the upward speed (variable height)
const MAX_FALL := 560.0
const COYOTE_TIME := 0.10  ## seconds you can still jump after walking off a ledge
const JUMP_BUFFER := 0.13  ## seconds a jump press is remembered before landing
const CORNER_NUDGE := 7.0  ## px: slide around a ceiling corner instead of bonking on it
const REACH := 3  ## tiles
const BODY := Vector2(20, 28)
const HIT_INTERVAL := 0.18  ## seconds between punches (hold to keep hitting); server allows ~7/s

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
var _touch_jump_held: bool = false
var _coyote_t: float = 0.0
var _jump_buffer_t: float = 0.0
var _jump_was_held: bool = false
var _jumping: bool = false  ## rising from a jump (variable-height cut applies)
var _air_t: float = 0.0
var anim_t: float = 0.0  ## walk-cycle phase (avatar animation)
var _land_squash: float = 0.0
signal landed(impact: float)
signal jumped
var _shake_t: float = 0.0
var _pickup_cd: float = 0.0
var net: Node = null  ## GameSocket when online
var _hit_cd: float = 0.0
var _touch_punch_held: bool = false
var _mouse_hold: bool = false  ## LMB went down on the world (not on a HUD control)

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

## Online session (even while reconnecting): the server owns the inventory, so no local drops.
func _online_session() -> bool:
	return net != null and not Session.offline_mode

func _physics_process(delta: float) -> void:
	if paused:
		_touch_jump = false
		_jump_buffer_t = 0.0
		velocity.x = move_toward(velocity.x, 0.0, FRICTION_GROUND * delta)
		_update_shake(delta)
		return
	var dir := read_move_dir()
	if dir != 0.0:
		var nf := 1 if dir > 0.0 else -1
		if nf != facing:
			facing = nf
			queue_redraw()
	_dropping = _touch_down or _key(KEY_S) or _key(KEY_DOWN)
	var jump_held := _touch_jump_held or _key(KEY_SPACE) or _key(KEY_W) or _key(KEY_UP)
	var jump_pressed := _touch_jump or (jump_held and not _jump_was_held) or (jump_held and on_floor)
	_jump_was_held = jump_held
	_touch_jump = false
	step_movement(delta, dir, jump_pressed, jump_held)
	_hotbar_keys()
	_footsteps(delta, dir)
	_try_auto_pickup(delta)
	_update_shake(delta)
	_hold_punch(delta)

## v1.9: little dust puff at the feet on jump / landing.
func _spawn_dust(strength: float) -> void:
	if not is_inside_tree() or float_layer == null:
		return
	var p := CPUParticles2D.new()
	p.one_shot = true
	p.emitting = false
	p.amount = int(4 + 8 * strength)
	p.lifetime = 0.35
	p.explosiveness = 1.0
	p.direction = Vector2(0, -1)
	p.spread = 80.0
	p.initial_velocity_min = 20.0
	p.initial_velocity_max = 60.0 * strength + 20.0
	p.gravity = Vector2(0, 120)
	p.scale_amount_min = 2.0
	p.scale_amount_max = 3.5
	p.color = Color(0.85, 0.8, 0.7, 0.8)
	float_layer.add_child(p)
	p.global_position = global_position + Vector2(0, BODY.y * 0.5)
	p.emitting = true
	get_tree().create_timer(0.8).timeout.connect(p.queue_free)

## v1.9 camera: small look-ahead toward where you run / fall (the Camera2D smooths the rest).
func _process(delta: float) -> void:
	if camera == null:
		return
	var ahead := Vector2(clampf(velocity.x / SPEED, -1.0, 1.0) * 28.0, 0.0)
	if not on_floor and velocity.y > 260.0:
		ahead.y = 36.0
	camera.position = camera.position.lerp(ahead, clampf(delta * 3.0, 0.0, 1.0))

## Keyboard + touch direction, combined (touch and keys can be used together).
func read_move_dir() -> float:
	var dir := _touch_dir
	if _keys_enabled():
		if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
			dir -= 1.0
		if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
			dir += 1.0
	return clampf(dir, -1.0, 1.0)

## v1.9 fix: typing in chat / PM / world settings must not walk, jump or switch hotbar slots.
func _keys_enabled() -> bool:
	var vp := get_viewport()
	if vp == null:
		return true
	var fo := vp.gui_get_focus_owner()
	return not (fo is LineEdit or fo is TextEdit)

func _key(k: Key) -> bool:
	return _keys_enabled() and Input.is_key_pressed(k)

## One movement step (pure input → physics, also used by tools/v19_check.gd).
## Horizontal speed is always steerable, on the ground and in the air (v1.9 fix).
func step_movement(delta: float, dir: float, jump_pressed: bool, jump_held: bool) -> void:
	var target := dir * SPEED
	var accel: float
	if on_floor:
		accel = ACCEL_GROUND if dir != 0.0 else FRICTION_GROUND
		## Turning around on the ground is extra snappy.
		if dir != 0.0 and signf(velocity.x) != 0.0 and signf(velocity.x) != signf(dir):
			accel += FRICTION_GROUND
	else:
		accel = ACCEL_AIR if dir != 0.0 else DRAG_AIR
	velocity.x = move_toward(velocity.x, target, accel * delta)
	## Coyote time + jump buffer.
	if on_floor:
		_coyote_t = COYOTE_TIME
		_jumping = false
	else:
		_coyote_t = maxf(_coyote_t - delta, 0.0)
	if jump_pressed:
		_jump_buffer_t = JUMP_BUFFER
	else:
		_jump_buffer_t = maxf(_jump_buffer_t - delta, 0.0)
	if _jump_buffer_t > 0.0 and _coyote_t > 0.0:
		velocity.y = JUMP_V
		on_floor = false
		_coyote_t = 0.0
		_jump_buffer_t = 0.0
		_jumping = true
		_land_squash = -0.18
		Sfx.play_jump()
		_spawn_dust(0.4)
		jumped.emit()
	if not on_floor:
		## Variable jump height: let go early and the jump is cut short.
		if _jumping and velocity.y < 0.0 and not jump_held:
			velocity.y *= JUMP_CUT
			_jumping = false
		var g := GRAVITY * (FALL_GRAVITY_MULT if velocity.y > 0.0 else 1.0)
		velocity.y = minf(velocity.y + g * delta, MAX_FALL)
	var was_floor := on_floor
	var fall_speed := velocity.y
	_resolve_tiles(delta)
	if on_floor and not was_floor:
		_jumping = false
		if _air_t > 0.12:
			_land_squash = clampf(fall_speed / MAX_FALL, 0.0, 1.0) * 0.3
			landed.emit(fall_speed)
			Sfx.play("land", 0.1)
			_spawn_dust(clampf(fall_speed / MAX_FALL, 0.3, 1.0))
			if fall_speed > 380.0:
				_shake(0.08, 1.5)
		_air_t = 0.0
	elif not on_floor:
		_air_t += delta
	## Animation state for the avatar.
	if on_floor and absf(velocity.x) > 8.0:
		anim_t += delta * absf(velocity.x) / SPEED * 10.0
	elif on_floor:
		anim_t = 0.0
	_land_squash = move_toward(_land_squash, 0.0, delta * 1.6)
	queue_redraw()

## v1.8: blocks take several hits. Holding LMB (or the touch Punch button) keeps hitting.
func _hold_punch(delta: float) -> void:
	_hit_cd = maxf(_hit_cd - delta, 0.0)
	if paused or _hit_cd > 0.0:
		return
	var target := Vector2.INF
	if _touch_punch_held:
		target = global_position + Vector2(facing * Tiles.SIZE * 1.2, 0)
	elif _mouse_hold:
		if not Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT) or DisplayServer.is_touchscreen_available():
			_mouse_hold = false
			return
		target = get_global_mouse_position()
	if target == Vector2.INF:
		return
	var t: Vector2i = world.world_to_tile(target)
	if not _in_reach(t):
		return
	var id: int = world.get_tile(t.x, t.y)
	if id == Tiles.Id.AIR or _npc_at(t) != "" or id == Tiles.Id.WEATHER_MACHINE or Tiles.is_seed(id):
		return  # holding only repeats real hits: never re-opens menus or pops growing sprouts
	_punch_or_use(t)

func set_touch_punch(held: bool) -> void:
	_touch_punch_held = held
	if held and _hit_cd <= 0.0:
		## First press acts like the old tap (also opens NPC / Weather Machine); holding then repeats hits.
		touch_punch_at(global_position + Vector2(facing * Tiles.SIZE * 1.2, 0))
		_hit_cd = maxf(_hit_cd, HIT_INTERVAL)

func _unhandled_input(event: InputEvent) -> void:
	if paused:
		return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_Q or event.keycode == KEY_G:
			_drop_selected()
			get_viewport().set_input_as_handled()
			return
	## v1.9: a second finger tapping the world (while the first one holds ◀/▶) punches / uses that tile.
	## Finger 0 already arrives as an emulated mouse click below.
	if event is InputEventScreenTouch and event.pressed and (event as InputEventScreenTouch).index > 0:
		var wp: Vector2 = get_canvas_transform().affine_inverse() * (event as InputEventScreenTouch).position
		var tt: Vector2i = world.world_to_tile(wp)
		if _in_reach(tt) and _hit_cd <= 0.0:
			if world.get_tile(tt.x, tt.y) == Tiles.Id.AIR and not inv.is_fist():
				_place(tt)
			else:
				_punch_or_use(tt)
			get_viewport().set_input_as_handled()
		return
	if event is InputEventMouseButton and not event.pressed and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		_mouse_hold = false
	if event is InputEventMouseButton and event.pressed:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT:
			_mouse_hold = true
		var mouse := get_global_mouse_position()
		var t: Vector2i = world.world_to_tile(mouse)
		if not _in_reach(t):
			return
		if mb.button_index == MOUSE_BUTTON_LEFT:
			if _hit_cd <= 0.0:
				_punch_or_use(t)
		elif mb.button_index == MOUSE_BUTTON_RIGHT:
			_place(t)

func _hotbar_keys() -> void:
	if not _keys_enabled():
		return
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

## v1.7: the server rolled this break/harvest and put it in the wallet; show it like offline.
func show_server_reward(data: Dictionary) -> void:
	var bits: PackedStringArray = PackedStringArray()
	var col := Color(0.55, 1.0, 0.85)
	var first := true
	for it in data.get("items", []):
		var iid := int(it.get("id", -1))
		if iid < 0:
			continue
		bits.append("%s ×%d" % [Items.display_name(iid), int(it.get("n", 1))])
		if first:
			col = Items.rarity_color(iid)
			first = false
	var g := int(data.get("gems", 0))
	if g > 0:
		bits.append("+%dg" % g)
	if not bits.is_empty():
		_spawn_float("+%s" % " · ".join(bits), col)

func _on_tile_broken(world_pos: Vector2) -> void:
	_shake(0.18, 4.0)
	world_edited.emit()

func _shake(duration: float, magnitude: float) -> void:
	if not Settings.screen_shake:
		return
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
	if _online_session():
		## v1.7: ground drops are offline-only (rewards go straight to your server inventory).
		_spawn_float("Drop hanya di mode offline", Color(1.0, 0.7, 0.45))
		Sfx.play_ui()
		return
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
		if _net_online() and net.server_inv:
			## Server checks + charges the fertilizer and answers with a `plant` update (or an error).
			net.send_fertilize(t.x, t.y)
			Sfx.play_craft()
			return
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
		_hit_cd = HIT_INTERVAL
		if _net_online():
			net.send_punch(t.x, t.y)
			Sfx.play_harvest()
			if not net.server_inv:
				crops_harvested.emit(1)  # v1.7 servers confirm harvests with a `reward` message
			return
		var hr: Dictionary = world.try_harvest(t.x, t.y, true, inv)
		if int(hr.get("block", -1)) >= 0:
			_announce_break_rewards(hr)
			Sfx.play_harvest()
			crops_harvested.emit(1)
			world_edited.emit()
		return
	if id != Tiles.Id.AIR:
		_hit_cd = HIT_INTERVAL
		if _net_online():
			## Server counts hits (v1.8) and answers with `hit` progress or the broken `tile`.
			## Predict the crack locally so it feels instant; the server value overrides it.
			var will_break: bool = world.register_hit(t.x, t.y)
			net.send_punch(t.x, t.y)
			if will_break:
				Sfx.play_break()
			else:
				Sfx.play_footstep()
				_shake(0.05, 1.5)
			return
		if not world.register_hit(t.x, t.y):
			Sfx.play_footstep()
			_shake(0.05, 1.5)
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
			net.sync_inventory(inv)  # no-op once the server owns the inventory
		return
	if world.place_tile(t.x, t.y, id):
		inv.consume_selected(1)
		Sfx.play_place()
		if Tiles.is_seed(id):
			var main := get_parent()
			if main.has_method("notify_planted"):
				main.notify_planted()
		world_edited.emit()

## v1.8 one-way platforms: hold S / Down (or the touch ▼ button) to drop through.
var _dropping := false
var _touch_down := false
var _prev_bottom := 0.0

func set_touch_down(on: bool) -> void:
	_touch_down = on

## Solid for this body right now? Platforms only catch you from above while falling.
func _blocks(id: int, tile_top: float, vertical: bool) -> bool:
	if Tiles.is_solid(id):
		return true
	if vertical and Tiles.is_platform(id) and not _dropping and velocity.y > 0.0:
		return _prev_bottom <= tile_top + 0.5
	return false

func _resolve_tiles(delta: float) -> void:
	var pos := global_position
	## Never stay stuck inside a block (e.g. someone placed one on you): pop out upward first.
	if _overlaps_solid(pos):
		pos = _unstick(pos)
	pos.x += velocity.x * delta
	pos = _separate(pos, true)
	var before_y := pos.y
	_prev_bottom = pos.y + BODY.y * 0.5
	var want_y := pos.y + velocity.y * delta
	## Ceiling corner correction: if only the edge of the head would hit, slide around it.
	if velocity.y < 0.0 and _overlaps_solid(Vector2(pos.x, want_y)):
		for nudge in [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, CORNER_NUDGE]:
			var done := false
			for sgn in [-1.0, 1.0]:
				var np := Vector2(pos.x + sgn * nudge, want_y)
				if not _overlaps_solid(np) and not _overlaps_solid(Vector2(np.x, pos.y)):
					pos.x = np.x
					done = true
					break
			if done:
				break
	pos.y = want_y
	pos = _separate(pos, false)
	on_floor = false
	if velocity.y >= 0.0 and pos.y <= before_y + 0.01:
		if _feet_on_ground(pos):
			on_floor = true
			velocity.y = 0.0
	if pos.y > before_y + 0.01 and velocity.y < 0.0:
		velocity.y = 0.0
		_jumping = false
	pos.x = clampf(pos.x, BODY.x * 0.5, world.W * Tiles.SIZE - BODY.x * 0.5)
	pos.y = clampf(pos.y, BODY.y * 0.5, world.H * Tiles.SIZE - BODY.y * 0.5)
	global_position = pos

## True if the body at `pos` overlaps a solid tile (platforms ignored).
func _overlaps_solid(pos: Vector2) -> bool:
	var half := BODY * 0.5
	var min_t: Vector2i = world.world_to_tile(pos - half)
	var max_t: Vector2i = world.world_to_tile(pos + half - Vector2(0.01, 0.01))
	var body_r := Rect2(pos - half, BODY)
	for ty in range(min_t.y, max_t.y + 1):
		for tx in range(min_t.x, max_t.x + 1):
			if Tiles.is_solid(world.get_tile(tx, ty)) and body_r.intersects(Rect2(tx * Tiles.SIZE, ty * Tiles.SIZE, Tiles.SIZE, Tiles.SIZE)):
				return true
	return false

func _unstick(pos: Vector2) -> Vector2:
	for step in range(1, 4 * Tiles.SIZE):
		for off in [Vector2(0, -step), Vector2(-step, 0), Vector2(step, 0), Vector2(0, step)]:
			if not _overlaps_solid(pos + off):
				return pos + off
	return pos

func _feet_on_ground(pos: Vector2) -> bool:
	var foot: Vector2 = pos + Vector2(0, BODY.y * 0.5 + 1.0)
	var t: Vector2i = world.world_to_tile(foot)
	var id: int = world.get_tile(t.x, t.y)
	if Tiles.is_platform(id) and not _dropping:
		return absf(pos.y + BODY.y * 0.5 - t.y * Tiles.SIZE) <= 1.5
	return Tiles.is_solid(id)

func _separate(pos: Vector2, horizontal: bool) -> Vector2:
	var half := BODY * 0.5
	var min_t: Vector2i = world.world_to_tile(pos - half)
	var max_t: Vector2i = world.world_to_tile(pos + half - Vector2(0.01, 0.01))
	for ty in range(min_t.y, max_t.y + 1):
		for tx in range(min_t.x, max_t.x + 1):
			if not _blocks(world.get_tile(tx, ty), float(ty * Tiles.SIZE), not horizontal):
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

## v1.9: the touch Jump button is held (multi-touch) so short taps = small hops, hold = full jump.
func set_touch_jump(held: bool) -> void:
	if held and not _touch_jump_held:
		_touch_jump = true
	_touch_jump_held = held

## Release every touch input (app lost focus, panel opened, controls rebuilt).
func release_touch_inputs() -> void:
	_touch_dir = 0.0
	_touch_jump = false
	_touch_jump_held = false
	_touch_down = false
	_touch_punch_held = false

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
	var anim := {"walk": anim_t, "squash": _land_squash}
	if not on_floor:
		anim["air"] = velocity.y
	AvatarLookScript.draw_look(self, look, facing, anim)

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
