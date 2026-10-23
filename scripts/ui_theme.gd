extends RefCounted
## Pixeltopia UI kit — green-cream GT-inspired look, original branding.
## Thick-border panels + pixel font when available.
class_name UiTheme

const CREAM := Color(0.96, 0.93, 0.82, 1)
const CREAM_DARK := Color(0.88, 0.84, 0.7, 1)
const GREEN := Color(0.22, 0.55, 0.28, 1)
const GREEN_DEEP := Color(0.12, 0.38, 0.2, 1)
const GREEN_SOFT := Color(0.35, 0.7, 0.42, 1)
const PANEL_BG := Color(0.18, 0.32, 0.2, 0.94)
const PANEL_INNER := Color(0.94, 0.91, 0.8, 0.97)
const TEXT_DARK := Color(0.12, 0.22, 0.14, 1)
const TEXT_CREAM := Color(0.96, 0.93, 0.8, 1)
const BORDER := Color(0.1, 0.28, 0.14, 1)
const GOLD := Color(0.95, 0.78, 0.28, 1)

static var _font: Font = null
static var _theme: Theme = null

static func font() -> Font:
	if _font != null:
		return _font
	if ResourceLoader.exists("res://assets/fonts/PixelifySans.ttf"):
		_font = load("res://assets/fonts/PixelifySans.ttf")
	else:
		_font = ThemeDB.fallback_font
	return _font

static func panel_style(inner: bool = false) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = PANEL_INNER if inner else PANEL_BG
	sb.border_color = BORDER
	sb.set_border_width_all(4)
	sb.set_corner_radius_all(6)
	sb.set_content_margin_all(12)
	sb.shadow_color = Color(0, 0, 0, 0.35)
	sb.shadow_size = 4
	sb.shadow_offset = Vector2(2, 2)
	return sb

static func apply_label(lbl: Label, dark: bool = false, size: int = 14) -> void:
	if lbl == null:
		return
	var f := font()
	if f:
		lbl.add_theme_font_override("font", f)
	lbl.add_theme_font_size_override("font_size", size)
	lbl.add_theme_color_override("font_color", TEXT_DARK if dark else TEXT_CREAM)
	lbl.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.55))
	lbl.add_theme_constant_override("shadow_offset_x", 1)
	lbl.add_theme_constant_override("shadow_offset_y", 1)

static func apply_panel_container(pc: PanelContainer, inner: bool = true) -> void:
	if pc == null:
		return
	pc.add_theme_stylebox_override("panel", panel_style(inner))

static func style_button_rect(bg: Color = GREEN) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.border_color = BORDER
	sb.set_border_width_all(3)
	sb.set_corner_radius_all(8)
	sb.set_content_margin_all(8)
	return sb

static func make_theme() -> Theme:
	if _theme != null:
		return _theme
	var t := Theme.new()
	var f := font()
	if f:
		t.default_font = f
		t.default_font_size = 14
	t.set_stylebox("panel", "PanelContainer", panel_style(true))
	t.set_color("font_color", "Label", TEXT_DARK)
	t.set_color("font_color", "Button", TEXT_CREAM)
	_theme = t
	return t
