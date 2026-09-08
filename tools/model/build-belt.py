#!/usr/bin/env python3
"""
The belt, as ONE object with a silhouette, instead of twelve boxes.

What was there: a red slab, two yellow rails, seven cream posts, a pit floor and four walls,
each an SDK primitive with its own material. Twelve rendered objects and six materials for a
shape that reads as "somebody put boxes where a conveyor should be". And the two budgets that
are actually tight on a phone are exactly those two, rendered objects and materials: measured
on the full field, 775 draw calls of a thousand and 295 materials of four hundred, against 27
percent of the triangles used.

So this is the art pass that also pays: one GLB, one material, one 8 by 8 pixel colour atlas,
and the detail goes into GEOMETRY, which is the axis with 73 percent free. What it adds is
what makes a conveyor read at a glance and what the twelve boxes never had:

  - two side beams with a capping lip, so the band sits INSIDE a frame rather than on nothing
  - a drum at each end, the one shape that says "this thing turns"
  - rollers along the underside, seen between the legs from any angle a player walks past at
  - tapered legs on foot plates, tied by a floor beam and braced diagonally at both ends
  - the safety stripe as an inset band on the outer face, not a rail floating above the deck

Everything is authored around the same numbers the scene uses (`BELT_LENGTH`, `BELT_HEIGHT`,
`MAILLE`), so the model and the gameplay cannot drift. The moving tread stays a separate plane
in `belt.ts`: it is the one part that needs its own scrolling material.

Run: python3 tools/model/build-belt.py
"""
import math
import os
from importlib import util as _u

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _u.spec_from_file_location('aplatir', os.path.join(HERE, 'aplatir-glb.py'))
aplatir = _u.module_from_spec(_spec)
_spec.loader.exec_module(aplatir)

OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'assets', 'Models'))

# src/shared/schemas.ts and src/client/belt.ts: the model is built around the scene's numbers.
BELT_LENGTH = 26.0
BELT_HEIGHT = 1.35
MAILLE = 2.6
LONG = BELT_LENGTH + 0.2
DEMI = LONG / 2
BORD = MAILLE / 2          # 1.30, where the side beams stand

# src/client/toy.ts TOY: the belt's own palette, one swatch each.
COULEURS = ['#e63946', '#f2e9d8', '#ffd23f', '#8d99ae', '#2b2d42', '#b5232f']
BANDE, CREME, JAUNE, METAL, SOMBRE, ROUGE_FONCE = range(6)
SWATCH = 8


def atlas_couleurs():
    im = Image.new('RGBA', (SWATCH * len(COULEURS), SWATCH), (0, 0, 0, 255))
    for i, h in enumerate(COULEURS):
        c = tuple(int(h.lstrip('#')[k:k + 2], 16) for k in (0, 2, 4))
        for x in range(SWATCH):
            for y in range(SWATCH):
                im.putpixel((i * SWATCH + x, y), c + (255,))
    return im


def uv(i):
    """The middle of swatch `i`, so no filtering ever samples a neighbour."""
    return ((i * SWATCH + SWATCH / 2) / (SWATCH * len(COULEURS)), 0.5)


FACES = [
    ((0, 0, 1), [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]),
    ((0, 0, -1), [(1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)]),
    ((1, 0, 0), [(1, -1, 1), (1, -1, -1), (1, 1, -1), (1, 1, 1)]),
    ((-1, 0, 0), [(-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)]),
    ((0, 1, 0), [(-1, 1, 1), (1, 1, 1), (1, 1, -1), (-1, 1, -1)]),
    ((0, -1, 0), [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)])
]


