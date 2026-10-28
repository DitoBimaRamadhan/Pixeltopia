extends Node
## v1.9 multi-touch on-screen pad.
##
## Why: until v1.8 the pad used Button signals (button_down/pressed). Godot Buttons only react to
## mouse events, and on Android only the FIRST finger is turned into a mouse, so while you held ◀/▶
## a second finger on Jump never reached the button (and Jump only fired on release). Now every pad
## button reads InputEventScreenTouch/ScreenDrag per finger index, so move + jump (+ punch) can be
## held together. Desktop mouse clicks still work (real mouse events only, emulated ones are ignored).

## Emitted when a held action changes: action in ["left","right","jump","down","punch"].
signal hold_changed(action: String, held: bool)
## Emitted on press of a tap action (e.g. "place", "prev", "next", "drop").
signal tapped(action: String)

var _buttons: Dictionary = {}  ## action -> Control
var _hold_actions: Dictionary = {}  ## action -> true if it is a hold button
var _fingers: Dictionary = {}  ## finger index -> action ("mouse" key for a real mouse)
var _held_count: Dictionary = {}  ## action -> number of fingers holding it
var slide_group := ["left", "right"]  ## a finger can slide between these without lifting

func bind(action: String, b: Control, hold: bool) -> void:
	_buttons[action] = b
	_hold_actions[action] = hold
	b.gui_input.connect(_on_gui_input.bind(action, b))

func button(action: String) -> Control:
	return _buttons.get(action, null)

func is_held(action: String) -> bool:
	return int(_held_count.get(action, 0)) > 0

func release_all() -> void:
	var acts := _held_count.keys()
	_fingers.clear()
	_held_count.clear()
	for a in acts:
		_set_visual(a, false)
		hold_changed.emit(a, false)

func _press(finger, action: String) -> void:
	if _fingers.has(finger):
		_release(finger)
	_fingers[finger] = action
	if _hold_actions.get(action, false):
		var n := int(_held_count.get(action, 0)) + 1
		_held_count[action] = n
		if n == 1:
			_set_visual(action, true)
			hold_changed.emit(action, true)
	else:
		_set_visual(action, true)
		tapped.emit(action)

func _release(finger) -> void:
	if not _fingers.has(finger):
		return
	var action: String = _fingers[finger]
	_fingers.erase(finger)
	if _hold_actions.get(action, false):
		var n := maxi(int(_held_count.get(action, 0)) - 1, 0)
		if n == 0:
			_held_count.erase(action)
			_set_visual(action, false)
			hold_changed.emit(action, false)
		else:
			_held_count[action] = n
	else:
		_set_visual(action, false)

func _set_visual(action: String, on: bool) -> void:
	var b: Control = _buttons.get(action, null)
	if b and is_instance_valid(b):
		b.modulate = Color(0.78, 0.9, 1.0) if on else Color.WHITE

func _hit_action(global_pos: Vector2) -> String:
	for a in slide_group:
		var b: Control = _buttons.get(a, null)
		if b and b.is_visible_in_tree() and b.get_global_rect().grow(6.0).has_point(global_pos):
			return a
	return ""

func _on_gui_input(event: InputEvent, action: String, b: Control) -> void:
	if event is InputEventScreenTouch:
		var st := event as InputEventScreenTouch
		if st.pressed:
			_press(st.index, action)
		else:
			_release(st.index)
		b.accept_event()
	elif event is InputEventScreenDrag:
		var sd := event as InputEventScreenDrag
		var cur: String = _fingers.get(sd.index, "")
		if cur in slide_group:
			var gp: Vector2 = b.get_global_transform_with_canvas() * sd.position
			var over := _hit_action(gp)
			if over != "" and over != cur:
				_press(sd.index, over)
		b.accept_event()
	elif event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		## Emulated-from-touch mouse events are ignored (the touch path above already handled them).
		if mb.device == InputEvent.DEVICE_ID_EMULATION or mb.button_index != MOUSE_BUTTON_LEFT:
			return
		if mb.pressed:
			_press("mouse", action)
		else:
			_release("mouse")

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT or what == NOTIFICATION_APPLICATION_PAUSED:
		release_all()
