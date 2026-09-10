import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { TAP, FORCE_MOBILE_LAYOUT } from './theme'

/** The dialog sheet: the width it takes when the screen allows it, and the padding inside it. */
export const MENU_W = 1088
export const MENU_PAD = 18

/**
 * Where things are allowed to go, and why.
 *
 * The scene does not own the screen. Decentraland's own client draws over parts of it, and
 * its documentation names them: the left column carries chat, profile, joystick and
 * emotes; the bottom right carries the action buttons and they sit over the scene's area
 * "by design"; the top right carries the profile and camera controls and is described as
 * crowded. The zones it names as safe are the centre for dialogs, the top centre for
 * messages the player cannot act on, and the centre bottom above the interaction button
 * for controls.
 *
 * So the usable screen is three horizontal bands, and nothing here is a number somebody
 * liked the look of. Every position in the interface comes from this file, so moving a
 * band moves everything that belongs to it, and a stray `top: 158` written by hand is a
 * defect rather than a style.
 *
 * Sizes are virtual pixels against the reference resolution the renderer declares, which
 * is 1600x720 on a phone and 1920x1080 elsewhere. The narrow one governs: an interface
 * that fits 720 fits 1080, never the reverse, and authoring against 1080 while a phone
 * renders 720 is what put a 620 tall panel on an 86 percent tall screen.
 */

/**
 * The reference the interface is currently authored against.
 *
 * Set once the platform is known, because the client swaps a 16:9 request for 1600x720 on
 * a handset. Everything below converts the client's measurements into these units.
 */
export const active = { w: 1920, h: 1080 }
/** Heights are authored against the phone, 720, because what fits 720 fits 1080. */
export function setReference(w: number, h: number): void { active.w = w; active.h = h }

/**
 * La zone dans laquelle le renderer place, en NOS unites, encoche deduite.
 *
 * Un element en `100%` remplit cette zone, pas la dalle: le renderer est declare avec
 * `screenInset: 'device'`, donc son origine et sa taille sont celles du rectangle sur,
 * publie par le client dans `screenInsetArea`. Calculer une couverture plein ecran contre
 * `active` revenait donc a viser un cadre plus grand que celui qu'on remplit, et l'image
 * sortait decalee et coupee de travers (proprietaire, 7 Sep). Sans information du client,
 * la reponse honnete est le canevas de reference.
 */
/** The whole screen in our units, for a renderer declared with `screenInset: 'none'`. */
export function zoneEcran(): { w: number; h: number } {
  const info = UiCanvasInformation.getOrNull(engine.RootEntity)
  if (info === null) return { w: active.w, h: active.h }
  const scale = Math.min(info.width / active.w, info.height / active.h)
  if (!(scale > 0)) return { w: active.w, h: active.h }
  return { w: info.width / scale, h: info.height / scale }
}

export function zoneRenderer(): { w: number; h: number } {
  const info = UiCanvasInformation.getOrNull(engine.RootEntity)
  if (info === null) return { w: active.w, h: active.h }
  const scale = Math.min(info.width / active.w, info.height / active.h)
  if (!(scale > 0)) return { w: active.w, h: active.h }
  const i = info.screenInsetArea
  const g = i?.left ?? 0, d = i?.right ?? 0, h = i?.top ?? 0, b = i?.bottom ?? 0
  return { w: (info.width - g - d) / scale, h: (info.height - h - b) / scale }
}

/**
 * What the client's own controls take from the left and right edges, in our units.
 *
 * This used to be one guessed number, 320, for the action buttons on the right. Two things
 * were wrong with it. The client publishes the answer itself, in UiCanvasInformation, and
 * the protocol says the value changes with whatever HUD is currently shown, so a constant
 * cannot be right. And it named only the right edge, while the phone puts a joystick on the
 * left, so the interface was corrected for one obstruction and blind to the other.
 *
 * Returned in the units the layout is written in: the client reports canvas pixels, and the
 * renderer multiplies our numbers by the same scale it derives from the virtual screen, so
 * dividing here cancels it out. Missing or unreported means zero, which is the honest
 * answer for a client that has not told us anything.
 */
