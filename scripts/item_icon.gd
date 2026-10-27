extends RefCounted
class_name ItemIcon
## Original procedural item icons for Pixeltopia backpack/hotbar (not GT assets).

const CELL := 56.0
const ICON := 28.0

static func slot_style(border: Color, fill: Color = Color(0.12, 0.18, 0.28, 0.95)) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = fill
	sb.border_color = border
	sb.set_border_width_all(2)
	sb.set_corner_radius_all(6)
	sb.content_margin_left = 4
	sb.content_margin_right = 4
	sb.content_margin_top = 4
	sb.content_margin_bottom = 4
	return sb

static func make_cell(item_id: int, count: int, selected: bool, empty_label: String = "") -> PanelContainer:
	## Square GT-like inventory cell: colored icon + stack count corner.
	var cell := PanelContainer.new()
	cell.custom_minimum_size = Vector2(CELL, CELL)
	var border := Color(1.0, 0.85, 0.35) if selected else Color(0.35, 0.55, 0.85)
	var fill := Color(0.18, 0.22, 0.12, 0.98) if selected else Color(0.10, 0.16, 0.26, 0.96)
	if item_id >= 0 and count > 0:
		border = Items.rarity_color(item_id).lerp(border, 0.35) if not selected else border
	cell.add_theme_stylebox_override("panel", slot_style(border, fill))

	var root := Control.new()
	root.custom_minimum_size = Vector2(CELL - 8.0, CELL - 8.0)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cell.add_child(root)

	if item_id >= 0 and count > 0:
		var icon := TextureRect.new()
		icon.size = Vector2(ICON, ICON)
		icon.position = Vector2((CELL - 8.0 - ICON) * 0.5, 4.0)
		icon.texture = Tiles.icon_texture(item_id)
		icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		icon.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
		root.add_child(icon)
		## Tiny highlight rim for readability
		var rim := ColorRect.new()
		rim.size = Vector2(ICON + 2.0, ICON + 2.0)
		rim.position = icon.position - Vector2(1, 1)
		rim.color = Items.rarity_color(item_id).darkened(0.25)
		rim.color.a = 0.45
		rim.mouse_filter = Control.MOUSE_FILTER_IGNORE
		rim.z_index = -1
		root.add_child(rim)
		root.move_child(rim, 0)

		var cnt := Label.new()
		cnt.text = str(count) if count < 1000 else "%dk" % int(count / 1000.0)
		cnt.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		cnt.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
		cnt.position = Vector2(0, CELL - 28.0)
		cnt.size = Vector2(CELL - 10.0, 16.0)
		cnt.add_theme_font_size_override("font_size", 11)
		cnt.add_theme_color_override("font_color", Color(1, 1, 1))
		cnt.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.85))
		cnt.add_theme_constant_override("shadow_offset_x", 1)
		cnt.add_theme_constant_override("shadow_offset_y", 1)
		cnt.mouse_filter = Control.MOUSE_FILTER_IGNORE
		root.add_child(cnt)
	else:
		var dash := Label.new()
		dash.text = empty_label if empty_label != "" else "—"
		dash.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		dash.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		dash.set_anchors_preset(Control.PRESET_FULL_RECT)
		dash.add_theme_font_size_override("font_size", 12)
		dash.add_theme_color_override("font_color", Color(0.55, 0.6, 0.7))
		dash.mouse_filter = Control.MOUSE_FILTER_IGNORE
		root.add_child(dash)

	return cell

static func make_fist_cell(selected: bool) -> PanelContainer:
	var cell := PanelContainer.new()
	cell.custom_minimum_size = Vector2(CELL, CELL)
	var border := Color(1.0, 0.85, 0.35) if selected else Color(0.55, 0.45, 0.35)
	var fill := Color(0.28, 0.22, 0.14, 0.98) if selected else Color(0.16, 0.14, 0.12, 0.96)
	cell.add_theme_stylebox_override("panel", slot_style(border, fill))
	var lab := Label.new()
	lab.text = "Fist"
	lab.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lab.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	lab.custom_minimum_size = Vector2(CELL - 8.0, CELL - 8.0)
	lab.add_theme_font_size_override("font_size", 11)
	lab.add_theme_color_override("font_color", Color(1, 0.92, 0.7))
	lab.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cell.add_child(lab)
	return cell
