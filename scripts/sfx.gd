extends Node
## Procedural SFX + looping BGM for Pixeltopia (original tones — no third-party samples).
## Autoload name: Sfx

var muted: bool = false
var music_muted: bool = false
var _players: Array = []  ## AudioStreamPlayer pool
var _pool_i: int = 0
var _streams: Dictionary = {}  ## name -> AudioStream
var _bgm: AudioStreamPlayer = null
var _rain: AudioStreamPlayer = null
var _order: Array = []
var _track_i: int = -1
var now_playing: String = ""
var now_index: int = -1  ## index into TRACKS of the current song
var _amb: Array = []  ## two AudioStreamPlayers for cross-fading ambience
var _amb_i: int = 0
var ambience_now: String = ""

signal track_changed(title: String)

## v1.8: 11 original generated tracks (tools/audio/gen_audio.py), shuffled; OGG SFX with tone fallbacks.
const TRACKS := [
	["res://assets/audio/music/01_meadow_morning.ogg", "Meadow Morning"],
	["res://assets/audio/music/02_pixel_plains.ogg", "Pixel Plains"],
	["res://assets/audio/music/03_seed_lab.ogg", "Seed Lab"],
	["res://assets/audio/music/04_market_day.ogg", "Market Day"],
	["res://assets/audio/music/05_starlit_farm.ogg", "Starlit Farm"],
	["res://assets/audio/music/06_cavern_echo.ogg", "Cavern Echo"],
	["res://assets/audio/music/07_rainy_greenhouse.ogg", "Rainy Greenhouse"],
	["res://assets/audio/music/08_lockkeepers_march.ogg", "Lockkeeper's March"],
	["res://assets/audio/music/09_desert_caravan.ogg", "Desert Caravan"],
	["res://assets/audio/music/10_sunset_harvest.ogg", "Sunset Harvest"],
	["res://assets/audio/music/11_snowy_peaks.ogg", "Snowy Peaks"],
	## v1.9 Soundtrack Vol. 2 (tools/audio/gen_music_v19.py) — longer multi-section pieces, Vorbis q7.
	["res://assets/audio/music2/12_sunrise_over_pixeltopia.ogg", "Sunrise over Pixeltopia"],
	["res://assets/audio/music2/13_tilled_soil.ogg", "Tilled Soil"],
	["res://assets/audio/music2/14_greenhouse_jam.ogg", "Greenhouse Jam"],
	["res://assets/audio/music2/15_lanterns_at_dusk.ogg", "Lanterns at Dusk"],
	["res://assets/audio/music2/16_deep_mine_shuffle.ogg", "Deep Mine Shuffle"],
	["res://assets/audio/music2/17_crystal_caverns.ogg", "Crystal Caverns"],
	["res://assets/audio/music2/18_trade_plaza.ogg", "Trade Plaza"],
	["res://assets/audio/music2/19_cloud_gardens.ogg", "Cloud Gardens"],
	["res://assets/audio/music2/20_lockkeepers_rest.ogg", "Lockkeeper's Rest"],
	["res://assets/audio/music2/21_rainy_rooftops.ogg", "Rainy Rooftops"],
	["res://assets/audio/music2/22_harvest_festival.ogg", "Harvest Festival"],
	["res://assets/audio/music2/23_moonlit_orchard.ogg", "Moonlit Orchard"],
	["res://assets/audio/music2/24_builders_anthem.ogg", "Builder's Anthem"],
	["res://assets/audio/music2/25_desert_mirage.ogg", "Desert Mirage"],
	["res://assets/audio/music2/26_snowfall_village.ogg", "Snowfall Village"],
	["res://assets/audio/music2/27_sky_island_chase.ogg", "Sky Island Chase"],
	["res://assets/audio/music2/28_world_lock_waltz.ogg", "World Lock Waltz"],
	["res://assets/audio/music2/29_seed_vault_lullaby.ogg", "Seed Vault Lullaby"],
]
const VOL1_COUNT := 11
## v1.9 ambience loops (tools/audio/gen_music_v19.py): chosen by time of day, weather and depth.
const AMBIENCE := {
	"day": "res://assets/audio/ambience/day_birds.ogg",
	"night": "res://assets/audio/ambience/night_crickets.ogg",
	"cave": "res://assets/audio/ambience/cave_drips.ogg",
	"wind": "res://assets/audio/ambience/mountain_wind.ogg",
	"rain": "res://assets/audio/ambience/rain_heavy.ogg",
	"ocean": "res://assets/audio/ambience/ocean_shore.ogg",
}
const SFX_FILES := ["ui", "ui_open", "ui_close", "place", "hit", "break", "break_glass", "footstep", "jump", "land",
	"harvest", "plant", "craft", "splice", "buy", "sell", "coin", "trade", "levelup", "achievement", "daily", "pm",
	"error", "thunder", "door", "lock"]
