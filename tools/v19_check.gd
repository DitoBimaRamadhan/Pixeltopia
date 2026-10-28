extends Node
## v1.9 headless checks: movement feel (air control, coyote, buffer, variable jump, corner nudge,
## unstick) and the multi-touch pad (hold ◀ + Jump together). Exit code 1 on failure.
## Run: godot --headless --path . res://tools/v19_check.tscn

var fails := 0
var main: Node
var player: Node
var world: Node

func check(cond: bool, what: String) -> void:
	print(("OK   " if cond else "FAIL ") + what)
	if not cond:
		fails += 1

func _ready() -> void:
	main = load("res://scenes/main.tscn").instantiate()
	add_child(main)
	await get_tree().process_frame
	await get_tree().process_frame
	player = main.get_node("Player")
	world = main.get_node("World")
	player.set_physics_process(false)  ## drive steps manually
	_flat_arena()
	_test_air_control()
	_test_variable_jump()
	_test_coyote_and_buffer()
	_test_corner_nudge()
	_test_unstick()
	await _test_touch_pad()
	await _test_chat_blocks_keys()
	_test_ambience()
	_test_music()
	await _test_jukebox_ui()
	print("V19_CHECK ", "OK" if fails == 0 else "FAIL count=%d" % fails)
	get_tree().quit(1 if fails > 0 else 0)

const FLOOR_Y := 20

func _flat_arena() -> void:
	for x in range(world.W):
		for y in range(4, FLOOR_Y):
			world.set_tile(x, y, Tiles.Id.AIR)
		world.set_tile(x, FLOOR_Y, Tiles.Id.STONE)

func _place_on_floor(tx: int) -> void:
	player.global_position = Vector2(tx * Tiles.SIZE + 16, FLOOR_Y * Tiles.SIZE - player.BODY.y * 0.5)
	player.velocity = Vector2.ZERO
	player.on_floor = true
	player._jump_buffer_t = 0.0
	player._coyote_t = 0.0
	for i in range(3):
		player.step_movement(1.0 / 60.0, 0.0, false, false)

func _steps(n: int, dir: float, press: bool, held: bool) -> void:
	for i in range(n):
		player.step_movement(1.0 / 60.0, dir, press and i == 0, held)

func _test_air_control() -> void:
	_place_on_floor(20)
	check(player.on_floor, "player stands on the arena floor")
	_steps(1, 1.0, true, true)
	check(not player.on_floor and player.velocity.y < 0.0, "jump leaves the ground")
	_steps(20, -1.0, false, true)
	check(not player.on_floor and player.velocity.x < -100.0, "air control: steer left mid-jump (vx=%.0f)" % player.velocity.x)
	var x0: float = player.global_position.x
	_steps(10, 1.0, false, true)
	check(player.velocity.x > 0.0 and player.global_position.x > x0 - 40.0, "air control: reverse to the right mid-air")
	_steps(120, 0.0, false, false)
	check(player.on_floor, "lands again")
	_steps(30, 0.0, false, false)
	check(absf(player.velocity.x) < 1.0, "ground friction stops the player")

func _apex(hold_frames: int) -> float:
	_place_on_floor(20)
	var y0: float = player.global_position.y
	var best := 0.0
	for i in range(90):
		player.step_movement(1.0 / 60.0, 0.0, i == 0, i < hold_frames)
		best = maxf(best, y0 - player.global_position.y)
	return best

func _test_variable_jump() -> void:
	var full := _apex(90)
	var short := _apex(4)
	check(full > Tiles.SIZE * 1.5 and full < Tiles.SIZE * 2.2, "full jump ≈ 1.8 tiles (%.1f px)" % full)
	check(short < full * 0.7, "tap jump is lower (%.1f < %.1f)" % [short, full])

func _test_coyote_and_buffer() -> void:
	## Ledge at x=30: remove floor to the right, walk off, jump a few frames later.
	for x in range(31, 40):
		world.set_tile(x, FLOOR_Y, Tiles.Id.AIR)
	_place_on_floor(29)
	var left_ground := -1
	for i in range(60):
		player.step_movement(1.0 / 60.0, 1.0, false, false)
		if not player.on_floor:
			left_ground = i
			break
	check(left_ground >= 0, "walked off the ledge")
	_steps(3, 1.0, false, false)  ## 3 frames late (~50 ms)
	player.step_movement(1.0 / 60.0, 1.0, true, true)
	check(player.velocity.y < -200.0, "coyote time: late jump after leaving a ledge still works")
	for x in range(31, 40):
		world.set_tile(x, FLOOR_Y, Tiles.Id.STONE)
	## Buffer: press jump shortly before touching down.
	_place_on_floor(20)
	player.global_position.y -= 6.0
	player.on_floor = false
	player.velocity.y = 200.0
	player.step_movement(1.0 / 60.0, 0.0, true, true)
	var jumped := false
	for i in range(8):
		player.step_movement(1.0 / 60.0, 0.0, false, true)
		if player.velocity.y < -200.0:
			jumped = true
			break
	check(jumped, "jump buffer: pressing just before landing jumps on touchdown")

