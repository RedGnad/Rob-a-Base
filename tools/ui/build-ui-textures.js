#!/usr/bin/env node
/**
 * Builds the interface textures.
 *
 * Decentraland gives a scene three fonts and nothing else, and no widget kit; what it does
 * give is a textured background with nine-slice scaling. So every plate is drawn here, and
 * a colour is a number in this file rather than a binary nobody can edit. No dependencies:
 * PNG is deflate plus a handful of chunks, and Node already carries zlib.
 *
 * The language (validated on the 28 Aug contact sheet, from the reference GUI packs the
 * mobile tycoons use): one dark navy outline shared by every control, a saturated two-stop
 * body, a translucent gloss band across the top, and a darker lip at the bottom. Meaning
 * lives in the body hue: gold is the main action, green is a claim, red is danger, blue is
 * navigation, grey-blue is locked.
 *
 * Two mobile facts shape the drawing. The centre of a nine-slice is TILED by the mobile
 * client rather than stretched, so the centre must be flat: gradients are confined to the
 * top and bottom slice bands, which only ever stretch horizontally, and a vertical gradient
 * is constant along x. And tinting at render time never arrives on a handset, so every
 * colour is baked.
 *
 *   node tools/ui/build-ui-textures.js
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const OUT = path.resolve(__dirname, '../../assets/ui')
const SIZE = 128
/**
 * Corner radius in pixels. The slice fraction in theme.ts has to match RADIUS / SIZE.
 *
 * Twenty, from forty, and the reason is a third mobile fact next to the two above: the phone
 * draws a nine-slice with Godot's NinePatchRect, whose patch margins are the slices in texture
 * pixels, and a NinePatchRect can never be SMALLER than its margins added up. At forty a
 * plate could not go under eighty units tall or wide, so every plate drawn shorter (the raid
 * countdown at forty, the rush chip, the cloak line, the crate timer at fifty-two, the close
 * button at fifty-seven wide) was silently stretched to eighty on the tester's phone: text
 * off-centre in a box it was not laid out for, and stacked plates eating the gap between them
 * (6 Sep, screenshot). The desktop enforces no minimum, which is why none of it showed there.
 * At twenty the floor is forty, under every plate the interface draws.
 */
const RADIUS = 20
/** The shared outline, the one silhouette every control wears. */
const OW = 6

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

let TABLE = null
function crc32(buf) {
  if (TABLE === null) {
    TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      TABLE[n] = c
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c ^ 0xffffffff
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
const clamp01 = (v) => Math.min(1, Math.max(0, v))

/**
 * Signed distance to a rounded rectangle, in pixels. Negative inside, zero on the edge.
 * The outline, the body, the gloss and the antialiasing all read this one number, so the
 * corner radius is right by construction instead of being drawn four times and hoped to
 * match.
 */
function sdf(x, y, w, h, r) {
  const dx = Math.abs(x - w / 2) - (w / 2 - r)
  const dy = Math.abs(y - h / 2) - (h / 2 - r)
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0)
  return Math.min(Math.max(dx, dy), 0) + Math.sqrt(ax * ax + ay * ay) - r
}

function plate(o) {
  const buf = Buffer.alloc(SIZE * SIZE * 4)
  const OC = hex(o.out), TOP = hex(o.top), MID = hex(o.mid), BOT = hex(o.bot)
  const UND = o.under ? hex(o.under) : null
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4
    const d = sdf(x + 0.5, y + 0.5, SIZE, SIZE, RADIUS)
    const inside = clamp01(0.5 - d)          // the whole shape, outline included
    const body = clamp01(0.5 - (d + OW))     // the body, inset by the outline width

    // Vertical piecewise: gradient only inside the 40 px top and bottom slice bands,
    // flat centre, because the mobile client tiles the nine-slice centre.
    let col
    if (y < 40) col = mix(TOP, MID, clamp01(y / 40))
    else if (y < 88) col = MID
    else col = mix(MID, BOT, clamp01((y - 88) / 40))

    /*
      The underside: a CURVE into shadow, not a painted band.

      This darkened over three pixels at y = 103, which is an edge, and an edge reads as a
      line drawn across the button rather than as a button with a thickness (owner, 1 Sep,
      against a reference sheet whose plates round softly into their base). The reference
      does it the way a lit object does: the shading gathers slowly through the lower third
      and reaches its darkest only at the very bottom edge. Smoothstep, so there is no
      visible seam where the darkening starts either.
    */
    if (UND !== null) {
      const t = clamp01((y - 88) / 38)
      col = mix(col, UND, t * t * (3 - 2 * t))
    }

    // Gloss: a translucent white band across the top, with its own inner rounding.
    if (o.gloss > 0) {
      const g = clamp01(0.5 - (d + OW + 3))
      /*
        And the highlight fades the whole way instead of holding flat and dropping off in
        eight pixels: same reasoning, the top of a rounded object catches light strongest
        at its crown and gives it up gradually.
      */
      const b = clamp01((42 - y) / 42)
      col = mix(col, [255, 255, 255], o.gloss * g * b * b * (3 - 2 * b))
    }

    // A thin rim light hugging the inner top edge.
    const rim = clamp01(1 - Math.abs(d + OW + 1.2) / 1.6) * (y < 52 ? 0.4 : 0) * (o.gloss > 0 ? 1 : 0.35)
    col = mix(col, [255, 255, 255], rim)

    // Compose the body over the outline.
    let r = OC[0], g2 = OC[1], b = OC[2]
    r += (col[0] - r) * body; g2 += (col[1] - g2) * body; b += (col[2] - b) * body
    buf[i] = Math.round(r); buf[i + 1] = Math.round(g2); buf[i + 2] = Math.round(b)
    buf[i + 3] = Math.round(clamp01(inside * (o.alpha === undefined ? 1 : o.alpha)) * 255)
  }
  return png(SIZE, SIZE, buf)
}

