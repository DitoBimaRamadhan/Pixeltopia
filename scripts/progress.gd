extends Node
## Player leveling — XP from break, splice, trade (original Pixeltopia).
class_name PlayerProgress

signal xp_changed(level: int, xp: int, need: int)
signal leveled_up(level: int)

var level: int = 1
var xp: int = 0

const XP_BREAK := 2
const XP_HARVEST := 4
const XP_SPLICE := 12
const XP_TRADE := 20
const XP_QUEST := 8

func xp_to_next(lv: int = -1) -> int:
	var L := level if lv < 0 else lv
	## Soft curve: 40, 60, 85, … caps growth a bit for early game feel.
	return 30 + L * 18 + (L * L)

func add_xp(amount: int, reason: String = "") -> void:
	if amount <= 0:
		return
	xp += amount
	var ups := 0
	while xp >= xp_to_next():
		xp -= xp_to_next()
		level += 1
		ups += 1
		leveled_up.emit(level)
	xp_changed.emit(level, xp, xp_to_next())
	if ups > 0:
		var _sfx = get_node_or_null("/root/Sfx")
		if _sfx and _sfx.has_method("play_levelup"):
			_sfx.play_levelup()

func report_break() -> void:
	add_xp(XP_BREAK, "break")

func report_harvest() -> void:
	add_xp(XP_HARVEST, "harvest")

func report_splice() -> void:
	add_xp(XP_SPLICE, "splice")

func report_trade() -> void:
	add_xp(XP_TRADE, "trade")

func report_quest() -> void:
	add_xp(XP_QUEST, "quest")

func label() -> String:
	return "Lv %d  (%d/%d XP)" % [level, xp, xp_to_next()]

func to_save() -> Dictionary:
	return {"level": level, "xp": xp}

func from_save(data: Dictionary) -> void:
	level = maxi(int(data.get("level", 1)), 1)
	xp = maxi(int(data.get("xp", 0)), 0)
	xp_changed.emit(level, xp, xp_to_next())
