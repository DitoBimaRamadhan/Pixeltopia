extends Node
## v1.8 player settings (autoload "Settings"): volumes, language, tutorial, touch size, screen shake.
## Stored in user://settings.cfg (no account data, nothing secret).

signal changed

const PATH := "user://settings.cfg"

var music_volume: float = 0.7  ## 0..1
var sfx_volume: float = 0.85
var language: String = "id"  ## "id" | "en"
var tutorial_done: bool = false
var touch_scale: float = 1.0  ## 0.8..1.3
var screen_shake: bool = true
var show_fps: bool = false

func _ready() -> void:
	var lang := OS.get_locale_language()
	language = "id" if lang == "id" or lang == "ms" else "en"
	_load()
	apply_audio()

func _load() -> void:
	var cf := ConfigFile.new()
	if cf.load(PATH) != OK:
		return
	music_volume = clampf(float(cf.get_value("audio", "music", music_volume)), 0.0, 1.0)
	sfx_volume = clampf(float(cf.get_value("audio", "sfx", sfx_volume)), 0.0, 1.0)
	var l := str(cf.get_value("ui", "language", language))
	language = l if l in ["id", "en"] else language
	tutorial_done = bool(cf.get_value("ui", "tutorial_done", false))
	touch_scale = clampf(float(cf.get_value("ui", "touch_scale", 1.0)), 0.8, 1.3)
	screen_shake = bool(cf.get_value("ui", "screen_shake", true))
	show_fps = bool(cf.get_value("ui", "show_fps", false))

func save() -> void:
	var cf := ConfigFile.new()
	cf.set_value("audio", "music", music_volume)
	cf.set_value("audio", "sfx", sfx_volume)
	cf.set_value("ui", "language", language)
	cf.set_value("ui", "tutorial_done", tutorial_done)
	cf.set_value("ui", "touch_scale", touch_scale)
	cf.set_value("ui", "screen_shake", screen_shake)
	cf.set_value("ui", "show_fps", show_fps)
	cf.save(PATH)

static func _db(v: float) -> float:
	return -80.0 if v <= 0.001 else linear_to_db(v)

func apply_audio() -> void:
	var mi := AudioServer.get_bus_index("Music")
	var si := AudioServer.get_bus_index("SFX")
	if mi >= 0:
		AudioServer.set_bus_volume_db(mi, _db(music_volume))
		AudioServer.set_bus_mute(mi, music_volume <= 0.001)
	if si >= 0:
		AudioServer.set_bus_volume_db(si, _db(sfx_volume))
		AudioServer.set_bus_mute(si, sfx_volume <= 0.001)

func set_value(key: String, v: Variant) -> void:
	match key:
		"music_volume": music_volume = clampf(float(v), 0.0, 1.0)
		"sfx_volume": sfx_volume = clampf(float(v), 0.0, 1.0)
		"language": language = str(v) if str(v) in ["id", "en"] else language
		"tutorial_done": tutorial_done = bool(v)
		"touch_scale": touch_scale = clampf(float(v), 0.8, 1.3)
		"screen_shake": screen_shake = bool(v)
		"show_fps": show_fps = bool(v)
		_: return
	apply_audio()
	save()
	changed.emit()