class Maillage:
    def __init__(self):
        self.pos, self.nor, self.uv, self.idx = [], [], [], []

    def boite(self, centre, taille, couleur, haut=None):
        """A box, and optionally a different size at the top: that is a taper, in one call."""
        cx, cy, cz = centre
        sx, sy, sz = taille
        tx, tz = (sx, sz) if haut is None else haut
        for n, coins in FACES:
            base = len(self.pos)
            for s in coins:
                w = (sx, sz) if s[1] < 0 else (tx, tz)
                self.pos.append((cx + s[0] * w[0] / 2, cy + s[1] * sy / 2, cz + s[2] * w[1] / 2))
                self.nor.append(n)
                self.uv.append(uv(couleur))
            self.idx.extend([base, base + 1, base + 2, base, base + 2, base + 3])

    def cylindre(self, centre, rayon, longueur, couleur, axe='z', cotes=12):
        """A drum or a roller. Its axis lies along `axe`; the caps are fans.

        L'ENROULEMENT ETAIT INVERSE, sur les flancs COMME sur les fonds, donc les onze cylindres
        de l'installation (deux tambours, neuf rouleaux) etaient retournes: 528 des 948 triangles
        du mesh, verifie en comparant la normale geometrique de chaque triangle a sa normale
        stockee. Les boites, elles, etaient justes.

        Ce que ca donnait: le tambour ne montrait que sa face arriere, puisque ses faces avant
        regardaient vers l'interieur, et un joueur qui le touchait restait coince dedans
        (proprietaire, 8 Sep: "le rouleau qui est visuellement buge, on voit que la face arriere,
        on reste irremediablement bloque dans l'objet"). Un collider bati sur un maillage retourne
        n'a pas de dehors: le moteur pousse la capsule du mauvais cote.

        La regle qui manquait: en glTF la face avant est celle dont les sommets tournent dans le
        sens ANTIHORAIRE vue de l'exterieur. Un flanc parcouru (a0,-e) (a0,+e) (a1,+e) (a1,-e)
        avec a croissant tourne dans l'autre sens, et un eventail de fond parcouru a angle
        croissant regarde vers l'interieur du cylindre.
        """
        cx, cy, cz = centre
        for i in range(cotes):
            a0 = 2 * math.pi * i / cotes
            a1 = 2 * math.pi * (i + 1) / cotes
            pts = []
            for a in (a0, a1):
                u, v = math.cos(a) * rayon, math.sin(a) * rayon
                for e in (-longueur / 2, longueur / 2):
                    if axe == 'z':
                        pts.append((cx + u, cy + v, cz + e))
                    else:
                        pts.append((cx + e, cy + u, cz + v))
            n = (0, math.cos((a0 + a1) / 2), math.sin((a0 + a1) / 2)) if axe != 'z' else \
                (math.cos((a0 + a1) / 2), math.sin((a0 + a1) / 2), 0)
            base = len(self.pos)
            for p in (pts[0], pts[1], pts[3], pts[2]):
                self.pos.append(p)
                self.nor.append(n)
                self.uv.append(uv(couleur))
            # Sens antihoraire vu du dehors: le quad se lit A D C puis A C B, pas A B C A C D.
            self.idx.extend([base, base + 3, base + 2, base, base + 2, base + 1])
        # caps, one fan each, so the drum reads as solid from the ends
        for sens, e in ((-1, -longueur / 2), (1, longueur / 2)):
            centre_i = len(self.pos)
            n = (0, 0, sens) if axe == 'z' else (sens, 0, 0)
            c = (cx, cy, cz + e) if axe == 'z' else (cx + e, cy, cz)
            self.pos.append(c)
            self.nor.append(n)
            self.uv.append(uv(couleur))
            for i in range(cotes + 1):
                a = 2 * math.pi * i / cotes
                u, v = math.cos(a) * rayon, math.sin(a) * rayon
                self.pos.append((cx + u, cy + v, cz + e) if axe == 'z' else (cx + e, cy + u, cz + v))
                self.nor.append(n)
                self.uv.append(uv(couleur))
            for i in range(cotes):
                # Le fond du bas se lit a angle DECROISSANT, celui du haut a angle croissant:
                # chacun tourne alors dans le sens antihoraire vu depuis SON propre dehors.
                if sens < 0:
                    self.idx.extend([centre_i, centre_i + 2 + i, centre_i + 1 + i])
                else:
                    self.idx.extend([centre_i, centre_i + 1 + i, centre_i + 2 + i])

    def prim(self):
        return {'pos': self.pos, 'nor': self.nor, 'uv_atlas': self.uv, 'idx': self.idx}


