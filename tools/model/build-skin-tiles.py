#!/usr/bin/env python3
"""
Periodic tiles for the base skins that carry a pattern, written to tools/model/source/skin-tiles/
and embedded by build-storey.js into the accent, climb and frame files of those skins.

The pieces get their pattern baked in object space (build-item-variants.py); the storey parts
are boxes with box-mapped UVs in metres, so they take a TILE that repeats: every lattice here is
wrapped modulo the tile, which makes the tile seamless with itself. Same recipes, same colours
as the pieces, so a Lava base is ringed and pillared in the crust its Lava pieces wear.
"""
import io, math, os
from PIL import Image

TEX_OUT = 256
SUPER = 2  # baked at 512, box-filtered to 256: soft crack edges
TEX = TEX_OUT * SUPER
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'source', 'skin-tiles')

def hash2(x, y, seed):
    h = (x * 374761393 + y * 668265263 + seed * 1013904223) & 0xffffffff
    h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
    return ((h ^ (h >> 16)) & 0xffffffff) / 4294967296.0

def clamp(k): return 0.0 if k < 0 else (1.0 if k > 1 else k)

def hsv(h, s, v):
    i = int(h * 6) % 6; f = h * 6 - int(h * 6); p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    r, g, b = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)][i]
    return (int(r * 255), int(g * 255), int(b * 255))

def voronoi2(seed, n):
    """Gap between the two nearest seeds of a jittered n x n lattice wrapped on the tile, in cell units."""
    seeds = {}
    def seed_of(cx, cy):
        k = (cx % n, cy % n)
        if k not in seeds: seeds[k] = (hash2(k[0], k[1], seed), hash2(k[0], k[1], seed + 1))
        return seeds[k]
    def edge(x, y):
        fx, fy = x * n, y * n; ix, iy = math.floor(fx), math.floor(fy)
        d1 = d2 = 1e9
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                jx, jy = seed_of(ix + ox, iy + oy)
                d = (fx - ix - ox - jx) ** 2 + (fy - iy - oy - jy) ** 2
                if d < d1: d2 = d1; d1 = d
                elif d < d2: d2 = d
        return math.sqrt(d2) - math.sqrt(d1)
    return edge

def noise2(x, y, n, seed):
    fx, fy = x * n, y * n; ix, iy = math.floor(fx), math.floor(fy)
    tx, ty = [t * t * (3 - 2 * t) for t in (fx - ix, fy - iy)]
    c = lambda dx, dy: hash2((ix + dx) % n, (iy + dy) % n, seed)
    top = c(0, 0) + (c(1, 0) - c(0, 0)) * tx; bot = c(0, 1) + (c(1, 1) - c(0, 1)) * tx
    return top + (bot - top) * ty

def mottle2(x, y, seed): return 0.75 + 0.5 * (0.6 * noise2(x, y, 3, seed) + 0.4 * noise2(x, y, 12, seed + 1))

def tile(fn, out=TEX_OUT, ss=SUPER):
    n = out * ss
    im = Image.new('RGB', (n, n))
    im.putdata([fn((x + 0.5) / n, (y + 0.5) / n) for y in range(n) for x in range(n)])
    return im if ss == 1 else im.resize((out, out), Image.BOX)

