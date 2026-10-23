# Pixeltopia Android export

## Sideload APK (this machine)

After a successful local export:

- **APK:** `export/Pixeltopia.apk` (debug-signed, package `com.pixeltopia.game`)
- **Debug keystore:** machine-local (`~/.android/debug.keystore`); not committed

APK / keystore / `export_presets.cfg` are **gitignored**. Copy `export_presets.cfg.example` to `export_presets.cfg` and set SDK/keystore paths on your machine.

## Rebuild (Godot 4.3)

1. Install Godot **4.3** export templates (`android_debug.apk` / `android_release.apk`).
2. JDK 17 + Android SDK (`platform-tools`, `build-tools;34.0.0`, `platforms;android-34`).
3. Editor Settings → Export → Android: Java SDK path, Android SDK path, debug keystore.
4. Enable Project Setting: `rendering/textures/vram_compression/import_etc2_astc` (required).
5. `godot --headless --path . --export-debug "Android" export/Pixeltopia.apk`

Release / Play Store: use a **release** keystore (never commit passwords) and prefer AAB with Gradle build per PHASE2 §2.13.
