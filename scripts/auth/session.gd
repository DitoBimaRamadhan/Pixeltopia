extends Node
## Session autoload — token/username persistence + API base URL.

const SAVE_PATH := "user://pixeltopia_session.cfg"
const SECTION := "session"

## Public Pixeltopia server (Render free web service + Neon Postgres). See DEPLOY.md.
const DEFAULT_ONLINE_URL := "https://pixeltopia-server.onrender.com"
const LOCAL_URL := "http://127.0.0.1:8787"
const LOCAL_URL_ANDROID_EMU := "http://10.0.2.2:8787"
const MODE_ONLINE := "online"
const MODE_LOCAL := "local"
const MODE_CUSTOM := "custom"

@export var api_base_url: String = DEFAULT_ONLINE_URL
var server_mode: String = MODE_ONLINE
var custom_url: String = ""

var token: String = ""
var username: String = ""
var user_id: String = ""
var offline_mode: bool = false
var selected_server: Dictionary = {}

func _ready() -> void:
	_load()
	_apply_server_mode()

func local_url() -> String:
	return LOCAL_URL_ANDROID_EMU if OS.has_feature("android") else LOCAL_URL

## Normalise a user-typed address: add scheme, drop trailing slash / path.
static func normalize_url(raw: String) -> String:
	var u := raw.strip_edges()
	if u.is_empty():
		return ""
	if not (u.begins_with("http://") or u.begins_with("https://")):
		u = "https://" + u if u.find(".") >= 0 and u.find(":") < 0 else "http://" + u
	while u.ends_with("/"):
		u = u.substr(0, u.length() - 1)
	return u

func _apply_server_mode() -> void:
	match server_mode:
		MODE_LOCAL:
			api_base_url = local_url()
		MODE_CUSTOM:
			var c := normalize_url(custom_url)
			api_base_url = c if not c.is_empty() else DEFAULT_ONLINE_URL
		_:
			server_mode = MODE_ONLINE
			api_base_url = DEFAULT_ONLINE_URL

## Switch server (Online / Lokal / Custom). Logs out when the server changes,
## because tokens are only valid on the server that issued them.
func set_server(mode: String, p_custom_url: String = "") -> void:
	var before := api_base_url
	server_mode = mode
	if mode == MODE_CUSTOM:
		custom_url = normalize_url(p_custom_url)
	_apply_server_mode()
	if before != api_base_url and not offline_mode:
		token = ""
		username = ""
		user_id = ""
		selected_server = {}
	_save()

func server_label() -> String:
	match server_mode:
		MODE_LOCAL:
			return "Lokal (%s)" % api_base_url
		MODE_CUSTOM:
			return "Custom (%s)" % api_base_url
		_:
			return "Online (%s)" % api_base_url.replace("https://", "")

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
	cfg.set_value(SECTION, "server_mode", server_mode)
	cfg.set_value(SECTION, "custom_url", custom_url)
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
	custom_url = str(cfg.get_value(SECTION, "custom_url", ""))
	if cfg.has_section_key(SECTION, "server_mode"):
		server_mode = str(cfg.get_value(SECTION, "server_mode", MODE_ONLINE))
	else:
		## Pre-v1.7 saves only knew the local server: move them to the online server
		## (old local tokens are not valid there), unless a non-local URL was set by hand.
		var saved_url := str(cfg.get_value(SECTION, "api_base_url", ""))
		if saved_url.is_empty() or saved_url.find("127.0.0.1") >= 0 or saved_url.find("10.0.2.2") >= 0:
			server_mode = MODE_ONLINE
			if not bool(cfg.get_value(SECTION, "offline_mode", false)):
				token = ""
				username = ""
				user_id = ""
		else:
			server_mode = MODE_CUSTOM
			custom_url = saved_url
	var sj := str(cfg.get_value(SECTION, "selected_server_json", "{}"))
	var parsed: Variant = JSON.parse_string(sj)
	if typeof(parsed) == TYPE_DICTIONARY:
		selected_server = parsed
	else:
		selected_server = {}
