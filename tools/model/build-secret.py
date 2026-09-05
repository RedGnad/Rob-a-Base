"""The Secret piece as a model: a planet and its ring, one mesh with real UVs.

The Secret was the only rarity drawn from primitives (a sphere and a disc tinted at runtime),
so it had no baked variants: a Cursed Secret glowed pink instead of wearing the cursed veins,
and each one cost the phone two materials (owner, 5 Sep, 04:30). One mesh, authored in the
piece's unit space like the chess set (sphere diameter 0.6, ring diameter 1.3, thickness 0.08,
centred on the origin), so `tools/model/build-item-variants.py` bakes it like the others.
Sphere UVs are longitude and latitude; the ring's run around it and across it, so a gradient
wraps, a star field spreads and a grid tiles.

Usage: python3 tools/model/build-secret.py  ->  assets/toy/item-6.glb
"""
import importlib.util, math, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '../../assets/toy'))
_spec = importlib.util.spec_from_file_location('aplatir', os.path.join(HERE, 'aplatir-glb.py'))
aplatir = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(aplatir)

class Mesh:
    def __init__(self): self.pos, self.nor, self.uv, self.idx = [], [], [], []
    def vertex(self, p, n, uv):
        self.pos.append(tuple(p)); self.nor.append(tuple(n)); self.uv.append(tuple(uv)); return len(self.pos) - 1
    def tri(self, a, b, c): self.idx.extend((a, b, c))

def sphere(m, r, lon=28, lat=16):
    rows = []
    for j in range(lat + 1):
        phi = math.pi * j / lat
        row = []
        for i in range(lon + 1):
            th = 2 * math.pi * i / lon
            n = (math.sin(phi) * math.cos(th), math.cos(phi), math.sin(phi) * math.sin(th))
            row.append(m.vertex((n[0] * r, n[1] * r, n[2] * r), n, (i / lon, j / lat)))
        rows.append(row)
    for j in range(lat):
        for i in range(lon):
            a, b, c, d = rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]
            if j > 0: m.tri(a, d, b)
            if j < lat - 1: m.tri(b, d, c)

def ring(m, r_in, r_out, h, segs=48):
    """Four faces, each its own UV strip in PROPORTION: u once around, v across the face at
    the face's true width over its circumference.

    The first unwrap gave every face the unit square, and the two rims a LINE (v = 1 on both
    edges of the outer face, 0 on the inner), so the rims had no texel of their own and the
    top face was stretched fifty to one. Under an object-space bake that is invisible until
    the islands are packed on top of one another, which they were: the ring wore the planet's
    pattern and it broke where the strip closed (owner, 5 Sep: "la texture gold de l'anneau a
    une coupure"). Proportional strips pack as thin rows, and the bake paints every face.
    """
    ann = (r_out - r_in) / (math.pi * (r_in + r_out))
    for side, n in ((h / 2, (0, 1, 0)), (-h / 2, (0, -1, 0))):
        inner, outer = [], []
        for i in range(segs + 1):
            th = 2 * math.pi * i / segs; c, s = math.cos(th), math.sin(th)
            inner.append(m.vertex((c * r_in, side, s * r_in), n, (i / segs, 0.0)))
            outer.append(m.vertex((c * r_out, side, s * r_out), n, (i / segs, ann)))
        for i in range(segs):
            if side > 0: m.tri(inner[i], outer[i], outer[i + 1]); m.tri(inner[i], outer[i + 1], inner[i + 1])
            else: m.tri(inner[i], outer[i + 1], outer[i]); m.tri(inner[i], inner[i + 1], outer[i + 1])
    for rad, out in ((r_out, True), (r_in, False)):
        top, bot = [], []
        rim = h / (2 * math.pi * rad)
        for i in range(segs + 1):
            th = 2 * math.pi * i / segs; c, s = math.cos(th), math.sin(th)
            n = (c, 0, s) if out else (-c, 0, -s)
            top.append(m.vertex((c * rad, h / 2, s * rad), n, (i / segs, rim)))
            bot.append(m.vertex((c * rad, -h / 2, s * rad), n, (i / segs, 0.0)))
        for i in range(segs):
            if out: m.tri(top[i], bot[i], bot[i + 1]); m.tri(top[i], bot[i + 1], top[i + 1])
            else: m.tri(top[i], bot[i + 1], bot[i]); m.tri(top[i], top[i + 1], bot[i + 1])

