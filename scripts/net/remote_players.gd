extends Node2D
## Draws other players from multiplayer snap / join events.

var others: Dictionary = {}

func clear_all() -> void:
	others.clear()
	queue_redraw()

func apply_snap(arr: Array) -> void:
	var seen := {}
	for o in arr:
		if typeof(o) != TYPE_DICTIONARY:
			continue
		var id := str(o.get("i", ""))
		if id.is_empty():
			continue
		seen[id] = true
		var prev: Dictionary = others.get(id, {})
		var entry := {
			"u": str(o.get("u", "?")),
			"x": float(o.get("x", 0)),
			"y": float(o.get("y", 0)),
			"px": float(o.get("px", -1)),
			"py": float(o.get("py", -1)),
		}
		## v1.9: keep the drawn position and glide toward the new snapshot instead of teleporting.
		if prev.has("dx"):
			entry["dx"] = prev["dx"]
			entry["dy"] = prev["dy"]
			entry["f"] = prev.get("f", 1)
			entry["walk"] = prev.get("walk", 0.0)
		others[id] = entry
	var drop: Array = []
	for id in others.keys():
		if not seen.has(id):
			drop.append(id)
	for id in drop:
		others.erase(id)
	queue_redraw()

func add_player(p: Dictionary) -> void:
	var id := str(p.get("i", p.get("id", "")))
	if id.is_empty():
		return
	others[id] = {
		"u": str(p.get("u", p.get("username", "?"))),
		"x": float(p.get("x", 0)),
		"y": float(p.get("y", 0)),
		"px": -1.0,
		"py": -1.0,
	}
	queue_redraw()

func remove_player(id: String) -> void:
	others.erase(id)
	queue_redraw()

func nearest_other(from_tile: Vector2i, max_dist: int = 6) -> Dictionary:
	var best := {}
	var best_d := 9999
	for id in others.keys():
		var o: Dictionary = others[id]
		var ox := int(o.get("x", 0))
		var oy := int(o.get("y", 0))
		var d := absi(ox - from_tile.x) + absi(oy - from_tile.y)
		if d < best_d and d <= max_dist:
			best_d = d
			best = {"id": id, "u": o.get("u", "?"), "x": ox, "y": oy}
	return best

static func _target(o: Dictionary) -> Vector2:
	if float(o.get("px", -1)) >= 0.0:
		return Vector2(float(o["px"]), float(o["py"]))
	return Vector2(float(o["x"]) * Tiles.SIZE + Tiles.SIZE * 0.5, float(o["y"]) * Tiles.SIZE + Tiles.SIZE * 0.5)

var _looks: Dictionary = {}  ## username -> AvatarLook (stable colours per name)

func _look_for(u: String):
	if not _looks.has(u):
		var L = load("res://scripts/avatar.gd").new()
		var h := absi(hash(u))
		L.skin_i = h % L.SKIN.size()
		L.hair_i = (h / 7) % L.HAIR.size()
		L.clothes_i = (h / 31) % L.CLOTHES.size()
		L.accessory_i = (h / 131) % L.ACCESSORY.size()
		_looks[u] = L
	return _looks[u]

func _process(delta: float) -> void:
	if others.is_empty():
		return
	for id in others.keys():
		var o: Dictionary = others[id]
		var t := _target(o)
		if not o.has("dx") or Vector2(float(o["dx"]), float(o["dy"])).distance_to(t) > Tiles.SIZE * 6:
			o["dx"] = t.x
			o["dy"] = t.y
			continue
		var cur := Vector2(float(o["dx"]), float(o["dy"]))
		var nxt := cur.lerp(t, clampf(delta * 14.0, 0.0, 1.0))
		var vx := (nxt.x - cur.x) / maxf(delta, 0.001)
		if absf(vx) > 10.0:
			o["f"] = 1 if vx > 0.0 else -1
			o["walk"] = float(o.get("walk", 0.0)) + delta * 10.0
		else:
			o["walk"] = 0.0
		o["air"] = absf(nxt.y - t.y) > 2.0 or absf(nxt.y - cur.y) > 0.6
		o["vy"] = (nxt.y - cur.y) / maxf(delta, 0.001)
		o["dx"] = nxt.x
		o["dy"] = nxt.y
	queue_redraw()

func _draw() -> void:
	var L = load("res://scripts/avatar.gd")
	for id in others.keys():
		var o: Dictionary = others[id]
		var pos := Vector2(float(o.get("dx", _target(o).x)), float(o.get("dy", _target(o).y)))
		var u := str(o.get("u", "?"))
		var anim := {"walk": float(o.get("walk", 0.0)), "origin": pos}
		if o.get("air", false):
			anim["air"] = float(o.get("vy", 0.0))
		L.draw_look(self, _look_for(u), int(o.get("f", 1)), anim)
		var fs := 12
		var tw := ThemeDB.fallback_font.get_string_size(u, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		draw_string(ThemeDB.fallback_font, pos + Vector2(-tw * 0.5, -22), u, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(1, 1, 1, 0.95))
