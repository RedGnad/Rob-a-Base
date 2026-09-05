#!/usr/bin/env python3
"""
The soft light behind the piece in a reveal.

A reveal darkens the room UNIFORMLY and then adds LIGHT behind the object: that is what the
genre does, and the first attempt here did the opposite. It shaped the DARKNESS into a disc,
opaque at the middle and fading before the edges, which is a photographic vignette turned
inside out: on screen it read as a black oval with the world visible around its rim (owner,
5 Sep: "on dirait une cataracte"). Darkness with a shape is a hole; light with a shape is a
stage.

So the shape lives here instead, in the glow: white, brightest at the centre, gone well before
the edge, on a square plane so it stays a circle at any screen ratio. The scrim that darkens
the world carries no texture at all.

    python3 tools/ui/build-reveal-glow.py
"""
import math
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'assets', 'textures', 'reveal-glow.png'))

N = 256
# A core that is nearly solid, then a long fall to nothing: the ramp of a lamp, not of a lid.
COEUR = 0.10
BORD = 0.50
COURBE = 2.2


def main():
    im = Image.new('RGBA', (N, N), (255, 255, 255, 0))
    px = im.load()
    for y in range(N):
        for x in range(N):
            dx = (x + 0.5) / N * 2 - 1
            dy = (y + 0.5) / N * 2 - 1
            r = math.sqrt(dx * dx + dy * dy)
            if r <= COEUR:
                a = 1.0
            elif r >= BORD:
                a = 0.0
            else:
                a = (1 - (r - COEUR) / (BORD - COEUR)) ** COURBE
            px[x, y] = (255, 255, 255, int(round(255 * a)))
    im.save(OUT, optimize=True)
    print(f'reveal-glow.png  {os.path.getsize(OUT) / 1024:.1f} Ko  {N}x{N}')


if __name__ == '__main__':
    main()
