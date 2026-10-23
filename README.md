# Pixeltopia — Phase 1 prototype

**Original** single-player 2D sandbox + planting prototype (Godot 4).

## v1.6.0 — Atmosphere & progression
- **Dynamic weather:** Rain & Thunder (plus Clear / Aurora / City) — rain speeds crop growth, thunder flashes + SFX
- **Day/night cycle:** continuous clock with auto cycle (default on)
- **Music & SFX:** looping meadow BGM + procedural rain/thunder/level-up/badge tones
- **Achievements:** original Pixeltopia badges (L key / ★ button)
- **Leveling:** XP from break, harvest, splice, trade, quests
- **UI:** Pixelify Sans + green-cream thick-border panels (GT-inspired, original branding)

Inspired only by *general* sandbox-farming mechanics (break/place blocks, plant seeds, harvest). **Not affiliated with Growtopia or any commercial game.** Name, UI, and placeholder art are original. Do not copy another game’s logos, UI layout, or assets.

Working title: **Pixeltopia** (rename anytime in `project.godot` → `config/name`).

## Requirements

- Godot **4.3+** (editor or the Linux binary under `/workspace/tools/`)

## How to run

```bash
/workspace/tools/Godot_v4.3-stable_linux.x86_64 /workspace/pixeltopia/project.godot
```

Headless check:

```bash
/workspace/tools/Godot_v4.3-stable_linux.x86_64 --headless --path /workspace/pixeltopia --quit-after 3
```

## Controls

| Input | Action |
|--------|--------|
| A / D or ← / → | Move |
| W / Space / ↑ | Jump |
| Left click | Punch / break / harvest (or place if holding an item on empty air) |
| Right click | Place selected block / plant seed / torch |
| 1–7 | Select hotbar (1 = Fist) |
| Esc | Pause · Save / Load (`user://pixeltopia_save.json`) |

## Phase 1 scope

- Procedural dirt/grass/stone terrain
- Break & place blocks (**Dirt, Grass, Stone, Wood**)
- **Torch** (non-solid decorative light)
- Plant **Seed** on air above dirt/grass → **Groveberry** in ~8s → harvest (berry + seed)
- Harvest / break feedback: floating “+1 …” text + particle dots
- HUD shows **selected item** name
- Esc pause with **Save / Load** (world + inventory + player position)
- Placeholder colored rectangles (no third-party game art)

## Not in Phase 1

Multiplayer, economy, trade, chat, accounts — later phases.

## Next: Phase 2

See [PHASE2.md](PHASE2.md) for the planned single-player upgrades (more tiles/crops, craft UI, world gen, audio, touch). Phase 1 features stay intact.

## Project layout

```
pixeltopia/
  project.godot
  scenes/main.tscn
  scripts/main.gd, world.gd, player.gd, inventory.gd, hud.gd, tiles.gd, floating_text.gd
  icon.svg
  README.md
  PHASE2.md
```


## Phase 2 (started)

- Craft UI (`C`): Wood×2→Plank, Wood×1→Torch×2
- Sand tile + Azureoot crop
- See `PHASE2.md` for weather, multiplayer prep, APK notes

## Related / legacy sources

The earlier **Pixel Sandbox** (Node + Canvas + Capacitor) prototype owned by the
same author is archived under [`imported/pixel-sandbox/`](imported/pixel-sandbox/)
for reference. Pixeltopia itself remains the Godot 4 game. See
[`imported/IMPORT.md`](imported/IMPORT.md).


## Latest (v1.6.0)

- **Seed splicing:** combine two different seeds (Y / Splice) to discover Emberfruit, Moonpetal, Crystalroot
- Farmable crops keep rarity-scaled gem & seed drops
- APK: [Release v1.6.0](https://github.com/DitoBimaRamadhan/Pixeltopia/releases/tag/v1.6.0) · [Direct APK](https://github.com/DitoBimaRamadhan/Pixeltopia/releases/download/v1.6.0/Pixeltopia.apk)
