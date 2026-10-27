extends Node
## v1.8 Menu hub (key M / ☰ button): Daily reward + daily quests, Ranking, Friends + private messages,
## World settings (lock owner) and Settings (volume, language, touch size, tutorial).

var hud: Node = null
var ui: Dictionary = {}
var is_open: bool = false
var tab: String = "daily"
var _tab_btns: Dictionary = {}
var daily: Dictionary = {}
var board: Dictionary = {}
var friends: Dictionary = {}
var pm_with: String = ""  ## user id of the open thread ("" = friend list)
var pm_with_name: String = ""
var pm_msgs: Array = []
var unread_total: int = 0
var _friend_input: LineEdit = null
var _pm_input: LineEdit = null
var _welcome_input: LineEdit = null

signal daily_badge_changed(ready: bool, unread: int)
signal replay_tutorial

const TABS := ["daily", "rank", "friends", "world", "settings"]

func setup(p_hud: Node, parent: Control) -> void:
	hud = p_hud
	ui = UiKit.modal(parent, "HubUI", I18n.t("hub_title"), 330.0, 245.0)
	ui["close"].pressed.connect(close)
	for k in TABS:
		var b := UiKit.button(I18n.t("tab_" + k), Color(0.22, 0.4, 0.3), 0.0, 40.0)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var kk: String = k
		b.pressed.connect(func() -> void:
			show_tab(kk)
			Sfx.play_ui())
		ui["tabs"].add_child(b)
		_tab_btns[k] = b
	if Settings.has_signal("changed"):
		Settings.changed.connect(func() -> void:
			if is_open and tab != "settings":
				rebuild())

func net() -> Node:
	return hud._net if hud and hud._net and hud._net.online and not hud._net.is_guest else null

func open(start_tab: String = "") -> void:
	is_open = true
	ui["root"].visible = true
	show_tab(start_tab if start_tab != "" else tab)
	Sfx.play_open()

func close() -> void:
	if not is_open:
		return
	is_open = false
	ui["root"].visible = false
	hud._emit_block_input()

func show_tab(k: String) -> void:
	tab = k
	ui["status"].text = ""
	var n := net()
	if n:
		match k:
			"daily": n.send_social("daily_state")
			"rank": n.send_social("leaderboard")
			"friends":
				if pm_with != "":
					n.send_social("pm_thread", {"with": pm_with})
				else:
					n.send_social("friend_list")
	rebuild()

func refresh_badges() -> void:
	var n := net()
	if n:
		n.send_social("daily_state")
		n.send_social("friend_list")

func rebuild() -> void:
	if ui.is_empty():
		return
	ui["title"].text = I18n.t("hub_title")
	for k in _tab_btns:
		UiKit.set_tab_style(_tab_btns[k], k == tab)
		_tab_btns[k].text = I18n.t("tab_" + k)
	var list: VBoxContainer = ui["list"]
	UiKit.clear(list)
	match tab:
		"daily": _build_daily(list)
		"rank": _build_rank(list)
		"friends": _build_friends(list)
		"world": _build_world(list)
		"settings": _build_settings(list)

func _need_online(list: VBoxContainer) -> bool:
	if net() == null:
		list.add_child(UiKit.label(I18n.t("online_only"), 14))
		return true
	return false

