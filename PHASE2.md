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

- [x] Add solid tiles: **Plank** (crafted) + **Sand** in `tiles.gd` (Clay still open)
- [x] Second crop: **Azureoot** (~12s grow; Groveberry still ~8s)
- [ ] Optional: watering or fertilizer as a simple inventory item that shortens grow time
- [ ] Dropped items on ground (pickup on walk-over) instead of only inventory auto-add

### 2.2 Crafting UI (still local)

- [x] Craft panel (key `C` or pause → Craft): Wood×2 → Plank, Wood×1 → Torch×2
- [x] Recipes in `scripts/recipes.gd` data dictionary
- [x] Craft consumes via `count_of` / `consume_item`; hotbar Phase 1 rules kept

### 2.3 World generation

- [ ] Slightly richer terrain: caves or stone layers, surface trees made of Wood
- [ ] Spawn near flat grass; avoid burying the player in stone
- [ ] Optional seed number in save so worlds are reproducible

### 2.4 Audio & juice

- [x] Procedural or CC0 SFX: place, break, jump, harvest, craft, footsteps, UI click
- [x] Toggle mute in pause menu
- [ ] Keep / extend floating text + particles; maybe brief screen shake on break

### 2.5 UX & input

- [x] Touch / mobile: on-screen move + jump + punch / place (Godot touch buttons)
- [x] Mouse scroll to change hotbar; click hotbar slots (+ touch ◀/▶)
- [ ] Clearer pause menu labels and “unsaved changes” hint after edits

### 2.6 Save / settings polish

- [ ] Multiple save slots or named worlds
- [ ] Settings: window mode, volume, show FPS
- [ ] Version field in save JSON for future migrations

### 2.7 Art pass (original only)

- [ ] Replace solid-color rects with simple original pixel sprites (CC0 or self-made)
- [ ] Distinct icons for hotbar items
- [ ] **Never** copy Growtopia or other commercial UI / logos / assets


### 2.8 Weather / day-cycle

Lighting and atmosphere for Phase 2. **Sun only** as the primary light source — do **not** add moon or stars as light sources (they may appear as decorative sky art later, but they must not illuminate the world).

- [x] **Day periods (sun-driven):** Morning, Noon/Day, Afternoon/Evening, Night — each changes sky tint, ambient brightness, and how far the sun lights the scene
- [x] **Atmospheric presets (weather moods):** Aurora, City/Overcast (tengah kota), plus Clear — color wash without non-sun light sources
- [x] **Weather machine (in-world):** Placeable console (craftable) — punch/use opens UI; Morning/Noon/Afternoon/Night + Clear/Aurora/City
- [x] Optional auto cycle: slow Morning → Night progression when the machine is set to “auto”; manual overrides always win until reset
- [x] Torch and other local lights still work at night; global fill light remains sun-based only (CanvasModulate)
- [x] Persist current weather / period in save JSON (version 2 field)


### 2.9 Characters (avatar)

Pixel-art 2D player avatar in a **Growtopia-like feel** (small body, simple face) — **original art only**, never Growtopia assets, logos, or copied sprites.

- [x] Replace the Phase 1 solid-color player rect with a small **customizable** character: skin color, hair, clothes, accessories
- [x] Walk / jump / face direction in the Pixeltopia world using existing Phase 1 controls
- [x] Simple character customize UI (from pause) that saves with the world save JSON
- [x] Hotbar / inventory icons can preview the equipped look without breaking Phase 1 item rules


### 2.10 UI / UX (sandbox-friendly)

UI/UX should **feel similar to Growtopia-style sandboxes** (bright colors, pixel icons, newbie-friendly layout) while staying **original** — no copied Growtopia HUD, fonts, or branding.

