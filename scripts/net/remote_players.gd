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
		others[id] = {
			"u": str(o.get("u", "?")),
			"x": float(o.get("x", 0)),
			"y": float(o.get("y", 0)),
			"px": float(o.get("px", -1)),
			"py": float(o.get("py", -1)),
		}
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

func _draw() -> void:
	for id in others.keys():
		var o: Dictionary = others[id]
		var pos: Vector2
		if float(o.get("px", -1)) >= 0.0:
			pos = Vector2(float(o["px"]), float(o["py"]))
		else:
			pos = Vector2(float(o["x"]) * Tiles.SIZE + Tiles.SIZE * 0.5, float(o["y"]) * Tiles.SIZE + Tiles.SIZE * 0.5)
		draw_circle(pos + Vector2(0, -8), 10.0, Color(0.35, 0.75, 1.0, 0.9))
		draw_rect(Rect2(pos + Vector2(-8, -4), Vector2(16, 22)), Color(0.25, 0.55, 0.95, 0.85))
		draw_string(ThemeDB.fallback_font, pos + Vector2(-20, -18), str(o.get("u", "?")), HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(1, 1, 1, 0.95))
