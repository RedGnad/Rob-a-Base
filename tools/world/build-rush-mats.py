#!/usr/bin/env python3
"""
One floor per rush, drawn as a ground and not as a piece.

What was there: three greyscale weaves (gold, lava, cursed), a sum of sines at a fifth of
contrast, tinted by a mid tone. Ten rushes shared them, so a Lava rush was a brownish mat with
faint smears and a Galaxy rush was the cursed weave under a navy tint (owner, 5 Sep: "la
texture du sol est pas satisfaisante... il faut que chaque sol soit propre dans son design").

What a ground is allowed to do, from the readability rules the genre's own art teams publish
and every colourful arena game follows: the floor is the BACKGROUND, so it keeps a narrow value
range and a low frequency, and the things that stand on it (players, pieces, crates, the
yellow ramps) keep the contrast. A rush floor therefore says which rush it is with three
things, in this order: its HUE, one large motif at a few metres a cell with the plates within
about a quarter of a stop of each other, and a sparse accent (under five percent of the area)
that is bright and, where the theme is a glowing one, emissive. Never a fine, high contrast
pattern: that tiles like a bathroom and fights the foreground.

So each mat here is a colour tile of its own, seamless on an eight metre repeat, built from the
same wrapped noises the base skins use (`tools/model/build-skin-tiles.py`), and `events.ts`
draws it with a white albedo and, for the glowing rushes, the same image as its emissive map,
so the accent lights and the plates do not.

  gold         warm ochre with a broad sheen and rare glints            discreet
  lava         dark crust plates, thin bright cracks, ember halo         loud by hue, calm by shape
  cursed       deep violet, faint veins                                  discreet
  galaxy       deep night blue, nebula drift, pinprick stars             loud by accent
  yin yang     grey marble interlock, low contrast                       discreet
  radioactive  olive green, sparse acid flecks                           loud by accent
  divine       pale gold, soft light patches, faint sparkle              discreet, bright
  rainbow      pastel hue drift on the diagonal, desaturated             discreet
  cyber        dark teal, two metre grid in cyan, nodes at the crossings loud by accent
  phantom      pale mint, mist and thin wisps                            discreet

    python3 tools/world/build-rush-mats.py
"""
import math
import os
from concurrent.futures import ProcessPoolExecutor
from importlib import util as _u

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _u.spec_from_file_location('skins', os.path.join(HERE, '..', 'model', 'build-skin-tiles.py'))
skins = _u.module_from_spec(_spec)
_spec.loader.exec_module(skins)
hash2, noise2, voronoi2, mottle2, hsv, clamp, tile = (
    skins.hash2, skins.noise2, skins.voronoi2, skins.mottle2, skins.hsv, skins.clamp, skins.tile)

OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'assets', 'textures'))

# src/client/toy.ts TOY.groundEvent: the mid tone of each rush, kept in step by hand.
BASE = {
    1: (0xb8, 0x9a, 0x3a), 5: (0xb4, 0x52, 0x3a), 9: (0x6a, 0x4a, 0x8f), 6: (0x3a, 0x3f, 0x7c),
    7: (0x8c, 0x8c, 0x90), 8: (0x5c, 0x8a, 0x2c), 10: (0xc8, 0xb7, 0x8a), 11: (0x9a, 0x7a, 0x9c),
    12: (0x2c, 0x7a, 0x86), 13: (0x6e, 0x9a, 0x86)
}


def mix(a, b, k):
    return tuple(int(round(a[i] + (b[i] - a[i]) * k)) for i in range(3))


def scale(c, k):
    return tuple(int(round(min(255, v * k))) for v in c)


def dots(x, y, n, keep, radius, seed):
    """A sparse field of soft round marks on a wrapped lattice: 0 outside, 1 at a centre."""
    cx, cy = math.floor(x * n) % n, math.floor(y * n) % n
    if hash2(cx, cy, seed) < keep:
        return 0.0
    ox, oy = 0.25 + 0.5 * hash2(cx, cy, seed + 1), 0.25 + 0.5 * hash2(cx, cy, seed + 2)
    d = math.hypot(x * n - math.floor(x * n) - ox, y * n - math.floor(y * n) - oy)
    return clamp(1 - d / radius) ** 2


def gold(x, y):
    n = 0.6 * noise2(x, y, 2, 11) + 0.4 * noise2(x, y, 5, 12)
    c = scale(BASE[1], 0.86 + 0.16 * n)
    return mix(c, (255, 238, 160), 0.9 * dots(x, y, 36, 0.985, 0.18, 13))


def lava(x, y):
    edge = voronoi2(21, 5)
    wx = (x + 0.04 * (noise2(x, y, 3, 22) - 0.5)) % 1.0
    wy = (y + 0.04 * (noise2(x, y, 3, 23) - 0.5)) % 1.0
    e = edge(wx, wy)
    w = 0.028 * (0.7 + 0.6 * noise2(x, y, 6, 24))
    k = clamp((w - e) / w)
    plate = scale((70, 32, 24), 0.9 + 0.2 * mottle2(x, y, 25) - 0.15)
    ember = 0.35 * clamp((0.14 - e) / 0.14) ** 2
    c = mix(plate, (150, 44, 20), ember)
    return mix(c, (255, 98, 28), k)


