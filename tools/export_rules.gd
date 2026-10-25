extends SceneTree
## Export Pixeltopia game rules (tiles, items, recipes, splicing, quests, starter kit, drop rolls)
## to JSON so the server port (server/lib/rules.js) can be parity-tested without Godot.
## Run: godot --headless --path . --script res://tools/export_rules.gd -- [out.json]
## Default output: res://server/test/fixtures/rules_export.json

const Quests = preload("res://scripts/quests.gd")
const InventoryScript = preload("res://scripts/inventory.gd")
const WorldScript = preload("res://scripts/world.gd")

const ID_MIN := -1
const ID_MAX := 22  ## a couple of unknown ids past WORLD_LOCK (20)
const MC_TRIALS := 20000
const GEM_SAMPLES := 4000

func _init() -> void:
	var out_path := "res://server/test/fixtures/rules_export.json"
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out_path = args[0]
	var data := {
		"godot": Engine.get_version_info().get("string", ""),
		"tile_ids": _tile_ids(),
		"tiles": _tiles(),
		"items": _items(),
		"store_stock": _store_stock(),
		"recipes": Recipes.all(),
		"splice": _splice(),
		"quests": Quests.defs(),
		"inventory": _inventory(),
		"world": {"W": WorldScript.W, "H": WorldScript.H, "FERTILIZER_FACTOR": WorldScript.FERTILIZER_FACTOR},
		"gem_amount_samples": _gem_amount_samples(),
		"break_mc": _break_mc(),
		"harvest_mc": _harvest_mc(),
		"mc_trials": MC_TRIALS,
	}
	var f := FileAccess.open(out_path, FileAccess.WRITE)
	if f == null:
		printerr("EXPORT_RULES cannot write ", out_path)
		quit(1)
		return
	f.store_string(JSON.stringify(data, "  ", true))
	f.close()
	print("EXPORT_RULES OK ", out_path)
	quit(0)

func _tile_ids() -> Dictionary:
	var out := {}
	for k in Tiles.Id.keys():
		out[k] = int(Tiles.Id[k])
	return out

func _tiles() -> Dictionary:
	var out := {}
	for id in range(ID_MIN, ID_MAX + 1):
		out[str(id)] = {
			"name": str(Tiles.NAMES.get(id, "")),
			"is_solid": Tiles.is_solid(id),
			"is_soil": Tiles.is_soil(id),
			"is_placeable": Tiles.is_placeable(id),
			"is_seed": Tiles.is_seed(id),
			"is_crop": Tiles.is_crop(id),
			"is_usable_item": Tiles.is_usable_item(id),
			"seed_for_crop": Tiles.seed_for_crop(id),
			"crop_for_seed": Tiles.crop_for_seed(id),
			"grow_seconds": Tiles.grow_seconds(id),
		}
	return out

func _items() -> Dictionary:
	var out := {}
	for id in range(ID_MIN, ID_MAX + 1):
		out[str(id)] = {
			"in_catalog": Items.catalog().has(id),
			"name": Items.display_name(id),
			"rarity": Items.rarity(id),
			"sell": Items.sell_price(id),
			"buy": Items.buy_price(id),
			"can_drop": Items.can_drop(id),
			"farmable": Items.is_farmable(id),
			"seed_drop": Items.seed_drop_for(id),
			"block_drop_chance": Items.block_drop_chance(id),
			"seed_drop_chance": Items.seed_drop_chance(id),
			"gem_drop_chance": Items.gem_drop_chance(id),
		}
	return out

func _store_stock() -> Array:
	var ids: Array = []
	for info in Items.store_stock():
		ids.append(int(info["id"]))
	return ids

func _splice() -> Dictionary:
	var table := {}
	for a in range(ID_MIN, ID_MAX + 1):
		for b in range(ID_MIN, ID_MAX + 1):
			var r := Splicing.result_of(a, b)
			if r >= 0:
				table["%d,%d" % [a, b]] = r
	return {"results": table, "seed_ids": Splicing.all_seed_ids()}

func _inventory() -> Dictionary:
	var inv: Node = InventoryScript.new()
	inv._ready()
	var d := {
		"MAX_STACK": InventoryScript.MAX_STACK,
		"HOTBAR_LEN": InventoryScript.HOTBAR_LEN,
		"BASE_BACKPACK_SLOTS": InventoryScript.BASE_BACKPACK_SLOTS,
		"slots": Array(inv.slots),
		"counts": Array(inv.counts),
		"gems": inv.gems,
		"selected": inv.selected,
	}
	inv.free()
	return d

## Observed gem amounts per id from Items.gem_drop_amount with a seeded RNG (sorted unique set).
func _gem_amount_samples() -> Dictionary:
	var out := {}
	var rng := RandomNumberGenerator.new()
	rng.seed = 12345
	for id in range(0, ID_MAX + 1):
		var seen := {}
		for _i in range(GEM_SAMPLES):
			seen[Items.gem_drop_amount(id, rng)] = true
		var vals: Array = seen.keys()
		vals.sort()
		out[str(id)] = vals
	return out

func _new_world() -> Node2D:
	var w: Node2D = WorldScript.new()
	w.grid.resize(WorldScript.W * WorldScript.H)
	return w

## Monte Carlo of the real World.break_tile: histogram of outcome keys "block|seed|gems".
func _break_mc() -> Dictionary:
	var out := {}
	var w := _new_world()
	for id in range(1, ID_MAX + 1):
		if Tiles.is_crop(id):
			continue  ## crops are harvested (try_harvest), see _harvest_mc
		var hist := {}
		for _i in range(MC_TRIALS):
			w.grid[w.idx(1, 1)] = id
			w.drops.clear()
			var r: Dictionary = w.break_tile(1, 1, true, null)
			var n_drops: int = w.drops.size()
			var key := "%d|%d|%d|%d" % [int(r["block"]), int(r["seed"]), int(r["gems"]), n_drops]
			hist[key] = int(hist.get(key, 0)) + 1
		out[str(id)] = hist
	w.free()
	return out

## Monte Carlo of World.try_harvest on crops: key "block|seed|gems|drop_count".
func _harvest_mc() -> Dictionary:
	var out := {}
	var w := _new_world()
	for id in range(1, ID_MAX + 1):
		if not Tiles.is_crop(id):
			continue
		var hist := {}
		for _i in range(MC_TRIALS):
			w.grid[w.idx(1, 1)] = id
			w.drops.clear()
			var r: Dictionary = w.try_harvest(1, 1, true, null)
			var key := "%d|%d|%d|%d" % [int(r["block"]), int(r["seed"]), int(r["gems"]), w.drops.size()]
			hist[key] = int(hist.get(key, 0)) + 1
		out[str(id)] = hist
	w.free()
	return out
