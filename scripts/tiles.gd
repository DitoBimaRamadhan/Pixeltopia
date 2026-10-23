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
	WEATHER_MACHINE = 12, ## placeable sun-weather console (non-solid)
	FERTILIZER = 13, ## inventory item: shortens grow time on seeds
	SEED_EMBER = 14, ## Emberfruit seed (splice discovery)
	CROP_EMBER = 15, ## Emberfruit mature
	SEED_MOON = 16, ## Moonpetal seed (splice discovery)
	CROP_MOON = 17, ## Moonpetal mature
	SEED_CRYSTAL = 18, ## Crystalroot seed (splice discovery)
	CROP_CRYSTAL = 19, ## Crystalroot mature
	WORLD_LOCK = 20, ## locks named world to owner
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
	Id.WEATHER_MACHINE: "Weather Machine",
	Id.FERTILIZER: "Fertilizer",
	Id.SEED_EMBER: "Emberfruit Seed",
	Id.CROP_EMBER: "Emberfruit",
	Id.SEED_MOON: "Moonpetal Seed",
	Id.CROP_MOON: "Moonpetal",
	Id.SEED_CRYSTAL: "Crystalroot Seed",
	Id.CROP_CRYSTAL: "Crystalroot",
	Id.WORLD_LOCK: "World Lock",
}

static func is_solid(id: int) -> bool:
	return id == Id.DIRT or id == Id.GRASS or id == Id.STONE or id == Id.WOOD \
		or id == Id.PLANK or id == Id.SAND or id == Id.WORLD_LOCK

static func is_soil(id: int) -> bool:
	return id == Id.DIRT or id == Id.GRASS

static func is_placeable(id: int) -> bool:
	return id == Id.DIRT or id == Id.GRASS or id == Id.STONE or id == Id.WOOD \
		or id == Id.TORCH or id == Id.SEED or id == Id.PLANK or id == Id.SAND \
		or id == Id.SEED_AZURE or id == Id.WEATHER_MACHINE \
		or id == Id.SEED_EMBER or id == Id.SEED_MOON or id == Id.SEED_CRYSTAL \
		or id == Id.WORLD_LOCK

static func is_seed(id: int) -> bool:
	return id == Id.SEED or id == Id.SEED_AZURE or id == Id.SEED_EMBER \
		or id == Id.SEED_MOON or id == Id.SEED_CRYSTAL

static func is_crop(id: int) -> bool:
	return id == Id.CROP or id == Id.CROP_AZURE or id == Id.CROP_EMBER \
		or id == Id.CROP_MOON or id == Id.CROP_CRYSTAL

static func is_usable_item(id: int) -> bool:
	## Inventory-only tools/consumables (not world tiles).
	return id == Id.FERTILIZER

static func seed_for_crop(crop_id: int) -> int:
	match crop_id:
		Id.CROP_AZURE:
			return Id.SEED_AZURE
		Id.CROP_EMBER:
			return Id.SEED_EMBER
		Id.CROP_MOON:
			return Id.SEED_MOON
		Id.CROP_CRYSTAL:
			return Id.SEED_CRYSTAL
		_:
			return Id.SEED

static func grow_seconds(seed_id: int) -> float:
	match seed_id:
		Id.SEED:
			return 8.0
		Id.SEED_AZURE:
			return 12.0
		Id.SEED_EMBER:
			return 15.0
		Id.SEED_MOON:
			return 18.0
		Id.SEED_CRYSTAL:
			return 24.0
		_:
			return -1.0

static func crop_for_seed(seed_id: int) -> int:
	match seed_id:
		Id.SEED_AZURE:
			return Id.CROP_AZURE
		Id.SEED_EMBER:
			return Id.CROP_EMBER
		Id.SEED_MOON:
			return Id.CROP_MOON
		Id.SEED_CRYSTAL:
			return Id.CROP_CRYSTAL
		_:
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
		Id.WEATHER_MACHINE:
			return Color(0.55, 0.85, 1.0)
		Id.FERTILIZER:
			return Color(0.55, 0.75, 0.30)
		Id.SEED_EMBER:
			return Color(1.0, 0.55, 0.25)
		Id.CROP_EMBER:
			return Color(0.95, 0.35, 0.15)
		Id.SEED_MOON:
			return Color(0.75, 0.80, 1.0)
		Id.CROP_MOON:
			return Color(0.65, 0.55, 0.95)
		Id.SEED_CRYSTAL:
			return Color(0.55, 1.0, 0.95)
		Id.CROP_CRYSTAL:
			return Color(0.35, 0.95, 0.90)
		Id.WORLD_LOCK:
			return Color(1.0, 0.85, 0.25)
		_:
			return Color(0, 0, 0, 0)
