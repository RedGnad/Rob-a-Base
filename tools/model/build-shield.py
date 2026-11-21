#!/usr/bin/env python3
"""
The sealed base's shield: a unit box with TWO shells, so it reads from inside as well as out.

The shield was an SDK box with a translucent material, and the engine forces backface culling
on every material it draws: from inside the base, the box's faces point away and NOTHING is
drawn (owner, 5 Sep: "on l'active et on ne voit rien, les fenetres montrent la meme chose").
A second, inward-facing shell fixes that, and putting both in one FILE keeps the phone's count
where it was: an SDK primitive costs a material per base, a shared model costs one for all.

Not an opaque wall either: the surface is a lattice of glowing bands, alpha 0.34 between them,
so a player inside sees the seal on his windows and still sees the plaza through it.

Writes assets/Models/shield.glb (a 1 x 1 x 1 box, scaled by the client) and shield.png.
"""
import os, sys
from importlib import util as _u
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _u.spec_from_file_location('aplatir', os.path.join(HERE, 'aplatir-glb.py'))
aplatir = _u.module_from_spec(_spec); _spec.loader.exec_module(aplatir)
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'Models')
TEX = 'shield.png'

FACES = [
    ((0, 0, 1),  [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]),
    ((0, 0, -1), [(1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)]),
    ((1, 0, 0),  [(1, -1, 1), (1, -1, -1), (1, 1, -1), (1, 1, 1)]),
    ((-1, 0, 0), [(-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)]),
    ((0, 1, 0),  [(-1, 1, 1), (1, 1, 1), (1, 1, -1), (-1, 1, -1)]),
]

def texture():
    """Bands across the height: bright at the foot and the crown, a soft lattice between."""
    w, h = 8, 128
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); px = im.load()
    for y in range(h):
        t = y / (h - 1)                      # 0 at the top of the image, 1 at the bottom
        bande = 1.0 if (y % 16) < 3 else 0.0
        bord = 1.0 if y < 5 or y > h - 6 else 0.0
        v = max(bande * 0.55, bord)
        for x in range(w):
            px[x, y] = (int(150 + 105 * v), int(225 + 30 * v), 255, int(70 + 150 * v))
    return im

def build():
    pos, nor, uv, idx = [], [], [], []
    def quad(n, coins, dedans):
        base = len(pos)
        for k, s in enumerate(coins):
            pos.append((s[0] / 2, s[1] / 2, s[2] / 2))
            nor.append((-n[0], -n[1], -n[2]) if dedans else n)
            uv.append((0.5, 0.02 + 0.96 * (0 if s[1] > 0 else 1)))
        if dedans: idx.extend([base, base + 2, base + 1, base, base + 3, base + 2])
        else: idx.extend([base, base + 1, base + 2, base, base + 2, base + 3])
    for n, coins in FACES:
        quad(n, coins, False)       # seen from the plaza
        quad(n, coins, True)        # seen from inside the base
    return {'pos': pos, 'nor': nor, 'uv': uv, 'uv_atlas': uv, 'idx': idx}

def main():
    os.makedirs(OUT, exist_ok=True)
    atlas = texture()
    atlas.save(os.path.join(OUT, TEX), format='PNG', optimize=True)
    chemin = os.path.join(OUT, 'shield.glb')
    taille = aplatir.ecrire_glb(chemin, [(True, [build()])], atlas, image_uri=TEX)
    import json, struct
    b = open(chemin, 'rb').read(); L = struct.unpack_from('<I', b, 12)[0]; js = json.loads(b[20:20 + L])
    m = js['materials'][0]
    m['pbrMetallicRoughness'].update({'baseColorFactor': [0.45, 0.85, 1.0, 0.34], 'metallicFactor': 0.0, 'roughnessFactor': 0.25})
    m['emissiveTexture'] = {'index': 0}
    m['emissiveFactor'] = [0.35, 0.75, 0.95]
    m['alphaMode'] = 'BLEND'
    m['doubleSided'] = True
    j = json.dumps(js, separators=(',', ':')).encode(); j += b' ' * ((4 - len(j) % 4) % 4)
    rest = b[20 + L:]
    total = 12 + 8 + len(j) + len(rest)
    with open(chemin, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total)); f.write(struct.pack('<II', len(j), 0x4E4F534A)); f.write(j); f.write(rest)
    print(f'shield.glb  {os.path.getsize(chemin) / 1024:.1f} KB  {len(build()["idx"]) // 3} triangles, both shells')
    print(f'{TEX}  {os.path.getsize(os.path.join(OUT, TEX)) / 1024:.1f} KB')

GLASS = 'shield-glass.glb'
GLASS_TEX = 'shield-glass.png'

def glass_texture():
    """A red pane, a third opaque, with a thick bright frame at the foot and the crown and a sheen between."""
    w, h = 8, 128
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); px = im.load()
    for y in range(h):
        bord = 1.0 if y < 11 or y > h - 12 else 0.0
        reflet = 0.35 if 22 <= y <= 30 else 0.0
        v = max(bord, reflet)
        for x in range(w):
            px[x, y] = (int(235 + 20 * v), int(34 + 36 * v), int(34 + 26 * v), int(96 + 140 * v))
    return im

