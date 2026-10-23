extends RefCounted
## Craft recipes for Pixeltopia Phase 2 (data only — original content).
class_name Recipes

## Each recipe: id, name, result tile id, result_count, ingredients [{id, count}]
static func all() -> Array:
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
	]
