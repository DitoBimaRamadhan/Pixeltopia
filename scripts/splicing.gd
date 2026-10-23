extends RefCounted
## Seed splicing (discovery): combine two different seeds → a new seed.
## Growtopia-inspired loop; original Pixeltopia names and recipes only.
class_name Splicing

## Unordered pair key "lo,hi" → result seed id.
static func recipes() -> Dictionary:
	return {
		# Groveberry + Azureoot → Emberfruit Seed
		_key(Tiles.Id.SEED, Tiles.Id.SEED_AZURE): Tiles.Id.SEED_EMBER,
		# Groveberry + Emberfruit → Moonpetal Seed
		_key(Tiles.Id.SEED, Tiles.Id.SEED_EMBER): Tiles.Id.SEED_MOON,
		# Azureoot + Emberfruit → Crystalroot Seed
		_key(Tiles.Id.SEED_AZURE, Tiles.Id.SEED_EMBER): Tiles.Id.SEED_CRYSTAL,
		# Groveberry + Moonpetal → Crystalroot Seed (alt path)
		_key(Tiles.Id.SEED, Tiles.Id.SEED_MOON): Tiles.Id.SEED_CRYSTAL,
		# Azureoot + Moonpetal → Crystalroot Seed
		_key(Tiles.Id.SEED_AZURE, Tiles.Id.SEED_MOON): Tiles.Id.SEED_CRYSTAL,
		# Emberfruit + Moonpetal → Crystalroot Seed
		_key(Tiles.Id.SEED_EMBER, Tiles.Id.SEED_MOON): Tiles.Id.SEED_CRYSTAL,
	}

static func _key(a: int, b: int) -> String:
	var lo := mini(a, b)
	var hi := maxi(a, b)
	return "%d,%d" % [lo, hi]

static func result_of(seed_a: int, seed_b: int) -> int:
	## Returns result seed id, or -1 if invalid / same seed / unknown pair.
	if seed_a < 0 or seed_b < 0:
		return -1
	if seed_a == seed_b:
		return -1
	if not Tiles.is_seed(seed_a) or not Tiles.is_seed(seed_b):
		return -1
	var r: Variant = recipes().get(_key(seed_a, seed_b), -1)
	return int(r)

static func can_splice(seed_a: int, seed_b: int) -> bool:
	return result_of(seed_a, seed_b) >= 0

static func known_pairs() -> Array:
	## Human-readable list for UI tips: [{a, b, result, blurb}, ...]
	var out: Array = []
	var seen: Dictionary = {}
	for k in recipes().keys():
		if seen.has(k):
			continue
		seen[k] = true
		var parts: PackedStringArray = str(k).split(",")
		var a := int(parts[0])
		var b := int(parts[1])
		var res := int(recipes()[k])
		out.append({
			"a": a,
			"b": b,
			"result": res,
			"blurb": "%s + %s → %s" % [
				Items.display_name(a),
				Items.display_name(b),
				Items.display_name(res),
			],
		})
	return out

static func all_seed_ids() -> Array:
	return [
		Tiles.Id.SEED,
		Tiles.Id.SEED_AZURE,
		Tiles.Id.SEED_EMBER,
		Tiles.Id.SEED_MOON,
		Tiles.Id.SEED_CRYSTAL,
	]
