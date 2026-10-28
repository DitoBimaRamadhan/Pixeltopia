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
## v1.9 `anim`: {"walk": phase (radians-ish), "air": vy (px/s, <0 rising), "squash": -0.3..0.3}.
static func draw_look(ci: CanvasItem, look: AvatarLook, facing: int = 1, anim: Dictionary = {}) -> void:
	var f := 1 if facing >= 0 else -1
	var skin_c := look.skin()
	var hair_c := look.hair()
	var cloth_c := look.clothes()
	var acc_c := look.accessory()
	var walk := float(anim.get("walk", 0.0))
	var in_air := anim.has("air")
	var vy := float(anim.get("air", 0.0))
	var squash := float(anim.get("squash", 0.0))
	## Squash & stretch around the feet (y = 14).
	var sx := 1.0 + squash * 0.6
	var sy := 1.0 - squash
	var origin: Vector2 = anim.get("origin", Vector2.ZERO)
	ci.draw_set_transform(origin + Vector2(0, 14.0 * (1.0 - sy)), 0.0, Vector2(sx, sy))
	var bob := 0.0
	var leg_a := 0.0
	var leg_b := 0.0
	if in_air:
		## Rising: legs tucked; falling: legs spread.
		leg_a = -2.0 if vy < 0.0 else 1.0
		leg_b = 2.0 if vy < 0.0 else -1.0
	elif walk != 0.0:
		leg_a = sin(walk) * 3.0
		leg_b = -sin(walk) * 3.0
		bob = -absf(sin(walk)) * 1.5
	var leg_c := cloth_c.darkened(0.15)
	# legs (with little shoes)
	var la_h := 8.0 - maxf(0.0, -leg_a) * 0.6
	var lb_h := 8.0 - maxf(0.0, -leg_b) * 0.6
	ci.draw_rect(Rect2(-6 * f + leg_a * f, 6, 5 * f, la_h), leg_c)
	ci.draw_rect(Rect2(1 * f + leg_b * f, 6, 5 * f, lb_h), leg_c)
	ci.draw_rect(Rect2(-6 * f + leg_a * f, 6 + la_h - 2, 5 * f, 2), Color(0.22, 0.16, 0.12))
	ci.draw_rect(Rect2(1 * f + leg_b * f, 6 + lb_h - 2, 5 * f, 2), Color(0.22, 0.16, 0.12))
	# body
	ci.draw_rect(Rect2(-7, -2 + bob, 14, 10), cloth_c)
	# arms swing opposite to the legs
	var arm := -leg_a * 0.7 if not in_air else (-3.0 if vy < 0.0 else 1.0)
	ci.draw_rect(Rect2(-9, -1 + bob + arm * 0.3, 2, 7), skin_c.darkened(0.08))
	ci.draw_rect(Rect2(7, -1 + bob - arm * 0.3, 2, 7), skin_c.darkened(0.08))
	# head
	ci.draw_rect(Rect2(-6, -14 + bob, 12, 12), skin_c)
	# eyes (blink-free, look up while rising)
	var ey := -10.0 + bob + (-1.0 if in_air and vy < -120.0 else 0.0)
	ci.draw_rect(Rect2(-3 * f, ey, 2, 2), Color(0.1, 0.1, 0.15))
	ci.draw_rect(Rect2(2 * f, ey, 2, 2), Color(0.1, 0.1, 0.15))
	# smile (open mouth in the air)
	if in_air:
		ci.draw_rect(Rect2(-1, -5 + bob, 3, 2), Color(0.55, 0.25, 0.25))
	else:
		ci.draw_rect(Rect2(-2, -5 + bob, 4, 1), Color(0.55, 0.25, 0.25))
	# hair cap
	ci.draw_rect(Rect2(-7, -16 + bob, 14, 5), hair_c)
	ci.draw_rect(Rect2(-8 * f, -12 + bob, 3 * f, 6), hair_c)
	# accessory
	if acc_c.a > 0.01:
		ci.draw_circle(Vector2(5 * f, -8 + bob), 2.5, acc_c)
		ci.draw_circle(Vector2(5 * f, -8 + bob), 1.2, acc_c.lightened(0.35))
	ci.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