# ---------------- daily ----------------
func _build_daily(list: VBoxContainer) -> void:
	if _need_online(list):
		return
	if daily.is_empty():
		list.add_child(UiKit.label(I18n.t("loading")))
		return
	var c := UiKit.card(Color(0.25, 0.2, 0.08, 0.9))
	var v := VBoxContainer.new()
	c.add_child(v)
	v.add_child(UiKit.label(I18n.t("daily_login"), 16, Color(1, 0.88, 0.45)))
	var streak := int(daily.get("streak", 1))
	## 7-day track: day 7 caps the reward
	var track := UiKit.row(4)
	for d in range(1, 8):
		var cur := ((streak - 1) % 7) + 1
		var done := d < cur or (d == cur and bool(daily.get("claimedToday", false)))
		var day_lbl := ("H%d" % d) if I18n.lang() == "id" else ("D%d" % d)
		var cell := UiKit.label("%s\n%d" % ["OK" if done else day_lbl, 15 + 5 * (d - 1)], 11,
			Color(0.6, 1, 0.7) if done else (Color(1, 0.9, 0.5) if d == cur else Color(0.8, 0.85, 0.9)), false)
		cell.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		cell.custom_minimum_size = Vector2(46, 0)
		track.add_child(cell)
	v.add_child(track)
	if bool(daily.get("claimedToday", false)):
		v.add_child(UiKit.label(I18n.t("daily_claimed", [int(daily.get("nextReward", 0)), streak + 1])))
	else:
		v.add_child(UiKit.label(I18n.t("daily_streak", [streak, int(daily.get("reward", 15))])))
		var b := UiKit.button(I18n.t("daily_claim", [int(daily.get("reward", 15))]), Color(0.8, 0.55, 0.15), 200.0)
		b.pressed.connect(func() -> void:
			b.disabled = true
			net().send_social("daily_claim"))
		v.add_child(b)
	list.add_child(c)
	list.add_child(UiKit.label(I18n.t("daily_quests"), 15, Color(1, 0.92, 0.55)))
	for q in daily.get("quests", []):
		var r := UiKit.row()
		var title := str(q.get("title" if I18n.lang() == "id" else "title_en", q.get("title", "")))
		if title == "":
			title = I18n.t("dq_" + str(q.get("key", "")), [int(q.get("goal", 0))])
		var l := UiKit.label(I18n.t("dq_progress", [title, int(q.get("progress", 0)), int(q.get("goal", 0)), int(q.get("gems", 0))]), 13)
		r.add_child(l)
		var bar := ProgressBar.new()
		bar.custom_minimum_size = Vector2(90, 14)
		bar.max_value = max(1, int(q.get("goal", 1)))
		bar.value = int(q.get("progress", 0))
		bar.show_percentage = false
		bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		r.add_child(bar)
		if bool(q.get("claimed", false)):
			r.add_child(UiKit.label(I18n.t("dq_claimed"), 16, Color(0.5, 1, 0.6), false))
		else:
			var b2 := UiKit.button(I18n.t("dq_claim"), Color(0.25, 0.6, 0.4), 70.0)
			b2.disabled = int(q.get("progress", 0)) < int(q.get("goal", 1))
			var key := str(q.get("key", ""))
			b2.pressed.connect(func() -> void:
				b2.disabled = true
				net().send_social("daily_quest_claim", {"key": key}))
			r.add_child(b2)
		list.add_child(r)

# ---------------- leaderboard ----------------
func _build_rank(list: VBoxContainer) -> void:
	if _need_online(list):
		return
	var head := UiKit.row()
	head.add_child(UiKit.label(I18n.t("rank_title"), 15, Color(1, 0.92, 0.55)))
	var rb := UiKit.button(I18n.t("rank_refresh"), Color(0.3, 0.45, 0.65), 100.0, 36.0)
	rb.pressed.connect(func() -> void: net().send_social("leaderboard"))
	head.add_child(rb)
	list.add_child(head)
	if board.is_empty():
		list.add_child(UiKit.label(I18n.t("loading")))
		return
	var me: Variant = board.get("me", null)
	if typeof(me) == TYPE_DICTIONARY:
		list.add_child(UiKit.label(I18n.t("rank_me", [int(me.get("rank", 0)), int(me.get("gems", 0))]), 14, Color(0.55, 1, 0.85)))
	var i := 0
	for e in board.get("top", []):
		i += 1
		var medal: String = "#%d" % i
		var mine: bool = str(e.get("username", "")) == str(hud._net.my_username)
		var r := UiKit.row()
		var medal_col: Color = [Color(1, 0.84, 0.2), Color(0.85, 0.88, 0.95), Color(0.9, 0.6, 0.35)][i - 1] if i <= 3 else Color(0.8, 0.85, 0.9)
		var a := UiKit.label(medal, 15 if i <= 3 else 13, medal_col, false)
		a.custom_minimum_size = Vector2(44, 0)
		r.add_child(a)
		r.add_child(UiKit.label(str(e.get("username", "?")), 14, Color(1, 1, 0.6) if mine else Color(0.95, 0.97, 1.0)))
		r.add_child(UiKit.label(I18n.t("gems", [int(e.get("gems", 0))]), 14, Color(0.55, 1, 0.85), false))
		list.add_child(r)

