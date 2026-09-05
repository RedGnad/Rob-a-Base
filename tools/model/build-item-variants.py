"""Bake every rarity x mutation tint of the toy pieces into its own GLB.

Why: the mobile client counts UNIQUE materials against its 400/500 budget, and it
duplicates a material for every piece tinted through a node modifier, so each exposed
piece used to cost one material. Instances of one GLB share their materials, so a piece
drawn from `item-<rarity>-<mutation>.glb` costs nothing on that budget however many stand.

The recipes mirror `src/client/toy.ts` (`plastic`, `metalMaterial`) and the tables in
`src/shared/loot-table.ts`, so a baked piece looks like the tinted one did.

Usage: python3 tools/model/build-item-variants.py   (reads assets/toy/item-<r>.glb, r in 0..5)
"""
import math
import json, struct, os, sys, io, random
from concurrent.futures import ProcessPoolExecutor
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
TOY = os.path.join(HERE, '..', '..', 'assets', 'toy')

# src/shared/loot-table.ts RARITIES (id, colour, glow), Secret (6) stays a primitive silhouette.
RARITIES = [('#78818e', 0.00), ('#4ec04e', 0.35), ('#3d8ef0', 0.80), ('#a855f7', 1.30), ('#f5a524', 2.00), ('#ff4d6d', 2.80), ('#ffffff', 4.00)]
# src/shared/loot-table.ts MUTATIONS (id 0 = plain: the rarity's own colour).
# Mirrors src/shared/loot-table.ts MUTATIONS: keep both in step.
MUTATIONS = ['', '#ffd700', '#b9f2ff', '#6e0b14', '#ff9ecd', '#ff5722', '#5b2c8d', '#b6b6be', '#7fff00', '#3b0a45', '#ffe9a8', '#ff00ff', '#00e5ff', '#86ffd0']
METAL = {1, 2}  # Gold, Diamond
# The client reads a glTF emissive far hotter than the SDK's emissiveIntensity: at 0.4 every bright piece
# washed to white, at 0 an Epic read as a deep purple (A/B on the owner's base, 5 Sep 02:40). The style
# is the DARK albedo; the glow is a hint on top.
EMISSIVE_SCALE = 0.08

def rgb(hex_colour):
    h = hex_colour.lstrip('#')
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]

def recipe(rarity, mutation):
    """(baseColor rgb, metallic, roughness, emissive rgb or None, 1).

    The albedo follows toy.ts to the letter: DARK albedo under a coloured glow is what makes a
    Blood read as burgundy and a Cursed as deep violet (owner, 5 Sep, 02:20: a full albedo
    turned the red flat and cost every mutation its style). Only the glow is bounded, because
    the client reads a glTF emissive far hotter than the SDK's emissiveIntensity and the first
    bake blew every bright colour to white.
    """
    colour = rgb(MUTATIONS[mutation] if mutation > 0 else RARITIES[rarity][0])
    glow = RARITIES[rarity][1]
    eclat = 0 if glow <= 0 else (glow ** 1.5) * 0.9
    lueur = min(1.0, eclat * EMISSIVE_SCALE)
    if rarity == 6 and mutation == 0:  # a plain Secret is blazing white, never a darkened albedo
        return (1.0, 1.0, 1.0), 0.1, 0.3, (0.6, 0.6, 0.6), 1
    if mutation == 1:  # gold: the deep tone itself, full metal, a warm emissive floor under the rarity glow
        return rgb('#f5c518'), 0.9, 0.32, [c * max(0.04, lueur) for c in (0.72, 0.52, 0.10)], 1
    if mutation == 2:  # diamond: a cut gem, deep teal under a mirror gloss, so it never reads as
        # white glass lost on a pale pool (owner, 5 Sep: "une piece est presente mais pas visible")
        c = rgb(MUTATIONS[2])
        return tuple(v * 0.45 for v in c), 0.35, 0.08, [v * max(0.10, lueur) for v in c], 1
    if glow <= 0:  # plain plastic
        return colour, 0.0, 0.55, None, 0
    sombre = 1 / (1 + glow * 1.2)  # dark albedo, bright emissive: the platform's own glow recipe
    return [c * sombre for c in colour], 0.0, 0.45, [c * lueur for c in colour], 1


# ---- The fancy mutations: a look, not only a colour. Each texture is a small PNG embedded in the
# GLB, so it ships once per file and the phone counts it once (owner, 5 Sep: "rainbow qui n'a
# qu'une couleur, phantom opaque, cyber juste vert, galaxy unie").
TEX_OUT = 256
# Samples per texel and axis: the bake runs at 512 and is box-filtered down to what ships, so a
# crack edge is a soft ramp and not a staircase when a piece fills the screen (owner, 5 Sep:
# "pixelisee sur les pieces").
SUPER = 2
TEX = TEX_OUT * SUPER


