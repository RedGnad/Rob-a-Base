#!/usr/bin/env python3
"""Draws the world's still textures: the belt tread, the resting grass, the wall panels, the
balloons. The rush floors are `build-rush-mats.py`, one colour tile per rush.

The renderer can slide a texture's UV offset at a constant speed (`Tween.setTextureMoveContinuous`),
and that is how the belt runs. It needs an image that tiles: the belt's tread is one square
cell, so it wraps without a seam under TWM_REPEAT. The grey images here are grey on purpose:
the material's albedo colour multiplies them, so one image serves every tint.

Requires Python with Pillow. The outputs are committed, so building the scene needs neither.

    python3 tools/world/build-world-textures.py
"""
import math
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '../../assets/textures'))
N = 256

# The palette of src/client/toy.ts, by role.
BELT = (0xE6, 0x39, 0x46)
TREAD = (0xF2, 0xE9, 0xD8)
SEAM = (0x2B, 0x2D, 0x42)


def belt():
    """One cell of tread: two cream bars across the direction of travel (u), each edged dark."""
    im = Image.new('RGB', (N, N), BELT)
    d = ImageDraw.Draw(im)
    for x0 in (40, 168):
        d.rectangle([x0 - 4, 0, x0 + 51, N - 1], fill=SEAM)
        d.rectangle([x0, 0, x0 + 47, N - 1], fill=TREAD)
    return im


def belt_strip(cells=16, w=128):
    """The whole belt in one image, so the material's tiling can be (1, 1).

    The mobile client's texture tweens write their own UV scale, (1, 1) by default, over the
    material's tiling (godot-explorer, scene_runner/components/tween.rs and scene.rs, read
    30 Aug): a tread tiled ten times over the plane became one cell stretched across it,
    sliding eleven times faster than the crates. Baking the repetition into the image makes
    tiling 1 the truth on every client, and the offset's unit is then one belt length.
    Sixteen cells over the 28 m plane, 1.75 m each; 2048 wide keeps it a power of two.
    """
    im = Image.new('RGB', (cells * w, w), BELT)
    d = ImageDraw.Draw(im)
    for c in range(cells):
        x = c * w
        for x0 in (int(40 * w / 256), int(168 * w / 256)):
            d.rectangle([x + x0 - 2, 0, x + x0 + int(51 * w / 256), w - 1], fill=SEAM)
            d.rectangle([x + x0, 0, x + x0 + int(47 * w / 256), w - 1], fill=TREAD)
    return im


def wall_panel():
    """Toy-plastic panelling for the base slabs and plinths: a whisper of a bevel grid.

    Same doctrine as the grass: the tint carries the colour, the pattern only breathes.
    One metre panels (64 px at 2.6 m cells... the cell here is simply a quarter of the
    image), values 0.94..1.0, a soft seam and a corner highlight so the plastic reads
    moulded rather than painted.
    """
    im = Image.new('RGB', (N, N))
    px = im.load()
    q = N // 4
    for j in range(N):
        for i in range(N):
            di = min(i % q, q - 1 - i % q)
            dj = min(j % q, q - 1 - j % q)
            v = 1.0
            if min(di, dj) < 2: v -= 0.06
            elif min(di, dj) < 5: v -= 0.02
            n2 = math.sin(i * 7.13 + j * 3.71) * 43758.5453
            n2 -= math.floor(n2)
            v += (n2 - 0.5) * 0.015
            g = int(round(255 * max(0.0, min(1.0, v))))
            px[i, j] = (g, g, g)
    return im


def ballon(kind):
    """Party-balloon skins: white base, soft pattern, tinted by the material's albedo.

    The marketplace balloon pack was retired (inverted faces, five rounds of tester time);
    these give our own spheres the richness the plain plastic lacked. White base so one
    image serves every party colour; the pattern sits at two depths so it reads at range.
    """
    im = Image.new('RGB', (N, N), (255, 255, 255))
    d = ImageDraw.Draw(im)
    if kind == 'pois':
        for gy in range(4):
            for gx in range(8):
                x = gx * 32 + (16 if gy % 2 else 0)
                y = gy * 64 + 32
                r = 13
                d.ellipse([x - r, y - r, x + r, y + r], fill=(228, 228, 228))
                d.ellipse([x - r + 3, y - r + 3, x + r - 3, y + r - 3], fill=(214, 214, 214))
    else:
        for x0 in range(0, N, 64):
            d.rectangle([x0, 0, x0 + 30, N - 1], fill=(222, 222, 222))
            d.rectangle([x0 + 8, 0, x0 + 22, N - 1], fill=(210, 210, 210))
    return im


def grass():
    """The resting mat: a two-tone checker, quieter than any event.

    A flat colour gives the eye nothing that moves, so running reads as standing still;
    every reference in the genre keeps a periodic pattern underfoot (Brawl Stars checkers
    its ground at a whisper of contrast, the Roblox tycoons tile their baseplates) and
    keeps it QUIET, because a loud grid is a bathroom floor, the same lesson the first
    event mat taught. Two tiles per image edge, values 0.91..1.0 so the play-mat green
    stays the colour and the checker only gives the ground a grain: a step between tiles,
    a soft seam, a sprinkle of blades.
    """
    im = Image.new('RGB', (N, N))
    px = im.load()
    half = N // 2
    for j in range(N):
        for i in range(N):
            v = 1.0 if ((i // half) + (j // half)) % 2 == 0 else 0.945
            di = min(i % half, half - 1 - i % half)
            dj = min(j % half, half - 1 - j % half)
            if min(di, dj) < 2:
                v -= 0.035
            n = math.sin(i * 12.9898 + j * 78.233) * 43758.5453
            n -= math.floor(n)
            v += (n - 0.5) * 0.03
            g = int(round(255 * max(0.0, min(1.0, v))))
            px[i, j] = (g, g, g)
    return im


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    belt().save(os.path.join(OUT, 'belt.png'), optimize=True)
    belt_strip().save(os.path.join(OUT, 'belt-strip.png'), optimize=True)
    # The rush floors are build-rush-mats.py, one colour tile per rush.
    grass().save(os.path.join(OUT, 'mat-grass.png'), optimize=True)
    ballon('pois').save(os.path.join(OUT, 'ballon-pois.png'), optimize=True)
    ballon('rayures').save(os.path.join(OUT, 'ballon-rayures.png'), optimize=True)
    wall_panel().save(os.path.join(OUT, 'mat-wall.png'), optimize=True)
    # A white square: the texture a material names when it wants NO picture. Omitting the
    # texture field leaves the client on whatever it drew last; naming this one replaces it.
    Image.new('RGB', (8, 8), (255, 255, 255)).save(os.path.join(OUT, 'blank.png'), optimize=True)
    print('wrote', OUT)
