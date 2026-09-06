#!/usr/bin/env python3
"""Fusionne toute la vegetation de la carte en DEUX modeles: les arbres, les buissons.

Pourquoi. Le client mobile compte un objet rendu par instance, et son plafond est 400 (dur:
500, et un plafond dur bloque le chargement). Quarante-quatre arbres et quarante-trois
buissons faisaient quatre-vingt-sept objets pour de l'ornement pur, sans collider, soit plus
d'un tiers du decor (mesure du 2 Sep). Ils ne bougent jamais les uns par rapport aux autres:
c'est exactement le cas de la fusion des etages. Fondus, ils font DEUX objets.

Ce qu'on echange: la geometrie est dupliquee par instance au lieu d'etre partagee, et un objet
qui couvre toute la carte n'est jamais elimine par le champ de vision. Vingt-cinq mille
triangles en permanence, contre un budget d'un million: sans commune mesure avec quatre-vingt
cinq objets rendus.

Le PLACEMENT vit ici, et nulle part ailleurs. Il etait dans `decor.ts`, tire par un generateur
pseudo-aleatoire partage avec les ballons; le repliquer dans deux fichiers aurait garanti la
derive. Le client se contente maintenant de poser les deux modeles a l'origine.

    python3 tools/model/build-vegetation.py
"""
import importlib.util
import math
import os
import re

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../..'))
OUT = os.path.join(ROOT, 'assets/Models')

_spec = importlib.util.spec_from_file_location('aplatir', os.path.join(HERE, 'aplatir-glb.py'))
aplatir = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(aplatir)


def constante(nom, defaut=None):
    src = open(os.path.join(ROOT, 'src/shared/schemas.ts'), encoding='utf-8').read()
    m = re.search(rf'export const {nom}\s*=\s*([0-9.]+)', src)
    if m:
        return float(m.group(1))
    m = re.search(rf'export const {nom}\s*=\s*([^\n]+)', src)
    if m and defaut is None:
        raise SystemExit(f'{nom} non numerique: {m.group(1)}')
    return defaut


SCENE_SIDE = constante('SCENE_SIDE')
BASE_SIDE = constante('BASE_SIDE')
BELT_LENGTH = constante('BELT_LENGTH')
EDGE_MARGIN = BASE_SIDE / 2 + 2
BELT_CLEARANCE = BASE_SIDE / 2 + 2
CX = CZ = SCENE_SIDE / 2

# Le meme generateur que `decor.ts` avait, avec sa propre graine: ce fichier est desormais la
# seule autorite sur ou poussent les arbres.
_graine = 987654321


def alea():
    global _graine
    _graine = (_graine * 1103515245 + 12345) & 0x7fffffff
    return _graine / 0x7fffffff


def sur_spawn(x, z):
    """La bande du point d'apparition, ou rien ne se pose. Suit `spawnPoints` de scene.json."""
    return 88 < x < 104 and 116 < z < 128


def placer_arbres():
    """
    Un rang d'arbres le long des quatre bords, dans la bande interdite aux bases.

    C'etait un tous les dix-sept metres, quarante-quatre arbres pour sept cent soixante-huit
    metres de pourtour: une haie clairsemee qui lisait comme un alignement plutot que comme une
    lisiere. Le pas descend a treize.

    Pourquoi pas plus, alors que la vegetation est fondue en UN objet et ne coute donc rien sur
    les deux compteurs tendus: parce qu'elle coute du CONTENU. Un arbre pese 490 triangles, et
    le second rang essaye a onze metres portait le fichier de 2,3 a 6,1 Mo, soit le plus gros
    fichier du jeu, sur le chemin de chargement dont le proprietaire trouve deja qu'il arrive
    trop tard (5 Sep). La profondeur vient donc des BUISSONS, qui coutent 53 triangles piece:
    dix fois moins cher pour le meme service a l'arriere-plan.

    La bande reste celle ou aucune base ne peut se poser, et le point d'apparition reste vide:
    la lisibilite du terrain de jeu ne se negocie pas contre du decor.
    """
    """
    Trois rangs, et le troisieme colle au mur.

    Deux rangs lisaient encore comme une haie, et le proprietaire en veut plus SANS que la
    lisiere mange du terrain (6 Sep). Le troisieme rang va donc dans les quatre premiers metres,
    la ou personne ne marche parce que le mur est juste derriere.

    Ce qu'il a fallu corriger pour que ce soit possible: la taille. Un arbre a l'echelle 2,0
    porte une ramure de 7,1 m de rayon; pose a 4 m du mur, sa boite sortait de la scene et
    `instancier` le RENTRAIT de trois metres, vers le terrain. Les gros arbres du rang interieur
    etaient donc repousses vers le jeu, exactement ce qu'on ne veut pas, et tous a la meme
    distance, ce qui refaisait une ligne. L'echelle est desormais bornee par la distance au mur
    (`_echelle_max`), donc un arbre proche du mur est un PETIT arbre: il ne sort jamais de la
    scene, il n'est jamais repousse, et la taille croissante du mur vers le terrain donne la
    profondeur que le rang seul ne donnait pas.

    Le prix, mesure sur les fichiers: la vegetation reste DEUX objets rendus et UN materiau,
    quel que soit le nombre d'arbres, parce que tout est fondu. Ne montent que les triangles
    (563 par arbre, sur un budget d'un million) et le poids du fichier (52,5 Ko par arbre).
    """
    return (_rang_arbres(0.30, 0.0, 11.0)
            + _rang_arbres(0.62, 5.5, 11.0)
            + _rang_arbres(0.95, 2.5, 11.0))