# --- Object-space baking -------------------------------------------------------------------
# The chess set is unwrapped into 10 to 30 UV islands per piece, so any pattern drawn in UV
# space breaks at every island border (owner, 5 Sep: "une coupe abrupte entre les bords, sur
# toutes les pieces"). The documented cure is to evaluate the pattern at each texel's 3D point
# on the piece and write the result back into the piece's own unwrap: the two sides of a seam
# share the same 3D point, so the pattern continues across it. One texture per model and per
# mutation, embedded in the file it dresses, which the runtime already loaded that way.

ACCESSOR_FMT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
ACCESSOR_LEN = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

def accessor(js, bin_chunk, i):
    a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]
    fmt, n = ACCESSOR_FMT[a['componentType']], ACCESSOR_LEN[a['type']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    size = struct.calcsize('<' + fmt * n); stride = bv.get('byteStride', size)
    return [struct.unpack_from('<' + fmt * n, bin_chunk, base + k * stride) for k in range(a['count'])]

def hash3(x, y, z, seed):
    """A repeatable number in [0, 1) for an integer lattice cell."""
    h = (x * 374761393 + y * 668265263 + z * 1103515245 + seed * 1013904223) & 0xffffffff
    h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
    return ((h ^ (h >> 16)) & 0xffffffff) / 4294967296.0

def repack_uvs(js, bin_chunk):
    """The chess set's unwrap leaves its islands sparse: the bishop paints a tenth of its atlas,
    so a piece had the resolution of an eighty-pixel texture whatever the file size (owner,
    5 Sep: "pixelisee sur les pieces"). The variants are derived files, so they can carry their
    own UVs: each island is scaled and shelf-packed to fill the atlas, uniformly (the artist's
    relative densities stay), with a margin for filtering. Returns the modified file."""
    out = json.loads(json.dumps(js)); chunk = bin_chunk
    for mesh in out['meshes']:
        for prim in mesh['primitives']:
            at = prim['attributes']
            U = accessor(js, bin_chunk, at['TEXCOORD_0']); I = [t[0] for t in accessor(js, bin_chunk, prim['indices'])]
            parent = list(range(len(U)))
            def find(x):
                while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
                return x
            for t in range(0, len(I), 3):
                parent[find(I[t])] = find(I[t + 1]); parent[find(I[t + 1])] = find(I[t + 2])
            groups = {}
            for v in set(I): groups.setdefault(find(v), []).append(v)
            islands = []
            for verts in groups.values():
                us = [U[v][0] for v in verts]; vs = [U[v][1] for v in verts]
                islands.append({'verts': verts, 'u0': min(us), 'v0': min(vs), 'w': max(us) - min(us), 'h': max(vs) - min(vs)})
            islands.sort(key=lambda k: -k['h'])
            def pack(s, m):
                x = y = rowh = 0.0; places = []
                for isl in islands:
                    w, h = isl['w'] * s + 2 * m, isl['h'] * s + 2 * m
                    if x + w > 1.0: y += rowh; x = rowh = 0.0
                    if y + h > 1.0 or w > 1.0: return None
                    places.append((isl, x + m, y + m)); x += w; rowh = max(rowh, h)
                return places
            m = 6.0 / TEX_OUT; lo, hi = 0.05, 40.0; best = None
            for _ in range(48):
                mid = (lo + hi) / 2; pl = pack(mid, m)
                if pl: best = (mid, pl); lo = mid
                else: hi = mid
            s, places = best
            newU = list(U)
            for isl, x, y in places:
                for v in isl['verts']: newU[v] = ((U[v][0] - isl['u0']) * s + x, (U[v][1] - isl['v0']) * s + y)
            data = struct.pack('<' + 'ff' * len(newU), *[c for uv in newU for c in uv])
            chunk += b'\x00' * ((4 - len(chunk) % 4) % 4)
            out['bufferViews'].append({'buffer': 0, 'byteOffset': len(chunk), 'byteLength': len(data), 'target': 34962}); chunk += data
            out['accessors'].append({'bufferView': len(out['bufferViews']) - 1, 'componentType': 5126, 'count': len(newU), 'type': 'VEC2'})
            prim['attributes']['TEXCOORD_0'] = len(out['accessors']) - 1
            out['buffers'][0]['byteLength'] = len(chunk)
    return out, chunk

class PositionMap:
    """Which object-space point each texel paints, read from the model's own unwrap."""
    def __init__(self, js, bin_chunk):
        self.pos = [None] * (TEX * TEX)
        self.cache = {}
        pts = []
        for mesh in js['meshes']:
            for prim in mesh['primitives']:
                at = prim['attributes']
                P = accessor(js, bin_chunk, at['POSITION'])
                U = accessor(js, bin_chunk, at['TEXCOORD_0'])
                I = [t[0] for t in accessor(js, bin_chunk, prim['indices'])]
                pts += P
                for t in range(0, len(I), 3): self.raster(P, U, I[t], I[t + 1], I[t + 2])
        xs, ys, zs = zip(*pts)
        self.lo = (min(xs), min(ys), min(zs)); self.hi = (max(xs), max(ys), max(zs))
        self.size = max(h - l for h, l in zip(self.hi, self.lo))
        self.centre = tuple((h + l) / 2 for h, l in zip(self.hi, self.lo))
        self.painted = sum(p is not None for p in self.pos)
        self.dilate()

    def raster(self, P, U, a, b, c):
        (ua, va), (ub, vb), (uc, vc) = U[a], U[b], U[c]
        du, dv = math.floor(min(ua, ub, uc)), math.floor(min(va, vb, vc))
        xa, ya = (ua - du) * TEX, (va - dv) * TEX
        xb, yb = (ub - du) * TEX, (vb - dv) * TEX
        xc, yc = (uc - du) * TEX, (vc - dv) * TEX
        det = (xb - xa) * (yc - ya) - (xc - xa) * (yb - ya)
        if abs(det) < 1e-9: return
        x0, x1 = math.floor(min(xa, xb, xc)), math.ceil(max(xa, xb, xc))
        y0, y1 = math.floor(min(ya, yb, yc)), math.ceil(max(ya, yb, yc))
        pa, pb, pc = P[a], P[b], P[c]
        for y in range(y0, y1 + 1):
            py = y + 0.5
            for x in range(x0, x1 + 1):
                px = x + 0.5
                w0 = ((xb - px) * (yc - py) - (xc - px) * (yb - py)) / det
                w1 = ((xc - px) * (ya - py) - (xa - px) * (yc - py)) / det
                w2 = 1.0 - w0 - w1
                if w0 >= -0.003 and w1 >= -0.003 and w2 >= -0.003:
                    self.pos[(y % TEX) * TEX + (x % TEX)] = (
                        w0 * pa[0] + w1 * pb[0] + w2 * pc[0],
                        w0 * pa[1] + w1 * pb[1] + w2 * pc[1],
                        w0 * pa[2] + w1 * pb[2] + w2 * pc[2])

    def dilate(self):
        """Every unpainted texel takes the point of its nearest painted one (a breadth-first
        flood from all painted texels), so no texel is void: filtering and mipmaps at an
        island's border only ever blend surface with surface."""
        from collections import deque
        queue = deque(i for i, p in enumerate(self.pos) if p is not None)
        while queue:
            i = queue.popleft(); y, x = divmod(i, TEX); p = self.pos[i]
            for dy, dx in ((0, -1), (0, 1), (-1, 0), (1, 0), (-1, -1), (-1, 1), (1, -1), (1, 1)):
                j = ((y + dy) % TEX) * TEX + (x + dx) % TEX
                if self.pos[j] is None: self.pos[j] = p; queue.append(j)

def clamp(k): return 0.0 if k < 0 else (1.0 if k > 1 else k)

def png(pm, fn):
    """A texture from a function of (texel index, object-space point)."""
    im = Image.new('RGB', (TEX, TEX))
    im.putdata([fn(i, pm.pos[i]) for i in range(TEX * TEX)])
    im = im.resize((TEX_OUT, TEX_OUT), Image.BOX)
    out = io.BytesIO(); im.save(out, format='PNG', optimize=True); return out.getvalue()

def voronoi_edge(pm, seed, cell):
    """Per texel: gap between the distances to the two nearest seeds of a jittered 3D lattice,
    in cell units. Near zero on a cell border, so thresholding it draws cracks or veins."""
    key = (seed, cell)
    if key in pm.cache: return pm.cache[key]
    seeds = {}
    def seed_of(cx, cy, cz):
        k = (cx, cy, cz)
        if k not in seeds: seeds[k] = (cx + hash3(cx, cy, cz, seed), cy + hash3(cx, cy, cz, seed + 1), cz + hash3(cx, cy, cz, seed + 2))
        return seeds[k]
    out = [1.0] * (TEX * TEX)
    for i, p in enumerate(pm.pos):
        if p is None: continue
        fx, fy, fz = p[0] / cell, p[1] / cell, p[2] / cell
        ix, iy, iz = math.floor(fx), math.floor(fy), math.floor(fz)
        d1 = d2 = 1e9
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                for oz in (-1, 0, 1):
                    sx, sy, sz = seed_of(ix + ox, iy + oy, iz + oz)
                    d = (fx - sx) ** 2 + (fy - sy) ** 2 + (fz - sz) ** 2
                    if d < d1: d2 = d1; d1 = d
                    elif d < d2: d2 = d
        out[i] = math.sqrt(d2) - math.sqrt(d1)
    pm.cache[key] = out
    return out

def mottle(p, size, seed):
    """A smooth unevenness of the surface, 0.75 to 1.25: blotches of a tenth of the piece and a
    finer flecking, never a hash per texel (that reads as a mosaic once magnified)."""
    return 0.75 + 0.5 * (0.6 * noise3(p, size / 10, seed) + 0.4 * noise3(p, size / 40, seed + 1))

def noise3(p, cell, seed):
    """Smooth value noise on a 3D lattice, in [0, 1]."""
    fx, fy, fz = p[0] / cell, p[1] / cell, p[2] / cell
    ix, iy, iz = math.floor(fx), math.floor(fy), math.floor(fz)
    tx, ty, tz = [t * t * (3 - 2 * t) for t in (fx - ix, fy - iy, fz - iz)]
    def lerp(a, b, t): return a + (b - a) * t
    c = [[[hash3(ix + dx, iy + dy, iz + dz, seed) for dz in (0, 1)] for dy in (0, 1)] for dx in (0, 1)]
    return lerp(lerp(lerp(c[0][0][0], c[0][0][1], tz), lerp(c[0][1][0], c[0][1][1], tz), ty),
                lerp(lerp(c[1][0][0], c[1][0][1], tz), lerp(c[1][1][0], c[1][1][1], tz), ty), tx)

def hsv(h, s, v):
    i = int(h * 6) % 6; f = h * 6 - int(h * 6); p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    r, g, b = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)][i]
    return (int(r * 255), int(g * 255), int(b * 255))

