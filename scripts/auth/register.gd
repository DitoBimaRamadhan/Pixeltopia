extends Control
## Register — Daftar akun baru.

@onready var user_edit: LineEdit = %Username
@onready var pass_edit: LineEdit = %Password
@onready var confirm_edit: LineEdit = %Confirm
@onready var status_lbl: Label = %Status
@onready var btn_daftar: Button = %BtnDaftar
@onready var btn_back: Button = %BtnKembali
@onready var http: HTTPRequest = %HTTPRequest

var _api := AuthApiClient.new()

func _ready() -> void:
	DisplayServer.window_set_title("Pixeltopia — Daftar")
	_style_round_buttons()
	_api.attach(http)
	_api.request_finished.connect(_on_api)
	btn_daftar.pressed.connect(_on_daftar)
	btn_back.pressed.connect(func (): get_tree().change_scene_to_file("res://scenes/auth/login.tscn"))

func _style_round_buttons() -> void:
	## True circular buttons (≥48dp).
	btn_daftar.text = "Daftar"
	btn_back.text = "Back"
	UiCircle.apply(btn_daftar, UiCircle.ACTION_SIZE, Color(0.2, 0.55, 0.35))
	UiCircle.apply(btn_back, UiCircle.ACTION_SIZE, Color(0.55, 0.35, 0.4))
	var vbox: VBoxContainer = btn_daftar.get_parent()
	var row := HBoxContainer.new()
	row.name = "CircleRow"
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 12)
	var idx := btn_daftar.get_index()
	vbox.add_child(row)
	vbox.move_child(row, idx)
	for b in [btn_daftar, btn_back]:
		vbox.remove_child(b)
		row.add_child(b)

func _on_daftar() -> void:
	var u := user_edit.text.strip_edges()
	var p := pass_edit.text
	var c := confirm_edit.text
	if u.length() < 3:
		status_lbl.text = "Username minimal 3 karakter."
		return
	if p.length() < 4:
		status_lbl.text = "Password minimal 4 karakter."
		return
	if p != c:
		status_lbl.text = "Konfirmasi password tidak cocok."
		return
	status_lbl.text = "Mendaftarkan…"
	btn_daftar.disabled = true
	_api.register(Session.api_base_url, u, p)

func _on_api(ok: bool, data: Dictionary, error: String) -> void:
	btn_daftar.disabled = false
	if not ok:
		status_lbl.text = error
		return
	var tok := str(data.get("token", ""))
	var uname := str(data.get("username", user_edit.text.strip_edges()))
	var uid := str(data.get("userId", data.get("id", "")))
	if not tok.is_empty():
		Session.set_session(tok, uname, uid)
		status_lbl.text = "Akun dibuat. Membuka daftar server…"
		get_tree().change_scene_to_file("res://scenes/auth/server_list.tscn")
	else:
		status_lbl.text = "Terdaftar. Silakan masuk."
		await get_tree().create_timer(0.6).timeout
		get_tree().change_scene_to_file("res://scenes/auth/login.tscn")
