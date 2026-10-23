extends Node
## Procedural SFX for Pixeltopia (original tones — no third-party samples).
## Autoload name: Sfx

var muted: bool = false
var _players: Array = []  ## AudioStreamPlayer pool
var _pool_i: int = 0
var _streams: Dictionary = {}  ## name -> AudioStreamWAV

func _ready() -> void:
	for i in range(6):
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

func set_muted(v: bool) -> void:
	muted = v

func toggle_mute() -> bool:
	muted = not muted
	return muted

func play(name: String) -> void:
	if muted:
		return
	if not _streams.has(name):
		return
	var p: AudioStreamPlayer = _players[_pool_i]
	_pool_i = (_pool_i + 1) % _players.size()
	p.stream = _streams[name]
	p.volume_db = -6.0
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

func _make_tone(freqs: Array, duration: float, volume: float, slide: float) -> AudioStreamWAV:
	var sample_rate := 22050
	var n := maxi(int(sample_rate * duration), 1)
	var data := PackedByteArray()
	data.resize(n * 2)
	for i in range(n):
		var t := float(i) / float(sample_rate)
		var env := 1.0 - (t / duration)
		env = clampf(env, 0.0, 1.0)
		# soft attack
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
