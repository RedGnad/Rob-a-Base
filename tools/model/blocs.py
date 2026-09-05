#!/usr/bin/env python3
"""
Boxes, tapers and drums, and a colour swatch atlas: what our hand built props are made of.

Two tools now bake a prop out of the same handful of shapes (the belt, the perimeter wall), so
the shapes live here rather than in each of them. The pattern they share is the one the crates
introduced: geometry carries the detail, and colour comes from a strip of solid swatches a few
pixels wide, so a whole prop is ONE material however many colours it wears.

Why that matters is a budget fact, measured on the full field: 775 draw calls of a thousand and
295 materials of four hundred, against 27 percent of the triangle allowance. Detail added as
triangles inside one mesh is nearly free; the same detail added as separate entities is paid on
the two counters that are already tight.
"""
import math

from PIL import Image

SWATCH = 8

FACES = [
    ((0, 0, 1), [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]),
    ((0, 0, -1), [(1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)]),
    ((1, 0, 0), [(1, -1, 1), (1, -1, -1), (1, 1, -1), (1, 1, 1)]),
    ((-1, 0, 0), [(-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)]),
    ((0, 1, 0), [(-1, 1, 1), (1, 1, 1), (1, 1, -1), (-1, 1, -1)]),
    ((0, -1, 0), [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)])
]


def atlas_couleurs(couleurs):
    """One solid swatch per colour, in a row. Eight pixels each is plenty for a flat fill."""
    im = Image.new('RGBA', (SWATCH * len(couleurs), SWATCH), (0, 0, 0, 255))
    for i, h in enumerate(couleurs):
        c = tuple(int(h.lstrip('#')[k:k + 2], 16) for k in (0, 2, 4))
        for x in range(SWATCH):
            for y in range(SWATCH):
                im.putpixel((i * SWATCH + x, y), c + (255,))
    return im


def uv(i, n):
    """The middle of swatch `i` of `n`, so filtering never samples a neighbour."""
    return ((i * SWATCH + SWATCH / 2) / (SWATCH * n), 0.5)


class Maillage:
    """One mesh, one material: every call appends to the same triangle soup."""

    def __init__(self, n_couleurs):
        self.n = n_couleurs
        self.pos, self.nor, self.uv, self.idx = [], [], [], []

    def boite(self, centre, taille, couleur, haut=None):
        """A box, or a taper when `haut` gives a different (x, z) at the top."""
        cx, cy, cz = centre
        sx, sy, sz = taille
        tx, tz = (sx, sz) if haut is None else haut
        for n, coins in FACES:
            base = len(self.pos)
            for s in coins:
                w = (sx, sz) if s[1] < 0 else (tx, tz)
                self.pos.append((cx + s[0] * w[0] / 2, cy + s[1] * sy / 2, cz + s[2] * w[1] / 2))
                self.nor.append(n)
                self.uv.append(uv(couleur, self.n))
            self.idx.extend([base, base + 1, base + 2, base, base + 2, base + 3])

    def cylindre(self, centre, rayon, longueur, couleur, axe='z', cotes=12):
        """A drum or a roller, its axis along `axe`, with a fan at each end."""
        cx, cy, cz = centre
        for i in range(cotes):
            a0 = 2 * math.pi * i / cotes
            a1 = 2 * math.pi * (i + 1) / cotes
            pts = []
            for a in (a0, a1):
                u, v = math.cos(a) * rayon, math.sin(a) * rayon
                for e in (-longueur / 2, longueur / 2):
                    pts.append((cx + u, cy + v, cz + e) if axe == 'z' else (cx + e, cy + u, cz + v))
            am = (a0 + a1) / 2
            n = (math.cos(am), math.sin(am), 0) if axe == 'z' else (0, math.cos(am), math.sin(am))
            base = len(self.pos)
            for p in (pts[0], pts[1], pts[3], pts[2]):
                self.pos.append(p)
                self.nor.append(n)
                self.uv.append(uv(couleur, self.n))
            self.idx.extend([base, base + 1, base + 2, base, base + 2, base + 3])
        for sens, e in ((-1, -longueur / 2), (1, longueur / 2)):
            centre_i = len(self.pos)
            n = (0, 0, sens) if axe == 'z' else (sens, 0, 0)
            c = (cx, cy, cz + e) if axe == 'z' else (cx + e, cy, cz)
            self.pos.append(c)
            self.nor.append(n)
            self.uv.append(uv(couleur, self.n))
            for i in range(cotes + 1):
                a = 2 * math.pi * i / cotes
                u, v = math.cos(a) * rayon, math.sin(a) * rayon
                self.pos.append((cx + u, cy + v, cz + e) if axe == 'z' else (cx + e, cy + u, cz + v))
                self.nor.append(n)
                self.uv.append(uv(couleur, self.n))
            for i in range(cotes):
                if sens < 0:
                    self.idx.extend([centre_i, centre_i + 1 + i, centre_i + 2 + i])
                else:
                    self.idx.extend([centre_i, centre_i + 2 + i, centre_i + 1 + i])

    def prim(self):
        return {'pos': self.pos, 'nor': self.nor, 'uv_atlas': self.uv, 'idx': self.idx}

    def bornes(self):
        xs = [p[0] for p in self.pos]
        ys = [p[1] for p in self.pos]
        zs = [p[2] for p in self.pos]
        return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))
