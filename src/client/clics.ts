import { engine, inputSystem, InputAction, PointerEventType, UiTransform, Entity } from '@dcl/sdk/ecs'
import { isMobile } from '@dcl/sdk/platform'
import { room } from '../shared/messages'
import { BUILD } from './build-stamp'

/**
 * TEMPORARY. Records what the interface RECEIVES against what its controls SERVE, and sends
 * the trace to the server instead of drawing it on screen.
 *
 * Menu buttons miss a press now and then, most often right after the menu opens or a tab
 * changes, and nothing has produced a cause, only hypotheses (memo 512). Reading the SDK
 * settles how a press travels: the client sends a pointer result per entity, and each frame
 * the scene serves that entity's LAST "down" only if its timestamp is newer than the highest
 * one seen the frame before. So a press can be lost in exactly two places: the client never
 * sends it (its own hit test, the cursor lock), or the scene receives it and filters it.
 *
 * The first version printed three counters in the menu header. That worked, but the owner is
 * filming with testers and a debug line in the corner is not something to ship into a video
 * (6 Sep). So the same facts go to the server: one line per received press, with the entity
 * it hit, whether a control handler ran for it, which control, and what happened just before.
 * A press the owner reports as missed then reads one of two ways in the trace: a line with
 * `served=0` means the scene had it and dropped it, and NO line at all at that moment means
 * the client never sent it. That is the whole question, answered after the session instead of
 * during it.
 *
 * Read it with the scene storage, key `debug:ui` (see src/server/trace.ts).
 */

/** How long a received press is held before it is judged unserved. Three frames at 30 fps. */
const FENETRE_MS = 300
/** At most this many lines wait to be sent; past it the oldest go, because a flood is itself the fact. */
const TAMPON_MAX = 60
/** One message every ten seconds at most: a trace must never compete with the game for the wire. */
const ENVOI_MS = 10_000

/*
  `servisAvant` is what makes an attribution honest.

  The first version compared timestamps against the LAST handler that ran, so two presses
  inside one window both read as served by the second one's control. Counting the handlers
  instead answers the only question that matters per line, "did anything run for THIS press",
  without ever crediting one press with another's handler.
*/
type EnAttente = { at: number; entity: number; ui: boolean; contexte: string; age: number; servisAvant: number }

let attente: EnAttente | null = null
let servi: { cle: string } | null = null
let dernierEvenement = { nom: 'start', at: Date.now() }
let bascules = 0
let lignes: string[] = []
let dernierEnvoi = 0
let recus = 0
let servis = 0

/** A control handler ran. `cle` names it (see `ui-kit.tsx`), which is how a miss gets a name. */
export function noterServi(cle = '?'): void {
  servis += 1
  servi = { cle }
}

/** A moment worth dating: the menu opened, a tab changed. The leading hypothesis needs it. */
export function noterEvenement(nom: string): void {
  dernierEvenement = { nom, at: Date.now() }
}

/** A camera mode change reported by the client: counted to tell a mode flip from a render flicker. */
export function noterBascule(): void {
  bascules += 1
  noterEvenement('camera')
}

function ecrire(e: EnAttente, servePar: string | null): void {
  // t | entity | ui? | served? | control | what happened before | its age in ms | camera flips
  lignes.push([
    e.at,
    e.entity,
    e.ui ? 1 : 0,
    servePar === null ? 0 : 1,
    servePar ?? '-',
    e.contexte,
    e.age,
    bascules
  ].join('|'))
  if (lignes.length > TAMPON_MAX) lignes = lignes.slice(-TAMPON_MAX)
}

/** Set on the first frame: nothing is sent before the room has had time to exist. */
let depart = 0
const DELAI_DEPART_MS = 20_000

function vider(maintenant: number): void {
  if (lignes.length === 0 || maintenant - dernierEnvoi < ENVOI_MS) return
  if (maintenant - depart < DELAI_DEPART_MS) return
  dernierEnvoi = maintenant
  const lot = lignes
  lignes = []
  /*
    Not `sendOrHold`, and never allowed to throw.

    A trace that queued behind a disconnection would replay stale lines into the next session
    and date them wrong, so a lost batch is the right trade here. And a debug channel that can
    break a player's session is worse than no debug channel: the send is wrapped, because the
    only thing this code must never do is cost the owner a take during the video.
  */
  try {
    void room.send('uiTrace', {
      lines: lot.join('\n'),
      build: BUILD,
      phone: isMobile(),
      recus,
      servis
    })
  } catch {
    // Lines lost on purpose.
  }
}

export function setupClics(): void {
  depart = Date.now()
  engine.addSystem(() => {
    const maintenant = Date.now()

    // A press held from an earlier frame: judge it now that the handlers have had their turn.
    if (attente !== null && maintenant - attente.at >= FENETRE_MS) {
      ecrire(attente, servis > attente.servisAvant ? (servi?.cle ?? '?') : null)
      attente = null
    }

    const cmd = inputSystem.getInputCommand(InputAction.IA_POINTER, PointerEventType.PET_DOWN)
    if (cmd !== null) {
      recus += 1
      const id = cmd.hit?.entityId
      // A press already waiting is judged on the spot: two downs inside one window is itself
      // a fact worth seeing, and dropping the first would hide exactly the double presses the
      // owner reports making when a button does not answer.
      if (attente !== null) ecrire(attente, servis > attente.servisAvant ? (servi?.cle ?? '?') : null)
      attente = {
        at: maintenant,
        entity: id === undefined ? -1 : ((id as Entity) & 0xffff),
        ui: id !== undefined && UiTransform.has(id as Entity),
        contexte: dernierEvenement.nom,
        age: Math.min(99_999, maintenant - dernierEvenement.at),
        servisAvant: servis
      }
    }

    vider(maintenant)
  })
}
