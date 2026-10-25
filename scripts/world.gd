extends Node2D
## Grid world: generate terrain, break/place, grow seeds, ground drops.

const Items = preload("res://scripts/items.gd")
signal world_changed
signal tile_broken(world_pos: Vector2)

const W := 64
const H := 40
const SAVE_PATH := "user://pixeltopia_save.json"
const PICKUP_RADIUS := 28.0
const FERTILIZER_FACTOR := 0.5  ## remaining grow time multiplier

var grid: PackedInt32Array = PackedInt32Array()
## key "x,y" -> time planted (seconds, Time.get_ticks_msec/1000)
var plant_times: Dictionary = {}
## key "x,y" -> grow-time multiplier (1.0 default; fertilizer lowers)
var grow_boost: Dictionary = {}
## Ground drops: [{ "x": float, "y": float, "id": int, "n": int }]
var drops: Array = []
var world_seed: int = 0
var spawn_tile: Vector2i = Vector2i(32, 10)
## Friendly NPCs (tile positions). Original characters — not from any commercial game.
var npcs: Array = []  # [{id, role, name, x, y}]

func _ready() -> void:
	grid.resize(W * H)
	_generate(-1)

func _process(_delta: float) -> void:
	_tick_growth()
	queue_redraw()

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
	if not Tiles.is_seed(id):
		plant_times.erase(key)
		grow_boost.erase(key)
	world_changed.emit()
	queue_redraw()

func _surface_y(rng: RandomNumberGenerator, x: int, ground: int) -> int:
	var bump := int(3.0 * sin(x * 0.25 + rng.randf() * 0.01) + 2.0 * sin(x * 0.07))
	## Flatten center for safe spawn
	var cx := int(W / 2)
	var dist := absi(x - cx)
	if dist < 8:
		bump = int(bump * (dist / 8.0))
	return ground - bump

func _generate(seed_val: int = -1) -> void:
	var rng := RandomNumberGenerator.new()
	if seed_val < 0:
		world_seed = int(Time.get_unix_time_from_system()) ^ (Time.get_ticks_msec() * 2654435761)
		if world_seed == 0:
			world_seed = 42
	else:
		world_seed = seed_val
	rng.seed = world_seed as int

	var ground := int(H * 0.55)
	for y in range(H):
		for x in range(W):
			var gy := _surface_y(rng, x, ground)
			var id := Tiles.Id.AIR
			if y > gy + 5:
				id = Tiles.Id.STONE
			elif y > gy:
				id = Tiles.Id.DIRT
			elif y == gy:
				## Sand near low-left "beach" patches
				if x < 14 and rng.randf() < 0.55:
					id = Tiles.Id.SAND
				else:
					id = Tiles.Id.GRASS
			else:
				id = Tiles.Id.AIR
			grid[idx(x, y)] = id

	## Stone layers + small caves under surface
	for y in range(H):
		for x in range(W):
			var gy := _surface_y(rng, x, ground)
			if y <= gy:
				continue
			if y > gy + 2 and y < gy + 8:
				var n := rng.randf()
				if n < 0.12:
					grid[idx(x, y)] = Tiles.Id.AIR  ## cave pocket
				elif n < 0.22 and y > gy + 4:
					grid[idx(x, y)] = Tiles.Id.STONE

	## Surface trees (Wood trunks)
	var tree_count := 0
	var attempts := 0
	while tree_count < 7 and attempts < 40:
		attempts += 1
		var tx := rng.randi_range(4, W - 5)
		if absi(tx - int(W / 2)) < 6:
			continue
		var gy := _surface_y(rng, tx, ground)
		var trunk_h := rng.randi_range(3, 5)
		var blocked := false
		for dy in range(1, trunk_h + 1):
			if not in_bounds(tx, gy - dy) or get_tile(tx, gy - dy) != Tiles.Id.AIR:
				blocked = true
				break
		if blocked:
			continue
		for dy in range(1, trunk_h + 1):
			grid[idx(tx, gy - dy)] = Tiles.Id.WOOD
		## Tiny canopy hint (wood blocks beside top)
		var top := gy - trunk_h
		if in_bounds(tx - 1, top) and get_tile(tx - 1, top) == Tiles.Id.AIR:
			grid[idx(tx - 1, top)] = Tiles.Id.WOOD
		if in_bounds(tx + 1, top) and get_tile(tx + 1, top) == Tiles.Id.AIR:
			grid[idx(tx + 1, top)] = Tiles.Id.WOOD
		tree_count += 1

	## Starter props near flat spawn
	var sx := int(W / 2)
	var sgy := _surface_y(rng, sx, ground)
	spawn_tile = Vector2i(sx, maxi(sgy - 2, 1))
	## Clear air column at spawn
	for dy in range(1, 4):
		if in_bounds(sx, sgy - dy):
			grid[idx(sx, sgy - dy)] = Tiles.Id.AIR
	if in_bounds(sx - 5, sgy - 1):
		grid[idx(sx - 5, sgy - 1)] = Tiles.Id.TORCH
	if in_bounds(sx + 3, sgy - 1):
		grid[idx(sx + 3, sgy - 1)] = Tiles.Id.WEATHER_MACHINE

	## Quest guide only (Store is a HUD panel — no merchant NPC).
	npcs = [
		{"id": "quill", "role": "quest", "name": "Quill the Guide", "x": sx + 5, "y": sgy - 1},
	]
	for n in npcs:
		var nx: int = int(n["x"])
		var ny: int = int(n["y"])
		if in_bounds(nx, ny):
			grid[idx(nx, ny)] = Tiles.Id.AIR

	plant_times.clear()
	grow_boost.clear()
	drops.clear()
	world_changed.emit()
	queue_redraw()

