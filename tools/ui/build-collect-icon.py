"""
The COLLECT glyph: a coin standing on a stack of coins.

Why the old one had to go. It drew three cylinders seen from slightly above, flat elliptical
tops, one over the other. That is the DATABASE pictogram, in every icon set ever published, and
the association is strong enough that no amount of context undoes it: the button under the
player's thumb said "server storage" where it meant "take your money" (owner, 7 Sep).

What tells the two apart, and it is one thing only: a database is drawn in PERSPECTIVE, so its
top is an ellipse. A coin is drawn FLAT, so it is a circle. Everything else about the two
drawings is the same, which is exactly why the old one read wrong.

So the glyph is a full circle, face on, resting on two edge-on bars that say "and there are
more underneath". That pair is the near-universal money glyph, and it cannot be read as a
cylinder because nothing about it recedes.

The two masses touch, and where they touch a void is carved, the same technique the crate uses
between its planks (`build-hud-icon.js`: ce sont les vides qui dessinent). One flat ink still
reads as two objects.

Sizing is left to `tools/ui/normalise-glyphs.py`, which brings every verb to one optical extent.

Run: python3 tools/ui/build-collect-icon.py
"""
import os
from PIL import Image, ImageDraw, ImageChops, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '../../assets/ui'))
N = 256
SS = 4
WHITE = (255, 255, 255, 255)
NAVY = (16, 26, 43, 255)

# In a 100 x 100 design space: three coins in a row, each overlapping the next.
RAYON = 25
CENTRES = [(27, 50), (50, 50), (73, 50)]
# The air carved where one coin covers the one behind it. Same technique as the crate's planks.
VIDE = 4.5


def dessine(size, colour):
    """Three discs, drawn back to front, each hollowing the one behind it."""
    big = size * SS
    k = big / 100.0
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    n = int(VIDE * k) * 2 + 1

    for cx, cy in CENTRES:
        piece = Image.new('RGBA', (big, big), (0, 0, 0, 0))
        ImageDraw.Draw(piece).ellipse([(cx - RAYON) * k, (cy - RAYON) * k,
                                       (cx + RAYON) * k, (cy + RAYON) * k], fill=colour)
        # Hollow out what is already drawn, then land on top: the coin in front reads as being
        # in front, and one flat ink still separates into three objects.
        masque = piece.split()[3].filter(ImageFilter.MaxFilter(min(n, 199)))
        im.putalpha(ImageChops.subtract(im.split()[3], masque))
        im.alpha_composite(piece)
    return im.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    for family, colour in (('icon', WHITE), ('encre', NAVY)):
        name = f'{family}-collect.png'
        dessine(N, colour).save(os.path.join(OUT, name), optimize=True)
        print(f'wrote {name}')
