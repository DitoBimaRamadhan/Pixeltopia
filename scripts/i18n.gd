class_name I18n
extends RefCounted
## v1.8 tiny Indonesian / English string table. I18n.t("key") or I18n.t("key", [args]) (uses % formatting).
## Missing keys fall back to English, then to the key itself.

const S := {
	# --- HUD / hints ---
	"hint_touch": ["Tahan Pukul untuk menghancurkan blok · Taruh untuk membangun · Turun untuk lewat platform", "Hold Punch to break blocks · Place to build · Down drops through platforms"],
	"hint_keys_on": ["A/D · W lompat · S turun · tahan klik kiri pukul · klik kanan taruh · C craft · Y splice · B tas · P toko · M menu · Enter chat · Esc", "A/D · W jump · S drop · hold LMB punch · RMB place · C craft · Y splice · B bag · P store · M menu · Enter chat · Esc"],
	"hint_keys_off": ["A/D · W lompat · S turun · tahan klik kiri pukul · klik kanan taruh · Q buang · C craft · Y splice · B tas · P toko · M menu · Esc", "A/D · W jump · S drop · hold LMB punch · RMB place · Q drop · C craft · Y splice · B bag · P store · M menu · Esc"],
	"gems": ["Permata: %d", "Gems: %d"],
	"close": ["Tutup", "Close"],
	"back": ["Kembali", "Back"],
	"menu": ["Menu", "Menu"],
	"resume": ["Lanjut", "Resume"], "craft": ["Craft", "Craft"], "save": ["Simpan", "Save"], "load": ["Muat", "Load"],
	"mute": ["Bisu", "Mute"], "unmute": ["Suara", "Sound"], "avatar": ["Avatar", "Avatar"], "settings": ["Pengaturan", "Settings"],
	"store": ["Toko", "Store"], "bag": ["Tas", "Bag"], "down_btn": ["Turun", "Down"],
	# --- shop / sell ---
	"shop_title": ["Toko Pixeltopia", "Pixeltopia Store"],
	"shop_buy_tab": ["Beli", "Buy"], "shop_sell_tab": ["Jual", "Sell"],
	"shop_intro": ["Belanja bibit, blok, dan alat pakai permata.", "Spend gems to buy seeds, blocks, and tools."],
	"shop_sell_intro": ["Jual barang dari tas untuk permata. Harga jual selalu di bawah harga beli.", "Sell items from your bag for gems. Sell prices are always below buy prices."],
	"your_gems": ["Permatamu: %d", "Your gems: %d"],
	"buy": ["Beli", "Buy"], "sell1": ["Jual 1", "Sell 1"], "sell_all": ["Jual semua", "Sell all"], "sell": ["Jual", "Sell"],
	"price_buy": ["%s — %d permata", "%s — %d gems"],
	"price_sell": ["%s ×%d — %d permata/buah", "%s ×%d — %d gems each"],
	"nothing_to_sell": ["Belum ada barang yang bisa dijual.", "Nothing to sell yet."],
	"not_enough_gems": ["Permata tidak cukup.", "Not enough gems."],
	"buying": ["Membeli %s…", "Buying %s…"], "selling": ["Menjual %s…", "Selling %s…"],
	"bought": ["Beli 1× %s (−%d permata).", "Bought 1× %s (−%d gems)."],
	"sold": ["Terjual %d× %s (+%d permata).", "Sold %d× %s (+%d gems)."],
	"done": ["Berhasil!", "Done!"],
	"confirm_sell_all": ["Jual semua %d× %s untuk %d permata?", "Sell all %d× %s for %d gems?"],
	"yes": ["Ya", "Yes"], "no": ["Tidak", "No"],
	# --- hub ---
	"hub_title": ["Menu Pixeltopia", "Pixeltopia Menu"],
	"tab_daily": ["Harian", "Daily"], "tab_rank": ["Peringkat", "Ranking"], "tab_friends": ["Teman", "Friends"],
	"tab_world": ["Dunia", "World"], "tab_settings": ["Pengaturan", "Settings"],
	"online_only": ["Fitur ini butuh mode online (login).", "This needs online mode (log in)."],
	"loading": ["Memuat…", "Loading…"],
	# --- daily ---
	"daily_login": ["Hadiah Login Harian", "Daily Login Reward"],
	"daily_streak": ["Hari ke-%d berturut-turut · hadiah %d permata", "Day %d streak · %d gems"],
	"daily_claim": ["Klaim %d permata", "Claim %d gems"],
	"daily_claimed": ["Sudah diklaim hari ini. Besok: %d permata (hari ke-%d).", "Claimed today. Tomorrow: %d gems (day %d)."],
	"daily_got": ["+%d permata! Streak hari ke-%d.", "+%d gems! Day %d streak."],
	"daily_quests": ["Quest Harian (reset 00:00 WIB)", "Daily Quests (reset 00:00 WIB)"],
	"dq_progress": ["%s  %d/%d  · %d permata", "%s  %d/%d  · %d gems"],
	"dq_claim": ["Klaim", "Claim"], "dq_claimed": ["Selesai", "Done"],
	"dq_plant": ["Tanam %d bibit", "Plant %d seeds"], "dq_harvest": ["Panen %d tanaman", "Harvest %d crops"],
	"dq_place": ["Taruh %d blok", "Place %d blocks"], "dq_craft": ["Craft %d kali", "Craft %d times"],
	"dq_sell": ["Jual barang %d kali", "Sell items %d times"], "dq_splice": ["Splice %d bibit", "Splice %d seeds"],
	"dq_buy": ["Beli di toko %d kali", "Buy from the store %d times"],
	"daily_ready": ["Hadiah harian siap diklaim!", "Daily reward ready!"],
	# --- leaderboard ---
	"rank_title": ["20 Pemain Terkaya (permata)", "Top 20 Richest Players (gems)"],
	"rank_me": ["Peringkatmu: #%d · %d permata", "Your rank: #%d · %d gems"],
	"rank_refresh": ["Muat ulang", "Refresh"],
	# --- friends ---
	"friends_title": ["Teman", "Friends"],
	"friend_name": ["Nama pemain…", "Player name…"],
	"friend_add": ["Tambah", "Add"], "friend_remove": ["Hapus", "Remove"], "friend_accept": ["Terima", "Accept"],
	"friend_chat": ["Pesan", "Message"],
	"friends_none": ["Belum ada teman. Tambah lewat nama pemain.", "No friends yet. Add someone by name."],
	"friends_incoming": ["Permintaan masuk", "Incoming requests"], "friends_outgoing": ["Menunggu balasan", "Waiting for reply"],
	"friends_list": ["Teman (%d)", "Friends (%d)"],
	"friend_online": ["(online)", "(online)"], "friend_offline": ["", ""],
	"pm_title": ["Pesan dengan %s", "Messages with %s"],
	"pm_input": ["Tulis pesan (maks 200)…", "Write a message (max 200)…"],
	"pm_send": ["Kirim", "Send"],
	"pm_new": ["Pesan baru dari %s: %s", "New message from %s: %s"],
	"friend_request_from": ["%s ingin berteman! Buka Menu → Teman.", "%s wants to be friends! Open Menu → Friends."],
	# --- world settings ---
	"world_title": ["Pengaturan Dunia: %s", "World settings: %s"],
	"world_owner_only": ["Hanya pemilik World Lock yang bisa mengubah ini.", "Only the World Lock owner can change this."],
	"world_no_lock": ["Dunia ini belum dikunci. Pasang World Lock dulu.", "This world is not locked. Place a World Lock first."],
	"world_open": ["Dunia terbuka (semua boleh membangun)", "Open world (anyone can build)"],
	"world_bg": ["Latar:", "Background:"],
	"world_welcome": ["Pesan sambutan (maks 80)…", "Welcome message (max 80)…"],
	"world_apply": ["Simpan", "Save"],
	"world_saved": ["Pengaturan dunia disimpan.", "World settings saved."],
	"bg_0": ["Padang", "Meadow"], "bg_1": ["Hutan", "Forest"], "bg_2": ["Gurun", "Desert"], "bg_3": ["Malam", "Night"],
	"world_welcome_toast": ["%s: %s", "%s: %s"],
	# --- settings ---
	"set_music": ["Musik", "Music"], "set_sfx": ["Efek suara", "Sound effects"],
	"set_language": ["Bahasa", "Language"], "set_touch": ["Ukuran tombol sentuh", "Touch button size"],
	"set_shake": ["Getar layar", "Screen shake"], "set_fps": ["Tampilkan FPS", "Show FPS"],
	"set_tutorial": ["Ulangi tutorial", "Replay tutorial"],
	"set_next_track": ["Lagu berikutnya", "Next song"],
	"now_playing": ["Lagu: %s", "Song: %s"],
	"set_restart_note": ["Bahasa berubah penuh setelah membuka ulang panel.", "Language fully updates when panels are reopened."],
	# --- tutorial ---
	"tut_skip": ["Lewati", "Skip"], "tut_next": ["Lanjut", "Next"], "tut_done": ["Mulai main!", "Let's play!"],
	"tut_1": ["Selamat datang di Pixeltopia! Gerak dengan A/D atau tombol kiri/kanan, lompat dengan W atau tombol lompat.", "Welcome to Pixeltopia! Move with A/D or the left/right buttons, jump with W or the jump button."],
	"tut_2": ["Tahan Pukul (klik kiri) untuk menghancurkan blok. Blok bisa menjatuhkan bibit dan permata.", "Hold Punch (left click) to break blocks. Blocks can drop seeds and gems."],
	"tut_3": ["Pilih item di hotbar, lalu Taruh (klik kanan) untuk membangun. Tanam bibit di tanah lalu panen saat matang.", "Pick an item on the hotbar and Place (right click) to build. Plant seeds on soil and harvest when ripe."],
	"tut_4": ["Platform bisa dilompati dari bawah. Tekan S / tombol Turun untuk turun melewatinya.", "Jump up through platforms. Press S / the Down button to drop down through them."],
	"tut_5": ["Buka Tas (B), Craft (C), Splice (Y) dan Toko (P). Di Toko kamu juga bisa menjual barang.", "Open the Bag (B), Craft (C), Splice (Y) and Store (P). You can also sell items in the Store."],
	"tut_6": ["Menu (M): hadiah harian, quest harian, peringkat, teman & pesan, pengaturan dunia dan suara. Selamat bermain!", "Menu (M): daily rewards, daily quests, ranking, friends & messages, world and sound settings. Have fun!"],
}

static func lang() -> String:
	var ml := Engine.get_main_loop()
	if ml is SceneTree:
		var st: Node = (ml as SceneTree).root.get_node_or_null("Settings")
		if st:
			return str(st.get("language"))
	return "id"

static func t(key: String, args: Array = []) -> String:
	var row: Variant = S.get(key, null)
	var s := key
	if row is Array:
		s = str(row[0] if lang() == "id" else row[1])
	if args.is_empty():
		return s
	return s % args
