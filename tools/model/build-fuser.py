#!/usr/bin/env python3
"""
The fuser, as a small steam machine: a riveted copper boiler with three funnels, a porthole,
a pressure gauge, a chimney and an output chute.

Why. The fuser was a red drum on a plinth with a floating ball: it read as "some object", not
as a machine that turns three pieces into one (founder, 17 Nov 2026, asking for steampunk
machinery or at least something that evokes a fusing machine). Every part here says one rule
of the fusion, so the look is also the explanation:

  - three funnels on top, one per piece to feed (`FUSION_NEEDS` is 3); the scene drops a lit
    ball into a funnel for each piece the player has fed, in the piece's rarity colour;
  - a porthole on the front, where the scene spins the piece being fused, lit from behind;
  - a pressure gauge whose needle the scene turns a third of the way per piece fed;
  - a chimney the scene breathes steam from, and blows a puff out of at each fusion;
  - a chute on the side, where the new piece comes out.

This file builds only the fixed body. The parts that change (the funnel balls, the needle, the
porthole's back light, the piece, the steam) are entities of their own in
`src/client/fusion.ts`, placed with the numbers below, which that file repeats.

Same recipe as the belt and the rampart (`blocs.py`): ONE mesh, ONE material, a strip of solid
colour swatches, detail in geometry. In the toy palette of the game: brass and copper are
plastic colours, not metal textures.

Front is -Z. The scene turns the whole machine to face the plaza. Units are the machine's own;
the scene scales the root by `FUSION_ECHELLE` (1.35).

Run: python3 tools/model/build-fuser.py
"""
import math
import os
from importlib import util as _u

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _u.spec_from_file_location('aplatir', os.path.join(HERE, 'aplatir-glb.py'))
aplatir = _u.module_from_spec(_spec)
_spec.loader.exec_module(aplatir)
_spec2 = _u.spec_from_file_location('blocs', os.path.join(HERE, 'blocs.py'))
blocs = _u.module_from_spec(_spec2)
_spec2.loader.exec_module(blocs)

OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'assets', 'Models'))
GLB = 'fuser.glb'
PNG = 'fuser-colours.png'

COLOURS = ['#3b3740', '#c8743c', '#8f4a26', '#e0b64a', '#f2e9d8', '#1d1b22', '#8d99ae']
IRON, COPPER, COPPER_DARK, BRASS, CREAM, DARK, STEEL = range(len(COLOURS))

# The body. Repeated in src/client/fusion.ts for the parts the scene moves.
PLINTH_TOP = 0.3
BOILER_R = 0.85
BOILER_TOP = 2.0
SHOULDER_TOP = 2.35
SHOULDER_R = 0.5
FUNNEL_X = (-0.55, 0.0, 0.55)
FUNNEL_Z = -0.25
FUNNEL_TOP = 2.86
CHIMNEY = (0.0, 0.42)          # x, z
CHIMNEY_TOP = 3.3
GAUGE_Y = 1.6
PORTHOLE_Y = 0.85
PORTHOLE_R = 0.29
FRONT = -BOILER_R               # the boiler's front face, on -Z

SIDES = 16


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def unit(v):
    n = math.sqrt(dot(v, v)) or 1.0
    return (v[0] / n, v[1] / n, v[2] / n)


def face(m, pts, colour, outward):
    """A flat polygon (3 or 4 points), wound so its normal agrees with `outward`."""
    n = cross(sub(pts[1], pts[0]), sub(pts[-1], pts[0]))
    if dot(n, outward) < 0:
        pts = list(reversed(pts))
        n = cross(sub(pts[1], pts[0]), sub(pts[-1], pts[0]))
    n = unit(n)
    base = len(m.pos)
    for p in pts:
        m.pos.append(p)
        m.nor.append(n)
        m.uv.append(blocs.uv(colour, m.n))
    m.idx.extend([base, base + 1, base + 2])
    if len(pts) == 4:
        m.idx.extend([base, base + 2, base + 3])


def frustum_y(m, cx, cz, y0, y1, r0, r1, colour, cap0=True, cap1=True, sides=SIDES):
    """An upright drum or cone, radius r0 at y0 and r1 at y1."""
    def p(a, y, r):
        return (cx + r * math.cos(a), y, cz + r * math.sin(a))
    for i in range(sides):
        a0 = 2 * math.pi * i / sides
        a1 = 2 * math.pi * (i + 1) / sides
        am = (a0 + a1) / 2
        face(m, [p(a0, y0, r0), p(a1, y0, r0), p(a1, y1, r1), p(a0, y1, r1)], colour, (math.cos(am), 0, math.sin(am)))
        if cap0:
            face(m, [(cx, y0, cz), p(a0, y0, r0), p(a1, y0, r0)], colour, (0, -1, 0))
        if cap1:
            face(m, [(cx, y1, cz), p(a0, y1, r1), p(a1, y1, r1)], colour, (0, 1, 0))


