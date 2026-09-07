"""
The six arrow icons, redrawn around THE client's own arrow.

Why this file exists. Our arrows were a rounded rectangle topped by a sharp-cornered triangle,
drawn in `build-hud-icon.js`. The client's own touch pad, on the SAME arc and a few pixels from
ours, carries an arrow with a wide head, rounded shoulders and apex, and a short flared shaft.
Two vocabularies on one arc (owner, 7 Sep). Two attempts at being "inspired by" it were rightly
refused: notching the base then rounding the corners does not reproduce a shape, it comments on
it.

So we take theirs, literally. `vendor/fleche-hud.png` is its silhouette, extracted pixel by pixel
from the jump button screenshot: threshold the cream ink over the blue disc, connected components
to separate the upper chevron (1284 px, the "again" of the double jump, which none of our verbs
says) from the full arrow (3014 px), x4 upscale and re-threshold to recover a clean edge, then
fill the enclosed interior. Their drawing is an OUTLINE; ours is solid, and that is what holds the
whole family together, so we keep the silhouette and fill it.

What this script does not touch: everything else in each icon, the plates, shelves and coins, is
redrawn here with the same coordinates as the JS, so nothing moves except the arrow.

It runs AFTER `build-hud-icon.js`, whose six files it overwrites, and BEFORE
`normalise-glyphs.py`, which brings the whole family to one optical extent. `tools/ui/build-icons.sh`
runs the chain in the right order.

Run: node tools/ui/build-hud-icon.js && python3 tools/ui/build-arrow-icons.py
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '../../assets/ui'))
ARROW = os.path.join(HERE, 'vendor/fleche-hud.png')

N = 256
SS = 4                      # supersampling: the arrow's edges are already pixels, so we work
                            # large and shrink at the end, like the rest of the chain
WHITE = (255, 255, 255, 255)
NAVY = (16, 26, 43, 255)
RADIUS = 0.027              # bar corner radius, as a share of the side

# The boxes the arrow has to fill, and its heading, as shares of the side. They reuse EXACTLY the
# ink the old arrow occupied in `build-hud-icon.js`, so the substitution moves none of the pieces
# around it.
#   heading: 'up' | 'down' | 'right'
#   bars: rounded rectangles (cx, cy, half width, half height)
ICONS = {
    'drop':   dict(heading='down',  box=(0.22, 0.14, 0.78, 0.80), bars=[]),
    'place':  dict(heading='down',  box=(0.22, 0.10, 0.78, 0.76),
                   bars=[(0.5, 0.90, 0.34, 0.055)]),
    'give':   dict(heading='right', box=(0.10, 0.22, 0.76, 0.78),
                   bars=[(0.90, 0.5, 0.055, 0.34)]),
    'pickup': dict(heading='up',    box=(0.315, 0.075, 0.685, 0.45),
                   bars=[(0.5, 0.855, 0.33, 0.045), (0.5, 0.645, 0.135, 0.115)]),
    'up':     dict(heading='up',    box=(0.27, 0.235, 0.73, 0.775),
                   bars=[(0.5, 0.90, 0.35, 0.045), (0.5, 0.10, 0.35, 0.045)]),
    'outbid': dict(heading='up',    box=(0.255, 0.06, 0.745, 0.58),
                   bars=[(0.5, 0.715, 0.245, 0.058), (0.5, 0.865, 0.245, 0.058)]),
}


def arrow(heading, width, height):
    """The client's silhouette, STRETCHED to the requested box and turned to `heading`.

    Stretched, and the ratio-preserving version was rendered beside it then set aside on the
    board (owner, 7 Sep). Their arrow is nearly square; our boxes are not, each being whatever
    its verb leaves free between its plates and shelves. Keeping the ratio leaves the arrow
    floating in the empty part of its box and coming out smaller than the rest of the family,
    which breaks the common-weight rule. Stretched it fills its place, and the shape takes it
    because it has no circle to distort: straight segments and rounded corners.
    """
    m = Image.open(ARROW).convert('L')
    if heading == 'right':
        m = m.rotate(-90, expand=True)
    elif heading == 'down':
        m = m.transpose(Image.FLIP_TOP_BOTTOM)
    return m.resize((max(1, width), max(1, height)), Image.LANCZOS)


def draw(name, colour):
    spec = ICONS[name]
    big = N * SS
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for cx, cy, hw, hh in spec['bars']:
        d.rounded_rectangle(
            [(cx - hw) * big, (cy - hh) * big, (cx + hw) * big, (cy + hh) * big],
            radius=RADIUS * big, fill=colour)
    x0, y0, x1, y1 = spec['box']
    bw, bh = round((x1 - x0) * big), round((y1 - y0) * big)
    m = arrow(spec['heading'], bw, bh)   # stretched: `m` fills the box exactly
    ink = Image.new('RGBA', m.size, colour)
    ink.putalpha(m)
    im.alpha_composite(ink, (round(x0 * big) + (bw - m.width) // 2,
                             round(y0 * big) + (bh - m.height) // 2))
    return im.resize((N, N), Image.LANCZOS)


if __name__ == '__main__':
    for family, colour in (('icon', WHITE), ('encre', NAVY)):
        for name in ICONS:
            f = f'{family}-{name}.png'
            draw(name, colour).save(os.path.join(OUT, f), optimize=True)
            print(f'wrote {f}')