def rainbow_albedo(pm):
    # Deliberately in UV space: the hue sweeps each island its own way, a patchwork of rainbows,
    # which the owner preferred to a hue climbing the piece (5 Sep). Its cuts are part of the look.
    return png(pm, lambda i, p: hsv((i % TEX) / TEX, 0.95, 0.9))
def galaxy_albedo(pm):
    def f(i, p):
        n = 0.6 * noise3(p, pm.size / 4, 6) + 0.4 * noise3(p, pm.size / 10, 7)
        return (int(20 + 50 * n), int(6 + 18 * n), int(45 + 70 * n))
    return png(pm, f)
def galaxy_stars(pm):
    g = pm.size / 70
    tints = [(255, 255, 255), (255, 210, 240), (200, 225, 255), (180, 180, 220)]
    def f(i, p):
        c = (math.floor(p[0] / g), math.floor(p[1] / g), math.floor(p[2] / g))
        if hash3(*c, 66) > 0.035: return (0, 0, 0)
        return tints[int(hash3(*c, 67) * 4)]
    return png(pm, f)
def cyber_lines(pm):
    # Three families of planes cut the piece into a lattice; a node where two of them meet.
    s = pm.size / 9; w = 0.05
    def f(i, p):
        near = sum(1 for c in p if abs(((c / s) % 1.0) - 0.5) > 0.5 - w)
        return (0, 229, 255) if near >= 2 else ((0, 150, 175) if near == 1 else (0, 0, 0))
    return png(pm, f)
