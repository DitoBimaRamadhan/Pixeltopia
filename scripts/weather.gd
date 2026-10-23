extends CanvasModulate
## Sun-only day periods + atmospheric moods. No moon/star light sources.
class_name WeatherController

enum Period { MORNING, NOON, AFTERNOON, NIGHT }
enum Mood { CLEAR, AURORA, CITY_OVERCAST }

const PERIOD_NAMES := {
	Period.MORNING: "Morning",
	Period.NOON: "Noon",
	Period.AFTERNOON: "Afternoon",
	Period.NIGHT: "Night",
}

const MOOD_NAMES := {
	Mood.CLEAR: "Clear",
	Mood.AURORA: "Aurora",
	Mood.CITY_OVERCAST: "City / Overcast",
}

## Sun-driven ambient (multiplies scene). Torch glow is drawn separately on tiles.
const PERIOD_TINT := {
	Period.MORNING: Color(1.0, 0.92, 0.78, 1.0),
	Period.NOON: Color(1.0, 1.0, 1.0, 1.0),
	Period.AFTERNOON: Color(1.0, 0.78, 0.62, 1.0),
	Period.NIGHT: Color(0.28, 0.32, 0.48, 1.0),
}

const MOOD_TINT := {
	Mood.CLEAR: Color(1.0, 1.0, 1.0, 1.0),
	Mood.AURORA: Color(0.75, 0.95, 1.05, 1.0),  ## cool green-blue wash (still sun-scaled)
	Mood.CITY_OVERCAST: Color(0.72, 0.75, 0.82, 1.0),
}

const CLEAR_COLORS := {
	Period.MORNING: Color(0.55, 0.72, 0.95, 1),
	Period.NOON: Color(0.45, 0.72, 0.95, 1),
	Period.AFTERNOON: Color(0.85, 0.55, 0.45, 1),
	Period.NIGHT: Color(0.08, 0.1, 0.22, 1),
}

signal changed

var period: int = Period.NOON
var mood: int = Mood.CLEAR
var auto_cycle: bool = false
var _auto_t: float = 0.0
const AUTO_SECONDS := 45.0  ## full day loop

func _ready() -> void:
	_apply()

func _process(delta: float) -> void:
	if not auto_cycle:
		return
	_auto_t += delta
	if _auto_t >= AUTO_SECONDS / 4.0:
		_auto_t = 0.0
		period = (period + 1) % 4
		_apply()
		changed.emit()

func set_period(p: int) -> void:
	period = clampi(p, 0, 3)
	_apply()
	changed.emit()

func set_mood(m: int) -> void:
	mood = clampi(m, 0, 2)
	_apply()
	changed.emit()

func set_auto(v: bool) -> void:
	auto_cycle = v
	_auto_t = 0.0
	changed.emit()

func label() -> String:
	var auto_s := " · Auto" if auto_cycle else ""
	return "%s / %s%s" % [PERIOD_NAMES[period], MOOD_NAMES[mood], auto_s]

func to_save() -> Dictionary:
	return {"period": period, "mood": mood, "auto": auto_cycle}

func from_save(data: Dictionary) -> void:
	if data.has("period"):
		period = int(data["period"])
	if data.has("mood"):
		mood = int(data["mood"])
	if data.has("auto"):
		auto_cycle = bool(data["auto"])
	_apply()
	changed.emit()

func _apply() -> void:
	var base: Color = PERIOD_TINT.get(period, Color.WHITE)
	var mood_c: Color = MOOD_TINT.get(mood, Color.WHITE)
	# Multiply sun period * mood; never add a second light source
	color = Color(base.r * mood_c.r, base.g * mood_c.g, base.b * mood_c.b, 1.0)
	var sky: Color = CLEAR_COLORS.get(period, Color(0.45, 0.72, 0.95, 1))
	if mood == Mood.AURORA:
		sky = sky.lerp(Color(0.15, 0.45, 0.55, 1), 0.55)
		sky.g = minf(sky.g + 0.15, 1.0)
	elif mood == Mood.CITY_OVERCAST:
		sky = sky.lerp(Color(0.45, 0.48, 0.55, 1), 0.7)
	RenderingServer.set_default_clear_color(sky)