- [x] **Hotbar** anchored along the **bottom** of the screen (keep Phase 1 slots; selection highlight + touch scroll)
- [x] **Inventory / backpack** panel that opens/closes (B); click-to-swap items to/from hotbar
- [x] **Simple action buttons** (especially for touch): jump, punch/break, place/plant — clear labels/icons
- [x] **Pause / resume** menu polish (Esc): Resume, Craft, Save, Load, Mute, Customize Avatar
- [x] Overall look: bright palette, large tap targets, short tooltips for new players
- [ ] Connection-free single-player: no fake multiplayer chrome; focus on clarity of build/farm actions



### 2.11 Multiplayer (planning / Phase 3 prep)

Godot can do multiplayer, but a **Growtopia-scale ~100+ players per world** is **not** a realistic Phase 2 target on stock high-level ENet alone. Treat this section as **plan + prep**; live netcode stays Phase 3+ unless scoped as a tiny friends spike.

#### Realistic capacity (honest)

| Setup | Comfortable players / instance | Notes |
|--------|----------------------------------|--------|
| Godot **host-and-play** (listen server) | ~4–8 friends | Host PC does sim + render; NAT/UDP pain; fine for LAN / Discord nights |
| Godot **dedicated** headless + **ENet** HLAPI | ~8–32 typical for active sandbox | API allows up to 4095 clients; real limit is CPU, bandwidth, replication chatter |
| Optimized Godot dedicated (interest mgmt, sparse tile deltas) | maybe ~32–64 | Needs careful design; still far from MMO density |
| Custom **authoritative** Node/Go server + thin clients (Pixel Sandbox style) | tens–100+ *if* worlds are sharded | Better path toward Growtopia-like density; Godot or web client is “dumb” view |

Community stress notes: bare ENet connection storms can fail in the high hundreds–low thousands; gameplay with positions/inventory often drops usable load to **~tens–low hundreds** before quality collapses. Growtopia’s ~100+/world uses a **custom** stack, not “drop-in Godot multiplayer.”

#### ENet vs WebSocket

- **ENet (UDP):** Godot’s default `ENetMultiplayerPeer`. Low latency, good for native desktop/mobile. **Not** usable from browsers. Hosting needs open UDP.
- **WebSocket (TCP):** `WebSocketMultiplayerPeer` or a custom WS protocol (as in Pixel Sandbox → Render). Works for **web + Capacitor WebView**, easier through firewalls/HTTPS proxies, higher overhead / head-of-line blocking.
- **Practice:** native Godot builds → prefer ENet; web/APK-WebView → WebSocket (or native plugin). Same game logic can share message schemas either way.

#### Dedicated vs host-and-play

- **Host-and-play:** fastest to demo (“Create world” / “Join IP”). Bad for economy/anti-cheat; host can quit and dissolve the world.
- **Dedicated server:** required for persistent worlds, fair trade/gems, and public play. Export Godot `--headless` / dedicated_server feature **or** keep a separate Node/Go authority (closer to Pixel Sandbox).

#### Technical steps (when we leave single-player)

1. Freeze tile / item / inventory IDs as JSON-serializable ints (already mostly true).
2. Decide authority: **server owns** place/break, inventory, craft, trade — clients send *intent*.
3. Pick transport: ENet for Godot-native spike; WebSocket if targeting web/Capacitor parity with Pixel Sandbox.
4. Replicate sparsely: player transforms + **tile deltas**, not full 64×40 every tick; AOI / per-world rooms.
5. Rate-limit punch/place/chat; reject impossible reaches; never trust client gem/inventory counts.
6. Persist worlds in SQLite/Postgres; one process per shard or many worlds per process with caps.
7. Stress-test with bots before promising “100 players.”

**Phase 2 action:** document only + keep save formats migration-friendly. **No sockets in Phase 2 gameplay** unless an explicit LAN spike is requested.

### 2.12 APK analysis — Pixel Sandbox (reference, not a clone)

Analyzed Capacitor APK `75946c9a…apk` (~3.8 MB) and extracted web client under `/workspace/pixel-sandbox-client/`. Package identity: **Pixel Sandbox** (`com.pixelsandbox.game` style Capacitor shell). **Not** affiliated with Growtopia; use as a **feature/architecture reference** for Pixeltopia — keep original name/UI/art.

