import { engine, AudioSource, Transform, timers } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { room } from '../shared/messages'
import { rarity, formatIncome, crate } from '../shared/loot-table'
import { indexView } from './index-ui'
import { applyThiefPenalty, applyFreeze } from './locomotion'
import { flashDamage, floatAmount, playHurt, playCash } from './juice'
import { decideWelcome } from './welcome'
import { tutoView } from './tutorial'
import { sendOrHold } from './intent'
import { poseView } from './pose'
import { TOAST } from './theme'
import { setSfx, replay } from './sfx'
import { cue } from './ui-kit'

export const theftView = {
  alertes: [] as Array<{ id: number; t: string; c: string; ne: number; until: number; keep: boolean }>,
  /** The one line about what another player just did, or null. */
  feed: null as { t: string; until: number } | null,
  stealing: false,
  stealTarget: '',
  stealLeftMs: 0,
  stealTotalMs: 1,
  presents: 1,
  prime: 0,
  sentries: 0,
  sentryPrice: 0,
  /** Silos owned, the price of the next one, and the offline cap they buy, in seconds of production. */
  silos: 0,
  siloPrice: 0,
  offlineCapS: 0,
  coins: 0,
  prestige: 0,
  nextPrestige: 0,
  minRarity: 0,
  bestRarity: -1,
  multiplier: 1,
  income: 0,
  basePosee: false,
  /** True once the server has answered at all: `basePosee` means nothing before it. */
  walletRecu: false,
  lockSec: 0,
  canRecover: false,
  floorPrice: 0,
  rechargeSec: 0,
  /** La cagnotte: ce que les etageres ont produit et qui attend d'etre ramasse. */
  pending: 0,
  alert: '',
  alertColor: '#ffffff',
  alerteJusqua: 0,
  malusJusqua: 0,
  luckSec: 0,
  luckPrice: 0,
  /** The exact toy the next prestige would eat, as a code, or -1. */
  prestigeEats: -1,
  /** The piece prestige must spare, or -1. */
  spared: -1,
  /** The prestige the next floor asks for. */
  floorNeedsPrestige: 0,
  /** Written by the interface every frame: whether an alert on screen can actually be seen. */
  hudVisible: true,
  /** When the HUD last came back: the press that closed a panel must not also reach the world. */
  hudDepuis: 0,
}

let sonneur = 0 as unknown as ReturnType<typeof engine.addEntity>

const file: Array<{ t: string; c: string; ms: number }> = []
let derniereAnnonceHL = 0
/**
 * For what arrives in a burst, or behind a screen: shown one after another, each for its
 * full time, once the HUD is back. The join answers with the offline sum, the day's crate
 * and a goal within the same second; three writes to one slot showed the last.
 */
export function alerterEnFile(texte: string, color: string, durationMs: number = TOAST.warning): void {
  file.push({ t: texte, c: color, ms: durationMs })
}

