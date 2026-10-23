# Pixeltopia Android export

Godot **4.3** debug APK (`com.pixeltopia.game`).

## Downloads

- **v0.8.0 (auth + shards):** https://github.com/DitoBimaRamadhan/Pixeltopia/releases/tag/v0.8.0
  - Direct: https://github.com/DitoBimaRamadhan/Pixeltopia/releases/download/v0.8.0/Pixeltopia.apk
- Also on `main`: https://github.com/DitoBimaRamadhan/Pixeltopia/raw/main/export/Pixeltopia.apk

Signed with the standard Android **debug** keystore (not for Play Store).

## Local rebuild

```bash
godot --headless --path . --export-debug "Android" export/Pixeltopia.apk
```

See `server/README.md` and `HOSTING.md` for the Node auth/shard backend.
