#!/usr/bin/env python3
"""
The picture of a piece, rendered from the piece itself, mutation included.

The reveal, the roulette and every shelf list drew a flat chess glyph: a pawn, a knight, a
star, vector shapes chosen before the game had its own models. They are not what the player
wins. The toy that lands on the shelf is `assets/toy/item-<rarity>-<mutation>.glb`, a real
chess piece with a real silhouette, and next to it the flat glyph reads as a placeholder
(owner, 5 Sep: "des logos generiques... un peu fades").

The first pass here rendered one picture per RARITY and painted it with that rarity's flat
colour, because the models were untinted then. They are not any more: every one of the ninety
eight variants carries its own baked surface, hammered gold, cut diamond, radiant divine. Seven
pictures for ninety eight pieces meant the interface showed a plain Secret multiplied by the
Cursed colour and it read as a solid blob (owner, 5 Sep: "on dirait une couleur unie ? chaque
rarity et mutation a son image finale n'est-ce pas ?").

So this reads the file's OWN materials: base colour factor, base colour texture, emissive
factor, emissive texture, sampled through the interpolated UV of each triangle, exactly as the
renderer will. Nothing is invented and nothing is tinted afterwards. The halo behind the
silhouette is the one thing added, because the cards draw the picture with no glow of their own
and the rung has to read before the shape does.

One orthographic view, a key light, a fill and a rim, then the outline in the interface's ink.

    python3 tools/model/render-item-thumbs.py            # all 98 variants
    python3 tools/model/render-item-thumbs.py 6 1        # one: rarity 6, mutation 1
"""
import io
import json
import math
import os
import struct
import sys
from concurrent.futures import ProcessPoolExecutor

from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
TOY = os.path.join(HERE, '..', '..', 'assets', 'toy')
UI = os.path.join(HERE, '..', '..', 'assets', 'ui')

N = 256
# Three samples per pixel each way: the edges of a chess piece are all curve.
SS = 3
# The piece fills this share of the frame, matching what the glyphs did.
FILL = 0.92
# Seen from slightly to the left and slightly above, the angle a display case uses, then
# tipped in the plane of the picture. A piece standing perfectly upright reads as an
# inventory entry; the same piece leaning reads as an object being handed to you, and the
# diagonal is what catches the eye first (owner, 5 Sep: "un peu en biais, ca accroche plus").
YAW = math.radians(30)
PITCH = math.radians(14)
ROLL = math.radians(9)
# The key comes from the upper left, the fill from behind the camera, the rim draws the edge.
KEY = (-0.45, 0.78, 0.44)
AMBIENT = 0.42
RIM = 0.42
# The client reads a glTF emissive far hotter than this rasteriser does: the variants are baked
# with a DARK albedo under a bounded glow (see build-item-variants.py), so replayed literally a
# Divine would come out near black. This is the factor that puts the picture back where the
# player sees the piece in game.
EMISSIVE_BOOST = 3.0
# A mild lift on the finished pixel: the rasteriser's midtones sit lower than the client's, and
# the cards it feeds are read at 52 to 172 pixels, where a dark piece is just a dark shape.
GAMMA = 0.85
# The outline keeps the piece readable on the card, which is itself washed with the rarity.
OUTLINE = (11, 16, 28)
OUTLINE_PX = 4
# src/shared/loot-table.ts RARITIES: the colour and the glow of each rung, kept in step by hand.
RARITIES = [('#78818e', 0.00), ('#4ec04e', 0.35), ('#3d8ef0', 0.80), ('#a855f7', 1.30),
            ('#f5a524', 2.00), ('#ff4d6d', 2.80), ('#ffffff', 4.00)]
# src/shared/loot-table.ts MUTATIONS (id 0 = plain: the rarity's own colour).
MUTATIONS = ['', '#ffd700', '#b9f2ff', '#6e0b14', '#ff9ecd', '#ff5722', '#5b2c8d', '#b6b6be',
             '#7fff00', '#3b0a45', '#ffe9a8', '#ff00ff', '#00e5ff', '#86ffd0']
# The halo, as a share of the frame and of full opacity: the glyphs carried one and the eye
# reads the rung by it before it reads the shape.
HALO_PX = 26
HALO_MAX = 0.55

