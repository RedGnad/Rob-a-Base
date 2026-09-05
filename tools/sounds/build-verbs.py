#!/usr/bin/env python3
"""
Two acts of the game that made no sound at all: taking the lift, and drawing the weapon.

The pad's buttons were silent (the panels click, the thumb pad did not), and two of the
verbs behind them had no audible answer either: pressing GO UP teleported the player a floor
higher in silence, and F drew the gun in silence. Game audio's first rule is that an input
without a reply reads as an input that did not register, which is exactly what the owner
asked about (5 Sep: "est-ce que chaque input contextuel a un son en feedback ?").

  lift.wav     a short rising whoosh with a soft thud at the top: the ride and the arrival
  draw.wav     a rub of cloth rising, then the latch: something leaving a holster
  holster.wav  the push, the same rub falling, a padded stop: the same thing going back

Both are short, mono, 22 kHz, and cost a few kilobytes: same recipe as the other generators
in this folder, sine partials shaped by an envelope, no samples.

Run: python3 tools/sounds/build-verbs.py
"""
import math
import os
import struct
import wave

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'sounds'))
RATE = 22050


def write(name, samples, volume=0.9):
    peak = max(1e-6, max(abs(s) for s in samples))
    data = b''.join(struct.pack('<h', int(max(-1.0, min(1.0, s / peak * volume)) * 32767)) for s in samples)
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(data)
    print(f'  {name}  {len(samples) / RATE:.2f}s  {len(data) // 1024} Ko')


def noise(seed=1):
    x = seed
    while True:
        x = (1103515245 * x + 12345) & 0x7fffffff
        yield x / 0x3fffffff - 1.0


def lift():
    """A short breath upward, and nothing else.

    The first one ran half a second with a rising whoosh and a low thud at the top, which is a
    lift in a film. Ours is pressed three times in a row to climb a base, so it has to be a
    tick rather than an event (owner, 5 Sep, "plus court et moins dramatique"). A sixth of a
    second, an airy sweep with a small chirp riding it, no impact at the end.
    """
    n = int(RATE * 0.17)
    out = [0.0] * n
    g = noise(7)
    lp = 0.0
    for i in range(n):
        t = i / RATE
        a = 0.10 + 0.55 * (t / 0.17)
        lp += a * (next(g) - lp)
        env = math.sin(math.pi * min(1.0, t / 0.17)) ** 1.2
        out[i] = lp * env * 0.55 + 0.35 * math.sin(2 * math.pi * (420 + 520 * t / 0.17) * t) * env
    return out


def resonant(samples, freq_of, r=0.965):
    """Noise through a two pole resonator whose centre glides: the only way a synthesised
    hiss reads as a MATERIAL (cloth, leather) rather than as a beep. `freq_of(t)` is the
    centre in hertz at time t; `r` sets the ring, near one for a narrow band."""
    out = [0.0] * len(samples)
    y1 = y2 = 0.0
    for i, x in enumerate(samples):
        w = 2 * math.pi * freq_of(i / RATE) / RATE
        y = x + 2 * r * math.cos(w) * y1 - r * r * y2
        out[i] = y
        y2, y1 = y1, y
    peak = max(1e-6, max(abs(v) for v in out))
    return [v / peak for v in out]


def draw():
    """Drawing: a swept rub of cloth, rising, then the small latch at the end.

    The first version was a click and a rising sine, and a sine is a whistle: it said "beep",
    not "an object leaving a holster" (owner, 5 Sep). What the ear files under "drawn" is
    friction first, the band of a hiss sliding UP as the thing comes free, and only then a
    short hard contact, the catch letting go at the top of the travel. Under a fifth of a
    second, because the owner was right that short was the part that worked.
    """
    n = int(RATE * 0.19)
    g = noise(23)
    raw = [next(g) for _ in range(n)]
    rub = resonant(raw, lambda t: 650 + 1900 * min(1.0, t / 0.12))
    out = [0.0] * n
    g2 = noise(29)
    for i in range(n):
        t = i / RATE
        env = min(1.0, t / 0.012) * math.exp(-max(0.0, t - 0.05) * 22)     # swells, then fades
        s = 0.55 * rub[i] * env
        if t >= 0.125:                                                     # the latch
            u = t - 0.125
            s += 0.9 * next(g2) * math.exp(-u * 420) + 0.6 * math.sin(2 * math.pi * 1750 * u) * math.exp(-u * 160)
        else:
            next(g2)
        out[i] = s
    return out


