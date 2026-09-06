import { engine, InputAction, PointerEventType, UiTransform, Entity, PointerEventsResult } from '@dcl/sdk/ecs'
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
  Attribution by TIME WINDOW, after two wrong tries, and the second one is the instructive one.

  Version one compared against the last handler that ran, so two presses inside one window both
  read as served by the second one's control. Version two counted handlers instead and compared
  the count before and after: that assumed this system sees the press BEFORE the interface
  dispatches it. It does not. The renderer's dispatch and this system are two systems in one
  frame, and the first reading of real data (6 Sep, `debug:ui`) showed the consequence plainly:
  batches reporting eleven servings carried three lines marked served. The handler had already
  run when the press was recorded, so the counter had already moved and the comparison said no.

  A serving is therefore kept with its own timestamp, and a press counts as served if a serving
  landed anywhere in [press - `AVANT_MS`, press + `FENETRE_MS`]. The backward tolerance is what
  covers a handler that ran earlier in the same frame; it is one frame wide, not more, so it can
  never reach the previous press.
*/
type EnAttente = { at: number; entity: number; ui: boolean; menu: boolean; contexte: string; age: number; stamp: number; porteur: number }
/** How far back a serving may sit and still belong to this press: one frame at 30 fps. */
const AVANT_MS = 40

let attente: EnAttente | null = null
/** The highest command timestamp seen: the SDK's own newness rule, applied here. */
let dernierStamp = 0
/** The recent servings, newest last: a press is matched against this, never against a counter. */
let servis_recents: Array<{ cle: string; at: number }> = []
let dernierEvenement = { nom: 'start', at: Date.now() }
let bascules = 0
let lignes: string[] = []
let dernierEnvoi = 0
let recus = 0
let servis = 0

/** A control handler ran. `cle` names it (see `ui-kit.tsx`), which is how a miss gets a name. */
export function noterServi(cle = '?'): void {
  servis += 1
  // The key carries the separator this file writes with (`LABEL|WIDTH` in ui-kit), which split
  // one column into two in the first dump. It is cleaned here, once, at the source.
  servis_recents.push({ cle: cle.replace(/\|/g, '/'), at: Date.now() })
  if (servis_recents.length > 16) servis_recents = servis_recents.slice(-16)
}

/** The serving that belongs to a press at `t`, or null. */
function servingPour(t: number): string | null {
  for (let i = servis_recents.length - 1; i >= 0; i--) {
    const s = servis_recents[i]
    if (s.at >= t - AVANT_MS && s.at <= t + FENETRE_MS) return s.cle
  }
  return null
}

/*
  The panel state is PUSHED in, never imported.

  `menu.ts` imports this file to date its own moments, so reading `menuView` from here would
  close a cycle. The interface already knows the answer once a frame and hands it over.
*/
let menu = false
export function signalerMenu(ouvert: boolean): void { menu = ouvert }
function menuOuvert(): boolean { return menu }

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
  /*
    The hit entity is kept even though the first dump had it at -1 on every single line.

    That is a result, not a gap: the global pointer command carries no hit for a press that
    lands on the interface, so "which element" is not a question this channel can answer. What
    replaces it is `menu`, which says whether a panel was open at the moment of the press. An
    unserved press with the menu open is one of the two things worth telling apart, a control
    that did not answer or the panel swallowing a press beside a control; an unserved press
    with no menu is simply a click on the world.
  */
  /*
    Two more columns, and they are the decisive ones.

    The mobile session of 6 Sep showed that nearly every served tap in the menu is followed,
    45 to 90 ms later, by a second DOWN nobody serves. Two readings are possible and they call
    for different fixes: the client sends one tap twice (touch, then an emulated pointer), or
    the scene reports one tap twice, once from the root entity's pointer result and once from
    the interface entity's, with different timestamps. The command's own `timestamp` and the
    entity whose result carried it tell the two apart: same stamp twice is the scene, two
    stamps from the root is the client.
  */
  // t | entity hit | ui? | menu? | served? | control | what happened before | its age | camera flips | client stamp | carrier
  lignes.push([
    e.at,
    e.entity,
    e.ui ? 1 : 0,
    e.menu ? 1 : 0,
    servePar === null ? 0 : 1,
    servePar ?? '-',
    e.contexte,
    e.age,
    bascules,
    e.stamp,
    e.porteur
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
      ecrire(attente, servingPour(attente.at))
      attente = null
    }

    /*
      Read the pointer results ourselves, not through `getInputCommand`.

      The SDK's global read returns the FIRST new command of the frame and nothing about which
      entity carried it. To tell a client double from a scene double (see `ecrire`) every new
      DOWN is needed, each with its own timestamp and its carrier. The SDK's own rule is kept:
      a command is new if its stamp is above the highest one seen so far.
    */
    for (const [porteur, resultats] of engine.getEntitiesWith(PointerEventsResult)) {
      for (const cmd of resultats) {
        if (cmd.button !== InputAction.IA_POINTER || cmd.state !== PointerEventType.PET_DOWN) continue
        if (cmd.timestamp <= dernierStamp) continue
        dernierStamp = cmd.timestamp
        recus += 1
        const id = cmd.hit?.entityId
        // A press already waiting is judged on the spot: two downs inside one window is itself
        // a fact worth seeing, and dropping the first would hide exactly the double presses the
        // owner reports making when a button does not answer.
        if (attente !== null) ecrire(attente, servingPour(attente.at))
        attente = {
          at: maintenant,
          entity: id === undefined ? -1 : ((id as Entity) & 0xffff),
          ui: id !== undefined && UiTransform.has(id as Entity),
          contexte: dernierEvenement.nom,
          menu: menuOuvert(),
          age: Math.min(99_999, maintenant - dernierEvenement.at),
          stamp: cmd.timestamp,
          porteur: porteur & 0xffff
        }
      }
    }

    vider(maintenant)
  })
}
