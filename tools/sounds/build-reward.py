#!/usr/bin/env python3
"""
The daily reward and the quest reward were wearing the delivery sound.

Both handlers played `deliver.wav` (`theft.ts`), which is the cue a bought crate makes when it
finishes walking home. That sound says LOGISTICS: a thing you were already owed has arrived. A
daily login and a completed quest are not that. They are a GIFT, unasked and one-off, and the
owner heard the mismatch straight away (8 Sep: "ca fait pas penser a un reward ponctuel").

Why it cannot borrow either, and the shelf really is empty: `bell` is the plaza's announcement
for a boss and an event, `till` is money leaving your hands, `reveal` belongs to a crate opening,
`coin` to a pile hitting the floor, `slot` to an item going on its pedestal. Every sound in this
game already answers a different question.

So it is built, and it is built as PRESTIGE'S LITTLE BROTHER. The two are the only cues that mean
"you were given something permanent", so they should be recognisably the same family: struck
bells, a rising interval, the same partials. What separates them is scale, and that separation is
the whole point.

  prestige.wav  four notes, a major triad to the octave, 1.15 s. The only fanfare, once a run.
  reward.wav    two notes, a rising fifth, 0.52 s. Small enough to hear every day without
                wearing out, related enough that a player who has heard prestige knows what
                kind of news this is.

A fifth rather than the full triad on purpose: it is the same upward gesture with one step
instead of three, so it reads as the small version of the big thing rather than as its own
unrelated event.

Same recipe as the other generators here: sine partials shaped by an envelope, no samples.
Mono, 22 kHz, a few kilobytes.

Run: python3 tools/sounds/build-reward.py
"""
import math
import os
import struct
import wave

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'sounds'))
RATE = 22050
DUREE = 0.52
# G5 then D6: a rising fifth. Prestige uses C5 E5 G5 C6; this is the same room, two notes of it.
NOTES = ((0.00, 783.99), (0.10, 1174.66))


def reward():
    n = int(RATE * DUREE)
    out = [0.0] * n
    for i in range(n):
        t = i / RATE
        s = 0.0
        for k, (depart, f) in enumerate(NOTES):
            if t < depart:
                continue
            u = t - depart
            # The second note rings on, the first clears the way, same rule as prestige but
            # tighter: this one has to be gone before the player's next tap.
            decay = 4.2 if k == len(NOTES) - 1 else 9.0
            e = math.exp(-u * decay) * min(1.0, u / 0.004)
            # The same three partials as prestige, so the two sound like one instrument.
            s += 0.60 * math.sin(2 * math.pi * f * u) * e
            s += 0.18 * math.sin(2 * math.pi * f * 2 * u) * e
            s += 0.07 * math.sin(2 * math.pi * f * 3 * u) * e
        out[i] = s
    return out


def write(name, samples, volume=0.9):
    peak = max(1e-6, max(abs(s) for s in samples))
    data = b''.join(struct.pack('<h', int(max(-1.0, min(1.0, s / peak * volume)) * 32767)) for s in samples)
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(data)
    print(f'  {name}  {len(samples) / RATE:.2f}s  {len(data) // 1024} Ko')


write('reward.wav', reward(), 0.8)
