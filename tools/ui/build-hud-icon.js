/**
 * The glyph that goes on the client's own button.
 *
 * Decentraland lets a scene replace the picture on a native touch button with an image of
 * its own, which is the difference between a control labelled "1" and one that reads as a
 * menu without a caption. The image ships in the scene, so it is generated here rather than
 * fetched, with no dependency beyond what Node already carries.
 *
 * White on transparent: the client draws it inside its own button, and a coloured glyph
 * would fight the chrome around it.
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const SIZE = 256

/*
  L'encre courante. Blanche sur le bouton sombre du client, navy sur nos plaques.

  Ces dessins ont ete faits pour le bouton natif de Decentraland, qui est sombre: le blanc y
  etait le seul choix. Depuis le 1 Sep le HUD porte nos propres plaques, et sur l'or le blanc
  ne tient qu'a 1,57 contre 1 (mesure du 2 Sep) quand le meme trait en navy y tient a 11,12.
  Les formes ne changent pas, seule l'encre change, et les deux versions sont ecrites cote a
  cote: `icon-*` en blanc, `encre-*` en navy. `src/client/icones.ts` choisit.
*/
const BLANC = [255, 255, 255]
const NAVY = [16, 26, 43]
let ENCRE = BLANC   // two canvas pixels per unit: the phone draws at a device pixel ratio of about 1.5 (workshop #3)

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = c ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
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

/** Coverage of a rounded bar, antialiased over one pixel. */
function bar(x, y, cx, cy, halfW, halfH, r) {
  const dx = Math.max(Math.abs(x - cx) - (halfW - r), 0)
  const dy = Math.max(Math.abs(y - cy) - (halfH - r), 0)
  const d = Math.sqrt(dx * dx + dy * dy) - r
  return Math.min(1, Math.max(0, 0.5 - d))
}

/**
 * Three stacked bars, optionally with a pip: the one shape a player reads as "menu".
 *
 * The pip exists because the menu sits on one of the client's own buttons on a phone, and a
 * native button cannot carry a badge of ours. Swapping the picture is the only way to tell
 * somebody that something behind it is waiting, and it costs one more file.
 */
function menuIcon(pastille) {
  const px = Buffer.alloc(SIZE * SIZE * 4)
  const cx = SIZE / 2
  const rows = [SIZE * 0.30, SIZE * 0.5, SIZE * 0.70]
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let a = 0
      for (const cy of rows) a = Math.max(a, bar(x + 0.5, y + 0.5, cx, cy, SIZE * 0.32, SIZE * 0.045, SIZE * 0.045))
      /*
        The pip has to be RED IN THE FILE.

        This icon goes on one of the client's own touch buttons, and the client draws the
        texture as it finds it: there is no tint to apply a colour with, the same wall the
        glyph atlas hit. A white pip on a white set of bars says nothing at all, which is
        exactly what a player reported seeing. So the bars stay white and the pip is written
        red, in the one place that can carry it.

        The transparent ring around it is the cutout the badge pattern calls for: it separates
        the pip from whatever it sits on, and being a hole rather than a colour it works
        against any button the client cares to draw underneath. It also sits high and far
        right, straddling the corner, because a badge tucked inside its parent reads as part
        of the picture instead of as something attached to it.
      */
      let rouge = 0
      if (pastille) {
        const px2 = x + 0.5 - SIZE * 0.80, py2 = y + 0.5 - SIZE * 0.20
        const d = Math.hypot(px2, py2)
        a = Math.max(0, a - Math.min(1, Math.max(0, 0.5 - (d - SIZE * 0.215))))
        rouge = Math.min(1, Math.max(0, 0.5 - (d - SIZE * 0.15)))
      }
      const o = (y * SIZE + x) * 4
      const alpha = Math.min(1, Math.max(Math.max(0, a), rouge))
      const t = alpha > 0 ? rouge / alpha : 0
      px[o] = ENCRE[0]
      px[o + 1] = Math.round(ENCRE[1] * (1 - t) + 0x5c * t)
      px[o + 2] = Math.round(ENCRE[2] * (1 - t) + 0x5c * t)
      px[o + 3] = Math.round(alpha * 255)
    }
  }
  return png(SIZE, SIZE, px)
}

