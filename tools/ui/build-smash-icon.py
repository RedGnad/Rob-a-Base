"""
The SMASH glyph: our own box, with our own mallet coming down on it from the left.

Why it is not the BUILD glyph. The contextual button showed the bare mallet for BUILD and the
bare mallet again for SMASH, so the picture was identical before and after buying a box, and a
mobile tester never worked out that a box has to be hit (owner, 6 Sep, then again 7 Sep: "ca me
derange qu'il soit le meme que build"). Two verbs, one picture, is the interface saying nothing.

What changes, and why that and not something else. The TOOL is the same in both cases, because
it is the same tool: swapping it for an unrelated symbol would throw away the one thing the
player has already learnt. What differs between the two verbs is the OBJECT, so the object is
what the glyph adds. That is also how the genre draws it: the reference for "break this open"
is the container plus whatever hits it, never the tool alone.

Neither half is redrawn here, and that is the whole point of the file.

  The box is `encre-crate.png` ITSELF, loaded and tinted, not a rounded rectangle that looks
  like it. A first version drew its own box and the owner spotted it at once (7 Sep: "la box
  correspond pas a notre logo de box qu'on a deja"). The game has one box glyph, drawn in
  build-hud-icon.js with its overhanging lid and the gaps between its planks; anything else is
  a second box that will drift from the first.

  The mallet comes from build-mallet-icon.py, the tool that owns it.

Placement follows the reading order, which is an instruction and not a taste: we read left to
right, so the thing that ACTS comes first and the thing ACTED ON comes second. The mallet is
therefore on the left, in front, and the box sits to its lower right where the blow lands
(owner, 7 Sep). The mallet is drawn head up-right for BUILD, where it stands alone; laid beside
a box in that pose it points AWAY from it, so it is turned a quarter clockwise here and its head
comes down onto the box's left shoulder.

Both masses are one flat ink, so where they touch they fuse into an unreadable blob: the gap
between the mallet and the box is part of the drawing, not slack left over.

Three poses, like BUILD, so the button keeps its swing: raised, halfway, struck. The box never
moves; only the mallet does, which is what makes the blow read as a blow rather than as the
whole picture sliding.

Run: python3 tools/ui/build-smash-icon.py
"""
import os
from PIL import Image, ImageChops, ImageFilter

from importlib.machinery import SourceFileLoader

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '../../assets/ui'))
maillet = SourceFileLoader('maillet', os.path.join(HERE, 'build-mallet-icon.py')).load_module()

N = 256
SS = 4
WHITE = (255, 255, 255, 255)
NAVY = (16, 26, 43, 255)

# Shares of the canvas. Both objects are drawn BIG and made to overlap; what separates them is
# a void cut out of the box, not space left between them.
#
# The first version put them side by side, which cannot work here: two objects sharing the box
# of one come out at half the size, and next to BUILD, CRATE or STEAL at the real thumb size of
# 35 px the glyph read as a smudge (owner, 7 Sep, and visible in a strip rendered at that size).
# The family's own answer is written in the crate glyph itself, in build-hud-icon.js: "ce sont
# les VIDES qui dessinent". So the mallet crosses the box, and the box is HOLLOWED OUT around
# the mallet's silhouette. Both keep their full size, the pair stays compact, and one flat ink
# still reads as two objects.
BOX_PART = 0.70          # the box's file, as a share of the canvas
MALLET_PART = 0.60       # the mallet's file, same
BOX_TL = (0.36, 0.48)    # where the box's ink starts, in canvas shares
# Where the head lands, as a share of the box's ink, measured from its top left corner.
FRAPPE = (0.30, 0.26)
# The void carved around the mallet, in canvas shares. Two masses of one ink that touch fuse
# into a blob; this is the same separation the crate draws between its own planks.
VIDE = 0.045
# A quarter turn clockwise, and it is what makes the tool STRIKE rather than stand there.
#
# The mallet is drawn head up-right, grip down-left, which is the right pose for BUILD where it
# is alone. Laid beside a box in that pose it points AWAY from it: a tool floating in a corner
# (owner, 7 Sep). Turned a quarter clockwise the head comes down-right, onto the box's top left
# shoulder, and the handle runs up-left out of the way. That is how the whole genre draws a
# blow, and it costs one rotation rather than a second mallet drawing.
MALLET_TURN = -90
# A SHORT mallet, and the reason is stroke weight, not composition.
#
# Two objects share this canvas, so the tool is drawn shorter than when it stands alone.
# Shrinking the whole mallet would take its handle down with it, and the family's rule is that
# every glyph carries the same weight as its neighbours: a thin handle was already reported once
# on BUILD itself ("manche tres fin", 5 Sep). The handle is therefore CUT rather than scaled, so
# the tool keeps the set's bar thickness and simply becomes a stubbier mallet.
MANCHE_COURT = 87


