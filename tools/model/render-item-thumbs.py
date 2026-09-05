#!/usr/bin/env python3
"""
The picture of a piece, rendered from the piece itself.

The reveal, the roulette and every shelf list drew a flat chess glyph: a pawn, a knight, a
star, vector shapes chosen before the game had its own models. They are not what the player
wins. The toy that lands on the shelf is `assets/toy/item-<rarity>-<mutation>.glb`, a real
chess piece with a real silhouette, and next to it the flat glyph reads as a placeholder
(owner, 5 Sep: "des logos generiques... un peu fades").

So the thumbnail is rendered FROM the model, offline, by this file: no runtime cost changes at
all, since it writes the same seven pictures under the same names. One orthographic view, a key
light, a fill and a rim, then the rarity's own colour and its halo baked in, because that is
what the files being replaced carried: the cards draw them with no tint of their own, on a
plate already washed with the same rarity colour, and a white piece there would vanish.

Why not just show the model in the reveal: because a scene's UI always draws over the world,
so a 3D piece there needs a hole in the panel and a backdrop of its own. That is a separate
question, and it is not a budget question: these models are 660 to 1224 triangles against the
261 k the field already spends of a million.

    python3 tools/model/render-item-thumbs.py
"""
import json
import math
import os
import struct

from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
TOY = os.path.join(HERE, '..', '..', 'assets', 'toy')
UI = os.path.join(HERE, '..', '..', 'assets', 'ui')

N = 256
# Three samples per pixel each way: the edges of a chess piece are all curve.
SS = 3
# The piece fills this share of the frame, matching what the glyphs did.
FILL = 0.92
# Seen from slightly to the left and slightly above, the angle a display case uses.
YAW = math.radians(24)
PITCH = math.radians(14)
# The key comes from the upper left, the fill from behind the camera, the rim draws the edge.
KEY = (-0.45, 0.78, 0.44)
AMBIENT = 0.34
RIM = 0.55
# The outline keeps the piece readable on the card, which is itself washed with the rarity.
OUTLINE = (11, 16, 28)
OUTLINE_PX = 4
# src/shared/loot-table.ts RARITIES: the colour and the glow of each rung, kept in step by hand.
RARITIES = [('#78818e', 0.00), ('#4ec04e', 0.35), ('#3d8ef0', 0.80), ('#a855f7', 1.30),
            ('#f5a524', 2.00), ('#ff4d6d', 2.80), ('#ffffff', 4.00)]
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


def triangles(path):
    """Every triangle of the file in world space, with its vertex normals."""
    js, bin_chunk = load_glb(path)
    out = []
    scene = js.get('scenes', [{}])[js.get('scene', 0)]
    stack = [(i, [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]) for i in scene.get('nodes', range(len(js.get('nodes', []))))]
    while stack:
        idx, parent = stack.pop()
        node = js['nodes'][idx]
        world = mul(parent, node_matrix(node))
        for child in node.get('children', []):
            stack.append((child, world))
        if 'mesh' not in node:
            continue
        for prim in js['meshes'][node['mesh']]['primitives']:
            pos = accessor(js, bin_chunk, prim['attributes']['POSITION'])
            nor = accessor(js, bin_chunk, prim['attributes']['NORMAL']) if 'NORMAL' in prim['attributes'] else None
            idxs = [t[0] for t in accessor(js, bin_chunk, prim['indices'])]
            for k in range(0, len(idxs), 3):
                tri = []
                for v in idxs[k:k + 3]:
                    p = apply(world, pos[v])
                    n = apply_dir(world, nor[v]) if nor else (0.0, 1.0, 0.0)
                    length = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) or 1.0
                    tri.append((p, (n[0] / length, n[1] / length, n[2] / length)))
                out.append(tri)
    return out


def view(p):
    """World to camera: yaw, then pitch, looking down the negative z of the result."""
    cy, sy = math.cos(YAW), math.sin(YAW)
    cp, sp = math.cos(PITCH), math.sin(PITCH)
    x, y, z = p
    x, z = x * cy + z * sy, -x * sy + z * cy
    y, z = y * cp - z * sp, y * sp + z * cp
    return x, y, z


def rgb(hex_colour):
    h = hex_colour.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def render(path, colour, glow):
    tris = [[(view(p), view(n)) for p, n in t] for t in triangles(path)]
    xs = [v[0][0] for t in tris for v in t]
    ys = [v[0][1] for t in tris for v in t]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    scale = FILL * N * SS / max(max(xs) - min(xs), max(ys) - min(ys))

    size = N * SS
    shade = [0.0] * (size * size)
    cover = [0] * (size * size)
    depth = [-1e9] * (size * size)
    klen = math.sqrt(sum(c * c for c in KEY))
    key = tuple(c / klen for c in KEY)

    for tri in tris:
        pts = []
        for (p, n) in tri:
            sx = (p[0] - cx) * scale + size / 2
            sy = size / 2 - (p[1] - cy) * scale
            pts.append((sx, sy, p[2], n))
        (x0, y0, z0, n0), (x1, y1, z1, n1), (x2, y2, z2, n2) = pts
        area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
        if area == 0:
            continue
        lo_x, hi_x = max(0, int(min(x0, x1, x2))), min(size - 1, int(max(x0, x1, x2)) + 1)
        lo_y, hi_y = max(0, int(min(y0, y1, y2))), min(size - 1, int(max(y0, y1, y2)) + 1)
        for py in range(lo_y, hi_y + 1):
            for px in range(lo_x, hi_x + 1):
                fx, fy = px + 0.5, py + 0.5
                w0 = ((x1 - fx) * (y2 - fy) - (x2 - fx) * (y1 - fy)) / area
                w1 = ((x2 - fx) * (y0 - fy) - (x0 - fx) * (y2 - fy)) / area
                w2 = 1 - w0 - w1
                if w0 < 0 or w1 < 0 or w2 < 0:
                    continue
                z = w0 * z0 + w1 * z1 + w2 * z2
                o = py * size + px
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
                shade[o] = min(1.0, AMBIENT + (1 - AMBIENT) * lam + rim)

    light = Image.new('L', (size, size), 0)
    alpha = Image.new('L', (size, size), 0)
    light.putdata([int(255 * v) for v in shade])
    alpha.putdata([255 if c else 0 for c in cover])
    light = light.resize((N, N), Image.LANCZOS)
    alpha = alpha.resize((N, N), Image.LANCZOS)

    # The rung's colour over the shading, so the piece keeps its volume and gains its hue.
    r, g, b = rgb(colour)
    tint = Image.merge('RGBA', (
        light.point(lambda v: v * r // 255),
        light.point(lambda v: v * g // 255),
        light.point(lambda v: v * b // 255),
        alpha))

    out = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    if glow > 0:
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


def main():
    for rarity in range(7):
        src = os.path.join(TOY, f'item-{rarity}-0.glb')
        if not os.path.exists(src):
            print(f'  item-{rarity}-0.glb missing, kept the old picture')
            continue
        colour, glow = RARITIES[rarity]
        img = render(src, colour, glow)
        dst = os.path.join(UI, f'toy-{rarity}.png')
        img.save(dst, optimize=True)
        print(f'  toy-{rarity}.png from item-{rarity}-0.glb')


if __name__ == '__main__':
    main()