/** A rounded bar, free to be tilted, which is all a pistol is made of here. */
function tilted(x, y, cx, cy, halfW, halfH, r, deg) {
  const a = (deg * Math.PI) / 180
  const dx0 = x - cx, dy0 = y - cy
  const px = dx0 * Math.cos(a) + dy0 * Math.sin(a)
  const py = -dx0 * Math.sin(a) + dy0 * Math.cos(a)
  const dx = Math.max(Math.abs(px) - (halfW - r), 0)
  const dy = Math.max(Math.abs(py) - (halfH - r), 0)
  return Math.min(1, Math.max(0, 0.5 - (Math.sqrt(dx * dx + dy * dy) - r)))
}

/**
 * A pistol, and it has to survive being twenty pixels wide.
 *
 * The first attempt was a thin slide with a thin grip hung under its middle, and checked at
 * forty pixels across, where it looked fine. On the button it is nearer twenty, and there it
 * collapsed into a plain right angle: a bracket, not a weapon. What makes the silhouette
 * read at that size is not detail, it is proportion. The grip is flush with the back of the
 * slide rather than centred under it, both are heavy, and the muzzle overhangs the grip by a
 * long way. Those three relationships are what the eye recognises when everything else has
 * been thrown away by the resolution.
 */
function gunIcon(barre) {
  const px = Buffer.alloc(SIZE * SIZE * 4)
  const S = SIZE
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const fx = x + 0.5, fy = y + 0.5
      // The slide: long, and thick enough to stay solid when it is five pixels tall.
      let a = tilted(fx, fy, S * 0.53, S * 0.335, S * 0.37, S * 0.105, S * 0.02, 0)
      // The grip: flush with the back of the slide, heavy, barely raked.
      a = Math.max(a, tilted(fx, fy, S * 0.295, S * 0.615, S * 0.135, S * 0.215, S * 0.03, -8))
      let trait = 0
      if (barre) {
        // Struck through, meaning the weapon is out and this button puts it away.
        // Carved wide and drawn narrow: without the gap the stroke merges into the
        // silhouette and the whole thing turns to mush at the size of a thumb.
        const creux = tilted(fx, fy, S * 0.5, S * 0.5, S * 0.44, S * 0.095, S * 0.02, -45)
        trait = tilted(fx, fy, S * 0.5, S * 0.5, S * 0.42, S * 0.045, S * 0.02, -45)
        a = Math.max(0, a - creux)
      }
      const o = (y * S + x) * 4
      px[o] = ENCRE[0]; px[o + 1] = ENCRE[1]; px[o + 2] = ENCRE[2]
      px[o + 3] = Math.round(Math.min(1, Math.max(a, trait)) * 255)
    }
  }
  return png(S, S, px)
}

/**
 * A reticle, for the button that fires while the weapon is out.
 *
 * The complaint that started this was a player who could not work out how to shoot. The
 * trigger is the client's own interaction button, which wears a pointing hand: correct for
 * picking things up, and silent about the fact that it is also the trigger. A ring with four
 * ticks says trigger in any game ever made, and it costs nothing on screen because it
 * replaces a picture that was already there.
 */
