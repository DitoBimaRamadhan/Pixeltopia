extends Node
## Headless smoke check for the v1.8 UI (run: godot --headless --path . res://tools/v18_check.tscn)

func _ready() -> void:
	var main: Node = load("res://scenes/main.tscn").instantiate()
	add_child(main)
	await get_tree().process_frame
	await get_tree().process_frame
	var hud = main.get_node("HUD")
	var ok := true
	for n in ["ShopPanel", "HubPanel", "TutorialPanel"]:
		if hud.get_node_or_null(n) == null:
			print("FAIL missing ", n); ok = false
	if main.get_node_or_null("Parallax") == null:
		print("FAIL no parallax"); ok = false
	hud.open_shop("sell"); await get_tree().process_frame
	if not hud.shop_open: print("FAIL shop"); ok = false
	hud.shop.open("buy"); await get_tree().process_frame
	hud.close_shop()
	for tab in ["daily", "rank", "friends", "world", "settings"]:
		hud.open_hub(tab); await get_tree().process_frame
	if not hud.hub_open: print("FAIL hub"); ok = false
	hud.close_hub()
	for i in range(4):
		main.parallax.set_theme(i); await get_tree().process_frame
	Settings.set_value("language", "en"); hud.refresh_language()
	print("hint en: ", hud.hint.text)
	Settings.set_value("language", "id"); hud.refresh_language()
	hud.start_tutorial(); for i in range(7): hud.tutorial.next()
	hud.show_toast("test")
	hud.on_social({"t": "daily_state", "streak": 2, "claimedToday": false, "next": {"gems": 50}, "quests": []})
	hud.on_social({"t": "leaderboard", "top": [{"name": "abc", "gems": 9}], "me": {"rank": 1, "gems": 9}})
	hud.on_social({"t": "friends", "friends": [], "incoming": [], "outgoing": []})
	await get_tree().create_timer(0.5).timeout
	print("V18_CHECK ", "OK" if ok else "FAIL", " music=", Sfx.now_playing)
	get_tree().quit()
