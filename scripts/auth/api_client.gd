extends RefCounted
class_name AuthApiClient
## Thin HTTP helper for Pixeltopia auth + server list.

signal request_finished(ok: bool, data: Dictionary, error: String)

## Protocol version of this build (v1.7.0 = 2: server-authoritative inventory). Servers with
## MIN_PROTO above this answer 426 {update: true, url}.
const CLIENT_PROTO := 4

var _http: HTTPRequest
var _busy: bool = false

func attach(http: HTTPRequest) -> void:
	_http = http
	if not _http.request_completed.is_connected(_on_completed):
		_http.request_completed.connect(_on_completed)

func register(base: String, username: String, password: String) -> void:
	_post(base + "/register", {"username": username, "password": password, "proto": CLIENT_PROTO})

func login(base: String, username: String, password: String) -> void:
	_post(base + "/login", {"username": username, "password": password, "proto": CLIENT_PROTO})

func list_servers(base: String, token: String = "") -> void:
	if _http == null:
		request_finished.emit(false, {}, "HTTPRequest belum siap.")
		return
	if _busy:
		request_finished.emit(false, {}, "Masih menunggu respons sebelumnya.")
		return
	var headers: PackedStringArray = ["Accept: application/json"]
	if not token.is_empty():
		headers.append("Authorization: Bearer %s" % token)
	_busy = true
	var err := _http.request(base + "/servers", headers, HTTPClient.METHOD_GET)
	if err != OK:
		_busy = false
		request_finished.emit(false, {}, "Tidak bisa menghubungi server (kode %s)." % err)

func _post(url: String, body: Dictionary) -> void:
	if _http == null:
		request_finished.emit(false, {}, "HTTPRequest belum siap.")
		return
	if _busy:
		request_finished.emit(false, {}, "Masih menunggu respons sebelumnya.")
		return
	_busy = true
	var headers := PackedStringArray([
		"Content-Type: application/json",
		"Accept: application/json",
	])
	var err := _http.request(url, headers, HTTPClient.METHOD_POST, JSON.stringify(body))
	if err != OK:
		_busy = false
		request_finished.emit(false, {}, "Tidak bisa menghubungi server (kode %s)." % err)

func _on_completed(result: int, response_code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	_busy = false
	if result != HTTPRequest.RESULT_SUCCESS:
		request_finished.emit(false, {}, "Koneksi gagal. Cek jaringan / jalankan server lokal.")
		return
	var text := body.get_string_from_utf8()
	var parsed: Variant = JSON.parse_string(text) if not text.is_empty() else {}
	var data: Dictionary = parsed if typeof(parsed) == TYPE_DICTIONARY else {"raw": text}
	if response_code >= 200 and response_code < 300:
		request_finished.emit(true, data, "")
	elif response_code == 404:
		# Wrong/retired server address (e.g. the old Render URL) — the Pixeltopia API never answers 404.
		request_finished.emit(false, data, "Server tidak ditemukan (404). Pilih server Online.")
	else:
		var msg := str(data.get("error", data.get("message", "HTTP %s" % response_code)))
		request_finished.emit(false, data, msg)
