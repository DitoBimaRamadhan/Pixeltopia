extends CanvasModulate
## Sun-driven day periods + atmospheric weather. Original Pixeltopia branding.
## Rain / thunder affect tint, sky, crop growth boost, and visual FX.
class_name WeatherController

enum Period { MORNING, NOON, AFTERNOON, NIGHT }
enum Mood { CLEAR, AURORA, CITY_OVERCAST, RAIN, THUNDER }

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
	Mood.RAIN: "Rain",
	Mood.THUNDER: "Thunder",
}

const PERIOD_TINT := {
	Period.MORNING: Color(1.0, 0.92, 0.78, 1.0),
	Period.NOON: Color(1.0, 1.0, 1.0, 1.0),
	Period.AFTERNOON: Color(1.0, 0.78, 0.62, 1.0),
	Period.NIGHT: Color(0.28, 0.32, 0.48, 1.0),
}

const MOOD_TINT := {
	Mood.CLEAR: Color(1.0, 1.0, 1.0, 1.0),
	Mood.AURORA: Color(0.75, 0.95, 1.05, 1.0),
	Mood.CITY_OVERCAST: Color(0.72, 0.75, 0.82, 1.0),
	Mood.RAIN: Color(0.62, 0.68, 0.78, 1.0),
	Mood.THUNDER: Color(0.48, 0.52, 0.62, 1.0),
}

const CLEAR_COLORS := {
	Period.MORNING: Color(0.55, 0.72, 0.95, 1),
	Period.NOON: Color(0.45, 0.72, 0.95, 1),
	Period.AFTERNOON: Color(0.85, 0.55, 0.45, 1),
	Period.NIGHT: Color(0.08, 0.1, 0.22, 1),
}

signal changed
signal lightning_struck

var period: int = Period.NOON
var mood: int = Mood.CLEAR
var auto_cycle: bool = true
## Continuous day fraction 0..1 (0=dawn, 0.25=noon, 0.5=dusk, 0.75=midnight).
var time_of_day: float = 0.25
var _auto_t: float = 0.0
const DAY_SECONDS := 120.0  ## full day/night loop
var _rain_drops: Array = []  ## [{x,y,vy,len}]
var _flash: float = 0.0
var _thunder_cd: float = 0.0
var _fx_layer: Node2D = null
var _rain_audio_on: bool = false

func _ready() -> void:
	_ensure_fx()
	_seed_rain()
	_apply()
	set_process(true)

func _ensure_fx() -> void:
	if _fx_layer != null and is_instance_valid(_fx_layer):
		return
	var parent := get_parent()
	if parent == null:
		return
	_fx_layer = Node2D.new()
	_fx_layer.name = "WeatherFX"
	_fx_layer.z_index = 50
	_fx_layer.set_script(load("res://scripts/weather_fx.gd"))
	parent.add_child(_fx_layer)
	if _fx_layer.has_method("bind"):
		_fx_layer.bind(self)

func _process(delta: float) -> void:
	if auto_cycle:
		time_of_day = fposmod(time_of_day + delta / DAY_SECONDS, 1.0)
		var new_p := _period_from_tod(time_of_day)
		if new_p != period:
			period = new_p
			_apply()
			changed.emit()
		else:
			## Smooth tint between period anchors while auto-cycling.
			_apply_smooth()
	if mood == Mood.RAIN or mood == Mood.THUNDER:
		_tick_rain(delta)
		if mood == Mood.THUNDER:
			_tick_thunder(delta)
	elif _flash > 0.0:
		_flash = maxf(_flash - delta * 3.0, 0.0)
		_apply()
	_sync_rain_audio()

func _period_from_tod(t: float) -> int:
	if t < 0.2:
		return Period.MORNING
	if t < 0.45:
		return Period.NOON
	if t < 0.65:
		return Period.AFTERNOON
	return Period.NIGHT

func _tod_from_period(p: int) -> float:
	match p:
		Period.MORNING:
			return 0.1
		Period.NOON:
			return 0.3
		Period.AFTERNOON:
			return 0.55
		_:
			return 0.8

func set_period(p: int) -> void:
	period = clampi(p, 0, 3)
	time_of_day = _tod_from_period(period)
	_apply()
	changed.emit()

func set_mood(m: int) -> void:
	mood = clampi(m, 0, 4)
	if mood == Mood.RAIN or mood == Mood.THUNDER:
		_seed_rain()
	_apply()
	changed.emit()

func set_auto(v: bool) -> void:
	auto_cycle = v
	_auto_t = 0.0
	changed.emit()

func is_raining() -> bool:
	return mood == Mood.RAIN or mood == Mood.THUNDER

