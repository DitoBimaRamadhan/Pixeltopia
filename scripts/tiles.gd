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

## v1.8 original pixel-art atlas (tools/art/gen_tiles.py): 16x16 cells, index == tile id.
const ATLAS_CELL := 16
const ATLAS_COLS := 16
static var _atlas: Texture2D = null
static var _atlas_cache: Dictionary = {}

static func atlas() -> Texture2D:
	if _atlas == null:
		_atlas = load("res://assets/sprites/tiles.png") as Texture2D
	return _atlas

static func atlas_region(id: int) -> Rect2:
	return Rect2((id % ATLAS_COLS) * ATLAS_CELL, int(id / ATLAS_COLS) * ATLAS_CELL, ATLAS_CELL, ATLAS_CELL)

## AtlasTexture for UI icons (cached per id).
static func icon_texture(id: int) -> Texture2D:
	if not _atlas_cache.has(id):
		var at := AtlasTexture.new()
		at.atlas = atlas()
		at.region = atlas_region(id)
		_atlas_cache[id] = at
	return _atlas_cache[id]

## v1.8 content pack (scripts/content_data.gd, generated): id -> def dictionary.
static var _content: Dictionary = {}

static func cdef(id: int) -> Dictionary:
	if _content.is_empty():
		for d in ContentData.TILES:
			_content[int(d["id"])] = d
	return _content.get(id, {})

static func is_content(id: int) -> bool:
	return not cdef(id).is_empty()

static func kind(id: int) -> String:
	return str(cdef(id).get("kind", ""))

static func name_of(id: int) -> String:
	if NAMES.has(id):
		return str(NAMES[id])
	return str(cdef(id).get("name", ""))

## Every tile id the game knows (base enum + content pack), ascending.
static func all_ids() -> Array:
	var out: Array = []
	for k in Id.keys():
		out.append(int(Id[k]))
	for d in ContentData.TILES:
		out.append(int(d["id"]))
	out.sort()
	return out

static func is_solid(id: int) -> bool:
	if id == Id.DIRT or id == Id.GRASS or id == Id.STONE or id == Id.WOOD \
		or id == Id.PLANK or id == Id.SAND or id == Id.WORLD_LOCK:
		return true
	var k := kind(id)
	return k == "block" or k == "glass"

## One-way ledge: stand on top, jump up through, hold Down to drop.
static func is_platform(id: int) -> bool:
	return kind(id) == "platform"

static func is_door(id: int) -> bool:
	return kind(id) == "door"

## Background wall: drawn behind players and other tiles, never collides.
static func is_wall(id: int) -> bool:
	return kind(id) == "wall"

## Glow radius in tiles (0 = none). Torch is 1.0.
static func light_of(id: int) -> float:
	if id == Id.TORCH:
		return 1.0
	return float(cdef(id).get("light", 0.0))

## v1.8 toughness: punches needed to break a tile (mirrored in server/lib/rules.js HITS).
const HIT_RESET_SEC := 4.0  ## damage heals if the tile is not punched again within this time

static func hits_to_break(id: int) -> int:
	match id:
		Id.AIR:
			return 0
		Id.DIRT, Id.GRASS:
			return 3
		Id.SAND:
			return 2
		Id.STONE:
			return 5
		Id.WOOD, Id.PLANK, Id.WEATHER_MACHINE:
			return 4
		Id.WORLD_LOCK:
			return 6
		_:
			return int(cdef(id).get("hits", 1))

static func is_soil(id: int) -> bool:
	return id == Id.DIRT or id == Id.GRASS

static func is_placeable(id: int) -> bool:
	return id == Id.DIRT or id == Id.GRASS or id == Id.STONE or id == Id.WOOD \
		or id == Id.TORCH or id == Id.SEED or id == Id.PLANK or id == Id.SAND \
		or id == Id.SEED_AZURE or id == Id.WEATHER_MACHINE \
		or id == Id.SEED_EMBER or id == Id.SEED_MOON or id == Id.SEED_CRYSTAL \
		or id == Id.WORLD_LOCK or (is_content(id) and kind(id) != "crop")

static func is_seed(id: int) -> bool:
	return id == Id.SEED or id == Id.SEED_AZURE or id == Id.SEED_EMBER \
		or id == Id.SEED_MOON or id == Id.SEED_CRYSTAL or kind(id) == "seed"

static func is_crop(id: int) -> bool:
	return id == Id.CROP or id == Id.CROP_AZURE or id == Id.CROP_EMBER \
		or id == Id.CROP_MOON or id == Id.CROP_CRYSTAL or kind(id) == "crop"

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
			if kind(crop_id) == "crop":
				return int(cdef(crop_id)["seed"])
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
			if kind(seed_id) == "seed":
				return float(cdef(seed_id)["grow"])
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
			if kind(seed_id) == "seed":
				return int(cdef(seed_id)["crop"])
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
			var d := cdef(id)
			if d.is_empty():
				return Color(0, 0, 0, 0)
			return Color.html(str(d["color"]))