func regenerate(seed_val: int = -1) -> void:
	_generate(seed_val)

func world_to_tile(pos: Vector2) -> Vector2i:
	return Vector2i(floori(pos.x / Tiles.SIZE), floori(pos.y / Tiles.SIZE))

func tile_to_world(t: Vector2i) -> Vector2:
	return Vector2(t.x * Tiles.SIZE, t.y * Tiles.SIZE)

func spawn_drop(tile_x: int, tile_y: int, item_id: int, n: int = 1) -> void:
	if item_id < 0 or n <= 0:
		return
	var pos := tile_to_world(Vector2i(tile_x, tile_y)) + Vector2(Tiles.SIZE * 0.5, Tiles.SIZE * 0.5)
	drops.append({"x": pos.x, "y": pos.y, "id": item_id, "n": n})
	queue_redraw()

func try_pickup_at(pos: Vector2, inv: Node) -> int:
	## Returns number of stacks picked up.
	var picked := 0
	var i := 0
	while i < drops.size():
		var d: Dictionary = drops[i]
		var dp := Vector2(float(d["x"]), float(d["y"]))
		if pos.distance_to(dp) <= PICKUP_RADIUS:
			inv.add_item(int(d["id"]), int(d.get("n", 1)))
			drops.remove_at(i)
			picked += 1
		else:
			i += 1
	if picked > 0:
		queue_redraw()
	return picked

func break_tile(x: int, y: int, drop_to_ground: bool = true, inv: Node = null) -> Dictionary:
	## Break a tile and roll farmable/non-farmable drops.
	## Returns { "block": id|-1, "seed": id|-1, "gems": n }.
	var result := {"block": -1, "seed": -1, "gems": 0}
	if not in_bounds(x, y):
		return result
	var id := get_tile(x, y)
	if id == Tiles.Id.AIR:
		return result
	## Unripe seeds are lost (no block drop), but may still drip a tiny gem chance.
	var is_unripe := Tiles.is_seed(id)
	set_tile(x, y, Tiles.Id.AIR)
	tile_broken.emit(tile_to_world(Vector2i(x, y)) + Vector2(Tiles.SIZE * 0.5, Tiles.SIZE * 0.5))
	var rng := RandomNumberGenerator.new()
	rng.randomize()
	## Block drop: farmable nearly always; non-farmable weaker/smaller chance.
	if not is_unripe and Items.can_drop(id) and rng.randf() < Items.block_drop_chance(id):
		result["block"] = id
		if drop_to_ground:
			spawn_drop(x, y, id, 1)
	## Seed chance (higher for farmable).
	var seed_id := Items.seed_drop_for(id)
	if seed_id >= 0 and rng.randf() < Items.seed_drop_chance(id):
		result["seed"] = seed_id
		if drop_to_ground:
			spawn_drop(x, y, seed_id, 1)
	## Gem chance (higher + more for farmable).
	if rng.randf() < Items.gem_drop_chance(id):
		var g := Items.gem_drop_amount(id, rng)
		result["gems"] = g
		if inv != null and inv.has_method("add_gems"):
			inv.add_gems(g)
	return result

