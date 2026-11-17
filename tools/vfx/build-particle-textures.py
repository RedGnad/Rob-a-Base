"""
The particle sprites: assets/textures/fx-*.png.

Taken from Kenney's Particle Pack 1.1 (CC0, tools/vfx/vendor/kenney-particle-pack/License.txt),
the black-background versions, because their brightness is the cleanest mask in the pack.
Each becomes white with that brightness as its alpha: a particle's colour comes from the
emitter (`initialColor`, `colorOverTime`), so a sprite must carry shape only, or every tint
would be multiplied by the grey it was drawn in.

128 pixels square, down from 512: the largest particle is a third of a metre on screen for
under a second, and a texture's memory is paid on the phone whether anyone looks or not.

Each build prints the share of the sprite's width its lit shape spans (pixels over alpha 32,
the longer side of their box). `src/client/vfx.ts` divides by it, so a size there is the shape
seen, not the square around it. The star is the exception: its rays span three quarters of the
sprite but only its core reads, so its factor was set from captures (`SPARK`).
"""
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(HERE, 'vendor', 'kenney-particle-pack')
OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'assets', 'textures'))
N = 128
LIT = 32

SPRITES = {
    'star_06.png': 'fx-star.png',
    # A soft round cloud: a ghost's breath, the boss's slam.
    'smoke_04.png': 'fx-puff.png',
    # One tongue of fire, tip up: billboards keep it upright on both clients.
    'flame_05.png': 'fx-flame.png',
    # A thin bright ring: a bubble.
    'circle_02.png': 'fx-ring.png',
    # A vertical streak, soft at both ends: digital rain falling, light rising.
    'trace_06.png': 'fx-streak.png',
    # A hook of smoke curling on itself: a curse.
    'twirl_02.png': 'fx-swirl.png',
}


def build(src: str, dst: str) -> None:
    mask = Image.open(os.path.join(VENDOR, src)).convert('L').resize((N, N), Image.LANCZOS)
    white = Image.new('L', (N, N), 255)
    Image.merge('RGBA', (white, white, white, mask)).save(os.path.join(OUT, dst), optimize=True)
    box = mask.point(lambda p: 255 if p > LIT else 0).getbbox()
    span = max(box[2] - box[0], box[3] - box[1]) / N if box is not None else 0
    print(f'{dst}: {N}x{N}, lit shape spans {span:.2f} of the sprite')


if __name__ == '__main__':
    for s, d in SPRITES.items():
        build(s, d)