function reticleIcon() {
  const px = Buffer.alloc(SIZE * SIZE * 4)
  const S = SIZE
  const cx = S * 0.5, cy = S * 0.5
  const R = S * 0.30, EP = S * 0.055
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const fx = x + 0.5, fy = y + 0.5
      const d = Math.abs(Math.hypot(fx - cx, fy - cy) - R) - EP
      let a = Math.min(1, Math.max(0, 0.5 - d))
      // Four ticks reaching outward, and a dot dead centre.
      a = Math.max(a, tilted(fx, fy, cx, cy, S * 0.46, EP * 0.85, EP * 0.3, 0))
      a = Math.max(a, tilted(fx, fy, cx, cy, S * 0.46, EP * 0.85, EP * 0.3, 90))
      // The ticks would cross the middle; hollow it out and leave a pip.
      const trou = Math.min(1, Math.max(0, 0.5 - (Math.hypot(fx - cx, fy - cy) - S * 0.145)))
      const pip = Math.min(1, Math.max(0, 0.5 - (Math.hypot(fx - cx, fy - cy) - S * 0.055)))
      a = Math.max(0, a - trou)
      const o = (y * S + x) * 4
      px[o] = ENCRE[0]; px[o + 1] = ENCRE[1]; px[o + 2] = ENCRE[2]
      px[o + 3] = Math.round(Math.min(1, Math.max(a, pip)) * 255)
    }
  }
  return png(S, S, px)
}

/**
 * Coins, drawn as coins: the stack that the collect button banks.
 *
 * The first version stacked three flat ellipses and lightened the inside of each one so the
 * pile would not read as a blob. Tone is the wrong tool for this. On the gold disc the
 * lightened faces let the plate show through and the glyph came out muddy, and at the size a
 * thumb sees it the interior is the first thing that disappears: "le seul qui est un peu
 * confus" (owner, 5 Sep). This repo already knew the answer and wrote it under the crate,
 * three functions below: it is the GAPS that draw, not the added lines.
 *
 * So each coin is a capsule with elliptical caps, a face and a short side, and each one knocks
 * a clear gap out of the coin under it. Three solid pieces, two clean separations, nothing to
 * read inside. The perspective is the genre's: seen from just above, which is what makes a
 * disc read as money rather than as a button.
 */
const PIECE = { rx: 0.28, ry: 0.105, cote: 0.075, jeu: 0.022 }

/** Coverage of one coin: a vertical capsule whose caps are ellipses, antialiased over a pixel. */
function piece(fx, fy, cx, cy, grossi) {
  const rx = PIECE.rx + grossi, ry = PIECE.ry + grossi
  const dy = fy < cy ? fy - cy : fy > cy + PIECE.cote ? fy - (cy + PIECE.cote) : 0
  const e = Math.hypot((fx - cx) / rx, dy / ry)
  return Math.min(1, Math.max(0, (1 - e) * SIZE * 0.09))
}

/**
 * The stack, with its top coin lifted by `envol`.
 *
 * The still picture says money; the button says COLLECT by MOVING it. `Pouce` plays a pose
 * for 220 ms, the next for 100, then holds the rest pose, so the three files read as one coin
 * dropping onto the pile, which is the act the button performs. A trail or a second coin in
 * the air was tried instead and failed its own silhouette test: at 87 px on a phone the
 * strokes vanish and the flying coin reads as a second stack (rendered and measured, 5 Sep).
 */
function collectIcon(envol = 0) {
  const px = Buffer.alloc(SIZE * SIZE * 4)
  const S = SIZE
  const hauteurs = [0.66, 0.45, 0.24 - envol]
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const fx = (x + 0.5) / S, fy = (y + 0.5) / S
      let a = 0
      for (const cy of hauteurs) {
        a = Math.max(0, a - piece(fx, fy, 0.5, cy, PIECE.jeu))
        a = Math.max(a, piece(fx, fy, 0.5, cy, 0))
      }
      const o = (y * S + x) * 4
      px[o] = ENCRE[0]; px[o + 1] = ENCRE[1]; px[o + 2] = ENCRE[2]
      px[o + 3] = Math.round(Math.min(1, a) * 255)
    }
  }
  return png(S, S, px)
}

/** A tower: a wide plinth with a body on it, which is what every base in this game is. */
/**
 * Un marteau, et non le batiment.
 *
 * L'ancien dessin montrait le RESULTAT: un immeuble sur son socle. Un bouton d'action doit
 * montrer le GESTE, et le marteau est la convention du genre pour construire (game-icons.net
 * le range sous fabrication, icons8 le nomme "build hammer"). Deux barres arrondies suffisent,
 * le manche en biais et la tete en travers de son bout: a la taille du pouce, ce qui se
 * reconnait n'est pas le detail mais la proportion, comme pour le pistolet plus haut.
 */
