# Konversi sprite karakter upload -> public/img/player.png (grid piksel asli, latar transparan).
# Pakai: python3 tools/make-player-sprite.py SRC.png public/img/player.png
import sys
from collections import Counter, deque
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGBA'); W, H = im.size; px = im.load()
# 1) Hapus latar putih: flood-fill HANYA dari tepi, melewati piksel transparan / putih murni (255,255,255).
#    Putih mata (254,253,253 & abu 229) tidak tersentuh walau menyentuh tepi.
is_bg = lambda p: p[3] < 16 or (p[0] >= 255 and p[1] >= 255 and p[2] >= 255)
seen = set(); dq = deque()
for x in range(W): dq += [(x, 0), (x, H - 1)]
for y in range(H): dq += [(0, y), (W - 1, y)]
while dq:
    x, y = dq.popleft()
    if (x, y) in seen or not (0 <= x < W and 0 <= y < H) or not is_bg(px[x, y]): continue
    seen.add((x, y)); px[x, y] = (0, 0, 0, 0)
    dq += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
# 2) Trim
im = im.crop(im.getbbox()); W, H = im.size; px = im.load()
# 3) Deteksi ukuran blok piksel dari posisi transisi warna (jarak minimum yang konsisten)
def edges(n, diff):
    return [i for i in range(1, n) if diff(i) > 3]
xs = edges(W, lambda x: sum(px[x, y] != px[x - 1, y] for y in range(H)))
ys = edges(H, lambda y: sum(px[x, y] != px[x, y - 1] for x in range(W)))
best = None
for b10 in range(40, 400):  # blok 4.0..40.0 px (boleh pecahan bila sumber di-upscale non-integer)
    b = b10 / 10
    err = sum(min(abs(e / b - round(e / b)), 1) for e in xs + ys) / len(xs + ys)
    if err < 0.08 and (best is None): best = b
b = best or 1
gw, gh = round(W / b), round(H / b)
out = Image.new('RGBA', (gw, gh))
for j in range(gh):
    for i in range(gw):
        x0, x1 = int(i * W / gw), int((i + 1) * W / gw); y0, y1 = int(j * H / gh), int((j + 1) * H / gh)
        m = 1 if x1 - x0 > 4 else 0
        c = Counter(px[x, y] for x in range(x0 + m, x1 - m) for y in range(y0 + m, y1 - m)).most_common(1)[0][0]
        out.putpixel((i, j), c if c[3] >= 128 else (0, 0, 0, 0))
out.save(dst)
print(f'blok={b}px grid={gw}x{gh} dari {W}x{H}')