export function clientEdges(): { left: number; right: number } {
  const info = UiCanvasInformation.getOrNull(engine.RootEntity)
  if (info === null || info.interactableArea === undefined) return { left: 0, right: 0 }
  const scale = Math.min(info.width / active.w, info.height / active.h)
  if (!(scale > 0)) return { left: 0, right: 0 }
  return { left: info.interactableArea.left / scale, right: info.interactableArea.right / scale }
}

/**
 * The client's own thumb pad, measured, so ours lands where a player's thumb already goes.
 *
 * Measured on a screenshot of the mobile client at 2412x1080 (owner, 3 Sep): the jump disc
 * is 168 px across with its centre 253 px from the right edge and 160 px from the bottom;
 * the four satellites (hand, E, F, +) are 87 px across on an orbit of 205 px around it.
 * The phone renders our interface on a 1600x720 canvas, so the canvas scale there is 1.5
 * and every number below is the measurement divided by it. The earlier arc kept a Godot
 * add-on's proportions at a size "chosen for a thumb", which came out one and a half times
 * the native pad and sat a full button further left (mobile tester, 3 Sep).
 */
/*
  The satellites and their orbit were the client's own, and the client's own are under the floor.

  Workshop #3 (Friendzone, 19 Aug, `data/friendzone-workshop-3-mobile-ux-2026-08-19.md`) is
  explicit twice: "avoid the small buttons, stick to minimum touch target, this is the
  recommended size by Apple and Android", and "leave at least half the thumb width of a space
  between controls". Converted to this canvas: a Galaxy A54 is 403 ppi and renders our 1600x720
  at 1.5 px per unit, so one unit is 0.095 mm. The satellites at 58 measured 5.49 mm against
  Apple's 44 pt (6.86 mm) and Material's 48 dp (7.62 mm), and the gap between a satellite and
  the central disc measured 4.92 mm against the 8 to 10 mm half a thumb asks for.

  At 81 and 181 both floors are met and so is the spacing rule: the satellite measures 7.66 mm
  against Material's 7.62, and the gap 7.99 mm against the 8 the half a thumb asks for. The pad's
  box grows from 246 to 308 units, which the empty right side has to spare (owner, 5 Sep: close
  the two partial rows).

  The central button is untouched at 112, which is 10.60 mm: the workshop allows up to three
  times the minimum in the thumb zone, so there is no ceiling problem, only a floor one.
*/
export const THUMB = {
  /** Diameter of the central button, the one pressed every ten seconds. */
  big: 112,
  /** Diameter of a satellite. */
  small: 81,
  /** Distance from the central button's centre to a satellite's centre. */
  orbit: 181,
  /** The central button's outer edges, from the right and bottom edges of the canvas. */
  right: 113,
  bottom: 50
} as const

/**
 * The air between two stacked plates, everywhere a stack is drawn.
 *
 * The toasts, the corner column and the notices each carried their own number (8, 14, 10),
 * and on the tester's phone the plates touched (3 Sep). The reference rule is Material's
 * 8 dp grid: at least 8 dp between components. A phone at 2412x1080 renders our canvas at
 * 1.5 px per unit and lays about 2.6 px per dp, so 8 dp is 14 of our units; 16 clears it
 * with the plates' outlines counted in.
 */
export const STACK_GAP = 16