/*
  Two toasts, never more, newest on top. One slot meant a sentry warning ERASED the theft
  result that arrived the same second; three or more is a chat log. Each entry keeps its
  birth for the slide-in and its expiry for the fade-out; the legacy single-alert fields
  stay written so nothing else changes.
*/
/*
  The identity is a counter, and the birth instant stays for the slide-in.

  Same defect as the floating numbers, same line, found while fixing them (9 Sep): the toast
  was keyed on `ne`, its instant of birth, and two toasts raised in one frame share that
  millisecond exactly (measured: five calls in a batch, one distinct `Date.now()` out of five).
  Duplicate sibling keys are unsupported in the reconciler and leave an element nobody updates.
  It is rarer here than on the numbers, because the list holds two and a twin refreshes rather
  than stacking, but rare is not never and the fix is a field.
*/
let prochaineAlerte = 1
/*
  `keep` says whether the line is still true later.

  A plate raised while a screen hides the HUD is frozen and shown when the screen goes; that
  is right for a fact that stays true (a theft suffered, a gift, a boss slain, a prestige, a
  return) and wrong for a live state or an immediate answer (someone robbing you now, a freeze
  of six seconds, a cloak nearby, a refused purchase): shown two minutes late, those lie
  (owner, 10 Sep). The default follows the duration class: the six-second events are the
  durable facts, the shorter classes are answers and states and expire on the wall clock, as
  they always did. Two events are live in spite of their class and say so at the call site.
*/
export function alerter(texte: string, color: string, durationMs: number = TOAST.warning, keep: boolean = durationMs >= TOAST.event): void {
  const now = Date.now()
  // The same line again refreshes the one on screen instead of stacking a twin under it.
  const twin = theftView.alertes.find((a) => a.t === texte && a.until > now)
  if (twin !== undefined) { twin.until = now + durationMs; twin.c = color; return }
  theftView.alertes.unshift({ id: prochaineAlerte, t: texte, c: color, ne: now, until: now + durationMs, keep })
  prochaineAlerte += 1
  if (theftView.alertes.length > 2) theftView.alertes.length = 2
  theftView.alert = texte
  theftView.alertColor = color
  theftView.alerteJusqua = now + durationMs
}
/**
 * Les toasts encore vivants, l'expiree ou qu'elle soit.
 *
 * On ne retirait que par la QUEUE, en s'arretant a la premiere non expiree. Les durees vont
 * de 2,2 a 8 secondes, alors un message court pose devant un message long ne pouvait plus
 * partir avant lui: "FUSED, a GOLD is in your hand" restait a l'ecran pendant que le toast
 * d'en dessous finissait ses huit secondes (proprietaire, 2 Sep, "il disparait pas"). On
 * balaie donc toute la liste, du bas vers le haut pour que les indices tiennent.
 */
export function alertesVisibles(): Array<{ id: number; t: string; c: string; ne: number; until: number }> {
  const now = Date.now()
  for (let i = theftView.alertes.length - 1; i >= 0; i--) {
    if (theftView.alertes[i].until <= now) theftView.alertes.splice(i, 1)
  }
  return theftView.alertes
}

/*
  ONE LINE ABOUT THE OTHERS, four seconds, the newest replacing the last.

  What other players do (a theft, a pickup, a fusion, an outbid, the boss, a trap) is the one
  visible thread between players outside the records board, so it stays; but it stood as a
  three-line plate of fixed width, twelve seconds a line, its texts ran past the plate, and
  it was the row that pushed the corner column onto the pad on a phone (owner, 10 Sep: the
  screen's legibility comes first). Now a single line sized to its words, four seconds, and
  the column draws it only when there is room above the pad.
*/
const FEED_MS = 4_000

export function pushToFeed(line: string): void {
  theftView.feed = { t: line, until: Date.now() + FEED_MS }
}

/** The line about the others still worth drawing, or null. */
export function feedLine(): string | null {
  const f = theftView.feed
  if (f === null) return null
  if (f.until <= Date.now()) { theftView.feed = null; return null }
  return f.t
}


