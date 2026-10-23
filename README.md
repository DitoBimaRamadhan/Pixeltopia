# Pixeltopia — Phase 1 prototype

**Original** single-player 2D sandbox + planting prototype (Godot 4).

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
