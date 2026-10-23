# Pixeltopia — Phase 2 plan

Phase 2 builds on the **Phase 1** single-player Godot 4 prototype. Do **not** remove or regress Phase 1 features listed below.

## Phase 1 baseline (keep intact)

- Procedural dirt / grass / stone terrain
- Break & place: Dirt, Grass, Stone, Wood
- Torch (non-solid decorative light)
- Plant Seed on soil → Groveberry (~8s) → harvest (berry + seed)
- Harvest / break feedback: floating “+1 …” text + particle dots
- Hotbar 1–7 (Fist + items), HUD selected-item name
- Esc → Resume / Save / Load (`user://pixeltopia_save.json`)
- Original name, UI, and placeholder art (no third-party game branding)

## Goals for Phase 2

Deepen **single-player** sandbox + farming: more content, clearer craft loop, nicer feel. Multiplayer stays **out of scope** except light “prep” notes at the end.

## Feature list (suggested order)

### 2.1 Content — tiles & crops

- [ ] Add 2–4 new solid tiles (e.g. Sand, Clay, Plank) with colors in `tiles.gd`
- [ ] Second crop type with different grow time / yield (keep Groveberry working)
- [ ] Optional: watering or fertilizer as a simple inventory item that shortens grow time
- [ ] Dropped items on ground (pickup on walk-over) instead of only inventory auto-add

### 2.2 Crafting UI (still local)

- [ ] Simple craft panel (Esc menu or key `C`): recipes like Wood×2 → Plank, Stick+Coal → Torch
- [ ] Recipes defined in one data file / dictionary (no hard-coded only in UI)
- [ ] Craft consumes inventory and respects Phase 1 hotbar rules

### 2.3 World generation

- [ ] Slightly richer terrain: caves or stone layers, surface trees made of Wood
- [ ] Spawn near flat grass; avoid burying the player in stone
- [ ] Optional seed number in save so worlds are reproducible

### 2.4 Audio & juice

- [ ] Procedural or CC0 SFX: place, break, jump, harvest, craft
- [ ] Toggle mute in pause menu
- [ ] Keep / extend floating text + particles; maybe brief screen shake on break

### 2.5 UX & input

- [ ] Touch / mobile: on-screen move + jump + punch / place (Godot touch buttons)
- [ ] Mouse scroll to change hotbar; click hotbar slots
- [ ] Clearer pause menu labels and “unsaved changes” hint after edits

### 2.6 Save / settings polish

- [ ] Multiple save slots or named worlds
- [ ] Settings: window mode, volume, show FPS
- [ ] Version field in save JSON for future migrations

### 2.7 Art pass (original only)

- [ ] Replace solid-color rects with simple original pixel sprites (CC0 or self-made)
- [ ] Distinct icons for hotbar items
- [ ] **Never** copy Growtopia or other commercial UI / logos / assets

## Explicitly later (not Phase 2 gameplay)

| Topic | Note |
|--------|------|
| Multiplayer / WebSocket server | Phase 3+ |
| Accounts, chat, trade, gems economy | Phase 3+ |
| Authoritative anti-cheat | Needs server |
| Play Store packaging | After Phase 2 content feels fun |

### Multiplayer prep only (optional, no live netcode)

- Keep world / inventory / tile IDs in `shared`-friendly shapes (ints, JSON-serializable)
- Avoid baking cheats into client-only economy logic
- Document message ideas in a future `PHASE3.md` — do not implement sockets in Phase 2 unless scoped as a spike

## Out of scope / constraints

- No “sama persis” clone of any commercial game’s UI or branding
- No breaking Phase 1 controls or save format without a migration path
- Prefer Godot 4.3+; stay free/CC0 for assets

## Success criteria

Phase 2 is “done enough” when a player can: explore a slightly richer world, craft at least a few items through a UI, hear feedback, optionally use touch controls, and save/load without losing Phase 1 behavior.

## Suggested first tickets

1. Craft UI + 2–3 recipes (Plank, Torch from ingredients)
2. One new tile + one new crop
3. Place/break/harvest SFX + mute toggle
4. Touch controls prototype

