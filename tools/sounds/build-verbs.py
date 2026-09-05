#!/usr/bin/env python3
"""
Two acts of the game that made no sound at all: taking the lift, and drawing the weapon.

The pad's buttons were silent (the panels click, the thumb pad did not), and two of the
verbs behind them had no audible answer either: pressing GO UP teleported the player a floor
higher in silence, and F drew the gun in silence. Game audio's first rule is that an input
without a reply reads as an input that did not register, which is exactly what the owner
asked about (5 Sep: "est-ce que chaque input contextuel a un son en feedback ?").

  lift.wav   a short rising whoosh with a soft thud at the top: the ride and the arrival
  draw.wav   a click and a brief metallic slide, the sound of something leaving a holster

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
    """A filtered noise sweep that rises, then one low thud: air, then arrival."""
    n = int(RATE * 0.55)
    out = [0.0] * n
    g = noise(7)
    lp = 0.0
    for i in range(n):
        t = i / RATE
        k = min(1.0, t / 0.34)
        # the sweep: a one-pole low pass whose cutoff climbs, which is a whoosh
        a = 0.04 + 0.5 * k
        lp += a * (next(g) - lp)
        env = math.sin(math.pi * min(1.0, t / 0.4)) ** 1.5
        out[i] = lp * env * 0.7
        if t > 0.30:                                    # the thud at the top
            u = t - 0.30
            out[i] += 0.85 * math.sin(2 * math.pi * (150 - 60 * u / 0.25) * u) * math.exp(-u * 14)
    return out


def draw():
    """A click, then a short bright slide: a thing coming out of a holster."""
    n = int(RATE * 0.26)
    out = [0.0] * n
    g = noise(23)
    for i in range(n):
        t = i / RATE
        s = 0.0
        if t < 0.02:                                    # the click
            s += next(g) * math.exp(-t * 260) * 0.9
        else:
            next(g)
        if 0.02 <= t < 0.20:                            # the slide, rising
            u = t - 0.02
            f = 900 + 1500 * (u / 0.18)
            s += 0.5 * math.sin(2 * math.pi * f * u) * math.exp(-u * 12)
            s += 0.2 * math.sin(2 * math.pi * f * 1.5 * u) * math.exp(-u * 16)
        out[i] = s
    return out


if __name__ == '__main__':
    write('lift.wav', lift(), 0.85)
    write('draw.wav', draw(), 0.8)


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


for _name, _fn, _v in (('knock.wav', knock, 0.85), ('put.wav', put, 0.8),
                       ('till.wav', till, 0.8), ('hum.wav', hum, 0.75), ('back.wav', back, 0.8)):
    write(_name, _fn(), _v)
