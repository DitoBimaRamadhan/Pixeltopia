# Membuat ikon launcher Android (pixel art orisinal: blok rumput + beliung) dengan Pillow.
# Jalankan: python3 tools/make-icons.py  (setelah `npx cap add android`)
from PIL import Image, ImageDraw
import os
RES = os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res')
G = 16  # grid pixel art 16x16

def art():
    im = Image.new('RGBA', (G, G), (0, 0, 0, 0)); d = im.load()
    for y in range(7, 15):
        for x in range(2, 14):
            d[x, y] = (76, 175, 63, 255) if y < 9 else ((138, 90, 43, 255) if (x * 7 + y * 3) % 5 else (107, 67, 30, 255))
    for i in range(7):  # gagang
        d[4 + i, 12 - i] = (176, 122, 62, 255)
    for x, y in [(8, 2), (9, 2), (10, 2), (11, 3), (12, 4), (13, 5), (13, 6), (7, 3), (12, 7)]:  # kepala beliung
        d[x, y] = (200, 205, 215, 255)
    return im

def put(name, size, pad, bg):
    a = art().resize((int(size * (1 - 2 * pad)),) * 2, Image.NEAREST)
    im = Image.new('RGBA', (size, size), bg)
    im.alpha_composite(a, ((size - a.width) // 2, (size - a.height) // 2))
    return im

dens = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for k, s in dens.items():
    d = os.path.join(RES, 'mipmap-' + k)
    put('', int(48 * s), 0.1, (14, 16, 32, 255)).save(os.path.join(d, 'ic_launcher.png'))
    r = put('', int(48 * s), 0.12, (14, 16, 32, 255))
    m = Image.new('L', r.size, 0); ImageDraw.Draw(m).ellipse((0, 0, r.width - 1, r.height - 1), fill=255)
    r.putalpha(m); r.save(os.path.join(d, 'ic_launcher_round.png'))
    put('', int(108 * s), 0.25, (0, 0, 0, 0)).save(os.path.join(d, 'ic_launcher_foreground.png'))
bgx = os.path.join(RES, 'values', 'ic_launcher_background.xml')
open(bgx, 'w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0E1020</color>\n</resources>\n')
print('icons ok')

# Splash screen: ganti logo bawaan dengan latar gelap + ikon.
import glob
for f in glob.glob(os.path.join(RES, 'drawable*', 'splash.png')):
    w, h = Image.open(f).size
    s = min(w, h) // 3
    im = Image.new('RGBA', (w, h), (14, 16, 32, 255))
    a = art().resize((s, s), Image.NEAREST)
    im.alpha_composite(a, ((w - s) // 2, (h - s) // 2))
    im.convert('RGB').save(f)
print('splash ok')
