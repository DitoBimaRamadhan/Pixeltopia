extends Control
## Daftar server — join / refresh / offline / logout.

@onready var list: ItemList = %ServerList
@onready var status_lbl: Label = %Status
@onready var btn_join: Button = %BtnJoin
@onready var btn_refresh: Button = %BtnRefresh
@onready var btn_offline: Button = %BtnOffline
@onready var btn_logout: Button = %BtnLogout
@onready var user_lbl: Label = %UserLabel
@onready var http: HTTPRequest = %HTTPRequest

var _api := AuthApiClient.new()
var _servers: Array = []

func _ready() -> void:
	DisplayServer.window_set_title("Pixeltopia — Pilih Server")
	_style_round_buttons()
	user_lbl.text = "Pemain: %s%s" % [Session.username, " (offline)" if Session.offline_mode else ""]
	_api.attach(http)
	_api.request_finished.connect(_on_api)
	btn_join.pressed.connect(_on_join)
	btn_refresh.pressed.connect(_refresh)
	btn_offline.pressed.connect(_on_offline)
	btn_logout.pressed.connect(_on_logout)
	list.item_activated.connect(func (_i): _on_join())
	if Session.offline_mode:
		_show_offline_only()
	else:
		_refresh()

func _style_round_buttons() -> void:
	## True circular buttons (≥48dp), not rounded rects.
	btn_join.text = "Join"
	btn_refresh.text = "Sync"
	btn_offline.text = "Offline"
	btn_logout.text = "Keluar"
	btn_offline.tooltip_text = "Mainkan Offline"
	btn_refresh.tooltip_text = "Refresh server list"
	UiCircle.apply(btn_join, UiCircle.ACTION_SIZE, Color(0.2, 0.55, 0.35))
	UiCircle.apply(btn_refresh, UiCircle.ACTION_SIZE, Color(0.25, 0.5, 0.8))
	UiCircle.apply(btn_offline, UiCircle.ACTION_SIZE, Color(0.55, 0.4, 0.7))
	UiCircle.apply(btn_logout, UiCircle.ACTION_SIZE, Color(0.65, 0.3, 0.35))

func _show_offline_only() -> void:
	_servers = [Session.selected_server if not Session.selected_server.is_empty() else {
		"id": "offline", "name": "Offline (lokal)", "players": 0, "maxPlayers": 1, "load": 0
	}]
	_rebuild_list()
	status_lbl.text = "Mode offline — multiplayer tidak aktif."

func _refresh() -> void:
	status_lbl.text = "Memuat daftar server dari %s …" % Session.api_base_url
	btn_refresh.disabled = true
	_api.list_servers(Session.api_base_url, Session.token)

func _rebuild_list() -> void:
	list.clear()
	for s in _servers:
		var name := str(s.get("name", s.get("id", "?")))
		var cur := int(s.get("players", s.get("connections", 0)))
		var mx := int(s.get("maxPlayers", s.get("capacity", 100)))
		var shard := str(s.get("shard", ""))
		var load := float(s.get("load", float(cur) / maxf(float(mx), 1.0)))
		var tag := " [%s]" % shard if not shard.is_empty() else ""
		list.add_item("%s%s  —  %d/%d  (load %.0f%%)" % [name, tag, cur, mx, load * 100.0])

func _on_api(ok: bool, data: Dictionary, error: String) -> void:
	btn_refresh.disabled = false
	if not ok:
		status_lbl.text = error + " — gunakan Mainkan Offline."
		_servers = []
		_rebuild_list()
		return
	var arr: Variant = data.get("servers", data.get("data", []))
	if typeof(arr) != TYPE_ARRAY:
		arr = []
	_servers = arr
	_servers.sort_custom(func (a, b):
		return int(a.get("players", 0)) < int(b.get("players", 0))
	)
	_rebuild_list()
	status_lbl.text = "%d server tersedia. Pilih lalu Join." % _servers.size()

func _on_join() -> void:
	var idxs := list.get_selected_items()
	if idxs.is_empty():
		if _servers.is_empty():
			status_lbl.text = "Tidak ada server. Coba Offline."
			return
		idxs = PackedInt32Array([0])
		list.select(0)
	var i: int = idxs[0]
	if i < 0 or i >= _servers.size():
		return
	var s: Dictionary = _servers[i]
	Session.set_selected_server(s)
	status_lbl.text = "Masuk ke %s…" % str(s.get("name", "dunia"))
	get_tree().change_scene_to_file("res://scenes/auth/world_select.tscn")

func _on_offline() -> void:
	Session.enter_offline(Session.username if not Session.username.is_empty() else "Tamu")
	get_tree().change_scene_to_file("res://scenes/auth/world_select.tscn")

func _on_logout() -> void:
	Session.clear_session()
	get_tree().change_scene_to_file("res://scenes/auth/login.tscn")