function buildIcon() {
  const px = Buffer.alloc(SIZE * SIZE * 4)
  const S = SIZE
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const fx = x + 0.5, fy = y + 0.5
      // Le manche, du bas gauche vers le haut droit.
      let a = tilted(fx, fy, S * 0.44, S * 0.60, S * 0.34, S * 0.058, S * 0.02, -38)
      // La tete, en travers du bout du manche.
      a = Math.max(a, tilted(fx, fy, S * 0.70, S * 0.28, S * 0.215, S * 0.105, S * 0.025, 52))
      const o = (y * S + x) * 4
      px[o] = ENCRE[0]; px[o + 1] = ENCRE[1]; px[o + 2] = ENCRE[2]
      px[o + 3] = Math.round(Math.min(1, a) * 255)
    }
  }
  return png(S, S, px)
}

/**
 * Une caisse, et non un carre barre d'une croix.
 *
 * L'ancienne etait un contour carre avec deux diagonales: de pres ce sont ses sangles, petit
 * ca ressemble a une case cochee d'un refus, et c'est le dessin le plus vu du lot puisqu'il
 * porte acheter, ouvrir et casser (proprietaire, 2 Sep). Celle-ci reprend la structure de la
 * caisse des cartes, qui est juste: un corps plein, la bande du couvercle en haut, et les
 * planches separees par des vides. Ce sont les VIDES qui dessinent, pas des traits ajoutes.
 */
function crateIcon() {
  const px = Buffer.alloc(SIZE * SIZE * 4)
  const S = SIZE
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const fx = x + 0.5, fy = y + 0.5
      // Le corps, un peu plus large que haut comme une caisse posee.
      let a = tilted(fx, fy, S * 0.5, S * 0.605, S * 0.375, S * 0.265, S * 0.035, 0)
      // Le couvercle deborde des deux cotes: c'est ce qui dit "caisse" plutot que "boite".
      a = Math.max(a, tilted(fx, fy, S * 0.5, S * 0.245, S * 0.435, S * 0.075, S * 0.028, 0))
      // Les vides: sous le couvercle, puis la croix des planches, centree sur le corps.
      const j1 = tilted(fx, fy, S * 0.5, S * 0.325, S * 0.44, S * 0.024, S * 0.01, 0)
      const j2 = tilted(fx, fy, S * 0.5, S * 0.605, S * 0.38, S * 0.026, S * 0.01, 0)
      const j3 = tilted(fx, fy, S * 0.5, S * 0.605, S * 0.026, S * 0.27, S * 0.01, 0)
      a = Math.max(0, a - Math.max(j1, Math.max(j2, j3)))
      const o = (y * S + x) * 4
      px[o] = ENCRE[0]; px[o + 1] = ENCRE[1]; px[o + 2] = ENCRE[2]
      px[o + 3] = Math.round(Math.min(1, a) * 255)
    }
  }
  return png(S, S, px)
}

/** Coverage of a triangle, which is the only honest way to draw an arrowhead. */
function triangle(x, y, ax, ay, bx, by, cx2, cy2) {
  const aire = (bx - ax) * (cy2 - ay) - (cx2 - ax) * (by - ay)
  if (aire === 0) return 0
  const u = ((bx - x) * (cy2 - y) - (cx2 - x) * (by - y)) / aire
  const v = ((cx2 - x) * (ay - y) - (ax - x) * (cy2 - y)) / aire
  const w = 1 - u - v
  return u >= 0 && v >= 0 && w >= 0 ? 1 : 0
}

/**
 * A ring open at the top with an arrowhead on the opening: take it back.
 *
 * A first version built the head out of two crossed bars and it merged into the ring, which
 * left a circle with a dent in it. At this size a head is a triangle or it is nothing.
 */
