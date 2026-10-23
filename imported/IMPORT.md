# Imported legacy sources

This folder holds useful content merged from related repos owned by
[DitoBimaRamadhan](https://github.com/DitoBimaRamadhan), so the main
**Pixeltopia** (Godot 4) game stays the single active project.

## Sources

| Source repo | Status when imported | Destination | Notes |
|---|---|---|---|
| [pixel-sandbox](https://github.com/DitoBimaRamadhan/pixel-sandbox) (private) | Node.js + HTML5 Canvas + Capacitor Android multiplayer sandbox | `imported/pixel-sandbox/` | Different stack from Godot Pixeltopia. Kept as architecture / feature reference (auth, worlds, trade, shop, splice, World Lock). **Do not** overwrite Godot `scenes/` or `scripts/` with this JS client. |

## What was NOT merged into the live Godot game

- No JS/Canvas files were copied into `scenes/`, `scripts/`, or `assets/`.
- Capacitor `android/` shell is archived here only; Pixeltopia ships via **Godot Android export** (`export/`).
- Server (`server/*.js`) is reference for a future dedicated multiplayer authority (see `PHASE2.md` § multiplayer).

## How to use this archive

- Read `imported/pixel-sandbox/README.md` for feature list and chat commands.
- Client: `imported/pixel-sandbox/public/`
- Server: `imported/pixel-sandbox/server/`
- Tests: `imported/pixel-sandbox/test/`
- Android Capacitor shell: `imported/pixel-sandbox/android/`

After this import, the duplicate `pixel-sandbox` GitHub repo is archived/deleted
to keep the account tidy. History lives in git of that repo until deletion and
in this tree forever.