func _test_corner_nudge() -> void:
	_place_on_floor(20)
	## Ceiling block two tiles up, offset so only the player's edge is under it.
	var cx := 21
	world.set_tile(cx, FLOOR_Y - 3, Tiles.Id.STONE)
	player.global_position.x = cx * Tiles.SIZE - player.BODY.x * 0.5 + 4.0  ## 4 px under the block
	var bonk := true
	for i in range(40):
		player.step_movement(1.0 / 60.0, 0.0, i == 0, true)
		if player.global_position.y - player.BODY.y * 0.5 < (FLOOR_Y - 2) * Tiles.SIZE - 4.0:
			bonk = false
	check(not bonk, "corner correction slides past a ceiling edge")
	world.set_tile(cx, FLOOR_Y - 3, Tiles.Id.AIR)
	_steps(120, 0.0, false, false)

func _test_unstick() -> void:
	_place_on_floor(20)
	var t: Vector2i = world.world_to_tile(player.global_position)
	world.set_tile(t.x, t.y, Tiles.Id.STONE)
	_steps(2, 0.0, false, false)
	check(not player._overlaps_solid(player.global_position), "player pops out of a block placed on them")
	world.set_tile(t.x, t.y, Tiles.Id.AIR)

func _touch(idx: int, b: Control, pressed: bool) -> void:
	var ev := InputEventScreenTouch.new()
	ev.index = idx
	ev.pressed = pressed
	ev.position = b.get_global_rect().get_center()
	get_viewport().push_input(ev, true)

func _drag(idx: int, to: Vector2) -> void:
	var ev := InputEventScreenDrag.new()
	ev.index = idx
	ev.position = to
	get_viewport().push_input(ev, true)

func _test_touch_pad() -> void:
	var hud: Node = main.get_node("HUD")
	var pad: Node = hud.touch
	## No two pad buttons may overlap (v1.8 bug: hotbar arrows covered ▶ and Punch on 16:9).
	var btns: Array = []
	for c in hud.get_node("Root/TouchPad").get_children():
		if c is Control and c.visible:
			btns.append(c)
	var overlaps: Array = []
	for i in range(btns.size()):
		for j in range(i + 1, btns.size()):
			if btns[i].get_global_rect().intersects(btns[j].get_global_rect()):
				overlaps.append("%s/%s" % [btns[i].name, btns[j].name])
	check(overlaps.is_empty(), "touch buttons do not overlap %s" % str(overlaps))
	check(pad != null, "touch controls exist")
	if pad == null:
		return
	_place_on_floor(20)
	player.set_physics_process(true)
	var left: Control = pad.button("left")
	var right: Control = pad.button("right")
	var jump: Control = pad.button("jump")
	_touch(0, left, true)
	await get_tree().physics_frame
	_touch(1, jump, true)  ## second finger while ◀ is still held
	await get_tree().physics_frame
	await get_tree().physics_frame
	check(player._touch_dir < 0.0, "finger 0 holds ◀")
	check(not player.on_floor and player.velocity.y < 0.0, "finger 1 on Jump jumps while ◀ is held")
	for i in range(6):
		await get_tree().physics_frame
	check(player.velocity.x < -50.0, "moving left while jumping on touch (vx=%.0f)" % player.velocity.x)
	_drag(0, right.get_global_rect().get_center())
	await get_tree().physics_frame
	check(player._touch_dir > 0.0, "slide finger 0 from ◀ to ▶ switches direction")
	_touch(0, right, false)
	await get_tree().physics_frame
	check(player._touch_dir == 0.0 and player._touch_jump_held, "lifting move finger keeps Jump held")
	_touch(1, jump, false)
	await get_tree().physics_frame
	check(not player._touch_jump_held, "lifting jump finger releases Jump")
	var punch: Control = pad.button("punch")
	_touch(2, punch, true)
	await get_tree().physics_frame
	check(player._touch_punch_held, "punch can be held with another finger")
	hud.open_shop()
	await get_tree().physics_frame
	check(not player._touch_punch_held, "opening a panel releases held touch buttons")
	hud.close_shop()
	_touch(2, punch, false)
	player.set_physics_process(false)

