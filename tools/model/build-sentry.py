#!/usr/bin/env python3
"""
The sentry: a field emitter, not a cone and not a turret.

Two things have to stay true, and they are the reason the cone was chosen in the first place
(4 Sep): the shape must NOT say "this shoots", because the sentry seals, freezes and shakes
coins loose; and it has to stand in the lift's square without touching a wall, which caps it at
a radius of 0.30 and a height the floor can take.

So the silhouette stays a cone, and the DETAIL says machine: a hexagonal pad at the foot, three
blades leaning in and stopping short of the top, two rings around the shaft, and a floating
core between the blades. Abstract, technical, symmetrical, nothing anthropomorphic, nothing
that reads as a barrel. At arm's length it is still the cyan cone everyone has learned; up
close it is a thing somebody built.

Emissive is baked INTO the file: every sentry in the world then shares one material. Tinting at
runtime would do the opposite, because the mobile client duplicates a material for each piece
modified through a node (invariant 478), so one sentry per floor would cost one material per
floor.

Run: python3 tools/model/build-sentry.py
"""
import math
import os
from importlib import util as _u

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _u.spec_from_file_location('aplatir', os.path.join(HERE, 'aplatir-glb.py'))
aplatir = _u.module_from_spec(_spec); _spec.loader.exec_module(aplatir)
_spec2 = _u.spec_from_file_location('blocs', os.path.join(HERE, 'blocs.py'))
blocs = _u.module_from_spec(_spec2); _spec2.loader.exec_module(blocs)

OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'assets', 'Models'))

# The primitive it replaces: a cylinder of radius 0.30 at the foot, 0.15 at the top, one unit
# tall, scaled by the entity. Everything here lives inside that envelope.
R = 0.30
H = 1.0

# src/client/toy.ts TOY.sentry is the cyan; the darker shade carves the blades apart.
COULEURS = ['#7ce7ff', '#2ec4e6', '#0b3d4d']
CLAIR, CYAN, SOMBRE = range(3)
EMISSIF = (0.35, 0.85, 1.0)


def anneau(m, y, rayon, epaisseur, hauteur, couleur, cotes=12):
    """A ring of `cotes` short bars: cheaper than a torus and it reads the same at this size."""
    for i in range(cotes):
        a = 2 * math.pi * (i + 0.5) / cotes
        x, z = math.cos(a) * rayon, math.sin(a) * rayon
        m.boite((x, y, z), (epaisseur, hauteur, epaisseur), couleur)


def construire():
    """
    Built base at zero, then dropped half a unit.

    The primitive it replaces is an SDK cylinder, and an SDK cylinder is CENTRED on its entity:
    it spans minus a half to plus a half. Every number in `plots.ts` (the position at y + 1.2,
    the scale that caps at three metres, the bolt that leaves at half the scale) was written
    against that pivot. A model with its feet at zero would have stood half its height too high
    and shot from its knees. So the mesh is authored the natural way and moved at the end: the
    swap is then invisible to the code around it.
    """
    m = blocs.Maillage(len(COULEURS))

    # The pad: six segments make a hexagon without a single triangle fan.
    for i in range(6):
        a = 2 * math.pi * i / 6
        x, z = math.cos(a) * R * 0.66, math.sin(a) * R * 0.66
        m.boite((x, 0.035, z), (R * 0.62, 0.07, R * 0.62), SOMBRE)
    m.boite((0, 0.09, 0), (R * 1.05, 0.05, R * 1.05), CYAN)

    # The shaft, tapering to the tip the cone always had.
    m.boite((0, H * 0.5, 0), (R * 0.5, H, R * 0.5), CYAN, haut=(R * 0.16, R * 0.16))

    # Three blades, ONE piece each, leaning in and stopping short of the top.
    #
    # A first pass stacked five little boxes per blade and it read as a staircase: the eye saw
    # steps where a machine wanted an edge. A prism from the foot to a point near the tip is
    # the same silhouette drawn in one stroke, which is what "simple in its shape" means.
    for i in range(3):
        a = 2 * math.pi * i / 3
        ca, sa = math.cos(a), math.sin(a)
        # perpendicular, for the blade's thickness
        px, pz = -sa, ca
        for (r0, y0, r1, y1, e0, e1, couleur) in (
            (R * 0.96, 0.09, R * 0.20, H * 0.70, R * 0.13, R * 0.05, CYAN),
            (R * 0.70, 0.09, R * 0.16, H * 0.44, R * 0.07, R * 0.03, CLAIR)
        ):
            bas = [(ca * r0 + px * e0, y0, sa * r0 + pz * e0),
                   (ca * r0 - px * e0, y0, sa * r0 - pz * e0),
                   (ca * (r0 * 0.55) - px * e0, y0, sa * (r0 * 0.55) - pz * e0),
                   (ca * (r0 * 0.55) + px * e0, y0, sa * (r0 * 0.55) + pz * e0)]
            haut = [(ca * r1 + px * e1, y1, sa * r1 + pz * e1),
                    (ca * r1 - px * e1, y1, sa * r1 - pz * e1),
                    (ca * (r1 * 0.4) - px * e1, y1, sa * (r1 * 0.4) - pz * e1),
                    (ca * (r1 * 0.4) + px * e1, y1, sa * (r1 * 0.4) + pz * e1)]
            m.prisme(bas, haut, couleur)

    # One ring around the shaft, and the core floating inside the blades: two accents, no more.
    anneau(m, H * 0.34, R * 0.46, R * 0.10, 0.045, CLAIR)
    m.boite((0, H * 0.52, 0), (R * 0.30, R * 0.30, R * 0.30), CLAIR)
    m.boite((0, H * 0.52, 0), (R * 0.16, R * 0.44, R * 0.16), CLAIR)
    # The tip: where a field would leave.
    m.boite((0, H * 0.985, 0), (R * 0.20, R * 0.20, R * 0.20), CLAIR)
    m.pos = [(x, y - H / 2, z) for (x, y, z) in m.pos]
    return m


def main():
    os.makedirs(OUT, exist_ok=True)
    atlas = blocs.atlas_couleurs(COULEURS)
    nom = 'sentry-colours.png'
    atlas.save(os.path.join(OUT, nom), format='PNG', optimize=True)
    maillage = construire()
    prim = maillage.prim()
    chemin = os.path.join(OUT, 'sentry.glb')
    taille = aplatir.ecrire_glb(chemin, [(False, [prim])], atlas, image_uri=nom,
                                emissif=EMISSIF, force_emissive=1.6)
    (x0, x1), (y0, y1), (z0, z1) = maillage.bornes()
    print(f'sentry.glb  {taille / 1024:.1f} Ko  {len(prim["idx"]) // 3} triangles')
    print(f'  x {x0:.2f}..{x1:.2f}   y {y0:.2f}..{y1:.2f}   z {z0:.2f}..{z1:.2f}  (enveloppe: r {R}, h {H})')


if __name__ == '__main__':
    main()
