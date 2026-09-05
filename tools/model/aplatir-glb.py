#!/usr/bin/env python3
"""Aplatit un GLB a la norme du client mobile: UN mesh, UN materiau, UNE texture.

Pourquoi. Le client mobile compte un materiau par OBJET RENDU, modeles compris, et son
plafond est 400 (dur: 500, et un plafond dur bloque le chargement). Les six jeux que
Decentraland cite en reference mobile ont tous la meme forme, verifiee sur leurs fichiers
deployes le 2 Sep: chaque GLB porte un seul materiau et une seule texture, instancie autant de
fois qu'il faut. Les notres non: l'arbre avait quatre meshes, deux materiaux, une armature et
une pancarte oubliee au pied avec sa texture de 426 Ko; les buissons rendaient leur collider;
l'arme avait sept meshes de couleur plate sans UV. A 44 arbres et 43 buissons, ca faisait 262
objets rendus, 57 % du budget de tout le decor.

Ce que fait l'outil.
  - lit un GLB (JSON + BIN), calcule la transformation globale de chaque noeud;
  - pour un mesh skinne, applique le skinning en pose de repos (somme des poids x matrice
    globale du joint x matrice de liaison inverse), ce qui cuit l'armature et rend l'animation
    inutile;
  - transforme positions et normales dans l'espace de la scene, jette JOINTS/WEIGHTS;
  - regroupe tous les primitives par classe de rendu (double face ou non), une seule si possible;
  - fabrique un atlas: les textures existantes cote a cote, et pour un materiau sans texture un
    pixel de sa couleur, avec les UV remappes ou poses sur ce pixel. Le facteur de couleur est
    cuit dans les pixels, le materiau final a un facteur de 1;
  - ecrit un GLB avec un noeud, un mesh, un materiau par classe, une image.

    python3 tools/model/aplatir-glb.py source.glb sortie.glb [--exclure REGEX] [--sans-collider]

Aucune dependance au-dela de Pillow. Les matrices sont faites a la main: quelques milliers de
sommets, pas de quoi installer numpy.
"""
import io
import json
import math
import re
import struct
import sys

from PIL import Image

# ----------------------------------------------------------------------------- lecture

def lire_glb(chemin):
    b = open(chemin, 'rb').read()
    assert b[:4] == b'glTF', 'pas un GLB'
    ln = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + ln])
    # le chunk BIN suit, aligne sur 4
    p = 20 + ln
    while p % 4:
        p += 1
    bl = struct.unpack('<I', b[p:p + 4])[0]
    assert b[p + 4:p + 8] == b'BIN\x00'
    return j, b[p + 8:p + 8 + bl]

TYPES = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
FMT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}

def lire_accesseur(j, binaire, idx):
    a = j['accessors'][idx]
    bv = j['bufferViews'][a['bufferView']]
    n = TYPES[a['type']]
    f = FMT[a['componentType']]
    taille = struct.calcsize(f)
    stride = bv.get('byteStride', n * taille)
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    out = []
    for i in range(a['count']):
        o = base + i * stride
        v = struct.unpack_from('<' + f * n, binaire, o)
        if a.get('normalized'):
            m = {'B': 255.0, 'H': 65535.0, 'b': 127.0, 'h': 32767.0}[f]
            v = tuple(x / m for x in v)
        out.append(v)
    return out

# ----------------------------------------------------------------------------- matrices

def m_identite():
    return [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]

def m_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]

def m_de_trs(t, r, s):
    x, y, z, w = r
    rot = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    m = m_identite()
    for i in range(3):
        for k in range(3):
            m[i][k] = rot[i][k] * s[k]
        m[i][3] = t[i]
    return m

def m_de_colonnes(c):
    # glTF stocke les matrices en colonnes
    return [[c[col * 4 + row] for col in range(4)] for row in range(4)]

def m_noeud(n):
    if 'matrix' in n:
        return m_de_colonnes(n['matrix'])
    return m_de_trs(n.get('translation', [0, 0, 0]), n.get('rotation', [0, 0, 0, 1]), n.get('scale', [1, 1, 1]))

def appliquer(m, v, w=1.0):
    return tuple(m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2] + m[i][3] * w for i in range(3))

def normaliser(v):
    l = math.sqrt(sum(x * x for x in v)) or 1.0
    return tuple(x / l for x in v)