ACCESSOR_FMT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
ACCESSOR_LEN = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def load_glb(path):
    data = open(path, 'rb').read()
    assert data[:4] == b'glTF', path
    off, js, bin_chunk = 12, None, b''
    while off < len(data):
        length, kind = struct.unpack_from('<II', data, off)
        off += 8
        chunk = data[off:off + length]
        off += length
        if kind == 0x4E4F534A:
            js = json.loads(chunk)
        else:
            bin_chunk = chunk
    return js, bin_chunk


def accessor(js, bin_chunk, i):
    a = js['accessors'][i]
    bv = js['bufferViews'][a['bufferView']]
    fmt, n = ACCESSOR_FMT[a['componentType']], ACCESSOR_LEN[a['type']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    size = struct.calcsize('<' + fmt * n)
    stride = bv.get('byteStride', size)
    return [struct.unpack_from('<' + fmt * n, bin_chunk, base + k * stride) for k in range(a['count'])]


def node_matrix(node):
    """A node's own transform, as a 4x4 in row-major order."""
    if 'matrix' in node:
        m = node['matrix']
        return [[m[0], m[4], m[8], m[12]], [m[1], m[5], m[9], m[13]],
                [m[2], m[6], m[10], m[14]], [m[3], m[7], m[11], m[15]]]
    t = node.get('translation', [0, 0, 0])
    r = node.get('rotation', [0, 0, 0, 1])
    s = node.get('scale', [1, 1, 1])
    x, y, z, w = r
    rot = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]
    ]
    return [[rot[i][j] * s[j] for j in range(3)] + [t[i]] for i in range(3)] + [[0, 0, 0, 1]]


def mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def apply(m, p):
    return tuple(m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3] for i in range(3))


def apply_dir(m, v):
    return tuple(m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2] for i in range(3))


def images(js, bin_chunk):
    """Every embedded PNG, decoded once, as (pixels, w, h) with three floats per texel."""
    out = []
    for img in js.get('images', []):
        bv = js['bufferViews'][img['bufferView']]
        base = bv.get('byteOffset', 0)
        raw = bin_chunk[base:base + bv['byteLength']]
        im = Image.open(io.BytesIO(raw)).convert('RGB')
        out.append((im.load(), im.width, im.height))
    return out


def texture_image(js, index):
    """The image a texture points at, through the sampler indirection."""
    tex = js['textures'][index]
    return tex.get('source', 0)


def surface(js, mat_index):
    """What a material paints: (base rgb, base image or None, emissive rgb, emissive image)."""
    if mat_index is None or mat_index >= len(js.get('materials', [])):
        return (1.0, 1.0, 1.0), None, (0.0, 0.0, 0.0), None
    m = js['materials'][mat_index]
    pbr = m.get('pbrMetallicRoughness', {})
    base = tuple(pbr.get('baseColorFactor', [1, 1, 1, 1])[:3])
    base_tex = pbr.get('baseColorTexture')
    em = tuple(m.get('emissiveFactor', [0, 0, 0]))
    em_tex = m.get('emissiveTexture')
    return (base,
            None if base_tex is None else texture_image(js, base_tex['index']),
            em,
            None if em_tex is None else texture_image(js, em_tex['index']))


def triangles(path):
    """Every triangle of the file in world space, with normals, UVs and its surface."""
    js, bin_chunk = load_glb(path)
    imgs = images(js, bin_chunk)
    out = []
    scene = js.get('scenes', [{}])[js.get('scene', 0)]
    roots = scene.get('nodes', range(len(js.get('nodes', []))))
    stack = [(i, [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]) for i in roots]
    while stack:
        idx, parent = stack.pop()
        node = js['nodes'][idx]
        world = mul(parent, node_matrix(node))
        for child in node.get('children', []):
            stack.append((child, world))
        if 'mesh' not in node:
            continue
        for prim in js['meshes'][node['mesh']]['primitives']:
            att = prim['attributes']
            pos = accessor(js, bin_chunk, att['POSITION'])
            nor = accessor(js, bin_chunk, att['NORMAL']) if 'NORMAL' in att else None
            uvs = accessor(js, bin_chunk, att['TEXCOORD_0']) if 'TEXCOORD_0' in att else None
            surf = surface(js, prim.get('material'))
            idxs = [t[0] for t in accessor(js, bin_chunk, prim['indices'])]
            for k in range(0, len(idxs), 3):
                tri = []
                for v in idxs[k:k + 3]:
                    p = apply(world, pos[v])
                    n = apply_dir(world, nor[v]) if nor else (0.0, 1.0, 0.0)
                    length = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) or 1.0
                    tri.append((p, (n[0] / length, n[1] / length, n[2] / length),
                                uvs[v] if uvs else (0.0, 0.0)))
                out.append((tri, surf))
    return out, imgs