#### APK structure (findings)

- **Shell:** Capacitor Android — `classes*.dex`, `AndroidManifest.xml`, `assets/capacitor.config.json`, `native-bridge.js`
- **Game client:** `assets/public/` — `index.html`, `config.js`, `shared.js`, `game.js` (~960 lines), `sound.js`, `icons.js`, `style.css`, `fonts/PixelifySans.ttf`, `img/player.png`
- **Server:** **not** in the APK. Client connects via WebSocket to `https://pixel-sandbox-i1fv.onrender.com` → `wss://…`
- **Shared schema:** `shared.js` dual-use (browser + Node): TILE 32, world ~100×60, blocks/seeds, splice table, cosmetics slots, shop/gems, world lock, physics constants

#### Feature surface (client-visible)

Auth (register/login/token), named worlds + world locks, punch/place, farming/seeds/splice, platformer sync, hotbar/touch, inventory, gems/shop, cosmetics, friends/PM, **trade**, chat, procedural pixel draw + WebAudio.

#### Gaps vs Pixeltopia (Godot Phase 1/2)

| Area | Pixel Sandbox (APK) | Pixeltopia now |
|------|---------------------|----------------|
| Engine | Canvas + WS in WebView | Godot 4.3 native 2D |
| Multiplayer | Online (hosted Node) | Single-player only |
| Economy | Gems, shop, trade | Local craft only |
| Social | Friends, PM, chat | None |
| World | ~100×60, locks, many item IDs | 64×40, few tiles + 2 crops |
| Persistence | Server DB | `user://` JSON save |
| Mobile UX | Touchpad / Capacitor | Keyboard+mouse (touch planned) |
| Branding | Pixel Sandbox original | Pixeltopia original — keep it that way |

#### Recommendations for Pixeltopia

1. **Keep Godot** for Phase 2 content (craft/weather/avatar/UI) — already ahead on local sandbox feel.
2. **Do not** port Pixel Sandbox UI/assets verbatim; steal *systems ideas* (authoritative place/break, splice-like recipes, world rooms) with original presentation.
3. For future online: either (A) Godot dedicated + ENet for small friend worlds, or (B) Node/Go authority + Godot/WebSocket client if aiming closer to APK scale — option B matches the APK’s real architecture.
4. If reusing any Pixel Sandbox *code* you own, vendor it under clear license; never ship Growtopia assets.
5. Next Pixeltopia tickets stay offline: SFX, touch, weather machine, avatar, backpack UI — then multiplayer prep docs → Phase 3 spike.




### 2.13 Final APK build (Godot Android export)

Ship an **original** Pixeltopia Android `.apk` only after Phase 2 content is feature-complete enough to feel like a sandbox slice — **not** a Growtopia clone APK. Branding, icons, package name, and store copy must be **Pixeltopia** (or another original name), never Growtopia assets/logos/UI chrome.

#### Feature-complete gate (before export)

Do **not** cut a release APK until most of these are true:

- [x] Craft UI + recipes (done)
- [x] Extra tile + second crop (Sand, Azureoot — done)
- [x] Weather machine + sun-only day periods (Morning/Noon/Afternoon/Night) + moods (Aurora, City/Overcast)
- [x] Customizable pixel avatar (skin/hair/clothes/accessories) walking in-world
- [x] Growtopia-*like* but **original** UI/UX: bottom hotbar polish, backpack, simple action buttons, pause menu
- [x] Audio juice (place/break/harvest/craft/footsteps/UI) + mute
- [x] Stable single-slot save with version field (v3: weather + avatar); multi-slot later
- [x] Touch controls usable on a phone (or documented “desktop-first” if APK is internal-only)
- [x] Headless smoke OK; on-device smoke pending after sideload of `export/Pixeltopia.apk`

Internal debug APKs for testers are OK earlier; **Play-ready** waits for the gate.

#### Android export template & project setup