def lava_albedo(pm):
    edge = voronoi_edge(pm, 5, pm.size / 3.5)
    def f(i, p):
        k = clamp((0.05 - edge[i]) / 0.05)  # 1 in the crack, 0 on the crust
        m = mottle(p, pm.size, 55)
        crust = (34 * m, 22 * m, 18 * m)
        return tuple(int(c + (t - c) * k) for c, t in zip(crust, (255, 92, 28)))
    return png(pm, f)
def lava_glow(pm):
    edge = voronoi_edge(pm, 5, pm.size / 3.5)
    def f(i, p):
        # The crack burns; the plate edge around it only glows, like embers under a crust.
        g = max(clamp((0.05 - edge[i]) / 0.05), 0.4 * clamp((0.16 - edge[i]) / 0.16) ** 2)
        return (int(255 * g), int(120 * g), int(20 * g))
    return png(pm, f)
def cursed_veins_field(pm):
    """Per texel, 1 in a vein and 0 outside. A vein is the middle level of a three-octave noise,
    drawn at constant width: the offset from that level divided by the local slope, so the
    line never swells where the noise is flat. Marble, not the Lava's cell network (owner,
    5 Sep: "la texture de cursed est la meme que lava")."""
    key = ('cursed',)
    if key in pm.cache: return pm.cache[key]
    size = pm.size; h = size / 400; W = size * 0.006
    # Two families: the main veins, and finer, fainter ones threading between them.
    def n1(p): return 0.55 * noise3(p, size / 2.5, 91) + 0.3 * noise3(p, size / 6, 92) + 0.15 * noise3(p, size / 16, 93)
    def n2(p): return 0.5 * noise3(p, size / 1.8, 94) + 0.3 * noise3(p, size / 4.5, 95) + 0.2 * noise3(p, size / 12, 96)
    def dist_to(n, p):
        v = n(p)
        gx = (n((p[0] + h, p[1], p[2])) - v) / h; gy = (n((p[0], p[1] + h, p[2])) - v) / h; gz = (n((p[0], p[1], p[2] + h)) - v) / h
        return abs(v - 0.5) / max(1e-6, math.sqrt(gx * gx + gy * gy + gz * gz))
    out = [0.0] * (TEX * TEX)
    for i, p in enumerate(pm.pos):
        if p is None: continue
        out[i] = max(clamp((W - dist_to(n1, p)) / W), 0.45 * clamp((0.6 * W - dist_to(n2, p)) / (0.6 * W)))
    pm.cache[key] = out
    return out