def lava():
    """The pieces' crust, on a tile that does not read as a tile. Same recipe as the pieces (thin
    cracks, ember halo, mottled crust), but plates of unequal size from two crack networks, a
    domain warped by a low noise so no crack runs straight, widths that breathe along a crack,
    and a 3.6 m tile at 512 px so the loop comes four times less often on a kerb (owner, 5 Sep:
    "les veines trop epaisses, on voit que c'est pas pareil que les pieces; ca boucle trop")."""
    edge_a = voronoi2(5, 6); edge_b = voronoi2(51, 11)
    cache = {}
    def crack(x, y):
        key = (x, y)
        if key in cache: return cache[key]
        wx = (x + 0.035 * (noise2(x, y, 3, 31) - 0.5)) % 1.0
        wy = (y + 0.035 * (noise2(x, y, 3, 32) - 0.5)) % 1.0
        w = 0.06 * (0.6 + 0.8 * noise2(x, y, 7, 33))
        e = edge_a(wx, wy)
        k = clamp((w - e) / w)
        if noise2(x, y, 4, 34) > 0.55:  # a finer, sparser network in some plates only
            k = max(k, 0.8 * clamp((0.7 * w - edge_b(wx, wy)) / (0.7 * w)))
        cache[key] = (k, e)
        return cache[key]
    def albedo(x, y):
        k, e = crack(x, y); m = mottle2(x, y, 55)
        return tuple(int(c + (t - c) * k) for c, t in zip((34 * m, 22 * m, 18 * m), (255, 92, 28)))
    def glow(x, y):
        k, e = crack(x, y); g = max(k, 0.4 * clamp((0.16 - e) / 0.16) ** 2)
        return (int(255 * g), int(120 * g), int(20 * g))
    return albedo, glow

def cursed():
    # Veins of constant width: the distance to the middle level of a three-octave noise (its
    # offset divided by the local slope), not a band in value, which swells where the noise is
    # flat and reads as blobs (5 Sep).
    # Two families: the main veins, and finer, fainter ones threading between them.
    def n1(x, y): return 0.55 * noise2(x, y, 2, 91) + 0.3 * noise2(x, y, 5, 92) + 0.15 * noise2(x, y, 13, 93)
    def n2(x, y): return 0.5 * noise2(x, y, 3, 94) + 0.3 * noise2(x, y, 7, 95) + 0.2 * noise2(x, y, 17, 96)
    h = 1.0 / TEX; W = 0.006  # half-width of a main vein, in tile units: about a centimetre at 1.8 m
    def dist_to(n, x, y):
        v = n(x, y); g = math.hypot((n(x + h, y) - v) / h, (n(x, y + h) - v) / h)
        return abs(v - 0.5) / max(1e-6, g)
    k = [0.0] * (TEX * TEX)
    for j in range(TEX):
        y = (j + 0.5) / TEX
        for i in range(TEX):
            x = (i + 0.5) / TEX
            k[j * TEX + i] = max(clamp((W - dist_to(n1, x, y)) / W), 0.45 * clamp((0.6 * W - dist_to(n2, x, y)) / (0.6 * W)))
    def k_at(x, y): return k[int(y * TEX) * TEX + int(x * TEX)]
    def albedo(x, y):
        k = k_at(x, y); m = mottle2(x, y, 99)
        return tuple(int(c + (t - c) * k) for c, t in zip((30 * m, 6 * m, 40 * m), (120, 40, 170)))
    def glow(x, y):
        k = k_at(x, y)
        return (int(150 * k), int(40 * k), int(220 * k))
    return albedo, glow

def yinyang():
    """The pieces' marble, made periodic: interlocking black and white with a seed of each."""
    def albedo(x, y):
        n = 0.5 * noise2(x, y, 3, 71) + 0.32 * noise2(x, y, 6, 72) + 0.18 * noise2(x, y, 12, 73)
        k = clamp((n - 0.5) / 0.05)
        cx, cy = math.floor(x * 7) % 7, math.floor(y * 7) % 7
        if hash2(cx, cy, 74) > 0.88:
            d = math.hypot(x * 7 - math.floor(x * 7) - 0.5, y * 7 - math.floor(y * 7) - 0.5)
            if d < 0.26: k = 1.0 - k
        v = int(18 + 219 * k)
        return (v, v, min(255, v + 4))
    return albedo

