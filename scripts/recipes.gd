extends RefCounted
## Craft recipes for Pixeltopia Phase 2/3 (data only — original content).
class_name Recipes

## Each recipe: id, name, result tile id, result_count, ingredients [{id, count}]
static func all() -> Array:
	var out := _base()
	for r in ContentData.RECIPES:
		var parts: Array = []
		for ing in r["ingredients"]:
			parts.append("%d %s" % [int(ing["count"]), Tiles.name_of(int(ing["id"]))])
		out.append({
			"id": str(r["id"]),
			"name": str(r["name"]),
			"blurb": "%s → %d %s" % [" + ".join(PackedStringArray(parts)), int(r["result_count"]), str(r["name"])],
			"result": int(r["result"]),
			"result_count": int(r["result_count"]),
			"ingredients": (r["ingredients"] as Array).duplicate(true),
		})
	return out

static func _base() -> Array:
	return [
		{
			"id": "plank",
			"name": "Plank",
			"blurb": "2 Wood → 1 Plank",
			"result": Tiles.Id.PLANK,
			"result_count": 1,
			"ingredients": [{"id": Tiles.Id.WOOD, "count": 2}],
		},
		{
			"id": "torch",
			"name": "Torch",
			"blurb": "1 Wood → 2 Torches",
			"result": Tiles.Id.TORCH,
			"result_count": 2,
			"ingredients": [{"id": Tiles.Id.WOOD, "count": 1}],
		},
		{
			"id": "weather_machine",
			"name": "Weather Machine",
			"blurb": "4 Plank + 2 Torch → sun console",
			"result": Tiles.Id.WEATHER_MACHINE,
			"result_count": 1,
			"ingredients": [
				{"id": Tiles.Id.PLANK, "count": 4},
				{"id": Tiles.Id.TORCH, "count": 2},
			],
		},
		{
			"id": "fertilizer",
			"name": "Fertilizer",
			"blurb": "1 Groveberry + 1 Dirt → 2 Fertilizer (halves grow time)",
			"result": Tiles.Id.FERTILIZER,
			"result_count": 2,
			"ingredients": [
				{"id": Tiles.Id.CROP, "count": 1},
				{"id": Tiles.Id.DIRT, "count": 1},
			],
		},
	]