def cursed_albedo(pm):
    veins = cursed_veins_field(pm)
    def f(i, p):
        k = veins[i]
        m = mottle(p, pm.size, 99)
        base = (30 * m, 6 * m, 40 * m)
        return tuple(int(c + (t - c) * k) for c, t in zip(base, (120, 40, 170)))
    return png(pm, f)
def cursed_veins(pm):
    veins = cursed_veins_field(pm)
    def f(i, p):
        k = veins[i]
        return (int(150 * k), int(40 * k), int(220 * k))
    return png(pm, f)
def yinyang_albedo(pm):
    """Interlocking black and white, marbled, with a few dots of each in the other.

    A hard split down the middle read as a piece someone had painted half way (owner, 5 Sep).
    Yin and yang is not two halves, it is two shapes that hold each other and each carries a
    seed of the other: a three-octave noise thresholded at its middle gives exactly that on
    any shape, and a sparse lattice drops the seeds."""
    size = pm.size
    def f(i, p):
        n = 0.5 * noise3(p, size / 3, 71) + 0.32 * noise3(p, size / 6, 72) + 0.18 * noise3(p, size / 12, 73)
        k = clamp((n - 0.5) / 0.05)                  # 0 black, 1 white, a soft edge between
        g = size / 7
        c = (math.floor(p[0] / g), math.floor(p[1] / g), math.floor(p[2] / g))
        if hash3(*c, 74) > 0.93:                      # a round seed of the other tone
            d = math.dist((p[0] / g - c[0], p[1] / g - c[1], p[2] / g - c[2]), (0.5, 0.5, 0.5))
            if d < 0.26: k = 1.0 - k
        v = int(18 + 219 * k)
        return (v, v, min(255, v + 4))
    return png(pm, f)

def gold_martele(pm):
    """Hammered gold, kept for ONE piece.

    Dented metal was wrong everywhere and right on the Secret: a planet is not a poured
    object, and the facets give its ring something to sit against (owner, 5 Sep). So the
    recipe carries two painters and the rarity picks.
    """
    e = voronoi_edge(pm, 41, pm.size / 5.5)
    def f(i, p):
        k = clamp(e[i] * 2.2)
        m = 0.9 + 0.2 * mottle(p, pm.size, 42)
        return (int(min(255, 235 * m * (0.72 + 0.28 * k))),
                int(min(255, 186 * m * (0.66 + 0.34 * k))),
                int(min(255, 40 * m * (0.5 + 0.5 * k))))
    return png(pm, f)

def gold_albedo(pm):
    """Poured gold: one broad sheen across the piece, no edges anywhere.

    The first pass hammered it, a coarse voronoi with darkened borders, and on a phone that
    reads as damage rather than as metal: "trop martelle, on veut une texture smooth comme sur
    notre vignette" (owner, 5 Sep). Two very low frequencies, nothing sharper, so the surface
    only ever brightens and dims across a whole limb; the metallic factor does the rest."""
    size = pm.size
    def f(i, p):
        k = 0.62 * noise3(p, size / 1.5, 41) + 0.38 * noise3(p, size / 3.2, 42)
        v = 0.84 + 0.28 * k                          # 0.84 to 1.12, a sheen and no line
        return (int(min(255, 238 * v)), int(min(255, 190 * v)), int(min(255, 58 * v)))
    return png(pm, f)

def diamond_albedo(pm):
    """Facets, flat and hard edged, with the light caught along the cuts.

    A gem is not a colour, it is an arrangement of planes. A voronoi at a coarse cell gives
    flat faces on any shape; the border is drawn nearly white, the face is a pale ice blue
    that varies from face to face so the stone has depth."""
    e = voronoi_edge(pm, 51, pm.size / 4.5)
    def f(i, p):
        face = hash3(math.floor(p[0] / (pm.size / 4.5)), math.floor(p[1] / (pm.size / 4.5)), math.floor(p[2] / (pm.size / 4.5)), 52)
        k = clamp(e[i] * 3.0)
        base = (150 + 60 * face, 205 + 40 * face, 225 + 30 * face)
        return tuple(int(min(255, c * (0.62 + 0.38 * k) + 90 * (1 - k))) for c in base)
    return png(pm, f)

