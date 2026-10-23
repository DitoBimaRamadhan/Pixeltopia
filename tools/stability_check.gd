extends SceneTree
## Headless stability checks for Pixeltopia main flows (no display).
## Run: godot --headless --path . --script res://tools/stability_check.gd

func _init() -> void:
	var failed := 0
	failed += _check_preloads()
	failed += _check_inventory_logic()
	failed += _check_splice()
	failed += _check_items_world_lock()
	failed += _check_scenes_exist()
	failed += _check_session_save()
	if failed == 0:
		print("STABILITY_CHECK PASS")
		quit(0)
	else:
		print("STABILITY_CHECK FAIL count=", failed)
		quit(1)

func _check_preloads() -> int:
	var paths := [
		"res://scripts/items.gd",
		"res://scripts/tiles.gd",
		"res://scripts/inventory.gd",
		"res://scripts/splicing.gd",
		"res://scripts/item_icon.gd",
		"res://scripts/hud.gd",
		"res://scripts/player.gd",
		"res://scripts/world.gd",
		"res://scripts/quests.gd",
		"res://scripts/ui_circle.gd",
		"res://scripts/auth/session.gd",
		"res://scripts/auth/api_client.gd",
		"res://scripts/auth/login.gd",
		"res://scripts/auth/register.gd",
		"res://scripts/auth/server_list.gd",
	]
	var bad := 0
	for p in paths:
		var s: Variant = load(p)
		if s == null:
			print("FAIL load ", p)
			bad += 1
		else:
			print("OK load ", p)
	return bad

func _check_inventory_logic() -> int:
	var Inv = load("res://scripts/inventory.gd")
	var n: Node = Inv.new()
	n._ready()
	if n.slots.size() < 9:
		print("FAIL inventory slots too small ", n.slots.size())
		n.free()
		return 1
	if n.slots.size() != n.counts.size():
		print("FAIL slots/counts mismatch")
		n.free()
		return 1
	## Corrupt save alignment
	n.from_save({"slots": [ -1, 1, 2 ], "counts": [0], "selected": 99, "gems": -5})
	if n.slots.size() != n.counts.size():
		print("FAIL from_save align")
		n.free()
		return 1
	if n.selected < 0 or n.selected >= n.slots.size():
		print("FAIL selected clamp ", n.selected)
		n.free()
		return 1
	if n.gems < 0:
		print("FAIL gems negative")
		n.free()
		return 1
	var dropped: Dictionary = {}
	## fist selected after corrupt may be 0
	n.select(1)
	if n.slots[1] >= 0:
		dropped = n.drop_selected(1)  # exercise drop
	print("OK inventory logic gems=", n.gems, " slots=", n.slots.size())
	n.free()
	return 0

func _check_splice() -> int:
	var Inv = load("res://scripts/inventory.gd")
	var n: Node = Inv.new()
	n._ready()
	## Ensure we have both seeds
	n.add_item(Tiles.Id.SEED, 2)
	n.add_item(Tiles.Id.SEED_AZURE, 2)
	var out: Dictionary = n.try_splice(Tiles.Id.SEED, Tiles.Id.SEED_AZURE)
	if not out.get("ok", false):
		print("FAIL splice ", out)
		n.free()
		return 1
	print("OK splice result=", out.get("result"))
	n.free()
	return 0

func _check_items_world_lock() -> int:
	if Tiles.Id.WORLD_LOCK != 20:
		print("FAIL WORLD_LOCK id ", Tiles.Id.WORLD_LOCK)
		return 1
	var info: Dictionary = Items.get_info(Tiles.Id.WORLD_LOCK)
	if str(info.get("name", "")) == "" or str(info.get("name")) == "Unknown":
		print("FAIL WORLD_LOCK catalog ", info)
		return 1
	if not Tiles.is_placeable(Tiles.Id.WORLD_LOCK):
		print("FAIL WORLD_LOCK not placeable")
		return 1
	var col: Color = Tiles.color(Tiles.Id.WORLD_LOCK)
	if col.a <= 0.0:
		print("FAIL WORLD_LOCK invisible color")
		return 1
	print("OK WORLD_LOCK ", info.get("name"))
	return 0

func _check_scenes_exist() -> int:
	var scenes := [
		"res://scenes/auth/login.tscn",
		"res://scenes/auth/register.tscn",
		"res://scenes/auth/server_list.tscn",
		"res://scenes/main.tscn",
	]
	var bad := 0
	for p in scenes:
		if not ResourceLoader.exists(p):
			print("FAIL missing scene ", p)
			bad += 1
		else:
			var packed: PackedScene = load(p)
			if packed == null:
				print("FAIL scene load ", p)
				bad += 1
			else:
				print("OK scene ", p)
	return bad

func _check_session_save() -> int:
	var Sess = load("res://scripts/auth/session.gd")
	var s: Node = Sess.new()
	s._ready()
	s.enter_offline("StabilityBot")
	if not s.is_logged_in():
		print("FAIL offline session not logged in")
		s.free()
		return 1
	s.clear_session()
	if s.is_logged_in():
		print("FAIL clear_session")
		s.free()
		return 1
	print("OK session")
	s.free()
	return 0
