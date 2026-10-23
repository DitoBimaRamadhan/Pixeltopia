extends Node2D
## Grid world: generate terrain, break/place, grow seeds.

signal world_changed

const W := 64
const H := 40
const GROW_SEC := 8.0  ## seed -> crop
const SAVE_PATH := "user://pixeltopia_save.json"

var grid: PackedInt32Array = PackedInt32Array()
## key "x,y" -> time planted (seconds)
var plant_times: Dictionary = {}

func _ready() -> void:
	grid.resize(W * H)
	_generate()

func _process(_delta: float) -> void:
	_tick_growth()
	queue_redraw()  ## torch flame flicker

func idx(x: int, y: int) -> int:
	return y * W + x

func in_bounds(x: int, y: int) -> bool:
	return x >= 0 and x < W and y >= 0 and y < H

func get_tile(x: int, y: int) -> int:
	if not in_bounds(x, y):
		return Tiles.Id.STONE
	return grid[idx(x, y)]

func set_tile(x: int, y: int, id: int) -> void:
	if not in_bounds(x, y):
		return
	grid[idx(x, y)] = id
	var key := "%d,%d" % [x, y]
	if id != Tiles.Id.SEED:
		plant_times.erase(key)
	world_changed.emit()
	queue_redraw()

func _generate() -> void:
	var ground := int(H * 0.55)
	for y in range(H):
		for x in range(W):
			var id := Tiles.Id.AIR
			if y > ground + 4:
				id = Tiles.Id.STONE
			elif y > ground:
				id = Tiles.Id.DIRT
			elif y == ground:
				id = Tiles.Id.GRASS
			var bump := int(3.0 * sin(x * 0.25) + 2.0 * sin(x * 0.07))
			var gy := ground - bump
			if y > gy + 4:
				id = Tiles.Id.STONE
			elif y > gy:
				id = Tiles.Id.DIRT
			elif y == gy:
				id = Tiles.Id.GRASS
			elif y < gy:
				id = Tiles.Id.AIR
			grid[idx(x, y)] = id
	var sx := int(W / 2)
	var gy := ground - int(3.0 * sin(sx * 0.25) + 2.0 * sin(sx * 0.07))
	for dy in range(3):
		var y := gy - 1 - dy
		if in_bounds(sx - 6, y):
			grid[idx(sx - 6, y)] = Tiles.Id.WOOD
	if in_bounds(sx - 5, gy - 1):
		grid[idx(sx - 5, gy - 1)] = Tiles.Id.TORCH
	queue_redraw()

func world_to_tile(pos: Vector2) -> Vector2i:
	return Vector2i(floori(pos.x / Tiles.SIZE), floori(pos.y / Tiles.SIZE))

func tile_to_world(t: Vector2i) -> Vector2:
	return Vector2(t.x * Tiles.SIZE, t.y * Tiles.SIZE)

func break_tile(x: int, y: int) -> int:
	## Returns dropped item id, or -1.
	if not in_bounds(x, y):
		return -1
	var id := get_tile(x, y)
	if id == Tiles.Id.AIR:
		return -1
	var drop := id
	if id == Tiles.Id.SEED:
		drop = -1  ## lose unripe plant
	elif id == Tiles.Id.CROP:
		drop = Tiles.Id.CROP
	set_tile(x, y, Tiles.Id.AIR)
	return drop

func place_tile(x: int, y: int, id: int) -> bool:
	if not in_bounds(x, y):
		return false
	if get_tile(x, y) != Tiles.Id.AIR:
		return false
	if id == Tiles.Id.SEED:
		if y + 1 >= H or not Tiles.is_soil(get_tile(x, y + 1)):
			return false
		set_tile(x, y, Tiles.Id.SEED)
		plant_times["%d,%d" % [x, y]] = Time.get_ticks_msec() / 1000.0
		return true
	if id == Tiles.Id.CROP:
		return false
	if not Tiles.is_placeable(id):
		return false
	set_tile(x, y, id)
	return true

func try_harvest(x: int, y: int) -> int:
	if get_tile(x, y) != Tiles.Id.CROP:
		return -1
	set_tile(x, y, Tiles.Id.AIR)
	return Tiles.Id.CROP

func _tick_growth() -> void:
	var now := Time.get_ticks_msec() / 1000.0
	var grown: Array = []
	for key in plant_times.keys():
		var t0: float = plant_times[key]
		if now - t0 >= GROW_SEC:
			grown.append(key)
	for key in grown:
		var parts: PackedStringArray = key.split(",")
		var x := int(parts[0])
		var y := int(parts[1])
		if get_tile(x, y) == Tiles.Id.SEED:
			plant_times.erase(key)
			set_tile(x, y, Tiles.Id.CROP)

func to_save() -> Dictionary:
	var arr: Array = []
	for i in range(grid.size()):
		arr.append(int(grid[i]))
	var plants: Dictionary = {}
	for k in plant_times.keys():
		plants[str(k)] = float(plant_times[k])
	return {"w": W, "h": H, "grid": arr, "plant_times": plants}

func from_save(data: Dictionary) -> bool:
	if not data.has("grid"):
		return false
	var arr: Array = data["grid"]
	if arr.size() != W * H:
		return false
	for i in range(arr.size()):
		grid[i] = int(arr[i])
	plant_times.clear()
	if data.has("plant_times"):
		var plants: Dictionary = data["plant_times"]
		for k in plants.keys():
			plant_times[str(k)] = float(plants[k])
	world_changed.emit()
	queue_redraw()
	return true

func _draw() -> void:
	for y in range(H):
		for x in range(W):
			var id := get_tile(x, y)
			if id == Tiles.Id.AIR:
				continue
			var r := Rect2(x * Tiles.SIZE, y * Tiles.SIZE, Tiles.SIZE, Tiles.SIZE)
			if id == Tiles.Id.TORCH:
				# soft glow + stick + flame (non-solid)
				draw_circle(r.get_center(), 22.0, Color(1.0, 0.75, 0.2, 0.18))
				draw_rect(Rect2(r.position + Vector2(14, 14), Vector2(4, 16)), Color(0.45, 0.28, 0.12))
				var flicker := 0.85 + 0.15 * sin(Time.get_ticks_msec() / 90.0 + x + y)
				draw_circle(r.position + Vector2(16, 12), 5.0 * flicker, Color(1.0, 0.85, 0.25, 0.95))
				draw_circle(r.position + Vector2(16, 10), 3.0, Color(1.0, 0.45, 0.1, 0.9))
				continue
			var c := Tiles.color(id)
			draw_rect(r, c)
			draw_rect(r, c.darkened(0.25), false, 1.0)
			if id == Tiles.Id.WOOD:
				# plank lines
				draw_line(r.position + Vector2(0, 10), r.position + Vector2(Tiles.SIZE, 10), c.darkened(0.35), 1.0)
				draw_line(r.position + Vector2(0, 22), r.position + Vector2(Tiles.SIZE, 22), c.darkened(0.35), 1.0)
			elif id == Tiles.Id.SEED:
				draw_rect(Rect2(r.position + Vector2(12, 16), Vector2(8, 16)), Color(0.2, 0.5, 0.2))
			elif id == Tiles.Id.CROP:
				draw_circle(r.get_center() + Vector2(0, -4), 10.0, Color(0.95, 0.4, 0.6))
				draw_rect(Rect2(r.position + Vector2(14, 14), Vector2(4, 18)), Color(0.25, 0.55, 0.25))
