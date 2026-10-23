extends RefCounted
## Original pixel avatar layers for Pixeltopia (not Growtopia assets).
class_name AvatarLook

const SKIN := [
	Color(0.96, 0.80, 0.62),
	Color(0.85, 0.65, 0.45),
	Color(0.55, 0.35, 0.22),
	Color(0.98, 0.88, 0.75),
]
const HAIR := [
	Color(0.15, 0.12, 0.1),
	Color(0.55, 0.30, 0.12),
	Color(0.85, 0.75, 0.25),
	Color(0.35, 0.55, 0.85),
	Color(0.75, 0.25, 0.45),
]
const CLOTHES := [
	Color(0.25, 0.55, 0.95),
	Color(0.85, 0.30, 0.35),
	Color(0.30, 0.70, 0.40),
	Color(0.55, 0.35, 0.75),
	Color(0.95, 0.70, 0.25),
]
const ACCESSORY := [
	Color(0, 0, 0, 0),  ## none
	Color(0.95, 0.85, 0.2),  ## sun pin
	Color(0.7, 0.9, 1.0),  ## ice gem
	Color(0.95, 0.4, 0.7),  ## berry bow
]

var skin_i: int = 0
var hair_i: int = 0
var clothes_i: int = 0
var accessory_i: int = 0

func to_save() -> Dictionary:
	return {
		"skin": skin_i,
		"hair": hair_i,
		"clothes": clothes_i,
		"accessory": accessory_i,
	}

func from_save(data: Dictionary) -> void:
	skin_i = int(data.get("skin", 0)) % SKIN.size()
	hair_i = int(data.get("hair", 0)) % HAIR.size()
	clothes_i = int(data.get("clothes", 0)) % CLOTHES.size()
	accessory_i = int(data.get("accessory", 0)) % ACCESSORY.size()

func skin() -> Color:
	return SKIN[skin_i % SKIN.size()]

func hair() -> Color:
	return HAIR[hair_i % HAIR.size()]

func clothes() -> Color:
	return CLOTHES[clothes_i % CLOTHES.size()]

func accessory() -> Color:
	return ACCESSORY[accessory_i % ACCESSORY.size()]

## Draw a small ~20x28 pixel character centered at origin (facing +1 / -1).
static func draw_look(ci: CanvasItem, look: AvatarLook, facing: int = 1) -> void:
	var f := 1 if facing >= 0 else -1
	var skin_c := look.skin()
	var hair_c := look.hair()
	var cloth_c := look.clothes()
	var acc_c := look.accessory()
	# legs
	ci.draw_rect(Rect2(-6 * f, 6, 5 * f, 8), cloth_c.darkened(0.15))
	ci.draw_rect(Rect2(1 * f, 6, 5 * f, 8), cloth_c.darkened(0.15))
	# body
	ci.draw_rect(Rect2(-7, -2, 14, 10), cloth_c)
	# head
	ci.draw_rect(Rect2(-6, -14, 12, 12), skin_c)
	# eyes
	ci.draw_rect(Rect2(-3 * f, -10, 2, 2), Color(0.1, 0.1, 0.15))
	ci.draw_rect(Rect2(2 * f, -10, 2, 2), Color(0.1, 0.1, 0.15))
	# smile
	ci.draw_rect(Rect2(-2, -5, 4, 1), Color(0.55, 0.25, 0.25))
	# hair cap
	ci.draw_rect(Rect2(-7, -16, 14, 5), hair_c)
	ci.draw_rect(Rect2(-8 * f, -12, 3 * f, 6), hair_c)
	# accessory
	if acc_c.a > 0.01:
		ci.draw_circle(Vector2(5 * f, -8), 2.5, acc_c)
		ci.draw_circle(Vector2(5 * f, -8), 1.2, acc_c.lightened(0.35))
