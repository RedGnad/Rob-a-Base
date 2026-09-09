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


# Le fuser, et le vide qu'il lui faut autour.
#
# Il etait colle a un buisson, et ce n'est pas un detail d'esthetique: sa silhouette se fondait
# dans celle du buisson, ce qui defait exactement ce qui devait le faire remarquer. L'effet
# d'isolement (von Restorff, 1933) dit qu'un element se retient parce qu'il TRANCHE sur son
# entourage, et Lynch dit la meme chose des reperes urbains: un repere fonctionne par contraste
# avec son contexte, pas par ses qualites propres. Une machine posee contre un massif n'a plus
# de contexte, elle en fait partie.
#
# Sept metres: le socle agrandi fait 1,76 de rayon, donc il reste plus de cinq metres d'herbe
# nue tout autour, assez pour que la machine se decoupe depuis n'importe quel angle.
FUSER = (87.0, 89.0)
FUSER_DEGAGEMENT = 7.0


def sur_fuser(x, z):
    """Le rond d'herbe nue autour de la machine a fusion, ou rien ne pousse."""
    return (x - FUSER[0]) ** 2 + (z - FUSER[1]) ** 2 < FUSER_DEGAGEMENT ** 2


def placer_arbres():
    """
    Une lisiere semee, pas une grille: des candidats en surnombre, et une regle d'ecart qui
    tranche.

    Trois rangs a pas fixe donnaient des arbres qui se fondaient les uns dans les autres et une
    repartition irreguliere, surtout aux quatre coins ou deux cotes deposaient leurs arbres au
    meme endroit (proprietaire, 6 Sep). Un pas plus large aurait eclairci partout au lieu de
    corriger les amas. On tire donc trois fois plus de candidats qu'il n'en faut, on les melange,
    et on ne garde un arbre que s'il degage tous ceux deja poses: c'est le semis a disque de
    Poisson, et sa propriete est exactement celle qui manquait, aucun couple trop proche et
    aucun grand vide.

    L'ecart demande vaut `SERREMENT` fois la somme des deux rayons de ramure, donc deux petits
    arbres peuvent se serrer et deux grands non, ce qui est la regle qu'on veut: c'est la
    ramure, pas le tronc, qui decide de la lecture.

    A tree costs triangles and file weight, never a material: the trees are merged per cell of
    `TREE_CELL` metres (one file, one draw call per cell, see `write_tree_clusters`), and the
    bushes stay one object.
    """
    candidats = []
    # La phase se deduit du rang de la bande: une liste ecrite a cote se serait desynchronisee
    # a la premiere bande ajoutee, en silence, et la bande en trop n'aurait rien produit.
    for i, facteur in enumerate(BANDES_ARBRES):
        candidats += _candidats_arbres(facteur, i * PAS_CANDIDAT / len(BANDES_ARBRES), PAS_CANDIDAT)
    # Melange deterministe (Fisher-Yates sur notre propre generateur): sans lui, le premier
    # rang parcouru raflerait toutes les places et les deux autres n'auraient que des restes.
    for i in range(len(candidats) - 1, 0, -1):
        j = int(alea() * (i + 1))
        candidats[i], candidats[j] = candidats[j], candidats[i]

    poses = []
    for (x, z, sc, ry) in candidats:
        r = RAYON_ARBRE * sc
        if not degage_de_la_rue(z, r):
            continue
        # Le rond de la machine a fusion vaut pour les arbres aussi: une ramure de trois metres
        # et demi la couvrirait bien plus surement qu'un buisson.
        if sur_fuser(x, z):
            continue
        if any((x - px) ** 2 + (z - pz) ** 2 < ((r + RAYON_ARBRE * psc) * SERREMENT) ** 2
               for (px, _, pz, psc, _) in poses):
            continue
        poses.append((x, 0.0, z, sc, ry))
    return poses


# Le rayon horizontal de `tree.glb` a l'echelle 1, mesure sur ses sommets. L'origine du modele
# n'est pas centree: la ramure porte a 3,56 m d'un cote, donc apres une rotation en Y c'est ce
# rayon-la qui compte, quel que soit l'angle.
RAYON_ARBRE = 3.56
# Les trois bandes, en part de la marge ou aucune base ne peut se poser.
BANDES_ARBRES = (0.28, 0.60, 0.92)
# Le pas des CANDIDATS, pas des arbres: la regle d'ecart en refusera la plupart.
PAS_CANDIDAT = 3.5
# La part des deux rayons additionnes que deux ramures ont le droit de partager.
#
# C'est le seul bouton a tourner si la lisiere doit etre plus dense ou plus claire. A 1,0 les
# ramures se touchent sans jamais se recouvrir, ce qui lit comme un verger plante; a 0,52 elles
# se fondent, ce que le proprietaire a rejete (6 Sep). Mesure sur les quatre valeurs essayees,
# a bandes et pas egaux: 0,52 donne 148 arbres et des amas, 0,62 en donne 121, 0,75 en donne 114
# sans un seul couple fondu, 0,88 en donne 80 et ouvre des trous. 0,75 est la valeur la plus
# dense qui ne fasse aucun amas.
SERREMENT = 0.75
# La rue traverse la carte en z = CZ sur toute sa largeur; sa largeur vit dans `decor.ts`.
LARGEUR_RUE = 6.0
# Le plus grand des deux buissons, mesure sur ses sommets (bush-02 1,14 m, bush-03 1,16 m).
# La rue se traverse: y laisser des buissons apres avoir degage les arbres n'aurait fait que
# rendre l'incoherence plus visible.
RAYON_BUISSON = 1.16


