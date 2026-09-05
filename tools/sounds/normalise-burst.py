#!/usr/bin/env python3
"""
Bring burst.wav down off full scale.

The reveal's burst is the one file in the set with no generator: it predates them (24 Aug).
Measured on 5 Sep it peaked at 0.0 dBFS, and it was played at full volume, which is clipping
before the mixer even sees it. This writes it back at -1.5 dBFS peak, the same headroom the
generated stings leave (`sting()` scales to 0.92 of full scale), and touches nothing else.

    python3 tools/sounds/normalise-burst.py
"""
import os
import struct
import wave

PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'sounds', 'burst.wav'))
PEAK = 0.84  # -1.5 dBFS


def main():
    with wave.open(PATH, 'rb') as w:
        n, rate, ch, sw = w.getnframes(), w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(n)
    assert sw == 2, 'expected 16 bit'
    data = list(struct.unpack('<' + 'h' * (n * ch), raw))
    peak = max(abs(v) for v in data) / 32767.0
    k = PEAK / max(peak, 1e-6)
    if k >= 1.0:
        print(f'burst.wav already peaks at {peak:.3f}, nothing to do')
        return
    out = struct.pack('<' + 'h' * len(data), *[int(max(-32768, min(32767, v * k))) for v in data])
    with wave.open(PATH, 'wb') as w:
        w.setnchannels(ch)
        w.setsampwidth(sw)
        w.setframerate(rate)
        w.writeframes(out)
    print(f'burst.wav peak {peak:.3f} -> {PEAK:.2f}')


if __name__ == '__main__':
    main()
