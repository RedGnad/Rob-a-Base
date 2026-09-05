#!/usr/bin/env python3
"""
The pistol as seen from inside the avatar: the body alone, without its outline hull.

`gun.glb` is two shells. The inner one is the gun; the outer one, two millimetres larger with
its normals turned inward, is the toon outline: culled from the outside, only its far faces
show, as a dark rim around the silhouette. That reads as a drawn line when the weapon is a
hand's width on screen, in third person. Held fifty centimetres from a first person camera it
fills a quarter of the screen, and two surfaces two millimetres apart fight for the same
pixels every time the camera moves: the rim sparkles, which the owner saw as the gun
flickering while walking or running (5 Sep, a bug "never solved").

So the view model is the body alone, written from the same file so the two can never drift:
same texture, same material, the inner primitive only. The hand model keeps its outline.

    python3 tools/model/build-gun-view.py
"""
import io
import json
import os
import struct
from importlib import util as _u

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _u.spec_from_file_location('aplatir', os.path.join(HERE, 'aplatir-glb.py'))
aplatir = _u.module_from_spec(_spec)
_spec.loader.exec_module(aplatir)

MODELS = os.path.abspath(os.path.join(HERE, '..', '..', 'assets', 'Models'))
SRC = os.path.join(MODELS, 'gun.glb')
DST = os.path.join(MODELS, 'gun-view.glb')

FMT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
LEN = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def load(path):
    d = open(path, 'rb').read()
    off, js, b = 12, None, b''
    while off < len(d):
        L, k = struct.unpack_from('<II', d, off)
        off += 8
        c = d[off:off + L]
        off += L
        if k == 0x4E4F534A:
            js = json.loads(c)
        else:
            b = c
    return js, b


def acc(js, b, i):
    a = js['accessors'][i]
    bv = js['bufferViews'][a['bufferView']]
    f, n = FMT[a['componentType']], LEN[a['type']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    size = struct.calcsize('<' + f * n)
    stride = bv.get('byteStride', size)
    return [struct.unpack_from('<' + f * n, b, base + k * stride) for k in range(a['count'])]


def main():
    js, b = load(SRC)
    prims = js['meshes'][0]['primitives']
    # The body is the primitive whose normals point outward; the hull is the inverted one.
    def outward_share(p):
        P = acc(js, b, p['attributes']['POSITION'])
        N = acc(js, b, p['attributes']['NORMAL'])
        cx = sum(v[0] for v in P) / len(P)
        cy = sum(v[1] for v in P) / len(P)
        cz = sum(v[2] for v in P) / len(P)
        return sum(1 for v, n in zip(P, N) if (v[0] - cx) * n[0] + (v[1] - cy) * n[1] + (v[2] - cz) * n[2] > 0) / len(P)
    body = max(prims, key=outward_share)
    prim = {
        'pos': acc(js, b, body['attributes']['POSITION']),
        'nor': acc(js, b, body['attributes']['NORMAL']),
        'uv_atlas': acc(js, b, body['attributes']['TEXCOORD_0']),
        'idx': [t[0] for t in acc(js, b, body['indices'])]
    }
    img = js['images'][0]
    bv = js['bufferViews'][img['bufferView']]
    raw = b[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
    atlas = Image.open(io.BytesIO(raw)).convert('RGBA')
    double = js['materials'][body.get('material', 0)].get('doubleSided', False)
    size = aplatir.ecrire_glb(DST, [(double, [prim])], atlas)
    print(f'gun-view.glb  {size / 1024:.1f} Ko  {len(prim["idx"]) // 3} triangles, body only (outward normals {outward_share(body):.2f})')


if __name__ == '__main__':
    main()