def construire():
    m = Maillage()
    pont = BELT_HEIGHT

    # The deck: the band the crates ride on, inside its frame.
    m.boite((0, pont, 0), (LONG, 0.30, MAILLE - 0.36), BANDE)

    for z in (-BORD, BORD):
        # A beam, and a lip capping it: the lip is what gives the frame an edge to catch light.
        m.boite((0, pont, z), (LONG, 0.44, 0.20), SOMBRE)
        m.boite((0, pont + 0.24, z), (LONG, 0.06, 0.28), METAL)
        # The safety stripe, inset into the outer face rather than floating above the deck.
        m.boite((0, pont - 0.06, z + (0.13 if z > 0 else -0.13)), (LONG - 0.6, 0.12, 0.03), JAUNE)

    # PLUS DE TAMBOUR AUX EXTREMITES.
    #
    # Il portait la lecture "cette chose tourne", et il a coute trois fois. Son anneau de moyeu
    # avait deja du sauter le 6 Sep parce qu'il lisait comme un disque en travers du tapis. Son
    # maillage etait retourne, flancs et fonds, donc on n'en voyait que la face arriere. Et il
    # est la seule piece commune aux DEUX bouts, la ou le proprietaire se bloque (8 Sep). Il
    # sortait a chaque fois d'un compromis, jamais d'un besoin: le convoyeur se lit deja par son
    # cadre, ses rails, ses pieds et sa bande qui defile.
    #
    # On le retire donc, sur demande du proprietaire ("je l'aime pas ce cylindre on peut pas
    # juste le retirer ?"). Le pont se termine sur la face plate de sa propre boite, ce qui est
    # une fin nette, et la geometrie suspecte des deux extremites disparait avec lui.

    # Rollers under the deck, seen between the legs as you walk past.
    for i in range(9):
        x = -DEMI + LONG * (i + 0.5) / 9
        m.cylindre((x, pont - 0.22, 0), 0.10, MAILLE - 0.5, METAL)

    # Legs: tapered posts on foot plates, tied by a floor beam and braced at both ends.
    for i in range(-3, 4):
        x = i * (LONG / 7)
        m.boite((x, (pont - 0.24) / 2, 0), (0.34, pont - 0.24, 0.34), CREME, haut=(0.22, 0.22))
        m.boite((x, 0.04, 0), (0.52, 0.08, 0.52), SOMBRE)
    m.boite((0, 0.22, 0), (LONG - 0.8, 0.10, 0.14), SOMBRE)
    for cote in (-1, 1):
        for k in range(2):
            x0 = cote * (DEMI - 0.4 - k * LONG / 7)
            m.boite((x0 - cote * LONG / 14, (pont - 0.2) / 2, 0), (0.08, pont - 0.5, 0.08), SOMBRE)

    # The collection pit at the end of the ride, in the same object: one draw call for both.
    #
    # ITS HALF-WIDTH IS A WALKWAY, NOT A LOOK. At 2.2 its side walls stood at z = +/-2.08 while
    # the belt's own beams reach +/-1.44, leaving a corridor of 0.60 m down each side. A
    # Decentraland player capsule is about 0.60 m across, so a player walking along either side
    # of the belt towards this end entered a slot exactly their own width and wedged in it
    # (owner, 8 Sep, playing: "si on touche l'une ou l'autre des extremites on est bloques").
    # The whole installation is one mesh with physics collision, so nothing tells the engine
    # that the pit is scenery and the corridor is a path.
    # At 2.8 the corridor is 1.20 m, twice the capsule. The crates are unaffected: they fall on
    # `bx`, which does not move, and their descent is animated (`beltPos`), never physical.
    bx = BELT_LENGTH / 2 + 1.3
    R = 2.8
    m.boite((bx, 0.10, 0), (R * 2, 0.20, R * 2), SOMBRE)
    for dx, dz, sx, sz in ((0, R, R * 2, 0.24), (0, -R, R * 2, 0.24), (R, 0, 0.24, R * 2), (-R, 0, 0.24, R * 2)):
        m.boite((bx + dx, 0.45, dz), (sx, 0.90, sz), METAL)
        m.boite((bx + dx, 0.92, dz), (sx + 0.08, 0.08, sz + 0.08), JAUNE)
    return m.prim()


def main():
    os.makedirs(OUT, exist_ok=True)
    atlas = atlas_couleurs()
    nom_png = 'belt-colours.png'
    atlas.save(os.path.join(OUT, nom_png), format='PNG', optimize=True)
    prim = construire()
    chemin = os.path.join(OUT, 'belt.glb')
    taille = aplatir.ecrire_glb(chemin, [(False, [prim])], atlas, image_uri=nom_png)
    xs = [p[0] for p in prim['pos']]
    ys = [p[1] for p in prim['pos']]
    zs = [p[2] for p in prim['pos']]
    print(f'belt.glb  {taille / 1024:.1f} Ko  {len(prim["idx"]) // 3} triangles')
    print(f'  x {min(xs):.2f}..{max(xs):.2f}   y {min(ys):.2f}..{max(ys):.2f}   z {min(zs):.2f}..{max(zs):.2f}')
    print(f'  {nom_png}  {atlas.width}x{atlas.height}, {len(COULEURS)} couleurs, 1 materiau')


if __name__ == '__main__':
    main()