# ---------------- friends + PM ----------------
func _build_friends(list: VBoxContainer) -> void:
	if _need_online(list):
		return
	if pm_with != "":
		_build_thread(list)
		return
	var add := UiKit.row()
	_friend_input = LineEdit.new()
	_friend_input.placeholder_text = I18n.t("friend_name")
	_friend_input.max_length = 16
	_friend_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_friend_input.custom_minimum_size = Vector2(0, 40)
	_friend_input.text_submitted.connect(func(_t: String) -> void: _add_friend())
	add.add_child(_friend_input)
	var ab := UiKit.button(I18n.t("friend_add"), Color(0.25, 0.6, 0.4), 90.0)
	ab.pressed.connect(_add_friend)
	add.add_child(ab)
	list.add_child(add)
	if friends.is_empty():
		list.add_child(UiKit.label(I18n.t("loading")))
		return
	var unread := {}
	for u in friends.get("unread", []):
		unread[str(u.get("from", ""))] = int(u.get("n", 0))
	var inc: Array = friends.get("incoming", [])
	if not inc.is_empty():
		list.add_child(UiKit.label(I18n.t("friends_incoming"), 14, Color(1, 0.85, 0.45)))
		for e in inc:
			var r := UiKit.row()
			r.add_child(UiKit.label(str(e.get("username", "?")), 14))
			var acc := UiKit.button(I18n.t("friend_accept"), Color(0.25, 0.6, 0.4), 80.0, 36.0)
			var nm := str(e.get("username", ""))
			acc.pressed.connect(func() -> void: net().send_social("friend_add", {"name": nm}))
			var rej := UiKit.button("X", Color(0.6, 0.3, 0.32), 40.0, 36.0)
			var rid := str(e.get("id", ""))
			rej.pressed.connect(func() -> void: net().send_social("friend_remove", {"id": rid}))
			r.add_child(acc)
			r.add_child(rej)
			list.add_child(r)
	var fr: Array = friends.get("friends", [])
	list.add_child(UiKit.label(I18n.t("friends_list", [fr.size()]), 14, Color(1, 0.92, 0.55)))
	if fr.is_empty():
		list.add_child(UiKit.label(I18n.t("friends_none"), 12, Color(0.8, 0.85, 0.9)))
	for e in fr:
		var r2 := UiKit.row()
		var fid := str(e.get("id", ""))
		var fname := str(e.get("username", "?"))
		var on := bool(e.get("online", false))
		var badge := ("  (%d new)" % unread[fid]) if unread.has(fid) else ""
		r2.add_child(UiKit.label("%s  %s%s" % [fname, I18n.t("friend_online") if on else I18n.t("friend_offline"), badge], 14,
			Color(0.6, 1, 0.7) if on else Color(0.9, 0.92, 0.95)))
		var mb := UiKit.button(I18n.t("friend_chat"), Color(0.3, 0.45, 0.7), 80.0, 36.0)
		mb.pressed.connect(func() -> void: open_thread(fid, fname))
		var xb := UiKit.button(I18n.t("friend_remove"), Color(0.55, 0.3, 0.3), 76.0, 36.0)
		xb.pressed.connect(func() -> void: net().send_social("friend_remove", {"id": fid}))
		r2.add_child(mb)
		r2.add_child(xb)
		list.add_child(r2)
	var outg: Array = friends.get("outgoing", [])
	if not outg.is_empty():
		list.add_child(UiKit.label(I18n.t("friends_outgoing"), 13, Color(0.8, 0.85, 0.9)))
		for e in outg:
			var r3 := UiKit.row()
			r3.add_child(UiKit.label(str(e.get("username", "?")), 13, Color(0.8, 0.85, 0.9)))
			var cid := str(e.get("id", ""))
			var cb := UiKit.button("X", Color(0.5, 0.3, 0.32), 40.0, 34.0)
			cb.pressed.connect(func() -> void: net().send_social("friend_remove", {"id": cid}))
			r3.add_child(cb)
			list.add_child(r3)

