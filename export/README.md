# Export artifacts

- **`Pixeltopia.apk`** — Godot 4.3 Android **debug** build (version **1.0.0**).
- Pixeltopia Store (buy with gems), farmable break drops, Quill quests, auth + shards, circular UI.
- Release: https://github.com/DitoBimaRamadhan/Pixeltopia/releases/tag/v1.0.0
- Direct APK: https://github.com/DitoBimaRamadhan/Pixeltopia/releases/download/v1.0.0/Pixeltopia.apk

Keystores (`*.keystore`) are gitignored. Rebuild:

```bash
export JAVA_HOME=/workspace/tools/jdk/jdk-17.0.21+9
export PATH="$JAVA_HOME/bin:$PATH"
/workspace/tools/Godot_v4.3-stable_linux.x86_64 --headless --path . \
  --export-debug Android export/Pixeltopia.apk
```