/*
  A disc: the same lit plate, rounded all the way.

  The thumb buttons drew themselves on the nine-slice plate. At 86 px the corner radius
  dominates and it passes for a disc; at 168 px the flat sides show and the primary button
  read as an orange square among round native controls (mobile tester's photo, 3 Sep). The
  native controls are discs, so the thumb buttons get a real one: radius = half the size,
  a smooth top-to-bottom gradient instead of the slice bands (a disc is never nine-sliced,
  it is scaled whole), same outline, same gloss, same shadowed underside.
*/
function disc(o) {
  const buf = Buffer.alloc(SIZE * SIZE * 4)
  const OC = hex(o.out), TOP = hex(o.top), MID = hex(o.mid), BOT = hex(o.bot)
  const UND = o.under ? hex(o.under) : null
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4
    const d = sdf(x + 0.5, y + 0.5, SIZE, SIZE, SIZE / 2)
    const inside = clamp01(0.5 - d)
    const body = clamp01(0.5 - (d + OW))
    const t = y / (SIZE - 1)
    let col = t < 0.5 ? mix(TOP, MID, t * 2) : mix(MID, BOT, (t - 0.5) * 2)
    if (UND !== null) {
      const u = clamp01((t - 0.66) / 0.34)
      col = mix(col, UND, u * u * (3 - 2 * u))
    }
    if (o.gloss > 0) {
      const g = clamp01(0.5 - (d + OW + 3))
      const b = clamp01((0.36 - t) / 0.36)
      col = mix(col, [255, 255, 255], o.gloss * g * b * b * (3 - 2 * b))
    }
    const rim = clamp01(1 - Math.abs(d + OW + 1.2) / 1.6) * (t < 0.42 ? 0.4 : 0)
    col = mix(col, [255, 255, 255], rim)
    let r = OC[0], g2 = OC[1], b = OC[2]
    r += (col[0] - r) * body; g2 += (col[1] - g2) * body; b += (col[2] - b) * body
    buf[i] = Math.round(r); buf[i + 1] = Math.round(g2); buf[i + 2] = Math.round(b)
    buf[i + 3] = Math.round(clamp01(inside) * 255)
  }
  return png(SIZE, SIZE, buf)
}

const SHEET = {
  // Panels and modals: deep navy, a step of light at the top, no lip.
  panel:     { out: '#0a1428', top: '#26406e', mid: '#1b3054', bot: '#152743', under: null,      gloss: 0.10, alpha: 0.97 },
  // Cards on the reel and in unlock rows: a step lighter so they read against the panel.
  card:      { out: '#0a1428', top: '#2e4c82', mid: '#223a63', bot: '#1b3054', under: null,      gloss: 0.12, alpha: 1 },
  // The sunken field a number sits in: top darker than the middle, which is what sunken is.
  inset:     { out: '#060d1c', top: '#0a1526', mid: '#0e1a31', bot: '#122038', under: null,      gloss: 0,    alpha: 0.96 },
  // Gold: the one control the eye should find first.
  primary:   { out: '#1a2f55', top: '#ffe084', mid: '#ffc63f', bot: '#f5a92c', under: '#c97f16', gloss: 0.32, alpha: 1 },
  // Blue: everything else it could press.
  secondary: { out: '#16294a', top: '#6fb1f2', mid: '#3f86d6', bot: '#2f6cc0', under: '#1d4c94', gloss: 0.30, alpha: 1 },
  // Green: a reward waiting to be claimed.
  success:   { out: '#163050', top: '#a8e86e', mid: '#6cc72e', bot: '#55ab20', under: '#3c8a16', gloss: 0.30, alpha: 1 },
  // Red: refusals, raids and anything destructive.
  danger:    { out: '#34101c', top: '#f8917e', mid: '#ef5a4b', bot: '#d84438', under: '#a12a20', gloss: 0.28, alpha: 1 },
  /*
    Off: the same plate as every other control, at a value that RECEDES.

    It was a pale grey-blue at luminance 0.137 against a panel at 0.030 and a card at 0.043,
    which is to say the one control a player cannot press was the brightest surface on the
    screen and came forward off the panel (owner, 1 Sep). Measured, not judged. The fix is
    not a different shape, which is what a first pass tried and which breaks the one rule
    that matters here: every reference system, Material and the platform guidelines alike,
    keeps a disabled control's container identical and lets VALUE carry the state. So the
    plate stays a plate and sits below the card it lies on, with barely any gloss.
  */
  disabled:  { out: '#0d1526', top: '#2a3550', mid: '#1e2942', bot: '#18223a', under: null,      gloss: 0.05, alpha: 1 }
}

fs.mkdirSync(OUT, { recursive: true })
for (const [name, opts] of Object.entries(SHEET)) {
  const file = path.join(OUT, `${name}.png`)
  fs.writeFileSync(file, plate(opts))
  console.log(`${name}.png  ${fs.statSync(file).size} B`)
}
console.log(`\nnine-slice fraction for all of them: ${(RADIUS / SIZE).toFixed(4)} on each side`)


// The thumb discs, next to the plates they are cut from.
for (const name of ['primary', 'secondary']) {
  fs.writeFileSync(path.join(OUT, `${name}-disc.png`), disc(SHEET[name]))
  console.log(`wrote ${name}-disc.png`)
}
