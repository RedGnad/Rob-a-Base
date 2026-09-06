#!/usr/bin/env python3
"""Draws the seven toy icons the reel shows, the burst behind a win, and the strip fades.

One icon per rarity, the same pieces as the models on the shelves, in chess point order:
pawn, knight, bishop, rook, queen, king, and the star that stands for Secret. A player who
has seen the card recognises the piece on the shelf. The glyphs come from the system's
Apple Symbols face, filled in the rarity colour over a dark stroke, with the soft halo that
grows with rarity. The burst is a fan of warm rays the interface scales up behind the
winning card, baked white-gold because runtime tinting never arrives on handsets.

Requires Python with Pillow and the macOS Apple Symbols font. Outputs are committed, so
building the scene needs neither.

    python3 tools/ui/build-toy-icons.py
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '../../assets/ui'))
N = 256

# src/shared/loot-table.ts, RARITIES: colour and glow, in order.
RARITIES = [
    ('#78818e', 0.00), ('#4ec04e', 0.35), ('#3d8ef0', 0.80), ('#a855f7', 1.30),
    ('#f5a524', 2.00), ('#ff4d6d', 2.80), ('#ffffff', 4.00),
]


def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


GLYPHES = '\u265f\u265e\u265d\u265c\u265b\u265a\u2605'
POLICE = '/System/Library/Fonts/Apple Symbols.ttf'


def icone_glyphe(k, hexcol, glow):
    c = rgb(hexcol)
    dark = mix(c, (0, 0, 0), 0.55)
    light = mix(c, (255, 255, 255), 0.35)
    ft = ImageFont.truetype(POLICE, 196)
    body = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(body)
    ch = GLYPHES[k]
    # Centre on the ink itself, not the em box, so every piece sits on the same optical line.
    x0, y0, x1, y1 = d.textbbox((0, 0), ch, font=ft, stroke_width=6)
    d.text((128 - (x0 + x1) / 2, 134 - (y0 + y1) / 2), ch, font=ft,
           fill=c + (255,), stroke_width=6, stroke_fill=dark + (255,))
    # One highlight, the vinyl register: a small light pool upper left inside the ink.
    masque = body.split()[3].point(lambda a: 255 if a > 200 else 0)
    pool = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    dp = ImageDraw.Draw(pool)
    dp.ellipse((86, 60, 122, 92), fill=light + (150,))
    body = Image.alpha_composite(body, Image.composite(pool, Image.new('RGBA', (N, N), (0, 0, 0, 0)), masque))
    halo = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    if glow > 0:
        mask = body.split()[3].filter(ImageFilter.GaussianBlur(radius=14 + glow * 5))
        strength = min(1.0, 0.25 + glow * 0.2)
        halo = Image.new('RGBA', (N, N), c + (0,))
        halo.putalpha(mask.point(lambda a: int(a * strength)))
    return Image.alpha_composite(halo, body)


def burst():
    """A fan of sixteen warm rays for the moment the reel lands, alpha dying outward."""
    S = 256
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = cy = S / 2
    for k in range(16):
        a = k * math.pi / 8 + 0.13
        long = 118 if k % 2 == 0 else 86
        demi = 0.075 if k % 2 == 0 else 0.05
        pts = [(cx + math.cos(a - demi) * 26, cy + math.sin(a - demi) * 26),
               (cx + math.cos(a + demi) * 26, cy + math.sin(a + demi) * 26),
               (cx + math.cos(a) * long, cy + math.sin(a) * long)]
        d.polygon(pts, fill=(255, 224, 130, 210))
    im = im.filter(ImageFilter.GaussianBlur(1.4))
    # Radial falloff so the fan melts into the panel instead of ending on a line.
    px = im.load()
    for y in range(S):
        for x in range(S):
            r0, g0, b0, a0 = px[x, y]
            if a0 == 0: continue
            dist = math.hypot(x - cx, y - cy) / (S / 2)
            px[x, y] = (r0, g0, b0, int(a0 * max(0.0, 1 - dist ** 1.6)))
    return im


def shapes(k, c):
    """Polygons and ellipses of one silhouette, centred, as (kind, points, colour)."""
    dark = mix(c, (0, 0, 0), 0.45)
    light = mix(c, (255, 255, 255), 0.35)
    cx, cy = 128, 134
    if k == 0:
        return [('e', (cx - 62, cy - 62, cx + 62, cy + 62), c), ('e', (cx - 40, cy - 46, cx - 6, cy - 18), light)]
    if k == 1:
        return [('p', [(cx - 66, cy + 66), (cx + 66, cy + 66), (cx + 66, cy), (cx - 66, cy)], c),
                ('p', [(cx - 66, cy), (cx + 66, cy), (cx + 40, cy - 22), (cx - 92, cy - 22)], light),
                ('p', [(cx - 20, cy), (cx + 46, cy), (cx + 46, cy - 66), (cx - 20, cy - 66)], c),
                ('p', [(cx - 20, cy - 66), (cx + 46, cy - 66), (cx + 30, cy - 82), (cx - 36, cy - 82)], light)]
    if k == 2:
        return [('e', (cx - 76, cy + 38, cx + 76, cy + 74), dark), ('e', (cx - 76, cy + 30, cx + 76, cy + 66), c),
                ('p', [(cx - 56, cy + 44), (cx + 56, cy + 44), (cx, cy - 78)], c),
                ('p', [(cx - 56, cy + 44), (cx - 14, cy + 44), (cx, cy - 78)], light)]
    if k == 3:
        return [('p', [(cx - 58, cy + 74), (cx - 34, cy + 40), (cx - 34, cy + 74)], dark),
                ('p', [(cx + 58, cy + 74), (cx + 34, cy + 40), (cx + 34, cy + 74)], dark),
                ('p', [(cx - 34, cy + 66), (cx + 34, cy + 66), (cx + 34, cy - 40), (cx - 34, cy - 40)], c),
                ('p', [(cx - 34, cy + 66), (cx - 12, cy + 66), (cx - 12, cy - 40), (cx - 34, cy - 40)], light),
                ('p', [(cx - 34, cy - 40), (cx + 34, cy - 40), (cx, cy - 86)], c),
                ('e', (cx - 12, cy - 2, cx + 12, cy + 22), dark)]
    if k == 4:
        return [('p', [(cx - 16, cy + 78), (cx + 16, cy + 78), (cx + 16, cy + 30), (cx - 16, cy + 30)], dark),
                ('p', [(cx - 76, cy + 34), (cx + 76, cy + 34), (cx, cy - 82)], c),
                ('p', [(cx - 76, cy + 34), (cx - 20, cy + 34), (cx, cy - 82)], light)]
    if k == 5:
        return [('p', [(cx - 60, cy + 76), (cx + 60, cy + 76), (cx, cy + 6)], c),
                ('p', [(cx - 60, cy + 76), (cx - 16, cy + 76), (cx, cy + 6)], light),
                ('p', [(cx - 48, cy + 10), (cx + 48, cy + 10), (cx, cy - 78)], c),
                ('p', [(cx - 48, cy + 10), (cx - 12, cy + 10), (cx, cy - 78)], light)]
    return [('e', (cx - 86, cy - 6, cx + 86, cy + 30), dark), ('e', (cx - 86, cy - 14, cx + 86, cy + 22), c),
            ('e', (cx - 46, cy - 50, cx + 46, cy + 42), c), ('e', (cx - 30, cy - 38, cx - 4, cy - 14), light)]


def icon(k, hexcol, glow):
    c = rgb(hexcol)
    dark = mix(c, (0, 0, 0), 0.55)
    body = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(body)
    for kind, pts, col in shapes(k, c):
        if kind == 'e':
            d.ellipse(pts, fill=col + (255,), outline=dark + (255,), width=4)
        else:
            d.polygon(pts, fill=col + (255,), outline=dark + (255,))
            d.line(pts + [pts[0]], fill=dark + (255,), width=4, joint='curve')
    halo = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    if glow > 0:
        mask = body.split()[3].filter(ImageFilter.GaussianBlur(radius=14 + glow * 5))
        strength = min(1.0, 0.25 + glow * 0.2)
        halo = Image.new('RGBA', (N, N), c + (0,))
        halo.putalpha(mask.point(lambda a: int(a * strength)))
    return Image.alpha_composite(halo, body)


def enseigne():
    """The facade sign plate, 4:1, in the HUD panel's navy.

    The first sign stretched the square 128 px panel texture six times wider than tall,
    which turned its corner radius into a great dark pill hanging on the building. A sign
    is its own drawing at its own aspect: small corners, the dark outline every control
    shares, the two-stop body, a gloss band, all baked, fully opaque so the renderer can
    alpha-test it and never fight the glazing over draw order.
    """
    W, H, R, OW = 768, 192, 30, 7
    out, top, mid, bot = rgb('#0a1428'), rgb('#26406e'), rgb('#1b3054'), rgb('#152743')
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, W - 1, H - 1), radius=R, fill=out + (255,))
    for y in range(OW, H - OW):
        t = (y - OW) / (H - 2 * OW)
        col = mix(top, mid, min(1.0, t / 0.42)) if t < 0.42 else mix(mid, bot, (t - 0.42) / 0.58)
        d.line([(OW, y), (W - OW - 1, y)], fill=col + (255,))
    corps = Image.new('L', (W, H), 0)
    ImageDraw.Draw(corps).rounded_rectangle((OW, OW, W - OW - 1, H - OW - 1), radius=R - OW // 2, fill=255)
    fond = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d2 = ImageDraw.Draw(fond)
    d2.rounded_rectangle((0, 0, W - 1, H - 1), radius=R, fill=out + (255,))
    im = Image.composite(im, fond, corps)
    gloss = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(gloss).rounded_rectangle((OW + 4, OW + 4, W - OW - 5, int(H * 0.30)), radius=R - OW, fill=(255, 255, 255, 26))
    return Image.alpha_composite(im, Image.composite(gloss, Image.new('RGBA', (W, H), (0, 0, 0, 0)), corps))


def ui_icone(nom, hexcol):
    """One interface icon: flat fill, heavy dark outline, one highlight.

    A second family, and it has to be. The white-on-transparent glyphs in build-hud-icon.js
    are drawn for the CLIENT's own dark touch button; reused on our navy cards they came out
    as a white smudge (owner, 1 Sep: "l'icone de box est vraiment mauvais"). These are drawn
    for our plates: a saturated body, a near-black outline that survives a phone's downscale,
    one light pool. Same register as the toy icons, so the whole interface looks like one set.
    """
    c = rgb(hexcol)
    dark = mix(c, (0, 0, 0), 0.62)
    light = mix(c, (255, 255, 255), 0.42)
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    W = 12                      # outline, in pixels of a 256 canvas
    cx, cy = 128, 128

    def poly(pts, col=None):
        d.polygon(pts, fill=(col or c) + (255,), outline=dark + (255,))
        d.line(pts + [pts[0]], fill=dark + (255,), width=W, joint='curve')

    def ell(box, col=None):
        d.ellipse(box, fill=(col or c) + (255,), outline=dark + (255,), width=W)

    def trait(a, b, col=None, w=W):
        d.line([a, b], fill=(col or dark) + (255,), width=w)

    if nom == 'crate':
        # A lid, a body, and the strap cross that stops a square being a square.
        poly([(38, 96), (218, 96), (218, 218), (38, 218)])
        poly([(28, 52), (228, 52), (228, 100), (28, 100)], light)
        trait((128, 100), (128, 218))
        trait((38, 158), (218, 158))
    elif nom == 'floor':
        # Three slabs, the new one lit on top.
        poly([(30, 178), (128, 214), (226, 178), (128, 142)], mix(c, (0, 0, 0), 0.25))
        poly([(30, 130), (128, 166), (226, 130), (128, 94)], c)
        poly([(30, 82), (128, 118), (226, 82), (128, 46)], light)
    elif nom == 'silo':
        # A grain silo: domed cap, body, one hoop. It is the genre's own word for the thing
        # that stores what the farm makes while nobody is watching (Egg Inc), and the
        # silhouette survives the 40 px the shop row gives it.
        d.pieslice((52, 22, 204, 174), 180, 360, fill=light + (255,), outline=dark + (255,), width=W)
        d.rounded_rectangle((56, 92, 200, 228), radius=12, fill=c + (255,), outline=dark + (255,), width=W)
        trait((62, 150), (194, 150))
        ell((112, 176, 144, 208), dark)
    elif nom == 'shield':
        poly([(128, 30), (216, 68), (216, 140), (128, 226), (40, 140), (40, 68)])
        poly([(128, 30), (216, 68), (216, 140), (128, 226)], mix(c, (0, 0, 0), 0.22))
    elif nom == 'lock':
        # A padlock: the shackle as a thick ring whose lower half the body covers, a body,
        # a keyhole. The shield was the SHOP's defence glyph (the sentries); the base's own
        # lock post wore the same one and read as a sentry (owner, 4 Sep). One sign, one thing.
        d.ellipse((70, 30, 186, 146), outline=dark + (255,), width=40)
        d.ellipse((70, 30, 186, 146), outline=light + (255,), width=16)
        d.rounded_rectangle((44, 104, 212, 226), radius=24, fill=c + (255,), outline=dark + (255,), width=W)
        ell((110, 136, 146, 172), dark)
        d.rounded_rectangle((118, 160, 138, 202), radius=8, fill=dark + (255,))
    elif nom == 'prestige':
        pts = []
        for k in range(10):
            a = math.pi / 2 + k * math.pi / 5
            r = 104 if k % 2 == 0 else 44
            pts.append((cx + math.cos(a) * r, cy - math.sin(a) * r))
        # No pool of light in the centre: on the panel and in the shop it read as a hole
        # punched through the star (owner, 4 Sep). A star is one shape.
        poly(pts)
    elif nom == 'luck':
        for dx, dy in ((0, -46), (46, 0), (0, 46), (-46, 0)):
            ell((cx + dx - 48, cy + dy - 48, cx + dx + 48, cy + dy + 48))
        ell((cx - 22, cy - 22, cx + 22, cy + 22), light)
    elif nom == 'gear-0':          # TRAP: two jaws about to shut
        # Drawn as one zigzag per jaw rather than six outlined triangles: at this size the
        # outlines merged into a blob. Thin strokes, wide teeth, a clear gap between them.
        d.ellipse((30, 62, 226, 194), outline=dark + (255,), width=W)
        haut = [(44, 84)] + [pt for k in range(4) for pt in ((58 + k * 40, 128), (78 + k * 40, 84))]
        d.polygon(haut + [(212, 62), (44, 62)], fill=c + (255,), outline=dark + (255,))
        d.line(haut, fill=dark + (255,), width=W // 2, joint='curve')
        bas = [(44, 172)] + [pt for k in range(4) for pt in ((58 + k * 40, 128), (78 + k * 40, 172))]
        d.polygon(bas + [(212, 194), (44, 194)], fill=light + (255,), outline=dark + (255,))
        d.line(bas, fill=dark + (255,), width=W // 2, joint='curve')
    elif nom == 'gear-1':          # SPEED COIL: two chevrons
        poly([(52, 44), (128, 128), (52, 212), (86, 212), (162, 128), (86, 44)])
        poly([(126, 44), (202, 128), (126, 212), (160, 212), (236, 128), (160, 44)], light)
    elif nom == 'gear-2':          # SLAP: an open hand
        # Fingers as wide rounded bars over a palm, thumb out to the side. The first pass
        # made them thin and dark and the whole thing read as a cake with candles.
        for k in range(4):
            x = 84 + k * 30
            d.rounded_rectangle((x, 52 + abs(k - 1) * 12, x + 24, 150), radius=12,
                                fill=light + (255,), outline=dark + (255,), width=W - 2)
        d.rounded_rectangle((44, 116, 96, 168), radius=22, fill=light + (255,), outline=dark + (255,), width=W - 2)
        d.rounded_rectangle((72, 122, 210, 216), radius=26, fill=c + (255,), outline=dark + (255,), width=W)
    elif nom == 'gear-3':          # CLOAK: a ghost
        poly([(52, 210), (52, 118), (128, 40), (204, 118), (204, 210),
              (178, 184), (152, 210), (128, 184), (104, 210), (78, 184)])
        ell((94, 106, 118, 136), light); ell((140, 106, 164, 136), light)
    elif nom == 'gear-4':          # BOOGIE BOMB: a bomb with a fuse
        ell((44, 82, 196, 234))
        poly([(148, 70), (188, 70), (188, 96), (148, 96)], mix(c, (0, 0, 0), 0.3))
        trait((188, 82), (222, 40), light, 16)
    elif nom == 'gear-5':          # TASER: a bolt
        poly([(140, 26), (72, 140), (118, 140), (96, 230), (188, 106), (138, 106)])
    elif nom == 'gear-6':          # X-RAY GLASSES
        ell((26, 92, 118, 176)); ell((138, 92, 230, 176))
        d.rectangle((112, 118, 144, 142), fill=c + (255,), outline=dark + (255,), width=W)
    else:                          # SUBSPACE MINE: a spiked ball
        for k in range(8):
            a = k * math.pi / 4
            poly([(cx + math.cos(a) * 118, cy + math.sin(a) * 118),
                  (cx + math.cos(a + 0.42) * 52, cy + math.sin(a + 0.42) * 52),
                  (cx + math.cos(a - 0.42) * 52, cy + math.sin(a - 0.42) * 52)])
        ell((cx - 56, cy - 56, cx + 56, cy + 56), light)
    return im



def act_icone(nom, hexcol):
    """Le verbe du bouton contextuel, dessine pour la plaque OR.

    Mesure du 2 Sep, sur la plaque reelle (#ffc63f au centre): un glyphe blanc y tient a
    1,57 contre 1, et le creme a 1,30. Le plancher que ce depot s'impose a lui-meme dans
    `theme.ts` est 3, celui de WCAG pour un graphique. Le contour presque noir de cette
    famille, lui, mesure 11,12. Autrement dit le bouton le plus presse du jeu portait des
    dessins que la lumiere d'un telephone efface, et ce n'est pas une question de gout.

    Meme grammaire que `ui_icone`: un corps sature, un contour epais qui survit a la
    reduction, une seule zone claire. Deux differences: ces dessins montrent un ACTE et non
    un objet (une fleche, une main, un outil), et chacun a une silhouette distincte de ses
    voisins, parce qu'ils s'echangent sur le meme bouton et qu'un joueur ne les compare
    jamais cote a cote.
    """
    c = rgb(hexcol)
    dark = mix(c, (0, 0, 0), 0.62)
    light = mix(c, (255, 255, 255), 0.42)
    acier = rgb('#aebbd0')
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    W = 12
    cx, cy = 128, 128

    def poly(pts, col=None, contour=True):
        d.polygon(pts, fill=(col or c) + (255,))
        if contour:
            d.line(list(pts) + [pts[0]], fill=dark + (255,), width=W, joint='curve')

    def ell(box, col=None):
        d.ellipse(box, fill=(col or c) + (255,), outline=dark + (255,), width=W)

    def dalle(y, col=None, demi=92, ep=32):
        poly([(cx - demi, y), (cx, y + ep), (cx + demi, y), (cx, y - ep)], col)

    def fleche_bas(x, haut, bas, larg=30, tete=42):
        poly([(x - larg, haut), (x + larg, haut), (x + larg, bas - tete),
              (x + tete, bas - tete), (x, bas), (x - tete, bas - tete), (x - larg, bas - tete)])

    def fleche_haut(x, bas, haut, larg=30, tete=42):
        poly([(x - larg, bas), (x + larg, bas), (x + larg, haut + tete),
              (x + tete, haut + tete), (x, haut), (x - tete, haut + tete), (x - larg, haut + tete)])

    def cube(x0, y0, x1, y1, col=None):
        d.rectangle((x0, y0, x1, y1), fill=(col or light) + (255,), outline=dark + (255,), width=W)

    if nom == 'build':
        # Un maillet: le manche en bois, la tete en acier. L'ancien dessin montrait le
        # BATIMENT, c'est-a-dire le resultat; un bouton d'action doit montrer le geste, et
        # le marteau est la convention du genre pour "construire".
        poly([(64, 206), (92, 228), (176, 112), (148, 90)])
        poly([(214, 84), (186, 130), (94, 74), (122, 28)], acier)
    elif nom == 'place':
        # Poser: la piece descend sur une tablette qui l'attend.
        cube(88, 14, 168, 94)
        fleche_bas(128, 106, 168, 24, 38)
        dalle(200, mix(c, (0, 0, 0), 0.25))
    elif nom == 'give':
        # Donner: la piece part de cote, vers l'etagere d'un autre.
        cube(30, 92, 96, 158)
        poly([(112, 104), (168, 104), (168, 82), (216, 126), (168, 170), (168, 148), (112, 148)])
        d.rectangle((226, 56, 246, 200), fill=mix(c, (0, 0, 0), 0.25) + (255,), outline=dark + (255,), width=W)
    elif nom == 'drop':
        # Lacher: la piece bascule et tombe par terre. POSER est aussi une descente, alors
        # deux fleches vers le bas ne se seraient pas distinguees: les deux verbes s'offrent
        # dans le meme contexte, une piece en main. Ici c'est un cube DE TRAVERS au-dessus de
        # son ombre au sol, sans tablette: rien pour l'accueillir, ce qui est exactement la
        # difference entre les deux verbes.
        d.ellipse((60, 196, 196, 238), fill=mix(c, (0, 0, 0), 0.32) + (255,), outline=dark + (255,), width=W - 4)
        poly([(128, 26), (216, 108), (128, 190), (40, 108)])
        poly([(128, 66), (176, 108), (128, 150), (80, 108)], light)
    elif nom == 'recover':
        ell((36, 36, 220, 220))
        d.ellipse((78, 78, 178, 178), fill=(0, 0, 0, 0))
        d.ellipse((78, 78, 178, 178), outline=dark + (255,), width=W)
        d.rectangle((110, 20, 190, 68), fill=(0, 0, 0, 0))
        poly([(104, 12), (104, 84), (176, 48)], light)
    elif nom == 'collect':
        for k, y in enumerate((166, 122, 78)):
            ell((48, y, 208, y + 62), light if k == 2 else None)
    elif nom == 'fire':
        ell((40, 40, 216, 216))
        d.ellipse((84, 84, 172, 172), fill=(0, 0, 0, 0))
        d.ellipse((84, 84, 172, 172), outline=dark + (255,), width=W)
        ell((110, 110, 146, 146), light)
        for x0, y0, x1, y1 in ((118, 8, 138, 62), (118, 194, 138, 248), (8, 118, 62, 138), (194, 118, 248, 138)):
            d.rectangle((x0, y0, x1, y1), fill=c + (255,), outline=dark + (255,), width=6)
    elif nom == 'pickup':
        # Ramasser: la piece se souleve de sa tablette.
        dalle(214, mix(c, (0, 0, 0), 0.25))
        cube(88, 92, 168, 172)
        fleche_haut(128, 82, 14, 24, 38)
    elif nom == 'steal':
        # Voler: deux pointes se referment sur la piece de quelqu'un d'autre. La main, que
        # j'ai essayee deux fois, ne tient pas a la taille du pouce dans une famille faite de
        # solides geometriques: elle se lit comme un bocal. Cette prise-la n'a de voisin nulle
        # part ailleurs dans le jeu, ce qui est la seule chose qu'on demande a une silhouette.
        cube(86, 86, 170, 170, light)
        poly([(14, 62), (74, 128), (14, 194), (14, 62)])
        poly([(242, 62), (182, 128), (242, 194), (242, 62)])
    elif nom == 'up':
        # Monter: entre deux planchers.
        dalle(226, mix(c, (0, 0, 0), 0.25), 96, 26)
        dalle(66, light, 96, 26)
        fleche_haut(128, 196, 96, 26, 40)
    elif nom == 'fuse':
        # Fusionner: trois deviennent un. L'etincelle au centre est le resultat.
        for a in (0.5, 2.594, 4.688):
            x = cx + math.cos(a) * 64
            y = cy + math.sin(a) * 64
            ell((x - 48, y - 48, x + 48, y + 48))
        pts = []
        for k in range(8):
            ang = k * math.pi / 4
            r = 48 if k % 2 == 0 else 19
            pts.append((cx + math.cos(ang) * r, cy + math.sin(ang) * r))
        poly(pts, light)
    elif nom == 'feed':
        # Nourrir: la piece entre dans la tremie. Distinguer NOURRIR de FUSER par un detail
        # ajoute au meme dessin n'aurait pas tenu a la taille du pouce; c'est donc une autre
        # silhouette, et c'est le geste qu'elle montre, pas la machine.
        cube(94, 12, 162, 80, light)
        poly([(28, 108), (228, 108), (162, 186), (162, 240), (94, 240), (94, 186)])
    elif nom == 'outbid':
        # Surencherir: on met PLUS. La fleche monte, sinon le dessin dit le contraire du mot.
        ell((72, 150, 232, 212))
        ell((72, 112, 232, 174), light)
        poly([(46, 240), (46, 130), (14, 130), (62, 44), (110, 130), (78, 130), (78, 240)])
    elif nom == 'buy':
        # Acheter: la caisse ET la piece qu'on donne pour l'avoir. Le bouton portait le
        # meme glyphe que SMASH et OPEN, et a portee d'une caisse a vendre le pouce ne
        # voyait rien changer (owner, 4 Sep). Une caisse en retrait, une piece devant.
        poly([(28, 96), (172, 96), (172, 212), (28, 212)])
        poly([(20, 56), (180, 56), (180, 100), (20, 100)], light)
        d.line([(100, 100), (100, 212)], fill=dark + (255,), width=W)
        ell((118, 128, 238, 248), light)
        ell((146, 156, 210, 220))
    return im


ACT_ICONES = [
    ('build', '#d2913f'), ('place', '#5fbf3a'), ('give', '#37c9a6'), ('drop', '#8d9bb4'),
    ('recover', '#4aa3ef'), ('collect', '#e8a81f'), ('fire', '#f0503c'),
    ('pickup', '#5fbf3a'), ('steal', '#e05a3c'), ('up', '#2fb6e8'),
    ('fuse', '#9b6ce8'), ('feed', '#9b6ce8'), ('outbid', '#e8a81f'), ('buy', '#e8a81f'),
]

UI_ICONES = [
    ('crate', '#e0a24a'), ('floor', '#7cc4ff'), ('shield', '#6fb1f2'), ('lock', '#e8b04a'),
    # Teal, not the grain amber it started as: the shop row already carries an amber crate,
    # an amber padlock and an amber star, and at forty pixels a fourth was one too many.
    ('silo', '#48b89f'),
    ('prestige', '#f5a524'), ('luck', '#6cc72e'),
    ('gear-0', '#e06a4a'), ('gear-1', '#4dd2ff'), ('gear-2', '#f2b45a'),
    ('gear-3', '#b48cf0'), ('gear-4', '#ff7a9c'), ('gear-5', '#ffd24a'),
    ('gear-6', '#7de8c8'), ('gear-7', '#9aa9c4'),
]


def fade(left):
    im = Image.new('RGBA', (120, 8), (0, 0, 0, 0))
    px = im.load()
    for x in range(120):
        t = x / 119
        a = int(round(235 * (1 - t) ** 1.6)) if left else int(round(235 * t ** 1.6))
        for y in range(8):
            px[x, y] = (8, 11, 17, a)
    return im


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    # NE PAS reecrire toy-<k>.png ici.
    #
    # Ces sept fichiers sont depuis passes sous l'autorite de tools/model/render-item-thumbs.py,
    # qui rend les VRAIES pieces 3D avec leur matiere. Relancer ce script les remplacait
    # silencieusement par les anciens glyphes d'echecs, et la boutique, la carte et l'index
    # perdaient les vignettes que le proprietaire a validees (6 Sep, rattrape avant commit).
    # Les glyphes restent ici pour memoire; ils s'ecrivent ailleurs.
    # Rien n'est ecrit pour les raretes ici, et c'est delibere.
    burst().save(os.path.join(OUT, 'burst.png'), optimize=True)
    enseigne().save(os.path.join(OUT, 'sign.png'), optimize=True)
    for nom, col in UI_ICONES:
        ui_icone(nom, col).save(os.path.join(OUT, f'ui-{nom}.png'), optimize=True)
    for nom, col in ACT_ICONES:
        act_icone(nom, col).save(os.path.join(OUT, f'act-{nom}.png'), optimize=True)
    # La caisse du bouton est celle des cartes: elle est deja juste, et deux dessins pour une
    # meme chose est le debut d'une incoherence.
    ui_icone('crate', '#e0a24a').save(os.path.join(OUT, 'act-crate.png'), optimize=True)
    fade(True).save(os.path.join(OUT, 'fade-left.png'), optimize=True)
    fade(False).save(os.path.join(OUT, 'fade-right.png'), optimize=True)
    print('wrote', OUT)
