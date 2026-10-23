extends Control
## Named world create/join before entering the game.

@onready var list: ItemList = %WorldList
@onready var name_edit: LineEdit = %WorldName
@onready var status_lbl: Label = %Status
@onready var btn_join: Button = %BtnJoin
@onready var btn_create: Button = %BtnCreate
@onready var btn_refresh: Button = %BtnRefresh
@onready var btn_back: Button = %BtnBack

var _net: Node = null
var _worlds: Array = []
var _pending_enter: bool = false

func _ready() -> void:
	DisplayServer.window_set_title("Pixeltopia — Pilih Dunia")
	UiCircle.apply(btn_join, UiCircle.ACTION_SIZE, Color(0.2, 0.55, 0.35))
	UiCircle.apply(btn_create, UiCircle.ACTION_SIZE, Color(0.25, 0.5, 0.8))
	UiCircle.apply(btn_refresh, UiCircle.ACTION_SIZE, Color(0.45, 0.45, 0.55))
	UiCircle.apply(btn_back, UiCircle.ACTION_SIZE, Color(0.65, 0.3, 0.35))
	btn_join.pressed.connect(_on_join)
	btn_create.pressed.connect(_on_create)
	btn_refresh.pressed.connect(_refresh)
	btn_back.pressed.connect(func (): get_tree().change_scene_to_file("res://scenes/auth/server_list.tscn"))
	list.item_activated.connect(func (_i): _on_join())
	if Session.offline_mode:
		status_lbl.text = "Offline — masuk ke dunia lokal."
		_worlds = [{"name": "LOCAL", "players": 1, "locked": false}]
		_rebuild()
		return
	_net = Node.new()
	_net.set_script(load("res://scripts/net/game_socket.gd"))
	add_child(_net)
	_net.welcome.connect(_on_welcome)
	_net.worlds_list.connect(_on_worlds)
	_net.world_state.connect(_on_world_state)
	_net.net_error.connect(func (m): status_lbl.text = m)
	_net.connected.connect(func (): status_lbl.text = "Terhubung. Memuat dunia…"; _net.list_worlds())
	status_lbl.text = "Menyambung ke server…"
	_net.connect_to_session()

func _on_welcome(data: Dictionary) -> void:
	status_lbl.text = "Halo %s — pilih/buat dunia." % str(data.get("you", {}).get("username", Session.username))
	if data.has("worlds"):
		_on_worlds(data["worlds"])

func _on_worlds(arr: Array) -> void:
	_worlds = arr
	_rebuild()
	status_lbl.text = "%d dunia tersedia." % _worlds.size()

func _rebuild() -> void:
	list.clear()
	for w in _worlds:
		var lock := " 🔒" if bool(w.get("locked", false)) else ""
		list.add_item("%s%s  —  %d pemain" % [str(w.get("name", "?")), lock, int(w.get("players", 0))])

func _refresh() -> void:
	if Session.offline_mode:
		return
	if _net and _net.online:
		_net.list_worlds()
	else:
		status_lbl.text = "Belum online."

func _selected_name() -> String:
	var typed := name_edit.text.strip_edges().to_upper()
	if not typed.is_empty():
		return typed
	var idxs := list.get_selected_items()
	if idxs.is_empty():
		return "START"
	var i: int = idxs[0]
	if i >= 0 and i < _worlds.size():
		return str(_worlds[i].get("name", "START"))
	return "START"

func _on_join() -> void:
	var wname := _selected_name()
		Session.selected_server["world"] = wname
	Session.set_selected_server(Session.selected_server)
	if Session.offline_mode:
		get_tree().change_scene_to_file("res://scenes/main.tscn")
		return
	if _net == null or not _net.online:
		status_lbl.text = "Belum terhubung."
		return
	_pending_enter = true
	status_lbl.text = "Join %s…" % wname
	_net.join_world(wname, false)

func _on_create() -> void:
	var wname := name_edit.text.strip_edges().to_upper()
	if wname.length() < 2:
		status_lbl.text = "Ketik nama dunia (min 2)."
		return
	Session.selected_server["world"] = wname
	Session.set_selected_server(Session.selected_server)
	if Session.offline_mode:
		get_tree().change_scene_to_file("res://scenes/main.tscn")
		return
	if _net == null or not _net.online:
		status_lbl.text = "Belum terhubung."
		return
	_pending_enter = true
	status_lbl.text = "Membuat %s…" % wname
	_net.create_world(wname)

func _on_world_state(data: Dictionary) -> void:
	if not _pending_enter:
		return
	Session.selected_server["world"] = str(data.get("name", "START"))
	Session.set_selected_server(Session.selected_server)
	# Keep socket alive? Scene change will free this node — main will reconnect.
	_net.disconnect_socket()
	get_tree().change_scene_to_file("res://scenes/main.tscn")
