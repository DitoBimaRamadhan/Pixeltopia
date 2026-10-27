extends CanvasLayer
## v1.8 parallax background (original art from tools/art/gen_bg.py): sky + far/mid/near layers that scroll
## slower than the camera, tinted by the day/night CanvasModulate. Theme = world setting bg (0..3).

const THEMES := ["meadow", "forest", "desert", "night"]
const LAYERS := ["0_sky", "1_far", "2_mid", "3_near"]
const FACTORS := [0.0, 0.08, 0.2, 0.38]  ## horizontal scroll vs camera
const V_FACTORS := [0.0, 0.03, 0.06, 0.1]

var theme_idx: int = -1
var _tex: Array = []
var _canvas: Control = null
var camera: Camera2D = null
var tint_source: CanvasModulate = null

func _ready() -> void:
	layer = -10
	_canvas = Control.new()
	_canvas.set_anchors_preset(Control.PRESET_FULL_RECT)
	_canvas.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_canvas.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_canvas.draw.connect(_on_draw)
	add_child(_canvas)
	set_theme(0)

func set_theme(i: int) -> void:
	i = clampi(i, 0, THEMES.size() - 1)
	if i == theme_idx:
		return
	theme_idx = i
	_tex.clear()
	for l in LAYERS:
		var path := "res://assets/backgrounds/%s_%s.png" % [THEMES[i], l]
		_tex.append(load(path) if ResourceLoader.exists(path) else null)
	if _canvas:
		_canvas.queue_redraw()

func _process(_delta: float) -> void:
	if _canvas:
		if tint_source:
			_canvas.modulate = tint_source.color.lerp(Color.WHITE, 0.15)
		_canvas.queue_redraw()

func _on_draw() -> void:
	var vs := _canvas.size
	if vs.x <= 0.0 or vs.y <= 0.0:
		return
	var cam := camera.get_screen_center_position() if camera and camera.is_inside_tree() else Vector2.ZERO
	for li in range(_tex.size()):
		var tex: Texture2D = _tex[li]
		if tex == null:
			continue
		var ts := tex.get_size()
		var sc := ceilf(vs.y / ts.y)  ## integer scale keeps pixels crisp
		var w := ts.x * sc
		var h := ts.y * sc
		## camera higher up (smaller y) pushes hills down a little; never lift them off the bottom edge
		var y := vs.y - h + clampf(-(cam.y - 640.0) * float(V_FACTORS[li]), 0.0, h * 0.3)
		var off := fposmod(-cam.x * float(FACTORS[li]), w)
		var x := off - w
		while x < vs.x:
			_canvas.draw_texture_rect(tex, Rect2(x, y, w, h), false)
			x += w
