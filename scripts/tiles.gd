extends Node
## Pixeltopia tile IDs and colors (original placeholder art).
class_name Tiles

const SIZE := 32

enum Id {
	AIR = 0,
	DIRT = 1,
	GRASS = 2,
	STONE = 3,
	SEED = 4,       ## planted seed (growing)
	CROP = 5,       ## mature plant ready to harvest
	WOOD = 6,       ## placeable wood block
	TORCH = 7,      ## decorative light (non-solid)
}

const NAMES := {
	Id.AIR: "Air",
	Id.DIRT: "Dirt",
	Id.GRASS: "Grass",
	Id.STONE: "Stone",
	Id.SEED: "Sprout",
	Id.CROP: "Groveberry",
	Id.WOOD: "Wood",
	Id.TORCH: "Torch",
}

## Solid for collision?
static func is_solid(id: int) -> bool:
	return id == Id.DIRT or id == Id.GRASS or id == Id.STONE or id == Id.WOOD

## Can plant a seed on top of this block (into air cell above)?
static func is_soil(id: int) -> bool:
	return id == Id.DIRT or id == Id.GRASS

## Can be placed into an empty cell from inventory?
static func is_placeable(id: int) -> bool:
	return id == Id.DIRT or id == Id.GRASS or id == Id.STONE or id == Id.WOOD or id == Id.TORCH or id == Id.SEED

static func color(id: int) -> Color:
	match id:
		Id.DIRT:
			return Color(0.55, 0.35, 0.22)
		Id.GRASS:
			return Color(0.30, 0.70, 0.35)
		Id.STONE:
			return Color(0.55, 0.55, 0.60)
		Id.SEED:
			return Color(0.45, 0.85, 0.35)
		Id.CROP:
			return Color(0.85, 0.35, 0.55)
		Id.WOOD:
			return Color(0.62, 0.42, 0.22)
		Id.TORCH:
			return Color(0.95, 0.75, 0.25)
		_:
			return Color(0, 0, 0, 0)