const SFX_DB := {"footstep": -14.0, "ui": -10.0, "hit": -8.0, "thunder": -2.0, "land": -10.0}

static func _bus(name: String) -> String:
	return name if AudioServer.get_bus_index(name) >= 0 else "Master"

func _ready() -> void:
	for i in range(10):
		var p := AudioStreamPlayer.new()
		p.bus = _bus("SFX")
		add_child(p)
		_players.append(p)
	_streams["harvest"] = _make_tone([880.0, 1175.0], 0.14, 0.28, 0.35)
	_streams["craft"] = _make_tone([523.0, 659.0, 784.0], 0.22, 0.25, 0.2)
	_streams["footstep"] = _make_noise(0.045, 0.12, 900.0)
	_streams["ui"] = _make_tone([740.0], 0.05, 0.18, 0.0)
	_streams["place"] = _make_tone([220.0, 330.0], 0.08, 0.22, 0.15)
	_streams["break"] = _make_noise(0.09, 0.2, 400.0)
	_streams["jump"] = _make_tone([392.0, 523.0], 0.1, 0.2, 0.4)
	_streams["splice"] = _make_tone([523.0, 698.0, 880.0, 1046.0], 0.28, 0.22, 0.25)
	_streams["trade"] = _make_tone([392.0, 494.0, 587.0], 0.2, 0.24, 0.1)
	_streams["thunder"] = _make_noise(0.55, 0.45, 180.0)
	_streams["levelup"] = _make_tone([523.0, 659.0, 784.0, 1046.0], 0.45, 0.28, 0.15)
	_streams["achievement"] = _make_tone([659.0, 880.0, 1175.0], 0.35, 0.26, 0.2)
	for n in SFX_FILES:
		var path := "res://assets/audio/sfx/%s.ogg" % n
		if ResourceLoader.exists(path):
			var st: AudioStream = load(path)
			if st:
				_streams[n] = st
	_bgm = AudioStreamPlayer.new()
	_bgm.bus = _bus("Music")
	_bgm.volume_db = -4.0
	add_child(_bgm)
	_bgm.finished.connect(_next_track)
	_rain = AudioStreamPlayer.new()
	_rain.bus = _bus("SFX")
	_rain.volume_db = -22.0
	add_child(_rain)
	_rain.stream = _make_rain_loop()
	for i in range(2):
		var ap := AudioStreamPlayer.new()
		ap.bus = _bus("SFX")
		ap.volume_db = -80.0
		add_child(ap)
		_amb.append(ap)
	rebuild_order()
	call_deferred("start_music")

## Album filter from Settings.music_album: "all" | "vol1" | "vol2".
func album_indices() -> Array:
	var album: String = str(Settings.music_album) if Settings and "music_album" in Settings else "all"
	var out: Array = []
	for i in range(TRACKS.size()):
		if album == "vol1" and i >= VOL1_COUNT:
			continue
		if album == "vol2" and i < VOL1_COUNT:
			continue
		out.append(i)
	return out

func rebuild_order() -> void:
	_order = album_indices()
	_order.shuffle()
	_track_i = -1

## Jukebox: play a chosen song now; the shuffle continues after it.
func play_track(index: int) -> void:
	if index < 0 or index >= TRACKS.size():
		return
	var at := _order.find(index)
	if at < 0:
		_order.append(index)
		at = _order.size() - 1
	_track_i = at - 1
	if _bgm:
		_bgm.stop()
	_next_track()