def cursed(x, y):
    def n1(u, v): return 0.55 * noise2(u, v, 2, 91) + 0.3 * noise2(u, v, 5, 92) + 0.15 * noise2(u, v, 11, 93)
    h = 1.0 / 512
    v = n1(x, y)
    g = math.hypot((n1(x + h, y) - v) / h, (n1(x, y + h) - v) / h)
    d = abs(v - 0.5) / max(1e-6, g)
    W = 0.007
    k = clamp((W - d) / W)
    plate = scale(BASE[9], 0.84 + 0.2 * (mottle2(x, y, 99) - 0.75))
    return mix(plate, (156, 104, 214), 0.75 * k)


def galaxy(x, y):
    # Three octaves, none coarser than three cells a tile: at two cells the nebula was a grid
    # of blocks that showed its repeat across the venue (first sheet, 5 Sep).
    n = 0.5 * noise2(x, y, 3, 6) + 0.3 * noise2(x, y, 7, 7) + 0.2 * noise2(x, y, 13, 9)
    m = 0.6 * noise2(x, y, 4, 8) + 0.4 * noise2(x, y, 9, 10)
    deep = (36, 38, 84)
    c = mix(deep, BASE[6], n)
    c = mix(c, (92, 48, 122), 0.22 * clamp((m - 0.55) / 0.3))
    c = mix(c, (40, 96, 126), 0.22 * clamp((0.45 - m) / 0.3))
    s = dots(x, y, 64, 0.965, 0.55, 66)
    return mix(c, (255, 250, 240), s)


def yinyang(x, y):
    # The pieces' interlock at a floor's contrast: eleven percent between the two greys, the
    # coarsest octave at three cells so the shapes flow rather than stamp, and the seeds of the
    # other tone rare and small. At twenty percent with two cell blobs and a dot in every sixth
    # cell it read as a repeated logo with polka dots (first sheet, 5 Sep).
    # Finer still on the second sheet: with three shapes a tile the same silhouette came back
    # every eight metres and the eye tracked it. Five to twenty three cells and a softer edge
    # make a marble, which has no silhouette to track; the two greys and the dawn sky carry
    # the theme, as the pieces do.
    n = 0.45 * noise2(x, y, 5, 71) + 0.35 * noise2(x, y, 11, 72) + 0.2 * noise2(x, y, 23, 73)
    k = clamp((n - 0.5) / 0.16)
    cx, cy = math.floor(x * 12) % 12, math.floor(y * 12) % 12
    if hash2(cx, cy, 74) > 0.96:
        d = math.hypot(x * 12 - math.floor(x * 12) - 0.5, y * 12 - math.floor(y * 12) - 0.5)
        if d < 0.16:
            k = 1.0 - k
    return mix((122, 122, 128), (158, 158, 164), k)


def radioactive(x, y):
    plate = scale(BASE[8], 0.88 + 0.24 * (mottle2(x, y, 41) - 0.75))
    return mix(plate, (176, 255, 64), 0.85 * dots(x, y, 44, 0.975, 0.3, 42))


def divine(x, y):
    n = 0.65 * noise2(x, y, 2, 51) + 0.35 * noise2(x, y, 6, 52)
    c = scale(BASE[10], 0.9 + 0.16 * n)
    return mix(c, (255, 252, 232), 0.7 * dots(x, y, 56, 0.985, 0.2, 53))


def rainbow(x, y):
    h = (x + y) % 1.0
    m = 0.94 + 0.12 * (mottle2(x, y, 61) - 0.75)
    return scale(hsv(h, 0.30, 0.74), m)


def cyber(x, y):
    base = scale((26, 62, 70), 0.9 + 0.2 * (mottle2(x, y, 81) - 0.75))
    fine = 0.012
    near_f = sum(1 for c in (x, y) if abs(((c * 16) % 1.0) - 0.5) > 0.5 - fine * 4)
    c = mix(base, (44, 112, 122), 0.35 if near_f >= 1 else 0.0)
    w = 0.010
    near = sum(1 for c_ in (x, y) if abs(((c_ * 4) % 1.0) - 0.5) > 0.5 - w)
    if near >= 2:
        return (40, 236, 255)
    if near == 1:
        return mix(c, (0, 214, 240), 0.9)
    return c


def phantom(x, y):
    n = 0.6 * noise2(x, y, 2, 31) + 0.4 * noise2(x, y, 5, 32)
    c = scale(BASE[13], 0.9 + 0.18 * n)
    def n2(u, v): return 0.6 * noise2(u, v, 3, 33) + 0.4 * noise2(u, v, 7, 34)
    h = 1.0 / 512
    v = n2(x, y)
    g = math.hypot((n2(x + h, y) - v) / h, (n2(x, y + h) - v) / h)
    d = abs(v - 0.5) / max(1e-6, g)
    W = 0.010
    return mix(c, (196, 228, 214), 0.5 * clamp((W - d) / W))


MATS = {1: gold, 5: lava, 9: cursed, 6: galaxy, 7: yinyang, 8: radioactive, 10: divine, 11: rainbow, 12: cyber, 13: phantom}


def un(theme):
    fn = MATS[theme]
    im = tile(fn, 256, 2)
    path = os.path.join(OUT, f'mat-rush-{theme}.png')
    im.save(path, optimize=True)
    return f'  mat-rush-{theme}.png  {os.path.getsize(path) / 1024:.1f} Ko'


def main():
    os.makedirs(OUT, exist_ok=True)
    with ProcessPoolExecutor() as pool:
        for line in pool.map(un, sorted(MATS)):
            print(line)


if __name__ == '__main__':
    main()
