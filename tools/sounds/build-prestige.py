#!/usr/bin/env python3
"""
The one act in the game that had no sound at all: prestige.

Everything else answers. A crate opening has four tiers of reveal, a purchase rings the till,
a shot cracks, taking the lift breathes. Prestige, which is the only IRREVERSIBLE decision in
the game and the only permanent multiplier, played nothing: a coloured line of text, and the
counter starting again from zero (owner, 7 Sep, "on a un SFX pour quand on debloque un
prestige ?"). Silence at the climax of the loop reads as "nothing happened", which is the
exact opposite of what just happened.

It cannot borrow. `reveal-huge` belongs to the top crate and `till` to money; wearing either
would say "you pulled a Secret" or "you bought a thing" at the moment the player gave up
everything they owned. So prestige gets the only fanfare in the game, and it is the only
place one is allowed: a sound this large used twice stops meaning "the biggest thing".

  prestige.wav  a major triad climbing to the octave, each note struck like a bell, the last
                one held and shimmering: four notes, 1.15 s, the longest cue we ship.

Same recipe as the other generators here: sine partials shaped by an envelope, no samples.
Mono, 22 kHz, a few kilobytes.

Run: python3 tools/sounds/build-prestige.py
"""
import math
import os
import struct
import wave

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'sounds'))
RATE = 22050
DUREE = 1.15
# C5 E5 G5 C6: a major triad resolving on its octave. The interval is what carries "upgrade";
# a chromatic run would only carry "something is happening".
NOTES = ((0.00, 523.25), (0.11, 659.25), (0.22, 783.99), (0.36, 1046.50))


def prestige():
    n = int(RATE * DUREE)
    out = [0.0] * n
    for i in range(n):
        t = i / RATE
        s = 0.0
        for k, (depart, f) in enumerate(NOTES):
            if t < depart:
                continue
            u = t - depart
            # The last note rings on; the three that lead to it get out of its way.
            decay = 2.6 if k == len(NOTES) - 1 else 7.5
            e = math.exp(-u * decay) * min(1.0, u / 0.004)
            # A struck bell is the fundamental plus a thin octave and a thinner twelfth, not
            # a pure sine: without the partials it reads as a test tone.
            s += 0.60 * math.sin(2 * math.pi * f * u) * e
            s += 0.18 * math.sin(2 * math.pi * f * 2 * u) * e
            s += 0.07 * math.sin(2 * math.pi * f * 3 * u) * e
        # A slow tremolo on the tail only: it makes the held note breathe instead of just
        # fading, which is the difference between a chord and an ending.
        if t > 0.36:
            s *= 1.0 + 0.09 * math.sin(2 * math.pi * 5.5 * (t - 0.36))
        out[i] = s
    return out


def write(name, samples, volume=0.9):
    peak = max(1e-6, max(abs(s) for s in samples))
    data = b''.join(struct.pack('<h', int(max(-1.0, min(1.0, s / peak * volume)) * 32767)) for s in samples)
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(data)
    print(f'  {name}  {len(samples) / RATE:.2f}s  {len(data) // 1024} Ko')


write('prestige.wav', prestige(), 0.85)
