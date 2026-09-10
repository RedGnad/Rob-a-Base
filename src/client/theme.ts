import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

/**
 * The interface tokens, and the arithmetic behind them.
 *
 * Sizes are in virtual pixels. The renderer declares 1920x1080, but Decentraland overrides
 * a 16:9 request to 1600x720 on a phone, and the scale factor is min(canvasW / virtualW,
 * canvasH / virtualH). On a handset in landscape, near 844x390 logical, that is
 * min(844/1600, 390/720) = 0.5275. So a virtual size renders at roughly half its number in
 * points, and the scale below is derived from the point size wanted at the far end:
 *
 *   BODY 32  ->  17 pt, the size Apple treats as body text
 *   CAPTION 21 -> 11 pt, the floor under which text stops being readable
 *
 * Nothing in the interface is allowed below CAPTION. Measured before this file existed,
 * 43 of the 47 labels in the game sat under that floor and the median landed at 7 pt.
 */
/**
 * Two families, and which one a string belongs to.
 *
 * DISPLAY is the atlas in src/client/glyphs.tsx, a rounded heavy face the platform does
 * not carry. It takes anything short that is recognised rather than read: the money, panel
 * titles, control labels, a headline figure in a decision panel.
 *
 * BODY is the platform's own 'sans-serif'. It takes every sentence: hints, help, item
 * descriptions, tutorial lines.
 *
 * The split is the standard one, a characterful display face for branding against a clean
 * neutral sans for copy so the two do not compete, and two families is the ceiling: a
 * third only earns its place if it is functional. It is also where the costs agree, since
 * the atlas spends one element per character, which is nothing over a dozen short labels
 * and unreasonable over a paragraph.
 *
 * The sizes below serve both.
 */
export const TYPE = {
  /*
    The coin counter, and nothing else.

    Sized against the rule of thumb the HUD guides give for readouts, body text at about
    twenty-eight pixels for a 1080p screen; ours is thirty-two, and a primary readout sits at
    two to two and a half times that. Seventy-two is 2.25x. It was fifty-two because it had to
    share a plate with a second line; with the plate gone the number is free to be the size it
    should have been. On a phone the virtual screen is 720 tall rather than 1080, so the same
    figure reads half again as large there, which is the right way round for the one number
    the whole game is about.
  */
  hero: 72,
  title: 42,    // 22 pt: modal titles, the reveal
  body: 32,     // 17 pt: buttons and anything the player must read while moving
  label: 26,    // 14 pt: secondary lines inside a panel
  caption: 21   // 11 pt: hints, the floor
} as const

/**
 * Colour carries meaning, and the same meaning everywhere.
 *
 * Five roles, no decorative exceptions: money is gold, the thing to press is green, a
 * warning is orange, a name is white, and anything destructive or refused is red. A player
 * who learns the code once reads any new panel without being taught it.
 *
 * Money is gold, at last. It was green for one measured reason: bare gold over a bright sky
 * at speed is glare. That objection died the day the atlas baked a dark navy contour around
 * every glyph (28 Aug), which is the exact device the reference GUI sheets use to put white
 * on gold and gold on sky; the counter now matches the coin lying on the ground. The warning
 * hue stays on the orange, which still differs from both.
 */
export const HUE = {
  money: '#ffd24a',
  bonus: '#ff8a3d',
  name: '#ffffff',
  danger: '#ffa3a3',
  dim: '#b4bcc6'
} as const

/**
 * Lift a colour until it can be read as text on our dark panels.
 *
 * Rarity and mutation colours are chosen to say what a thing IS: Cursed is a deep violet,
 * Blood is a dark red, Galaxy is a dark purple. Printed as words on a panel that is nearly
 * black they measure 1.21, 1.94 and 2.02 to one against it, which is to say a player looking
 * for the seventh day of their login streak finds an empty space. The other colours pass
 * comfortably, so the fault is not the palette, it is using an identity colour as a legibility
 * colour without checking.
 *
 * Three to one is the floor WCAG sets for large text and for graphics; below it the colour is
 * blended towards white until it reaches it, which keeps the hue recognisable rather than
 * replacing it with a safe one. A colour that already passes is returned untouched.
 */
