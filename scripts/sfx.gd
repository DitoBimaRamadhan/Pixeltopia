extends Node
## Procedural SFX + looping BGM for Pixeltopia (original tones — no third-party samples).
## Autoload name: Sfx

var muted: bool = false
var music_muted: bool = false
var _players: Array = []  ## AudioStreamPlayer pool
var _pool_i: int = 0
var _streams: Dictionary = {}  ## name -> AudioStreamWAV
var _bgm: AudioStreamPlayer = null
var _rain: AudioStreamPlayer = null

func _ready() -> void:
	for i in range(8):
		var p := AudioStreamPlayer.new()
		p.bus = "Master"
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
	_bgm = AudioStreamPlayer.new()
	_bgm.bus = "Master"
	_bgm.volume_db = -18.0
	add_child(_bgm)
	_bgm.stream = _make_bgm_loop()
	_rain = AudioStreamPlayer.new()
	_rain.bus = "Master"
	_rain.volume_db = -22.0
	add_child(_rain)
	_rain.stream = _make_rain_loop()
	call_deferred("start_music")

func start_music() -> void:
	if muted or music_muted:
		return
	if _bgm and not _bgm.playing:
		_bgm.play()

func stop_music() -> void:
	if _bgm:
		_bgm.stop()

func set_muted(v: bool) -> void:
	muted = v
	if muted:
		stop_music()
		set_rain(false)
	else:
		start_music()

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

func set_rain(on: bool) -> void:
	if _rain == null:
		return
	if muted or not on:
		_rain.stop()
		return
	if not _rain.playing:
		_rain.play()

func play(name: String) -> void:
	if muted:
		return
	if not _streams.has(name):
		return
	var p: AudioStreamPlayer = _players[_pool_i]
	_pool_i = (_pool_i + 1) % _players.size()
	p.stream = _streams[name]
	p.volume_db = -6.0
	if name == "thunder":
		p.volume_db = -2.0
	p.play()

func play_harvest() -> void:
	play("harvest")

func play_craft() -> void:
	play("craft")

func play_footstep() -> void:
	play("footstep")

func play_ui() -> void:
	play("ui")

func play_place() -> void:
	play("place")

func play_break() -> void:
	play("break")

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
