class_name UiKit
extends RefCounted
## v1.8 shared builders for the newer panels (hub, store, tutorial): modal shell, rect buttons, labels.

const UiT = preload("res://scripts/ui_theme.gd")

static func button(text: String, accent: Color = Color(0.25, 0.6, 0.4), min_w: float = 0.0, h: float = 44.0) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(min_w, h)
	b.add_theme_stylebox_override("normal", UiT.style_button_rect(accent))
	b.add_theme_stylebox_override("hover", UiT.style_button_rect(accent.lightened(0.15)))
	b.add_theme_stylebox_override("pressed", UiT.style_button_rect(accent.darkened(0.2)))
	b.add_theme_stylebox_override("disabled", UiT.style_button_rect(Color(0.4, 0.42, 0.45)))
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	b.add_theme_color_override("font_color", UiT.TEXT_CREAM)
	b.add_theme_color_override("font_disabled_color", Color(0.75, 0.75, 0.75))
	b.add_theme_font_size_override("font_size", 14)
	return b

static func label(text: String, size: int = 13, color: Color = Color(0.95, 0.96, 1.0), wrap: bool = true) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.55))
	l.add_theme_constant_override("shadow_offset_y", 1)
	if wrap:
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return l

static func row(sep: int = 8) -> HBoxContainer:
	var r := HBoxContainer.new()
	r.add_theme_constant_override("separation", sep)
	return r

static func card(bg: Color = Color(0.1, 0.2, 0.14, 0.85)) -> PanelContainer:
	var p := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.border_color = Color(0.35, 0.6, 0.4, 0.8)
	sb.set_border_width_all(2)
	sb.set_corner_radius_all(8)
	sb.set_content_margin_all(8)
	p.add_theme_stylebox_override("panel", sb)
	return p

## Full-screen dim + centred panel: {root, vbox, title, tabs, scroll, list, status, close}.
static func modal(parent: Control, node_name: String, title_text: String, half_w: float = 300.0, half_h: float = 235.0) -> Dictionary:
	var root := ColorRect.new()
	root.name = node_name
	root.visible = false
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_STOP
	root.color = Color(0.03, 0.07, 0.12, 0.7)
	var panel := PanelContainer.new()
	panel.set_anchors_preset(Control.PRESET_CENTER)
	panel.offset_left = -half_w
	panel.offset_right = half_w
	panel.offset_top = -half_h
	panel.offset_bottom = half_h
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.12, 0.24, 0.16, 0.97)
	sb.border_color = Color(0.95, 0.78, 0.28)
	sb.set_border_width_all(3)
	sb.set_corner_radius_all(12)
	sb.set_content_margin_all(12)
	sb.shadow_color = Color(0, 0, 0, 0.45)
	sb.shadow_size = 8
	panel.add_theme_stylebox_override("panel", sb)
	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 8)
	var head := row()
	var title_l := label(title_text, 20, Color(1, 0.92, 0.55), false)
	title_l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var close := button("X", Color(0.6, 0.3, 0.32), 44.0)
	head.add_child(title_l)
	head.add_child(close)
	var tabs := row(6)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var list := VBoxContainer.new()
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	list.add_theme_constant_override("separation", 6)
	scroll.add_child(list)
	var status := label("", 12, Color(0.85, 0.95, 1.0))
	status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(head)
	vbox.add_child(tabs)
	vbox.add_child(scroll)
	vbox.add_child(status)
	panel.add_child(vbox)
	root.add_child(panel)
	parent.add_child(root)
	return {"root": root, "panel": panel, "vbox": vbox, "title": title_l, "tabs": tabs, "scroll": scroll, "list": list, "status": status, "close": close}

static func clear(node: Node) -> void:
	for c in node.get_children():
		node.remove_child(c)
		c.queue_free()

static func set_tab_style(b: Button, active: bool) -> void:
	var accent := Color(0.85, 0.6, 0.2) if active else Color(0.22, 0.4, 0.3)
	b.add_theme_stylebox_override("normal", UiT.style_button_rect(accent))
	b.add_theme_stylebox_override("hover", UiT.style_button_rect(accent.lightened(0.15)))