def drum_z(m, cx, cy, z0, z1, r, colour, sides=SIDES):
    """A disc or a short drum lying on the front face, its axis along Z, z0 the front."""
    def p(a, z):
        return (cx + r * math.cos(a), cy + r * math.sin(a), z)
    for i in range(sides):
        a0 = 2 * math.pi * i / sides
        a1 = 2 * math.pi * (i + 1) / sides
        am = (a0 + a1) / 2
        face(m, [p(a0, z0), p(a1, z0), p(a1, z1), p(a0, z1)], colour, (math.cos(am), math.sin(am), 0))
        face(m, [(cx, cy, z0), p(a0, z0), p(a1, z0)], colour, (0, 0, -1))
        face(m, [(cx, cy, z1), p(a0, z1), p(a1, z1)], colour, (0, 0, 1))


def ring_z(m, cx, cy, z0, z1, r_in, r_out, colour, sides=SIDES):
    """An open brass tube on the front face: the porthole's frame, which the eye looks into."""
    def p(a, z, r):
        return (cx + r * math.cos(a), cy + r * math.sin(a), z)
    for i in range(sides):
        a0 = 2 * math.pi * i / sides
        a1 = 2 * math.pi * (i + 1) / sides
        am = (a0 + a1) / 2
        out = (math.cos(am), math.sin(am), 0)
        face(m, [p(a0, z0, r_out), p(a1, z0, r_out), p(a1, z1, r_out), p(a0, z1, r_out)], colour, out)
        face(m, [p(a0, z0, r_in), p(a1, z0, r_in), p(a1, z1, r_in), p(a0, z1, r_in)], colour, (-out[0], -out[1], 0))
        face(m, [p(a0, z0, r_in), p(a1, z0, r_in), p(a1, z0, r_out), p(a0, z0, r_out)], colour, (0, 0, -1))


def band_y(m, y, r, h, colour):
    """A riveted band round the boiler, standing just proud of it."""
    frustum_y(m, 0, 0, y - h / 2, y + h / 2, r, r, colour, cap0=False, cap1=False, sides=SIDES)