/*
  The ground the text sits on: the centre of panel.png, (27, 48, 84), relative luminance
  0.0299. The old figure, 0.0041, was a near-black plate that no panel has worn for weeks,
  so `lisible` passed dark hues that vanish on navy: the Cursed purple (#3b0a45) read as
  "dark on dark" everywhere it named itself (owner, 4 Sep). 4.5:1 is WCAG AA for text at
  the caption size a phone shows; the hue survives the blend, the reading no longer fails.
*/
const PANNEAU_L = 0.0299
const CONTRASTE_MIN = 4.5

function lineaire(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * lineaire(r) + 0.7152 * lineaire(g) + 0.0722 * lineaire(b)
}

/*
  Memoised, because this is a pure function called per cell per frame.

  The collection grid asks it for every one of its ninety-eight squares, and the answer walks
  up to twenty blend steps computing a relative luminance at each one, so an open index was
  paying a couple of thousand of them sixty times a second for a set of colours that is fixed
  at compile time. Same input, same answer, for ever.
*/
const lisibleCache = new Map<string, string>()

export function lisible(hex: string): string {
  const cache = lisibleCache.get(hex)
  if (cache !== undefined) return cache
  const valeur = calculerLisible(hex)
  lisibleCache.set(hex, valeur)
  return valeur
}

function calculerLisible(hex: string): string {
  const h = hex.startsWith('#') ? hex.slice(1) : hex
  if (h.length < 6) return '#ffffff'
  let r = parseInt(h.slice(0, 2), 16)
  let g = parseInt(h.slice(2, 4), 16)
  let b = parseInt(h.slice(4, 6), 16)
  const assez = (rr: number, gg: number, bb: number): boolean =>
    (luminance(rr, gg, bb) + 0.05) / (PANNEAU_L + 0.05) >= CONTRASTE_MIN
  if (assez(r, g, b)) return `#${h.slice(0, 6)}`
  // Blend towards white in small steps: the hue survives, the reading becomes possible.
  for (let k = 1; k <= 20; k++) {
    const t = k / 20
    const rr = Math.round(r + (255 - r) * t)
    const gg = Math.round(g + (255 - g) * t)
    const bb = Math.round(b + (255 - b) * t)
    if (assez(rr, gg, bb)) { r = rr; g = gg; b = bb; break }
  }
  const deux = (v: number): string => v.toString(16).padStart(2, '0')
  return `#${deux(r)}${deux(g)}${deux(b)}`
}

/*
  Two of the five were failing the contrast floor at the sizes they are used at, measured.

  Google's Playables certification is blunt: text under 18 pt needs 4.5:1, everything else 3:1.
  Our `label` (14 pt) and `caption` (11 pt) are under 18. Against the inset plate on a mid-grey
  sky, `danger` at #ff5c5c measured 2.87:1 and `dim` at #9aa3ad measured 3.40:1, and `dim` is
  the colour of every secondary line in every panel. Lifted to the first value of each hue that
  clears 4.5 on both the plate and the inset: danger #ffa3a3 (4.57), dim #b4bcc6 (4.54). The
  hue survives; the reading becomes possible for the sizes the rule is about.
*/
export const C = {
  money: Color4.fromHexString(HUE.money + 'ff'),
  bonus: Color4.fromHexString(HUE.bonus + 'ff'),
  name: Color4.fromHexString(HUE.name + 'ff'),
  danger: Color4.fromHexString(HUE.danger + 'ff'),
  dim: Color4.fromHexString(HUE.dim + 'ff'),
  /** Label colour for a control on a light plate: the default pink vanishes on green. */
  ink: Color4.fromHexString('#12305cff'),
  plate: Color4.create(0, 0, 0, 0.62),
  inset: Color4.create(0, 0, 0, 0.45)
}

/**
 * Touch geometry. 44 pt is the floor Apple, Material and WCAG 2.5.5 all land on, and 8 pt
 * is the smallest gap that stops one thumb hitting two things. Divided by the 0.5275 above,
 * that is 84 and 16 virtual pixels; both are rounded up.
 */
