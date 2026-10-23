extends Node
## Pixeltopia tile IDs and colors (original placeholder art).
class_name Tiles

const SIZE := 32

enum Id {
	AIR = 0,
	DIRT = 1,
	GRASS = 2,
	STONE = 3,
	SEED = 4,       ## Groveberry seed (growing)
	CROP = 5,       ## Groveberry mature
	WOOD = 6,       ## placeable wood block
	TORCH = 7,      ## decorative light (non-solid)
	PLANK = 8,      ## crafted wood plank (solid)
	SAND = 9,       ## soft sand block (solid)
	SEED_AZURE = 10, ## Azureoot seed (growing)
	CROP_AZURE = 11, ## Azureoot mature
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
	Id.PLANK: "Plank",
	Id.SAND: "Sand",
	Id.SEED_AZURE: "Azureoot Seed",
	Id.CROP_AZURE: "Azureoot",
}

static func is_solid(id: int) -> bool:
	return id == Id.DIRT or id == Id.GRASS or id == Id.STONE or id == Id.WOOD \
		or id == Id.PLANK or id == Id.SAND

static func is_soil(id: int) -> bool:
	return id == Id.DIRT or id == Id.GRASS

static func is_placeable(id: int) -> bool:
	return id == Id.DIRT or id == Id.GRASS or id == Id.STONE or id == Id.WOOD \
		or id == Id.TORCH or id == Id.SEED or id == Id.PLANK or id == Id.SAND \
		or id == Id.SEED_AZURE

static func is_seed(id: int) -> bool:
	return id == Id.SEED or id == Id.SEED_AZURE

static func is_crop(id: int) -> bool:
	return id == Id.CROP or id == Id.CROP_AZURE

static func seed_for_crop(crop_id: int) -> int:
	if crop_id == Id.CROP_AZURE:
		return Id.SEED_AZURE
	return Id.SEED

static func grow_seconds(seed_id: int) -> float:
	if seed_id == Id.SEED_AZURE:
		return 12.0
	if seed_id == Id.SEED:
		return 8.0
	return -1.0

static func crop_for_seed(seed_id: int) -> int:
	if seed_id == Id.SEED_AZURE:
		return Id.CROP_AZURE
	return Id.CROP

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
		Id.PLANK:
			return Color(0.78, 0.58, 0.32)
		Id.SAND:
			return Color(0.90, 0.82, 0.55)
		Id.SEED_AZURE:
			return Color(0.40, 0.70, 0.95)
		Id.CROP_AZURE:
			return Color(0.35, 0.55, 1.0)
		_:
			return Color(0, 0, 0, 0)
