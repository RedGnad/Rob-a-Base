import { room } from '../shared/messages'
import { crate } from '../shared/loot-table'
import { alerter, alerterEnFile } from './theft'
import { TOAST } from './theme'

/*
  Each step, with the one verb it waits for.

  `verb` is the icon the step chip shows, in the white family, so the chip and the button
  the player must press carry the same picture. `actions` are the ids the contextual button
  can take that complete the step: while it shows one of them, it pulses, and that pulse is
  the only moving thing on the HUD. One cue at a time is the rule the genre's onboarding
  follows (a single pointer on the one control to press) and what keeps a cue from becoming
  noise (owner, 3 Sep, after testers saying "I don't know what to do").
*/
export const STEP_TEXTS: ReadonlyArray<{ titre: string; aide: string; verb: string; actions: readonly string[] }> = [
  // No hint at all. A red ghost is read without being told, the arrival is placed on a legal
  // square (travel.ts), and the world already carries the floating PLACE YOUR BASE, the ghost
  // and the hammer. An empty `aide` simply draws no second line (owner, 6 Sep).
  { titre: 'Place your base', aide: '', verb: 'build', actions: ['construire-base', 'poser-base'] },
  { titre: 'Open your crate', aide: 'walk to your crate and smash it 3 times', verb: 'crate', actions: ['smash', 'ouvrir-caisse'] },
  { titre: 'Collect your coins', aide: 'your items earn into a pool: tap COLLECT', verb: 'collect', actions: ['encaisser'] },
  { titre: 'Buy a crate', aide: 'tap a crate on the belt before it falls', verb: 'crate', actions: ['acheter-caisse', 'surencherir'] },
  { titre: 'Steal from a neighbour', aide: 'walk into another base, tap an item, hold on, and run it home', verb: 'steal', actions: ['voler'] }
]

/** `since`: when the current step began, on this clock; the hint line waits on it. */
export const tutoView = { etape: 0, total: STEP_TEXTS.length as number, since: Date.now() }

/*
  The help sentence is not shown at once. It appears after a while on the same step, the
  way the genre hints after inactivity: a player who is doing it never reads it, a player
  who is stuck gets it without asking.
*/
const HINT_AFTER_MS = 12_000

/** Whether the contextual action with this id is the one the current step waits for. */
export function stepExpects(id: string | undefined): boolean {
  if (id === undefined || tutoView.etape >= tutoView.total) return false
  return STEP_TEXTS[tutoView.etape].actions.includes(id)
}

/** The verb icon of the current step, or the collect icon once the tutorial is done. */
export function stepVerb(): 'build' | 'crate' | 'collect' | 'steal' {
  if (tutoView.etape >= tutoView.total) return 'collect'
  return STEP_TEXTS[tutoView.etape].verb as 'build' | 'crate' | 'collect' | 'steal'
}

export function stepHintDue(): boolean {
  return tutoView.etape < tutoView.total
    && (STEP_TEXTS[tutoView.etape]?.aide ?? '') !== ''
    && Date.now() - tutoView.since > HINT_AFTER_MS
}

/** Seconds until the play-time crate, and the full span, so a bar can be drawn from them. */
export const giftView = { leftS: -1, totalS: 900 }

export function setupTutorial(): void {
  room.onMessage('tutorial', (d) => {
    if (d.etape !== tutoView.etape) tutoView.since = Date.now()
    tutoView.etape = d.etape; tutoView.total = d.total
  })
  room.onMessage('giftProgress', (d) => { giftView.leftS = d.leftS; giftView.totalS = d.totalS })
  room.onMessage('timeGift', (d) => {
    alerterEnFile(`${d.minutes} MINUTES PLAYED  ·  free ${crate(d.crate).name}`, '#ffd166', TOAST.event)
  })
}