def main_glass():
    """The SEALED base: a sheet of red glass round the whole building (founder, 18 and 20 Nov 2026).

    Two looks for two protections. The lattice of glowing bands above (shield.glb) is the force
    field that keeps ONE player out after a theft or a trap; this glass is the seal that keeps
    everyone but the owner out. Same two shells, so it reads from inside as well as from the plaza.

    It was clear glass for two days, and nothing said it was the stronger of the two (founder,
    20 Nov). So the strength now reads twice, as the game accessibility guidelines ask ("ensure
    no essential information is conveyed by a fixed colour alone"): by colour, red, the colour
    the GDD already gives a sealed door and the one players read as "stop"; and by density, a
    pane a third opaque inside a thick frame, against the field's thin open bands of blue.
    """
    tex = glass_texture()
    tex.save(os.path.join(OUT, GLASS_TEX), format='PNG', optimize=True)
    chemin = os.path.join(OUT, GLASS)
    aplatir.ecrire_glb(chemin, [(True, [build()])], tex, image_uri=GLASS_TEX)
    import json, struct
    b = open(chemin, 'rb').read(); L = struct.unpack_from('<I', b, 12)[0]; js = json.loads(b[20:20 + L])
    m = js['materials'][0]
    m['pbrMetallicRoughness'].update({'baseColorFactor': [1.0, 1.0, 1.0, 1.0], 'metallicFactor': 0.0, 'roughnessFactor': 0.08})
    m['emissiveTexture'] = {'index': 0}
    m['emissiveFactor'] = [0.32, 0.32, 0.32]
    m['alphaMode'] = 'BLEND'
    m['doubleSided'] = True
    j = json.dumps(js, separators=(',', ':')).encode(); j += b' ' * ((4 - len(j) % 4) % 4)
    rest = b[20 + L:]
    total = 12 + 8 + len(j) + len(rest)
    with open(chemin, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total)); f.write(struct.pack('<II', len(j), 0x4E4F534A)); f.write(j); f.write(rest)
    print(f'{GLASS}  {os.path.getsize(chemin) / 1024:.1f} KB, both shells')

AVATAR = 'shield-avatar.glb'

def build_avatar(segments=24, rings=6, radius=0.5, wall=0.78):
    """A unit capsule open at the feet: a wall up to `wall`, then a dome to y = 1.

    Rounded, as the founder asked on 20 Nov 2026: a cylinder with a flat lid read as a tube. The
    code scales it to the avatar, so the dome becomes a soft half-ellipsoid over the head.
    """
    import math
    pos, nor, uv, idx = [], [], [], []
    # Profile from the feet to the crown: (ring radius, height, normal's radial part, normal's y).
    profile = [(radius, 0.0, 1.0, 0.0), (radius, wall, 1.0, 0.0)]
    for k in range(1, rings + 1):
        t = (math.pi / 2) * k / rings
        profile.append((radius * math.cos(t), wall + (1.0 - wall) * math.sin(t), math.cos(t), math.sin(t)))
    for inner in (False, True):
        base = len(pos)
        for j, (r, y, nr, ny) in enumerate(profile):
            for i in range(segments + 1):
                a = 2 * math.pi * i / segments
                c, sn = math.cos(a), math.sin(a)
                n = (nr * c, ny, nr * sn)
                if inner: n = (-n[0], -n[1], -n[2])
                pos.append((r * c, y, r * sn)); nor.append(n)
                uv.append((i / segments, 0.98 - 0.96 * (y / 1.0)))
        cols = segments + 1
        for j in range(len(profile) - 1):
            for i in range(segments):
                a0 = base + j * cols + i; a1 = a0 + 1; b0 = a0 + cols; b1 = b0 + 1
                idx.extend((a0, a1, b0, b0, a1, b1) if not inner else (a0, b0, a1, b0, b1, a1))
    return {'pos': pos, 'nor': nor, 'uv': uv, 'uv_atlas': uv, 'idx': idx}

def main_avatar():
    """The immunity a burst of hits grants one player (founder, 20 Nov 2026): the force field's own
    look, the same banded texture and material as shield.glb, fitted round the avatar instead of a
    base. A sphere read as a bubble, too big and off centre; a field this close to the body reads as
    a shield, and it is the game's one look for "you cannot touch this"."""
    import json, struct
    atlas = Image.open(os.path.join(OUT, TEX))
    chemin = os.path.join(OUT, AVATAR)
    aplatir.ecrire_glb(chemin, [(True, [build_avatar()])], atlas, image_uri=TEX)
    b = open(chemin, 'rb').read(); L = struct.unpack_from('<I', b, 12)[0]; js = json.loads(b[20:20 + L])
    m = js['materials'][0]
    # Quieter than a base's field: it hugs a body in the middle of a fight and must not hide it (founder, 20 Nov).
    m['pbrMetallicRoughness'].update({'baseColorFactor': [0.45, 0.85, 1.0, 0.2], 'metallicFactor': 0.0, 'roughnessFactor': 0.25})
    m['emissiveTexture'] = {'index': 0}
    m['emissiveFactor'] = [0.2, 0.42, 0.52]
    m['alphaMode'] = 'BLEND'
    m['doubleSided'] = True
    j = json.dumps(js, separators=(',', ':')).encode(); j += b' ' * ((4 - len(j) % 4) % 4)
    rest = b[20 + L:]
    with open(chemin, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(j) + len(rest))); f.write(struct.pack('<II', len(j), 0x4E4F534A)); f.write(j); f.write(rest)
    print(f'{AVATAR}  {os.path.getsize(chemin) / 1024:.1f} KB')

if __name__ == '__main__':
    main()
    main_glass()
    main_avatar()
