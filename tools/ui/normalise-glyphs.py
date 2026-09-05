#!/usr/bin/env python3
"""
Every button glyph leaves this pass at the same optical size, whatever it draws.

The thumb buttons draw their icon in a box that is a fixed fraction of the disc, so the size
a player actually sees is that fraction TIMES however much of its own file each glyph happens
to fill. Measured on the shipped set, that second number ran from 60% (the padlock) to 92%
(the muzzle flash): the same button showed one verb half again as big as another, and the
padlock, the smallest of them, read as thin and far too small on a phone (owner, 5 Sep).

The reference is the platform's own HUD, measured on the client screenshot this repo keeps
(`native-hud-grid.png`, 2412x1080): Decentraland's jump disc is 359 px there and its chevron
spans 215, so the glyph is 59.9% of the diameter; its satellites run 43% (a letter) to 49%
(the hand). Material's icon grid says the same thing in its own units, a 24 dp icon drawn
inside a 20 dp live area, with the square keyline set 10% below the circle one so a solid
shape does not out-weigh an open one.

So: the ink's long axis is scaled to a constant share of the canvas, and a silhouette that
fills its own bounding box is taken down by that same tenth. With the 0.62 box the buttons
use, an open glyph lands at 59.5% of the disc and a solid one at 54.6%, which is the native
pad's own proportion.

Frames of one animation are normalised AS A GROUP, and the group has two references, not one.
The SCALE comes from the union of every pose, so no pose is clipped; the CENTRING comes from
the FIRST file alone, the pose at rest. Centring on the union instead put the menu's three
bars off the middle of their button, because the alert version carries a pip up in the corner
and the union stretched to include it (owner, 5 Sep). The rule is general: a badge, a spark or
a raised hammer moves around the glyph, and it is the glyph that must sit in the middle.

Idempotent: a file already at the target size and already centred is left untouched, so running
it twice costs nothing and never resamples an image twice.

    python3 tools/ui/normalise-glyphs.py [--check]
"""
import os
import sys
from PIL import Image

UI = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'ui')

# The ink's long axis, as a share of the canvas.
EXTENT = 0.96
# A silhouette that fills its own box is drawn smaller, Material's square keyline logic.
DENSE_EXTENT = 0.88
# Above this share of its bounding box covered, a glyph counts as solid rather than open.
DENSE_COVER = 0.62
# Below this much correction, the file is already right and is not touched.
TOLERANCE = 0.02
# And below this much offset, in pixels, the glyph already sits in the middle.
DRIFT = 1.5

VERBS = [
    'build', 'crate', 'place', 'give', 'drop', 'recover', 'collect', 'fire',
    'pickup', 'steal', 'up', 'fuse', 'outbid', 'buy', 'lock', 'cloak'
]

# One entry is one group scaled together. Single files are their own group.
GROUPS = []
# A verb with poses: the rest pose first, because the group is centred on it.
POSED = {'build': ['-raised', '-mid'], 'collect': ['-raised', '-mid']}
for verb in VERBS:
    if verb in POSED:
        for family in ('icon', 'encre'):
            GROUPS.append([f'{family}-{verb}'] + [f'{family}-{verb}{p}' for p in POSED[verb]])
    else:
        GROUPS.append([f'icon-{verb}'])
        GROUPS.append([f'encre-{verb}'])
# The menu bars stand alone. The alert version carries a pip outside them, and only the
# client's own button could ever show it: the scene draws its own menu disc and puts the pip
# on the rim itself, so grouping the two would shrink and shift the bars for a picture that
# is never displayed.
GROUPS.append(['icon-menu'])
GROUPS.append(['icon-menu-alert'])
# The weapon button swaps between these two when the player aims: a state, not two objects.
GROUPS.append(['icon-gun', 'icon-holster'])
GROUPS.append(['icon-slap'])
GROUPS.append(['icon-taser'])
GROUPS.append(['icon-jump'])
GROUPS.append(['icon-glide'])


def solid(im):
    """The alpha channel as a black and white mask: ink, or nothing."""
    return im.split()[3].point(lambda v: 255 if v > 8 else 0)