func _add_friend() -> void:
	if _friend_input == null or net() == null:
		return
	var nm := _friend_input.text.strip_edges()
	if nm.length() < 3:
		return
	net().send_social("friend_add", {"name": nm})
	_friend_input.text = ""

func open_thread(fid: String, fname: String) -> void:
	pm_with = fid
	pm_with_name = fname
	pm_msgs = []
	if not is_open:
		open("friends")
	else:
		show_tab("friends")

func _build_thread(list: VBoxContainer) -> void:
	var head := UiKit.row()
	var back := UiKit.button("< " + I18n.t("back"), Color(0.35, 0.4, 0.5), 100.0, 36.0)
	back.pressed.connect(func() -> void:
		pm_with = ""
		show_tab("friends"))
	head.add_child(back)
	head.add_child(UiKit.label(I18n.t("pm_title", [pm_with_name]), 15, Color(1, 0.92, 0.55)))
	list.add_child(head)
	for m in pm_msgs:
		var mine := str(m.get("from", "")) == str(hud._net.my_id)
		var c := UiKit.card(Color(0.16, 0.3, 0.5, 0.9) if mine else Color(0.18, 0.3, 0.2, 0.9))
		var l := UiKit.label("%s: %s" % [str(m.get("fromName", "?")), str(m.get("text", ""))], 13)
		c.add_child(l)
		c.size_flags_horizontal = Control.SIZE_SHRINK_END if mine else Control.SIZE_SHRINK_BEGIN
		c.custom_minimum_size = Vector2(280, 0)
		list.add_child(c)
	var r := UiKit.row()
	_pm_input = LineEdit.new()
	_pm_input.placeholder_text = I18n.t("pm_input")
	_pm_input.max_length = 200
	_pm_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_pm_input.custom_minimum_size = Vector2(0, 40)
	_pm_input.text_submitted.connect(func(_t: String) -> void: _send_pm())
	r.add_child(_pm_input)
	var sb := UiKit.button(I18n.t("pm_send"), Color(0.25, 0.55, 0.75), 80.0)
	sb.pressed.connect(_send_pm)
	r.add_child(sb)
	list.add_child(r)
	_scroll_bottom.call_deferred()

func _scroll_bottom() -> void:
	var sc: ScrollContainer = ui["scroll"]
	await get_tree().process_frame
	sc.scroll_vertical = int(sc.get_v_scroll_bar().max_value)

func _send_pm() -> void:
	if _pm_input == null or net() == null or pm_with == "":
		return
	var t := _pm_input.text.strip_edges()
	if t == "":
		return
	net().send_social("pm_send", {"to": pm_with, "text": t})
	_pm_input.text = ""

