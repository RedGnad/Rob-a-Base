#!/usr/bin/env python3
"""Writes the reveal stings, one per step of the ladder, so a pull SOUNDS like what it is.

Three clips existed and shared one recipe (sine plus a harmonic, a longer arpeggio for a
better pull), so the ear could not tell them apart: the ladder was in the length, and length
is the one dimension a player does not measure (owner, 5 Sep). Game audio's own answer is not
"longer", it is a different SOUND per step, along the axes the literature agrees on:

  - Rising pitch reads as reward, falling as loss (Collins, `Game Sound`, 2008): every sting
    climbs, and the higher the tier the further it climbs.
  - Timbre carries the value more than duration: a small pull is a wooden blip, a big one is
    a bell, the top is a bell plus a choir-like held chord. Adding partials and lengthening
    the decay is what turns a beep into a bell.
  - A jackpot is announced, not just played: the top tiers open with a short RISER (a pitch
    sweep) and land on a low IMPACT, the anticipation-then-payoff shape the reveal itself
    now has on screen.
  - Loudness is part of the ladder, and only part: each step is a little louder, but the
    timbre change is what makes it recognisable at any volume.

  reveal.wav       Common, Uncommon   two short wooden notes, no tail
  reveal-rare.wav  Rare               three notes, a bell partial, a short ring
  reveal-big.wav   Epic, Legendary    riser, four notes, bell, a ring that lasts
  reveal-huge.wav  Mythic, Secret     riser, impact, six notes, held triad, a long shimmer

Same synthesis as the coin: sines, harmonics, exponential decay, 22 kHz mono. All four files
together weigh about as much as one music loop.

    python3 tools/sounds/build-reveal-tiers.py
"""
import math
import os
import random
import struct
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
RATE = 22050


def sting(path, notes, step_s, decay_s, tail, chord=None, gain=0.36, partials=(1.0, 0.3),
          riser=None, impact=None, shimmer=0.0):
    """One sting. `partials` are the harmonics under each note and their weights, `riser` a
    (duration, from, to) pitch sweep before the first note, `impact` a (freq, decay) thump on
    the first note, `shimmer` a high detuned pair held under the tail."""
    total = (riser[0] if riser else 0) + step_s * len(notes) + tail
    n = int(RATE * total)
    buf = [0.0] * n
    t0 = int(RATE * (riser[0] if riser else 0))
    if riser is not None:
        d, f0, f1 = riser
        phase = 0.0
        for i in range(t0):
            t = i / RATE
            f = f0 * (f1 / f0) ** (t / d)
            phase += 2 * math.pi * f / RATE
            env = (t / d) ** 2 * math.exp(-max(0.0, t - d * 0.8) / 0.05)
            buf[i] += gain * 0.5 * env * (math.sin(phase) + 0.25 * math.sin(2 * phase))
    if impact is not None:
        f, dec = impact
        for i in range(t0, n):
            t = (i - t0) / RATE
            env = math.exp(-t / dec)
            if env < 0.001:
                break
            buf[i] += gain * 0.9 * env * math.sin(2 * math.pi * f * t * (1 - 0.3 * t))
    for k, freq in enumerate(notes):
        start = t0 + int(RATE * step_s * k)
        for i in range(start, n):
            t = (i - start) / RATE
            env = math.exp(-t / decay_s)
            if env < 0.001:
                break
            v = 0.0
            for h, w in enumerate(partials, start=1):
                v += w * math.sin(2 * math.pi * freq * h * t)
            buf[i] += gain * v * env
    if chord is not None:
        start = t0 + int(RATE * step_s * (len(notes) - 1))
        for freq in chord:
            for i in range(start, n):
                t = (i - start) / RATE
                env = math.exp(-t / (decay_s * 3.2))
                if env < 0.001:
                    break
                buf[i] += gain * 0.55 * env * math.sin(2 * math.pi * freq * t)
    if shimmer > 0:
        start = t0 + int(RATE * step_s * (len(notes) - 1))
        for freq in (3136.0, 3141.0, 4186.0):
            for i in range(start, n):
                t = (i - start) / RATE
                env = math.exp(-t / (tail * 0.7))
                if env < 0.001:
                    break
                buf[i] += gain * shimmer * env * math.sin(2 * math.pi * freq * t)
    crete = max(1e-6, max(abs(v) for v in buf))
    k = min(1.0, 0.92 / crete)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1.0, min(1.0, v * k)) * 32767)) for v in buf))
    return os.path.getsize(path)