def blood_albedo(pm):
    """Dried burgundy with fresher runs in it, drawn downward.

    Blood was the darkest flat of the set and read as brown plastic. The runs are a noise
    stretched along the vertical axis, which is what makes a liquid look like it has fallen."""
    size = pm.size
    def f(i, p):
        n = 0.6 * noise3((p[0], p[1] * 0.25, p[2]), size / 3, 61) + 0.4 * noise3((p[0], p[1] * 0.25, p[2]), size / 9, 62)
        k = clamp((n - 0.48) / 0.14)
        m = mottle(p, size, 63)
        return (int((34 + 96 * k) * m), int((4 + 14 * k) * m), int((8 + 18 * k) * m))
    return png(pm, f)

def candy_albedo(pm):
    """The stripe, because a candy is a stripe.

    Pale pink was indistinguishable from Divine's cream at arm's length. A diagonal band in
    object space wraps any shape without a seam, and the white between the pink is what the
    eye reads as sugar."""
    size = pm.size
    def f(i, p):
        u = (p[0] + p[1] + p[2]) / (size / 3.2)
        w = u - math.floor(u)
        band = clamp((0.5 - abs(w - 0.5)) * 6.0)
        wob = 0.5 + 0.5 * noise3(p, size / 8, 64)
        r = 255
        g = int(120 + 118 * band)
        b = int(160 + 90 * band)
        return (int(r * (0.92 + 0.08 * wob)), g, b)
    return png(pm, f)

def radio_albedo(pm):
    """Near black, barely pitted: a hint of corrosion, not a relief map."""
    e = voronoi_edge(pm, 81, pm.size / 7)
    def f(i, p):
        k = clamp(e[i] * 2.5)
        m = 0.85 + 0.3 * mottle(p, pm.size, 82)
        v = (12 + 9 * (1 - k)) * m
        return (int(v * 0.8), int(v * 1.5), int(v * 0.6))
    return png(pm, f)

def radio_glow(pm):
    """The radiation itself: even over the whole piece, a little hotter in the pits.

    It was the opposite, green only where the metal was eaten, and that read as a pattern
    rather than as radiation. The uranium look is a monochrome that GLOWS, so the floor is
    high and the pits only add to it.
    """
    e = voronoi_edge(pm, 81, pm.size / 7)
    def f(i, p):
        k = 1 - clamp(e[i] * 2.5)
        n = 0.5 + 0.5 * noise3(p, pm.size / 4, 83)
        g = clamp(0.62 + 0.22 * k + 0.16 * n)
        return (int(45 * g), int(255 * g), int(35 * g))
    return png(pm, f)

def divine_albedo(pm):
    """Cream, with rings so fine they are a grain rather than a pattern.

    The first pass drew wide bands and they read as stripes on a candle: what makes a Divine
    is the even radiance, and the rings are only there to keep the surface from being dead
    flat (owner, 5 Sep: "beaucoup plus fines et subtiles"). Three times the frequency, a
    sixth of the contrast."""
    size = pm.size
    def f(i, p):
        r = math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) / (size / 16)
        ring = 0.5 + 0.5 * math.sin(r * 6.3)
        n = 0.5 + 0.5 * noise3(p, size / 3, 101)
        v = 0.955 + 0.03 * ring + 0.02 * n
        return (int(min(255, 255 * v)), int(min(255, 240 * v)), int(min(255, 196 * v)))
    return png(pm, f)

def divine_glow(pm):
    """An even radiance, with the faintest breathing in it: the light IS the mutation."""
    size = pm.size
    def f(i, p):
        r = math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) / (size / 16)
        ring = 0.5 + 0.5 * math.sin(r * 6.3)
        v = 0.88 + 0.12 * ring
        return (int(255 * v), int(232 * v), int(160 * v))
    return png(pm, f)

def phantom_glow(pm):
    """Wisps, not a wash: an ectoplasm is thicker in places and that is what makes it read."""
    size = pm.size
    def f(i, p):
        n = 0.55 * noise3((p[0], p[1] * 0.6, p[2]), size / 3, 111) + 0.45 * noise3(p, size / 8, 112)
        k = clamp((n - 0.42) / 0.3)
        return (int(60 * k), int(230 * k), int(140 * k))
    return png(pm, f)

