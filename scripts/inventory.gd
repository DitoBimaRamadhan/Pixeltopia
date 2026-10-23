extends Node
## Hotbar + backpack inventory + gem currency for Pixeltopia.

const Items = preload("res://scripts/items.gd")
signal changed
signal gems_changed(amount: int)

## slot index 0 = fist (no item). Slots 1..n hold item ids.
var slots: Array[int] = []
var counts: Array[int] = []
var selected: int = 0  ## hotbar index
var gems: int = 25  ## starter pocket change

func _ready() -> void:
	# Fist + starter materials + empty backpack slots
	slots = [-1, Tiles.Id.DIRT, Tiles.Id.GRASS, Tiles.Id.STONE, Tiles.Id.SEED, Tiles.Id.WOOD, Tiles.Id.TORCH, Tiles.Id.SAND, Tiles.Id.SEED_AZURE]
	counts = [0, 64, 32, 16, 16, 32, 8, 24, 8]
	for _i in range(16):
		slots.append(-1)
		counts.append(0)
	changed.emit()
	gems_changed.emit(gems)

const HOTBAR_LEN := 9  ## indices 0..8 (fist + 8); rest is backpack

func slot_count() -> int:
	return slots.size()

func hotbar_len() -> int:
	return mini(HOTBAR_LEN, slots.size())

func backpack_start() -> int:
	return hotbar_len()

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

func count_of(id: int) -> int:
	if id < 0:
		return 0
	var total := 0
	for i in range(1, slots.size()):
		if slots[i] == id:
			total += counts[i]
	return total

func can_afford(ingredients: Array) -> bool:
	for ing in ingredients:
		var need_id: int = int(ing["id"])
		var need_n: int = int(ing["count"])
		if count_of(need_id) < need_n:
			return false
	return true

func consume_item(id: int, n: int = 1) -> bool:
	if id < 0 or n <= 0:
		return false
	if count_of(id) < n:
		return false
	var left := n
	for i in range(1, slots.size()):
		if left <= 0:
			break
		if slots[i] != id or counts[i] <= 0:
			continue
		var take: int = mini(counts[i], left)
		counts[i] -= take
		left -= take
		if counts[i] <= 0:
			slots[i] = -1
			counts[i] = 0
	changed.emit()
	return left == 0

func try_craft(recipe: Dictionary) -> bool:
	var ingredients: Array = recipe.get("ingredients", [])
	if not can_afford(ingredients):
		return false
	for ing in ingredients:
		if not consume_item(int(ing["id"]), int(ing["count"])):
			return false
	add_item(int(recipe["result"]), int(recipe.get("result_count", 1)))
	return true

func add_item(id: int, n: int = 1) -> void:
	if id < 0 or n <= 0:
		return
	for i in range(1, slots.size()):
		if slots[i] == id and counts[i] > 0:
			counts[i] += n
			changed.emit()
			return
	for i in range(1, slots.size()):
		if counts[i] <= 0 or slots[i] < 0:
			slots[i] = id
			counts[i] = n
			changed.emit()
			return
	slots.append(id)
	counts.append(n)
	changed.emit()

func swap_slots(a: int, b: int) -> void:
	if a < 0 or b < 0 or a >= slots.size() or b >= slots.size():
		return
	if a == 0 or b == 0:
		return
	var sid := slots[a]
	var sc := counts[a]
	slots[a] = slots[b]
	counts[a] = counts[b]
	slots[b] = sid
	counts[b] = sc
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
		slots[selected] = -1
	changed.emit()
	return true

## Drop up to `n` of selected stack into the world (caller spawns pickup).
func take_selected_for_drop(n: int = 1) -> int:
	if is_fist():
		return -1
	var id := get_selected_id()
	if not Items.can_drop(id):
		return -1
	if selected <= 0 or counts[selected] <= 0:
		return -1
	var take := mini(n, counts[selected])
	if take <= 0:
		return -1
	counts[selected] -= take
	if counts[selected] <= 0:
		counts[selected] = 0
		slots[selected] = -1
	changed.emit()
	return id  ## caller must know count via take; use drop_selected instead

func drop_selected(n: int = 1) -> Dictionary:
	## Returns {id, n} or empty if cannot drop.
	if is_fist():
		return {}
	var id := get_selected_id()
	if not Items.can_drop(id):
		return {}
	if selected <= 0 or counts[selected] <= 0:
		return {}
	var take := mini(n, counts[selected])
	if take <= 0:
		return {}
	counts[selected] -= take
	if counts[selected] <= 0:
		counts[selected] = 0
		slots[selected] = -1
	changed.emit()
	return {"id": id, "n": take}

func add_gems(n: int) -> void:
	gems = maxi(gems + n, 0)
	gems_changed.emit(gems)
	changed.emit()

func spend_gems(n: int) -> bool:
	if n < 0 or gems < n:
		return false
	gems -= n
	gems_changed.emit(gems)
	changed.emit()
	return true

func label_for(i: int) -> String:
	if i == 0:
		return "Fist"
	if i < 0 or i >= slots.size():
		return ""
	var id: int = slots[i]
	if id < 0 or counts[i] <= 0:
		return "—"
	return "%s ×%d" % [Items.display_name(id), counts[i]]

func selected_name() -> String:
	if is_fist():
		return "Fist"
	var id := get_selected_id()
	var n := 0
	if selected >= 0 and selected < counts.size():
		n = counts[selected]
	return "%s ×%d [%s]" % [Items.display_name(id), n, Items.rarity_name(id)]

func to_save() -> Dictionary:
	return {
		"slots": slots.duplicate(),
		"counts": counts.duplicate(),
		"selected": selected,
		"gems": gems,
	}

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
	if data.has("gems"):
		gems = int(data["gems"])
	changed.emit()
	gems_changed.emit(gems)
