extends Node
## Session autoload — token/username persistence + API base URL.

const SAVE_PATH := "user://pixeltopia_session.cfg"
const SECTION := "session"

@export var api_base_url: String = "http://127.0.0.1:8787"

var token: String = ""
var username: String = ""
var user_id: String = ""
var offline_mode: bool = false
var selected_server: Dictionary = {}

func _ready() -> void:
	_load()
	if OS.has_feature("android") and api_base_url.find("127.0.0.1") >= 0:
		api_base_url = "http://10.0.2.2:8787"

func is_logged_in() -> bool:
	return not token.is_empty() and not username.is_empty()

func set_session(p_token: String, p_username: String, p_user_id: String = "") -> void:
	token = p_token
	username = p_username
	user_id = p_user_id
	offline_mode = false
	_save()

func enter_offline(p_username: String) -> void:
	token = "offline-%s" % p_username
	username = p_username
	user_id = "offline"
	offline_mode = true
	selected_server = {
		"id": "offline",
		"name": "Offline (lokal)",
		"host": "",
		"port": 0,
		"players": 0,
		"maxPlayers": 1,
	}
	_save()

func clear_session() -> void:
	token = ""
	username = ""
	user_id = ""
	offline_mode = false
	selected_server = {}
	_save()

func set_selected_server(s: Dictionary) -> void:
	selected_server = s.duplicate(true)
	_save()

func _save() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value(SECTION, "token", token)
	cfg.set_value(SECTION, "username", username)
	cfg.set_value(SECTION, "user_id", user_id)
	cfg.set_value(SECTION, "offline_mode", offline_mode)
	cfg.set_value(SECTION, "api_base_url", api_base_url)
	cfg.set_value(SECTION, "selected_server_json", JSON.stringify(selected_server))
	cfg.save(SAVE_PATH)

func _load() -> void:
	var cfg := ConfigFile.new()
	if cfg.load(SAVE_PATH) != OK:
		return
	token = str(cfg.get_value(SECTION, "token", ""))
	username = str(cfg.get_value(SECTION, "username", ""))
	user_id = str(cfg.get_value(SECTION, "user_id", ""))
	offline_mode = bool(cfg.get_value(SECTION, "offline_mode", false))
	var saved_url := str(cfg.get_value(SECTION, "api_base_url", ""))
	if not saved_url.is_empty():
		api_base_url = saved_url
	var sj := str(cfg.get_value(SECTION, "selected_server_json", "{}"))
	var parsed: Variant = JSON.parse_string(sj)
	if typeof(parsed) == TYPE_DICTIONARY:
		selected_server = parsed
	else:
		selected_server = {}
