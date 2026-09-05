#!/usr/bin/env python3
"""
The rim of the map, as a built wall instead of four boxes with four lids.

What stood there: four stretched cubes in cream with a yellow slab on top, eight rendered
objects and two materials for the longest visible line in the game. It is the horizon of every
screenshot and it read as the side of a carton.

This bakes the whole perimeter into ONE mesh with a single six colour swatch atlas, the same
pattern the crates and the belt use, and spends the saving on the thing that actually reads at
distance: a profile. From the ground up, a plinth that is wider than the wall, the wall itself,
a coping that overhangs on both faces, a buttress every twelve metres with its own cap, and a
tower at each corner standing a metre above the run. The eye reads a rhythm along the line
rather than a flat band, which is the whole difference between a wall and a box side.

Budget, measured on the full field before this: 775 draw calls of a thousand and 295 materials
of four hundred, against 27 percent of the triangles. So: eight objects become one, two
materials become one, and about four thousand triangles are spent where there is room.

Run: python3 tools/model/build-wall.py
"""
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

# src/shared/schemas.ts and src/client/decor.ts: the same numbers the scene already used.
COTE = 192.0
H = 3.2
EP = 0.8

# src/client/toy.ts: the wall's cream, the ramp's yellow, and three shades to carve with.
COULEURS = ['#f2e9d8', '#ffd23f', '#e0d5bf', '#c9bda4', '#2b2d42', '#8d99ae']
CREME, JAUNE, OMBRE, PIERRE, SOMBRE, METAL = range(6)

ENTRAXE = 12.0        # a buttress every twelve metres
TOUR = 2.4            # the corner towers, in plan


def cote(m, axe, fixe, debut, fin, dehors):
    """One run of wall along `axe`, from `debut` to `fin`, at the fixed other coordinate.

    `dehors` is +1 or -1: which way the outside faces, so the plinth and the coping overhang
    on the correct side and the buttresses stand on the inside where a player walks.
    """
    long = fin - debut
    milieu = (debut + fin) / 2

    def place(le_long, epaisseur, hauteur, y, couleur, decalage=0.0, haut=None):
        c = [0, y, 0]
        t = [0, hauteur, 0]
        if axe == 'x':
            c[0], c[2] = milieu, fixe + decalage
            t[0], t[2] = le_long, epaisseur
            h = None if haut is None else (le_long, haut)
        else:
            c[0], c[2] = fixe + decalage, milieu
            t[0], t[2] = epaisseur, le_long
            h = None if haut is None else (haut, le_long)
        m.boite(tuple(c), tuple(t), couleur, haut=h)

    # The plinth: wider than the wall, so the line has a foot instead of stopping in the grass.
    place(long, EP + 0.5, 0.5, 0.25, PIERRE)
    # The wall itself, tapering a hand's width so it is not a slab.
    place(long, EP, H - 0.5, 0.25 + (H - 0.5) / 2, CREME, haut=EP - 0.16)
    # The coping, overhanging on both faces, and the yellow lip that was there before.
    place(long, EP + 0.34, 0.22, H + 0.11, OMBRE)
    place(long, EP + 0.40, 0.14, H + 0.29, JAUNE)

    # Buttresses on the inside face, each with its own cap: the rhythm along the run.
    n = int(long // ENTRAXE)
    for i in range(1, n):
        d = debut + i * (long / n)
        c = [0, 0, 0]
        c[0], c[2] = (d, fixe - dehors * 0.55) if axe == 'x' else (fixe - dehors * 0.55, d)
        t = (1.1, H - 0.7, 0.9) if axe == 'x' else (0.9, H - 0.7, 1.1)
        m.boite((c[0], 0.25 + (H - 0.7) / 2, c[2]), t, CREME,
                haut=(t[0] * 0.7, t[2] * 0.7))
        m.boite((c[0], H - 0.4, c[2]), (t[0] * 0.85, 0.18, t[2] * 0.85), OMBRE)


def construire():
    global m
    m = blocs.Maillage(len(COULEURS))
    a, b = EP / 2, COTE - EP / 2
    cote(m, 'x', a, TOUR, COTE - TOUR, -1)
    cote(m, 'x', b, TOUR, COTE - TOUR, +1)
    cote(m, 'z', a, TOUR, COTE - TOUR, -1)
    cote(m, 'z', b, TOUR, COTE - TOUR, +1)

    # A tower at each corner: the wall has to END somewhere, and a corner that just stops is
    # what makes a perimeter look like a placeholder.
    for x in (a, b):
        for z in (a, b):
            m.boite((x, 0.3, z), (TOUR + 0.6, 0.6, TOUR + 0.6), PIERRE)
            m.boite((x, 0.6 + (H + 0.5) / 2, z), (TOUR, H + 0.5, TOUR), CREME,
                    haut=(TOUR - 0.3, TOUR - 0.3))
            m.boite((x, H + 1.2, z), (TOUR + 0.35, 0.24, TOUR + 0.35), OMBRE)
            m.boite((x, H + 1.42, z), (TOUR + 0.42, 0.14, TOUR + 0.42), JAUNE)
            # A lamp head on the tower, the one dark accent that says "built, not moulded".
            m.boite((x, H + 1.75, z), (0.5, 0.5, 0.5), SOMBRE)
            m.boite((x, H + 2.05, z), (0.66, 0.12, 0.66), METAL)
    return m


def main():
    os.makedirs(OUT, exist_ok=True)
    atlas = blocs.atlas_couleurs(COULEURS)
    nom = 'wall-colours.png'
    atlas.save(os.path.join(OUT, nom), format='PNG', optimize=True)
    maillage = construire()
    prim = maillage.prim()
    chemin = os.path.join(OUT, 'wall.glb')
    taille = aplatir.ecrire_glb(chemin, [(False, [prim])], atlas, image_uri=nom)
    (x0, x1), (y0, y1), (z0, z1) = maillage.bornes()
    print(f'wall.glb  {taille / 1024:.1f} Ko  {len(prim["idx"]) // 3} triangles')
    print(f'  x {x0:.2f}..{x1:.2f}   y {y0:.2f}..{y1:.2f}   z {z0:.2f}..{z1:.2f}')
    print(f'  {nom}  {atlas.width}x{atlas.height}, {len(COULEURS)} couleurs, 1 materiau')


if __name__ == '__main__':
    main()