## Cross-fade to an ambience loop ("" = silence). Volume follows the SFX bus × Settings.ambience_volume.
func set_ambience(key: String) -> void:
	if key == ambience_now or _amb.is_empty():
		return
	ambience_now = key
	var old: AudioStreamPlayer = _amb[_amb_i]
	_amb_i = 1 - _amb_i
	var nw: AudioStreamPlayer = _amb[_amb_i]
	if old.playing:
		var tw := create_tween()
		tw.tween_property(old, "volume_db", -60.0, 2.5)
		tw.tween_callback(old.stop)
	var path: String = AMBIENCE.get(key, "")
	if path == "" or muted or not ResourceLoader.exists(path):
		return
	var st: AudioStream = load(path)
	if st is AudioStreamOggVorbis:
		(st as AudioStreamOggVorbis).loop = true
	nw.stream = st
	nw.volume_db = -60.0
	nw.play()
	var target := _amb_db()
	create_tween().tween_property(nw, "volume_db", target, 2.5)

func _amb_db() -> float:
	var v: float = float(Settings.ambience_volume) if Settings and "ambience_volume" in Settings else 0.6
	return -80.0 if v <= 0.001 else linear_to_db(v) - 12.0

func refresh_ambience_volume() -> void:
	if _amb.is_empty():
		return
	var p: AudioStreamPlayer = _amb[_amb_i]
	if p.playing:
		p.volume_db = _amb_db()

func start_music() -> void:
	if muted or music_muted or _bgm == null:
		return
	if not _bgm.playing:
		if _bgm.stream == null:
			_next_track()
		else:
			_bgm.play()

func _next_track() -> void:
	if muted or music_muted or TRACKS.is_empty():
		return
	if _order.is_empty():
		rebuild_order()
	var wrapped := _track_i + 1 >= _order.size()
	_track_i = (_track_i + 1) % _order.size()
	if wrapped and _order.size() > 1:
		var last: int = _order[_order.size() - 1]
		_order.shuffle()
		if _order[0] == last:
			_order.reverse()
	var tr: Array = TRACKS[_order[_track_i]]
	if not ResourceLoader.exists(tr[0]):
		_bgm.stream = _make_bgm_loop()
		now_playing = "Pixeltopia"
	else:
		var st: AudioStream = load(tr[0])
		if st is AudioStreamOggVorbis:
			(st as AudioStreamOggVorbis).loop = false
		_bgm.stream = st
		now_playing = str(tr[1])
	now_index = int(_order[_track_i])
	_bgm.play()
	track_changed.emit(now_playing)

func skip_track() -> void:
	if _bgm:
		_bgm.stop()
	_next_track()

func stop_music() -> void:
	if _bgm:
		_bgm.stop()

func set_muted(v: bool) -> void:
	muted = v
	if muted:
		stop_music()
		var want_rain := _rain_want
		set_rain(false)
		_rain_want = want_rain  ## v1.9 fix: rain resumes after unmute
		var keep := ambience_now
		set_ambience("")
		ambience_now = keep  ## resume the same ambience on unmute
	else:
		start_music()
		set_rain(_rain_want)
		var key := ambience_now
		ambience_now = ""
		set_ambience(key)

func toggle_mute() -> bool:
	set_muted(not muted)
	return muted

func toggle_music() -> bool:
	music_muted = not music_muted
	if music_muted:
		stop_music()
	else:
		start_music()
	return music_muted

var _rain_want: bool = false

func set_rain(on: bool) -> void:
	if _rain == null:
		return
	_rain_want = on
	if muted or not on:
		_rain.stop()
		return
	if not _rain.playing:
		_rain.play()

func play(name: String, pitch_jitter: float = 0.0) -> void:
	if muted:
		return
	if not _streams.has(name):
		return
	var p: AudioStreamPlayer = _players[_pool_i]
	_pool_i = (_pool_i + 1) % _players.size()
	p.stream = _streams[name]
	p.volume_db = float(SFX_DB.get(name, -6.0))
	p.pitch_scale = 1.0 + (randf_range(-pitch_jitter, pitch_jitter) if pitch_jitter > 0.0 else 0.0)
	p.play()

func play_harvest() -> void:
	play("harvest")

func play_craft() -> void:
	play("craft")

func play_footstep() -> void:
	play("footstep", 0.12)

func play_ui() -> void:
	play("ui")

func play_place() -> void:
	play("place", 0.08)

func play_break() -> void:
	play("break", 0.1)

func play_jump() -> void:
	play("jump")

func play_splice() -> void:
	play("splice")

func play_trade() -> void:
	play("trade")

func play_thunder() -> void:
	play("thunder")

func play_levelup() -> void:
	play("levelup")

func play_achievement() -> void:
	play("achievement")

func play_hit() -> void:
	play("hit", 0.15)