# Le rayon horizontal de `tree.glb` a l'echelle 1, mesure sur ses sommets. L'origine du modele
# n'est pas centree: la ramure porte a 3,56 m d'un cote, donc apres une rotation en Y c'est ce
# rayon-la qui compte, quel que soit l'angle.
RAYON_ARBRE = 3.56


def _echelle_max(x, z):
    """La plus grande echelle dont la ramure tient dans la scene a cet endroit."""
    marge = min(x, z, SCENE_SIDE - x, SCENE_SIDE - z) - MARGE_SCENE
    return marge / RAYON_ARBRE


def _rang_arbres(facteur, phase, pas):
    out = []
    bande = EDGE_MARGIN * facteur
    for cote in (0, 1, 2, 3):
        d = 10.0 + phase
        while d < SCENE_SIDE - 10:
            j = (alea() - 0.5) * 6
            x = z = 0.0
            if cote == 0:
                x, z = d + j, bande + (alea() - 0.5) * 3
            elif cote == 1:
                x, z = d + j, SCENE_SIDE - bande + (alea() - 0.5) * 3
            elif cote == 2:
                x, z = bande + (alea() - 0.5) * 3, d + j
            else:
                x, z = SCENE_SIDE - bande + (alea() - 0.5) * 3, d + j
            sc = 1.1 + alea() * 0.9
            ry = alea() * 360
            # Borne par la place disponible, jamais rentre de force: un arbre du bord est un
            # petit arbre, et la taille monte a mesure qu'on s'eloigne du mur.
            sc = min(sc, _echelle_max(x, z))
            if sc >= 0.45 and not sur_spawn(x, z):
                out.append((x, 0.0, z, sc, ry))
            d += pas
    return out


# La couronne de la place: entre le trait au sol (18 x 13) et la limite de construction
# (27 x 22). Un arbre pose la ne sera jamais dans le salon de personne.
PLACE_A, PLACE_B = 23.0, 18.0
LARGEUR_RUE = 6.0


def placer_arbres_de_la_place():
    """
    Une couronne d'arbres autour de la place, la seule qu'un joueur voie vraiment.

    Les arbres etaient une bordure et rien d'autre: 100 parcelles sur 144 n'en contenaient
    aucun, et depuis la place le plus proche etait a quatre-vingt-dix metres. Sur telephone
    le plan lointain est a cent metres avec du brouillard des soixante-seize: la decoration
    du jeu etait donc invisible depuis l'endroit ou l'on passe son temps (proprietaire,
    3 Sep, "je ne vois toujours pas les arbres").

    On ne peut pas en planter n'importe ou: le terrain est constructible partout ailleurs, et
    un arbre finirait dans le salon de quelqu'un. La bande reservee autour de la place est le
    seul sol a la fois VISIBLE et garanti vide pour toujours, alors la couronne va la. Elle
    s'ouvre aux angles ou la rue traverse, sinon les arbres pousseraient sur la chaussee.

    Cout: zero objet rendu. Les instances vont dans le meme maillage et le meme materiau que
    la bordure; seuls les triangles augmentent, sur un budget qu'on remplit a huit pour cent.
    """
    out = []
    for deg in range(0, 360, 24):
        # L'ecart a l'axe de la rue, qui court en z = CZ sur toute la largeur de la carte.
        if min(abs(deg - 0), abs(deg - 180), abs(deg - 360)) < 22:
            continue
        a = math.radians(deg + (alea() - 0.5) * 10)
        x = CX + PLACE_A * math.cos(a) + (alea() - 0.5) * 2
        z = CZ + PLACE_B * math.sin(a) + (alea() - 0.5) * 2
        if abs(z - CZ) < LARGEUR_RUE / 2 + 1.5:
            continue
        if sur_spawn(x, z):
            continue
        out.append((x, 0.0, z, 1.1 + alea() * 0.8, alea() * 360))
    return out