def build():
    m = blocs.Maillage(len(COLOURS))

    # Plinth: a dark iron step under a brass-trimmed second step.
    m.boite((0, 0.12, 0), (2.6, 0.24, 2.6), IRON)
    m.boite((0, 0.27, 0), (2.2, 0.06, 2.2), BRASS)

    # The boiler, its bands, its shoulder and the cap the funnels stand round.
    frustum_y(m, 0, 0, PLINTH_TOP, BOILER_TOP, BOILER_R, BOILER_R, COPPER, cap0=False, cap1=False)
    for y in (0.42, 1.27, 1.93):
        band_y(m, y, BOILER_R + 0.03, 0.07, BRASS)
    frustum_y(m, 0, 0, BOILER_TOP, SHOULDER_TOP, BOILER_R, SHOULDER_R, COPPER_DARK, cap0=False, cap1=False)
    frustum_y(m, 0, 0, SHOULDER_TOP, SHOULDER_TOP + 0.1, SHOULDER_R, SHOULDER_R - 0.08, BRASS, cap0=False)

    # Three funnels: a steel neck out of the shoulder, a brass cone, a rim.
    for x in FUNNEL_X:
        frustum_y(m, x, FUNNEL_Z, 2.15, 2.56, 0.07, 0.07, STEEL, cap0=False, cap1=False, sides=10)
        frustum_y(m, x, FUNNEL_Z, 2.55, FUNNEL_TOP - 0.03, 0.07, 0.22, BRASS, cap0=False, cap1=False, sides=12)
        frustum_y(m, x, FUNNEL_Z, FUNNEL_TOP - 0.04, FUNNEL_TOP, 0.24, 0.24, BRASS, cap0=False, cap1=False, sides=12)
        # The funnel's dark inside, low enough for the scene's ball to sit on it.
        frustum_y(m, x, FUNNEL_Z, 2.66, 2.67, 0.12, 0.12, DARK, cap0=False, sides=12)

    # The chimney, behind the funnels, with a brass collar and a dark mouth.
    cx, cz = CHIMNEY
    frustum_y(m, cx, cz, 2.1, CHIMNEY_TOP, 0.14, 0.14, IRON, cap0=False, cap1=False, sides=12)
    frustum_y(m, cx, cz, CHIMNEY_TOP - 0.12, CHIMNEY_TOP + 0.02, 0.19, 0.19, BRASS, cap0=True, cap1=False, sides=12)
    frustum_y(m, cx, cz, CHIMNEY_TOP - 0.02, CHIMNEY_TOP - 0.01, 0.15, 0.15, DARK, cap0=False, sides=12)

    # The gauge: a brass bezel, a cream dial, three tick marks for the thirds and one at zero.
    drum_z(m, 0, GAUGE_Y, FRONT - 0.1, FRONT + 0.05, 0.25, BRASS)
    drum_z(m, 0, GAUGE_Y, FRONT - 0.115, FRONT - 0.1, 0.21, CREAM)
    for k in range(4):
        a = math.radians(210 - 80 * k)          # 210, 130, 50, -30 degrees: empty to full
        tx = 0.16 * math.cos(a)
        ty = GAUGE_Y + 0.16 * math.sin(a)
        m.boite((tx, ty, FRONT - 0.12), (0.035, 0.035, 0.01), DARK if k < 3 else COPPER_DARK)

    # The porthole: a dark window flush with the boiler inside an open brass tube.
    drum_z(m, 0, PORTHOLE_Y, FRONT - 0.03, FRONT + 0.05, PORTHOLE_R + 0.02, DARK)
    ring_z(m, 0, PORTHOLE_Y, FRONT - 0.3, FRONT + 0.02, PORTHOLE_R, PORTHOLE_R + 0.08, BRASS)

    # The chute on the +X side: a tray that slopes down and away, with two low walls.
    x0, x1 = BOILER_R - 0.05, BOILER_R + 0.6
    y0, y1 = 0.95, 0.6
    w = 0.22
    t = 0.04
    face(m, [(x0, y0, -w), (x1, y1, -w), (x1, y1, w), (x0, y0, w)], STEEL, (0.3, 1, 0))
    face(m, [(x0, y0 - t, -w), (x1, y1 - t, -w), (x1, y1 - t, w), (x0, y0 - t, w)], STEEL, (0, -1, 0))
    face(m, [(x1, y1, -w), (x1, y1 - t, -w), (x1, y1 - t, w), (x1, y1, w)], STEEL, (1, 0, 0))
    for z in (-w, w):
        s = 1 if z > 0 else -1
        face(m, [(x0, y0, z), (x1, y1, z), (x1, y1 + 0.12, z), (x0, y0 + 0.12, z)], BRASS, (0, 0, s))
        face(m, [(x0, y0, z - 0.02 * s), (x1, y1, z - 0.02 * s), (x1, y1 + 0.12, z - 0.02 * s), (x0, y0 + 0.12, z - 0.02 * s)], BRASS, (0, 0, -s))
    # The hatch the piece comes out of, dark, on the boiler above the chute.
    m.boite((BOILER_R - 0.02, y0 + 0.16, 0), (0.06, 0.26, 0.36), DARK)

    # A steam pipe from the shoulder down the back into the plinth, so the chimney has a feed.
    frustum_y(m, -0.62, 0.55, 0.3, 2.05, 0.06, 0.06, STEEL, cap0=False, cap1=True, sides=8)
    return m


def main():
    os.makedirs(OUT, exist_ok=True)
    atlas = blocs.atlas_couleurs(COLOURS)
    atlas.save(os.path.join(OUT, PNG), format='PNG', optimize=True)
    m = build()
    prim = m.prim()
    size = aplatir.ecrire_glb(os.path.join(OUT, GLB), [(False, [prim])], atlas, image_uri=PNG)
    (x0, x1), (y0, y1), (z0, z1) = m.bornes()
    print(f'{GLB}  {size / 1024:.1f} KB  {len(prim["idx"]) // 3} triangles')
    print(f'  x {x0:.2f}..{x1:.2f}   y {y0:.2f}..{y1:.2f}   z {z0:.2f}..{z1:.2f}')
    print(f'  {PNG}  {atlas.width}x{atlas.height}, {len(COLOURS)} colours, 1 material')


if __name__ == '__main__':
    main()