func place_tile(x: int, y: int, id: int) -> bool:
	if not in_bounds(x, y):
		return false
	if get_tile(x, y) != Tiles.Id.AIR:
		return false
	if Tiles.is_usable_item(id):
		return false
	if Tiles.is_seed(id):
		if y + 1 >= H or not Tiles.is_soil(get_tile(x, y + 1)):
			return false
		set_tile(x, y, id)
		plant_times["%d,%d" % [x, y]] = Time.get_ticks_msec() / 1000.0
		grow_boost["%d,%d" % [x, y]] = 1.0
		return true
	if Tiles.is_crop(id):
		return false
	if not Tiles.is_placeable(id):
		return false
	set_tile(x, y, id)
	return true

func try_harvest(x: int, y: int, drop_to_ground: bool = true, inv: Node = null) -> Dictionary:
	## Harvest mature crop: always drop crop; farmable seed/gem rolls apply.
	var result := {"block": -1, "seed": -1, "gems": 0}
	var id := get_tile(x, y)
	if not Tiles.is_crop(id):
		return result
	set_tile(x, y, Tiles.Id.AIR)
	result["block"] = id
	if drop_to_ground:
		spawn_drop(x, y, id, 1)
	var rng := RandomNumberGenerator.new()
	rng.randomize()
	## Farmable crops: high seed chance (bonus beyond the guaranteed? roll extra or guarantee one).
	## Guarantee one seed for harvest feel, plus farmable gem roll.
	var seed_id := Tiles.seed_for_crop(id)
	result["seed"] = seed_id
	if drop_to_ground:
		spawn_drop(x, y, seed_id, 1)
	## Extra seed chance when farmable
	if Items.is_farmable(id) and rng.randf() < 0.25:
		if drop_to_ground:
			spawn_drop(x, y, seed_id, 1)
	if rng.randf() < Items.gem_drop_chance(id):
		var g := Items.gem_drop_amount(id, rng)
		result["gems"] = g
		if inv != null and inv.has_method("add_gems"):
			inv.add_gems(g)
	return result

## v1.7 online: the server owns grow times. Seed at (x, y) is ready in `ready_in_ms`
## (weather does not change online grow times).
var online_growth: bool = false

func set_plant_ready_in(x: int, y: int, ready_in_ms: float, boosted: bool = false) -> void:
	if not in_bounds(x, y):
		return
	var id := get_tile(x, y)
	if not Tiles.is_seed(id):
		return
	var key := "%d,%d" % [x, y]
	var mult := FERTILIZER_FACTOR if boosted else 1.0
	var now := Time.get_ticks_msec() / 1000.0
	grow_boost[key] = mult
	plant_times[key] = now - (Tiles.grow_seconds(id) * mult - maxf(ready_in_ms, 0.0) / 1000.0)
	queue_redraw()

func try_fertilize(x: int, y: int) -> bool:
	## Halves remaining grow time once per plant (stacks at most to 0.5).
	if not in_bounds(x, y):
		return false
	var id := get_tile(x, y)
	if not Tiles.is_seed(id):
		return false
	var key := "%d,%d" % [x, y]
	if not plant_times.has(key):
		return false
	var cur: float = float(grow_boost.get(key, 1.0))
	if cur <= FERTILIZER_FACTOR + 0.01:
		return false  ## already fertilized
	## Pull plant_time forward so remaining duration is halved
	var need := Tiles.grow_seconds(id) * cur
	var now := Time.get_ticks_msec() / 1000.0
	var planted: float = float(plant_times[key])
	var elapsed := now - planted
	var remain := maxf(need - elapsed, 0.0)
	var new_need := remain * FERTILIZER_FACTOR
	## Store as if planted later with boost 0.5 against base grow_seconds
	grow_boost[key] = FERTILIZER_FACTOR
	plant_times[key] = now - (Tiles.grow_seconds(id) * FERTILIZER_FACTOR - new_need)
	world_changed.emit()
	queue_redraw()
	return true