def placer_buissons():
    """Le long du couloir du tapis, puis au pied de la bordure entre les arbres."""
    out = []
    # Ils longeaient le tapis sur DEUX DROITES, un tous les cinq metres: l'oeil lisait la
    # regle avant de voir la plante (proprietaire, 3 Sep, "alignes d'une maniere pas
    # naturelle et il y en a trop"). Ils suivent maintenant l'ellipse de la place, a des
    # angles irreguliers et avec un ecart radial de plus ou moins deux metres et demi, ce qui
    # casse la courbe: on ne lit plus de trace, seulement des touffes. Neuf au lieu de vingt.
    for deg in (18, 62, 104, 147, 196, 231, 268, 302, 338):
        a_rad = math.radians(deg + (alea() - 0.5) * 14)
        rayon = 1.0 + (alea() - 0.5) * 0.28
        x = CX + 15.0 * rayon * math.cos(a_rad)
        z = CZ + 10.5 * rayon * math.sin(a_rad)
        k = 0 if alea() < 0.5 else 1
        sc = 0.9 + alea() * 0.7
        ry = alea() * 360
        if not sur_spawn(x, z):
            out.append((k, x, 0.0, z, sc, ry))
    d = 8.0
    while d < SCENE_SIDE - 8:
        for bx, bz in ((d, 2.6), (SCENE_SIDE - d, SCENE_SIDE - 2.6), (2.6, SCENE_SIDE - d), (SCENE_SIDE - 2.6, d)):
            k = 0 if alea() < 0.5 else 1
            x = bx + (alea() - 0.5) * 2
            z = bz + (alea() - 0.5) * 2
            sc = 0.8 + alea() * 0.6
            ry = alea() * 360
            if not sur_spawn(x, z):
                out.append((k, x, 0.0, z, sc, ry))
        d += 23
    # Un second cordon, entre les arbres et le mur: c'est lui qui donne la profondeur que le
    # deuxieme rang d'arbres aurait donnee, pour un dixieme du poids.
    d = 14.0
    while d < SCENE_SIDE - 14:
        for bx, bz in ((d, 6.4), (SCENE_SIDE - d, SCENE_SIDE - 6.4), (6.4, SCENE_SIDE - d), (SCENE_SIDE - 6.4, d)):
            k = 0 if alea() < 0.5 else 1
            x = bx + (alea() - 0.5) * 3
            z = bz + (alea() - 0.5) * 3
            sc = 0.7 + alea() * 0.8
            ry = alea() * 360
            if not sur_spawn(x, z):
                out.append((k, x, 0.0, z, sc, ry))
        d += 12
    return out


def primitive_de(chemin):
    """Le seul primitive d'un fichier deja aplati, avec ses sommets et son image."""
    j, binaire = aplatir.lire_glb(chemin)
    prims = aplatir.extraire(j, binaire, None, False, True)
    assert len(prims) == 1, f'{chemin}: {len(prims)} primitives, attendu 1 (aplatir d abord)'
    p = prims[0]
    im, facteur = aplatir.image_du_materiau(j, binaire, p['mat'])
    return p, aplatir.cuire(im, facteur)


# La scene fait 192 m de cote. Un modele dont la BOITE ENGLOBANTE sort de ce carre est masque
# par le client en production, entierement, sans erreur; l'apercu local lance en `local-scene`
# ne verifie pas les limites, donc le defaut ne se voit qu'une fois deploye. Les arbres du bord
# debordaient de deux a trois metres et la carte s'est retrouvee sans un seul arbre
# (proprietaire, 2 Sep). Chaque instance est donc ramenee dans le carre, elle et sa ramure.
MARGE_SCENE = 0.5


