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
  { titre: 'Open your box', aide: 'walk to your box and smash it 3 times', verb: 'crate', actions: ['smash', 'ouvrir-caisse'] },
  /*
    L'etape qui disait "tap COLLECT at your base" nommait un bouton introuvable, et en plus
    une contrainte inexistante: l'encaissement n'avait aucune condition de distance. Le
    revenu tombe seul depuis le 7 Sep, et l'etape sert enfin l'acte qui RAPPORTE, poser sa
    piece sur une etagere, qui n'etait enseigne nulle part alors que c'est la source de tout
    l'argent du jeu.
  */
  { titre: 'Shelve your piece', aide: 'walk into your base and put it on a stand', verb: 'place', actions: ['poser-objet'] },
  { titre: 'Buy a box', aide: 'tap a box on the belt before it falls', verb: 'crate', actions: ['acheter-caisse', 'surencherir'] },
  { titre: 'Steal from a neighbour', aide: 'tap an item, hold on, run it home', verb: 'steal', actions: ['voler'] }
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
export function stepVerb(): 'build' | 'crate' | 'place' | 'steal' | 'collect' {
  /*
    Une fois le tutoriel fini, le disque montre le verbe de l'ETAT DE BASE, l'encaissement.

    Il montrait le vol, choisi le temps ou l'encaissement n'existait plus. Le resultat se voyait
    a chaque arrivee: tant que le premier message du portefeuille n'etait pas la, la cagnotte
    valait zero, donc aucune action n'etait offerte, donc le disque affichait le VOL, puis
    basculait sur l'encaissement des que le serveur repondait (proprietaire, 7 Sep: "je voyais
    aucune icone puis l'icone de vol puis la bonne"). Ce n'etait pas un bug de contexte, c'etait
    le disque qui annoncait un verbe qui n'a jamais ete son etat de base.
  */
  if (tutoView.etape >= tutoView.total) return 'collect'
  return STEP_TEXTS[tutoView.etape].verb as 'build' | 'crate' | 'place' | 'steal' | 'collect'
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
    alerterEnFile(`${d.minutes} MIN PLAYED  ·  free ${crate(d.crate).name}`, '#ffd166', TOAST.event)
  })
}
