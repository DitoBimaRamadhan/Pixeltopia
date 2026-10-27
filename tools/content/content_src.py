"""Pixeltopia v1.8 content pack — single source of truth.

Run:  python3 tools/content/content_src.py
Writes server/lib/content.json (server rules) and scripts/content_data.gd (client).
Both are checked by server/test/rules_parity.test.js through tools/export_rules.gd.
All names/art are original.
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
C, U, R, E = 0, 1, 2, 3

# key, name, name_id, kind, rarity, sell, buy, hits, color, extra
T = []
def t(key, name, name_id, kind, rarity, sell, buy, hits, color, desc, **extra):
    T.append(dict(key=key, name=name, name_id=name_id, kind=kind, rarity=rarity, sell=sell, buy=buy,
                  hits=hits, color=color, desc=desc, **extra))

# --- solid building blocks
t("BRICK", "Red Brick", "Bata Merah", "block", U, 4, -1, 5, "b5523b", "Sturdy red bricks for houses.")
t("STONE_BRICK", "Stone Brick", "Bata Batu", "block", U, 5, -1, 6, "8d8f99", "Cut stone bricks. Very tough.")
t("SANDSTONE", "Sandstone", "Batu Pasir", "block", C, 2, -1, 4, "d9bf7a", "Pressed sand block.")
t("MARBLE", "Marble", "Marmer", "block", R, 9, -1, 6, "e8e6ee", "Polished white marble.")
t("OBSIDIAN", "Obsidian", "Obsidian", "block", R, 12, -1, 8, "2a1f3d", "Glassy volcanic rock. Hard to break.")
t("ICE", "Ice", "Es", "block", U, 3, 9, 2, "a8dcf5", "Frozen block, cold to the touch.")
t("SNOW", "Snow", "Salju", "block", C, 1, 3, 2, "f4f8ff", "Soft packed snow.")
t("CLAY", "Clay", "Tanah Liat", "block", C, 2, 4, 3, "b07a5e", "Moist clay. Bake it into bricks.")
t("METAL", "Metal Block", "Blok Logam", "block", R, 14, -1, 7, "9aa6b2", "Riveted steel plate.")
t("GOLD_BLOCK", "Gold Block", "Blok Emas", "block", E, 60, 260, 7, "f2c641", "Shiny! Pure bragging rights.")
t("CRYSTAL_BLOCK", "Crystal Block", "Blok Kristal", "block", E, 30, -1, 5, "7ff0e6", "Glows faintly from within.", light=0.5)
t("LEAVES", "Leaves", "Daun", "block", C, 1, 4, 1, "3f8f3a", "Leafy canopy block.")
t("MOSSY_STONE", "Mossy Stone", "Batu Berlumut", "block", U, 3, -1, 5, "6f8a62", "Old stone with moss.")
t("BOOKSHELF", "Bookshelf", "Rak Buku", "block", U, 8, -1, 4, "7a5230", "Full of stories.")
for k, n, ni, col in [("RED", "Red", "Merah", "d2453f"), ("BLUE", "Blue", "Biru", "3f6fd2"), ("GREEN", "Green", "Hijau", "46b04a"),
                      ("YELLOW", "Yellow", "Kuning", "e8cf3c"), ("PURPLE", "Purple", "Ungu", "8e4fc9"), ("WHITE", "White", "Putih", "eeeeee"),
                      ("BLACK", "Black", "Hitam", "2b2b30")]:
    t("WOOL_" + k, n + " Wool", "Wol " + ni, "block", C, 3, -1, 2, col, "Soft colored wool for decorating.")
# --- glass (solid, see-through)
t("GLASS", "Glass", "Kaca", "glass", U, 3, -1, 2, "cfeefa", "Clear glass pane.")
t("TINTED_GLASS", "Tinted Glass", "Kaca Gelap", "glass", U, 4, -1, 2, "5a6d8a", "Dark see-through glass.")
# --- doors (walk through), platforms (one-way: stand on top, jump up through, hold S/Down to drop)
t("WOOD_DOOR", "Wooden Door", "Pintu Kayu", "door", U, 6, -1, 3, "8a5a2b", "Walk through it. Every house needs one.")
t("METAL_DOOR", "Metal Door", "Pintu Logam", "door", R, 12, -1, 5, "7b8794", "A heavy door. Still walk-through.")
t("WOOD_PLATFORM", "Wood Platform", "Pijakan Kayu", "platform", C, 2, -1, 2, "a8763f", "Stand on it, jump up through it. Hold Down to drop.")
t("STONE_PLATFORM", "Stone Platform", "Pijakan Batu", "platform", U, 2, -1, 3, "8b8b92", "A sturdier one-way ledge.")
# --- lights (non-solid, glow at night)
t("LANTERN", "Lantern", "Lentera", "light", U, 6, 18, 1, "ffcc55", "A warm hanging lantern.", light=1.0)
t("NEON_PINK", "Pink Neon", "Neon Pink", "light", R, 9, -1, 1, "ff5fcf", "Bright pink neon tube.", light=0.9)
t("NEON_CYAN", "Cyan Neon", "Neon Cyan", "light", R, 9, -1, 1, "4ff2ff", "Bright cyan neon tube.", light=0.9)
t("CANDLE", "Candle", "Lilin", "light", C, 2, 6, 1, "fff0b0", "A small flickering candle.", light=0.6)
# --- background walls (non-solid, drawn behind players)
t("WALL_WOOD", "Wood Wall", "Dinding Kayu", "wall", C, 1, -1, 2, "6e4a28", "Background wall. You walk in front of it.")
t("WALL_STONE", "Stone Wall", "Dinding Batu", "wall", C, 1, -1, 2, "5f6068", "Background stone wall.")
t("WALL_BRICK", "Brick Wall", "Dinding Bata", "wall", U, 1, -1, 2, "7d3b2c", "Background brick wall.")
t("WALLPAPER", "Wallpaper", "Wallpaper", "wall", U, 2, -1, 1, "c9a7d8", "Cosy patterned background wall.")
# --- decorations (non-solid)
t("SIGN", "Sign", "Papan Tanda", "deco", C, 2, -1, 1, "b08850", "A wooden sign post (decoration).")
t("FLOWER_RED", "Red Flower", "Bunga Merah", "deco", C, 1, 3, 1, "e8434f", "A pretty red flower.")
t("FLOWER_BLUE", "Blue Flower", "Bunga Biru", "deco", C, 1, 3, 1, "4a7cf0", "A pretty blue flower.")
t("FENCE", "Fence", "Pagar", "deco", C, 1, -1, 2, "9b6b38", "A short picket fence.")
t("CHAIR", "Chair", "Kursi", "deco", C, 3, -1, 2, "a06a3a", "Take a seat.")
t("TABLE", "Table", "Meja", "deco", C, 4, -1, 2, "8f5f32", "A sturdy little table.")
t("CHEST", "Chest", "Peti", "deco", U, 5, -1, 3, "8b5a1e", "A decorative chest (no storage).")
# --- new crops (seed grows into crop on soil)
for sk, ck, sname, sid_name, cname, cid_name, grow, rar, ssell, csell, sbuy, scol, ccol in [
    ("SEED_SUN", "CROP_SUN", "Sunbloom Seed", "Benih Sunbloom", "Sunbloom", "Sunbloom", 20, R, 9, 16, 30, "f7d34a", "ffb627"),
    ("SEED_FROST", "CROP_FROST", "Frostberry Seed", "Benih Frostberry", "Frostberry", "Frostberry", 28, R, 12, 20, -1, "bfe8ff", "6fc8ff"),
    ("SEED_GOURD", "CROP_GOURD", "Gourdlet Seed", "Benih Gourdlet", "Gourdlet", "Gourdlet", 36, E, 20, 32, -1, "e8a04a", "e07b1f"),
]:
    t(sk, sname, sid_name, "seed", rar, ssell, sbuy, 1, scol, f"Plant on soil. Grows into {cname} in ~{grow}s.", grow=grow, crop=ck, farmable=True, seed_drop=sk)
    t(ck, cname, cid_name, "crop", rar, csell, -1, 1, ccol, f"Ripe {cname}. Harvest for seeds and gems.", seed=sk, farmable=True, seed_drop=sk)

FIRST_ID = 21
for i, d in enumerate(T):
    d["id"] = FIRST_ID + i
KEY = {d["key"]: d["id"] for d in T}
BASE = {"DIRT": 1, "GRASS": 2, "STONE": 3, "SEED": 4, "CROP": 5, "WOOD": 6, "TORCH": 7, "PLANK": 8, "SAND": 9,
        "SEED_AZURE": 10, "CROP_AZURE": 11, "FERTILIZER": 13, "SEED_EMBER": 14, "CROP_EMBER": 15,
        "SEED_MOON": 16, "CROP_MOON": 17, "SEED_CRYSTAL": 18, "CROP_CRYSTAL": 19}
def ref(k):
    return KEY[k] if k in KEY else BASE[k]
for d in T:
    for f in ("crop", "seed", "seed_drop"):
        if f in d:
            d[f] = ref(d[f])

# recipe id, result key, count, [(ingredient key, n)]
RECIPES = [
    ("brick", "BRICK", 2, [("CLAY", 2), ("TORCH", 1)]),
    ("clay", "CLAY", 2, [("DIRT", 2), ("SAND", 1)]),
    ("stone_brick", "STONE_BRICK", 2, [("STONE", 3)]),
    ("sandstone", "SANDSTONE", 1, [("SAND", 2)]),
    ("marble", "MARBLE", 1, [("STONE", 3), ("SNOW", 2)]),
    ("obsidian", "OBSIDIAN", 1, [("STONE", 4), ("CROP_EMBER", 1)]),
    ("mossy_stone", "MOSSY_STONE", 2, [("STONE", 2), ("LEAVES", 1)]),
    ("metal", "METAL", 1, [("STONE", 5), ("TORCH", 2)]),
    ("crystal_block", "CRYSTAL_BLOCK", 1, [("CROP_CRYSTAL", 1), ("GLASS", 2)]),
    ("bookshelf", "BOOKSHELF", 1, [("PLANK", 3)]),
    ("glass", "GLASS", 2, [("SAND", 3), ("TORCH", 1)]),
    ("tinted_glass", "TINTED_GLASS", 2, [("GLASS", 2), ("STONE", 1)]),
    ("wood_door", "WOOD_DOOR", 1, [("PLANK", 3)]),
    ("metal_door", "METAL_DOOR", 1, [("METAL", 1), ("PLANK", 1)]),
    ("wood_platform", "WOOD_PLATFORM", 4, [("PLANK", 1)]),
    ("stone_platform", "STONE_PLATFORM", 2, [("STONE_BRICK", 1)]),
    ("neon_pink", "NEON_PINK", 2, [("GLASS", 1), ("CROP_MOON", 1)]),
    ("neon_cyan", "NEON_CYAN", 2, [("GLASS", 1), ("CROP_AZURE", 1)]),
    ("wall_wood", "WALL_WOOD", 4, [("WOOD", 1)]),
    ("wall_stone", "WALL_STONE", 2, [("STONE", 1)]),
    ("wall_brick", "WALL_BRICK", 4, [("BRICK", 1)]),
    ("wallpaper", "WALLPAPER", 4, [("PLANK", 1), ("CROP", 1)]),
    ("sign", "SIGN", 1, [("PLANK", 1)]),
    ("fence", "FENCE", 3, [("WOOD", 2)]),
    ("chair", "CHAIR", 1, [("PLANK", 1)]),
    ("table", "TABLE", 1, [("PLANK", 2)]),
    ("chest", "CHEST", 1, [("PLANK", 2), ("STONE", 1)]),
    ("wool_white", "WOOL_WHITE", 2, [("SNOW", 2), ("CROP", 1)]),
    ("wool_red", "WOOL_RED", 1, [("WOOL_WHITE", 1), ("CROP", 1)]),
    ("wool_blue", "WOOL_BLUE", 1, [("WOOL_WHITE", 1), ("CROP_AZURE", 1)]),
    ("wool_green", "WOOL_GREEN", 1, [("WOOL_WHITE", 1), ("LEAVES", 1)]),
    ("wool_yellow", "WOOL_YELLOW", 1, [("WOOL_WHITE", 1), ("CROP_SUN", 1)]),
    ("wool_purple", "WOOL_PURPLE", 1, [("WOOL_WHITE", 1), ("CROP_MOON", 1)]),
    ("wool_black", "WOOL_BLACK", 1, [("WOOL_WHITE", 1), ("STONE", 2)]),
]
NAMES = {d["key"]: d["name"] for d in T}
recipes = [{"id": rid, "name": NAMES[res], "result": ref(res), "result_count": n,
            "ingredients": [{"id": ref(k), "count": c} for k, c in ing]} for rid, res, n, ing in RECIPES]
SPLICES = [("SEED_CRYSTAL", "SEED", "SEED_SUN"), ("SEED_SUN", "SEED_AZURE", "SEED_FROST"), ("SEED_FROST", "SEED_SUN", "SEED_GOURD"),
           ("SEED_CRYSTAL", "SEED_SUN", "SEED_GOURD")]
splices = [[ref(a), ref(b), ref(r)] for a, b, r in SPLICES]

data = {"version": 1, "first_id": FIRST_ID, "tiles": T, "recipes": recipes, "splices": splices}
with open(os.path.join(ROOT, "server/lib/content.json"), "w") as f:
    json.dump(data, f, indent=1)
    f.write("\n")
## CommonJS copy for the server (plain module.exports: no JSON-module semantics needed on any runtime).
with open(os.path.join(ROOT, "server/lib/content.js"), "w") as f:
    f.write("'use strict';\n// GENERATED by tools/content/content_src.py from the same data as content.json. Do not edit.\n")
    f.write("module.exports = " + json.dumps(data, indent=1) + ";\n")

def gd(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return json.dumps(v)
    if isinstance(v, list):
        return "[" + ", ".join(gd(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ", ".join(f"{json.dumps(str(k))}: {gd(x)}" for k, x in v.items()) + "}"
    raise TypeError(v)

lines = ["extends RefCounted", "## GENERATED by tools/content/content_src.py — do not edit by hand.", "## v1.8 content pack (mirrors server/lib/content.json).", "class_name ContentData", "",
         f"const FIRST_ID := {FIRST_ID}", "const TILES := ["]
for d in T:
    lines.append("\t" + gd(d) + ",")
lines += ["]", "const RECIPES := ["]
for r in recipes:
    lines.append("\t" + gd(r) + ",")
lines += ["]", "const SPLICES := " + gd(splices), ""]
with open(os.path.join(ROOT, "scripts/content_data.gd"), "w") as f:
    f.write("\n".join(lines))
print(len(T), "tiles,", len(recipes), "recipes,", len(splices), "splices; ids", FIRST_ID, "-", T[-1]["id"])