def instancier(p, x, y, z, sc, ry):
    """Une copie du primitive, tournee autour de Y, mise a l'echelle, posee et RENTREE."""
    a = math.radians(ry)
    ca, sa = math.cos(a), math.sin(a)
    pos, nor = [], []
    for (px, py, pz) in p['pos']:
        pos.append((x + sc * (px * ca + pz * sa), y + sc * py, z + sc * (-px * sa + pz * ca)))
    # Ce que cette instance occupe reellement, ramure comprise, puis le decalage qui la rentre.
    xs = [q[0] for q in pos]
    ys = [q[1] for q in pos]
    zs = [q[2] for q in pos]
    dx = max(0.0, MARGE_SCENE - min(xs)) - max(0.0, max(xs) - (SCENE_SIDE - MARGE_SCENE))
    dz = max(0.0, MARGE_SCENE - min(zs)) - max(0.0, max(zs) - (SCENE_SIDE - MARGE_SCENE))
    # PAS de relevement en y: le collet des racines DOIT passer sous le sol.
    #
    # On avait ajoute un `dy = max(0, -min(ys))` en croyant que les arbres etaient masques
    # parce que leur boite descendait a y = -0,45. C'etait faux, la vraie cause etait le
    # miroir sur X, et ce relevement de 45 cm faisait FLOTTER chaque arbre au-dessus de
    # l'herbe, racines a l'air (proprietaire, 3 Sep, capture a l'appui). Un correctif pose
    # sur un diagnostic non verifie laisse toujours sa trace quelque part.
    if dx or dz:
        pos = [(q[0] + dx, q[1], q[2] + dz) for q in pos]
    for n in p['nor']:
        if n is None:
            nor.append(None)
        else:
            nor.append((n[0] * ca + n[2] * sa, n[1], -n[0] * sa + n[2] * ca))
    return {'pos': pos, 'nor': nor, 'uv': p['uv'], 'idx': list(p['idx']), 'mat': p['mat']}


def ecrire(nom, prims, atlas, regions):
    for p in prims:
        u0, v0, w, h = regions[p['tuile']]
        p['uv_atlas'] = [(u0 + (u % 1.0) * w, v0 + (v % 1.0) * h) for (u, v) in p['uv']]
    xs = [q[0] for p in prims for q in p['pos']]
    zs = [q[2] for p in prims for q in p['pos']]
    if min(xs) < 0 or min(zs) < 0 or max(xs) > SCENE_SIDE or max(zs) > SCENE_SIDE:
        raise SystemExit(f'{nom}: boite englobante hors scene, x {min(xs):.2f}..{max(xs):.2f} '
                         f'z {min(zs):.2f}..{max(zs):.2f} pour une scene de 0..{SCENE_SIDE:.0f}')
    taille = aplatir.ecrire_glb(os.path.join(OUT, nom), [(False, prims)], atlas)
    print(f'-> {nom}: {len(prims)} instances fondues, {sum(len(p["pos"]) for p in prims)} sommets, '
          f'atlas {atlas.width}x{atlas.height}, {taille // 1024} Ko')


if __name__ == '__main__':
    arbre, img_arbre = primitive_de(os.path.join(OUT, 'tree.glb'))
    # La couronne de la place est retiree: les arbres restent sur les bords, decision
    # du proprietaire une fois la vegetation enfin visible (3 Sep).
    places = placer_arbres()
    prims = []
    for (x, y, z, sc, ry) in places:
        q = instancier(arbre, x, y, z, sc, ry)
        q['tuile'] = 0
        prims.append(q)
    ecrire('vegetation-arbres.glb', prims, img_arbre, {0: (0.0, 0.0, 1.0, 1.0)})

    b0, img0 = primitive_de(os.path.join(OUT, 'bush-02.glb'))
    b1, img1 = primitive_de(os.path.join(OUT, 'bush-03.glb'))
    H = max(img0.height, img1.height)
    W = img0.width + img1.width
    atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    atlas.paste(img0, (0, 0))
    atlas.paste(img1, (img0.width, 0))
    regions = {0: (0.0, 0.0, img0.width / W, img0.height / H),
               1: (img0.width / W, 0.0, img1.width / W, img1.height / H)}
    prims = []
    for (k, x, y, z, sc, ry) in placer_buissons():
        q = instancier(b0 if k == 0 else b1, x, y, z, sc, ry)
        q['tuile'] = k
        prims.append(q)
    ecrire('vegetation-buissons.glb', prims, atlas, regions)
