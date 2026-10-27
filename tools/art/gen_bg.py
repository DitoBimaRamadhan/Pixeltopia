#!/usr/bin/env python3
"""Original parallax backgrounds for Pixeltopia (v1.8): 4 themes x (sky + 3 layers), seamless horizontally.
Procedural pixel art (PIL + numpy), drawn at 480x270 and shown 2x with nearest filtering.
  python3 tools/art/gen_bg.py  -> assets/backgrounds/<theme>_<layer>.png
"""
import os
import numpy as np
from PIL import Image

W, H = 480, 270
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'backgrounds')

def hexc(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

THEMES = {
    'meadow': dict(sky=['#5fa8e8', '#9fd4f7', '#d9f1ff'], far='#7f9fc8', far_hi='#a7c0e0', mid='#5d9e57', mid_hi='#79b96a', near='#3f7f3d', near_hi='#58a04f', deco='tree', sun='#fff4b0', clouds=True),
    'forest': dict(sky=['#3c7f9e', '#7fb9b8', '#cfe8d0'], far='#4f7a6a', far_hi='#6a9682', mid='#2f6a45', mid_hi='#44875a', near='#1f4d33', near_hi='#2f6b44', deco='pine', sun='#f5ffd8', clouds=True),
    'desert': dict(sky=['#e8875a', '#f5b878', '#ffe3a8'], far='#c98a6a', far_hi='#dca382', mid='#d9a35f', mid_hi='#e9bb76', near='#b7793f', near_hi='#cf9152', deco='cactus', sun='#fff0c8', clouds=False),
    'night': dict(sky=['#0d1433', '#1f2c5c', '#3c4a80'], far='#2b3568', far_hi='#3e4a82', mid='#1d2a4f', mid_hi='#2a3a66', near='#121b36', near_hi='#1c2a4c', deco='snowpine', sun='#f2f4ff', clouds=False),
}

def ridge(rng, base, amp, harmonics):
    x = np.arange(W)
    y = np.full(W, float(base))
    for k in harmonics:
        y += amp / k * np.sin(2 * np.pi * k * x / W + rng.uniform(0, 2 * np.pi))
    return y.astype(int)

def layer_img(rng, heights, col, hi, deco=None, deco_col=None, snow=False):
    img = np.zeros((H, W, 4), np.uint8)
    c, h = np.array(hexc(col)), np.array(hexc(hi))
    for x in range(W):
        top = int(np.clip(heights[x], 0, H - 1))
        img[top:, x, :3] = c; img[top:, x, 3] = 255
        img[top:top + 2, x, :3] = h  # rim light
        if snow and top < H - 1:
            img[top:top + 3, x, :3] = (230, 238, 255)
        # dithered shading band
        for y in range(top + 6, H, 1):
            if (x + y) % 4 == 0 and y > top + (H - top) * 0.55:
                img[y, x, :3] = (c * 0.85).astype(np.uint8)
    if deco:
        step = rng.integers(26, 40)
        x0 = int(rng.integers(0, step))
        for x in range(x0, W, int(step)):
            xx = int((x + rng.integers(-8, 8)) % W)
            draw_deco(img, deco, xx, int(heights[xx]), rng, deco_col or hi)
    return Image.fromarray(img, 'RGBA')

def setpx(img, x, y, rgb):
    x %= W
    if 0 <= y < H:
        img[y, x, :3] = rgb; img[y, x, 3] = 255

def draw_deco(img, kind, x, ground, rng, col):
    c = np.array(hexc(col)); dark = (c * 0.7).astype(np.uint8)
    if kind == 'tree':
        hgt = int(rng.integers(10, 18))
        for y in range(ground - hgt, ground): setpx(img, x, y, (92, 64, 40))
        r = int(rng.integers(5, 8))
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy <= r * r + rng.integers(0, 3):
                    setpx(img, x + dx, ground - hgt + dy, c if dy < 0 and dx < 0 else dark)
    elif kind in ('pine', 'snowpine'):
        hgt = int(rng.integers(16, 28))
        for y in range(hgt):
            w = int((y / hgt) * 6) + 1
            for dx in range(-w, w + 1):
                rgb = c if dx < 0 else dark
                if kind == 'snowpine' and y % 6 == 0: rgb = (220, 230, 250)
                setpx(img, x + dx, ground - hgt + y, rgb)
        for y in range(ground - 3, ground): setpx(img, x, y, (70, 50, 35))
    elif kind == 'cactus':
        hgt = int(rng.integers(10, 18))
        g = (74, 140, 72); gd = (52, 108, 54)
        for y in range(ground - hgt, ground):
            setpx(img, x, y, g); setpx(img, x + 1, y, gd)
        ay = ground - hgt // 2
        for dx in (-3, -2, -1): setpx(img, x + dx, ay, g)
        for y in range(ay - 5, ay): setpx(img, x - 3, y, g)
        for dx in (2, 3, 4): setpx(img, x + dx, ay - 3, gd)
        for y in range(ay - 8, ay - 3): setpx(img, x + 4, y, gd)

def sky_img(rng, t):
    cols = [np.array(hexc(c), float) for c in t['sky']]
    img = np.zeros((H, W, 4), np.uint8)
    bands = 18  # banded gradient = pixel-art look
    for y in range(H):
        f = min(bands - 1, int(y / H * bands)) / (bands - 1)
        rgb = cols[0] + (cols[1] - cols[0]) * (f * 2) if f < 0.5 else cols[1] + (cols[2] - cols[1]) * ((f - 0.5) * 2)
        img[y, :, :3] = rgb.astype(np.uint8); img[y, :, 3] = 255
    sx, sy, r = int(W * 0.78), int(H * 0.2), 14
    for dy in range(-r - 6, r + 7):
        for dx in range(-r - 6, r + 7):
            d2 = dx * dx + dy * dy
            if d2 <= r * r:
                img[sy + dy, sx + dx, :3] = hexc(t['sun'])
            elif d2 <= (r + 5) ** 2 and (dx + dy) % 2 == 0:
                img[sy + dy, sx + dx, :3] = ((img[sy + dy, sx + dx, :3].astype(int) + np.array(hexc(t['sun']))) // 2).astype(np.uint8)
    if t is THEMES['night']:
        for _ in range(140):
            x, y = int(rng.integers(0, W)), int(rng.integers(0, int(H * 0.6)))
            b = int(rng.integers(150, 255)); img[y, x, :3] = (b, b, min(255, b + 20))
    return Image.fromarray(img, 'RGBA')

def clouds_img(rng):
    img = np.zeros((H, W, 4), np.uint8)
    for _ in range(9):
        cx, cy = int(rng.integers(0, W)), int(rng.integers(12, 90))
        for _ in range(int(rng.integers(4, 8))):
            ox, oy, r = int(rng.integers(-18, 18)), int(rng.integers(-4, 4)), int(rng.integers(6, 12))
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    if dx * dx + dy * dy * 2 <= r * r:
                        x, y = (cx + ox + dx) % W, cy + oy + dy
                        if 0 <= y < H:
                            shade = 255 if dy < 2 else 228
                            img[y, x] = (shade, shade, 255 if dy < 2 else 240, 235)
    return Image.fromarray(img, 'RGBA')

def main():
    os.makedirs(OUT, exist_ok=True)
    for i, (name, t) in enumerate(THEMES.items()):
        rng = np.random.default_rng(1000 + i)
        sky = sky_img(rng, t)
        if t['clouds']:
            sky = Image.alpha_composite(sky, clouds_img(rng))
        sky.save(os.path.join(OUT, f'{name}_0_sky.png'))
        snow = name == 'night'
        far = layer_img(rng, ridge(rng, 150, 70, [1, 2, 3, 5, 8]), t['far'], t['far_hi'], snow=snow)
        far.save(os.path.join(OUT, f'{name}_1_far.png'))
        mid = layer_img(rng, ridge(rng, 190, 34, [2, 3, 5, 7]), t['mid'], t['mid_hi'], deco=t['deco'])
        mid.save(os.path.join(OUT, f'{name}_2_mid.png'))
        near = layer_img(rng, ridge(rng, 228, 16, [3, 4, 6, 9, 13]), t['near'], t['near_hi'], deco=t['deco'], deco_col=t['near_hi'])
        near.save(os.path.join(OUT, f'{name}_3_near.png'))
    # preview sheet
    prev = Image.new('RGBA', (W * 2, H * 2))
    for i, name in enumerate(THEMES):
        im = Image.open(os.path.join(OUT, f'{name}_0_sky.png'))
        for k in ('1_far', '2_mid', '3_near'):
            im = Image.alpha_composite(im, Image.open(os.path.join(OUT, f'{name}_{k}.png')))
        prev.paste(im, ((i % 2) * W, (i // 2) * H))
    prev.save('/tmp/bg_preview.png')

if __name__ == '__main__':
    main()