func play_sell() -> void:
	play("sell")

func play_buy() -> void:
	play("buy")

func play_daily() -> void:
	play("daily")

func play_pm() -> void:
	play("pm")

func play_error() -> void:
	play("error")

func play_open() -> void:
	play("ui_open")

func play_close() -> void:
	play("ui_close")

func play_plant() -> void:
	play("plant", 0.06)

func _make_tone(freqs: Array, duration: float, volume: float, slide: float) -> AudioStreamWAV:
	var sample_rate := 22050
	var n := maxi(int(sample_rate * duration), 1)
	var data := PackedByteArray()
	data.resize(n * 2)
	for i in range(n):
		var t := float(i) / float(sample_rate)
		var env := 1.0 - (t / duration)
		env = clampf(env, 0.0, 1.0)
		var attack := clampf(t / 0.008, 0.0, 1.0)
		env *= attack
		var s := 0.0
		for fi in range(freqs.size()):
			var f0: float = float(freqs[fi])
			var f: float = f0 * (1.0 + slide * (t / duration))
			var w: float = 1.0 / float(freqs.size())
			s += sin(TAU * f * t) * w
		var sample := int(clampf(s * volume * env * 32767.0, -32768.0, 32767.0))
		data.encode_s16(i * 2, sample)
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = sample_rate
	stream.stereo = false
	stream.data = data
	return stream

func _make_noise(duration: float, volume: float, lowpass_hz: float) -> AudioStreamWAV:
	var sample_rate := 22050
	var n := maxi(int(sample_rate * duration), 1)
	var data := PackedByteArray()
	data.resize(n * 2)
	var prev := 0.0
	var alpha := clampf(lowpass_hz / (lowpass_hz + float(sample_rate)), 0.01, 0.99)
	for i in range(n):
		var t := float(i) / float(sample_rate)
		var env := 1.0 - (t / duration)
		env = clampf(env * env, 0.0, 1.0)
		var raw := randf_range(-1.0, 1.0)
		prev = prev + alpha * (raw - prev)
		var sample := int(clampf(prev * volume * env * 32767.0, -32768.0, 32767.0))
		data.encode_s16(i * 2, sample)
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = sample_rate
	stream.stereo = false
	stream.data = data
	return stream

func _make_bgm_loop() -> AudioStreamWAV:
	## Soft looping meadow motif (C major pentatonic arpeggio + bass).
	var sample_rate := 22050
	var duration := 8.0
	var n := int(sample_rate * duration)
	var data := PackedByteArray()
	data.resize(n * 2)
	var melody := [261.63, 293.66, 329.63, 392.00, 440.00, 392.00, 329.63, 293.66]
	var bass := [130.81, 146.83, 164.81, 196.00]
	for i in range(n):
		var t := float(i) / float(sample_rate)
		var step := int(t * 4.0) % melody.size()
		var bstep := int(t * 1.0) % bass.size()
		var mf: float = float(melody[step])
		var bf: float = float(bass[bstep])
		var env_m := 0.55 + 0.45 * sin(TAU * (t * 0.5))
		var s := sin(TAU * mf * t) * 0.12 * env_m
		s += sin(TAU * bf * t) * 0.1
		s += sin(TAU * mf * 2.0 * t) * 0.03
		## gentle fade at loop edges
		var edge := minf(t, duration - t)
		var fade := clampf(edge / 0.08, 0.0, 1.0)
		var sample := int(clampf(s * fade * 32767.0, -32768.0, 32767.0))
		data.encode_s16(i * 2, sample)
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = sample_rate
	stream.stereo = false
	stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
	stream.loop_begin = 0
	stream.loop_end = n
	stream.data = data
	return stream

func _make_rain_loop() -> AudioStreamWAV:
	var sample_rate := 22050
	var duration := 2.0
	var n := int(sample_rate * duration)
	var data := PackedByteArray()
	data.resize(n * 2)
	var prev := 0.0
	for i in range(n):
		var raw := randf_range(-1.0, 1.0)
		prev = prev * 0.92 + raw * 0.08
		var sample := int(clampf(prev * 0.18 * 32767.0, -32768.0, 32767.0))
		data.encode_s16(i * 2, sample)
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = sample_rate
	stream.stereo = false
	stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
	stream.loop_begin = 0
	stream.loop_end = n
	stream.data = data
	return stream
