extends Node
## v1.8 Store (moved out of hud.gd): Buy tab + new Sell tab (sell 1 / sell all from the bag).
## Online the server prices and applies everything (shop_buy / shop_sell); offline it uses the local wallet.

const Items = preload("res://scripts/items.gd")
const ItemIcon = preload("res://scripts/item_icon.gd")

var hud: Node = null
var inv: Node = null
var ui: Dictionary = {}
var is_open: bool = false
var tab: String = "buy"
var _tab_btns: Dictionary = {}
var _confirm: Dictionary = {}  ## {id, n} pending "sell all"

func setup(p_hud: Node, p_inv: Node, parent: Control) -> void:
	hud = p_hud
	inv = p_inv
	ui = UiKit.modal(parent, "ShopUI", I18n.t("shop_title"), 310.0, 240.0)
	ui["close"].pressed.connect(close)
	for k in ["buy", "sell"]:
		var b := UiKit.button(I18n.t("shop_%s_tab" % k), Color(0.22, 0.4, 0.3), 120.0, 40.0)
		var kk: String = k
		b.pressed.connect(func() -> void:
			tab = kk
			_confirm = {}
			Sfx.play_ui()
			rebuild())
		ui["tabs"].add_child(b)
		_tab_btns[k] = b
	if inv.has_signal("changed"):
		inv.changed.connect(func() -> void:
			if is_open:
				rebuild())

func open(start_tab: String = "") -> void:
	if start_tab != "":
		tab = start_tab
	is_open = true
	_confirm = {}
	ui["root"].visible = true
	ui["status"].text = I18n.t("shop_intro") if tab == "buy" else I18n.t("shop_sell_intro")
	rebuild()
	Sfx.play_open()

func close() -> void:
	if not is_open:
		return
	is_open = false
	ui["root"].visible = false
	hud._emit_block_input()

func rebuild() -> void:
	if ui.is_empty():
		return
	ui["title"].text = I18n.t("shop_title")
	for k in _tab_btns:
		UiKit.set_tab_style(_tab_btns[k], k == tab)
		_tab_btns[k].text = I18n.t("shop_%s_tab" % k)
	var list: VBoxContainer = ui["list"]
	UiKit.clear(list)
	list.add_child(UiKit.label(I18n.t("your_gems", [inv.gems]), 15, Color(0.55, 1.0, 0.85)))
	if tab == "buy":
		_build_buy(list)
	else:
		_build_sell(list)

func _item_row(id: int, text: String) -> HBoxContainer:
	var r := UiKit.row()
	r.add_child(ItemIcon.make_icon(id, 32.0))
	var l := UiKit.label(text, 12, Items.rarity_color(id))
	l.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	r.add_child(l)
	return r

func _build_buy(list: VBoxContainer) -> void:
	for info in Items.store_stock():
		var id: int = int(info["id"])
		var price: int = int(info["buy"])
		if price < 0:
			continue
		var r := _item_row(id, (I18n.t("price_buy", [Items.display_name(id), price]) + "\n%s [%s]" % [Items.description(id), Items.rarity_name(id)]))
		var b := UiKit.button(I18n.t("buy"), Color(0.25, 0.65, 0.42), 84.0)
		b.disabled = inv.gems < price
		var iid := id
		var ip := price
		b.pressed.connect(func() -> void: _buy(iid, ip))
		r.add_child(b)
		list.add_child(r)

func _sellables() -> Array:
	var seen := {}
	var out: Array = []
	for i in range(1, inv.slot_count()):
		var id: int = inv.slots[i]
		if id < 0 or inv.counts[i] <= 0 or seen.has(id):
			continue
		seen[id] = true
		if Items.sell_price(id) > 0:
			out.append({"id": id, "n": inv.count_of(id), "price": Items.sell_price(id)})
	out.sort_custom(func(a, b) -> bool: return int(a["price"]) * int(a["n"]) > int(b["price"]) * int(b["n"]))
	return out

func _build_sell(list: VBoxContainer) -> void:
	var items := _sellables()
	if items.is_empty():
		list.add_child(UiKit.label(I18n.t("nothing_to_sell"), 13))
		return
	for it in items:
		var id: int = int(it["id"])
		var n: int = int(it["n"])
		var price: int = int(it["price"])
		var r := _item_row(id, I18n.t("price_sell", [Items.display_name(id), n, price]))
		if not _confirm.is_empty() and int(_confirm["id"]) == id:
			r.get_child(1).text = I18n.t("confirm_sell_all", [mini(n, 100), Items.display_name(id), mini(n, 100) * price])
			var yes := UiKit.button(I18n.t("yes"), Color(0.75, 0.45, 0.2), 64.0)
			var no := UiKit.button(I18n.t("no"), Color(0.35, 0.4, 0.5), 64.0)
			var iid := id
			var nn := mini(n, 100)
			yes.pressed.connect(func() -> void:
				_confirm = {}
				_sell(iid, nn))
			no.pressed.connect(func() -> void:
				_confirm = {}
				rebuild())
			r.add_child(yes)
			r.add_child(no)
		else:
			var one := UiKit.button(I18n.t("sell1"), Color(0.7, 0.5, 0.2), 76.0)
			var all := UiKit.button(I18n.t("sell_all"), Color(0.62, 0.36, 0.22), 96.0)
			var iid2 := id
			one.pressed.connect(func() -> void: _sell(iid2, 1))
			all.disabled = n < 2
			all.pressed.connect(func() -> void:
				_confirm = {"id": iid2}
				Sfx.play_ui()
				rebuild())
			r.add_child(one)
			r.add_child(all)
		list.add_child(r)

func _buy(id: int, price: int) -> void:
	if inv.gems < price:
		ui["status"].text = I18n.t("not_enough_gems")
		Sfx.play_error()
		return
	if hud._server_inv():
		hud._net.send_inv_request("shop_buy", {"id": id, "n": 1})
		ui["status"].text = I18n.t("buying", [Items.display_name(id)])
		return
	if not inv.spend_gems(price):
		ui["status"].text = I18n.t("not_enough_gems")
		Sfx.play_error()
		return
	inv.add_item(id, 1)
	ui["status"].text = I18n.t("bought", [Items.display_name(id), price])
	Sfx.play_buy()
	rebuild()

func _sell(id: int, n: int) -> void:
	n = mini(n, inv.count_of(id))
	if n <= 0:
		return
	var price := Items.sell_price(id)
	if hud._server_inv():
		hud._net.send_inv_request("shop_sell", {"id": id, "n": n})
		ui["status"].text = I18n.t("selling", [Items.display_name(id)])
		return
	if not inv.consume_item(id, n):
		return
	inv.add_gems(price * n)
	ui["status"].text = I18n.t("sold", [n, Items.display_name(id), price * n])
	Sfx.play_sell()
	rebuild()

func on_result(op: String, ok: bool, err: String, res: Dictionary) -> void:
	if ok:
		if op == "shop_sell":
			var id := int(res.get("id", -1))
			var n := int(res.get("n", 1))
			ui["status"].text = I18n.t("sold", [n, Items.display_name(id), Items.sell_price(id) * n]) if id >= 0 else I18n.t("done")
			Sfx.play_sell()
		else:
			ui["status"].text = I18n.t("done")
			Sfx.play_buy()
	else:
		ui["status"].text = err
	if is_open:
		rebuild()