function recoverIcon() {
  const px = Buffer.alloc(SIZE * SIZE * 4)
  const S = SIZE
  const cx = S * 0.5, cy = S * 0.54, R = S * 0.29, EP = S * 0.075
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const fx = x + 0.5, fy = y + 0.5
      const dx = fx - cx, dy = fy - cy
      let a = Math.min(1, Math.max(0, 0.5 - (Math.abs(Math.hypot(dx, dy) - R) - EP)))
      // Cut the ring open across the top right quadrant, cleanly.
      if (dx > S * 0.02 && dy < -S * 0.02) a = 0
      // And put the head in the opening, pointing back the way the ring goes.
      a = Math.max(a, triangle(fx, fy,
        cx + R * 0.10, cy - R * 1.42,
        cx + R * 0.10, cy - R * 0.58,
        cx + R * 0.98, cy - R * 1.00))
      const o = (y * S + x) * 4
      px[o] = ENCRE[0]; px[o + 1] = ENCRE[1]; px[o + 2] = ENCRE[2]
      px[o + 3] = Math.round(Math.min(1, a) * 255)
    }
  }
  return png(S, S, px)
}

/**
 * The three things you can do with something in your hands, told apart twice over.
 *
 * They were left as words because three variations on an arrow blur at the size of a thumb,
 * and losing an item by pressing DROP instead of PUT IT DOWN is an expensive mistake. That
 * was the right worry and the wrong conclusion: what separates them is not the arrow, it is
 * the DIRECTION plus whether anything is waiting underneath. Down onto a shelf, right onto a
 * shelf, down into nothing. Two independent differences instead of one, which is what makes
 * them safe to recognise rather than merely different.
 */
function flecheIcon(sens, avecSocle) {
  const px = Buffer.alloc(SIZE * SIZE * 4)
  const S = SIZE
  const bas = sens === 'bas'
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const fx = x + 0.5, fy = y + 0.5
      // The shaft, then the head, laid out along whichever axis the arrow travels.
      let a = bas
        ? tilted(fx, fy, S * 0.5, S * 0.34, S * 0.08, S * 0.20, S * 0.02, 0)
        : tilted(fx, fy, S * 0.34, S * 0.5, S * 0.20, S * 0.08, S * 0.02, 0)
      a = Math.max(a, bas
        ? triangle(fx, fy, S * 0.22, S * 0.52, S * 0.78, S * 0.52, S * 0.5, S * 0.80)
        : triangle(fx, fy, S * 0.52, S * 0.22, S * 0.52, S * 0.78, S * 0.80, S * 0.5))
      if (avecSocle) {
        a = Math.max(a, bas
          ? tilted(fx, fy, S * 0.5, S * 0.90, S * 0.34, S * 0.055, S * 0.02, 0)
          : tilted(fx, fy, S * 0.90, S * 0.5, S * 0.055, S * 0.34, S * 0.02, 0))
      }
      const o = (y * S + x) * 4
      px[o] = ENCRE[0]; px[o + 1] = ENCRE[1]; px[o + 2] = ENCRE[2]
      px[o + 3] = Math.round(Math.min(1, a) * 255)
    }
  }
  return png(S, S, px)
}


/**
 * Les six verbes qui n'avaient aucune icone, dans la meme encre blanche que les autres.
 *
 * Le repli etait `icon-collect`, les trois pieces: RAMASSER, VOLER, MONTER, FUSER, NOURRIR et
 * SURENCHERIR affichaient donc tous une pile de monnaie, y compris pour monter d'un etage
 * (proprietaire, 2 Sep). Meme grammaire que le reste de la famille: du plein blanc, des vides
 * pour separer, et une silhouette qui ne ressemble a aucune de ses voisines puisqu'elles
 * s'echangent sur le meme bouton et ne se comparent jamais cote a cote.
 */