## Crop growth multiplier while raining / thundering (faster growth).
func growth_multiplier() -> float:
	if mood == Mood.THUNDER:
		return 0.55
	if mood == Mood.RAIN:
		return 0.7
	return 1.0

func label() -> String:
	var auto_s := " · Auto" if auto_cycle else ""
	var clock := _clock_string()
	return "%s %s / %s%s" % [clock, PERIOD_NAMES[period], MOOD_NAMES[mood], auto_s]

func _clock_string() -> String:
	var hours := int(floor(time_of_day * 24.0)) % 24
	var mins := int(floor(fposmod(time_of_day * 24.0, 1.0) * 60.0))
	return "%02d:%02d" % [hours, mins]

func to_save() -> Dictionary:
	return {
		"period": period,
		"mood": mood,
		"auto": auto_cycle,
		"tod": time_of_day,
	}

func from_save(data: Dictionary) -> void:
	if data.has("period"):
		period = int(data["period"])
	if data.has("mood"):
		mood = int(data["mood"])
	if data.has("auto"):
		auto_cycle = bool(data["auto"])
	if data.has("tod"):
		time_of_day = float(data["tod"])
	else:
		time_of_day = _tod_from_period(period)
	_apply()
	changed.emit()

func _seed_rain() -> void:
	_rain_drops.clear()
	var n := 90 if mood == Mood.THUNDER else 60
	for i in range(n):
		_rain_drops.append({
			"x": randf_range(-40.0, 1000.0),
			"y": randf_range(-200.0, 540.0),
			"vy": randf_range(380.0, 620.0) if mood != Mood.THUNDER else randf_range(480.0, 760.0),
			"len": randf_range(8.0, 16.0),
		})

func _tick_rain(delta: float) -> void:
	for d in _rain_drops:
		d["y"] = float(d["y"]) + float(d["vy"]) * delta
		d["x"] = float(d["x"]) - 40.0 * delta
		if float(d["y"]) > 560.0:
			d["y"] = randf_range(-80.0, -10.0)
			d["x"] = randf_range(-40.0, 1000.0)

func _tick_thunder(delta: float) -> void:
	_thunder_cd -= delta
	if _flash > 0.0:
		_flash = maxf(_flash - delta * 2.5, 0.0)
		_apply()
	if _thunder_cd <= 0.0:
		_thunder_cd = randf_range(4.5, 11.0)
		_flash = 1.0
		lightning_struck.emit()
		var _sfx = get_node_or_null("/root/Sfx")
		if _sfx and _sfx.has_method("play_thunder"):
			_sfx.play_thunder()
		_apply()

func get_rain_drops() -> Array:
	return _rain_drops

func get_flash() -> float:
	return _flash

func _sync_rain_audio() -> void:
	var want := is_raining()
	if want == _rain_audio_on:
		return
	_rain_audio_on = want
	var _sfx2 = get_node_or_null("/root/Sfx")
	if _sfx2 and _sfx2.has_method("set_rain"):
		_sfx2.set_rain(want)

func _apply() -> void:
	_apply_with_period(period)

func _apply_smooth() -> void:
	## Blend adjacent period tints based on time_of_day for softer day/night.
	var p0 := _period_from_tod(time_of_day)
	_apply_with_period(p0)

func _apply_with_period(p: int) -> void:
	var base: Color = PERIOD_TINT.get(p, Color.WHITE)
	var mood_c: Color = MOOD_TINT.get(mood, Color.WHITE)
	var c := Color(base.r * mood_c.r, base.g * mood_c.g, base.b * mood_c.b, 1.0)
	if _flash > 0.0:
		var f := clampf(_flash, 0.0, 1.0)
		c = c.lerp(Color(1.0, 1.0, 1.0, 1.0), f * 0.85)
	color = c
	var sky: Color = CLEAR_COLORS.get(p, Color(0.45, 0.72, 0.95, 1))
	if mood == Mood.AURORA:
		sky = sky.lerp(Color(0.15, 0.45, 0.55, 1), 0.55)
		sky.g = minf(sky.g + 0.15, 1.0)
	elif mood == Mood.CITY_OVERCAST:
		sky = sky.lerp(Color(0.45, 0.48, 0.55, 1), 0.7)
	elif mood == Mood.RAIN:
		sky = sky.lerp(Color(0.35, 0.4, 0.5, 1), 0.75)
	elif mood == Mood.THUNDER:
		sky = sky.lerp(Color(0.18, 0.2, 0.28, 1), 0.8)
		if _flash > 0.0:
			sky = sky.lerp(Color(0.85, 0.88, 1.0, 1), _flash * 0.7)
	RenderingServer.set_default_clear_color(sky)