func _tick_growth() -> void:
	var now := Time.get_ticks_msec() / 1000.0
	var grown: Array = []
	for key in plant_times.keys():
		var t0: float = plant_times[key]
		var parts0: PackedStringArray = str(key).split(",")
		var sx := int(parts0[0])
		var sy := int(parts0[1])
		var sid := get_tile(sx, sy)
		var base := Tiles.grow_seconds(sid)
		if base < 0.0:
			continue
		var mult: float = float(grow_boost.get(key, 1.0))
		var wnode := get_parent().get_node_or_null("Weather") if get_parent() and not online_growth else null
		if wnode and wnode.has_method("growth_multiplier"):
			mult *= float(wnode.growth_multiplier())
		var need := base * mult
		if now - t0 >= need:
			grown.append(key)
	for key in grown:
		var parts: PackedStringArray = key.split(",")
		var x := int(parts[0])
		var y := int(parts[1])
		var sid2 := get_tile(x, y)
		if Tiles.is_seed(sid2):
			plant_times.erase(key)
			grow_boost.erase(key)
			set_tile(x, y, Tiles.crop_for_seed(sid2))


func npc_at(x: int, y: int) -> String:
	for n in npcs:
		if int(n["x"]) == x and int(n["y"]) == y:
			return str(n.get("role", ""))
	return ""

func npc_info_at(x: int, y: int) -> Dictionary:
	for n in npcs:
		if int(n["x"]) == x and int(n["y"]) == y:
			return n
	return {}

