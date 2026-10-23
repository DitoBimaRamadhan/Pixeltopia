extends Node2D
## Short-lived floating loot text + simple particle dots.

var _label: Label
var _life := 1.2
var _vel := Vector2(0, -48)
var _dots: Array = []  ## [{pos, vel, color, life}]

func setup(text: String, color: Color = Color(1.0, 0.92, 0.45)) -> void:
	_label = Label.new()
	_label.text = text
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.add_theme_color_override("font_color", color)
	_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.75))
	_label.add_theme_constant_override("shadow_offset_x", 1)
	_label.add_theme_constant_override("shadow_offset_y", 1)
	_label.add_theme_font_size_override("font_size", 14)
	_label.position = Vector2(-48, -10)
	_label.size = Vector2(96, 20)
	add_child(_label)
	for i in range(6):
		var a := randf() * TAU
		_dots.append({
			"pos": Vector2(randf_range(-4, 4), randf_range(-4, 4)),
			"vel": Vector2(cos(a), sin(a)) * randf_range(20, 55) + Vector2(0, -30),
			"color": Color(color.r, color.g, color.b, 1.0).lightened(randf_range(0.0, 0.3)),
			"life": randf_range(0.4, 0.9),
		})
	queue_redraw()

func _process(delta: float) -> void:
	position += _vel * delta
	_vel.y += 40.0 * delta
	_life -= delta
	if _label:
		_label.modulate.a = clampf(_life / 0.5, 0.0, 1.0)
	for d in _dots:
		d.pos += d.vel * delta
		d.vel.y += 80.0 * delta
		d.life -= delta
	queue_redraw()
	if _life <= 0.0:
		queue_free()

func _draw() -> void:
	for d in _dots:
		if d.life <= 0.0:
			continue
		var a: float = clampf(d.life / 0.5, 0.0, 1.0)
		var c: Color = d.color
		c.a = a
		draw_circle(d.pos, 2.5, c)
