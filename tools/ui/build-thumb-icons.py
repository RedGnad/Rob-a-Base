"""
The jump disc's two glyphs, taken from the client itself: assets/ui/icon-jump.png and
assets/ui/icon-glide.png.

The client does not let a scene place its buttons, only hide them or swap their picture;
the documented way to choose the layout is to draw our own. That loses the jump button's
dynamic picture, which the client turns into a glider after the double jump. The first
version redrew both by hand; the owner compared them with the client's and the client's
were plainly better (4 Sep). So the client's SVGs are vendored (tools/ui/vendor/joypad,
Apache-2.0, see NOTICE.md), recoloured to this interface's cream, and rasterised.

Rasterising uses macOS Quick Look (`qlmanage`), a build-time tool only; the PNGs are
committed, nothing at runtime depends on it.
"""
import os
import re
import shutil
import subprocess
import tempfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(HERE, 'vendor', 'joypad')
OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'assets', 'ui'))
N = 256
CREME = '#F2E9D8'
# The glyph's longest side on the 256 canvas. It matched the client's own proportion while
# these two pictures went onto the client's native buttons; the scene draws its own pad now,
# so they follow the same extent as every other button glyph. `tools/ui/normalise-glyphs.py`
# is the authority and would correct this anyway: the number here only saves it a resample.
GLYPH_EXTENT = 246

# The client draws the strokes in lavender at 80 % on its dark disc; ours are cream, full.
def recolour(svg: str) -> str:
    svg = svg.replace('#DFD0FF', CREME)
    svg = re.sub(r'<g opacity="[0-9.]+">', '<g>', svg)
    # Quick Look renders the SVG at its declared size (100 x 100) and pads the rest: declare
    # the size we want, and the viewBox scales the drawing to it.
    svg = re.sub(r'width="\d+" height="\d+"', f'width="{N}" height="{N}"', svg, count=1)
    return svg


def rasterise(svg_path: str, png_path: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, os.path.basename(svg_path))
        with open(svg_path, encoding='utf-8') as f:
            svg = recolour(f.read())
        with open(src, 'w', encoding='utf-8') as f:
            f.write(svg)
        subprocess.run(['qlmanage', '-t', '-s', str(N), '-o', tmp, src], check=True, capture_output=True)
        made = src + '.png'
        im = Image.open(made).convert('RGBA')
        # Quick Look paints a white ground behind a transparent SVG: rebuild the alpha from
        # the cream strokes so the glyph sits on our disc with nothing behind it.
        px = im.load()
        w, h = im.size
        out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        po = out.load()
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                # Distance from white: the stroke is cream, the ground is white.
                d = max(255 - r, 255 - g, 255 - b)
                alpha = min(255, int(d * 255 / 39))   # cream's largest channel gap to white is 39
                po[x, y] = (242, 233, 216, alpha)
        # Quick Look pads and offsets its thumbnails unpredictably: centre the glyph by its
        # own bounds, at the same extent for both, so the disc shows the pair at one size.
        bbox = out.getbbox()
        glyph = out.crop(bbox)
        k = GLYPH_EXTENT / max(glyph.size)
        glyph = glyph.resize((max(1, round(glyph.size[0] * k)), max(1, round(glyph.size[1] * k))), Image.LANCZOS)
        final = Image.new('RGBA', (N, N), (0, 0, 0, 0))
        final.alpha_composite(glyph, ((N - glyph.size[0]) // 2, (N - glyph.size[1]) // 2))
        final.save(png_path, optimize=True)


if __name__ == '__main__':
    if shutil.which('qlmanage') is None:
        raise SystemExit('qlmanage (macOS Quick Look) is needed to rasterise the SVGs')
    for svg, png in (('double-jump-normal.svg', 'icon-jump.png'), ('glide-normal.svg', 'icon-glide.png')):
        rasterise(os.path.join(VENDOR, svg), os.path.join(OUT, png))
        print(f'  {png} written from {svg}')