if __name__ == '__main__':
    out = os.path.abspath(os.path.join(HERE, '../../assets/sounds'))
    # Common and Uncommon: two wooden notes, over almost before it starts.
    n1 = sting(os.path.join(out, 'reveal.wav'),
               [880.0, 1174.7], step_s=0.070, decay_s=0.075, tail=0.10,
               partials=(1.0, 0.18, 0.06), gain=0.30)
    # Rare: three notes and a bell partial, with a short ring after them.
    n2 = sting(os.path.join(out, 'reveal-rare.wav'),
               [880.0, 1174.7, 1568.0], step_s=0.080, decay_s=0.16, tail=0.28,
               partials=(1.0, 0.35, 0.14, 0.05), gain=0.33)
    # Epic and Legendary: a riser, four notes, a bell, a ring that lasts.
    n3 = sting(os.path.join(out, 'reveal-big.wav'),
               [1046.5, 1318.5, 1568.0, 2093.0], step_s=0.085, decay_s=0.26, tail=0.55,
               partials=(1.0, 0.45, 0.22, 0.10, 0.05), gain=0.34,
               riser=(0.22, 520.0, 1300.0), shimmer=0.10)
    # Mythic and Secret: riser, impact, six notes, a held triad and a long shimmer.
    n4 = sting(os.path.join(out, 'reveal-huge.wav'),
               [783.99, 1046.5, 1318.5, 1568.0, 2093.0, 2637.0],
               step_s=0.095, decay_s=0.34, tail=1.15,
               chord=[1046.5, 1568.0, 2093.0], partials=(1.0, 0.5, 0.28, 0.14, 0.07),
               gain=0.36, riser=(0.34, 420.0, 1600.0), impact=(72.0, 0.42), shimmer=0.16)
    # A rare crate reaching the belt: two rising notes, short and quiet, because a player at
    # their base cannot see the band change colour (the rush bell exists for the same reason).
    # Announced crates are one item in twelve, so the ear is not asked to hear it often.
    nb = sting(os.path.join(out, 'belt.wav'), [1174.7, 1567.98], step_s=0.075, decay_s=0.13,
               tail=0.22, partials=(1.0, 0.28, 0.10), gain=0.26)
    # A mutated pull, whatever its tier: a high shimmer laid OVER the sting, never a sting of
    # its own. Fourteen timbres would ask the ear to learn a vocabulary nothing teaches, and
    # the rarity ladder is what the ear is already reading; one extra layer says "and this one
    # is special" without touching that ladder (owner, 5 Sep).
    # Measured on 5 Sep with forty-four percent of its energy above 2 kHz for a second: a
    # shimmer is allowed to be bright, it is not allowed to be a full second of treble.
    # Less of the detuned pair, a touch less gain; the three notes are unchanged.
    nm = sting(os.path.join(out, 'mutation.wav'),
               [2637.0, 3136.0, 3520.0], step_s=0.075, decay_s=0.26, tail=0.60,
               partials=(1.0, 0.22, 0.08), gain=0.20, shimmer=0.08)
    # The strip stopping: a click and a low thud, under whichever sting follows.
    n0 = sting(os.path.join(out, 'land.wav'), [220.0], step_s=0.02, decay_s=0.10, tail=0.12,
               partials=(1.0, 0.5, 0.2), gain=0.30, impact=(96.0, 0.13))
    # The bell: a rush starting, a raid boss arriving. Both used to play `reveal.wav`, the
    # same two wooden notes as opening a common crate, so the loudest event in the venue
    # spoke in the voice of the most ordinary one. A family needs a member per meaning
    # (the guides call them sound families): two bell notes, G5 up to C6, with a longer ring
    # than any reveal, in the same key as everything else.
    nc = sting(os.path.join(out, 'bell.wav'), [783.99, 1046.5], step_s=0.16, decay_s=0.32, tail=0.45,
               partials=(1.0, 0.4, 0.18, 0.07), gain=0.32)
    for nom, taille in (('belt', nb), ('mutation', nm), ('land', n0), ('bell', nc), ('reveal', n1), ('reveal-rare', n2), ('reveal-big', n3), ('reveal-huge', n4)):
        print(f'{nom + ".wav":18s} {taille / 1024:6.1f} KB')