function verbeIcon(nom) {
  const px = Buffer.alloc(SIZE * SIZE * 4)
  const S = SIZE
  const cx = S * 0.5
  const cercle = (fx, fy, x0, y0, r, ep) => {
    const d = Math.abs(Math.hypot(fx - x0, fy - y0) - r) - ep
    return Math.min(1, Math.max(0, 0.5 - d))
  }
  const disque = (fx, fy, x0, y0, r) => Math.min(1, Math.max(0, 0.5 - (Math.hypot(fx - x0, fy - y0) - r)))
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const fx = x + 0.5, fy = y + 0.5
      let a = 0
      if (nom === 'pickup') {
        // Ramasser: la piece se souleve de sa tablette.
        a = tilted(fx, fy, cx, S * 0.855, S * 0.33, S * 0.045, S * 0.02, 0)
        a = Math.max(a, tilted(fx, fy, cx, S * 0.615, S * 0.135, S * 0.115, S * 0.025, 0))
        a = Math.max(a, tilted(fx, fy, cx, S * 0.30, S * 0.055, S * 0.115, S * 0.02, 0))
        a = Math.max(a, triangle(fx, fy, cx, S * 0.10, S * 0.315, S * 0.29, S * 0.685, S * 0.29))
      } else if (nom === 'steal') {
        // Voler: deux pointes se referment sur la piece de quelqu'un d'autre.
        a = tilted(fx, fy, cx, S * 0.5, S * 0.145, S * 0.145, S * 0.03, 0)
        a = Math.max(a, triangle(fx, fy, S * 0.045, S * 0.245, S * 0.30, S * 0.5, S * 0.045, S * 0.755))
        a = Math.max(a, triangle(fx, fy, S * 0.955, S * 0.245, S * 0.70, S * 0.5, S * 0.955, S * 0.755))
      } else if (nom === 'up') {
        // Monter: entre deux planchers.
        a = tilted(fx, fy, cx, S * 0.90, S * 0.35, S * 0.045, S * 0.02, 0)
        a = Math.max(a, tilted(fx, fy, cx, S * 0.10, S * 0.35, S * 0.045, S * 0.02, 0))
        a = Math.max(a, tilted(fx, fy, cx, S * 0.63, S * 0.075, S * 0.13, S * 0.02, 0))
        a = Math.max(a, triangle(fx, fy, cx, S * 0.26, S * 0.29, S * 0.50, S * 0.71, S * 0.50))
      } else if (nom === 'fuse') {
        // Fusionner: trois deviennent un.
        for (const ang of [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6]) {
          a = Math.max(a, cercle(fx, fy, cx + Math.cos(ang) * S * 0.245, S * 0.5 - Math.sin(ang) * S * 0.245, S * 0.145, S * 0.05))
        }
        a = Math.max(a, disque(fx, fy, cx, S * 0.5, S * 0.085))
      } else {
        // Surencherir: on met PLUS, donc la fleche monte AU-DESSUS des pieces. Posees a cote
        // elles se lisaient comme un signe egal, ce qui dit exactement le contraire.
        a = tilted(fx, fy, cx, S * 0.375, S * 0.075, S * 0.19, S * 0.02, 0)
        a = Math.max(a, triangle(fx, fy, cx, S * 0.075, S * 0.255, S * 0.35, S * 0.745, S * 0.35))
        for (const cy2 of [S * 0.715, S * 0.865]) {
          a = Math.max(a, tilted(fx, fy, cx, cy2, S * 0.245, S * 0.058, S * 0.055, 0))
        }
      }
      const o = (y * S + x) * 4
      px[o] = ENCRE[0]; px[o + 1] = ENCRE[1]; px[o + 2] = ENCRE[2]
      px[o + 3] = Math.round(Math.min(1, a) * 255)
    }
  }
  return png(S, S, px)
}

