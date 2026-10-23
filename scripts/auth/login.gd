extends Control
## Login — Masuk / Daftar / Mainkan Offline.

@onready var user_edit: LineEdit = %Username
@onready var pass_edit: LineEdit = %Password
@onready var status_lbl: Label = %Status
@onready var btn_login: Button = %BtnMasuk
@onready var btn_register: Button = %BtnDaftar
@onready var btn_offline: Button = %BtnOffline
@onready var http: HTTPRequest = %HTTPRequest

var _api := AuthApiClient.new()

func _ready() -> void:
	DisplayServer.window_set_title("Pixeltopia — Login")
	_style_round_buttons()
	_api.attach(http)
	_api.request_finished.connect(_on_api)
	btn_login.pressed.connect(_on_masuk)
	btn_register.pressed.connect(func (): get_tree().change_scene_to_file("res://scenes/auth/register.tscn"))
	btn_offline.pressed.connect(_on_offline)
	user_edit.text_submitted.connect(func (_t): _on_masuk())
	pass_edit.text_submitted.connect(func (_t): _on_masuk())
	if Session.is_logged_in():
		status_lbl.text = "Sesi tersimpan: %s — masuk ke daftar server…" % Session.username
		await get_tree().create_timer(0.35).timeout
		get_tree().change_scene_to_file("res://scenes/auth/server_list.tscn")

func _style_round_buttons() -> void:
	## True circular buttons (≥48dp), not rounded rectangles.
	btn_login.text = "Masuk"
	btn_register.text = "Daftar"
	btn_offline.text = "Offline"
	btn_offline.tooltip_text = "Mainkan Offline (tanpa multiplayer)"
	UiCircle.apply(btn_login, UiCircle.ACTION_SIZE, Color(0.2, 0.55, 0.35))
	UiCircle.apply(btn_register, UiCircle.ACTION_SIZE, Color(0.25, 0.5, 0.8))
	UiCircle.apply(btn_offline, UiCircle.ACTION_SIZE, Color(0.55, 0.4, 0.7))
	# Pack action circles in a centered row under the form fields.
	var vbox: VBoxContainer = btn_login.get_parent()
	var row := HBoxContainer.new()
	row.name = "CircleRow"
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 12)
	var idx := btn_login.get_index()
	vbox.add_child(row)
	vbox.move_child(row, idx)
	for b in [btn_login, btn_register, btn_offline]:
		vbox.remove_child(b)
		row.add_child(b)

func _set_busy(b: bool) -> void:
	btn_login.disabled = b
	btn_register.disabled = b
	btn_offline.disabled = b

func _on_masuk() -> void:
	var u := user_edit.text.strip_edges()
	var p := pass_edit.text
	if u.is_empty() or p.is_empty():
		status_lbl.text = "Isi username dan password."
		return
	status_lbl.text = "Menghubungi %s …" % Session.api_base_url
	_set_busy(true)
	_api.login(Session.api_base_url, u, p)

func _on_offline() -> void:
	var u := user_edit.text.strip_edges()
	if u.is_empty():
		u = "Tamu"
	Session.enter_offline(u)
	get_tree().change_scene_to_file("res://scenes/main.tscn")

func _on_api(ok: bool, data: Dictionary, error: String) -> void:
	_set_busy(false)
	if not ok:
		status_lbl.text = error + " — atau pilih Mainkan Offline."
		return
	var tok := str(data.get("token", ""))
	var uname := str(data.get("username", user_edit.text.strip_edges()))
	var uid := str(data.get("userId", data.get("id", "")))
	if tok.is_empty():
		status_lbl.text = "Respons login tidak valid."
		return
	Session.set_session(tok, uname, uid)
	status_lbl.text = "Berhasil. Memuat daftar server…"
	get_tree().change_scene_to_file("res://scenes/auth/server_list.tscn")
