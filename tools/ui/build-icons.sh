#!/usr/bin/env bash
#
# The whole button-glyph chain, in the one order it is allowed to run in.
#
# Why this file exists. `build-hud-icon.js` writes the BASE of every glyph, including six that
# a dedicated script later replaces entirely: `collect`, `gun`, `holster`, `menu`, `menu-alert`,
# and `crate`'s ink twin. Running the JS on its own therefore silently reverts those to designs
# the owner had already rejected, and the revert is invisible in a diff of source files because
# only the PNGs move. That happened on 7 Sep: regenerating the arrows brought back the old
# database-looking `collect` and the old weapon pair with it.
#
# So the order is a fact about the chain, not a preference: base, then every override, then the
# normalisation that brings the family to one optical extent. Add a new generator to this list at
# the position where it overwrites, never call it by hand.
#
# A full run does NOT reproduce the shipped set byte for byte, measured 7 Sep: `smash`, `jump` and
# `glide` come back with their bounding box moved one pixel, which is resampling noise, and
# `icon-menu` comes back 8 px shorter at equal width, which is a real difference, so
# `build-menu-icon.py` has moved since the menu glyph the owner approved. Until that is resolved,
# regenerate what you mean to change and `git checkout --` the rest; do not commit a full run.
#
# Run: bash tools/ui/build-icons.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

node tools/ui/build-hud-icon.js        # base set: every verb, the menu, the weapon pair, the UI chrome

python3 tools/ui/build-collect-icon.py # overrides collect: a coin, not a database cylinder
python3 tools/ui/build-weapon-icons.py # overrides gun and holster, adds slap and taser
python3 tools/ui/build-menu-icon.py    # overrides menu and menu-alert
python3 tools/ui/build-arrow-icons.py  # overrides the six arrows with the client's own arrow
python3 tools/ui/build-smash-icon.py   # overrides encre-crate, adds the smash poses
python3 tools/ui/build-mallet-icon.py  # the build poses
python3 tools/ui/build-thumb-icons.py  # jump and glide
python3 tools/ui/build-toy-icons.py    # act-crate

python3 tools/ui/normalise-glyphs.py   # one optical extent for the whole family, last
