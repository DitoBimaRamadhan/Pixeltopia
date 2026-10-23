extends Node2D
## Draws rain streaks / lightning flash overlay for WeatherController.

var _weather: CanvasModulate = null

func bind(w: CanvasModulate) -> void:
	_weather = w
	set_process(true)
	queue_redraw()

func _process(_delta: float) -> void:
	if _weather == null:
		return
	if _weather.has_method("is_raining") and _weather.is_raining():
		queue_redraw()
	elif _weather.has_method("get_flash") and float(_weather.get_flash()) > 0.0:
		queue_redraw()

func _draw() -> void:
	if _weather == null:
		return
	var cam := get_viewport().get_camera_2d()
	var origin := Vector2.ZERO
	if cam:
		var vs := get_viewport().get_visible_rect().size
		origin = cam.get_screen_center_position() - vs * 0.5
	if _weather.has_method("is_raining") and _weather.is_raining():
		var drops: Array = _weather.get_rain_drops()
		var col := Color(0.7, 0.82, 1.0, 0.45)
		if int(_weather.mood) == 4:  ## thunder
			col = Color(0.75, 0.85, 1.0, 0.55)
		for d in drops:
			var p := origin + Vector2(float(d["x"]), float(d["y"]))
			var ln := float(d["len"])
			draw_line(p, p + Vector2(-3.0, ln), col, 1.2)
	if _weather.has_method("get_flash"):
		var f := float(_weather.get_flash())
		if f > 0.05:
			var vs2 := get_viewport().get_visible_rect().size
			draw_rect(Rect2(origin, vs2), Color(1, 1, 1, f * 0.35))
