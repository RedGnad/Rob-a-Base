#!/usr/bin/env python3
"""
The rampart: a tall textured wall around the whole field, in place of the 3.2 m rim.

Why. The rim was low enough that the horizon of every capture was the landscape Decentraland
generates around a World, in its own default colours, not ours (owner, 30 Oct). Turning that
landscape off (`landscapeTerrain: false` in scene.json) leaves the sky, and a wall tall enough
to close the view becomes the horizon. Nothing can stand outside the parcels (geometry past the
scene edge is not rendered), so the horizon has to be the wall itself.

The footprint is the hard rule. A base's centre may stand 9 m from the edge (`EDGE_MARGIN`), so
its walls come to 2 m and its door to about 1.3 m. Every piece here stays within 1.3 m of the
edge at every height: the rampart gains height, never depth, and takes no ground from the
field.

Everything is ONE mesh with ONE material and ONE texture. The texture is indexed by HEIGHT: a
row of the image is a height on the wall, the same everywhere, and it repeats along the wall
every `TILE` metres. So the chess frieze and the yellow coping run as continuous bands round
the whole field and round every tower, and a box needs no UV logic beyond "u along, v up".

Run: python3 tools/model/build-rampart.py
"""
import hashlib
import os
from importlib import util as _u

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _u.spec_from_file_location('aplatir', os.path.join(HERE, 'aplatir-glb.py'))
aplatir = _u.module_from_spec(_spec)
_spec.loader.exec_module(aplatir)
_spec2 = _u.spec_from_file_location('blocs', os.path.join(HERE, 'blocs.py'))
blocs = _u.module_from_spec(_spec2)
_spec2.loader.exec_module(blocs)

OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'assets', 'Models'))
GLB = 'rampart.glb'
PNG = 'rampart.png'

# src/shared/schemas.ts
SIDE = 192.0
# The deepest any piece may reach from the edge: a base's door can come to about 1.3 m.
DEPTH = 1.3

# The texture: TILE metres wide, TEX_TOP metres tall, PX pixels per metre.
TILE = 4.0
TEX_TOP = 21.0
PX = 64

# Heights, in metres. The wall runs to its coping; towers rise above it with their own.
PLINTH_TOP = 0.8
WALL_TOP = 12.0
TOWER_TOP = 18.8
COPING = 0.4
MERLON = 1.4
# Height bands of the texture, bottom to top: (from, to, kind).
BANDS = [
    (0.0, PLINTH_TOP, 'plinth'),
    (PLINTH_TOP, 9.6, 'masonry'),
    (9.6, 10.6, 'frieze'),
    (10.6, WALL_TOP, 'masonry'),
    (WALL_TOP, WALL_TOP + COPING, 'coping'),
    (WALL_TOP + COPING, 17.6, 'masonry'),
    (17.6, 18.6, 'frieze'),
    (18.6, TOWER_TOP, 'masonry'),
    (TOWER_TOP, TOWER_TOP + COPING, 'coping'),
    (TOWER_TOP + COPING, TEX_TOP, 'masonry'),
]

# The palette of src/client/toy.ts where it exists (wall cream, ramp yellow), and the two
# squares of a wooden chessboard for the frieze.
CREAM = (242, 233, 216)
MORTAR = (214, 202, 180)
PLINTH = (206, 194, 172)
YELLOW = (255, 210, 63)
YELLOW_DARK = (222, 168, 34)
BOARD_LIGHT = (240, 217, 181)
BOARD_DARK = (181, 136, 99)
FRAME = (122, 88, 58)

# Towers: the four corners, and three along each side. (centre along the side, width).
TOWERS = [(3.5, 7.0), (48.0, 8.0), (96.0, 10.0), (144.0, 8.0), (SIDE - 3.5, 7.0)]


def jitter(*key):
    """A stable number in [-1, 1] for a block, so the wall is the same wall on every build."""
    h = hashlib.md5(repr(key).encode()).digest()
    return (h[0] / 255.0) * 2 - 1