/** The three bands, as offsets from the top and the bottom of the reference screen. */
export const BAND = {
  /** Non-actionable messages: the counter, the step line, the belt announcement. */
  top: 10,
  /*
    262, et ce nombre est une capacite, pas un gout.

    Les trois blocs de la bande demandaient 118 + 64 + 68 plus deux ecarts de 16, soit 282
    pour 250 disponibles: le troisieme etait donc REFUSE et jamais dessine. Ce n'etait pas un
    cas limite, c'etait une impossibilite geometrique permanente. Une caisse Divine est passee
    sur le tapis pendant qu'une horloge de raid etait affichee et le proprietaire n'a rien vu
    (7 Sep), ce qui etait le comportement ecrit: sur une bande pleine, le dernier bloc saute.
    Les deux plaques de moment sont ramenees a 52 et le plafond a 262: 118 + 16 + 52 + 16 + 52
    = 254, les trois tiennent, et une annonce ne peut plus disparaitre en silence.
  */
  topHeight: 262,
  /** Controls. Rows stack upward from the bottom, each one TAP.height tall. */
  bottom: 26,
  /** Dialogs own the middle and everything else hides while one is up. */
  dialogMaxHeight: 620
} as const

/** The vertical offset of a control row counted from the bottom, row 0 being the lowest. */
export function row(n: number): number {
  return BAND.bottom + n * (TAP.height + 14)
}

/**
 * The top band, as a stack.
 *
 * Messages arrive from unrelated parts of the game: the money, the tutorial step, a crowd
 * bonus, the event feed, a crate announced on the belt. Giving each one a fixed address was
 * the first fix, and it was only half right. It stopped two of them sharing a number, but a
 * fixed address is wrong in both directions: a sixth message had nowhere to go and picked a
 * `top:` by hand, landing on top of the money, and when the tutorial finished its address
 * emptied and everything below it stayed put, floating under a hole.
 *
 * A band of messages is a stack. Each block is declared once, here, in priority order with
 * the height it needs and whether it is showing right now; absent blocks take no room and
 * everything below closes up. Collisions and holes both stop being possible, rather than
 * being fixed one screenshot at a time.
 *
 * The band has a floor, because the middle of the screen belongs to dialogs. A block that
 * would cross it is refused a position and does not draw: on a full band the least
 * important message is dropped, which is the honest outcome and beats overlapping the game.
 */
export function topBand(blocks: Array<[string, boolean, number]>): Record<string, number> {
  const out: Record<string, number> = {}
  let y = BAND.top
  for (const [name, present, height] of blocks) {
    const room = y + height <= BAND.top + BAND.topHeight
    out[name] = room ? y : -1
    if (present && room) y += height + STACK_GAP
  }
  return out
}

/**
 * A centred strip, returned as the width and the left margin that centres it.
 *
 * The rule this file got wrong for a long time, stated plainly: an obstruction in a corner
 * limits how wide we are allowed to be, it does not move where the middle is. The old
 * version shifted every strip half the width of the right-hand buttons, so anything routed
 * through here sat a hundred and sixty pixels left of anything that placed itself by hand.
 * That is why the interface never looked centred, and why straightening one panel knocked
 * another one crooked: two different definitions of the word, in the same screen.
 *
 * The centre is the centre. Only the width answers to the client: a strip is trimmed to
 * whatever survives between the controls it reports on either side, and the trim comes from
 * the larger of the two so the result stays symmetric about the middle.
 */
export function strip(width: number): { width: number; margin: { left: number } } {
  const edge = clientEdges()
  // The forced phone layout takes the floor the tester's phone hit (a sheet of 800 on 1600,
  // measured 10 Sep): the desktop client reports no edges, and a sheet of 1088 hides what a
  // sheet of 800 shows, the streak chips first.
  const usable = FORCE_MOBILE_LAYOUT ? active.w * 0.5 : active.w - 2 * Math.max(edge.left, edge.right)
  const w = Math.min(width, Math.max(usable, active.w * 0.5))
  return { width: w, margin: { left: -w / 2 } }
}

/**
 * Context notices, stacked upward from above the control rows.
 *
 * These say what the game is waiting for right now: place your base first, tap a slot to
 * move it, smash the crate, someone is robbing you. Each one used to carry its own
 * `bottom:`, and three of them picked 150, which lands inside the row of controls that
 * spans 136 to 232. They drew across the buttons.
 *
 * Same rule as the top band, in the other direction: declared once, in priority order, and
 * each one stacks above the last so two can be up at the same time without touching. The
 * first is the most urgent, and sits closest to the controls where the eye already is.
 */
