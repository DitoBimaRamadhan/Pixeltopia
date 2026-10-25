extends Node
## Simple single-player quest tracker for Pixeltopia (original quests).
const Items = preload("res://scripts/items.gd")

signal changed

## Active / available quest definitions (data).
static func defs() -> Array:
	return [
	{
		"id": "harvest_10",
		"title": "First Harvest",
		"blurb": "Harvest 10 mature crops (any farmable crop).",
		"goal": 10,
		"type": "harvest_crops",
		"reward_gems": 40,
		"reward_item": Tiles.Id.FERTILIZER,
		"reward_count": 3,
	},
	{
		"id": "plant_5",
		"title": "Green Thumb",
		"blurb": "Plant 5 seeds on soil.",
		"goal": 5,
		"type": "plant_seeds",
		"reward_gems": 25,
		"reward_item": Tiles.Id.SEED_AZURE,
		"reward_count": 4,
	},
	{
		"id": "splice_3",
		"title": "Seed Discovery",
		"blurb": "Splice seeds 3 times (Y key or Splice button) to discover new crops.",
		"goal": 3,
		"type": "splice_seeds",
		"reward_gems": 50,
		"reward_item": Tiles.Id.SEED_EMBER,
		"reward_count": 2,
	},
	]

## quest_id -> {accepted, progress, claimed}
var state: Dictionary = {}

func _ready() -> void:
	for d in defs():
		var qid: String = str(d["id"])
		if not state.has(qid):
			state[qid] = {"accepted": false, "progress": 0, "claimed": false}

func ensure() -> void:
	for d in defs():
		var qid: String = str(d["id"])
		if not state.has(qid):
			state[qid] = {"accepted": false, "progress": 0, "claimed": false}

func get_def(qid: String) -> Dictionary:
	for d in defs():
		if str(d["id"]) == qid:
			return d
	return {}

func accept(qid: String) -> bool:
	ensure()
	if not state.has(qid):
		return false
	var st: Dictionary = state[qid]
	if bool(st.get("claimed", false)):
		return false
	st["accepted"] = true
	state[qid] = st
	changed.emit()
	return true

func is_accepted(qid: String) -> bool:
	return bool(state.get(qid, {}).get("accepted", false))

func is_complete(qid: String) -> bool:
	var d := get_def(qid)
	if d.is_empty():
		return false
	var st: Dictionary = state.get(qid, {})
	return int(st.get("progress", 0)) >= int(d.get("goal", 999))

func is_claimed(qid: String) -> bool:
	return bool(state.get(qid, {}).get("claimed", false))

func progress_of(qid: String) -> int:
	return int(state.get(qid, {}).get("progress", 0))

func report(event_type: String, amount: int = 1) -> void:
	ensure()
	var dirty := false
	for d in defs():
		if str(d.get("type", "")) != event_type:
			continue
		var qid: String = str(d["id"])
		var st: Dictionary = state[qid]
		if not bool(st.get("accepted", false)) or bool(st.get("claimed", false)):
			continue
		var goal: int = int(d.get("goal", 1))
		st["progress"] = mini(int(st.get("progress", 0)) + amount, goal)
		state[qid] = st
		dirty = true
	if dirty:
		changed.emit()

func claim(qid: String, inv: Node) -> bool:
	ensure()
	if not is_accepted(qid) or not is_complete(qid) or is_claimed(qid):
		return false
	var d := get_def(qid)
	if d.is_empty():
		return false
	inv.add_gems(int(d.get("reward_gems", 0)))
	var main := get_parent()
	if main and main.get("progress") and main.progress.has_method("report_quest"):
		main.progress.report_quest()
	var rid: int = int(d.get("reward_item", -1))
	var rc: int = int(d.get("reward_count", 0))
	if rid >= 0 and rc > 0:
		inv.add_item(rid, rc)
	var st: Dictionary = state[qid]
	st["claimed"] = true
	state[qid] = st
	changed.emit()
	return true

## v1.7 online: progress + claimed come from the server (ledger), claims are server requests.
func apply_server_state(progress: Dictionary, claimed: Array) -> void:
	ensure()
	for d in defs():
		var qid: String = str(d["id"])
		var st: Dictionary = state[qid]
		st["progress"] = mini(int(progress.get(qid, st.get("progress", 0))), int(d.get("goal", 1)))
		st["claimed"] = claimed.has(qid)
		if st["claimed"]:
			st["accepted"] = true
		state[qid] = st
	changed.emit()

func mark_claimed(qid: String) -> void:
	ensure()
	if not state.has(qid):
		return
	var st: Dictionary = state[qid]
	st["claimed"] = true
	st["accepted"] = true
	state[qid] = st
	var main := get_parent()
	if main and main.get("progress") and main.progress.has_method("report_quest"):
		main.progress.report_quest()
	changed.emit()

func to_save() -> Dictionary:
	return {"quests": state.duplicate(true)}

func from_save(data: Dictionary) -> void:
	ensure()
	if data.has("quests"):
		var q: Dictionary = data["quests"]
		for k in q.keys():
			state[str(k)] = q[k]
	changed.emit()