def globales(j):
    """Transformation globale de chaque noeud, par descente depuis les racines de la scene."""
    g = {}
    def descendre(i, parent):
        m = m_mul(parent, m_noeud(j['nodes'][i]))
        g[i] = m
        for c in j['nodes'][i].get('children', []):
            descendre(c, m)
    for r in j['scenes'][j.get('scene', 0)]['nodes']:
        descendre(r, m_identite())
    return g

# ----------------------------------------------------------------------------- extraction

def extraire(j, binaire, exclure, sans_collider, sans_skin=False):
    """Chaque primitive gardee, avec ses sommets deja dans l'espace de la scene."""
    g = globales(j)
    sorties = []
    for ni, n in enumerate(j['nodes']):
        if 'mesh' not in n or ni not in g:
            continue
        nom = n.get('name', '')
        if exclure and re.search(exclure, nom):
            print(f'  exclu: noeud {nom}')
            continue
        if sans_collider and '_collider' in nom.lower():
            print(f'  collider retire: {nom}')
            continue
        mesh = j['meshes'][n['mesh']]
        skin = j['skins'][n['skin']] if ('skin' in n and not sans_skin) else None
        if skin is not None:
            ibm = lire_accesseur(j, binaire, skin['inverseBindMatrices'])
            joints_m = [m_mul(g[jn], m_de_colonnes(ibm[k])) for k, jn in enumerate(skin['joints'])]
        for prim in mesh['primitives']:
            attrs = prim['attributes']
            pos = lire_accesseur(j, binaire, attrs['POSITION'])
            nor = lire_accesseur(j, binaire, attrs['NORMAL']) if 'NORMAL' in attrs else None
            uv = lire_accesseur(j, binaire, attrs['TEXCOORD_0']) if 'TEXCOORD_0' in attrs else None
            idx = lire_accesseur(j, binaire, prim['indices']) if 'indices' in prim else [(i,) for i in range(len(pos))]
            idx = [i[0] for i in idx]
            if skin is not None:
                jt = lire_accesseur(j, binaire, attrs['JOINTS_0'])
                wt = lire_accesseur(j, binaire, attrs['WEIGHTS_0'])
                P, N = [], []
                for k in range(len(pos)):
                    p = (0.0, 0.0, 0.0); nn = (0.0, 0.0, 0.0)
                    for a in range(4):
                        w = wt[k][a]
                        if w == 0:
                            continue
                        m = joints_m[int(jt[k][a])]
                        q = appliquer(m, pos[k])
                        p = (p[0] + w * q[0], p[1] + w * q[1], p[2] + w * q[2])
                        if nor:
                            r = appliquer(m, nor[k], 0.0)
                            nn = (nn[0] + w * r[0], nn[1] + w * r[1], nn[2] + w * r[2])
                    P.append(p); N.append(normaliser(nn) if nor else None)
            else:
                m = g[ni]
                P = [appliquer(m, p) for p in pos]
                N = [normaliser(appliquer(m, v, 0.0)) for v in nor] if nor else [None] * len(pos)
            mat = j['materials'][prim['material']] if 'material' in prim else {}
            sorties.append({'nom': nom, 'pos': P, 'nor': N, 'uv': uv, 'idx': idx, 'mat': mat})
            print(f'  garde: {nom:24s} {len(P):5d} sommets, materiau {mat.get("name", "?")}{" (skinne, pose de repos cuite)" if skin else ""}')
    return sorties

# ----------------------------------------------------------------------------- atlas

def image_du_materiau(j, binaire, mat):
    pbr = mat.get('pbrMetallicRoughness', {})
    bct = pbr.get('baseColorTexture')
    facteur = pbr.get('baseColorFactor', [1, 1, 1, 1])
    if bct is None:
        return None, facteur
    tex = j['textures'][bct['index']]
    img = j['images'][tex['source']]
    bv = j['bufferViews'][img['bufferView']]
    o = bv.get('byteOffset', 0)
    im = Image.open(io.BytesIO(binaire[o:o + bv['byteLength']])).convert('RGBA')
    return im, facteur

def cuire(im, facteur):
    if all(abs(f - 1) < 1e-6 for f in facteur[:3]):
        return im
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            px[x, y] = (int(r * facteur[0]), int(g * facteur[1]), int(b * facteur[2]), a)
    return im