def shade(c, k):
    return tuple(max(0, min(255, int(round(v * k)))) for v in c)


def band_at(y):
    for (a, b, kind) in BANDS:
        if a <= y < b:
            return a, b, kind
    return BANDS[-1]


def texel(xm, ym):
    """The colour at `xm` metres along the tile and `ym` metres up the wall."""
    a, b, kind = band_at(ym)
    local = ym - a
    if kind == 'coping':
        # A yellow lip, lit on top, with a darker line where it meets the wall below.
        if local < 0.06:
            return YELLOW_DARK
        return shade(YELLOW, 1.06) if local > b - a - 0.06 else YELLOW
    if kind == 'frieze':
        if local < 0.06 or local > (b - a) - 0.06:
            return FRAME
        col, row = int(xm // 0.5), int((local - 0.06) // 0.44)
        c = BOARD_LIGHT if (col + row) % 2 == 0 else BOARD_DARK
        # A soft bevel on each square, so the band reads as tiles, not as paint.
        fx, fy = (xm % 0.5) / 0.5, ((local - 0.06) % 0.44) / 0.44
        if fx < 0.06 or fy > 0.94:
            return shade(c, 1.08)
        if fx > 0.94 or fy < 0.06:
            return shade(c, 0.9)
        return c
    if kind == 'plinth':
        block_w, row_h, row = 2.0, b - a, 0
        offset = 0.0
        base = PLINTH
    else:
        block_w, row_h = 1.0, 0.5
        row = int(local // row_h)
        offset = 0.5 if row % 2 else 0.0
        base = CREAM
    u = (xm + offset) % TILE
    block = int(u // block_w)
    fx, fy = (u % block_w) / block_w, (local % row_h) / row_h
    mortar = 0.03 / block_w, 0.03 / row_h
    if fx < mortar[0] or fy < mortar[1]:
        return MORTAR
    c = shade(base, 1 + 0.035 * jitter(kind, a, row, block))
    # The toy bevel: a lit upper edge and a shaded lower one on every block.
    if fy > 1 - 2.2 * mortar[1]:
        return shade(c, 1.05)
    if fy < 2.6 * mortar[1]:
        return shade(c, 0.93)
    return c


def texture():
    w, h = int(TILE * PX), int(TEX_TOP * PX)
    im = Image.new('RGB', (w, h))
    px = im.load()
    for j in range(h):
        # Row 0 is the TOP of the image, which glTF maps to v = 0.
        ym = TEX_TOP - (j + 0.5) / PX
        for i in range(w):
            px[i, j] = texel((i + 0.5) / PX, ym)
    return im


def v_of(y):
    return (TEX_TOP - y) / TEX_TOP


# Horizontal faces sample one flat row: the middle of the wall-top coping.
V_TOP = v_of(WALL_TOP + COPING / 2)
V_UNDER = v_of(PLINTH_TOP / 2)


class Mesh:
    def __init__(self):
        self.pos, self.nor, self.uv, self.idx = [], [], [], []

    def box(self, x0, x1, y0, y1, z0, z1):
        cx, cy, cz = (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2
        sx, sy, sz = x1 - x0, y1 - y0, z1 - z0
        for n, corners in blocs.FACES:
            base = len(self.pos)
            for s in corners:
                p = (cx + s[0] * sx / 2, cy + s[1] * sy / 2, cz + s[2] * sz / 2)
                self.pos.append(p)
                self.nor.append(n)
                if n[1] > 0:
                    self.uv.append((p[0] / TILE, V_TOP))
                elif n[1] < 0:
                    self.uv.append((p[0] / TILE, V_UNDER))
                elif n[2] != 0:
                    self.uv.append((p[0] / TILE, v_of(p[1])))
                else:
                    self.uv.append((p[2] / TILE, v_of(p[1])))
            self.idx.extend([base, base + 1, base + 2, base, base + 2, base + 3])

    def prim(self):
        return {'pos': self.pos, 'nor': self.nor, 'uv_atlas': self.uv, 'idx': self.idx}


def side_box(m, side, a0, a1, c0, c1, y0, y1):
    """A box given along the side (a) and inward from its edge (c), in world coordinates."""
    if side == 'south':
        m.box(a0, a1, y0, y1, c0, c1)
    elif side == 'north':
        m.box(a0, a1, y0, y1, SIDE - c1, SIDE - c0)
    elif side == 'west':
        m.box(c0, c1, y0, y1, a0, a1)
    else:
        m.box(SIDE - c1, SIDE - c0, y0, y1, a0, a1)


def merlons(m, side, a0, a1, y0, width, gap, c0, c1):
    """Crenellations between a0 and a1, centred so both ends finish on a merlon."""
    pitch = width + gap
    n = max(1, int((a1 - a0 + gap) // pitch))
    start = a0 + ((a1 - a0) - (n * pitch - gap)) / 2
    for k in range(n):
        b0 = start + k * pitch
        side_box(m, side, b0, b0 + width, c0, c1, y0, y0 + MERLON)


def build_side(m, side):
    # The plinth runs the whole length: the foot every other piece stands on.
    side_box(m, side, 0.0, SIDE, 0.0, DEPTH, 0.0, PLINTH_TOP)
    spans = []
    prev = 0.0
    for (centre, width) in TOWERS:
        t0, t1 = max(0.0, centre - width / 2), min(SIDE, centre + width / 2)
        # The tower: deeper than the wall, its coping the full depth.
        side_box(m, side, t0, t1, 0.0, DEPTH - 0.15, PLINTH_TOP, TOWER_TOP)
        side_box(m, side, t0, t1, 0.0, DEPTH, TOWER_TOP, TOWER_TOP + COPING)
        merlons(m, side, t0, t1, TOWER_TOP + COPING, 1.0, 1.0, 0.1, DEPTH - 0.25)
        if t0 > prev:
            spans.append((prev, t0))
        prev = t1
    for (s0, s1) in spans:
        # The run between two towers: wall, coping overhanging inward, crenellations.
        side_box(m, side, s0, s1, 0.0, 1.0, PLINTH_TOP, WALL_TOP)
        side_box(m, side, s0, s1, 0.0, DEPTH, WALL_TOP, WALL_TOP + COPING)
        merlons(m, side, s0, s1, WALL_TOP + COPING, 1.2, 1.2, 0.1, 0.9)
        # Pilasters on the inner face, up to the frieze: the rhythm along the run.
        n = int((s1 - s0) // 6.0)
        for k in range(1, n):
            a = s0 + k * (s1 - s0) / n
            side_box(m, side, a - 0.6, a + 0.6, 1.0, DEPTH, PLINTH_TOP, 9.6)


def main():
    os.makedirs(OUT, exist_ok=True)
    im = texture()
    im.save(os.path.join(OUT, PNG), format='PNG', optimize=True)
    m = Mesh()
    for side in ('south', 'north', 'west', 'east'):
        build_side(m, side)
    prim = m.prim()
    size = aplatir.ecrire_glb(os.path.join(OUT, GLB), [(False, [prim])], im, image_uri=PNG)
    xs = [p[0] for p in m.pos]
    zs = [p[2] for p in m.pos]
    ys = [p[1] for p in m.pos]
    print(f'{GLB}  {size / 1024:.1f} KB  {len(prim["idx"]) // 3} triangles, 1 material')
    print(f'  x {min(xs):.2f}..{max(xs):.2f}   y {min(ys):.2f}..{max(ys):.2f}   z {min(zs):.2f}..{max(zs):.2f}')
    print(f'  {PNG}  {im.width}x{im.height}')


if __name__ == '__main__':
    main()
