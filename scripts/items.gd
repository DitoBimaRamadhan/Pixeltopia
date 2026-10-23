extends RefCounted
## Pixeltopia item catalog: id, name, description, rarity, farmable, prices.
## Original content only — Growtopia-inspired drop/store feel, not a clone.
class_name Items

enum Rarity {
	COMMON = 0,
	UNCOMMON = 1,
	RARE = 2,
	EPIC = 3,
}

const RARITY_NAMES := {
	Rarity.COMMON: "Common",
	Rarity.UNCOMMON: "Uncommon",
	Rarity.RARE: "Rare",
	Rarity.EPIC: "Epic",
}

const RARITY_COLORS := {
	Rarity.COMMON: Color(0.85, 0.85, 0.85),
	Rarity.UNCOMMON: Color(0.45, 0.95, 0.55),
	Rarity.RARE: Color(0.45, 0.70, 1.0),
	Rarity.EPIC: Color(0.85, 0.45, 1.0),
}

## Catalog keyed by tile/item id (aligned with Tiles.Id).
## farmable: break → higher gem + seed chance; non-farmable → rarer seeds, weaker block drops.
static func catalog() -> Dictionary:
	return {
		Tiles.Id.DIRT: {
			"id": Tiles.Id.DIRT,
			"name": "Dirt",
			"description": "Soft earth. Farmable — breaks into gems and seeds more often.",
			"rarity": Rarity.COMMON,
			"sell": 1,
			"buy": 2,
			"can_drop": true,
			"farmable": true,
			"seed_drop": Tiles.Id.SEED,
		},
		Tiles.Id.GRASS: {
			"id": Tiles.Id.GRASS,
			"name": "Grass",
			"description": "Fresh turf. Farmable soil for planting.",
			"rarity": Rarity.COMMON,
			"sell": 1,
			"buy": 3,
			"can_drop": true,
			"farmable": true,
			"seed_drop": Tiles.Id.SEED,
		},
		Tiles.Id.STONE: {
			"id": Tiles.Id.STONE,
			"name": "Stone",
			"description": "Solid rock. Non-farmable — weaker drops when broken.",
			"rarity": Rarity.COMMON,
			"sell": 2,
			"buy": 4,
			"can_drop": true,
			"farmable": false,
			"seed_drop": -1,
		},
		Tiles.Id.SEED: {
			"id": Tiles.Id.SEED,
			"name": "Groveberry Seed",
			"description": "Plant on soil. Grows into Groveberry in ~8s.",
			"rarity": Rarity.COMMON,
			"sell": 3,
			"buy": 8,
			"can_drop": true,
			"farmable": true,
			"seed_drop": Tiles.Id.SEED,
		},
		Tiles.Id.CROP: {
			"id": Tiles.Id.CROP,
			"name": "Groveberry",
			"description": "Juicy berry harvest. Farmable crop.",
			"rarity": Rarity.UNCOMMON,
			"sell": 6,
			"buy": -1,
			"can_drop": true,
			"farmable": true,
			"seed_drop": Tiles.Id.SEED,
		},
		Tiles.Id.WOOD: {
			"id": Tiles.Id.WOOD,
			"name": "Wood",
			"description": "From trees. Non-farmable building block.",
			"rarity": Rarity.COMMON,
			"sell": 2,
			"buy": 5,
			"can_drop": true,
			"farmable": false,
			"seed_drop": -1,
		},
		Tiles.Id.TORCH: {
			"id": Tiles.Id.TORCH,
			"name": "Torch",
			"description": "Warm local light for dark nights.",
			"rarity": Rarity.COMMON,
			"sell": 3,
			"buy": 10,
			"can_drop": true,
			"farmable": false,
			"seed_drop": -1,
		},
		Tiles.Id.PLANK: {
			"id": Tiles.Id.PLANK,
			"name": "Plank",
			"description": "Crafted timber for floors and walls.",
			"rarity": Rarity.UNCOMMON,
			"sell": 5,
			"buy": 12,
			"can_drop": true,
			"farmable": false,
			"seed_drop": -1,
		},
		Tiles.Id.SAND: {
			"id": Tiles.Id.SAND,
			"name": "Sand",
			"description": "Soft beach sand. Mildly farmable.",
			"rarity": Rarity.COMMON,
			"sell": 1,
			"buy": 3,
			"can_drop": true,
			"farmable": true,
			"seed_drop": Tiles.Id.SEED,
		},
		Tiles.Id.SEED_AZURE: {
			"id": Tiles.Id.SEED_AZURE,
			"name": "Azureoot Seed",
			"description": "Cool-blue crop seed. Grows in ~12s.",
			"rarity": Rarity.UNCOMMON,
			"sell": 5,
			"buy": 14,
			"can_drop": true,
			"farmable": true,
			"seed_drop": Tiles.Id.SEED_AZURE,
		},
		Tiles.Id.CROP_AZURE: {
			"id": Tiles.Id.CROP_AZURE,
			"name": "Azureoot",
			"description": "Rare blue root harvest. Farmable.",
			"rarity": Rarity.RARE,
			"sell": 12,
			"buy": -1,
			"can_drop": true,
			"farmable": true,
			"seed_drop": Tiles.Id.SEED_AZURE,
		},
		Tiles.Id.WEATHER_MACHINE: {
			"id": Tiles.Id.WEATHER_MACHINE,
			"name": "Weather Machine",
			"description": "Sun-driven day periods and sky moods.",
			"rarity": Rarity.EPIC,
			"sell": 40,
			"buy": 120,
			"can_drop": true,
			"farmable": false,
			"seed_drop": -1,
		},
		Tiles.Id.FERTILIZER: {
			"id": Tiles.Id.FERTILIZER,
			"name": "Fertilizer",
			"description": "Punch a sprout while holding this to halve remaining grow time.",
			"rarity": Rarity.UNCOMMON,
			"sell": 4,
			"buy": 15,
			"can_drop": true,
			"farmable": false,
			"seed_drop": -1,
		},
	}