1. Install matching **Android export templates** for Godot 4.3+ (Project → Export → Manage Export Templates).
2. Install Android SDK / NDK / JDK as Godot docs require; set paths in Editor Settings → Export → Android.
3. Add export preset **Android**: package `com.pixelsandbox…` is *wrong* — use something like `com.<yourname>.pixeltopia` (original).
4. App name / icon / splash: original Pixeltopia art only (replace default `icon.svg` with a proper adaptive icon).
5. Permissions: start minimal (Internet only if/when multiplayer exists; Phase 2 single-player needs none for core play).
6. Orientations: landscape recommended for sandbox hotbar; test portrait separately if you support it.

#### Keystore / signing

- Create a **release keystore** once (`keytool -genkeypair …`); store password + `.jks` **off-repo** (never commit to GitHub).
- Debug builds can use Godot’s debug keystore; Play uploads need the release key.
- Back up keystore + passwords; losing them blocks updates under the same Play listing.
- Prefer separate debug vs release presets in the export dialog.

#### Release checklist

1. Gate above mostly green; bump `config/version` in `project.godot` / Android versionCode.
2. Export **AAB** for Play (preferred) or APK for sideload/testers.
3. Install on a real device; verify craft, planting, pause save/load, UI tap targets.
4. Confirm no third-party game names/assets in UI strings or store listing.
5. Privacy policy / content rating if publishing publicly.
6. Tag git release (`v0.2.0-phase2`) matching the binary.
7. Multiplayer online services are **out of scope** for this APK unless Phase 3 is explicitly in that build.

### Build artifact (this repo)

- Debug APK path (local, gitignored): `export/Pixeltopia.apk` (~46 MB), package `com.pixeltopia.game`, Godot 4.3 template, debug-signed.
- See `export/README.md` for rebuild steps. Play-ready AAB/release keystore still optional.

#### Notes

- Capacitor/WebView (Pixel Sandbox APK style) is a different pipeline; Pixeltopia’s path is **native Godot Android export**.
- Do not ship against Growtopia servers, trademarks, or copied UI.


### 2.14 Growtopia reference (mechanics only — original art/UI)

