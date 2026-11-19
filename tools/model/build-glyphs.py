#!/usr/bin/env python3
"""
The facade sign as shared model files: one file per letter, one for the star, one for the plate.

The sign was drawn with SDK planes, one per letter, and the phone counts a material for every
SDK plane that carries one, never shared (read in the mobile client, 5 Sep). A twelve-letter
name cost thirteen materials per base, so the level-of-detail budget could only afford the sign
on the nearest bases and drew the others without one (founder, 19 Nov 2026: "les panneaux sont
carrement invisibles"). A model file is counted once however many copies stand, so with a file
per letter every sign on the field together costs one material per letter in use.

Each glyph is the same unit quad as the SDK plane (unity-explorer PlaneFactory.cs: front face
towards -z, bottom-left vertex at uv (u0, v0)), cut from the same Baloo atlas cell with the same
bleed as `texte3d.ts`, and lit the same way: alpha test at 0.5, emissive 0.35, and the grey of an
absent owner (albedo 0.62 0.66 0.74, emissive 0.12) baked into a "-dim" twin. Double sided, like
the plane, so the back shows the mirrored letter the plate hides.

Writes assets/glyphs/: name-NN.glb and name-dim-NN.glb for every atlas cell, money-NN.glb and
money-dim-NN.glb for the digits (the prestige level), prestige.glb, prestige-dim.glb, sign.glb,
and the atlases they cite, copied next to them so each is loaded once for all its letters.
"""
import json, os, re, shutil, struct
from importlib import util as _u
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _u.spec_from_file_location('aplatir', os.path.join(HERE, 'aplatir-glb.py'))
aplatir = _u.module_from_spec(_spec); _spec.loader.exec_module(aplatir)
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
UI = os.path.join(ROOT, 'assets', 'ui')
OUT = os.path.join(ROOT, 'assets', 'glyphs')

LIT = {'base': [1, 1, 1, 1], 'emissive': [0.35, 0.35, 0.35]}
DIM = {'base': [0.62, 0.66, 0.74, 1], 'emissive': [0.62 * 0.12, 0.66 * 0.12, 0.74 * 0.12]}
SIGN = {'base': [1, 1, 1, 1], 'emissive': [0.3, 0.3, 0.3]}
BLEED = 1.5 / 1024


def font_metrics():
    """The atlas grid and glyph order, read from the generated TypeScript so the two never drift."""
    src = open(os.path.join(ROOT, 'src', 'client', 'font-metrics.ts'), encoding='utf8').read()
    m = re.search(r"ATLAS = \{ cols: (\d+), rows: (\d+), glyphs: '([^']*)' \}", src)
    files = dict(re.findall(r"(\w+): '(font-[\w-]+\.png)'", src))
    return int(m.group(1)), int(m.group(2)), m.group(3), files


def quad(u0, v0, u1, v1):
    """The SDK plane's front face in engine coordinates, uvs given bottom-up as the SDK takes them."""
    pos = [(-0.5, -0.5, 0.0), (-0.5, 0.5, 0.0), (0.5, 0.5, 0.0), (0.5, -0.5, 0.0)]
    uv_sdk = [(u0, v0), (u0, v1), (u1, v1), (u1, v0)]
    # glTF counts v from the top of the image, the SDK from the bottom.
    uv = [(u, 1.0 - v) for (u, v) in uv_sdk]
    return {'pos': pos, 'nor': [(0.0, 0.0, -1.0)] * 4, 'uv': uv, 'uv_atlas': uv, 'idx': [0, 1, 2, 0, 2, 3]}


def write(name, prim, image, look):
    path = os.path.join(OUT, name)
    atlas = Image.open(os.path.join(OUT, image))
    aplatir.ecrire_glb(path, [(True, [prim])], atlas, image_uri=image)
    b = open(path, 'rb').read(); L = struct.unpack_from('<I', b, 12)[0]; js = json.loads(b[20:20 + L])
    m = js['materials'][0]
    m['pbrMetallicRoughness'].update({'baseColorFactor': look['base'], 'metallicFactor': 0.0, 'roughnessFactor': 1.0})
    m['emissiveTexture'] = {'index': 0}
    m['emissiveFactor'] = look['emissive']
    m['alphaMode'] = 'MASK'
    m['alphaCutoff'] = 0.5
    m['doubleSided'] = True
    js['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}]
    j = json.dumps(js, separators=(',', ':')).encode(); j += b' ' * ((4 - len(j) % 4) % 4)
    rest = b[20 + L:]
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(j) + len(rest)))
        f.write(struct.pack('<II', len(j), 0x4E4F534A)); f.write(j); f.write(rest)


def main():
    os.makedirs(OUT, exist_ok=True)
    cols, rows, glyphs, files = font_metrics()
    for role in ('name', 'money'):
        shutil.copyfile(os.path.join(UI, files[role]), os.path.join(OUT, files[role]))
    for f in ('ui-prestige.png', 'sign.png'):
        shutil.copyfile(os.path.join(UI, f), os.path.join(OUT, f))
    count = 0
    for idx, ch in enumerate(glyphs):
        if ch == ' ':
            continue
        col, row = idx % cols, idx // cols
        u0 = col / cols + BLEED
        u1 = (col + 1) / cols - BLEED
        v1 = 1 - row / rows - BLEED
        v0 = 1 - (row + 1) / rows + BLEED
        prim = quad(u0, v0, u1, v1)
        roles = ['name'] + (['money'] if ch.isdigit() else [])
        for role in roles:
            write(f'{role}-{idx:02d}.glb', prim, files[role], LIT)
            write(f'{role}-dim-{idx:02d}.glb', prim, files[role], DIM)
            count += 2
    whole = quad(0.0, 0.0, 1.0, 1.0)
    write('prestige.glb', whole, 'ui-prestige.png', LIT)
    write('prestige-dim.glb', whole, 'ui-prestige.png', DIM)
    write('sign.glb', whole, 'sign.png', SIGN)
    print(f'{count} glyph files, prestige x2 and sign written to {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