/**
 * The corner radii, all of them.
 *
 * Cards were 14, chips 12, bars and bands square, and a photograph of the menu showed the
 * mismatch plainly (owner, 1 Sep). Consistency is the cheapest of the five UI principles
 * and the most visible when it is missing: one radius for surfaces, one for the bars
 * inside them.
 */
export const RAD = { card: 14, bar: 10 } as const

/**
 * How wide a line of platform text runs, and how many lines a box will really need.
 *
 * Boxes were sized from the newlines in a string, and the renderer wraps: a raid
 * announcement of seventy characters was measured as one line and drawn as three, out
 * through the bottom of its own plate. Measured, not guessed: five of the nine spontaneous
 * messages in the game overflowed their frames, the worst by three hundred and sixty
 * pixels (1 Sep). The factor is the average advance of the platform face at these sizes,
 * checked against the strings the game actually shows; it is an estimate, so callers keep
 * a little air, but it is an estimate that is never off by a factor of three.
 */
/**
 * How long a toast stays, by what it says. Three classes, and no other number anywhere.
 *
 * Every platform that ships a toast fixes its life system-wide and short: Android draws
 * one for 2 s or 3.5 s, Material's snackbar for 1.5 s or 2.75 s and never two at once,
 * Canva's guidelines default to 5 s and forbid more than 10. Ours defaulted to 6 s and ran
 * to 9, on a plate half the width of a phone, in the third of the screen where the game is
 * played: "they take too much room and stay too long" (mobile tester, 3 Sep).
 *
 * The line between the first two is NOT how bad the news is, it is WHO STARTED IT, and that
 * distinction is the whole reason a refusal can be short. A player who has just pressed
 * something is already looking at the interface waiting for the answer, so the plate only has
 * to be read; a player who is shot, frozen or outbid was looking at the world, and has to
 * NOTICE the plate before reading a word of it. That noticing is the only thing 4 s buys, and
 * it is worth nothing to the player who asked the question.
 *
 * The measurement that settled it (7 Sep): our toasts run 6 words median and 9 at the longest,
 * which is 1.5 s to 2.3 s of reading at 238 wpm (Brysbaert 2019, 190 studies, silent reading of
 * English non-fiction). So 4 s was more than double the reading time for a class where half the
 * entries had no noticing to pay for. It also costs something real: the stack holds TWO plates,
 * so a refusal squatting a slot for 4 s can push out a fresher line mid-fight.
 *
 *   result   the player pressed something and this is the answer, refusals included: fused,
 *            delivered, bought, base full, not enough coins, steal failed. They are already
 *            looking. Read in passing.
 *   warning  done TO the player, unasked, and it asks for a reaction: shot, frozen, outbid,
 *            sentry triggered, pushed out. Pays for the noticing, then reads twice.
 *   event    rare and worth a beat: a boss slain, a prestige, your best item stolen. The
 *            ceiling; nothing lives longer.
 *
 * Sums never ride a toast: a quantity is the floating number's job, and a figure repeated
 * in words under it is the duplicate the tester saw.
 */
export const TOAST = { result: 2500, warning: 4000, event: 6000 } as const

