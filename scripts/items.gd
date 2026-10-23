extends RefCounted
## Pixeltopia item catalog: id, name, description, rarity, prices.
## Original content only — Growtopia-inspired drop/shop feel, not a clone.
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
static func catalog() -> Dictionary:
	return {
		Tiles.Id.DIRT: {
			"id": Tiles.Id.DIRT,
			"name": "Dirt",
			"description": "Soft earth. Good for planting and crafting fertilizer.",
			"rarity": Rarity.COMMON,
			"sell": 1,
			"buy": 2,
			"can_drop": true,
		},
		Tiles.Id.GRASS: {
			"id": Tiles.Id.GRASS,
			"name": "Grass",
			"description": "Fresh turf for a greener world.",
			"rarity": Rarity.COMMON,
			"sell": 1,
			"buy": 3,
			"can_drop": true,
		},
		Tiles.Id.STONE: {
			"id": Tiles.Id.STONE,
			"name": "Stone",
			"description": "Solid rock for sturdy builds.",
			"rarity": Rarity.COMMON,
			"sell": 2,
			"buy": 4,
			"can_drop": true,
		},
		Tiles.Id.SEED: {
			"id": Tiles.Id.SEED,
			"name": "Groveberry Seed",
			"description": "Plant on soil. Grows into Groveberry in ~8s.",
			"rarity": Rarity.COMMON,
			"sell": 3,
			"buy": 8,
			"can_drop": true,
		},
		Tiles.Id.CROP: {
			"id": Tiles.Id.CROP,
			"name": "Groveberry",
			"description": "Juicy berry harvest. Used in fertilizer.",
			"rarity": Rarity.UNCOMMON,
			"sell": 6,
			"buy": -1,
			"can_drop": true,
		},
		Tiles.Id.WOOD: {
			"id": Tiles.Id.WOOD,
			"name": "Wood",
			"description": "From trees. Craft into planks and torches.",
			"rarity": Rarity.COMMON,
			"sell": 2,
			"buy": 5,
			"can_drop": true,
		},
		Tiles.Id.TORCH: {
			"id": Tiles.Id.TORCH,
			"name": "Torch",
			"description": "Warm local light for dark nights.",
			"rarity": Rarity.COMMON,
			"sell": 3,
			"buy": 10,
			"can_drop": true,
		},
		Tiles.Id.PLANK: {
			"id": Tiles.Id.PLANK,
			"name": "Plank",
			"description": "Crafted timber for floors and walls.",
			"rarity": Rarity.UNCOMMON,
			"sell": 5,
			"buy": 12,
			"can_drop": true,
		},
		Tiles.Id.SAND: {
			"id": Tiles.Id.SAND,
			"name": "Sand",
			"description": "Soft beach sand from low shores.",
			"rarity": Rarity.COMMON,
			"sell": 1,
			"buy": 3,
			"can_drop": true,
		},
		Tiles.Id.SEED_AZURE: {
			"id": Tiles.Id.SEED_AZURE,
			"name": "Azureoot Seed",
			"description": "Cool-blue crop seed. Grows in ~12s.",
			"rarity": Rarity.UNCOMMON,
			"sell": 5,
			"buy": 14,
			"can_drop": true,
		},
		Tiles.Id.CROP_AZURE: {
			"id": Tiles.Id.CROP_AZURE,
			"name": "Azureoot",
			"description": "Rare blue root harvest.",
			"rarity": Rarity.RARE,
			"sell": 12,
			"buy": -1,
			"can_drop": true,
		},
		Tiles.Id.WEATHER_MACHINE: {
			"id": Tiles.Id.WEATHER_MACHINE,
			"name": "Weather Machine",
			"description": "Sun-driven day periods and sky moods.",
			"rarity": Rarity.EPIC,
			"sell": 40,
			"buy": 120,
			"can_drop": true,
		},
		Tiles.Id.FERTILIZER: {
			"id": Tiles.Id.FERTILIZER,
			"name": "Fertilizer",
			"description": "Punch a sprout while holding this to halve remaining grow time.",
			"rarity": Rarity.UNCOMMON,
			"sell": 4,
			"buy": 15,
			"can_drop": true,
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

## Items the shop sells (buy_price >= 0).
static func shop_stock() -> Array:
	var out: Array = []
	for id in catalog().keys():
		var info: Dictionary = catalog()[id]
		if int(info.get("buy", -1)) >= 0:
			out.append(info)
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return int(a["id"]) < int(b["id"]))
	return out