def construire_atlas(j, binaire, prims):
    """Une image, et pour chaque primitive la fonction qui envoie ses UV dedans."""
    cles = {}
    tuiles = []   # (largeur, hauteur, image)
    for p in prims:
        cle = id(p['mat'])
        if cle in cles:
            continue
        im, fac = image_du_materiau(j, binaire, p['mat'])
        if im is None:
            im = Image.new('RGBA', (4, 4), tuple(int(255 * c) for c in fac[:3]) + (255,))
        else:
            im = cuire(im, fac)
        cles[cle] = len(tuiles)
        tuiles.append(im)
    # une seule tuile: pas d'atlas, l'image telle quelle
    if len(tuiles) == 1:
        return tuiles[0], {list(cles)[0]: (0.0, 0.0, 1.0, 1.0)}
    # sinon, cote a cote sur une ligne, hauteur commune
    H = max(t.height for t in tuiles)
    W = sum(t.width for t in tuiles)
    atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    regions = {}
    x = 0
    for cle, k in cles.items():
        t = tuiles[k]
        atlas.paste(t, (x, 0))
        regions[cle] = (x / W, 0.0, t.width / W, t.height / H)
        x += t.width
    return atlas, regions

# ----------------------------------------------------------------------------- ecriture

def ecrire_glb(chemin, groupes, atlas, image_uri=None, emissif=None, force_emissive=1.0):
    """`groupes`: liste de (double_face, primitives). Un materiau par groupe, une image.

    `image_uri` sort l'image du fichier et la remplace par un chemin relatif. Neuf modeles qui
    embarquent chacun leur atlas font neuf textures a charger; le meme atlas cite par son nom
    n'en fait qu'une, partagee. A n'utiliser que si le .png est bien livre a cote du .glb.

    `emissif` allume le materiau: un triplet 0..1 plus une force, cuits DANS le fichier, ce qui
    veut dire que toutes les instances partagent une seule couleur emissive. Teinter a
    l'execution ferait l'inverse: le client mobile duplique un materiau par piece modifiee par
    noeud, donc une sentinelle par etage couterait un materiau par etage.
    """
    bin_parts = []
    buffer_views = []
    accessors = []
    def pousser(data, cible=None):
        while sum(len(x) for x in bin_parts) % 4:
            bin_parts.append(b'\x00')
        off = sum(len(x) for x in bin_parts)
        bin_parts.append(data)
        bv = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if cible:
            bv['target'] = cible
        buffer_views.append(bv)
        return len(buffer_views) - 1
    def accesseur(bv, ctype, count, typ, mn=None, mx=None):
        a = {'bufferView': bv, 'componentType': ctype, 'count': count, 'type': typ}
        if mn is not None:
            a['min'] = mn; a['max'] = mx
        accessors.append(a)
        return len(accessors) - 1

    bv_img = None
    if image_uri is None:
        png = io.BytesIO(); atlas.save(png, format='PNG', optimize=True)
        bv_img = pousser(png.getvalue())

    meshes_prims = []
    materials = []
    for gi, (double, prims) in enumerate(groupes):
        P, N, UV, I = [], [], [], []
        for p in prims:
            base = len(P)
            # X negatif: glTF est droitier, le moteur gaucher, l'importateur retourne X en
            # convertissant. Nos outils raisonnent en coordonnees du MONDE, comme le code, et
            # on ne retourne qu'ici. Sans cela tout ce qu'on genere sort en miroir: invisible
            # sur du symetrique, et fatal sur des arbres dont les positions cuites entre 0,5 et
            # 191,5 basculent hors de la scene (proprietaire, 3 Sep, "pas d'arbres").
            P.extend((-q[0], q[1], q[2]) for q in p['pos'])
            N.extend(((-n[0], n[1], n[2]) if n is not None else (0.0, 1.0, 0.0)) for n in p['nor'])
            UV.extend(p['uv_atlas'])
            # Une symetrie retourne les faces: on echange deux sommets par triangle.
            for k in range(0, len(p['idx']), 3):
                a0, b0, c0 = p['idx'][k], p['idx'][k + 1], p['idx'][k + 2]
                I.extend((base + a0, base + c0, base + b0))
        mn = [min(v[k] for v in P) for k in range(3)]
        mx = [max(v[k] for v in P) for k in range(3)]
        a_pos = accesseur(pousser(b''.join(struct.pack('<fff', *v) for v in P), 34962), 5126, len(P), 'VEC3', mn, mx)
        a_nor = accesseur(pousser(b''.join(struct.pack('<fff', *v) for v in N), 34962), 5126, len(N), 'VEC3')
        a_uv = accesseur(pousser(b''.join(struct.pack('<ff', *v) for v in UV), 34962), 5126, len(UV), 'VEC2')
        a_idx = accesseur(pousser(b''.join(struct.pack('<I', i) for i in I), 34963), 5125, len(I), 'SCALAR')
        mat = {
            'name': f'plat{gi}',
            'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0.0, 'roughnessFactor': 0.9},
            'doubleSided': bool(double)
        }
        if emissif is not None:
            mat['emissiveFactor'] = list(emissif)
            mat['emissiveTexture'] = {'index': 0}
            if force_emissive != 1.0:
                mat['extensions'] = {'KHR_materials_emissive_strength': {'emissiveStrength': force_emissive}}
        materials.append(mat)
        meshes_prims.append({'attributes': {'POSITION': a_pos, 'NORMAL': a_nor, 'TEXCOORD_0': a_uv}, 'indices': a_idx, 'material': gi})

    utilisees = ['KHR_materials_emissive_strength'] if (emissif is not None and force_emissive != 1.0) else []
    j = {
        'asset': {'version': '2.0', 'generator': 'aplatir-glb.py'},
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'name': 'plat', 'mesh': 0}],
        'meshes': [{'name': 'plat', 'primitives': meshes_prims}],
        'materials': materials,
        'textures': [{'sampler': 0, 'source': 0}],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
        'images': [{'uri': image_uri} if image_uri is not None else {'bufferView': bv_img, 'mimeType': 'image/png'}],
        'accessors': accessors, 'bufferViews': buffer_views,
        'buffers': [{'byteLength': 0}]
    }
    if utilisees:
        j['extensionsUsed'] = utilisees
    binaire = b''.join(bin_parts)
    while len(binaire) % 4:
        binaire += b'\x00'
    j['buffers'][0]['byteLength'] = len(binaire)
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    total = 12 + 8 + len(js) + 8 + len(binaire)
    out = b'glTF' + struct.pack('<II', 2, total)
    out += struct.pack('<I', len(js)) + b'JSON' + js
    out += struct.pack('<I', len(binaire)) + b'BIN\x00' + binaire
    open(chemin, 'wb').write(out)
    return len(out)