/*
  How wide the client sets a string, estimated by character CLASS.

  One average advance (0.52 em) for every character is what made LOCKED wrap inside an
  80 px box and long toasts spill out of plates sized for fewer lines (owner, 3 Sep): the
  interface is mostly capitals, and capitals are half again as wide as the average. Measured
  on desktop screenshots against the 1920 reference: WHERE TO at 32 px = 168 px (0.71 em per
  capital), LOGIN STREAK at 26 px = 189 px (0.64), "Bring 6 items home to your base" at
  32 px = 397 px (0.40 per lowercase letter). Still an estimate, since the client reports no
  text metrics; err on the wide side, a plate a little roomy beats a word cut off.
*/
const ADVANCE = { upper: 0.68, lower: 0.44, digit: 0.58, space: 0.26, other: 0.36 }
/*
  THE PHONE IS MEASURED FROM ITS OWN FONT FILE, and the screenshots only check the factor.

  The table above was read off Unity desktop screenshots. The mobile client is another engine
  with another typeface, and the two differ per glyph class, not by a scalar: on the testers'
  screenshots of 9 Sep, capitals and digits came out NARROWER than the desktop table ("FREE
  BOX IN 5:20" at 21 px: 166 units for 189 estimated) while lowercase came out WIDER ("Open
  your box" at 32 px: 220 for 179). The single 1.22 factor of build cc0b, fitted on the
  lowercase titles, made every capital timer plate a third wider than it needs (owner, 9 Sep:
  "space to the right of the text"), and a per-class table fitted on eight strings was still
  16 % short on the digit-heavy band line.

  So the width comes from the source. The mobile client is open: `godot/assets/themes/
  theme.tres` in decentraland/godot-explorer sets `default_font` to `Inter-Regular.ttf`, the
  font its scene UI labels measure text with (`scene_ui.rs`, `get_theme_font("font")`). The
  table below is that file's advance width for every printable ASCII glyph, in thousandths of
  an em, read from its hmtx table. Checked against nine strings on three testers' screenshots
  (clients 1.12.1 and 1.14.0): measured ink over advance sum runs 0.94 to 1.05, mean 0.97, on
  timers, titles, hints and the band line alike; the ink of a line is a little short of its
  advances because the first and last glyphs carry side bearings. That mean is the one
  factor left, and each new screenshot with a known string re-checks it:
  `tools/ui/measure-mobile-text.py`.
*/
const INTER_ADVANCE = [
  281, 278, 403, 631, 638, 812, 639, 222, 362, 362, 500, 659, 280, 460, 276, 357, 625, 464, 605,
  636, 642, 608, 624, 571, 616, 624, 276, 280, 659, 659, 659, 507, 936, 676, 651, 727, 719, 598,
  587, 743, 740, 264, 543, 652, 562, 889, 753, 761, 635, 761, 639, 638, 642, 741, 676, 949, 642,
  665, 625, 362, 357, 362, 469, 452, 497, 564, 621, 558, 621, 582, 361, 609, 591, 237, 237, 544,
  237, 869, 585, 597, 609, 609, 372, 523, 364, 581, 557, 812, 540, 557, 541, 362, 327, 362, 659
]
const INTER_INK = 0.97
let onPhone: boolean | null = null
export function largeurTexte(t: string, taille: number): number {
  // The forced phone layout forces the phone's text width too, or the desktop check lies.
  if (onPhone === null) onPhone = isMobile() || FORCE_MOBILE_LAYOUT
  let em = 0
  if (onPhone) {
    for (const ch of t) {
      const k = ch.charCodeAt(0) - 32
      em += (k >= 0 && k < INTER_ADVANCE.length ? INTER_ADVANCE[k] : 600) / 1000
    }
    return Math.round(em * taille * INTER_INK)
  }
  for (const ch of t) {
    if (ch === ' ') em += ADVANCE.space
    else if (ch >= '0' && ch <= '9') em += ADVANCE.digit
    else if (ch >= 'A' && ch <= 'Z') em += ADVANCE.upper
    else if (ch >= 'a' && ch <= 'z') em += ADVANCE.lower
    else em += ADVANCE.other
  }
  return Math.round(em * taille)
}
/** Lines after wrapping, counting the newlines already in the string. */
export function lignesDeTexte(t: string, taille: number, largeur: number): number {
  let n = 0
  for (const ligne of t.split('\n')) n += Math.max(1, Math.ceil(largeurTexte(ligne, taille) / Math.max(1, largeur)))
  return n
}

