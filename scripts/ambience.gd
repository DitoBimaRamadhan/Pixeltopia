extends RefCounted
## v1.9 ambience picker: chooses a looping background ambience from where the player is.
## Pure function so tools/v19_check.gd can test it without audio.

const Tiles = preload("res://scripts/tiles.gd")

const NIGHT := 3  ## weather.gd Period.NIGHT
const MOOD_THUNDER := 4  ## weather.gd Mood.THUNDER

## Returns "cave" | "rain" | "wind" | "ocean" | "night" | "day".
static func pick(world: Node, t: Vector2i, period: int, mood: int) -> String:
	if world == null or not world.has_method("get_tile"):
		return "day" if period != NIGHT else "night"
	var roof := 0
	for dy in range(1, 15):
		if Tiles.is_solid(int(world.get_tile(t.x, t.y - dy))):
			roof += 1
	if t.y > 18 and roof >= 3:
		return "cave"
	if mood == MOOD_THUNDER:
		return "rain"
	if t.y < 8:
		return "wind"
	var sand := 0
	for dx in range(-5, 6):
		for dy in range(-2, 5):
			if int(world.get_tile(t.x + dx, t.y + dy)) == Tiles.Id.SAND:
				sand += 1
	if sand >= 6:
		return "ocean"
	return "night" if period == NIGHT else "day"
