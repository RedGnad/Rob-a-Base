#!/usr/bin/env python3
"""
Measure, in a tester's phone screenshot, how wide the mobile client really draws a known string,
and compare it to `largeurTexte` (src/client/theme.ts).

The width table in theme.ts was calibrated on Unity desktop screenshots. The mobile client is
another engine with another font, and it sets the same string wider: measured 1.10 and 1.22 on
9 Sep on two testers' phones. Every screenshot that shows a known string in the orange title
colour is one more calibration point for AVANCE_TELEPHONE.

Usage:
  python3 tools/ui/measure-mobile-text.py <screenshot.png> <y0> <y1> <xmin> "<text>" <fontSize> [colour]

  y0..y1  rows (in image pixels) that cross the title line
  xmin    leftmost image column to scan, to skip the world on the left
  text    the exact string drawn, fontSize its TYPE size (32 body, 21 caption)
  colour  orange (C.bonus titles, default), yellow (#ffd166 timers, money) or white (hints)

Both tables of theme.ts are compared: the desktop one and ADVANCE_PHONE, fitted on 9 Sep from
eight strings on three testers' screenshots. A ratio near 1.0 against the phone table means the
fit still holds on this phone; a class that drifts shows up as one kind of string drifting.

The screenshot must be a PNG (macOS screenshots are). The canvas is assumed to be the phone's
1600-unit virtual width; the scale is the image width divided by 1600.
"""
import struct, zlib, io, colorsys, sys

ADVANCE = {'upper': 0.68, 'lower': 0.44, 'digit': 0.58, 'space': 0.26, 'other': 0.36}
ADVANCE_PHONE = {'upper': 0.61, 'lower': 0.55, 'digit': 0.45, 'space': 0.26, 'other': 0.36}

# Text colours as the phone renders them, one test per named colour of the interface.
COLOURS = {
    'orange': lambda r, g, b: r > 215 and 105 < g < 175 and b < 110,
    'yellow': lambda r, g, b: r > 200 and g > 170 and b < 150,
    'white': lambda r, g, b: r > 200 and g > 200 and b > 200,
}


def estimate(text, size, table=ADVANCE):
    em = 0.0
    for ch in text:
        if ch == ' ': em += table['space']
        elif ch.isdigit(): em += table['digit']
        elif 'A' <= ch <= 'Z': em += table['upper']
        elif 'a' <= ch <= 'z': em += table['lower']
        else: em += table['other']
    return em * size


def png_read(path):
    d = io.open(path, 'rb').read()
    assert d[:8] == bytes([137, 80, 78, 71, 13, 10, 26, 10]), 'not a PNG'
    off, idat, w, h, ct = 8, b'', 0, 0, 0
    while off < len(d):
        ln, = struct.unpack_from('>I', d, off)
        typ = d[off+4:off+8]
        data = d[off+8:off+8+ln]
        if typ == b'IHDR':
            w, h, _bd, ct = struct.unpack('>IIBB', data[:10])
        elif typ == b'IDAT':
            idat += data
        off += 12 + ln
    raw = zlib.decompress(idat)
    nch = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    stride = w * nch
    out = bytearray()
    prev = bytearray(stride)
    p = 0
    for _y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p+stride]); p += stride
        if f:
            for i in range(stride):
                a = line[i-nch] if i >= nch else 0
                b = prev[i]
                c = prev[i-nch] if i >= nch else 0
                if f == 1: line[i] = (line[i] + a) & 255
                elif f == 2: line[i] = (line[i] + b) & 255
                elif f == 3: line[i] = (line[i] + (a + b) // 2) & 255
                else:
                    pp = a + b - c
                    pa, pb, pc = abs(pp-a), abs(pp-b), abs(pp-c)
                    pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                    line[i] = (line[i] + pr) & 255
        out += line
        prev = line
    return w, h, nch, bytes(out)


def scan(path, y0, y1, xmin, text, size, colour='orange', canvas_w=1600):
    w, h, nch, px = png_read(path)
    scale = w / canvas_w
    orange, navy = [], []
    for y in range(y0, y1):
        for x in range(xmin, w):
            o = (y * w + x) * nch
            r, g, b = px[o], px[o+1], px[o+2]
            # The text colour asked for; and the panel's navy plate.
            if COLOURS[colour](r, g, b): orange.append(x)
            if r < 75 and g < 85 and 60 < b < 140: navy.append(x)
    if not orange:
        print('no %s text found in that band' % colour); return
    tx0, tx1 = min(orange), max(orange)
    virt = (tx1 - tx0) / scale
    est = estimate(text, size)
    print(text)
    print('  image %dx%d, canvas 1600 -> %.3f physical px per unit' % (w, h, scale))
    print('  text: x %d..%d = %d px = %.0f units' % (tx0, tx1, tx1 - tx0, virt))
    if navy:
        print('  plate right edge at %.0f units, text runs %.0f units past it' % (max(navy) / scale, (tx1 - max(navy)) / scale))
    print('  desktop table estimate @%d: %.0f units, ratio %.3f' % (size, est, virt / est))
    tel = estimate(text, size, ADVANCE_PHONE)
    print('  phone table estimate @%d: %.0f units, ratio %.3f' % (size, tel, virt / tel))


if __name__ == '__main__':
    if len(sys.argv) < 7:
        print(__doc__); sys.exit(1)
    scan(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5], int(sys.argv[6]),
         sys.argv[7] if len(sys.argv) > 7 else 'orange')