def boite(cote, colour):
    """Our own crate glyph, at `cote` pixels, repainted in the family's ink.

    Only the alpha channel is kept: the shape is the asset's, the colour is the caller's, so
    the white family and the navy family are the same drawing and cannot diverge.
    """
    src = Image.open(os.path.join(OUT, 'encre-crate.png')).convert('RGBA')
    src = src.resize((cote, cote), Image.LANCZOS)
    plein = Image.new('RGBA', src.size, colour)
    plein.putalpha(src.split()[3])
    return plein


def maillet_court(cote, colour):
    """The mallet with a cut handle, from its own tool, at full family stroke weight."""
    handle, pivot = maillet.HANDLE, maillet.PIVOT
    maillet.HANDLE = (handle[0], handle[1], handle[2], MANCHE_COURT)
    maillet.PIVOT = (pivot[0], MANCHE_COURT - 2)
    try:
        return maillet.framed(cote, colour)
    finally:
        maillet.HANDLE, maillet.PIVOT = handle, pivot


def encre(im):
    """The ink's bounding box, ignoring the near-transparent fringe of a resize."""
    return im.split()[3].point(lambda v: 255 if v > 8 else 0).getbbox()


def creuser(fond, dessus, at, marge):
    """Take `dessus` and a margin around it out of `fond`'s alpha, at `at`."""
    masque = Image.new('L', fond.size, 0)
    masque.paste(dessus.split()[3], at)
    if marge > 0:
        n = int(marge) * 2 + 1
        masque = masque.filter(ImageFilter.MaxFilter(min(n, 199)))
    a = fond.split()[3]
    a = ImageChops.subtract(a, masque)
    fond.putalpha(a)
    return fond


def dessine(size, pose, colour):
    big = size * SS
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0))

    bx = boite(int(BOX_PART * big), colour)
    ml = maillet_court(int(MALLET_PART * big), colour)[pose].rotate(MALLET_TURN, resample=Image.BICUBIC)
    bb, mb = encre(bx), encre(ml)

    # The box first: its ink's top left corner lands on the chosen point.
    bx_at = (round(BOX_TL[0] * big) - bb[0], round(BOX_TL[1] * big) - bb[1])
    # Then the mallet, so its head (the bottom right of the ink, once turned) lands on the point
    # of the box it strikes, given as a share of the box's own ink.
    vise = (round(BOX_TL[0] * big) + round(FRAPPE[0] * (bb[2] - bb[0])),
            round(BOX_TL[1] * big) + round(FRAPPE[1] * (bb[3] - bb[1])))
    ml_at = (vise[0] - mb[2], vise[1] - mb[3])

    # Nothing may leave the canvas: a bar amputated by the frame reads as a mistake at 35 px,
    # and `normalise-glyphs.py` would then scale the damage rather than the drawing. The test is
    # on the INTENDED rectangles, never on the composite: `alpha_composite` drops what falls
    # outside without a word, so a check made afterwards always finds a glyph that fits.
    for at, bb2, quoi in ((bx_at, bb, 'boite'), (ml_at, mb, 'maillet')):
        x0, y0 = at[0] + bb2[0], at[1] + bb2[1]
        x1, y1 = at[0] + bb2[2], at[1] + bb2[3]
        assert 0 <= x0 and 0 <= y0 and x1 <= big and y1 <= big, \
            f'{quoi} hors cadre: {(x0, y0, x1, y1)} dans {big}'

    fond = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    fond.alpha_composite(bx, bx_at)
    fond = creuser(fond, ml, ml_at, round(VIDE * big))
    im.alpha_composite(fond)
    im.alpha_composite(ml, ml_at)
    return im.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    for family, colour in (('icon', WHITE), ('encre', NAVY)):
        for pose in ('struck', 'mid', 'raised'):
            im = dessine(N, pose, colour)
            name = f'{family}-smash.png' if pose == 'struck' else f'{family}-smash-{pose}.png'
            im.save(os.path.join(OUT, name), optimize=True)
            print(f'wrote {name}')