export function noticeBand(blocks: Array<[string, boolean, number]>): Record<string, number> {
  const out: Record<string, number> = {}
  let y = row(2)
  for (const [name, present, height] of blocks) {
    out[name] = y
    if (present) y += height + STACK_GAP
  }
  return out
}

/**
 * How far our idea of the middle is from the screen's actual middle, in our own units.
 *
 * The renderer is asked to keep our interface inside the device's safe margins, so what it
 * hands us is a rectangle inset from the screen: our fifty percent is the centre of that
 * rectangle, not the centre of the glass. On a desktop the insets are zero and the two are
 * the same, which is why this never showed up there. On a phone the notch takes a bite out
 * of one side only, so the two centres are a few pixels apart, and a reticle a few pixels
 * off the one the client draws is exactly the sort of detail that reads as amateur.
 *
 * A shot travels along the camera's forward axis, which arrives at the centre of the glass.
 * So the sight has to be there too, and this is the correction that puts it there: half the
 * difference between the two insets, converted out of canvas pixels.
 */
export function decalageCentre(): { x: number; y: number } {
  /*
    Zero, measured. The reasoning above assumed the renderer insets our rectangle by the
    device's safe area; it does not, on two testers' phones (9 and 10 Sep): a plainly centred
    line sits at 0.500 and 0.507 of the screen's width, where an inset of 104 px on the right
    would have put it at 0.46. With the correction applied on top of that, the reel stood
    52 px right of the middle (owner's phone, 10 Sep). The middle of our rectangle IS the
    middle of the glass, and the difference stays nothing until a client is measured doing
    otherwise; the reading of the inset is left out rather than kept and ignored.
  */
  return { x: 0, y: 0 }
}

/**
 * How much of the right edge to leave for the client, at the top of the screen.
 *
 * Written down from a photograph of the running mobile client rather than from this file's
 * own earlier claim, which said the top right carried the profile and camera controls and
 * was crowded. On the phone those four buttons sit at the top LEFT, in a row, and the top
 * right is empty. On the desktop client there are two small icons in that corner, so the
 * margin is sized for those.
 *
 * That corner matters because it is where a running objective belongs: eye-tracking work on
 * game interfaces puts persistent readouts in the periphery and keeps the middle for the
 * action, and an objective tracker is conventionally read top right.
 */
export const COIN_HAUT_DROIT = 96

/**
 * Which button means what, and why the scene adds almost none of its own.
 *
 * The mobile client already draws a set of controls, and its documentation says what each
 * one emits and which ones a thumb can actually reach: the interaction button sends
 * IA_POINTER at whatever sits under the reticle, E sends IA_PRIMARY, F sends IA_SECONDARY,
 * and there is a jump. The numbered buttons hide behind a secondary menu and are described
 * as not easily reachable, so they are hidden rather than used.
 *
 * Building a second row of controls beside those was the mistake: two sets of buttons for
 * one pair of thumbs. The rule instead is one button, one meaning, and the scene borrows
 * rather than adds.
 *
 *   interaction  acts on what the reticle covers, and fires when the weapon is out
 *   E            the one action the game would offer right now: build, open, collect, buy
 *   F            draw and holster
 *   jump         jump
 *
 * That leaves nothing for the main loop to put on screen. What has no native home is the
 * travel menu and the panels, and those get a single opener each, in the bottom band.
 *
 * What the player cannot read off a fixed icon is what E means at this instant, so that
 * goes where the documentation puts context hints: one line, centre bottom, just above the
 * interaction button. A line of text, never a control.
 */
export const NATIVE = {
  interact: 'hidden on the phone since 30 Aug: every world click has a contextual twin on the central button',
  primary: 'the contextual game action',
  secondary: 'draw and holster',
  jump: 'jump'
} as const