/**
 * The tap sizes, and the one that was missing.
 *
 * THE RULE, so this is never a judgement call again:
 *   `height` (96)  a control ALONE IN ITS BAND: the bottom bar, the navigation tabs, the
 *                  main action of a dialog. It owns its line, so it takes the full size.
 *   `menu` (80)    a control SHARING A ROW WITH CONTENT: a list row where text, a price or
 *                  a counter sits beside it. It competes for the line, so it steps down.
 *   `rangee` (100) the row that holds a `menu` control, air included.
 *
 * It exists because the world size does not fit a list: an 84-tall row was being handed a
 * 96-tall control, which was invisible while the control was a lifted plate and obvious the
 * moment it lost its gloss, bleeding above and below its own card (owner, 1 Sep). Applying
 * it to the goals and the shop and forgetting the collection and the fusion is what the
 * owner caught next, so the rule above is written down rather than remembered.
 */
export const TAP = { height: 96, gap: 20, phone: 120, menu: 80, rangee: 100 } as const   // phone: 63 pt, what the tester's thumb asked for (28 Aug)

/**
 * Draw the interface as a phone would, while sitting at a desk.
 *
 * Decentraland overrides a 16:9 virtual screen to 1600x720 on a handset and insets the
 * interface out of the client's own furniture, and those two facts are what set every
 * size in this file. Flipping this to true applies both on the desktop preview, so the
 * layout a phone gets can be looked at without one.
 *
 * It tests the layout and nothing else: not touch, not framerate, not the native mobile
 * HUD, not the mobile client at all. Those still need a device or an emulator. Ship it
 * false.
 */
export const FORCE_MOBILE_LAYOUT = false
/*
  A stress state for the interface, reviewed from a desktop window.

  The owner reviews the phone layout without a phone (10 Sep), and the states that collide
  cannot be summoned on demand: two toasts, the corner column at its fullest, the SELL
  button, all at once. `'rush'` holds them on screen with the rush chip in the column,
  `'raid'` with the raid countdown instead (the two never share the column); `'timeline'`
  plays the five checks of memo 570 one after the other, logging `[PROBE] phase n`. Pair it with
  FORCE_MOBILE_LAYOUT. Applied by `applyUiProbe` at the top of every HUD render, after the
  systems wrote their views. A compile-time constant, committed off: production never sees it.
*/
export const UI_PROBE: '' | 'rush' | 'raid' | 'timeline' = ''

/**
 * The skins, and why they exist at all.
 *
 * Decentraland offers three fonts and no more: 'sans-serif', 'serif' and 'monospace' in
 * the interface, the same three in the world. Both are closed enums, so the rounded
 * display face those reference games lean on is simply not available here. What the
 * platform does give is a nine-sliced background image, and that is where the rounded
 * corners, the border, the gradient and the grain come from instead. The images are drawn
 * by tools/ui/build-ui-textures.js, so every colour in them is a number in a file.
 *
 * The slice fraction is the corner radius over the texture size, 40 over 128. Change one
 * in the generator and this has to follow, which is why the generator prints it.
 */
const SLICE = { top: 0.15625, right: 0.15625, bottom: 0.15625, left: 0.15625 }
const skin = (name: string) => ({
  // White, explicitly: the Button component supplies a variant colour of its own, and a
  // texture drawn under it comes out multiplied into whatever that colour is. Naming the
  // tint white lets the image show the colours it was drawn with.
  color: Color4.White(),
  texture: { src: `assets/ui/${name}.png` },
  textureMode: 'nine-slices' as const,
  textureSlices: SLICE
})

/*
  A disc is scaled whole. Nine-slicing a circle keeps its four corners and stretches the
  straight middle, which is a stadium, not a disc; `stretch` keeps it round at any size.
*/
const disc = (name: string) => ({
  color: Color4.White(),
  texture: { src: `assets/ui/${name}-disc.png` },
  textureMode: 'stretch' as const
})

export const SKIN = {
  panel: skin('panel'),
  card: skin('card'),
  inset: skin('inset'),
  primary: skin('primary'),
  secondary: skin('secondary'),
  danger: skin('danger'),
  success: skin('success'),
  disabled: skin('disabled'),
  /* The thumb buttons: the same two palettes, cut round. */
  primaryDisc: disc('primary'),
  secondaryDisc: disc('secondary')
}

/** The skin a control wears, picked from the same condition that picks its variant. */
export const btn = (primary: boolean) => (primary ? SKIN.primary : SKIN.secondary)