def sample(imgs, index, u, v):
    """Nearest texel, wrapped: the baked patterns are noise and cracks, not lettering."""
    px, w, h = imgs[index]
    x = int(u * w) % w
    y = int((1 - v) * h) % h
    r, g, b = px[x, y]
    return r / 255.0, g / 255.0, b / 255.0


def view(p):
    """World to camera: yaw, then pitch, then the tip in the picture plane."""
    cy, sy = math.cos(YAW), math.sin(YAW)
    cp, sp = math.cos(PITCH), math.sin(PITCH)
    cr, sr = math.cos(ROLL), math.sin(ROLL)
    x, y, z = p
    x, z = x * cy + z * sy, -x * sy + z * cy
    y, z = y * cp - z * sp, y * sp + z * cp
    x, y = x * cr - y * sr, x * sr + y * cr
    return x, y, z


def rgb(hex_colour):
    h = hex_colour.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def render(path, halo_colour, glow):
    raw, imgs = triangles(path)
    tris = [([(view(p), view(n), uv) for p, n, uv in t], s) for t, s in raw]
    xs = [v[0][0] for t, _ in tris for v in t]
    ys = [v[0][1] for t, _ in tris for v in t]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    scale = FILL * N * SS / max(max(xs) - min(xs), max(ys) - min(ys))

    size = N * SS
    pix = [(0.0, 0.0, 0.0)] * (size * size)
    cover = [0] * (size * size)
    depth = [-1e9] * (size * size)
    klen = math.sqrt(sum(c * c for c in KEY))
    key = tuple(c / klen for c in KEY)

    for tri, (base, base_tex, em, em_tex) in tris:
        pts = []
        for (p, n, uv) in tri:
            sx = (p[0] - cx) * scale + size / 2
            sy = size / 2 - (p[1] - cy) * scale
            pts.append((sx, sy, p[2], n, uv))
        (x0, y0, z0, n0, t0), (x1, y1, z1, n1, t1), (x2, y2, z2, n2, t2) = pts
        area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
        if area == 0:
            continue
        lo_x, hi_x = max(0, int(min(x0, x1, x2))), min(size - 1, int(max(x0, x1, x2)) + 1)
        lo_y, hi_y = max(0, int(min(y0, y1, y2))), min(size - 1, int(max(y0, y1, y2)) + 1)
        for py in range(lo_y, hi_y + 1):
            for px_ in range(lo_x, hi_x + 1):
                fx, fy = px_ + 0.5, py + 0.5
                w0 = ((x1 - fx) * (y2 - fy) - (x2 - fx) * (y1 - fy)) / area
                w1 = ((x2 - fx) * (y0 - fy) - (x0 - fx) * (y2 - fy)) / area
                w2 = 1 - w0 - w1
                if w0 < 0 or w1 < 0 or w2 < 0:
                    continue
                z = w0 * z0 + w1 * z1 + w2 * z2
                o = py * size + px_
                cover[o] = 1
                if z <= depth[o]:
                    continue
                depth[o] = z
                nx = w0 * n0[0] + w1 * n1[0] + w2 * n2[0]
                ny = w0 * n0[1] + w1 * n1[1] + w2 * n2[1]
                nz = w0 * n0[2] + w1 * n1[2] + w2 * n2[2]
                length = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
                nx, ny, nz = nx / length, ny / length, nz / length
                lam = max(0.0, nx * key[0] + ny * key[1] + nz * key[2])
                rim = RIM * (1 - min(1.0, abs(nz))) ** 2.5
                light = AMBIENT + (1 - AMBIENT) * lam + rim

                u = w0 * t0[0] + w1 * t1[0] + w2 * t2[0]
                v = w0 * t0[1] + w1 * t1[1] + w2 * t2[1]
                col = base if base_tex is None else tuple(
                    base[i] * sample(imgs, base_tex, u, v)[i] for i in range(3))
                glowc = em if em_tex is None else tuple(
                    em[i] * sample(imgs, em_tex, u, v)[i] for i in range(3))
                # The glow takes half of the lighting too. A radiant piece is lit evenly by
                # its own emissive, which on a card is a cut-out with no volume: half the
                # key light on the glow keeps the form readable without dimming the plastic
                # pieces, whose glow is nil (second sheet, 5 Sep: Divine pure white).
                pix[o] = tuple(col[i] * light + glowc[i] * EMISSIVE_BOOST * (0.5 + 0.5 * light)
                               for i in range(3))

    # Exposure per picture, within bounds. A Divine or a plain Secret is a radiant surface, and
    # summed literally it clipped to a white cut-out with no volume at all; a Cursed sat near
    # black. The card wants the piece READABLE: the brightest percentile of the piece lands at
    # white, never brightened by more than half nor darkened below a third, so a radiant piece
    # keeps its shading and a dark one keeps its darkness (first sheet, 5 Sep).
    lit = sorted(max(c) for c, k in zip(pix, cover) if k)
    p99 = lit[int(0.99 * (len(lit) - 1))] if lit else 1.0
    expo = max(0.2, min(1.6, 1.0 / max(1e-6, p99)))
    body = Image.new('RGB', (size, size), (0, 0, 0))
    alpha = Image.new('L', (size, size), 0)
    body.putdata([tuple(int(255 * min(1.0, v * expo) ** GAMMA) for v in c) for c in pix])
    alpha.putdata([255 if c else 0 for c in cover])
    body = body.resize((N, N), Image.LANCZOS)
    alpha = alpha.resize((N, N), Image.LANCZOS)
    tint = body.convert('RGBA')
    tint.putalpha(alpha)

    out = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    if glow > 0:
        r, g, b = halo_colour
        halo = Image.new('RGBA', (N, N), (r, g, b, 0))
        spread = alpha.filter(ImageFilter.GaussianBlur(HALO_PX * min(1.0, 0.4 + glow / 4)))
        halo.putalpha(spread.point(lambda v: int(v * min(HALO_MAX, 0.18 + glow * 0.11))))
        out.alpha_composite(halo)
    # The outline: the silhouette grown by a few pixels, in the interface's own dark ink.
    grown = alpha.filter(ImageFilter.MaxFilter(OUTLINE_PX * 2 + 1))
    edge = Image.new('RGBA', (N, N), OUTLINE + (0,))
    edge.putalpha(grown)
    out.alpha_composite(edge)
    out.alpha_composite(tint)
    return out


def une(job):
    rarity, mutation = job
    src = os.path.join(TOY, f'item-{rarity}-{mutation}.glb')
    if not os.path.exists(src):
        return f'  item-{rarity}-{mutation}.glb missing'
    colour = MUTATIONS[mutation] if mutation > 0 else RARITIES[rarity][0]
    img = render(src, rgb(colour), RARITIES[rarity][1])
    img.save(os.path.join(UI, f'toy-{rarity}-{mutation}.png'), optimize=True)
    if mutation == 0:
        # The strip spins on rarities alone, so the plain piece keeps its short name too.
        img.save(os.path.join(UI, f'toy-{rarity}.png'), optimize=True)
    return f'  toy-{rarity}-{mutation}.png'


def main():
    if len(sys.argv) == 3:
        print(une((int(sys.argv[1]), int(sys.argv[2]))))
        return
    jobs = [(r, m) for r in range(7) for m in range(len(MUTATIONS))]
    with ProcessPoolExecutor() as pool:
        for line in pool.map(une, jobs):
            print(line)


if __name__ == '__main__':
    main()