FANCY = {
    5: {'albedo_tex': lava_albedo, 'emissive_tex': lava_glow, 'emissive': (0.8, 0.8, 0.8), 'base': (1, 1, 1), 'metallic': 0.0, 'roughness': 0.75},  # crust with glowing cracks
    9: {'albedo_tex': cursed_albedo, 'emissive_tex': cursed_veins, 'emissive': (0.35, 0.35, 0.35), 'base': (1, 1, 1), 'metallic': 0.1, 'roughness': 0.5},  # deep violet with faint veins
    6: {'albedo_tex': galaxy_albedo, 'emissive_tex': galaxy_stars, 'emissive': (0.9, 0.8, 1.0), 'base': (1, 1, 1), 'metallic': 0.0, 'roughness': 0.5},
    7: {'albedo_tex': yinyang_albedo, 'base': (1, 1, 1), 'metallic': 0.1, 'roughness': 0.35},
    1: {'albedo_tex': gold_albedo, 'albedo_tex_6': gold_martele, 'base': (1, 1, 1), 'metallic': 0.9, 'roughness': 0.25},  # poured, hammered on the Secret
    2: {'albedo_tex': diamond_albedo, 'base': (1, 1, 1), 'metallic': 0.35, 'roughness': 0.08},        # faceted
    3: {'albedo_tex': blood_albedo, 'base': (1, 1, 1), 'metallic': 0.0, 'roughness': 0.35},           # dried, with runs
    4: {'albedo_tex': candy_albedo, 'base': (1, 1, 1), 'metallic': 0.0, 'roughness': 0.4},            # striped
    # Radioactive: the surface is there but barely, because what says uranium is the
    # monochrome radiation, not the pitting (owner, 5 Sep). The painters below run at a third
    # of their first contrast.
    8: {'albedo_tex': radio_albedo, 'emissive_tex': radio_glow, 'emissive': (0.85, 0.85, 0.85), 'base': (1, 1, 1), 'metallic': 0.0, 'roughness': 0.45},
    10: {'albedo_tex': divine_albedo, 'emissive_tex': divine_glow, 'emissive': (0.55, 0.55, 0.55), 'base': (1, 1, 1), 'metallic': 0.35, 'roughness': 0.15},  # haloed
    11: {'albedo_tex': rainbow_albedo, 'emissive_tex': rainbow_albedo, 'emissive': (0.12, 0.12, 0.12), 'base': (0.9, 0.9, 0.9), 'metallic': 0.0, 'roughness': 0.4},
    12: {'base': (0.03, 0.10, 0.13), 'emissive_tex': cyber_lines, 'emissive': (0.7, 0.7, 0.7), 'metallic': 0.3, 'roughness': 0.3},
    13: {'base': (0.42, 1.0, 0.72), 'alpha': 0.4, 'emissive_tex': phantom_glow, 'emissive': (0.5, 0.5, 0.5), 'metallic': 0.0, 'roughness': 0.2}  # ectoplasm, wisped
}
_tex_cache = {}
def texture_bytes(fn, pm):
    key = (fn, id(pm))
    if key not in _tex_cache: _tex_cache[key] = fn(pm)
    return _tex_cache[key]

def embed_texture(js, bin_chunk, data):
    """Append a PNG to the binary chunk and register it; returns (texture index, new chunk)."""
    pad = b'\x00' * ((4 - len(bin_chunk) % 4) % 4)
    chunk = bin_chunk + pad
    js.setdefault('bufferViews', []).append({'buffer': 0, 'byteOffset': len(chunk), 'byteLength': len(data)})
    chunk += data
    js['buffers'][0]['byteLength'] = len(chunk)
    js.setdefault('images', []).append({'bufferView': len(js['bufferViews']) - 1, 'mimeType': 'image/png'})
    if not js.get('samplers'): js['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]
    js.setdefault('textures', []).append({'sampler': 0, 'source': len(js['images']) - 1})
    return len(js['textures']) - 1, chunk

def read_glb(path):
    b = open(path, 'rb').read()
    magic, version, length = struct.unpack('<III', b[:12])
    assert magic == 0x46546C67, path
    off = 12
    clen, ctype = struct.unpack('<II', b[off:off + 8])
    js = json.loads(b[off + 8:off + 8 + clen]); off += 8 + clen
    blen, btype = struct.unpack('<II', b[off:off + 8])
    return js, b[off + 8:off + 8 + blen]

def write_glb(path, js, bin_chunk):
    j = json.dumps(js, separators=(',', ':')).encode()
    j += b' ' * ((4 - len(j) % 4) % 4)
    bpad = bin_chunk + b'\x00' * ((4 - len(bin_chunk) % 4) % 4)
    total = 12 + 8 + len(j) + 8 + len(bpad)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(j), 0x4E4F534A)); f.write(j)
        f.write(struct.pack('<II', len(bpad), 0x004E4942)); f.write(bpad)

