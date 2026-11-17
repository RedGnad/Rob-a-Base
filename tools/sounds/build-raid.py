#!/usr/bin/env python3
"""
The raid boss's slam: what a telegraphed blow sounds like, coming and landing (3 Nov).

  windup.wav  a growl rising from C2 to G2 that swells and stops dead: the slam is coming
  slam.wav    a heavy thud that drops from G2 to C2 under a short burst of dirt, then rumbles out

The wind-up is 0.65 s at pitch 1. The client plays it at pitch 0.65 / wind-up seconds, so it ends
on the impact whatever the wind-up lasts: lower and slower for the calm boss (1 s), higher and
quicker in rage (0.7 s). A telegraph you can hear lets a player dodge without looking down, and
sound is the cheapest layer of feedback there is (Jonasson and Purho, "Juice it or lose it").

An event cue, heard a few times a minute and only by the players near the boss (it plays from
the boss, not from the camera), so it is allowed a tail (`README.md`, classes). Low on purpose:
the crate's land and burst are mid-range and frequent, and the slam must never be mistaken for
a crate hitting the floor. Same recipe as the other generators in this folder: sine partials
shaped by an envelope plus a little shaped noise, no samples, mono, 22 kHz.

Run: python3 tools/sounds/build-raid.py
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


def noise(seed=7):
    x = seed
    while True:
        x = (x * 1103515245 + 12345) & 0x7fffffff
        yield x / 0x3fffffff - 1.0


def slam():
    n = int(RATE * 0.55)
    out = []
    phase1 = phase2 = 0.0
    hiss = noise()
    low = 0.0
    for i in range(n):
        t = i / RATE
        # G2 falling to C2 over the first tenth of a second: the weight arriving.
        f = 65.41 + (98.0 - 65.41) * math.exp(-t / 0.035)
        phase1 += 2 * math.pi * f / RATE
        phase2 += 2 * math.pi * 2 * f / RATE
        attack = min(1.0, t / 0.004)
        body = attack * math.exp(-t / 0.16)
        s = math.sin(phase1) * body + 0.35 * math.sin(phase2) * body * math.exp(-t / 0.06)
        # The dirt: noise through a one-pole low pass, only in the first 60 ms.
        low += 0.18 * (next(hiss) - low)
        s += 0.9 * low * math.exp(-t / 0.025)
        # The rumble after: a slow beat between C2 and a slightly flat C2, fading out.
        s += 0.18 * math.sin(2 * math.pi * 65.41 * t) * math.sin(2 * math.pi * 3.1 * t) * math.exp(-t / 0.25) * (t > 0.05)
        out.append(s)
    return out


def windup():
    n = int(RATE * 0.65)
    out = []
    phase1 = phase2 = 0.0
    for i in range(n):
        t = i / RATE
        k = t / 0.65
        # C2 to G2, the same two notes the slam falls through, so the pair reads as one gesture.
        f = 65.41 * (98.0 / 65.41) ** k
        phase1 += 2 * math.pi * f / RATE
        phase2 += 2 * math.pi * 3 * f / RATE
        # Swells to the end and stops dead, with 8 ms of release so it does not click.
        env = (k ** 1.6) * min(1.0, (0.65 - t) / 0.008)
        growl = 1 + 0.35 * math.sin(2 * math.pi * 11 * t)
        out.append(env * growl * (math.sin(phase1) + 0.3 * math.sin(phase2)))
    return out


if __name__ == '__main__':
    write('windup.wav', windup(), 0.8)
    write('slam.wav', slam(), 0.9)