# ---------------- world settings ----------------
func _build_world(list: VBoxContainer) -> void:
	if _need_online(list):
		return
	var n := net()
	var wname := str(n.current_world)
	list.add_child(UiKit.label(I18n.t("world_title", [wname]), 15, Color(1, 0.92, 0.55)))
	var st: Dictionary = n.current_settings
	if str(n.lock_owner_id) == "":
		list.add_child(UiKit.label(I18n.t("world_no_lock")))
		return
	var owner := str(n.lock_owner_id) == str(n.my_id)
	if not owner:
		list.add_child(UiKit.label(I18n.t("world_owner_only")))
	var open_cb := CheckBox.new()
	open_cb.text = I18n.t("world_open")
	open_cb.button_pressed = bool(st.get("open", false))
	open_cb.disabled = not owner
	list.add_child(open_cb)
	var bg_row := UiKit.row()
	bg_row.add_child(UiKit.label(I18n.t("world_bg"), 14, Color.WHITE, false))
	var opt := OptionButton.new()
	for i in range(4):
		opt.add_item(I18n.t("bg_%d" % i), i)
	opt.select(clampi(int(st.get("bg", 0)), 0, 3))
	opt.disabled = not owner
	opt.custom_minimum_size = Vector2(160, 40)
	bg_row.add_child(opt)
	list.add_child(bg_row)
	_welcome_input = LineEdit.new()
	_welcome_input.placeholder_text = I18n.t("world_welcome")
	_welcome_input.max_length = 80
	_welcome_input.text = str(st.get("welcome", ""))
	_welcome_input.editable = owner
	_welcome_input.custom_minimum_size = Vector2(0, 40)
	list.add_child(_welcome_input)
	if owner:
		var save := UiKit.button(I18n.t("world_apply"), Color(0.25, 0.6, 0.4), 140.0)
		save.pressed.connect(func() -> void:
			var s := {"open": open_cb.button_pressed, "bg": opt.get_selected_id(), "welcome": _welcome_input.text.strip_edges()}
			net().set_world_settings(s))
		list.add_child(save)

# ---------------- settings ----------------
func _slider(list: VBoxContainer, label_key: String, value: float, key: String, lo: float = 0.0, hi: float = 1.0) -> void:
	var r := UiKit.row()
	var l := UiKit.label(I18n.t(label_key), 14, Color.WHITE, false)
	l.custom_minimum_size = Vector2(190, 0)
	r.add_child(l)
	var s := HSlider.new()
	s.min_value = lo
	s.max_value = hi
	s.step = 0.05
	s.value = value
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.custom_minimum_size = Vector2(0, 36)
	var pct := UiKit.label("%d%%" % int(round(value * 100.0)), 13, Color(0.8, 0.9, 1.0), false)
	pct.custom_minimum_size = Vector2(48, 0)
	s.value_changed.connect(func(v: float) -> void:
		pct.text = "%d%%" % int(round(v * 100.0))
		Settings.set_value(key, v))
	s.drag_ended.connect(func(_c: bool) -> void:
		if key == "sfx_volume":
			Sfx.play_ui())
	r.add_child(s)
	r.add_child(pct)
	list.add_child(r)

func _build_settings(list: VBoxContainer) -> void:
	_slider(list, "set_music", Settings.music_volume, "music_volume")
	_slider(list, "set_sfx", Settings.sfx_volume, "sfx_volume")
	var mr := UiKit.row()
	mr.add_child(UiKit.label(I18n.t("now_playing", [Sfx.now_playing if Sfx.now_playing != "" else "—"]), 13, Color(0.85, 0.95, 1.0)))
	var nb := UiKit.button(I18n.t("set_next_track") + " >>", Color(0.3, 0.45, 0.65), 150.0, 36.0)
	nb.pressed.connect(func() -> void:
		Sfx.skip_track()
		rebuild())
	mr.add_child(nb)
	list.add_child(mr)
	var lr := UiKit.row()
	var ll := UiKit.label(I18n.t("set_language"), 14, Color.WHITE, false)
	ll.custom_minimum_size = Vector2(190, 0)
	lr.add_child(ll)
	for code in ["id", "en"]:
		var b := UiKit.button("Bahasa Indonesia" if code == "id" else "English", Color(0.22, 0.4, 0.3), 150.0, 38.0)
		UiKit.set_tab_style(b, Settings.language == code)
		var cc: String = code
		b.pressed.connect(func() -> void:
			Settings.set_value("language", cc)
			if hud.has_method("refresh_language"):
				hud.refresh_language()
			rebuild())
		lr.add_child(b)
	list.add_child(lr)
	_slider(list, "set_touch", Settings.touch_scale, "touch_scale", 0.8, 1.3)
	var shake := CheckBox.new()
	shake.text = I18n.t("set_shake")
	shake.button_pressed = Settings.screen_shake
	shake.toggled.connect(func(on: bool) -> void: Settings.set_value("screen_shake", on))
	list.add_child(shake)
	var fps := CheckBox.new()
	fps.text = I18n.t("set_fps")
	fps.button_pressed = Settings.show_fps
	fps.toggled.connect(func(on: bool) -> void: Settings.set_value("show_fps", on))
	list.add_child(fps)
	var tb := UiKit.button(I18n.t("set_tutorial"), Color(0.6, 0.45, 0.2), 180.0)
	tb.pressed.connect(func() -> void:
		close()
		replay_tutorial.emit())
	list.add_child(tb)
	var ver := UiKit.label("Pixeltopia v%s" % str(ProjectSettings.get_setting("application/config/version", "")), 11, Color(0.7, 0.75, 0.8))
	list.add_child(ver)