static func get_info(id: int) -> Dictionary:
	var cat := catalog()
	if cat.has(id):
		return cat[id]
	return {
		"id": id,
		"name": Tiles.NAMES.get(id, "Unknown"),
		"description": "An unmarked Pixeltopia item.",
		"rarity": Rarity.COMMON,
		"sell": 1,
		"buy": -1,
		"can_drop": true,
		"farmable": false,
		"seed_drop": -1,
	}

static func display_name(id: int) -> String:
	return str(get_info(id).get("name", "?"))

static func description(id: int) -> String:
	return str(get_info(id).get("description", ""))

static func rarity(id: int) -> int:
	return int(get_info(id).get("rarity", Rarity.COMMON))

static func rarity_name(id: int) -> String:
	return str(RARITY_NAMES.get(rarity(id), "Common"))

static func rarity_color(id: int) -> Color:
	return RARITY_COLORS.get(rarity(id), Color.WHITE)

static func sell_price(id: int) -> int:
	return int(get_info(id).get("sell", 0))

static func buy_price(id: int) -> int:
	return int(get_info(id).get("buy", -1))

static func can_drop(id: int) -> bool:
	if id < 0:
		return false
	return bool(get_info(id).get("can_drop", false))

static func is_farmable(id: int) -> bool:
	return bool(get_info(id).get("farmable", false))

static func seed_drop_for(id: int) -> int:
	return int(get_info(id).get("seed_drop", -1))

## Chance tables for break drops (0.0–1.0).
static func block_drop_chance(id: int) -> float:
	return 0.92 if is_farmable(id) else 0.38

static func seed_drop_chance(id: int) -> float:
	return 0.42 if is_farmable(id) else 0.08

static func gem_drop_chance(id: int) -> float:
	return 0.55 if is_farmable(id) else 0.12

static func gem_drop_amount(id: int, rng: RandomNumberGenerator) -> int:
	if is_farmable(id):
		return rng.randi_range(1, 3)
	return 1

## Items the Store sells (buy_price >= 0).
static func store_stock() -> Array:
	var out: Array = []
	for id in catalog().keys():
		var info: Dictionary = catalog()[id]
		if int(info.get("buy", -1)) >= 0:
			out.append(info)
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return int(a["id"]) < int(b["id"]))
	return out

## Back-compat alias.
static func shop_stock() -> Array:
	return store_stock()
