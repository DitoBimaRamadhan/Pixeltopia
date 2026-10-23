extends Node
## Minimal hotbar inventory for Pixeltopia Phase 1.

signal changed

## slot index 0 = fist (no item). Slots 1..n hold item ids.
var slots: Array[int] = []
var counts: Array[int] = []
var selected: int = 0  ## hotbar index

func _ready() -> void:
	# Fist + starter materials (incl. Wood + Torch)
	slots = [-1, Tiles.Id.DIRT, Tiles.Id.GRASS, Tiles.Id.STONE, Tiles.Id.SEED, Tiles.Id.WOOD, Tiles.Id.TORCH]
	counts = [0, 64, 32, 16, 16, 32, 16]
	changed.emit()

func slot_count() -> int:
	return slots.size()

func get_selected_id() -> int:
	if selected < 0 or selected >= slots.size():
		return -1
	return slots[selected]

func is_fist() -> bool:
	return selected == 0 or get_selected_id() < 0

func select(i: int) -> void:
	if i < 0 or i >= slots.size():
		return
	selected = i
	changed.emit()

func add_item(id: int, n: int = 1) -> void:
	if id < 0 or n <= 0:
		return
	for i in range(1, slots.size()):
		if slots[i] == id:
			counts[i] += n
			changed.emit()
			return
	for i in range(1, slots.size()):
		if counts[i] <= 0:
			slots[i] = id
			counts[i] = n
			changed.emit()
			return
	slots.append(id)
	counts.append(n)
	changed.emit()

func consume_selected(n: int = 1) -> bool:
	if is_fist():
		return true
	if selected <= 0 or selected >= counts.size():
		return false
	if counts[selected] < n:
		return false
	counts[selected] -= n
	if counts[selected] <= 0:
		counts[selected] = 0
	changed.emit()
	return true

func label_for(i: int) -> String:
	if i == 0:
		return "Fist"
	if i < 0 or i >= slots.size():
		return ""
	var id: int = slots[i]
	if counts[i] <= 0:
		return "%s (0)" % Tiles.NAMES.get(id, "?")
	return "%s ×%d" % [Tiles.NAMES.get(id, "?"), counts[i]]

func selected_name() -> String:
	if is_fist():
		return "Fist"
	var id := get_selected_id()
	var n := 0
	if selected >= 0 and selected < counts.size():
		n = counts[selected]
	return "%s ×%d" % [Tiles.NAMES.get(id, "?"), n]

func to_save() -> Dictionary:
	return {"slots": slots.duplicate(), "counts": counts.duplicate(), "selected": selected}

func from_save(data: Dictionary) -> void:
	if data.has("slots"):
		slots.clear()
		for v in data["slots"]:
			slots.append(int(v))
	if data.has("counts"):
		counts.clear()
		for v in data["counts"]:
			counts.append(int(v))
	if data.has("selected"):
		selected = int(data["selected"])
	changed.emit()
