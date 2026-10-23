extends Node2D
## Pixeltopia player: move, jump, punch/break, place, plant/harvest.

const SPEED := 160.0
const JUMP_V := -320.0
const GRAVITY := 900.0
const REACH := 3  ## tiles
const BODY := Vector2(20, 28)

@onready var world: Node2D = get_parent().get_node("World")
@onready var inv: Node = get_parent().get_node("Inventory")
@onready var body_rect: ColorRect = $Body
@onready var float_layer: Node2D = get_parent().get_node("FloatLayer")

var velocity: Vector2 = Vector2.ZERO
var facing: int = 1
var on_floor: bool = false
var paused: bool = false

func _ready() -> void:
	_spawn_default()

func _spawn_default() -> void:
	var tx := int(world.W / 2)
	var spawn_y := 2
	for y in range(world.H):
		if Tiles.is_solid(world.get_tile(tx, y)):
			spawn_y = maxi(y - 2, 1)
			break
	global_position = Vector2(tx * Tiles.SIZE + Tiles.SIZE * 0.5, spawn_y * Tiles.SIZE)

func apply_save_pos(pos: Vector2) -> void:
	global_position = pos
	velocity = Vector2.ZERO

func _physics_process(delta: float) -> void:
	if paused:
		return
	var dir := 0.0
	if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
		dir -= 1.0
	if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
		dir += 1.0
	velocity.x = dir * SPEED
	if dir != 0.0:
		facing = 1 if dir > 0.0 else -1
		body_rect.scale.x = float(facing)

	if not on_floor:
		velocity.y += GRAVITY * delta
	elif Input.is_key_pressed(KEY_SPACE) or Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
		velocity.y = JUMP_V
		on_floor = false

	_resolve_tiles(delta)
	_hotbar_keys()

func _unhandled_input(event: InputEvent) -> void:
	if paused:
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
	for i in range(mini(9, inv.slot_count())):
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

func _punch_or_use(t: Vector2i) -> void:
	var id: int = world.get_tile(t.x, t.y)
	if id == Tiles.Id.CROP:
		var drop: int = world.try_harvest(t.x, t.y)
		if drop >= 0:
			inv.add_item(drop, 1)
			inv.add_item(Tiles.Id.SEED, 1)
			_spawn_float("+1 Groveberry", Color(1.0, 0.55, 0.75))
		return
	if id != Tiles.Id.AIR:
		var drop2: int = world.break_tile(t.x, t.y)
		if drop2 >= 0:
			inv.add_item(drop2, 1)
			var nm: String = Tiles.NAMES.get(drop2, "Item")
			_spawn_float("+1 %s" % nm, Tiles.color(drop2).lightened(0.35))
		return
	if not inv.is_fist():
		_place(t)

func _place(t: Vector2i) -> void:
	if inv.is_fist():
		return
	var id: int = inv.get_selected_id()
	if inv.selected <= 0 or inv.counts[inv.selected] <= 0:
		return
	if world.place_tile(t.x, t.y, id):
		inv.consume_selected(1)

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
