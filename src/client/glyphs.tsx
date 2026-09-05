import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { ATLAS, ADVANCE, FONT_FILES } from './font-metrics'
import { C } from './theme'

/**
 * Text in a typeface the platform does not have.
 *
 * Decentraland exposes three fonts and no more, in the interface and in the world alike:
 * F_SANS_SERIF, F_SERIF and F_MONOSPACE, a closed enum in the protocol with no font asset
 * and no file field. A scene cannot ship a typeface the ordinary way. It can ship a
 * texture, though, and `uiBackground` takes a `uvs` rectangle, so a string is drawn as one
 * small quad per letter, each quad showing its own cell of one atlas image.
 *
 * The cost is one element per character, so this is for the handful of strings that carry
 * the game's face, the title and the money, and not for prose. Everything else stays on
 * the platform font, which is perfectly readable at the sizes the type scale sets.
 *
 * WHERE THIS FACE IS USED, AND WHY NOT EVERYWHERE (owner's question, 5 Sep).
 *
 * The rule: this face carries VALUE AND IDENTITY in short strings, the platform font carries
 * everything the player has to READ. Money, a rung's name, a panel's title, a base's sign, the
 * word on the ground where you are about to build. Not: rows in a list, prices in a table,
 * refusals, anything a player types, anything with a sentence in it.
 *
 * Three reasons, and the first one is not a preference:
 *
 *   IT CANNOT. The atlas holds fifty signs, the digits, A to Z, a little punctuation and
 *   exactly one lowercase letter, the `x` of a multiplier. No accents. `Glyphs` upper-cases
 *   what it is given, so a player's name, an item's description or the middle dot in
 *   "Legendary · 1.9K/s" either shout or simply do not draw.
 *
 *   IT COSTS. One UI element per letter. The interface holds sixty-three Labels; the same text
 *   in this face would be around seven hundred and fifty elements, on a scene tick already
 *   measured at 31 to 34 ms against a 30 ms target.
 *
 *   IT WOULD FLATTEN THE HIERARCHY. A type system works by contrast of roles: one display face
 *   for the moments that matter, one neutral face for the information. Set everything in an
 *   ExtraBold display face and nothing stands out any more, which is the opposite of what a
 *   money counter is for. And the legibility literature has been consistent since Tinker that
 *   all capitals are read more slowly than mixed case, which is fine for two words and wrong
 *   for a line a player has to parse.
 *
 * There is one atlas per colour, and that is not a choice.
 *
 * The obvious build is a white atlas tinted at render time by `uiBackground.color`, and it is
 * what this file did. On a real handset the tint never arrives: a photograph of the running
 * game shows the platform's own Labels rendering their amber and their grey exactly as asked,
 * while every glyph of ours comes out the colour of the file whatever colour it was given.
 * White before a gradient was baked in, grey after, which is what a player saw and reported.
 *
 * So the colour lives in the file. The shapes are identical across the set and PNG compresses
 * a flat hue to nearly nothing, so six files cost 412 KB against a bundle of seven megabytes.
 * A role is asked for by name, which is also a better interface than a raw colour: it is the
 * palette's meaning rather than one of its values.
 */

const CELL = 1 / ATLAS.cols
const ROW = 1 / ATLAS.rows
/** Extra air between letters, as a fraction of the size. The face is heavy; it needs some. */
const TRACKING = 0.02

/**
 * Half a texel of margin, taken off every side of the cell.
 *
 * A cell's edge is also its neighbour's edge, and sampling exactly on that line lets the
 * filter mix in the glyph next door: the bottoms of the row above appeared as fragments
 * floating over the title. Pulling the rectangle inside its own cell removes the seam.
 * The atlas is 1024 pixels across eight cells, so a texel is one part in 1024.
 */
const BLEED = 1.5 / 1024

function uvsFor(index: number): number[] {
  const col = index % ATLAS.cols
  const row = Math.floor(index / ATLAS.cols)
  const u0 = col * CELL + BLEED
  const u1 = col * CELL + CELL - BLEED
  // Image rows run down from the top while v runs up from the bottom, so the row is flipped.
  const v1 = 1 - row * ROW - BLEED
  const v0 = 1 - (row + 1) * ROW + BLEED
  return [u0, v0, u0, v1, u1, v1, u1, v0]
}

export function glyphWidth(value: string, size: number): number {
  let w = 0
  for (const ch of value.toUpperCase()) {
    w += ((ADVANCE[ch] ?? 0.5) + TRACKING) * size
  }
  return w
}

/**
 * A dark copy behind the letters, so a number can live without a plate under it.
 *
 * The counter used to sit on an opaque panel, which is a lot of a phone screen spent on
 * making six characters readable. Taking the panel away puts them straight over the game,
 * where the background is a bright sky as often as a dark floor, and a single colour cannot
 * survive both. An offset dark copy does what an outline would if the interface had one: it
 * costs one more element per character and no screen at all.
 */
export type Role = 'money' | 'bonus' | 'name' | 'danger' | 'ink'

/** Offset in proportion to the letters, so one number does not wear another's shadow. */
const decalage = (size: number): number => Math.min(5, Math.max(2, Math.round(size * 0.055)))

export const Glyphs = (props: {
  value: string
  size: number
  role?: Role
  align?: 'left' | 'center' | 'right'
  box?: number
  top?: number
  shadow?: boolean
}) => {
  const text = props.value.toUpperCase()
  const size = props.size
  const total = glyphWidth(text, size)
  const box = props.box ?? total
  const align = props.align ?? 'left'
  const start = align === 'center' ? (box - total) / 2 : align === 'right' ? box - total : 0

  const couche = (fichier: keyof typeof FONT_FILES, dx: number, dy: number, cle: string) => {
    let x = start
    const out = []
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      const idx = ATLAS.glyphs.indexOf(ch)
      const adv = (ADVANCE[ch] ?? 0.5) + TRACKING
      if (idx >= 0 && ch !== ' ') {
        out.push(
          <UiEntity key={`${cle}${i}`}
            uiTransform={{
              width: size, height: size, positionType: 'absolute',
              position: { left: x - (size - ADVANCE[ch] * size) / 2 + dx, top: dy }
            }}
            uiBackground={{
              texture: { src: `assets/ui/${FONT_FILES[fichier]}` },
              textureMode: 'stretch',
              uvs: uvsFor(idx)
            }} />
        )
      }
      x += adv * size
    }
    return out
  }

  const role = props.role ?? 'name'
  const parts = props.shadow === true
    ? [...couche('shadow', decalage(size), decalage(size), 's'), ...couche(role, 0, 0, 'g')]
    : couche(role, 0, 0, 'g')

  return (
    <UiEntity
      uiTransform={{
        width: box, height: size, positionType: 'absolute',
        position: { left: 0, top: props.top ?? 0 }
      }}
    >
      {parts}
    </UiEntity>
  )
}