export function setupTheft(): void {
  sonneur = engine.addEntity()
  Transform.create(sonneur, { parent: engine.PlayerEntity, position: Vector3.create(0, 1, 0) })
  // The file is `alerte-vol.wav`; this pointed at a name that has never existed in the repo,
  // so the one sound the genre insists on (a siren when you are robbed) never played.
  AudioSource.create(sonneur, { audioClipUrl: 'assets/sounds/alerte-vol.wav', playing: false, loop: false, volume: 1 })

  room.onMessage('youWereRobbed', (d) => {
    const r = rarity(d.rarity)
    /*
      The shield is the consolation, so it has to be said in the same breath as the loss.
      A protection nobody is told about does no work at all: the point of earning it by being
      robbed is that the moment of losing something is also the moment you are told the rest is
      safe. Only worth a line when it is long enough to matter; a minute is a chase, not a wall.
    */
    const abri = d.shieldSec >= 300
      ? `  ·  sealed ${d.shieldSec >= 3600 ? Math.round(d.shieldSec / 3600) + 'h' : Math.round(d.shieldSec / 60) + ' min'}`
      : ''
    alerter(`STOLEN BY ${d.byName.toUpperCase()}${abri}`, r.color, TOAST.event)
    replay(sonneur)
    console.log(`[CLIENT] VOL SUBI: ${d.byName} -> ${r.name}`)
  })

  room.onMessage('thiefPenalty', (d) => {
    applyThiefPenalty(true)
    theftView.malusJusqua = Date.now() + d.ms
    timers.setTimeout(() => {
      applyThiefPenalty(false)
      theftView.malusJusqua = 0
    }, d.ms)
    console.log(`[CLIENT] thief penalty for ${d.ms} ms`)
  })

  room.onMessage('stolen', (d) => {
    theftView.stealing = false
    /*
      No victim's name, because it does not fit and it is the least useful word on the line.

      Measured against the panel: four hundred wide, sixteen of padding, eleven pixels a
      character at this size, so thirty-four characters. `Guest6621 took a Legendary from
      Guest5020` needs forty-one, which is why the three lines were spilling out of their own
      plate and over each other. Of the three things a line carries, WHO, WHAT and FROM WHOM,
      the third is the one a bystander needs least, and the one player who genuinely needs it
      is the victim, who already gets a full alert with a sound of their own.
    */
    pushToFeed(`${d.byName} stole a ${rarity(d.rarity).name}`)
  })
  room.onMessage('itemHome', (d) => {
    const r = rarity(d.rarity)
    alerter(d.stocked
      ? `${r.name.toUpperCase()} BACK  ·  in your stock`
      : `${r.name.toUpperCase()} BACK HOME`, r.color, TOAST.result)
  })
  room.onMessage('itemPicked', (d) => {
    pushToFeed(`${d.byName} picked up a ${rarity(d.rarity).name}`)
  })
  room.onMessage('reclaimed', (d) => {
    pushToFeed(`${d.byName} took back a ${rarity(d.rarity).name}`)
  })
  room.onMessage('sentryBlocked', (d) => {
    flashDamage()
    floatAmount(d.lost, true)
    playHurt()
    applyFreeze(d.gelMs)
    // The coins are on the floor at your feet, not in their pocket: worth saying, because it
    // is the difference between a punishment and a scramble you can still win.
    /*
      The loss comes first, because it is the fact the player did not expect. The tester lost
      coins to a turret and read a sign about a frozen thief and a sealed base: the third line,
      the one with the money on it, was below the edge of a box sized for one. Two lines, the
      sum in the first, and naming the floor stays, since another storey may have nothing on it.
    */
    // The sum floats off the counter; the toast says what happened and what to do next.
    alerter(`DEFENDED  ·  frozen ${Math.round(d.gelMs / 1000)}s, sealed ${d.lockSec}s`, '#ff6b6b', TOAST.warning)
    if (d.lost > 0) alerter('YOUR COINS ARE ON THE FLOOR', '#ff6b6b', TOAST.warning)
  })
  room.onMessage('sentryTriggered', (d) => {
    // Facts about your own base, kept behind a screen: a thief stopped stays stopped, and
    // coins on the floor stay worth a walk.
    alerter(`SENTRY STOPPED ${d.byName.toUpperCase()}  ·  ${d.left} left`, '#4dd2ff', TOAST.warning, true)
    if (d.taken > 0) alerter(`THEY DROPPED ${formatIncome(d.taken)}  ·  go get it`, '#4dd2ff', TOAST.warning, true)
  })
  room.onMessage('sentryBought', (d) => {
    cue('till.wav', 0.7)
    alerter(`FLOOR ${d.floor} DEFENDED  ·  ${d.charges} charges`, '#4dd2ff', TOAST.result)
  })

  room.onMessage('gaveItem', (d) => {
    alerter(`GIFTED TO ${d.toName.toUpperCase()}`, '#8fe08f', TOAST.result)
  })
  room.onMessage('wasGifted', (d) => {
    const r = rarity(d.rarity)
    alerter(`${d.byName.toUpperCase()} LEFT YOU A GIFT`, r.color, TOAST.event)
  })
  room.onMessage('outbidFeed', (d) => {
    pushToFeed(`${d.byName} outbid a crate`)
  })
  room.onMessage('gifted', (d) => {
    pushToFeed(`${d.byName} gifted a ${rarity(d.rarity).name}`)
  })

  room.onMessage('stealProgress', (d) => {
    theftView.stealing = true
    theftView.stealTarget = d.ownerName
    theftView.stealLeftMs = d.restantMs
    theftView.stealTotalMs = Math.max(1, d.totalMs)
  })
  room.onMessage('stealFailed', (d) => {
    theftView.stealing = false
    alerter(`STEAL FAILED: ${d.reason.toUpperCase()}`, '#ff6b6b', TOAST.result)
  })
  room.onMessage('beingRobbed', (d) => {
    alerter(`${d.byName.toUpperCase()} IS ROBBING YOU`, '#ff6b6b', Math.min(TOAST.event, Math.max(TOAST.warning, d.restantMs)), false)
  })

  room.onMessage('wallet', (d) => {
    tutoView.etape = d.tutoEtape
    decideWelcome(d.tutoEtape, tutoView.total)
    theftView.sentries = d.sentries
    theftView.sentryPrice = d.sentryPrice
    theftView.silos = d.silos
    theftView.siloPrice = d.siloPrice
    theftView.offlineCapS = d.offlineCapS
    theftView.presents = d.presents
    theftView.prime = d.prime
    theftView.coins = Math.floor(d.coins)
    theftView.prestige = d.prestige
    theftView.nextPrestige = d.nextPrestige
    theftView.minRarity = d.minRarity
    theftView.bestRarity = d.bestRarity
    theftView.multiplier = d.multiplier
    theftView.income = d.income
    theftView.basePosee = d.basePosee
    theftView.walletRecu = true
    theftView.lockSec = d.lockSec
    theftView.canRecover = d.canRecover
    theftView.floorPrice = d.floorPrice
    theftView.rechargeSec = d.rechargeSec
    theftView.pending = d.pending
    theftView.luckSec = d.luckSec
    theftView.luckPrice = d.luckPrice
    theftView.prestigeEats = d.prestigeEats
    theftView.spared = d.spared
    theftView.floorNeedsPrestige = d.floorNeedsPrestige
    // The offline sum, read off the tick and said once per cash-in (see the server's wallet tick).
    if (d.offlineAt > 0 && d.offlineGain > 0 && d.offlineAt !== derniereAnnonceHL) {
      derniereAnnonceHL = d.offlineAt
      // A full silo is the only part of this the player can act on, so it is the part that is
      // said: the genre's cap works by being READ, otherwise being capped is just a small number.
      // "banked" et non "earned": depuis le 7 Sep cette somme porte AUSSI la cagnotte laissee a
      // la deconnexion, donc elle couvre la fin de la session precedente autant que l'absence.
      // Un mot qui decrit ou l'argent etait, pas quand il a ete produit, est vrai des deux.
      alerterEnFile(`WELCOME BACK  ·  +${formatIncome(d.offlineGain)} banked`, '#ffd166', TOAST.event)
      if (d.offlineCapped) alerterEnFile('SILO FULL  ·  build another', '#ffd166', TOAST.event)
    }
  })

  room.onMessage('rebirthDone', (d) => {
    /*
      Say what changed. It used to report the floor count, which prestige does not touch:
      the player was handed a number about the one thing that had stayed the same, at the
      exact moment they were trying to work out what they had just paid for.
    */
    /*
      La seule fanfare du jeu, et le seul endroit ou elle a le droit d'exister.

      Le prestige etait MUET: la seule decision irreversible du jeu, le seul multiplicateur
      definitif, et il ne jouait rien pendant que le compteur repartait de zero. Le silence au
      moment culminant de la boucle se lit "il ne s'est rien passe", exactement le contraire de
      ce qui vient d'arriver. Il ne pouvait rien emprunter non plus: `reveal-huge` appartient a
      la caisse la plus rare et `till` a la monnaie, et porter l'un des deux aurait dit "tu as
      tire un Secret" ou "tu as achete un truc" a l'instant ou le joueur vient de tout rendre.
      Un son de cette taille employe deux fois cesse de vouloir dire "la plus grande chose".
    */
    cue('prestige.wav', 0.9)
    alerter(`PRESTIGE ${d.prestige}  ·  INCOME x${d.multiplier} FOR GOOD`, '#f5a524', TOAST.event)
    console.log(`[CLIENT] prestige ${d.prestige}, income x${d.multiplier}`)
  })

  /*
    The player's own switch, back from the profile ONCE, on the first index after joining.

    The index rides every wallet tick, and applying it each time raced the press: the tick
    already in flight still carried the old value and flipped the switch back, and the next
    one flipped it again (owner, 5 Sep: "je coche il se decoche, ou avec un delai"). The
    client owns the switch from the moment it is pressed; the server is only its memory
    between visits.
  */
  let prefsAppliquees = false
  room.onMessage('index', (d) => {
    indexView.vus = [...d.vus]
    // Un skin qui change s'entend comme un achat: c'est le meme acte, de la monnaie contre une
    // apparence. La toute premiere reception ne sonne pas, elle ne fait que decrire l'etat.
    if (prefsAppliquees && d.skin !== indexView.skin) cue('till.wav', 0.7)
    indexView.skin = d.skin
    if (!prefsAppliquees) {
      prefsAppliquees = true
      setSfx(d.sfxOff !== true)
    }
  })

  // The join-time message can arrive before this handler exists; the wallet tick carries the
  // same fact until it is shown, so this only logs.
  room.onMessage('collected', (d) => {
    /*
      Le nombre et la piece le disent; la phrase le disait une troisieme fois.

      "+1.2K coins collected" portait exactement ce que le nombre flottant porte, sur le geste
      le plus repete du jeu (proprietaire, 3 Sep). La grille met la quantite sur le nombre,
      donc le toast part.
    */
    floatAmount(d.gain, false)
    playCash()
  })

  room.onMessage('offlineEarnings', (d) => {
    console.log(`[CLIENT] offline: +${d.gain} over ${Math.round(d.seconds / 60)} min`)
  })

  /*
    LA RECOMPENSE S'ENTEND, elle ne se lit plus.

    Ces deux evenements posaient une banniere en travers de l'ecran pour annoncer une caisse
    que le joueur venait lui-meme de reclamer. C'est un accuse de reception d'une action
    volontaire, et la litterature d'interface est constante la-dessus depuis Nielsen: la
    visibilite de l'etat est obligatoire, la MODALITE ne l'est pas. Un accuse de reception est
    du travail de lecture impose pour une information que le joueur possede deja, et il occupe
    le canal des banniers, qui doit rester celui des choses qu'on n'a PAS faites: on te vole,
    un boss arrive, quelqu'un t'a surencheri.

    Ce qui remplace: le son de livraison, celui-la meme qui dit deja "une caisse est arrivee
    chez toi" quand un convoi se pose, et le compteur de caisses en attente qui monte, avec sa
    ligne d'aide "N boxes waiting at your base". L'evenement est donc annonce, date et
    consultable, sans une phrase a lire (proprietaire, 7 Sep).
  */
  room.onMessage('dailyReward', (d) => {
    cue('reward.wav', 0.85)
    console.log(`[CLIENT] recompense du log ${d.log}`)
  })
  room.onMessage('questReward', (d) => {
    cue('reward.wav', 0.85)
    console.log(`[CLIENT] quete: caisse ${crate(d.crate).name}`)
  })

  room.onMessage('siloBought', (d) => {
    cue('till.wav', 0.7)
    alerter(`SILO ${d.silos}  ·  ${Math.round(d.capS / 60)} min banked while away`, '#4dd2ff', TOAST.result)
    console.log(`[CLIENT] silo ${d.silos} achete pour ${d.cost}, plafond ${d.capS}s`)
  })

  /*
    L'etage se VOIT, donc il ne s'ecrit plus: un plancher entier apparait devant le joueur avec
    ses six emplacements vides dessus. Le silo, lui, reste ecrit: rien ne change dans le monde
    quand on l'achete, il ne fait que relever le plafond de ce que la base met de cote pendant
    l'absence, et une phrase est le seul endroit ou ce chiffre existe.
  */
  room.onMessage('floorBought', (d) => {
    cue('till.wav', 0.7)
    console.log(`[CLIENT] floor ${d.floors} achete pour ${d.cost}`)
  })

  room.onMessage('sold', (d) => {
    // A sale is a quantity: it floats like every other gain, it is not read as a sentence.
    floatAmount(d.gain, false)
    playCash()
    console.log(`[CLIENT] sold for ${d.gain}`)
  })

  room.onMessage('actionRejected', (d) => {
    // Une pose refusee rend la main: le marqueur se rallume et le joueur peut choisir ailleurs.
    if (d.action === 'build') poseView.pending = false
    alerter(d.reason.toUpperCase(), '#ff6b6b', TOAST.result)
    console.log(`[CLIENT] refuse (${d.action}): ${d.reason}${d.antiCheat ? ' [anti-triche]' : ''}`)
  })

  engine.addSystem((dt) => {
    if (theftView.stealing) {
      theftView.stealLeftMs = Math.max(0, theftView.stealLeftMs - dt * 1000)
    }
    /*
      An alert does not run out while nobody can see it. The welcome-back sum was set the
      moment the server answered the join, nine seconds long, behind the welcome screen the
      player was still reading; by the time the HUD came up it had expired unseen (tester,
      27 Aug: "no message telling me what I earned while away"). The clock runs only while
      the HUD is on screen, and the queue feeds the slot only then.
    */
    if (!theftView.hudVisible) {
      theftView.alerteJusqua += dt * 1000
      // The durable plates keep too: their birth and expiry slide with the hidden time, so a
      // theft announced behind the shop is still there, sliding in, when the shop closes. The
      // rule above was written on the single slot (27 Aug); the stack of 3 Sep had skipped it,
      // and `alertesVisibles` prunes on the wall clock before the HUD is even consulted.
      for (const a of theftView.alertes) if (a.keep) { a.ne += dt * 1000; a.until += dt * 1000 }
      return
    }
    if (theftView.alert !== '' && Date.now() > theftView.alerteJusqua) theftView.alert = ''
    if (theftView.alert === '' && file.length > 0) {
      const n = file.shift()
      if (n !== undefined) alerter(n.t, n.c, n.ms)
    }
  })
}

export function collectPending(): void { sendOrHold(() => { void room.send('collect', {}) }) }
export function cancelSteal(): void { theftView.stealing = false; void room.send('cancelSteal', {}) }

export function steal(ownerId = '', slot = -1): void {
  void room.send('stealItem', { ownerId, slot })
}
/** Keep this piece through prestige, or lift the pin by naming the same one again. */

export function lockBase(): void { sendOrHold(() => { void room.send('activateLock', {}) }) }
export function recover(): void { sendOrHold(() => { void room.send('reclaim', {}) }) }
export function doPrestige(): void { sendOrHold(() => { void room.send('rebirth', {}) }) }
export function buyFloorFor(): void { sendOrHold(() => { void room.send('buyFloor', {}) }) }
export function buySilo(): void { sendOrHold(() => { void room.send('buySilo', {}) }) }
export function armSentry(tier = 0): void { sendOrHold(() => { void room.send('buySentry', { tier }) }) }

let _adresse = ''
export function myClientAddress(): string { return _adresse }
export function setClientAddress(a: string): void { _adresse = a }