def ink_bbox(images):
    """The union of every frame's ink, so a group keeps one common frame of reference."""
    box = None
    for im in images:
        bb = solid(im).getbbox()
        if bb is None:
            continue
        box = bb if box is None else (min(box[0], bb[0]), min(box[1], bb[1]),
                                      max(box[2], bb[2]), max(box[3], bb[3]))
    return box


def coverage(images, box):
    """How much of the bounding box the ink fills, averaged over the frames."""
    area = max(1, (box[2] - box[0]) * (box[3] - box[1]))
    return sum(solid(im).crop(box).histogram()[255] / area for im in images) / max(1, len(images))


def rescale(im, box, k, anchor):
    """
    Resize the group's common window and place it on `anchor`, the point that must end centred.

    Resampling colour and alpha apart mixes in whatever colour the transparent pixels hold and
    leaves a fringe around the glyph, so the two are multiplied together before the resize and
    divided out after: the standard premultiplied path, written out because it is four lines.
    """
    n = im.size[0]
    crop = im.crop(box)
    w, h = crop.size
    src = crop.load()
    pre = Image.new('RGBA', (w, h))
    pp = pre.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = src[x, y]
            pp[x, y] = (r * a // 255, g * a // 255, b * a // 255, a)
    tw, th = max(1, round(w * k)), max(1, round(h * k))
    small = pre.resize((tw, th), Image.LANCZOS)
    sp = small.load()
    for y in range(th):
        for x in range(tw):
            r, g, b, a = sp[x, y]
            if a == 0:
                sp[x, y] = (0, 0, 0, 0)
            else:
                sp[x, y] = (min(255, r * 255 // a), min(255, g * 255 // a), min(255, b * 255 // a), a)
    # Where the anchor lands inside the resized window, and the offset that centres it. The
    # clamp keeps the whole window on the canvas: a pip that would fall off the edge is worth
    # less than the glyph it decorates being straight.
    ax = (anchor[0] - box[0]) * k
    ay = (anchor[1] - box[1]) * k
    ox = min(max(round(n / 2 - ax), n - tw), 0) if tw > n else min(max(round(n / 2 - ax), 0), n - tw)
    oy = min(max(round(n / 2 - ay), n - th), 0) if th > n else min(max(round(n / 2 - ay), 0), n - th)
    out = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    out.alpha_composite(small, (ox, oy))
    return out


def main():
    check = '--check' in sys.argv
    print(f"{'group':34} {'was':>7} {'cover':>7} {'target':>7} {'scale':>6} {'drift':>6}")
    for group in GROUPS:
        paths = [os.path.join(UI, f'{name}.png') for name in group]
        if not all(os.path.exists(p) for p in paths):
            continue
        images = [Image.open(p).convert('RGBA') for p in paths]
        n = images[0].size[0]
        box = ink_bbox(images)
        rest = ink_bbox(images[:1])
        if box is None or rest is None:
            continue
        anchor = ((rest[0] + rest[2]) / 2, (rest[1] + rest[3]) / 2)
        # The span is measured AROUND THE ANCHOR, not corner to corner: the box that must fit
        # is the one centred on the pose at rest, so the scale and the centring never fight and
        # nothing has to be clamped back towards an edge.
        reach = max(abs(box[0] - anchor[0]), abs(box[2] - anchor[0]),
                    abs(box[1] - anchor[1]), abs(box[3] - anchor[1]))
        span = 2 * reach
        cover = coverage(images, box)
        target = (DENSE_EXTENT if cover > DENSE_COVER else EXTENT) * n
        k = target / span
        # How far the pose at rest sits from the middle today, in pixels.
        drift = max(abs(anchor[0] - n / 2), abs(anchor[1] - n / 2))
        label = group[0] + (f' (+{len(group) - 1})' if len(group) > 1 else '')
        print(f'{label:34} {span / n * 100:6.1f}% {cover * 100:6.1f}% {target / n * 100:6.1f}% {k:6.3f} {drift:6.1f}')
        if check or (abs(k - 1) < TOLERANCE and drift <= DRIFT):
            continue
        for im, path in zip(images, paths):
            rescale(im, box, k, anchor).save(path, optimize=True)


if __name__ == '__main__':
    main()
