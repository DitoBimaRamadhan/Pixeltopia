extends Node
## Badge / achievement tracker — Growtopia-inspired loop, original Pixeltopia names.
class_name AchievementLog

signal unlocked(id: String, title: String)
signal changed

## id -> {title, blurb, icon_color, type, goal}
static func defs() -> Array:
	return [
		{"id": "first_break", "title": "Dirt Under Nails", "blurb": "Break 1 block.", "type": "break_blocks", "goal": 1, "color": Color(0.7, 0.55, 0.35)},
		{"id": "breaker_50", "title": "Block Buster", "blurb": "Break 50 blocks.", "type": "break_blocks", "goal": 50, "color": Color(0.85, 0.45, 0.3)},
		{"id": "harvester", "title": "Grove Keeper", "blurb": "Harvest 10 crops.", "type": "harvest_crops", "goal": 10, "color": Color(0.4, 0.85, 0.45)},
		{"id": "splicer", "title": "Seed Weaver", "blurb": "Complete 3 splices.", "type": "splice_seeds", "goal": 3, "color": Color(0.55, 0.75, 1.0)},
		{"id": "trader", "title": "Fair Deal", "blurb": "Finish 1 player trade.", "type": "trade_done", "goal": 1, "color": Color(1.0, 0.85, 0.35)},
		{"id": "rain_walker", "title": "Rain Walker", "blurb": "Stand in the rain for 30s.", "type": "rain_time", "goal": 30, "color": Color(0.45, 0.65, 0.95)},
		{"id": "night_owl", "title": "Night Owl", "blurb": "Play through a full night period.", "type": "night_seen", "goal": 1, "color": Color(0.35, 0.4, 0.75)},
		{"id": "level_5", "title": "Rising Star", "blurb": "Reach player level 5.", "type": "reach_level", "goal": 5, "color": Color(1.0, 0.75, 0.3)},
		{"id": "gem_pocket", "title": "Gem Pocket", "blurb": "Hold 100 gems at once.", "type": "gems_held", "goal": 100, "color": Color(0.4, 1.0, 0.85)},
	]

## id -> {progress, unlocked}
var state: Dictionary = {}

func _ready() -> void:
	_ensure()

func _ensure() -> void:
	for d in defs():
		var id: String = str(d["id"])
		if not state.has(id):
			state[id] = {"progress": 0, "unlocked": false}

func get_def(id: String) -> Dictionary:
	for d in defs():
		if str(d["id"]) == id:
			return d
	return {}

func is_unlocked(id: String) -> bool:
	return bool(state.get(id, {}).get("unlocked", false))

func progress_of(id: String) -> int:
	return int(state.get(id, {}).get("progress", 0))

func report(event_type: String, amount: int = 1) -> void:
	_ensure()
	var dirty := false
	for d in defs():
		if str(d.get("type", "")) != event_type:
			continue
		var id: String = str(d["id"])
		var st: Dictionary = state[id]
		if bool(st.get("unlocked", false)):
			continue
		var goal: int = int(d.get("goal", 1))
		## reach_level / gems_held use absolute values
		if event_type == "reach_level" or event_type == "gems_held":
			st["progress"] = maxi(int(st.get("progress", 0)), amount)
		else:
			st["progress"] = mini(int(st.get("progress", 0)) + amount, goal)
		if int(st["progress"]) >= goal:
			st["unlocked"] = true
			st["progress"] = goal
			state[id] = st
			unlocked.emit(id, str(d["title"]))
			var _sfx = get_node_or_null("/root/Sfx")
			if _sfx and _sfx.has_method("play_achievement"):
				_sfx.play_achievement()
			dirty = true
		else:
			state[id] = st
			dirty = true
	if dirty:
		changed.emit()

func unlocked_count() -> int:
	var n := 0
	for id in state.keys():
		if bool(state[id].get("unlocked", false)):
			n += 1
	return n

func to_save() -> Dictionary:
	return {"badges": state.duplicate(true)}

func from_save(data: Dictionary) -> void:
	_ensure()
	if data.has("badges"):
		var b: Dictionary = data["badges"]
		for k in b.keys():
			state[str(k)] = b[k]
	changed.emit()