def holster():
    """Putting away: the latch first, then the same rub falling, and a soft seat at the end.

    The mirror of `draw`, and a different file, so the two acts are told apart by ear: the
    contact comes first because the thing is pushed home, the hiss slides DOWN as it goes in,
    and it ends on a low, padded stop rather than on a click.
    """
    n = int(RATE * 0.21)
    g = noise(31)
    raw = [next(g) for _ in range(n)]
    rub = resonant(raw, lambda t: 2300 - 1600 * min(1.0, max(0.0, t - 0.02) / 0.13))
    out = [0.0] * n
    g2 = noise(37)
    for i in range(n):
        t = i / RATE
        s = 0.0
        if t < 0.03:                                                       # the push
            s += 0.7 * next(g2) * math.exp(-t * 300)
        else:
            next(g2)
        if t >= 0.02:
            u = t - 0.02
            s += 0.5 * rub[i] * min(1.0, u / 0.015) * math.exp(-max(0.0, u - 0.06) * 24)
        if t >= 0.15:                                                      # the seat
            u = t - 0.15
            s += 0.8 * math.sin(2 * math.pi * 150 * u) * math.exp(-u * 70)
        out[i] = s
    return out


def deliver():
    """A crate landing at your base: a padded thud and one warm low note.

    This is a sound the player hears often and never has to act on, which the literature
    puts at the quiet end of the scale: "the more frequently a sound occurs in a product,
    the more subtle, shorter, and warmer it needs to be" (Toptal, UX sounds guide), and
    "harmonically complex sounds indicate priority", so a delivery gets one partial, low, and
    no sparkle at all. Lower frequencies read as settled and trustworthy, which is what a
    thing arriving where it belongs should feel like. Under a quarter of a second.
    """
    n = int(RATE * 0.24)
    out = [0.0] * n
    g = noise(41)
    for i in range(n):
        t = i / RATE
        s = 0.0
        if t < 0.04:                                                       # the thud
            s += 0.6 * next(g) * math.exp(-t * 180)
        else:
            next(g)
        s += 0.9 * math.sin(2 * math.pi * 196 * t) * math.exp(-t * 14) * min(1.0, t / 0.01)
        s += 0.25 * math.sin(2 * math.pi * 392 * t) * math.exp(-t * 22)
        out[i] = s
    return out


if __name__ == '__main__':
    write('lift.wav', lift(), 0.85)
    write('draw.wav', draw(), 0.8)
    write('holster.wav', holster(), 0.8)
    write('deliver.wav', deliver(), 0.7)


def knock():
    """BUILD: a wooden knock, the mallet meeting the ground."""
    n = int(RATE * 0.18); out = [0.0] * n; g = noise(3)
    for i in range(n):
        t = i / RATE
        e = math.exp(-t * 34)
        out[i] = (0.7 * math.sin(2 * math.pi * 190 * t) + 0.3 * math.sin(2 * math.pi * 320 * t)) * e + next(g) * math.exp(-t * 300) * 0.5
    return out


def put():
    """PLACE and GIVE: a soft set-down, low and short, no click."""
    n = int(RATE * 0.16); out = [0.0] * n
    for i in range(n):
        t = i / RATE
        out[i] = 0.8 * math.sin(2 * math.pi * (150 - 40 * t / 0.16) * t) * math.exp(-t * 26)
    return out


def till():
    """BUY and OUTBID: two bright notes, the till answering the money."""
    n = int(RATE * 0.30); out = [0.0] * n
    for i in range(n):
        t = i / RATE
        s = 0.0
        for start, f in ((0.0, 880.0), (0.09, 1320.0)):
            if t >= start:
                u = t - start
                s += 0.55 * math.sin(2 * math.pi * f * u) * math.exp(-u * 13)
                s += 0.2 * math.sin(2 * math.pi * f * 2 * u) * math.exp(-u * 18)
        out[i] = s
    return out