# ----------------------------------------------------------------------------- main

def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__); sys.exit(1)
    src, dst = args[0], args[1]
    exclure = None; sans_collider = False; sans_skin = False
    i = 2
    while i < len(args):
        if args[i] == '--exclure':
            exclure = args[i + 1]; i += 2
        elif args[i] == '--sans-collider':
            sans_collider = True; i += 1
        elif args[i] == '--sans-skin':
            # Ignore le squelette: sommets tels que modelises (pose de liaison), sous la
            # transformation du noeud. C'est ce que le client montre quand le clip est a
            # l'arret; la pose de repos des os, elle, est une image de l'animation.
            sans_skin = True; i += 1
        else:
            raise SystemExit('option inconnue: ' + args[i])
    j, binaire = lire_glb(src)
    print(f'{src}: {len(j["meshes"])} meshes, {len(j.get("materials", []))} materiaux, {len(j.get("images", []))} images, {len(j.get("skins", []))} skins, {len(j.get("animations", []))} animations')
    prims = extraire(j, binaire, exclure, sans_collider, sans_skin)
    atlas, regions = construire_atlas(j, binaire, prims)
    for p in prims:
        u0, v0, w, h = regions[id(p['mat'])]
        if p['uv'] is None:
            # sans UV: tout le primitive vise le centre de sa tuile de couleur
            p['uv_atlas'] = [(u0 + w / 2, v0 + h / 2)] * len(p['pos'])
        else:
            # les UV hors [0,1] d'une texture repetee ne peuvent pas survivre a un atlas:
            # on les ramene dans la tuile, ce qui est exact tant que la texture n'etait pas repetee.
            p['uv_atlas'] = [(u0 + (u % 1.0) * w, v0 + (v % 1.0) * h) for (u, v) in p['uv']]
    groupes = {}
    for p in prims:
        groupes.setdefault(bool(p['mat'].get('doubleSided', False)), []).append(p)
    liste = sorted(groupes.items(), key=lambda kv: kv[0])
    taille = ecrire_glb(dst, liste, atlas)
    tot = sum(len(p['pos']) for p in prims)
    print(f'-> {dst}: {len(liste)} primitive(s)/materiau(x), {tot} sommets, atlas {atlas.width}x{atlas.height}, {taille // 1024} Ko')

if __name__ == '__main__':
    main()