def degage_de_la_rue(z, rayon):
    """La rue reste libre, ramure comprise: on la traverse, on n'y pousse pas."""
    return abs(z - CZ) >= LARGEUR_RUE / 2 + rayon


def _echelle_max(x, z):
    """La plus grande echelle dont la ramure tient dans la scene a cet endroit."""
    marge = min(x, z, SCENE_SIDE - x, SCENE_SIDE - z) - MARGE_SCENE
    return marge / RAYON_ARBRE


def _candidats_arbres(facteur, phase, pas):
    """Des places possibles le long des quatre bords, sans aucun test entre elles."""
    out = []
    bande = EDGE_MARGIN * facteur
    for cote in (0, 1, 2, 3):
        d = 8.0 + phase
        while d < SCENE_SIDE - 8:
            j = (alea() - 0.5) * 6
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
            # Bornee par la place disponible, jamais rentree de force: un arbre du bord est un
            # petit arbre, et la taille monte a mesure qu'on s'eloigne du mur.
            sc = min(sc, _echelle_max(x, z))
            if sc >= 0.45 and not sur_spawn(x, z):
                out.append((x, z, sc, ry))
            d += pas
    return out


# La couronne de la place: entre le trait au sol (18 x 13) et la limite de construction
# (27 x 22). Un arbre pose la ne sera jamais dans le salon de personne.
PLACE_A, PLACE_B = 23.0, 18.0


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
        if not sur_spawn(x, z) and not sur_fuser(x, z) and degage_de_la_rue(z, RAYON_BUISSON * sc):
            out.append((k, x, 0.0, z, sc, ry))
    d = 8.0
    while d < SCENE_SIDE - 8:
        for bx, bz in ((d, 2.6), (SCENE_SIDE - d, SCENE_SIDE - 2.6), (2.6, SCENE_SIDE - d), (SCENE_SIDE - 2.6, d)):
            k = 0 if alea() < 0.5 else 1
            x = bx + (alea() - 0.5) * 2
            z = bz + (alea() - 0.5) * 2
            sc = 0.8 + alea() * 0.6
            ry = alea() * 360
            if not sur_spawn(x, z) and not sur_fuser(x, z) and degage_de_la_rue(z, RAYON_BUISSON * sc):
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
            if not sur_spawn(x, z) and not sur_fuser(x, z) and degage_de_la_rue(z, RAYON_BUISSON * sc):
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


# Side of the square cells the trees are written by, in metres: one file per occupied cell.
#
# All 114 trees were ONE object, 64,182 triangles, with a bounding box the size of the scene.
# The client culls per object, so every frame drew every tree, the ones behind the camera
# included: the single biggest item of the scene, 29 % of the visible triangles on 7 Sep, and
# the one the culling could never touch. The trees stand within 10 m of the edge, so 48 m
# cells give twelve files, the four corners L-shaped, each a renderer the client drops when
# it is out of view. Twelve draw calls instead of one, against a mobile ceiling of 2,000.
TREE_CELL = 48.0
# The list of cluster files the client poses, written next to the client so it cannot drift
# from what this tool produced.
CLUSTERS_TS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'client', 'vegetation-clusters.ts')


def write_tree_clusters(arbre, img_arbre, places):
    """One GLB per occupied cell, and the TypeScript list the client poses them from."""
    cells = {}
    for (x, y, z, sc, ry) in places:
        q = instancier(arbre, x, y, z, sc, ry)
        q['tuile'] = 0
        cells.setdefault((int(x // TREE_CELL), int(z // TREE_CELL)), []).append(q)
    names = []
    for (gx, gz) in sorted(cells):
        name = f'vegetation-trees-{gx}-{gz}.glb'
        ecrire(name, cells[(gx, gz)], img_arbre, {0: (0.0, 0.0, 1.0, 1.0)})
        names.append(name)
    stale = os.path.join(OUT, 'vegetation-arbres.glb')
    if os.path.exists(stale):
        os.remove(stale)
        print(f'-> removed {stale}: the trees are written per cell now')
    with open(CLUSTERS_TS, 'w') as f:
        f.write('// Written by tools/model/build-vegetation.py: the tree cluster files it produced,\n')
        f.write('// one per occupied 48 m cell. Do not edit by hand; run the tool.\n')
        f.write('export const TREE_CLUSTERS = [\n')
        for name in names:
            f.write(f"  'assets/Models/{name}',\n")
        f.write(']\n')
    print(f'-> {len(names)} tree clusters for {len(places)} trees, list written to {os.path.relpath(CLUSTERS_TS)}')


if __name__ == '__main__':
    arbre, img_arbre = primitive_de(os.path.join(OUT, 'tree.glb'))
    # La couronne de la place est retiree: les arbres restent sur les bords, decision
    # du proprietaire une fois la vegetation enfin visible (3 Sep).
    write_tree_clusters(arbre, img_arbre, placer_arbres())

    # Le semis des buissons repart de la graine: sans ca, toucher au tirage des arbres deplace
    # toute la vegetation basse par ricochet, et chaque retouche des arbres coute une relecture
    # des buissons.
    _graine = 987654321
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
