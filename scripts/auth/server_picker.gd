extends VBoxContainer
class_name ServerPicker
## Server selector for login: Online (default public server) / Lokal / Custom URL.

signal server_changed(url: String)

var _opt: OptionButton
var _url_edit: LineEdit
var _apply_btn: Button
var _info: Label

func _ready() -> void:
	add_theme_constant_override("separation", 4)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	add_child(row)
	var lbl := Label.new()
	lbl.text = "Server:"
	row.add_child(lbl)
	_opt = OptionButton.new()
	_opt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_opt.add_item("Online (publik)", 0)
	_opt.add_item("Lokal (PC / LAN)", 1)
	_opt.add_item("Custom URL…", 2)
	_opt.custom_minimum_size = Vector2(0, 40)
	row.add_child(_opt)
	var row2 := HBoxContainer.new()
	row2.add_theme_constant_override("separation", 6)
	add_child(row2)
	_url_edit = LineEdit.new()
	_url_edit.placeholder_text = "contoh: https://servermu.contoh.com atau 192.168.1.5:8787"
	_url_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_url_edit.custom_minimum_size = Vector2(0, 40)
	row2.add_child(_url_edit)
	_apply_btn = Button.new()
	_apply_btn.text = "Pakai"
	_apply_btn.custom_minimum_size = Vector2(64, 40)
	row2.add_child(_apply_btn)
	_info = Label.new()
	_info.add_theme_font_size_override("font_size", 12)
	_info.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_info)

	match Session.server_mode:
		Session.MODE_LOCAL:
			_opt.select(1)
		Session.MODE_CUSTOM:
			_opt.select(2)
		_:
			_opt.select(0)
	_url_edit.text = Session.custom_url
	_opt.item_selected.connect(_on_selected)
	_apply_btn.pressed.connect(_apply_custom)
	_url_edit.text_submitted.connect(func (_t): _apply_custom())
	_refresh()

func _on_selected(idx: int) -> void:
	match idx:
		0:
			Session.set_server(Session.MODE_ONLINE)
		1:
			Session.set_server(Session.MODE_LOCAL)
		2:
			if not Session.normalize_url(_url_edit.text).is_empty():
				Session.set_server(Session.MODE_CUSTOM, _url_edit.text)
	_refresh()
	server_changed.emit(Session.api_base_url)

func _apply_custom() -> void:
	var u := Session.normalize_url(_url_edit.text)
	if u.is_empty():
		_info.text = "Isi alamat server dulu."
		return
	_opt.select(2)
	Session.set_server(Session.MODE_CUSTOM, u)
	_url_edit.text = Session.custom_url
	_refresh()
	server_changed.emit(Session.api_base_url)

func _refresh() -> void:
	var custom := _opt.selected == 2
	_url_edit.get_parent().visible = custom
	_info.text = "→ %s" % Session.api_base_url
	if _opt.selected == 0:
		_info.text += "  (server gratis: login pertama bisa butuh ±30 detik untuk bangun)"