func _test_chat_blocks_keys() -> void:
	var hud: Node = main.get_node("HUD")
	var le := LineEdit.new()
	hud.get_node("Root").add_child(le)
	await get_tree().process_frame
	var ev := InputEventKey.new()
	ev.keycode = KEY_A
	ev.physical_keycode = KEY_A
	ev.pressed = true
	Input.parse_input_event(ev)
	await get_tree().process_frame
	check(player.read_move_dir() < 0.0, "A key moves left normally")
	le.grab_focus()
	await get_tree().process_frame
	check(player.read_move_dir() == 0.0, "typing in a text box does not move the player")
	ev = ev.duplicate()
	ev.pressed = false
	Input.parse_input_event(ev)
	le.queue_free()


func _test_ambience() -> void:
	var A = load("res://scripts/ambience.gd")
	## open sky on the flat arena floor, day vs night
	var t := Vector2i(30, FLOOR_Y - 1)
	check(A.pick(world, t, 1, 0) == "day", "ambience: day on open ground")
	check(A.pick(world, t, 3, 0) == "night", "ambience: night on open ground")
	check(A.pick(world, t, 1, 4) == "rain", "ambience: thunderstorm -> heavy rain")
	check(A.pick(world, Vector2i(30, 5), 1, 0) == "wind", "ambience: high up -> wind")
	for x in range(26, 35):
		world.set_tile(x, FLOOR_Y, Tiles.Id.SAND)
	check(A.pick(world, t, 1, 0) == "ocean", "ambience: on sand -> shore")
	## roof over the player deep down -> cave
	for x in range(26, 35):
		world.set_tile(x, FLOOR_Y, Tiles.Id.STONE)
		for y in range(FLOOR_Y - 8, FLOOR_Y - 4):
			world.set_tile(x, y, Tiles.Id.STONE)
	check(A.pick(world, t, 1, 0) == "cave", "ambience: under a roof deep down -> cave")
	for x in range(26, 35):
		for y in range(FLOOR_Y - 8, FLOOR_Y - 4):
			world.set_tile(x, y, Tiles.Id.AIR)
	for k in Sfx.AMBIENCE:
		check(ResourceLoader.exists(Sfx.AMBIENCE[k]), "ambience file " + str(k))

func _test_music() -> void:
	check(Sfx.TRACKS.size() == 29, "29 songs in the playlist (11 + 18)")
	var missing := 0
	for tr in Sfx.TRACKS:
		if not ResourceLoader.exists(tr[0]):
			missing += 1
	check(missing == 0, "all song files import (missing=%d)" % missing)
	var old_album: String = Settings.music_album
	Settings.music_album = "vol2"
	var v2: Array = Sfx.album_indices()
	check(v2.size() == 18 and int(v2[0]) == Sfx.VOL1_COUNT, "album filter vol2")
	Settings.music_album = "vol1"
	check(Sfx.album_indices().size() == 11, "album filter vol1")
	Settings.music_album = old_album
	Sfx.rebuild_order()
	var was_muted: bool = Sfx.muted
	Sfx.muted = false
	Sfx.music_muted = false
	Sfx.play_track(15)
	check(Sfx.now_index == 15 and Sfx.now_playing == str(Sfx.TRACKS[15][1]), "jukebox plays the chosen song")
	Sfx.set_rain(true)
	Sfx.set_muted(true)
	Sfx.set_muted(false)
	check(Sfx._rain_want and Sfx._rain.playing, "rain resumes after unmute")
	Sfx.set_rain(false)
	Sfx.set_muted(was_muted)


func _test_jukebox_ui() -> void:
	var hud: Node = main.get_node("HUD")
	hud.open_hub("settings")
	await get_tree().process_frame
	hud.hub._jukebox_open = true
	Settings.music_album = "all"
	hud.hub.rebuild()
	await get_tree().process_frame
	var n := 0
	for b in (hud.hub.ui["list"] as Node).find_children("*", "Button", true, false):
		var bt: String = (b as Button).text
		for tr in Sfx.TRACKS:
			if bt.ends_with(str(tr[1])):
				n += 1
				break
	check(n == Sfx.TRACKS.size(), "jukebox lists all %d songs (got %d)" % [Sfx.TRACKS.size(), n])
	hud.hub._jukebox_open = false
	hud.close_hub()
