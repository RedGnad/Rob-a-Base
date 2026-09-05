"""
The BUILD glyph: a wooden mallet, in one mass, with two swing frames.

Drawn after the owner's reference (a line icon of a mallet, 3 Sep), measured rather than
remembered: the head is a rounded block about 1.8 times as long as it is thick, set across
the handle; the handle is a straight bar, HALF the head's thickness wide and 1.3 times as
long as the head, passing THROUGH the head and showing a short square stub on the far side;
the grip end is cut flat. The whole tool leans so the head sits top-right and the handle
runs down-left. Nothing is drawn inside the shape: at 56 px on a phone only the silhouette
survives. A first pass kept an older hammer and hung a cap on the head's END, which is not
in the reference; this one follows it.

Three poses, rotated about the grip end: raised (15 degrees), halfway (6) and struck (0).
The raise was 22, and a tool swung 22 degrees about its grip carries its head across a fifth
of the icon: on a 104 pixel button the mallet left the middle of the disc and came back, which
reads as the picture sliding rather than the tool striking (owner, 5 Sep). Fifteen keeps the
travel near a tenth, which is the movement itself and not a journey.
The struck pose is the icon at rest; the other two are shown briefly at the start of every
period when the contextual button offers BUILD, see `Pouce` in src/client/ui-kit.tsx.

Two families, as for every verb (src/client/icones.ts): `icon-*` white, `encre-*` navy.
Run: python3 tools/ui/build-mallet-icon.py
"""
import os
from PIL import Image, ImageChops, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '../../assets/ui'))
N = 256
SS = 8
WHITE = (255, 255, 255, 255)
NAVY = (16, 26, 43, 255)
TILT = -42          # degrees; the head top-right, the handle down-left
POSES = {'raised': 15, 'mid': 6, 'struck': 0}

# The upright design, in a 100 x 150 box (x, y), head on top, handle straight down.
#
# The handle was 13 wide, 0.18 of the head's length, which is what the reference LINE icon
# had. Ours is not a line icon: every other verb in the set is a solid mass, and beside them
# the mallet read as a tool with a stick (owner, 5 Sep: "manche tres fin"). At half the head's
# thickness it is the same object drawn in the same weight as its neighbours, and the stub
# that shows above the head follows it, because it is the same piece of wood.
HEAD = (15, 14, 85, 53)       # 70 long, 39 thick
STUB = (40.25, 4, 59.75, 18)  # the handle's end showing through the top of the head
HANDLE = (40.25, 40, 59.75, 146)  # 19.5 wide, half the head's thickness, to a flat grip end
PIVOT = (50, 144)             # the swing turns about the grip end


def mallet(size, swing_deg, colour, margin=0.06):
    """The mallet in a size x size image, drawn big, swung, tilted, then fitted."""
    big = 150 * SS
    layer = Image.new('RGBA', (big * 2, big * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    ox, oy = big / 2 + 25 * SS, big / 2  # centre the 100 x 150 design in the 300 x 300 canvas

    def box(r):
        return [ox + r[0] * SS, oy + r[1] * SS, ox + r[2] * SS, oy + r[3] * SS]

    d.rounded_rectangle(box(HEAD), radius=6 * SS, fill=colour)
    d.rounded_rectangle(box(STUB), radius=2 * SS, fill=colour)
    d.rectangle(box(HANDLE), fill=colour)
    pivot = (ox + PIVOT[0] * SS, oy + PIVOT[1] * SS)
    if swing_deg:
        layer = layer.rotate(swing_deg, resample=Image.BICUBIC, center=pivot)
    layer = layer.rotate(TILT, resample=Image.BICUBIC, center=(big, big))
    # Fit the struck pose's footprint, so the three frames share one frame of reference.
    return layer, pivot


def framed(size, colour):
    """All three poses cropped to the same box: the union of their footprints, plus margin."""
    layers = {pose: mallet(size, swing, colour)[0] for pose, swing in POSES.items()}
    union = Image.new('L', layers['struck'].size, 0)
    for im in layers.values():
        union = ImageChops.lighter(union, im.split()[3])
    bbox = union.getbbox()
    side = max(bbox[2] - bbox[0], bbox[3] - bbox[1])
    cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    half = side / 2 * (1 + 0.12)
    crop = (int(cx - half), int(cy - half), int(cx + half), int(cy + half))
    return {pose: im.crop(crop).resize((size, size), Image.LANCZOS) for pose, im in layers.items()}


if __name__ == '__main__':
    for family, colour in (('icon', WHITE), ('encre', NAVY)):
        for pose, im in framed(N, colour).items():
            name = f'{family}-build.png' if pose == 'struck' else f'{family}-build-{pose}.png'
            im.save(os.path.join(OUT, name), optimize=True)
            print(f'wrote {name}')