def hum():
    """FUSE: a short rising hum, a machine taking something in."""
    n = int(RATE * 0.34); out = [0.0] * n
    for i in range(n):
        t = i / RATE
        f = 120 + 260 * (t / 0.34) ** 1.6
        e = math.sin(math.pi * min(1.0, t / 0.34)) ** 0.8
        out[i] = (0.6 * math.sin(2 * math.pi * f * t) + 0.25 * math.sin(2 * math.pi * f * 2 * t)) * e
    return out


def back():
    """RECOVER: a sweep that falls then lands, something coming back to you."""
    n = int(RATE * 0.30); out = [0.0] * n
    for i in range(n):
        t = i / RATE
        f = 700 - 420 * (t / 0.30)
        e = math.exp(-t * 6)
        out[i] = 0.7 * math.sin(2 * math.pi * f * t) * e
        if t > 0.22:
            u = t - 0.22
            out[i] += 0.6 * math.sin(2 * math.pi * 160 * u) * math.exp(-u * 20)
    return out


def take():
    """PICKUP: lifting your OWN toy off its stand, which is a gentle act.

    It was borrowing `zap`, the sentry's electric bolt, and stealing sounds like that on
    purpose: taking your own piece back does not (owner, 5 Sep, "un peu aggressif, peu
    agreable"). Two soft partials a fifth apart, quick in and quicker out, no noise burst at
    all, at two thirds of the volume the other cues use.
    """
    n = int(RATE * 0.16)
    out = [0.0] * n
    for i in range(n):
        t = i / RATE
        e = math.exp(-t * 22) * min(1.0, t / 0.006)
        out[i] = (0.6 * math.sin(2 * math.pi * 660 * t) + 0.3 * math.sin(2 * math.pi * 990 * t)) * e
    return out


def slot():
    """PLACE: your toy going onto YOUR shelf, which is the reward the whole loop pays out.

    It was borrowing `put`, a neutral set-down, and the moment a player earns everything for
    is not neutral. But it is not the climax either: the reveal is, and a payoff louder than
    the climax flattens both (owner, 5 Sep). So: the physical seat, low and short, and ONE
    soft note over it rather than a two note fanfare. Satisfying, then out of the way.
    """
    n = int(RATE * 0.26)
    out = [0.0] * n
    for i in range(n):
        t = i / RATE
        s = 0.7 * math.sin(2 * math.pi * (140 - 30 * t / 0.26) * t) * math.exp(-t * 24)
        if t >= 0.05:
            u = t - 0.05
            s += 0.32 * math.sin(2 * math.pi * 784.0 * u) * math.exp(-u * 14)
            s += 0.10 * math.sin(2 * math.pi * 1568.0 * u) * math.exp(-u * 20)
        out[i] = s
    return out


def reel():
    """The strip passing a card: a wooden blip, softer and rounder than the interface click.

    The reel borrowed `tick.wav`, the UI click, and at the start of a spin the cards fly past
    faster than a sound can finish, so the ear got a rattle and then nothing (owner, 5 Sep:
    "on n'a pas de sfx pendant que la roulette choisit"). This one is 60 ms, two soft partials,
    no noise: it survives being played twenty times and it is pleasant when the strip slows to
    one card a second, which is the part that matters.
    """
    n = int(RATE * 0.06)
    out = [0.0] * n
    for i in range(n):
        t = i / RATE
        e = math.exp(-t * 90) * min(1.0, t / 0.002)
        out[i] = (0.7 * math.sin(2 * math.pi * 520 * t) + 0.3 * math.sin(2 * math.pi * 1040 * t)) * e
    return out


for _name, _fn, _v in (('knock.wav', knock, 0.85), ('put.wav', put, 0.8), ('take.wav', take, 0.55),
                       ('slot.wav', slot, 0.85), ('reel.wav', reel, 0.6),
                       ('till.wav', till, 0.8), ('hum.wav', hum, 0.75), ('back.wav', back, 0.8)):
    write(_name, _fn(), _v)
