extends RefCounted
class_name UiCircle
## Shared circular button styling for Pixeltopia (true circle, ≥48dp touch).

const MIN_TOUCH := 48.0
const DEFAULT_SIZE := 64.0
const TOUCH_SIZE := 72.0
const HOTBAR_SIZE := 56.0
const ACTION_SIZE := 72.0
const COMPACT_SIZE := 56.0

static func stylebox(bg: Color, border: Color, radius: float, expand: float = 0.0) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.border_color = border
	sb.set_border_width_all(2)
	sb.set_corner_radius_all(int(ceil(radius)))
	sb.content_margin_left = 4
	sb.content_margin_right = 4
	sb.content_margin_top = 4
	sb.content_margin_bottom = 4
	if expand > 0.0:
		sb.set_expand_margin_all(expand)
	return sb

static func apply(btn: BaseButton, size: float = DEFAULT_SIZE, accent: Color = Color(0.22, 0.48, 0.78)) -> void:
	if btn == null:
		return
	var s: float = maxf(size, MIN_TOUCH)
	btn.custom_minimum_size = Vector2(s, s)
	btn.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	btn.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	btn.clip_text = true
	btn.alignment = HORIZONTAL_ALIGNMENT_CENTER
	var r: float = s * 0.5
	var normal := stylebox(accent, accent.lightened(0.35), r)
	var hover := stylebox(accent.lightened(0.18), Color(1, 0.92, 0.55), r)
	var pressed := stylebox(accent.darkened(0.18), Color(1, 0.85, 0.35), r)
	var disabled := stylebox(Color(0.35, 0.38, 0.42), Color(0.5, 0.52, 0.55), r)
	var focus := stylebox(accent.lightened(0.1), Color(1, 0.95, 0.6), r)
	btn.add_theme_stylebox_override("normal", normal)
	btn.add_theme_stylebox_override("hover", hover)
	btn.add_theme_stylebox_override("pressed", pressed)
	btn.add_theme_stylebox_override("disabled", disabled)
	btn.add_theme_stylebox_override("focus", focus)
	btn.add_theme_color_override("font_color", Color(1, 1, 1))
	btn.add_theme_color_override("font_hover_color", Color(1, 0.98, 0.85))
	btn.add_theme_color_override("font_pressed_color", Color(1, 0.95, 0.7))
	btn.add_theme_color_override("font_disabled_color", Color(0.75, 0.75, 0.78))
	var font_size := 14
	if s <= 52.0:
		font_size = 11
	elif s <= 60.0:
		font_size = 12
	elif s >= 80.0:
		font_size = 15
	btn.add_theme_font_size_override("font_size", font_size)

static func apply_tree(root: Node, size: float = DEFAULT_SIZE, accent: Color = Color(0.22, 0.48, 0.78)) -> void:
	if root == null:
		return
	if root is BaseButton:
		apply(root as BaseButton, size, accent)
	for c in root.get_children():
		apply_tree(c, size, accent)

static func make_button(text: String, size: float = DEFAULT_SIZE, accent: Color = Color(0.22, 0.48, 0.78)) -> Button:
	var b := Button.new()
	b.text = text
	apply(b, size, accent)
	return b