def bake(js, rarity, mutation, bin_chunk, pm):
    if mutation in FANCY:
        return bake_fancy(js, rarity, mutation, bin_chunk, pm)
    base, metallic, roughness, emissive, strength = recipe(rarity, mutation)
    out = json.loads(json.dumps(js))
    # The baked texture was dark and hid the colour; the colour IS the material now.
    for k in ('textures', 'images', 'samplers', 'extensionsUsed'):
        out.pop(k, None)
    mats = []
    for m in out.get('materials', [{}]):
        nm = {'name': f'piece-{rarity}-{mutation}', 'doubleSided': bool(m.get('doubleSided', True)),
              'pbrMetallicRoughness': {'baseColorFactor': [*base, 1.0], 'metallicFactor': metallic, 'roughnessFactor': roughness}}
        if emissive is not None and strength > 0:
            nm['emissiveFactor'] = [min(1.0, max(0.0, c)) for c in emissive]
        mats.append(nm)
    out['materials'] = mats
    return out, bin_chunk

def bake_fancy(js, rarity, mutation, bin_chunk, pm):
    f = FANCY[mutation]
    glow = RARITIES[rarity][1]
    eclat = 0 if glow <= 0 else (glow ** 1.5) * 0.9
    lueur = min(1.0, eclat * EMISSIVE_SCALE)
    out = json.loads(json.dumps(js)); chunk = bin_chunk
    for k in ('textures', 'images', 'samplers', 'extensionsUsed'):
        out.pop(k, None)
    pbr = {'baseColorFactor': [*f['base'], f.get('alpha', 1.0)], 'metallicFactor': f['metallic'], 'roughnessFactor': f['roughness']}
    if 'albedo_tex' in f:
        # A recipe may carry a painter for one rung: `albedo_tex_<rarity>` wins where it exists.
        peintre = f.get(f'albedo_tex_{rarity}', f['albedo_tex'])
        idx, chunk = embed_texture(out, chunk, texture_bytes(peintre, pm)); pbr['baseColorTexture'] = {'index': idx}
    nm = {'name': f'piece-{rarity}-{mutation}', 'doubleSided': True, 'pbrMetallicRoughness': pbr}
    if 'alpha' in f: nm['alphaMode'] = 'BLEND'
    em = f.get('emissive')
    if em is not None:
        scale = f.get('emissive_scale', 1.0)
        # The mutation's own glow, plus the rarity's hint on top, never above one.
        nm['emissiveFactor'] = [min(1.0, c * scale + c * lueur) for c in em]
        if 'emissive_tex' in f:
            idx, chunk = embed_texture(out, chunk, texture_bytes(f['emissive_tex'], pm)); nm['emissiveTexture'] = {'index': idx}
    out['materials'] = [nm for _ in js.get('materials', [{}])]
    return out, chunk

def une_rarete(args):
    """One rung, start to finish: its own UV repack, its own painters, its own files.

    A rung shares nothing with the others, so this is what gets handed to a worker.
    """
    r, mutations_seules = args
    src = os.path.join(TOY, f'item-{r}.glb')
    js, bin_chunk = repack_uvs(*read_glb(src))
    pm = PositionMap(js, bin_chunk)
    print(f'item-{r}: {pm.painted / len(pm.pos):.0%} of the atlas painted', flush=True)
    made = 0
    for m in range(len(MUTATIONS)):
        if mutations_seules and m not in mutations_seules: continue
        out, chunk = bake(js, r, m, bin_chunk, pm)
        write_glb(os.path.join(TOY, f'item-{r}-{m}.glb'), out, chunk)
        made += 1
    return made


def main():
    """
    Bake, one process per rung.

    The painters run in pure Python over a 512 by 512 object-space map, three to eight octaves
    of noise a texel: about 33 million texels for the whole set, which is minutes rather than
    seconds and had the owner asking whether something was wrong (5 Sep). Nothing is wrong, it
    is simply a lot of arithmetic. The rungs are independent, so they go to a pool and the wall
    clock divides by however many cores the machine has.

    Two filters keep an iteration honest: a bare number bakes one rung, `m<N>` bakes one
    mutation across all of them. Changing a single recipe is `m10`, not the whole set.
    """
    seules = {int(a) for a in sys.argv[1:] if a.isdigit()}
    mutations_seules = {int(a[1:]) for a in sys.argv[1:] if a.startswith('m')}
    rangs = [r for r in range(len(RARITIES)) if not seules or r in seules]
    taches = [(r, mutations_seules) for r in rangs]
    if len(taches) == 1:
        made = une_rarete(taches[0])
    else:
        with ProcessPoolExecutor(max_workers=min(len(taches), os.cpu_count() or 1)) as pool:
            made = sum(pool.map(une_rarete, taches))
    print(f'{made} variants written to {os.path.relpath(TOY)}')

if __name__ == '__main__':
    main()
