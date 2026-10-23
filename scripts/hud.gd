extends CanvasLayer
## Hotbar + selected item + pause/save for Pixeltopia.

@onready var inv: Node = get_parent().get_node("Inventory")
@onready var bar: HBoxContainer = $Root/Hotbar
@onready var hint: Label = $Root/Hint
@onready var title: Label = $Root/Title
@onready var selected_lbl: Label = $Root/Selected
@onready var pause_panel: Control = $Root/Pause
@onready var pause_status: Label = $Root/Pause/Panel/Status

var paused: bool = false

signal pause_changed(paused: bool)
signal save_requested
signal load_requested

func _ready() -> void:
	title.text = "Pixeltopia"
	hint.text = "A/D move · W/Space jump · LMB punch/harvest · RMB place · 1-7 hotbar · Esc pause/save · plant Seed, wait ~8s"
	inv.changed.connect(_rebuild)
	pause_panel.visible = false
	$Root/Pause/Panel/BtnResume.pressed.connect(_resume)
	$Root/Pause/Panel/BtnSave.pressed.connect(_on_save)
	$Root/Pause/Panel/BtnLoad.pressed.connect(_on_load)
	_rebuild()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ESCAPE:
			set_paused(not paused)
			get_viewport().set_input_as_handled()

func set_paused(v: bool) -> void:
	paused = v
	pause_panel.visible = paused
	if paused:
		pause_status.text = "Paused — progress saves to user://pixeltopia_save.json"
	pause_changed.emit(paused)

func _resume() -> void:
	set_paused(false)

func _on_save() -> void:
	save_requested.emit()
	pause_status.text = "Saved."

func _on_load() -> void:
	load_requested.emit()
	pause_status.text = "Loaded (or no save found)."

func show_status(msg: String) -> void:
	pause_status.text = msg

func _rebuild() -> void:
	for c in bar.get_children():
		c.queue_free()
	for i in range(inv.slot_count()):
		var b := Button.new()
		b.custom_minimum_size = Vector2(72, 40)
		b.toggle_mode = true
		b.button_pressed = (i == inv.selected)
		b.text = inv.label_for(i)
		var idx := i
		b.pressed.connect(func() -> void: inv.select(idx))
		if i == inv.selected:
			b.modulate = Color(1.2, 1.15, 0.9)
		bar.add_child(b)
	selected_lbl.text = "Selected: %s" % inv.selected_name()
