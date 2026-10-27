#!/usr/bin/env python3
"""Generate Pixeltopia's original 16x16 pixel-art tile atlas (assets/sprites/tiles.png).

Every sprite is drawn procedurally here (no third-party art), so the output is original work
released with the game. Cell index == tile id; 16 columns. Run: python3 tools/art/gen_tiles.py
"""
import json, os, random
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
S = 16
COLS = 16
content = json.load(open(os.path.join(ROOT, 'server/lib/content.json')))

def hx(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)

def shade(c, f):
    return tuple(max(0, min(255, int(v * f))) for v in c[:3]) + (c[3] if len(c) > 3 else 255,)

def mix(a, b, t):
    return tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3)) + (255,)

class Cell:
    def __init__(self, seed):
        self.im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); self.px = self.im.load(); self.r = random.Random(seed)
    def put(self, x, y, c):
        if 0 <= x < S and 0 <= y < S: self.px[x, y] = c
    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1): self.put(x, y, c)
    def noise_fill(self, base, amt=0.12, x0=0, y0=0, x1=S - 1, y1=S - 1):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1): self.put(x, y, shade(base, 1 + self.r.uniform(-amt, amt)))
    def bevel(self, base, x0=0, y0=0, x1=S - 1, y1=S - 1):
        for x in range(x0, x1 + 1): self.put(x, y0, shade(base, 1.25)); self.put(x, y1, shade(base, 0.62))
        for y in range(y0, y1 + 1): self.put(x0, y, shade(base, 1.15)); self.put(x1, y, shade(base, 0.7))
    def circle(self, cx, cy, rad, c):
        for y in range(S):
            for x in range(S):
                if (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad: self.put(x, y, c)

def block(c, base, style='plain'):
    c.noise_fill(base)
    if style == 'brick':
        mortar = shade(base, 0.55)
        for y in range(0, S, 4):
            c.rect(0, y, S - 1, y, mortar)
            off = 0 if (y // 4) % 2 == 0 else 4
            for x in range(off, S, 8): c.rect(x, y, x, y + 3, mortar)
    elif style == 'stonebrick':
        mortar = shade(base, 0.6)
        c.rect(0, 7, S - 1, 7, mortar); c.rect(0, 15, S - 1, 15, mortar)
        c.rect(7, 0, 7, 7, mortar); c.rect(3, 8, 3, 15, mortar); c.rect(11, 8, 11, 15, mortar)
    elif style == 'wool':
        for y in range(S):
            for x in range(S):
                if (x + y) % 4 == 0: c.put(x, y, shade(base, 0.88))
    elif style == 'ore':
        for _ in range(5):
            x, y = c.r.randrange(2, 14), c.r.randrange(2, 14)
            c.rect(x, y, x + 1, y + 1, shade(base, 1.45))
    elif style == 'crystal':
        for i in range(S):
            c.put(i, i, shade(base, 1.5)); c.put(S - 1 - i, i, shade(base, 1.3))
    elif style == 'leaves':
        for _ in range(26):
            x, y = c.r.randrange(S), c.r.randrange(S)
            c.put(x, y, shade(base, c.r.choice([0.7, 1.3])))
        for _ in range(3):
            c.put(c.r.randrange(S), c.r.randrange(S), (0, 0, 0, 0))
    elif style == 'books':
        c.rect(0, 0, S - 1, S - 1, shade(base, 0.8)); c.rect(0, 7, S - 1, 8, shade(base, 0.6))
        cols = [(170, 50, 50, 255), (50, 90, 170, 255), (60, 140, 70, 255), (200, 170, 60, 255)]
        for shelf in (1, 10):
            x = 1
            while x < 15:
                w = c.r.choice([1, 2]); col = c.r.choice(cols)
                c.rect(x, shelf, min(14, x + w - 1), shelf + 4 + c.r.randrange(0, 2), col); x += w + 1
    elif style == 'moss':
        for _ in range(30):
            c.put(c.r.randrange(S), c.r.randrange(8), (80, 140, 60, 255))
    elif style == 'metal':
        for p in ((2, 2), (13, 2), (2, 13), (13, 13)): c.put(*p, shade(base, 1.5))
        c.rect(0, 7, S - 1, 8, shade(base, 0.85))
    elif style == 'ice':
        for i in range(4, 12): c.put(i, i - 2, (240, 250, 255, 255)); c.put(i + 1, i - 2, (220, 240, 255, 255))
    c.bevel(base)

def glass(c, base, alpha=110):
    tint = base[:3] + (alpha,)
    c.rect(1, 1, S - 2, S - 2, tint)
    for i in range(3, 8): c.put(i, 10 - i, (255, 255, 255, 200))
    frame = shade(base, 0.6)
    c.rect(0, 0, S - 1, 0, frame); c.rect(0, S - 1, S - 1, S - 1, frame)
    c.rect(0, 0, 0, S - 1, frame); c.rect(S - 1, 0, S - 1, S - 1, frame)

def door(c, base):
    c.noise_fill(base, 0.08, 2, 0, 13, 15)
    c.bevel(base, 2, 0, 13, 15)
    c.rect(4, 2, 11, 6, shade(base, 0.8)); c.rect(4, 9, 11, 13, shade(base, 0.8))
    c.rect(11, 8, 12, 8, (230, 200, 80, 255))

def platform(c, base):
    c.noise_fill(base, 0.1, 0, 0, 15, 3); c.rect(0, 3, 15, 3, shade(base, 0.6)); c.rect(0, 0, 15, 0, shade(base, 1.25))
    for x in (2, 13): c.rect(x, 4, x, 6, shade(base, 0.55))

def wall(c, base, style):
    dark = shade(base, 0.72)
    c.noise_fill(dark, 0.08)
    if style == 'wood':
        for x in (0, 4, 8, 12): c.rect(x, 0, x, 15, shade(dark, 0.7))
    elif style == 'brick':
        for y in range(0, S, 4):
            c.rect(0, y, 15, y, shade(dark, 0.7)); off = 0 if (y // 4) % 2 == 0 else 4
            for x in range(off, S, 8): c.rect(x, y, x, y + 3, shade(dark, 0.7))
    elif style == 'stone':
        for _ in range(8): c.put(c.r.randrange(S), c.r.randrange(S), shade(dark, 0.75))
    else:
        for y in range(S):
            for x in range(0, S, 4): c.put(x + (y // 4) % 2 * 2, y, shade(dark, 1.15))

def light(c, base, style):
    if style == 'lantern':
        c.rect(7, 0, 8, 2, (60, 60, 60, 255)); c.rect(4, 3, 11, 13, (50, 45, 40, 255)); c.rect(5, 4, 10, 12, base)
        c.rect(6, 6, 9, 10, (255, 250, 210, 255)); c.rect(4, 14, 11, 14, (40, 35, 30, 255))
    elif style == 'candle':
        c.rect(6, 7, 9, 14, (240, 235, 220, 255)); c.rect(5, 15, 10, 15, (120, 90, 60, 255))
        c.rect(7, 4, 8, 6, base); c.put(7, 3, (255, 240, 180, 255))
    else:  # neon tube
        c.rect(1, 6, 14, 9, shade(base, 0.6)); c.rect(2, 7, 13, 8, base); c.rect(3, 7, 12, 7, (255, 255, 255, 255))

def deco(c, base, key):
    if key == 'SIGN':
        c.rect(7, 9, 8, 15, (110, 75, 40, 255)); c.noise_fill(base, 0.06, 1, 2, 14, 9); c.bevel(base, 1, 2, 14, 9)
        for x in range(3, 13, 2): c.put(x, 5, shade(base, 0.5))
        for x in range(3, 10, 2): c.put(x, 7, shade(base, 0.5))
    elif key.startswith('FLOWER'):
        c.rect(7, 8, 8, 15, (60, 140, 60, 255)); c.put(6, 11, (70, 160, 70, 255)); c.put(9, 12, (70, 160, 70, 255))
        for dx, dy in ((0, -2), (0, 2), (-2, 0), (2, 0)): c.circle(7.5 + dx, 5.5 + dy, 1.6, base)
        c.circle(7.5, 5.5, 1.2, (250, 220, 80, 255))
    elif key == 'FENCE':
        for x in (2, 12): c.rect(x, 3, x + 1, 15, base)
        c.rect(0, 6, 15, 7, shade(base, 0.9)); c.rect(0, 11, 15, 12, shade(base, 0.9))
    elif key == 'CHAIR':
        c.rect(3, 1, 4, 15, base); c.rect(3, 9, 12, 10, shade(base, 1.1)); c.rect(11, 10, 12, 15, base)
    elif key == 'TABLE':
        c.rect(0, 5, 15, 7, shade(base, 1.1)); c.rect(1, 8, 2, 15, base); c.rect(13, 8, 14, 15, base)
    elif key == 'CHEST':
        c.noise_fill(base, 0.08, 1, 4, 14, 15); c.bevel(base, 1, 4, 14, 15); c.rect(1, 8, 14, 8, shade(base, 0.5))
        c.rect(7, 7, 8, 10, (230, 200, 80, 255))
    else:
        c.circle(7.5, 7.5, 5, base)

def seed(c, base):
    c.rect(7, 9, 8, 15, (60, 130, 50, 255)); c.put(6, 10, (80, 160, 60, 255)); c.put(9, 11, (80, 160, 60, 255))
    c.circle(7.5, 7, 2.6, base); c.put(7, 6, shade(base, 1.4))

def crop(c, base):
    c.rect(7, 7, 8, 15, (50, 120, 45, 255)); c.rect(4, 10, 6, 11, (70, 150, 60, 255)); c.rect(9, 9, 11, 10, (70, 150, 60, 255))
    c.circle(7.5, 5, 4.2, base); c.circle(6.5, 3.5, 1.3, shade(base, 1.45))

def base_tiles():
    out = {}
    def mk(i):
        c = Cell(1000 + i); out[i] = c; return c
    dirt = (134, 94, 60, 255); grass = (86, 170, 70, 255); stone = (130, 130, 140, 255)
    c = mk(1); block(c, dirt); [c.put(c.r.randrange(S), c.r.randrange(S), shade(dirt, 0.7)) for _ in range(10)]
    c = mk(2); block(c, dirt); c.noise_fill(grass, 0.12, 0, 0, 15, 3)
    for x in range(S):
        if c.r.random() < 0.5: c.put(x, 4, shade(grass, 0.8))
    c = mk(3); block(c, stone, 'ore')
    c = mk(4); seed(c, (190, 150, 90, 255))
    c = mk(5); crop(c, (240, 100, 150, 255))
    c = mk(6); wood = (122, 82, 48, 255); c.noise_fill(wood, 0.08)
    for x in (3, 8, 12): c.rect(x, 0, x, 15, shade(wood, 0.72))
    c.bevel(wood)
    c = mk(7); light(c, (255, 170, 60, 255), 'candle'); c.rect(6, 7, 9, 14, (110, 75, 40, 255))
    c = mk(8); plank = (196, 150, 96, 255); c.noise_fill(plank, 0.06)
    for y in (3, 7, 11, 15): c.rect(0, y, 15, y, shade(plank, 0.7))
    c.bevel(plank)
    c = mk(9); sand = (222, 205, 140, 255); block(c, sand); [c.put(c.r.randrange(S), c.r.randrange(S), shade(sand, 0.85)) for _ in range(12)]
    c = mk(10); seed(c, (90, 140, 240, 255))
    c = mk(11); crop(c, (100, 140, 255, 255))
    c = mk(12); c.rect(1, 3, 14, 15, (60, 85, 125, 255)); c.rect(3, 5, 12, 10, (100, 190, 255, 255)); c.circle(7.5, 7.5, 2, (255, 230, 90, 255)); c.rect(4, 12, 11, 13, (180, 190, 210, 255))
    c = mk(13); c.rect(3, 4, 12, 15, (150, 120, 70, 255)); c.rect(3, 4, 12, 5, (110, 85, 50, 255)); c.rect(6, 8, 9, 11, (120, 200, 80, 255))
    c = mk(14); seed(c, (240, 110, 50, 255))
    c = mk(15); crop(c, (255, 120, 40, 255))
    c = mk(16); seed(c, (200, 200, 245, 255))
    c = mk(17); crop(c, (210, 215, 255, 255))
    c = mk(18); seed(c, (120, 240, 230, 255))
    c = mk(19); crop(c, (110, 240, 230, 255)); c.put(7, 2, (255, 255, 255, 255))
    c = mk(20); gold = (250, 210, 60, 255); c.rect(2, 2, 13, 13, gold); c.bevel(gold, 2, 2, 13, 13); c.circle(7.5, 7.5, 2.5, (140, 90, 30, 255)); c.rect(7, 8, 8, 11, (140, 90, 30, 255))
    return out

def content_tiles():
    out = {}
    for d in content['tiles']:
        c = Cell(d['id'] * 7919); base = hx(d['color']); k = d['kind']; key = d['key']
        if k == 'block':
            style = {'BRICK': 'brick', 'STONE_BRICK': 'stonebrick', 'MOSSY_STONE': 'moss', 'METAL': 'metal', 'GOLD_BLOCK': 'ore',
                     'CRYSTAL_BLOCK': 'crystal', 'LEAVES': 'leaves', 'BOOKSHELF': 'books', 'ICE': 'ice', 'OBSIDIAN': 'ore',
                     'MARBLE': 'crystal'}.get(key, 'wool' if key.startswith('WOOL') else 'plain')
            block(c, base, style)
            if key == 'MOSSY_STONE': c.bevel(base)
        elif k == 'glass': glass(c, base, 150 if key == 'TINTED_GLASS' else 90)
        elif k == 'door': door(c, base)
        elif k == 'platform': platform(c, base)
        elif k == 'wall': wall(c, base, {'WALL_WOOD': 'wood', 'WALL_BRICK': 'brick', 'WALL_STONE': 'stone'}.get(key, 'paper'))
        elif k == 'light': light(c, base, 'lantern' if key == 'LANTERN' else 'candle' if key == 'CANDLE' else 'neon')
        elif k == 'seed': seed(c, base)
        elif k == 'crop': crop(c, base)
        else: deco(c, base, key)
        out[d['id']] = c
    return out

def main():
    cells = {**base_tiles(), **content_tiles()}
    n = max(cells) + 1; rows = (n + COLS - 1) // COLS
    atlas = Image.new('RGBA', (COLS * S, rows * S), (0, 0, 0, 0))
    for i, c in cells.items():
        atlas.paste(c.im, ((i % COLS) * S, (i // COLS) * S))
    path = os.path.join(ROOT, 'assets/sprites/tiles.png'); atlas.save(path, optimize=True)
    atlas.resize((atlas.width * 4, atlas.height * 4), Image.NEAREST).save('/tmp/tiles_preview.png')
    print('wrote', path, atlas.size, len(cells), 'sprites')

if __name__ == '__main__':
    main()