def galaxy():
    def albedo(x, y):
        n = 0.6 * noise2(x, y, 3, 6) + 0.4 * noise2(x, y, 8, 7)
        return (int(20 + 50 * n), int(6 + 18 * n), int(45 + 70 * n))
    tints = [(255, 255, 255), (255, 210, 240), (200, 225, 255), (180, 180, 220)]
    def glow(x, y):
        c = (math.floor(x * 60) % 60, math.floor(y * 60) % 60)
        if hash2(c[0], c[1], 66) > 0.035: return (0, 0, 0)
        return tints[int(hash2(c[0], c[1], 67) * 4)]
    return albedo, glow

def cyber_glow(x, y):
    # Six cells per tile, a node at every crossing: the same mesh the Cyber pieces wear.
    w = 0.05
    near = sum(1 for c in (x, y) if abs(((c * 6) % 1.0) - 0.5) > 0.5 - w)
    return (0, 229, 255) if near >= 2 else ((0, 150, 175) if near == 1 else (0, 0, 0))

def rainbow_albedo(x, y):
    # The hue runs down the tile: with the tile mapped on height, red at the foot, violet at the top.
    return hsv(y * 0.92, 0.95, 0.9)

def blood_albedo(x, y):
    """The pieces' dried burgundy with fresher runs, made periodic: a noise stretched four times
    along y, so it reads as something that has fallen down the wall. Blood and Candy were the
    two skins with no pattern at all, a flat colour beside pieces that wear one (owner, 6 Sep)."""
    # Stretched along y by giving the lattice fewer cells that way, which keeps the tile
    # periodic: scaling y before a wrapped noise broke the wrap and drew a seam every tile.
    def etire(nx, ny, seed):
        fx, fy = x * nx, y * ny
        ix, iy = math.floor(fx), math.floor(fy)
        tx, ty = [t * t * (3 - 2 * t) for t in (fx - ix, fy - iy)]
        c = lambda dx, dy: hash2((ix + dx) % nx, (iy + dy) % ny, seed)
        top = c(0, 0) + (c(1, 0) - c(0, 0)) * tx
        bot = c(0, 1) + (c(1, 1) - c(0, 1)) * tx
        return top + (bot - top) * ty
    n = 0.6 * etire(4, 1, 61) + 0.4 * etire(12, 3, 62)
    k = clamp((n - 0.48) / 0.14)
    m = mottle2(x, y, 63)
    return (int((34 + 96 * k) * m), int((4 + 14 * k) * m), int((8 + 18 * k) * m))


def candy_albedo(x, y):
    """The stripe, as on the pieces: a diagonal band, white between the pinks for the sugar."""
    u = (x + y) * 3.0
    w = u - math.floor(u)
    band = clamp((0.5 - abs(w - 0.5)) * 6.0)
    wob = 0.5 + 0.5 * noise2(x, y, 8, 64)
    return (255, int(120 + 118 * band), int(160 + 90 * band * (0.85 + 0.15 * wob)))


def main():
    os.makedirs(OUT, exist_ok=True)
    lava_a, lava_g = lava(); cursed_a, cursed_g = cursed(); galaxy_a, galaxy_g = galaxy()
    yinyang_a = yinyang()
    tiles = {
        'skin-5-albedo': lava_a, 'skin-5-glow': lava_g,
        'skin-9-albedo': cursed_a, 'skin-9-glow': cursed_g,
        'skin-6-albedo': galaxy_a, 'skin-6-glow': galaxy_g,
        'skin-12-glow': cyber_glow,
        'skin-11-albedo': rainbow_albedo,
        'skin-7-albedo': yinyang_a,
        'skin-3-albedo': blood_albedo,
        'skin-4-albedo': candy_albedo
    }
    for name, fn in tiles.items():
        big = name.startswith('skin-5-')  # the lava tile spans 3.6 m: 512 px, no supersampling needed
        tile(fn, 512 if big else TEX_OUT, 1 if big else SUPER).save(os.path.join(OUT, name + '.png'), optimize=True)
    print(f'{len(tiles)} tiles written to {os.path.relpath(OUT)}')

if __name__ == '__main__':
    main()
