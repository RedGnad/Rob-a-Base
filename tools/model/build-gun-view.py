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

So the view model is the body alone, cut out of the SAME file byte for byte: the JSON loses
the hull's primitive, the binary chunk is copied untouched. The first version rebuilt the mesh
through the shared writer, which negates X for the engine's handedness, and shipped a mirrored
gun; the owner saw the barrel drift off the bullet's line (6 Sep). Nothing here is rewritten.

    python3 tools/model/build-gun-view.py
"""
import json
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
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


def outward_share(js, b, p):
    P = acc(js, b, p['attributes']['POSITION'])
    N = acc(js, b, p['attributes']['NORMAL'])
    cx = sum(v[0] for v in P) / len(P)
    cy = sum(v[1] for v in P) / len(P)
    cz = sum(v[2] for v in P) / len(P)
    return sum(1 for v, n in zip(P, N) if (v[0] - cx) * n[0] + (v[1] - cy) * n[1] + (v[2] - cz) * n[2] > 0) / len(P)


def write_glb(path, js, b):
    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    b = b + b'\x00' * ((4 - len(b) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(b)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A))
        f.write(jb)
        f.write(struct.pack('<II', len(b), 0x004E4942))
        f.write(b)
    return total


def main():
    js, b = load(SRC)
    prims = js['meshes'][0]['primitives']
    # The body is the primitive whose normals point outward; the hull is the inverted one.
    body = max(prims, key=lambda p: outward_share(js, b, p))
    js['meshes'][0]['primitives'] = [body]
    size = write_glb(DST, js, b)
    P0 = acc(*load(SRC), body['attributes']['POSITION'])
    P1 = acc(*load(DST), body['attributes']['POSITION'])
    assert P0[:16] == P1[:16], 'the body moved: the cut must not touch a single vertex'
    print(f'gun-view.glb  {size / 1024:.1f} Ko  body only, {len(acc(js, b, body["indices"])) // 3} triangles, vertices identical to gun.glb')


if __name__ == '__main__':
    main()
