"""
The SMASH glyph: the same mallet, coming down on a box.

Why it is not the BUILD glyph. The contextual button showed the bare mallet for BUILD and the
bare mallet again for SMASH, so the picture was identical before and after buying a box, and a
mobile tester never worked out that a box has to be hit (owner, 6 Sep, then again 7 Sep: "ca me
derange qu'il soit le meme que build"). Two verbs, one picture, is the interface saying nothing.

What changes, and why that and not something else. The TOOL is the same in both cases, because
it is the same tool: swapping it for an unrelated symbol would throw away the one thing the
player has already learnt. What differs between the two verbs is the OBJECT, so the object is
what the glyph adds. That is also how the genre draws it: the reference for "break this open"
is the container plus whatever hits it, never the tool alone.

Drawing rules inherited from the family (see build-mallet-icon.py): one flat mass, no interior
detail, nothing that needs more than a silhouette at 56 px on a phone. Two masses that touch
would fuse into one unreadable blob, so the mallet head stops SHORT of the lid and the gap is
part of the design, not slack. The lid is cut out of the box rather than drawn on it, for the
same reason: a line drawn in the same colour would be invisible.

Three poses, like BUILD, so the button keeps its swing: raised, halfway, struck. The box never
moves; only the mallet does, which is what makes the blow read as a blow rather than as the
whole picture sliding.

Run: python3 tools/ui/build-smash-icon.py
"""
import os
from PIL import Image, ImageDraw

from importlib.machinery import SourceFileLoader

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '../../assets/ui'))
# The mallet lives in the tool that owns it: one drawing, one place, so the two glyphs cannot
# drift into two different mallets.
maillet = SourceFileLoader('maillet', os.path.join(HERE, 'build-mallet-icon.py')).load_module()

N = 256
SS = 4
WHITE = (255, 255, 255, 255)
NAVY = (16, 26, 43, 255)

# The box, in a 100 x 100 design space: bottom-left, wide enough to read as a container and low
# enough to leave the mallet the top-right quadrant it swings through.
BOX = (4, 62, 72, 98)
BOX_R = 7
# The lid, cut straight out: a band of nothing across the box's shoulders.
LID_Y = 72.5
LID_H = 5.5
# How far the mallet's own square is inset, and where it sits.
MALLET_SIDE = 60
MALLET_AT = (38, -4)


def dessine(size, swing_deg, colour):
    big = size * SS
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    k = big / 100.0

    d.rounded_rectangle([BOX[0] * k, BOX[1] * k, BOX[2] * k, BOX[3] * k], radius=BOX_R * k, fill=colour)
    # The lid, cut rather than drawn. `rectangle` with a transparent fill would not erase, so
    # the band is punched through the alpha channel directly.
    band = Image.new('L', im.size, 255)
    ImageDraw.Draw(band).rectangle(
        [BOX[0] * k - 1, LID_Y * k, BOX[2] * k + 1, (LID_Y + LID_H) * k], fill=0)
    a = im.split()[3]
    a.paste(0, (0, 0), band.point(lambda v: 255 - v))
    im.putalpha(a)

    # The mallet, from its own tool, scaled into the top-right and swung about its grip.
    m = maillet.framed(int(MALLET_SIDE * k), colour)
    pose = m[swing_deg]
    im.alpha_composite(pose, (int(MALLET_AT[0] * k), int(MALLET_AT[1] * k)))
    return im.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    for family, colour in (('icon', WHITE), ('encre', NAVY)):
        for pose in ('struck', 'mid', 'raised'):
            im = dessine(N, pose, colour)
            name = f'{family}-smash.png' if pose == 'struck' else f'{family}-smash-{pose}.png'
            im.save(os.path.join(OUT, name), optimize=True)
            print(f'wrote {name}')