Public research only (no account login). Official site `growtopia.com` returned **HTTP 500** at research time; `growtopiagame.com` (official) loaded successfully for marketing/feature copy; primary mechanic sources: [Growtopia Wiki](https://growtopia.fandom.com/wiki/Growtopia), Concepts, Seed/World Lock/Gems/Weather Machine pages, and publisher description mirrored on the wiki. **Do not** copy Growtopia assets, fonts, logos, item names, or HUD layouts into Pixeltopia.

#### What Growtopia is

| | |
|--|--|
| **Genre** | 2D creative sandbox platformer **MMO** (open worlds, adventure/social) |
| **Mode** | Online multiplayer; free-to-play with gem currency |
| **Platforms** | Android, iOS, Windows, Mac (consoles discontinued); Steam later |
| **Publisher** | Originally Robinson/Hamumu; Ubisoft since 2017 |

#### Core mechanics (public description)

- Punch/break and place blocks; platformer movement across tile worlds
- **Seeds → trees → harvest**; heart of the loop is collecting seeds, growing, harvesting
- **Splicing:** plant/combine two compatible seeds to create a new tree/item (third seed rejected)
- **World Lock:** claim/protect a whole world; access lists, kick/ban, public build modes, etc.
- **Gems:** currency from breaking/harvesting (and IAP); store purchases (e.g. locks, packs)
- Travel between named worlds; chat / messaging; thousands of items; mobile-first UI
- **Weather Machines:** placeable devices that change a world’s **background / atmosphere** (Sunny, Night, Rainy City, Aurora-like themes, etc.) — often tied to lock access
- Avatars wear layered cosmetics (clothing / accessories); social identity matters

#### Visual / UI (observe, don’t copy)

- Bright colorful **pixel** worlds; small character with simple face
- Bottom inventory / hotbar-style selection; wrench/world UI for locks & devices
- Newbie-friendly large controls; heavy item iconography

#### What Pixeltopia may adopt (**mechanics / feel only**)

| Growtopia idea | Pixeltopia approach (original) |
|----------------|--------------------------------|
| Break/place + farm loop | Already Phase 1 (Groveberry); Azureoot expands crops |
| Seed combining / recipes | Local **craft UI** now; optional later “splice-like” recipes with original items |
| Weather machine | Phase 2 §2.8 — sun-only lighting + moods (Aurora, City/Overcast); original device UI |
| Small customizable avatar | Phase 2 §2.9 — original pixel layers |
| Bottom hotbar + backpack | Phase 2 §2.10 — original layout/colors/icons |
| Named worlds + locks | Phase 3+ (needs server); single-player “world save slots” first |
| Gems / trade / chat | Phase 3+; not required for Phase 2 fun |
| ~100 players / world | See §2.11 — not Phase 2; custom server later |

#### Gaps vs current Phase 2 plan

| Growtopia pillar | In PHASE2 plan? | Status |
|------------------|-----------------|--------|
| Sandbox break/place | Yes (baseline) | Done |
| Farming / multiple crops | Yes §2.1 | Partial (2 crops) |
| Craft / combine | Yes §2.2 | Done (craft; not full splice graph) |
| Weather machine | Yes §2.8 | Done |
| Avatar cosmetics | Yes §2.9 | Done |
| Bottom hotbar / backpack UI | Yes §2.10 | Done |
| Audio / touch / save slots | Yes §2.4–2.6 | Audio+touch done; multi-slot later |
| Online worlds, locks, gems, trade, chat | Explicitly later / §2.11 | Not Phase 2 |
| Exact Growtopia UI/branding | **Forbidden** | Never |

**Login note:** No Growtopia account session was used; official homepage fetch failed (500). Wiki + public pages were enough for mechanics reference.


## Explicitly later (not Phase 2 gameplay)

| Topic | Note |
|--------|------|
| Multiplayer / WebSocket server | Phase 3+ |
| Accounts, chat, trade, gems economy | Phase 3+ |
| Authoritative anti-cheat | Needs server |
| Play Store packaging | After §2.13 feature gate + signing |

### Multiplayer prep only (optional, no live netcode)

- Keep world / inventory / tile IDs in `shared`-friendly shapes (ints, JSON-serializable)
- Avoid baking cheats into client-only economy logic
- Document message ideas in a future `PHASE3.md` — do not implement sockets in Phase 2 unless scoped as a spike

## Out of scope / constraints

- No “sama persis” clone of any commercial game’s UI or branding
- No breaking Phase 1 controls or save format without a migration path
- Prefer Godot 4.3+; stay free/CC0 for assets

## Success criteria

Phase 2 is “done enough” when a player can: explore a slightly richer world, craft at least a few items through a UI, hear feedback, optionally use touch controls, change lighting via the weather machine (sun-only day periods + moods), customize a small pixel avatar, use a bottom hotbar + backpack UI, and save/load without losing Phase 1 behavior.

## Suggested first tickets

1. [x] Craft UI + recipes (Plank, Torch from Wood)
2. [x] One new tile (Sand) + one new crop (Azureoot)
3. [x] Place/break/harvest SFX + mute toggle
4. [x] Touch controls prototype
5. [x] Weather machine + sun-only Morning/Noon/Afternoon/Night + Aurora & City/Overcast presets
6. [x] Character customize (skin/hair/clothes/accessories) + walk in world
7. [x] Bottom hotbar polish + backpack inventory + simple action buttons / pause UI
8. [x] Final Android APK export (§2.13) — debug APK built locally under `export/Pixeltopia.apk`



## v0.4.0 gameplay slice (post Phase 2)

- Item catalog with rarity + ground drops (Q/G to drop, walk-over pickup)
- Mira the Merchant: buy/sell with gems
- Quill the Guide: accept/complete/claim simple quests
- Save format version **4** (gems, drops, quests, world_seed)
