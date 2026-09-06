import { room } from '../shared/messages'
import { log } from './log'
import {
  addCrate, cratesOf, etapeTuto, avancerTuto,
  playedTime, addPlayedTime, giftsTaken, markGiftTaken
} from './plots'

export const ETAPES = [
  'Place your base',
  'Open your box',
  'Collect your coins',
  'Buy a box from the belt',
  'Leave a gift on another base'
] as const

/**
 * Un escalier de cadeaux, dont la premiere marche est a deux minutes.
 *
 * Il y en avait UN, a dix minutes, une caisse Rare. La barre qui le montre etait le bon
 * instrument, et je la garde: une attente qu'on regarde se remplir travaille pendant tout ce
 * temps. Mais dix minutes tombe HORS de la fenetre ou tout se joue. La guidance du domaine est
 * nette la-dessus: le noyau du jeu dans la premiere minute, le declic avant quatre-vingt-dix
 * secondes, et les problemes de retention se decident dans les dix premieres (Playio sur le
 * FTUE, benchmarks Segwise 2026, sources industrie et non recherche primaire). Le cadeau
 * arrivait donc a la FIN de la fenetre decisive au lieu de la remplir.
 *
 * Une seule marche, finalement, et elle revient a dix minutes.
 *
 * L'escalier avait deux marches, une Good a deux minutes et la Rare a douze. Mesure faite en
 * jeu: le debut etait devenu trop riche, le joueur avait deja trop par seconde avant meme le
 * premier cadeau (proprietaire, 2 Sep). Le vrai remede a la fenetre decisive etait ailleurs et
 * il est en place: la caisse de bienvenue est une Good, donc il se passe quelque chose des la
 * premiere minute sans que le jeu ait a donner deux fois. La marche du bas etait de la
 * generosite en double, pas de l'attention.
 *
 * Il tombe a SIX minutes. Douze n'existait que comme second barreau d'une echelle qui n'en a
 * plus qu'un, et dix etait le reglage d'avant, quand rien ne remplissait la premiere minute.
 * Maintenant que la caisse de bienvenue s'en charge, six est le point ou l'attente cesse
 * d'etre une attente et devient un rendez-vous.
 */
export const GIFTS = [
  { s: 6 * 60, crate: 2 }
] as const
/** La derniere marche, pour la barre qui compte a rebours et pour les messages. */
export const GIFT_MS = GIFTS[GIFTS.length - 1].s * 1000
export const GIFT_CRATE = GIFTS[GIFTS.length - 1].crate

/**
 * Seconds accrued this session, not yet folded into the player's profile.
 *
 * The total lives on the profile, because the platform stops the server two minutes after
 * the venue empties and anything held here dies with it. But folding every second would
 * mark the profile dirty every second, and storage writes are capped: the excess fails
 * silently. So the session accrues here and is folded once a minute, and on the way out.
 * A hard shutdown costs at most the last minute.
 */
const sessionS = new Map<string, number>()
const REPLI_S = 60

export function pousserTuto(address: string): void {
  const e = etapeTuto(address)
  void room.send('tutorial', { etape: e, total: ETAPES.length }, { to: [address] })
}

export function tutoFait(address: string, etape: number): void {
  if (etapeTuto(address) !== etape) return
  avancerTuto(address)
  pousserTuto(address)
}

export function arrivee(address: string): void {
  sessionS.set(address, 0)
  pousserTuto(address)
}

export function depart(address: string): void {
  replier(address)
  sessionS.delete(address)
}

/** Move this session's accrual onto the profile, where it survives the server. */
function replier(address: string): void {
  const s = sessionS.get(address) ?? 0
  if (s <= 0) return
  addPlayedTime(address, s)
  sessionS.set(address, 0)
}

/**
 * Called once a second for every player in the scene.
 *
 * The threshold is read against the profile total plus this session, so fifteen minutes
 * means fifteen minutes of playing, not fifteen minutes of one server happening to stay
 * up. The flag is on the profile too, so the crate is given once and once only.
 */
/**
 * Tell them how long is left, because the waiting IS the reward being built.
 *
 * The crate for fifteen minutes of play arrived out of nowhere: nothing on screen said it was
 * coming, so the game spent fifteen minutes of a player's attention and got a surprise out of
 * it instead of an anticipation. Work on progress indicators is blunt about which is worth
 * more: an unfinished bar reads to the brain as something to be finished, and it keeps
 * reading that way every time the player glances at it.
 *
 * Sent every five seconds rather than every one: the number moves slowly enough that nobody
 * can tell, and a per-second broadcast to everybody present is a lot of traffic for a clock.
 */
export function checkGift(presents: Iterable<string>): void {
  for (const a of presents) {
    const s = (sessionS.get(a) ?? 0) + 1
    sessionS.set(a, s)
    if (s >= REPLI_S) replier(a)

    // La barre compte vers la PROCHAINE marche, pas vers la derniere: une barre qui vise un
    // point deja depasse ne dit plus rien, et celle du debut est justement celle qui compte.
    const pris = giftsTaken(a)
    const prochaine = pris < GIFTS.length ? GIFTS[pris] : null
    const joue = playedTime(a) + (sessionS.get(a) ?? 0)
    if (s % 5 === 0 || s === 1) {
      const reste = prochaine === null ? -1 : Math.max(0, prochaine.s - joue)
      void room.send('giftProgress', { leftS: reste, totalS: prochaine === null ? 0 : prochaine.s }, { to: [a] })
    }

    if (prochaine === null) continue
    if (joue < prochaine.s) continue
    replier(a)
    markGiftTaken(a)
    addCrate(a, prochaine.crate)
    void room.send('inventory', { crates: cratesOf(a) }, { to: [a] })
    void room.send('timeGift', { crate: prochaine.crate, minutes: Math.round(prochaine.s / 60) }, { to: [a] })
    log(`welcome crate ${prochaine.crate} for ${a.slice(0, 8)} after ${Math.round(joue / 60)} min played`)
  }
}