def orient(path):
    """Turn every triangle to agree with its vertex normals. The writer's own convention left
    1,128 of the 1,224 triangles wound inward with normals pointing outward, so the client
    culled the near hemisphere and the planet read as a hollow shell (owner, 5 Sep: "le
    modele 3D du secret est transparent et pas plein").""" 
    import json, struct
    b = open(path, 'rb').read()
    L = struct.unpack_from('<I', b, 12)[0]; js = json.loads(b[20:20 + L]); off = 20 + L
    L2 = struct.unpack_from('<I', b, off)[0]; chunk = bytearray(b[off + 8:off + 8 + L2])
    def acc(i, fmt, n):
        a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]; base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        size = struct.calcsize('<' + fmt * n); stride = bv.get('byteStride', size)
        return base, stride, [struct.unpack_from('<' + fmt * n, chunk, base + k * stride) for k in range(a['count'])]
    flipped = 0
    for mesh in js['meshes']:
        for prim in mesh['primitives']:
            _, _, P = acc(prim['attributes']['POSITION'], 'f', 3); _, _, N = acc(prim['attributes']['NORMAL'], 'f', 3)
            ia = js['accessors'][prim['indices']]; fmt = {5123: 'H', 5125: 'I', 5121: 'B'}[ia['componentType']]
            base, stride, I = acc(prim['indices'], fmt, 1); I = [t[0] for t in I]
            for t in range(0, len(I), 3):
                a, b2, c = P[I[t]], P[I[t + 1]], P[I[t + 2]]
                u = [b2[i] - a[i] for i in range(3)]; v = [c[i] - a[i] for i in range(3)]
                n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
                nn = [sum(N[I[t + k]][i] for k in range(3)) for i in range(3)]
                if sum(n[i] * nn[i] for i in range(3)) < 0:
                    struct.pack_into('<' + fmt, chunk, base + (t + 1) * stride, I[t + 2])
                    struct.pack_into('<' + fmt, chunk, base + (t + 2) * stride, I[t + 1])
                    flipped += 1
    out = b[:off + 8] + bytes(chunk) + b[off + 8 + L2:]
    open(path, 'wb').write(out)
    print(f'  {flipped} triangles turned to face outward')

def animate(path, period=2.4, tilt_deg=30.0):
    """The planet gets its own node and a baked clip: a quick spin the other way about an axis
    tilted thirty degrees, while the piece's own spin (the client's tween on the parent, six
    seconds a turn) turns the ring about the vertical. The parent's spin adds to the planet's,
    so the planet only reads as turning the other way when its own spin is clearly faster:
    2.4 s a turn against 6, net about one turn in four seconds backwards, with the tilt's
    wobble (owner, 5 Sep: "presque l'inverse de l'anneau, mais avec des composantes en biais")."""
    import json, struct, math
    b = open(path, 'rb').read()
    L = struct.unpack_from('<I', b, 12)[0]; js = json.loads(b[20:20 + L]); off = 20 + L
    L2 = struct.unpack_from('<I', b, off)[0]; chunk = bytearray(b[off + 8:off + 8 + L2])
    prims = js['meshes'][0]['primitives']
    assert len(prims) == 2, 'planet and ring expected'
    js['meshes'] = [{'name': 'ring', 'primitives': [prims[1]]}, {'name': 'planet', 'primitives': [prims[0]]}]
    js['nodes'] = [{'name': 'plat', 'mesh': 0, 'children': [1]}, {'name': 'planet', 'mesh': 1}]
    n = 7
    times = [period * k / (n - 1) for k in range(n)]
    t = math.radians(tilt_deg); axis = (math.sin(t), math.cos(t), 0.0)
    quats = []
    for k in range(n):
        # Positive here IS the other way round in the client: the writer mirrors X (right-handed
        # glTF to the engine's left hand), and a reflection reverses every rotation's sense.
        th = 2 * math.pi * k / (n - 1)
        s2, c2 = math.sin(th / 2), math.cos(th / 2)
        quats.append((axis[0] * s2, axis[1] * s2, axis[2] * s2, c2))
    def push(data):
        while len(chunk) % 4: chunk.append(0)
        js['bufferViews'].append({'buffer': 0, 'byteOffset': len(chunk), 'byteLength': len(data)})
        chunk.extend(data); return len(js['bufferViews']) - 1
    bv_in = push(struct.pack('<' + 'f' * n, *times))
    bv_out = push(struct.pack('<' + 'f' * (4 * n), *[c for q in quats for c in q]))
    js['accessors'].append({'bufferView': bv_in, 'componentType': 5126, 'count': n, 'type': 'SCALAR', 'min': [0.0], 'max': [period]})
    a_in = len(js['accessors']) - 1
    js['accessors'].append({'bufferView': bv_out, 'componentType': 5126, 'count': n, 'type': 'VEC4'})
    a_out = len(js['accessors']) - 1
    js['animations'] = [{'name': 'spin', 'samplers': [{'input': a_in, 'output': a_out, 'interpolation': 'LINEAR'}],
                         'channels': [{'sampler': 0, 'target': {'node': 1, 'path': 'rotation'}}]}]
    js['buffers'][0]['byteLength'] = len(chunk)
    jb = json.dumps(js, separators=(',', ':')).encode(); jb += b' ' * ((4 - len(jb) % 4) % 4)
    while len(chunk) % 4: chunk.append(0)
    total = 12 + 8 + len(jb) + 8 + len(chunk)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total)); f.write(struct.pack('<II', len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack('<II', len(chunk), 0x004E4942)); f.write(bytes(chunk))
    print('  planet node and spin clip written')

def main():
    planet, halo = Mesh(), Mesh()
    sphere(planet, 0.30)
    ring(halo, 0.42, 0.65, 0.08)
    prim = lambda m: {'pos': m.pos, 'nor': m.nor, 'uv': m.uv, 'uv_atlas': m.uv, 'idx': m.idx}
    atlas = Image.new('RGBA', (4, 4), (255, 255, 255, 255))
    path = os.path.join(OUT, 'item-6.glb')
    taille = aplatir.ecrire_glb(path, [(False, [prim(planet)]), (False, [prim(halo)])], atlas)
    orient(path)
    animate(path)
    tris = (len(planet.idx) + len(halo.idx)) // 3
    print(f'item-6.glb  {os.path.getsize(path) / 1024:.1f} Ko  {tris} triangles')

if __name__ == '__main__':
    main()
