#!/usr/bin/env python3
"""
The coin that waits over a piece until it is collected (founder, 19 Nov 2026).

The pot was a number on a button: the money a piece makes was seen leaving it (the rising coin of
`client/gains.ts`) and never seen waiting anywhere. Clash of Clans shows a gold icon over a mine
that holds gold and one tap collects every mine; Steal a Brainrot collects at each brainrot's own
plate. So a coin now floats over each piece of your base that holds money, and that coin is the
signifier (Norman, "Signifiers, not affordances", 2008) of what the button and a touch do.

It is a FILE because it stands over every piece of your base at once: an SDK cylinder with a
material costs the phone one material each, a shared file costs one for all. Same gold as the
rising coin (albedo and emissive #ffcf4d, metallic 0.9, roughness 0.25), so the game keeps one
object for money. A unit cylinder along Y, radius 0.5, height 1: the code lays it on its side and
gives it the coin's thickness by scale, exactly as it does with the primitive.

The faces carry a darker rim and a raised centre in the texture, so the coin reads as a coin when
it turns its face to you and as a disc of gold when it shows its edge.
Writes assets/Models/coin.glb.
"""
import json, math, os, struct
from importlib import util as _u
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _u.spec_from_file_location('aplatir', os.path.join(HERE, 'aplatir-glb.py'))
aplatir = _u.module_from_spec(_spec); _spec.loader.exec_module(aplatir)
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'Models', 'coin.glb')
SEGMENTS = 28


def texture():
    """Left half: the face (rim, field, raised centre). Right half: the edge, one flat tone."""
    w, h = 128, 64
    im = Image.new('RGBA', (w, h), (255, 207, 77, 255))
    d = ImageDraw.Draw(im)
    d.ellipse((0, 0, 63, 63), fill=(214, 150, 30, 255))      # rim
    d.ellipse((6, 6, 57, 57), fill=(255, 214, 92, 255))      # field
    d.ellipse((18, 18, 45, 45), fill=(255, 236, 150, 255))   # raised centre
    d.rectangle((64, 0, 127, 63), fill=(224, 164, 40, 255))  # edge
    return im


def build():
    pos, nor, uv, idx = [], [], [], []
    for side, y, ny in ((0, 0.5, 1.0), (1, -0.5, -1.0)):
        centre = len(pos)
        pos.append((0.0, y, 0.0)); nor.append((0.0, ny, 0.0)); uv.append((0.25, 0.5))
        for i in range(SEGMENTS):
            a = 2 * math.pi * i / SEGMENTS
            x, z = 0.5 * math.cos(a), 0.5 * math.sin(a)
            pos.append((x, y, z)); nor.append((0.0, ny, 0.0)); uv.append((0.25 + 0.48 * x, 0.5 + 0.96 * z))
        for i in range(SEGMENTS):
            a, b = centre + 1 + i, centre + 1 + (i + 1) % SEGMENTS
            idx.extend((centre, b, a) if ny > 0 else (centre, a, b))
    ring = len(pos)
    for i in range(SEGMENTS + 1):
        a = 2 * math.pi * i / SEGMENTS
        x, z = 0.5 * math.cos(a), 0.5 * math.sin(a)
        n = (math.cos(a), 0.0, math.sin(a))
        pos.append((x, 0.5, z)); nor.append(n); uv.append((0.75, 0.25))
        pos.append((x, -0.5, z)); nor.append(n); uv.append((0.75, 0.75))
    for i in range(SEGMENTS):
        t0, b0, t1, b1 = ring + 2 * i, ring + 2 * i + 1, ring + 2 * i + 2, ring + 2 * i + 3
        idx.extend((t0, t1, b0, b0, t1, b1))
    return {'pos': pos, 'nor': nor, 'uv': uv, 'uv_atlas': uv, 'idx': idx}


def main():
    aplatir.ecrire_glb(OUT, [(True, [build()])], texture())
    b = open(OUT, 'rb').read(); L = struct.unpack_from('<I', b, 12)[0]; js = json.loads(b[20:20 + L])
    m = js['materials'][0]
    m['pbrMetallicRoughness'].update({'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0.9, 'roughnessFactor': 0.25})
    m['emissiveTexture'] = {'index': 0}
    m['emissiveFactor'] = [0.9, 0.9, 0.9]
    j = json.dumps(js, separators=(',', ':')).encode(); j += b' ' * ((4 - len(j) % 4) % 4)
    rest = b[20 + L:]
    with open(OUT, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(j) + len(rest)))
        f.write(struct.pack('<II', len(j), 0x4E4F534A)); f.write(j); f.write(rest)
    print(f'coin.glb {os.path.getsize(OUT) / 1024:.1f} KB, {len(build()["idx"]) // 3} triangles')


if __name__ == '__main__':
    main()
