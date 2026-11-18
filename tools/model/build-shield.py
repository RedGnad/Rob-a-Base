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
    """A clear pane with a bright frame at the foot and the crown, and a faint sheen in between."""
    w, h = 8, 128
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); px = im.load()
    for y in range(h):
        bord = 1.0 if y < 4 or y > h - 5 else 0.0
        reflet = 0.25 if 18 <= y <= 24 else 0.0
        v = max(bord, reflet)
        for x in range(w):
            px[x, y] = (int(205 + 50 * v), int(235 + 20 * v), 255, int(56 + 170 * v))
    return im

def main_glass():
    """The SEALED base: a sheet of glass round the whole building (founder, 18 Nov 2026).

    Two looks for two protections. The lattice of glowing bands above (shield.glb) is now the
    force field that keeps ONE player out after a theft or a trap; this clear glass, the look
    the shield had before 5 Sep, is the seal that keeps everyone but the owner out. Same two
    shells, so it reads from inside as well as from the plaza.
    """
    tex = glass_texture()
    tex.save(os.path.join(OUT, GLASS_TEX), format='PNG', optimize=True)
    chemin = os.path.join(OUT, GLASS)
    aplatir.ecrire_glb(chemin, [(True, [build()])], tex, image_uri=GLASS_TEX)
    import json, struct
    b = open(chemin, 'rb').read(); L = struct.unpack_from('<I', b, 12)[0]; js = json.loads(b[20:20 + L])
    m = js['materials'][0]
    m['pbrMetallicRoughness'].update({'baseColorFactor': [0.82, 0.94, 1.0, 0.30], 'metallicFactor': 0.0, 'roughnessFactor': 0.05})
    m['emissiveTexture'] = {'index': 0}
    m['emissiveFactor'] = [0.12, 0.2, 0.26]
    m['alphaMode'] = 'BLEND'
    m['doubleSided'] = True
    j = json.dumps(js, separators=(',', ':')).encode(); j += b' ' * ((4 - len(j) % 4) % 4)
    rest = b[20 + L:]
    total = 12 + 8 + len(j) + len(rest)
    with open(chemin, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total)); f.write(struct.pack('<II', len(j), 0x4E4F534A)); f.write(j); f.write(rest)
    print(f'{GLASS}  {os.path.getsize(chemin) / 1024:.1f} KB, both shells')

if __name__ == '__main__':
    main()
    main_glass()