# ---------------- server messages ----------------
func on_social(m: Dictionary) -> void:
	match str(m.get("t", "")):
		"daily_state":
			daily = m
			var claim: Variant = m.get("claim", null)
			if typeof(claim) == TYPE_DICTIONARY:
				if bool(claim.get("ok", false)):
					if claim.has("key"):
						ui["status"].text = "+" + I18n.t("gems", [int(claim.get("gems", 0))])
					else:
						ui["status"].text = I18n.t("daily_got", [int(claim.get("gems", 0)), int(claim.get("streak", 1))])
					Sfx.play_daily()
				else:
					ui["status"].text = str(claim.get("error", ""))
			_emit_badges()
			if is_open and tab == "daily":
				rebuild()
		"leaderboard":
			board = m
			if is_open and tab == "rank":
				rebuild()
		"friends":
			friends = m
			unread_total = 0
			for u in m.get("unread", []):
				unread_total += int(u.get("n", 0))
			_emit_badges()
			if is_open and tab == "friends" and pm_with == "":
				rebuild()
		"friend_event":
			var kind := str(m.get("kind", ""))
			if kind == "request" and hud.has_method("show_toast"):
				hud.show_toast(I18n.t("friend_request_from", [str(m.get("username", "?"))]))
				Sfx.play_pm()
			if net():
				net().send_social("friend_list")
		"pm":
			var other := str(m.get("from", "")) if str(m.get("from", "")) != str(hud._net.my_id) else str(m.get("to", ""))
			if is_open and tab == "friends" and pm_with == other:
				pm_msgs.append(m)
				rebuild()
				if str(m.get("from", "")) != str(hud._net.my_id) and net():
					net().send_social("pm_thread", {"with": pm_with})  ## marks read
			elif str(m.get("from", "")) != str(hud._net.my_id):
				unread_total += 1
				_emit_badges()
				if hud.has_method("show_toast"):
					hud.show_toast(I18n.t("pm_new", [str(m.get("fromName", "?")), str(m.get("text", "")).left(60)]))
				Sfx.play_pm()
		"pm_thread":
			if str(m.get("with", "")) == pm_with:
				pm_msgs = m.get("messages", [])
				if is_open and tab == "friends":
					rebuild()
		"social_error":
			ui["status"].text = str(m.get("error", ""))
			Sfx.play_error()
			if is_open:
				rebuild()
			elif hud.has_method("show_status"):
				hud.show_status(str(m.get("error", "")))

func on_world_settings() -> void:
	if is_open and tab == "world":
		ui["status"].text = I18n.t("world_saved")
		rebuild()

func _emit_badges() -> void:
	var ready := not daily.is_empty() and not bool(daily.get("claimedToday", true))
	if not ready:
		for q in daily.get("quests", []):
			if not bool(q.get("claimed", false)) and int(q.get("progress", 0)) >= int(q.get("goal", 1)):
				ready = true
	daily_badge_changed.emit(ready, unread_total)
