extends Node
## v1.8 first-run tutorial: six short cards at the bottom of the screen (skippable, replay from Settings).

const STEPS := 6
var root: Control = null
var _text: Label = null
var _dots: Label = null
var _next: Button = null
var step: int = 0
var active: bool = false

signal finished

func setup(parent: Control) -> void:
	root = UiKit.card(Color(0.08, 0.16, 0.12, 0.94))
	root.name = "Tutorial"
	root.visible = false
	root.anchor_left = 0.5
	root.anchor_right = 0.5
	root.anchor_top = 1.0
	root.anchor_bottom = 1.0
	root.offset_left = -300
	root.offset_right = 300
	root.offset_top = -250
	root.offset_bottom = -150
	root.mouse_filter = Control.MOUSE_FILTER_STOP
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	_text = UiKit.label("", 14)
	_text.custom_minimum_size = Vector2(560, 44)
	var r := UiKit.row()
	_dots = UiKit.label("", 14, Color(1, 0.85, 0.4), false)
	_dots.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var skip := UiKit.button(I18n.t("tut_skip"), Color(0.35, 0.4, 0.5), 90.0, 38.0)
	skip.name = "Skip"
	skip.pressed.connect(finish)
	_next = UiKit.button(I18n.t("tut_next"), Color(0.25, 0.6, 0.4), 120.0, 38.0)
	_next.pressed.connect(next)
	r.add_child(_dots)
	r.add_child(skip)
	r.add_child(_next)
	v.add_child(_text)
	v.add_child(r)
	root.add_child(v)
	parent.add_child(root)

func start() -> void:
	step = 0
	active = true
	root.visible = true
	_show()

func next() -> void:
	Sfx.play_ui()
	step += 1
	if step >= STEPS:
		finish()
		return
	_show()

func finish() -> void:
	active = false
	root.visible = false
	Settings.set_value("tutorial_done", true)
	finished.emit()

func _show() -> void:
	_text.text = I18n.t("tut_%d" % (step + 1))
	var d := ""
	for i in range(STEPS):
		d += ("[%d]" % (i + 1)) if i == step else " . "
	_dots.text = d
	_next.text = I18n.t("tut_done") if step == STEPS - 1 else I18n.t("tut_next")
	var skip: Button = root.find_child("Skip", true, false)
	if skip:
		skip.text = I18n.t("tut_skip")
