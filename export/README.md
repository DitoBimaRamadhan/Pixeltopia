# Export artifacts

- **`Pixeltopia.apk`** — Godot 4.3 Android **debug** build (version **0.5.0**).
- Includes Phase 2 + v0.4 drops/shop/quests, plus legacy Pixel Sandbox import under `imported/` (excluded from the APK pack).
- Release: https://github.com/DitoBimaRamadhan/Pixeltopia/releases/tag/v0.5.0
- Direct APK: https://github.com/DitoBimaRamadhan/Pixeltopia/releases/download/v0.5.0/Pixeltopia.apk

Keystores (`*.keystore`) are gitignored. Rebuild:

```bash
export JAVA_HOME=/workspace/tools/jdk/jdk-17.0.21+9
export PATH="$JAVA_HOME/bin:$PATH"
/workspace/tools/Godot_v4.3-stable_linux.x86_64 --headless --path . \
  --export-debug Android export/Pixeltopia.apk
```