func to_save() -> Dictionary:
	var arr: Array = []
	for i in range(grid.size()):
		arr.append(int(grid[i]))
	var plants: Dictionary = {}
	for k in plant_times.keys():
		plants[str(k)] = float(plant_times[k])
	var boosts: Dictionary = {}
	for k in grow_boost.keys():
		boosts[str(k)] = float(grow_boost[k])
	var drop_arr: Array = []
	for d in drops:
		drop_arr.append(d)
	return {
		"w": W,
		"h": H,
		"grid": arr,
		"plant_times": plants,
		"grow_boost": boosts,
		"drops": drop_arr,
		"world_seed": world_seed,
		"spawn_x": spawn_tile.x,
		"spawn_y": spawn_tile.y,
		"npcs": npcs.duplicate(true),
	}

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
	grow_boost.clear()
	if data.has("grow_boost"):
		var boosts: Dictionary = data["grow_boost"]
		for k in boosts.keys():
			grow_boost[str(k)] = float(boosts[k])
	drops.clear()
	if data.has("drops"):
		for d in data["drops"]:
			if typeof(d) == TYPE_DICTIONARY:
				drops.append(d)
	if data.has("world_seed"):
		world_seed = int(data["world_seed"])
	if data.has("spawn_x") and data.has("spawn_y"):
		spawn_tile = Vector2i(int(data["spawn_x"]), int(data["spawn_y"]))
	if data.has("npcs"):
		npcs = []
		for n in data["npcs"]:
			if typeof(n) == TYPE_DICTIONARY:
				## Drop retired Mira merchant NPC from older saves.
				if str(n.get("id", "")) == "mira" or str(n.get("role", "")) == "shop":
					continue
				npcs.append(n)
	elif npcs.is_empty():
		var sx2 := spawn_tile.x
		var sy2 := spawn_tile.y + 1
		npcs = [
			{"id": "quill", "role": "quest", "name": "Quill the Guide", "x": sx2 + 5, "y": sy2 - 1},
		]
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
				draw_line(r.position + Vector2(0, 10), r.position + Vector2(Tiles.SIZE, 10), c.darkened(0.35), 1.0)
				draw_line(r.position + Vector2(0, 22), r.position + Vector2(Tiles.SIZE, 22), c.darkened(0.35), 1.0)
			elif id == Tiles.Id.PLANK:
				draw_line(r.position + Vector2(0, 8), r.position + Vector2(Tiles.SIZE, 8), c.darkened(0.3), 1.0)
				draw_line(r.position + Vector2(0, 16), r.position + Vector2(Tiles.SIZE, 16), c.darkened(0.3), 1.0)
				draw_line(r.position + Vector2(0, 24), r.position + Vector2(Tiles.SIZE, 24), c.darkened(0.3), 1.0)
			elif id == Tiles.Id.SAND:
				draw_circle(r.position + Vector2(8, 10), 2.0, c.darkened(0.15))
				draw_circle(r.position + Vector2(22, 18), 2.5, c.darkened(0.2))
			elif id == Tiles.Id.SEED or id == Tiles.Id.SEED_AZURE:
				var stem := Color(0.2, 0.5, 0.2) if id == Tiles.Id.SEED else Color(0.2, 0.4, 0.65)
				draw_rect(Rect2(r.position + Vector2(12, 16), Vector2(8, 16)), stem)
				var key := "%d,%d" % [x, y]
				if float(grow_boost.get(key, 1.0)) < 0.99:
					draw_circle(r.position + Vector2(26, 8), 3.0, Color(0.6, 0.95, 0.3))
			elif id == Tiles.Id.CROP:
				draw_circle(r.get_center() + Vector2(0, -4), 10.0, Color(0.95, 0.4, 0.6))
				draw_rect(Rect2(r.position + Vector2(14, 14), Vector2(4, 18)), Color(0.25, 0.55, 0.25))
			elif id == Tiles.Id.CROP_AZURE:
				draw_circle(r.get_center() + Vector2(0, -4), 10.0, Color(0.4, 0.55, 1.0))
				draw_circle(r.get_center() + Vector2(-4, -6), 3.0, Color(0.75, 0.9, 1.0))
				draw_rect(Rect2(r.position + Vector2(14, 14), Vector2(4, 18)), Color(0.2, 0.35, 0.55))
			elif id == Tiles.Id.WORLD_LOCK:
				draw_rect(Rect2(r.position + Vector2(6, 6), Vector2(20, 20)), Color(1.0, 0.85, 0.2))
				draw_circle(r.get_center(), 6.0, Color(0.55, 0.35, 0.1))
			elif id == Tiles.Id.WEATHER_MACHINE:
				draw_rect(Rect2(r.position + Vector2(4, 8), Vector2(24, 24)), Color(0.25, 0.35, 0.5))
				draw_rect(Rect2(r.position + Vector2(6, 10), Vector2(20, 14)), Color(0.4, 0.75, 1.0))
				draw_circle(r.position + Vector2(16, 17), 5.0, Color(1.0, 0.9, 0.35))
				draw_rect(Rect2(r.position + Vector2(10, 26), Vector2(12, 4)), Color(0.7, 0.75, 0.85))
	## Ground item drops (rarity-tinted floaties)
	for d in drops:
		var id2: int = int(d["id"])
		var p := Vector2(float(d["x"]), float(d["y"]))
		var bob := sin(Time.get_ticks_msec() / 200.0 + p.x * 0.1) * 2.0
		var col := Tiles.color(id2)
		var rar := Items.rarity_color(id2)
		draw_circle(p + Vector2(0, bob), 9.0, Color(rar.r, rar.g, rar.b, 0.35))
		draw_circle(p + Vector2(0, bob), 7.0, col)
		draw_circle(p + Vector2(0, bob), 7.0, rar, false, 2.0)
	## NPCs
	for n in npcs:
		var nx: int = int(n["x"])
		var ny: int = int(n["y"])
		var base := Vector2(nx * Tiles.SIZE, ny * Tiles.SIZE)
		var role := str(n.get("role", ""))
		var body_col := Color(0.95, 0.7, 0.35) if role == "shop" else Color(0.55, 0.75, 1.0)
		draw_rect(Rect2(base + Vector2(8, 4), Vector2(16, 24)), body_col)
		draw_circle(base + Vector2(16, 8), 6.0, body_col.lightened(0.25))
		# tiny badge
		var badge := Color(1.0, 0.85, 0.2) if role == "shop" else Color(0.4, 1.0, 0.55)
		draw_rect(Rect2(base + Vector2(10, -6), Vector2(12, 8)), badge)