const dossier = path.resolve(__dirname, '../../assets/ui')
/*
  La famille blanche: un aplat sur transparent, pose sur les plaques du HUD.

  Une seconde famille en couleur a contour sombre existe dans `build-toy-icons.py`, prefixee
  `act-`, nee de la mesure du 2 Sep: sur la plaque OR le blanc ne tient qu'a 1,57 contre 1
  quand ce depot s'impose un plancher de 3 dans `theme.ts`. Le proprietaire prefere celle-ci,
  qui est la direction artistique du jeu; les deux restent dans le depot et `src/client/icones.ts`
  choisit laquelle le bouton porte, en un mot.
*/
const VERBES = [
  ['fire', () => reticleIcon()],
  ['collect', () => collectIcon()],
  ['crate', () => crateIcon()],
  ['recover', () => recoverIcon()],
  ['place', () => flecheIcon('bas', true)],
  ['give', () => flecheIcon('droite', true)],
  ['drop', () => flecheIcon('bas', false)],
  ['pickup', () => verbeIcon('pickup')],
  ['steal', () => verbeIcon('steal')],
  ['up', () => verbeIcon('up')],
  ['fuse', () => verbeIcon('fuse')],
  ['outbid', () => verbeIcon('outbid')]
]

/**
 * The close cross: two bars at forty-five degrees, centred by construction.
 *
 * The dialogs closed on a text "X" set through the bitmap font, and on a phone the glyph
 * sat off the middle of its plate (owner, 3 Sep). A drawn cross has no baseline, no side
 * bearing and no advance: it is symmetric about the centre of its own image, so centring
 * the image centres the cross.
 */
function closeIcon() {
  const px = Buffer.alloc(SIZE * SIZE * 4)
  const S = SIZE
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const fx = x + 0.5, fy = y + 0.5
      let a = tilted(fx, fy, S * 0.5, S * 0.5, S * 0.30, S * 0.06, S * 0.05, 45)
      a = Math.max(a, tilted(fx, fy, S * 0.5, S * 0.5, S * 0.30, S * 0.06, S * 0.05, -45))
      const o = (y * S + x) * 4
      px[o] = ENCRE[0]; px[o + 1] = ENCRE[1]; px[o + 2] = ENCRE[2]
      px[o + 3] = Math.round(Math.min(1, a) * 255)
    }
  }
  return png(S, S, px)
}

const fichiers = []
// Les satellites restent blancs quoi qu'il arrive: ils sont sur la plaque BLEUE, ou le blanc
// mesure 3,76 contre 1, au-dessus du plancher de 3 que ce depot s'impose dans theme.ts.
ENCRE = BLANC
fichiers.push(['icon-menu.png', menuIcon(false)])
fichiers.push(['icon-menu-alert.png', menuIcon(true)])
fichiers.push(['icon-gun.png', gunIcon(false)])
fichiers.push(['icon-holster.png', gunIcon(true)])
fichiers.push(['ui-close.png', closeIcon()])
// Les verbes du bouton contextuel, dans les deux encres. Le marteau de BUILD n'est pas ici:
// The BUILD glyph is not drawn here: see tools/ui/build-mallet-icon.py.
for (const [nom, dessin] of VERBES) {
  ENCRE = BLANC
  fichiers.push([`icon-${nom}.png`, dessin()])
  ENCRE = NAVY
  fichiers.push([`encre-${nom}.png`, dessin()])
}
// The coin drop, two poses beside the rest pose already written above.
for (const [pose, envol] of [['raised', 0.17], ['mid', 0.07]]) {
  ENCRE = BLANC
  fichiers.push([`icon-collect-${pose}.png`, collectIcon(envol)])
  ENCRE = NAVY
  fichiers.push([`encre-collect-${pose}.png`, collectIcon(envol)])
}

/*
  With no argument this writes the whole set, which is how it has always run. With one or more
  arguments it writes only the files whose name contains one of them: `node build-hud-icon.js
  collect` touches the four collect pictures and leaves everything else alone. That matters
  because three of the names here are also written by newer tools (`build-mallet-icon.py` for
  the hammer, `build-weapon-icons.py` for the gun and the holster), and a full run would put
  the old drawings back over them.
*/
const filtres = process.argv.slice(2)
for (const [nom, buf] of fichiers) {
  if (filtres.length > 0 && !filtres.some((f) => nom.includes(f))) continue
  fs.writeFileSync(path.join(dossier, nom), buf)
  console.log('wrote assets/ui/' + nom, buf.length + ' B')
}
