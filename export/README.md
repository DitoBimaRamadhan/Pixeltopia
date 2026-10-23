# Pixeltopia Android export

Godot **4.3** debug APK for sideload / testing (`com.pixeltopia.game`, version `0.4.0`).

## Download (preferred)

- **Release:** https://github.com/DitoBimaRamadhan/Pixeltopia/releases/tag/v0.4.0
- **Direct APK asset:** https://github.com/DitoBimaRamadhan/Pixeltopia/releases/download/v0.4.0/Pixeltopia.apk
- Also on `main`: https://github.com/DitoBimaRamadhan/Pixeltopia/raw/main/export/Pixeltopia.apk

Signed with the standard Android **debug** keystore (not for Play Store).

## Local rebuild

After a successful local export:

- **APK:** `export/Pixeltopia.apk`
- **Debug keystore:** machine-local (`~/.android/debug.keystore`); never commit keystores

`export_presets.cfg` and `*.keystore` stay **gitignored**. Copy `export_presets.cfg.example` to `export_presets.cfg` and set SDK/keystore paths on your machine.

Steps:

1. Install Godot **4.3** export templates (`android_debug.apk` / `android_release.apk`).
2. Install Android SDK + JDK 17; point Editor Settings → Export → Android at Java SDK, Android SDK, debug keystore.
3. Copy `export_presets.cfg.example` → `export_presets.cfg` if needed.
4. From project root:

```bash
godot --headless --path . --export-debug "Android" export/Pixeltopia.apk
```

Release / Play Store: use a **release** keystore (never commit passwords) and prefer AAB with Gradle build per PHASE2 §2.13.
