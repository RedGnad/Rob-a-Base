import { engine, Transform, PlayerIdentityData, timers, executeTask } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { Storage } from '@dcl/sdk/server'
import {
  STEAL_RANGE, STEAL_REACH, STEAL_HOLD_REACH, GIFT_RANGE, STEAL_BASE_MS, STEAL_PER_RARITY_MS, RECOVER_RANGE, LOCK_ON_ARRIVAL_MS, LOCK_FREE_MS, SENTRY_FREEZE_MS, SENTRY_LOCK_MS,
  LOCK_BONUS_MS, PENALTY_MS, RECOVER_WINDOW_MS, CARRY_GRIP, SENTRY_TIERS, SHOT_MIN_YIELD, prixParCharge, shieldFor, SHIELD_MAX_MS, REVENGE_MS, SLOTS_PER_FLOOR, VIDE, occupe
} from '../shared/schemas'

const BUILD_RANGE = 7
import { room } from '../shared/messages'
import { noter } from './records'
import {
advanceQuest, claimQuestReward, cratesOf, pushQuests, baseDe, useSentryCharge, sentriesOf, buySentryFor, presents, positionObjet, inReach, etatPrevisible, incomePerSecond, spend, incomePerItem, absenceDe, sentriesOnFloor, compterVol, choisirSkin, setSfxOff, setWelcomed, reclamerQuotidienne, declareName
} from './plots'
import { dropAt } from './coins'
import { stepDone } from './onboarding'
import { banFromBase, bannedUntil, shortDuration, bansOf } from './bans'
import { bankPot } from './collect'
import { remettreEnMain, carriesFor, forcerLacher, arracherDesMains, setLandedHook, setHomeHook } from './carry'
import { rarityOf, mutationDe, itemName } from '../shared/loot-table'
import { log } from './log'
import {
  nearbyBases, lockOf, setLock, noteLockUse, removeItem, addItem,
  displayName, storeAlert, takeAlerts, coinsOf, tenterRebirth, prestigeOf,
  placeBase, basePoints, buyFloorFor, buySiloFor, lockCooldown, declarerVolEnCours, recordAwayLoss, raiseKeepOutField,
  WORLD_RESET_MARK
} from './plots'

/*
  `code`, not `rarity`. An item is `rarity * 100 + mutation`, and this field has always held
  the whole code; calling it a rarity is how it ended up sent as one to the client, which read
  a 402 as rarity 402, fell back to entry zero, and told the room that a Legendary recovered in
  front of witnesses was a Common.
*/
/*
  `payback`: this theft was itself somebody's revenge. It can still be recovered in the
  window, like any theft, but it opens no revenge of its own. Supercell's support page on
  Revenge says it in one line: if they took revenge on you, you cannot take revenge on them.
  Without it two players pierce each other's shields in turn for as long as they keep stealing.
*/
type Larcin = { thief: string; victim: string; code: number; quand: number; landed: boolean; payback: boolean }
const larcins: Larcin[] = []
/** Until when a thief frozen by a sentry may not start a theft: the freeze used to be client-side only. */
const geles = new Map<string, number>()
/*
  Until when a sentry's shot holds a base, for everyone.

  The shot raises the base's lock for SENTRY_LOCK_MS, and a revenge goes through any lock:
  the one thief the hold was for walked straight back in after their seven-second freeze and
  spent a charge every time, a guard's three in about twenty seconds. Kept apart from the
  lock so the revenge still opens the shield it was meant to open.
*/
const tenues = new Map<string, number>()

/*
  Revenge rights survive the server.

  The platform stops the server two minutes after the last player leaves, and `larcins` lived
  in memory only, so a player robbed in the night came back to a server that had forgotten
  the theft: the report showed it with no REVENGE on it, which is the one case the right
  exists for. Only the entries that open a revenge are kept, and only for as long as they do;
  the recovery window is twenty seconds and no restart is that short. The key carries the
  world's reset mark, so a world reset leaves the old list behind with the old bases. Built
  when used, not at load: plots.ts and this file import each other, and at load time the
  mark was still undefined (the first local run wrote "revenges:undefined").
*/
function revengesKey(): string { return `revenges:${WORLD_RESET_MARK}` }
const REVENGES_KEPT = 400
let revengesDirty = false
function revengesChanged(): void { revengesDirty = true }

/** Stolen loot reached the thief's own shelf: the most recent open entry for that code. */
export function noteLanded(thief: string, code: number): void {
  for (let i = larcins.length - 1; i >= 0; i--) {
    const l = larcins[i]
    if (l.thief === thief && l.code === code && !l.landed) { l.landed = true; return }
  }
}
setLandedHook(noteLanded)

/*
  The item came back to the player it was taken from without RECOVER (carry.ts, `homeHook`):
  the theft cost them nothing, so it owes them nothing. The latest entry for that item still
  in a thief's hands or on the floor is the one; an entry whose loot reached a shelf is a theft
  that worked, whatever twin of it walks home later.
*/
export function settleReturned(victim: string, code: number): void {
  for (let i = larcins.length - 1; i >= 0; i--) {
    const l = larcins[i]
    if (l.victim !== victim || l.code !== code || l.landed) continue
    larcins.splice(i, 1)
    revengesChanged()
    if (presents().has(victim)) pushRevenges(victim)
    log(`${displayName(victim)} has their ${itemName(rarityOf(code), mutationDe(code))} back, the revenge on ${displayName(l.thief)} for it is closed`)
    return
  }
}
setHomeHook(settleReturned)

/*
  Written at most every ten seconds while dirty, like the records journal: storage writes are
  capped and a dropped one answers false, which marks the list dirty again. Only what opens a
  revenge is written, newest kept when the list is long.
*/
function saveRevenges(): void {
  revengesDirty = false
  const t = Date.now()
  const owed = larcins
    .filter((l) => !l.payback && t - l.quand <= REVENGE_MS)
    .slice(-REVENGES_KEPT)
    .map((l) => ({ thief: l.thief, victim: l.victim, code: l.code, quand: l.quand }))
  void Storage.set(revengesKey(), JSON.stringify(owed)).then((ok) => {
    if (!ok) { revengesDirty = true; log('ERROR revenge list not saved, retrying') }
  })
}

function loadRevenges(): void {
  executeTask(async () => {
    const raw = await Storage.get<string>(revengesKey())
    if (typeof raw !== 'string' || raw.length === 0) return
    let lus: Array<{ thief: string; victim: string; code: number; quand: number }> = []
    try { lus = JSON.parse(raw) } catch { lus = [] }
    if (!Array.isArray(lus)) return
    const t = Date.now()
    const deja = new Set(larcins.map((l) => `${l.thief}|${l.victim}|${l.quand}`))
    for (const x of lus) {
      if (typeof x?.thief !== 'string' || typeof x?.victim !== 'string' || !Number.isFinite(x?.quand)) continue
      if (t - x.quand > REVENGE_MS || deja.has(`${x.thief}|${x.victim}|${x.quand}`)) continue
      // Landed: whatever became of the item, the restart has long closed its recovery window.
      larcins.push({ thief: x.thief, victim: x.victim, code: x.code, quand: x.quand, landed: true, payback: false })
    }
    // The pruning walks from the front, so the list stays in time order.
    larcins.sort((a, b) => a.quand - b.quand)
    // A victim who arrived before the list came back was told it was empty.
    const ici = presents()
    for (const v of new Set(larcins.map((l) => l.victim))) if (ici.has(v)) pushRevenges(v)
    log(`revenges restored: ${lus.length} read, ${larcins.length} open`)
  })
}

function lockBonus(address: string): number {
  return prestigeOf(address) * LOCK_BONUS_MS
}

function positionOf(address: string): Vector3 | null {
  for (const [e, id] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (id.address?.toLowerCase() !== address) continue
    const t = Transform.getOrNull(e)
    return t ? Vector3.create(t.position.x, t.position.y, t.position.z) : null
  }
  return null
}

function refus(address: string, action: string, reason: string, antiCheat = false): void {
  void room.send('actionRejected', { action, reason, antiCheat }, { to: [address] })
}

/*
  Coming back SHORTENS the shield, on purpose.

  An earned shield can run for hours, and the owner walking back in replaces it with the
  arrival grace. That is the intent rather than an accident: the shield exists to cover an
  absence, and a base sealed for six more hours with its owner standing inside it is a venue
  with nothing left in it to do. You are here, you can give chase, so the wall comes down.
*/
export function lockOnArrival(address: string): void {
  // No grace any more: thirty seconds of a lock nobody pressed read as a shield nobody asked
  // for, and a label explaining it read as jargon (owner, 5 Sep). Arriving only ends the
  // earned shield; from the first frame the owner is here, and can give chase.
  // Only when a shield is actually up: writing a date nobody needs rang the seal on every client.
  // And the date written is ZERO, not "now": "now" is this machine's clock, and a client whose
  // clock runs a few seconds behind read it as a lock still standing, drew a shield on a base
  // with nobody around and rang the seal for it (owner, 5 Sep). Zero is in the past on every
  // clock there is.
  if (lockOf(address) > Date.now() && setLock(address, 0)) log(`${displayName(address)} arrived, shield down`)
}

/*
  What happened while you were away, as ONE report.

  Each stored alert used to be replayed as its live message, so a player back from a night
  met a queue of one-line toasts, a few seconds each, gone before they could be acted on. The
  genre keeps a log the player reads and acts from (Clash of Clans: the defence log, and a
  Revenge button on each raid for twelve hours). One message lets the client draw one screen.
  Alerts stored before the thief's address was kept carry an empty id: they show, without
  the revenge button.
*/
const AWAY_KIND = { theft: 0, sentry: 1, trap: 2, gift: 3, payback: 4 } as const
export function delivrerAlertes(address: string): void {
  const a = takeAlerts(address)
  if (a.length === 0) return
  const kinds: number[] = [], names: string[] = [], ids: string[] = [], codes: number[] = []
  for (const alert of a) {
    const x = alert as { type?: string; byName: string; by?: string; rarity?: number; mutation?: number; code?: number; payback?: boolean }
    const kind = x.type === 'sentry' ? AWAY_KIND.sentry
      : x.type === 'trap' ? AWAY_KIND.trap
      : x.type === 'gift' ? AWAY_KIND.gift
      : x.payback === true ? AWAY_KIND.payback
      : AWAY_KIND.theft
    kinds.push(kind)
    names.push(x.byName)
    ids.push(x.by ?? '')
    codes.push(kind === AWAY_KIND.gift ? (x.code ?? 0)
      : kind === AWAY_KIND.theft || kind === AWAY_KIND.payback ? (x.rarity ?? 0) * 100 + (x.mutation ?? 0)
      : -1)
  }
  void room.send('awayReport', { kinds, names, ids, codes }, { to: [address] })
  log(`${a.length} alert(s) differee(s) delivree(s) a ${displayName(address)}`)
}

/*
  The away report and the revenge list go out when BOTH sides are ready, once per presence.

  They were sent the moment the server saw the player arrive, and the server sees the avatar
  before the scene's script runs on the client: locally the join landed at 00:42:02 and the
  client started at 00:42:04, so the list went to nobody (2 Nov). The report is worse off,
  because taking the alerts empties them: one lost message and the night's log is gone. The
  client says when it is listening (`awayReady`); the server, when the profile holding the
  alerts is loaded. Whichever comes second sends.
*/
const clientPret = new Set<string>()
const serveurPret = new Set<string>()
const accueillis = new Set<string>()
function accueillir(address: string): void {
  if (!clientPret.has(address) || !serveurPret.has(address) || accueillis.has(address)) return
  accueillis.add(address)
  delivrerAlertes(address)
  pushRevenges(address)
}
/** The server finished the player's arrival: profile loaded, shield dropped. */
export function arrivalDone(address: string): void {
  serveurPret.add(address); accueillir(address)
  // A returning player gets back the bases still closed to them, so their client raises those shields again.
  for (const b of bansOf(address)) void room.send('bannedFrom', { ownerId: b.owner, leftMs: b.leftMs }, { to: [address] })
}
/** Gone: the next arrival is a new one. */
export function arrivalOver(address: string): void {
  clientPret.delete(address); serveurPret.delete(address); accueillis.delete(address)
}

/** Has `cible` taken something from `moi` recently enough to owe them an open door? */
function meDoitUneRevanche(moi: string, cible: string): boolean {
  return openRevengeIndex(moi, cible) >= 0
}

/*
  One take-back per theft suffered, the oldest first since it runs out first.

  A theft used to open eight hours of unlimited thefts through every shield the thief had:
  one item lost, a whole base owed. Now each theft suffered is worth one theft back, and the
  revenge on that thief closes when the take-backs are spent (owner, 2 Nov, after the revenge
  research: Clash of Clans also gives one revenge per raid, from the defence log).
*/
function openRevengeIndex(victim: string, thief: string): number {
  const t = Date.now()
  return larcins.findIndex((l) => l.thief === thief && l.victim === victim && !l.payback && t - l.quand <= REVENGE_MS)
}

/*
  The revenge list, told to the player it belongs to.

  The right existed only here: a thief's shield never stopped the player they robbed, for
  REVENGE_MS, and nothing on any screen said so. The robbed player read "STOLEN BY X" and had
  no way to know the door they would meet was open to them alone. One entry per thief, timed
  from that thief's latest theft still owed, which is the one `meDoitUneRevanche` keeps alive
  longest. Built from the same entries the server checks, so the button and the rule agree.
*/
export function pushRevenges(victim: string): void {
  const t = Date.now()
  const latest = new Map<string, number>()
  for (const l of larcins) {
    if (l.victim !== victim || l.payback || t - l.quand > REVENGE_MS) continue
    latest.set(l.thief, Math.max(latest.get(l.thief) ?? 0, l.quand))
  }
  const ids: string[] = [], names: string[] = [], leftSec: number[] = []
  for (const [thief, quand] of latest) {
    ids.push(thief)
    names.push(displayName(thief))
    leftSec.push(Math.max(0, Math.round((REVENGE_MS - (t - quand)) / 1000)))
  }
  void room.send('revenges', { ids, names, leftSec }, { to: [victim] })
}

export function hasSomethingToRecover(address: string): boolean {
  const t = Date.now()
  return larcins.some((l) => l.victim === address && t - l.quand <= RECOVER_WINDOW_MS)
}

type EnCours = { victim: string; slot: number; code: number; fin: number; total: number; grip: number }
const enCours = new Map<string, EnCours>()
/** Whether this player is prying an item off a shelf right now (combat.ts asks before a hit immunity). */
export function isPrying(address: string): boolean { return enCours.has(address) }

/**
 * A shot lands on somebody who is prying: the attempt ends there.
 *
 * This was the hole the whole defence had. Prying costs six to eighteen seconds standing
 * still inside somebody else's building, which is the only stretch where a thief is properly
 * exposed, and a gun did nothing to them during it: nothing outside this file ever touched
 * the in-progress map. Every counterplay the owner had arrived afterwards, once the item was
 * already in the thief's hands. The vulnerable window and the punishable window were
 * different windows.
 */
export function interrompreVol(thief: string, force: number): 'rien' | 'ebranle' | 'coupe' {
  const v = enCours.get(thief)
  if (v === undefined) return 'rien'
  v.grip -= force
  if (v.grip > 0) return 'ebranle'
  enCours.delete(thief)
  void room.send('stealFailed', { reason: 'shot, you lost your grip' }, { to: [thief] })
  return 'coupe'
}

/*
  Three handlers were deleted here on 25 Aug: giveItem, sellItem and moveItem.

  Carrying replaced all three, and their client senders had already stopped being called.
  Leaving them behind is what made two quests unwinnable: the hooks that credit them sat in
  code nothing could reach, so the game asked for something it could not notice being done.
  A handler with no caller is not harmless, it is a place for logic to hide.
*/
export function startTheft(): void {
  // RESOLUTION DES VOLS EN COURS. Un seul systeme, cadence a la seconde.
  let acc = 0
  engine.addSystem((dt) => {
    acc += dt
    if (acc < 0.5) return
    acc = 0
    const maintenant = Date.now()
    for (const [thief, v] of [...enCours]) {
      const b = baseDe(v.victim)
      if (b === undefined) { enCours.delete(thief); continue }

      /*
        Walking away cancels it, and going downstairs counts as walking away.

        This measured a flat distance to the base and ignored height entirely, so a theft
        begun on the top floor survived a trip to the street. It follows the item now, in
        three dimensions, which is what gives the thief's slowdown its meaning: the climb
        back down is the part where the owner can catch you.
      */
      const p = positionOf(thief)
      const cible = positionObjet(v.victim, v.slot)
      if (p === null || cible === null || !inReach(p, cible, STEAL_HOLD_REACH)) {
        enCours.delete(thief)
        void room.send('stealFailed', { reason: 'you left the item' }, { to: [thief] })
        continue
      }

      /*
        The sentry acts DURING the attempt, and only the one on THIS storey acts at all.

        A defence that covered every floor at once was a number, not a decision: the owner had
        nothing to arbitrate and the thief had nothing to read. Now the charge is spent on the
        floor being robbed, so guarding the trophies upstairs leaves the door soft, and finding
        the soft floor is the attacker's counterplay. That is the base-raid genre's own answer,
        and it costs no new item to give.
      */
      const targetFloor = Math.floor(v.slot / SLOTS_PER_FLOOR)
      // `>= 0` et pas une verite: la fonction rend le TIER qui a tire, et le tier zero existe.
      const tier = useSentryCharge(v.victim, targetFloor)
      if (tier >= 0) {
        const left = sentriesOnFloor(v.victim, targetFloor)
        // Never shorter than the shield already up: an 8 h absence shield must not fall to 60 s.
        setLock(v.victim, Math.max(lockOf(v.victim), maintenant + SENTRY_LOCK_MS))
        tenues.set(v.victim, maintenant + SENTRY_LOCK_MS)
        enCours.delete(thief)
        // The shot is SEEN by everyone in the world, not only felt by the thief: a bolt from
        // the cone to the thief on every client, so a newcomer reads the defence at work.
        if (p !== null) void room.send('sentryShot', { ownerId: v.victim, floor: targetFloor, x: p.x, y: p.y, z: p.z })

        /*
          The tier's tithe, shaken out of the thief and left on the floor.
          
          Priced off the same two rules a bullet uses, so a player who has learned one has
          learned both: a share of what the target is carrying, capped by what the OWNER's
          base earns. The cap is what stops a hut farming a fortune off one rich visitor, and
          it is the owner's income rather than the thief's for exactly the reason the shot
          caps on the shooter's. Dropped under the thief, not credited: the owner has to walk
          out and pick it up, and the thief can try to take their own money back on the way.
        */
        const palier = SENTRY_TIERS[Math.min(tier, SENTRY_TIERS.length - 1)]
        let pris = 0
        if (palier.tithe > 0) {
          // The ceiling is what this charge cost, times what the tier promises back.
          const prixCharge = prixParCharge(incomePerItem(v.victim), tier)
          const plafond = Math.max(SHOT_MIN_YIELD, Math.floor(prixCharge * palier.retour))
          const voulu = Math.floor(coinsOf(thief) * palier.tithe)
          const montant = Math.max(0, Math.min(voulu, plafond))
          if (montant > 0 && spend(thief, montant)) { dropAt(thief, montant, p); pris = montant }
        }

        geles.set(thief, maintenant + SENTRY_FREEZE_MS)
        void room.send('sentryBlocked', {
          ownerName: b.name, gelMs: SENTRY_FREEZE_MS, left,
          lockSec: Math.round(SENTRY_LOCK_MS / 1000), lost: pris, floor: targetFloor + 1
        }, { to: [thief] })
        void room.send('stealFailed', { reason: 'the sentry stopped you' }, { to: [thief] })
        const info = { type: 'sentry', byName: displayName(thief), left, taken: pris }
        noter('garde', displayName(thief), b.name, targetFloor + 1)
        if (presents().has(v.victim)) void room.send('sentryTriggered', info, { to: [v.victim] })
        else storeAlert(v.victim, info)
        log(`${b.name} sentry (${palier.name}) on floor ${targetFloor + 1} blocked ${displayName(thief)}, ${pris} shaken loose, ${left} charge(s) left there`)
        continue
      }

      const restant = v.fin - maintenant
      if (restant > 0) {
        void room.send('stealProgress', {
          ownerName: b.name, rarity: rarityOf(v.code), mutation: mutationDe(v.code),
          restantMs: restant, totalMs: v.total
        }, { to: [thief] })
        continue
      }

      /*
        Done: the item changes hands, and it is the item on the shelf the thief stood at.

        This looked the code up anywhere on the base (`items.indexOf`), and a code is only a
        rarity, a mutation and traits, so twins are common. A thief robbing the unguarded top
        floor emptied the first twin from the bottom, which is the floor the owner guards: the
        guarded shelf went bare, the sentry never fired, its charges stayed full (owner, 2 Nov:
        "robbed with turrets up"). Shelves keep their holes, so the slot is still the item's
        own; if something else stands there now, the item the thief was prying has gone.
      */
      enCours.delete(thief)
      if (b.items[v.slot] !== v.code) { void room.send('stealFailed', { reason: 'it is gone' }, { to: [thief] }); continue }
      const r = removeItem(v.victim, v.slot)
      if (r === null) { void room.send('stealFailed', { reason: 'it is gone' }, { to: [thief] }); continue }
      /*
        It lands in their hands, not in their base.

        Prying it loose used to be the whole theft: the item vanished from one building and
        appeared in another, and the two players never shared a moment. Now the thief has to
        walk it home holding it, in the open, in front of the person they took it from. That
        walk is where being shot means something, where the owner's recovery window means
        something, and where anybody watching can see what this game is about.
      */
      remettreEnMain(thief, r, v.victim)
      // A theft from somebody who owes you one IS the revenge, whichever shield was up: it
      // spends one take-back, and it opens none for them in return.
      const dette = openRevengeIndex(thief, v.victim)
      const payback = dette >= 0
      if (payback) larcins.splice(dette, 1)
      larcins.push({ thief, victim: v.victim, code: r, quand: maintenant, landed: false, payback })
      revengesChanged()
      if (payback) pushRevenges(thief)
      compterVol(thief)
      // The last tutorial step is the game's core verb: a theft that reached the hands (27 Aug).
      stepDone(thief, 'steal')
      advanceQuest(thief, 'voler')
      noter('vol', displayName(thief), b.name, r)

      /*
        Losing something is what buys the shield, which is the genre's whole answer.

        Clash of Clans grants eight hours for being raided and sells only two hours a day of
        anything shorter; the heavy protection lands on the player who just lost something,
        never on the one who could afford to stack it in advance. We had no such thing at all:
        an absent player owned nothing but what a bought sentry could hold, and twenty charges
        of one minute is twenty minutes of cover for a night.

        It ramps on REAL absence rather than on a present/absent flag, because the documented
        failure of every offline-protection scheme is quitting mid-raid to trigger it. Standing
        here earns a minute, which is a chase rather than a wall and keeps a busy venue worth
        visiting. Genuinely asleep earns the eight hours.
      */
      /*
        Since 18 Nov 2026 (founder): the shield keeps out THIS thief, for the same ramp, and the
        whole base seals only when an absent owner has lost their share for this absence (a
        quarter of their pieces, `recordAwayLoss`). A raid by several players can take a piece
        each; nobody empties an absent owner. A present owner seals nothing: they defend live,
        and the thief who just robbed them is kept out for a minute.
      */
      const absent = absenceDe(v.victim) > 0
      const bouclier = shieldFor(absenceDe(v.victim))
      banFromBase(thief, v.victim, maintenant + bouclier)
      raiseKeepOutField(v.victim, maintenant + bouclier)
      void room.send('bannedFrom', { ownerId: v.victim, leftMs: bouclier }, { to: [thief] })
      let sceau = 0
      if (absent) {
        const { lost, cap } = recordAwayLoss(v.victim)
        if (lost >= cap) {
          sceau = SHIELD_MAX_MS
          setLock(v.victim, maintenant + sceau)
        }
        log(`${displayName(v.victim)} has lost ${lost} of ${cap} piece(s) this absence${sceau > 0 ? ': base sealed' : ''}`)
      }

      const nomV = displayName(thief)
      const rar = rarityOf(r), mut = mutationDe(r)
      // `by` is the thief's address: the away report needs it to offer revenge on the right player.
      storeAlert(v.victim, { byName: nomV, by: thief, rarity: rar, mutation: mut, shieldSec: Math.round(sceau / 1000), payback })
      void room.send('youWereRobbed', {
        byName: nomV, rarity: rar, mutation: mut, shieldSec: Math.round(sceau / 1000), payback
      }, { to: [v.victim] })
      if (presents().has(v.victim)) pushRevenges(v.victim)
      void room.send('stolen', { byName: nomV, fromName: b.name, rarity: rar, mutation: mut })
      log(`${nomV} took a ${itemName(rar, mut)} from ${b.name}, floor ${Math.floor(v.slot / SLOTS_PER_FLOOR) + 1} slot ${v.slot}${payback ? ', as revenge' : ''}; thief kept out ${Math.round(bouclier / 60000)} min (away ${Math.round(absenceDe(v.victim) / 60000)} min)`)
    }
  })

  room.onMessage('stealItem', (d, ctx) => {
    const thief = ctx?.from?.toLowerCase()
    if (!thief) return
    if ((geles.get(thief) ?? 0) > Date.now()) { refus(thief, 'steal', 'you are frozen'); return }
    const vise = (d.ownerId ?? '').toLowerCase()
    if (vise === thief) { refus(thief, 'steal', 'that is your own base'); return }

    const p = positionOf(thief)
    if (p === null) { refus(thief, 'steal', 'position unknown'); return }

    const inRange = nearbyBases(p, STEAL_RANGE, thief)
    if (inRange.length === 0) { refus(thief, 'steal', 'no base in range'); return }
    const cibles = vise === '' ? inRange : inRange.filter((b) => b.address === vise)
    if (cibles.length === 0) { refus(thief, 'steal', 'that base is out of range'); return }

    const maintenant = Date.now()
    for (const c of cibles) {
      const lock = lockOf(c.address)
      if (lock > maintenant && !meDoitUneRevanche(thief, c.address)) {
        refus(thief, 'steal', `${c.name} is shielded for ${shortDuration(lock - maintenant)}`)
        continue
      }
      // Kept out of this base alone: they robbed it a moment ago, or its trap caught them (bans.ts).
      const ferme = bannedUntil(thief, c.address)
      if (ferme > maintenant) {
        refus(thief, 'steal', `${c.name} is closed to you for ${shortDuration(ferme - maintenant)}`)
        continue
      }
      // A sentry's shot holds the base for everyone, revenge included (see `tenues`).
      const tenue = tenues.get(c.address) ?? 0
      if (tenue > maintenant) {
        refus(thief, 'steal', `${c.name}'s sentry holds it for ${Math.ceil((tenue - maintenant) / 1000)}s`)
        continue
      }
      if (occupe(c.items) === 0) { refus(thief, 'steal', `${c.name} has nothing to take`); continue }


      const slot = d.slot
      if (!Number.isInteger(slot) || slot < 0 || slot >= c.items.length || c.items[slot] === VIDE) {
        refus(thief, 'steal', 'that item is gone'); continue
      }
      // Say server-side what the building already says: that item is on another storey.
      const objet = positionObjet(c.address, slot)
      if (objet === null || !inReach(p, objet, STEAL_REACH)) {
        refus(thief, 'steal', 'not on this floor, or too far')
        continue
      }
      if (enCours.has(thief)) { refus(thief, 'steal', 'you are already taking something'); return }
      if (carriesFor(thief)) { refus(thief, 'steal', 'your hands are full, put it down first'); return }

      // ON NE TRANSFERE RIEN ICI. On ouvre une tentative minutee: c'est pendant celle-ci
      // que la defense agit et que le voleur est vulnerable.
      const code = c.items[slot]
      const duree = STEAL_BASE_MS + rarityOf(code) * STEAL_PER_RARITY_MS
      enCours.set(thief, { victim: c.address, slot, code, fin: maintenant + duree, total: duree, grip: CARRY_GRIP })
      void room.send('thiefPenalty', { ms: duree + 2000 }, { to: [thief] })
      void room.send('stealProgress', {
        ownerName: c.name, rarity: rarityOf(code), mutation: mutationDe(code),
        restantMs: duree, totalMs: duree
      }, { to: [thief] })
      const nomV = displayName(thief)
      if (presents().has(c.address)) {
        void room.send('beingRobbed', { byName: nomV, rarity: rarityOf(code), restantMs: duree }, { to: [c.address] })
      }
      log(`${nomV} starts taking a ${itemName(rarityOf(code), mutationDe(code))} from ${c.name} (${Math.round(duree / 1000)}s)`)
      return
    }
  })

  /*
    Encaisser la cagnotte.

    Volontairement SANS condition de distance: le tutoriel avait un jour promis "tap COLLECT at
    your base" alors que le code n'en demandait aucune, et c'est le texte qui avait tort. La
    cagnotte est un compte, pas un tas pose quelque part; l'attacher a un lieu serait une regle
    de plus a apprendre pour rien.
  */
  room.onMessage('collect', (_d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    if (bankPot(a, 'button') <= 0) refus(a, 'collect', 'nothing to collect')
  })

  room.onMessage('cancelSteal', (_d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (a && enCours.delete(a)) void room.send('stealFailed', { reason: 'cancelled' }, { to: [a] })
  })

  // The base cannot move while somebody is stealing from it: see `placeBase` in plots.ts.
  declarerVolEnCours((address) => {
    for (const v of enCours.values()) if (v.victim === address) return true
    return false
  })

  const dernierePose = new Map<string, number>()
  room.onMessage('claimSlot', (d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    if (!Number.isFinite(d.x) || !Number.isFinite(d.z)) return
    /*
      Every press that does not end in a base is written to the log, with why.

      At the playtest of 17 Nov a tester pressed on a red square, then on a green one, and nothing
      happened; the log could not say why, because a refused or dropped claim left no line at all
      (founder, 18 Nov 2026). Now the next playtest shows each one.
    */
    // One placement a second: each accepted one rebuilds the synced building on every client.
    const t = Date.now()
    if (t - (dernierePose.get(a) ?? 0) < 1000) { log(`build: ${displayName(a)} pressed again within a second, ignored`); return }
    dernierePose.set(a, t)
    const p = positionOf(a)
    if (p === null) { log(`build: ${displayName(a)} refused, position unknown`); refus(a, 'build', 'position unknown'); return }
    const dist = Vector3.distance(p, Vector3.create(d.x, p.y, d.z))
    if (dist > BUILD_RANGE) {
      log(`build: ${displayName(a)} refused, claimed ${d.x},${d.z} from ${dist.toFixed(1)} m away`)
      refus(a, 'build', 'place it where you stand', true)
      return
    }
    const r = placeBase(a, d.x, d.z)
    if (!r.ok) { log(`build: ${displayName(a)} refused at ${d.x},${d.z}: ${r.reason ?? 'refused'}`); refus(a, 'build', r.reason ?? 'refused'); return }
    /*
      A base that lands somewhere other than where the press was has to SAY so, or the player
      looks for it. Same channel as the refusals, under its own action name: since the hammer
      builds on a refused square too (design page 1, point 2), this is the normal answer to that
      press, and the client must not read it as a refusal that hands the marker back.
    */
    if (r.reason !== undefined) refus(a, 'built-nearby', r.reason)
    stepDone(a, 'place')
  })

  timers.setInterval(() => {
    const ps = basePoints()
    void room.send('basePositions', { xs: ps.map((q) => q.x), zs: ps.map((q) => q.z) })
  }, 2500)


  room.onMessage('buySentry', (d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    const r = buySentryFor(a, Number.isInteger(d?.tier) ? d.tier : 0)
    if (!r.ok) { refus(a, 'sentry', r.reason ?? 'refused'); return }
    void room.send('sentryBought', { charges: r.charges ?? 0, cost: r.cost ?? 0, floor: (r.floor ?? 0) + 1 }, { to: [a] })
  })


  room.onMessage('claimQuest', (d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    const r = claimQuestReward(a, d.slot)
    if ('error' in r) { refus(a, 'quest', r.error); return }
    void room.send('questReward', { crate: r.crate }, { to: [a] })
    void room.send('inventory', { crates: cratesOf(a) }, { to: [a] })
    pushQuests(a)
  })

  room.onMessage('claimDaily', (_d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    const dq = reclamerQuotidienne(a)
    if (dq === null) { refus(a, 'daily', 'come back tomorrow'); return }
    void room.send('dailyReward', dq, { to: [a] })
    void room.send('inventory', { crates: cratesOf(a) }, { to: [a] })
    pushQuests(a)
  })


  room.onMessage('buyFloor', (_d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    const r = buyFloorFor(a)
    if (!r.ok) { refus(a, 'floor', r.reason ?? 'refused'); return }
    void room.send('floorBought', { floors: r.floors ?? 1, cost: r.cost ?? 0 }, { to: [a] })
  })


  room.onMessage('buySilo', (_d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    const r = buySiloFor(a)
    if (!r.ok) { refus(a, 'silo', r.reason ?? 'refused'); return }
    void room.send('siloBought', { silos: r.silos ?? 0, cost: r.cost ?? 0, capS: r.capS ?? 0 }, { to: [a] })
  })

  room.onMessage('rebirth', (_d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    const r = tenterRebirth(a)
    if (!r.ok) { refus(a, 'prestige', r.reason ?? 'refused'); return }
    void room.send('rebirthDone', { prestige: r.prestige ?? 0, multiplier: r.multiplier ?? 1 }, { to: [a] })
  })

  room.onMessage('setSkin', (d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    const r = choisirSkin(a, Number.isInteger(d?.mutation) ? d.mutation : 0)
    if (!r.ok) refus(a, 'skin', r.reason ?? 'refused')
  })

  // A setting is the player's own fact about themselves: stored, never validated beyond its type.
  room.onMessage('setPrefs', (d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    setSfxOff(a, d?.sfxOff === true)
  })
  room.onMessage('welcomeSeen', (_d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    setWelcomed(a)
  })

  room.onMessage('awayReady', (_d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    clientPret.add(a)
    accueillir(a)
  })

  room.onMessage('hello', (d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    declareName(a, typeof d?.name === 'string' ? d.name : '')
  })

  room.onMessage('activateLock', (_d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    const reste = lockCooldown(a)
    if (reste > 0) { refus(a, 'lock', `recharging, ${Math.ceil(reste / 1000)}s`); return }
    const duration = LOCK_FREE_MS + lockBonus(a)
    const until = Date.now() + duration
    if (!setLock(a, until)) { refus(a, 'lock', 'no base placed'); return }
    noteLockUse(a, until)
    log(`${displayName(a)} locked their base for ${Math.round(duration / 1000)}s`)
  })

  room.onMessage('reclaim', (_d, ctx) => {
    const victim = ctx?.from?.toLowerCase()
    if (!victim) return
    const p = positionOf(victim)
    if (p === null) { refus(victim, 'recover', 'position unknown'); return }
    /*
      Ask whether it can land before taking it off anybody.

      `addItem` answers with a word and its answer was thrown away here, so a victim whose own
      shelves were full took the item back out of the thief's possession and straight out of
      the game. Settled first, once, for every candidate below.
    */
    if (etatPrevisible(victim) === 'plein') { refus(victim, 'recover', 'your own base is full'); return }

    const maintenant = Date.now()
    for (let i = larcins.length - 1; i >= 0; i--) {
      const l = larcins[i]
      if (l.victim !== victim) continue
      if (maintenant - l.quand > RECOVER_WINDOW_MS) continue

      const pv = positionOf(l.thief)
      if (pv === null) { refus(victim, 'recover', 'the thief is gone'); continue }
      const d = Vector3.distance(p, pv)
      if (d > RECOVER_RANGE) {
        refus(victim, 'recover', `${displayName(l.thief)} is ${d.toFixed(1)}m away, get closer`)
        continue
      }

      /*
        Their hands first, then their shelves. It used to be neither.

        This looked the stolen item up with `nearbyBases(pv, 0.1, '')`, a proximity query with
        a ten-centimetre radius, so it only ever found anything if the thief happened to be
        standing on the exact centre point of their own building. And even standing there it
        would have found nothing, because the whole point of the rework is that a fresh theft
        is in the thief's FIST for the length of the walk home, which is longer than this
        window. Recovery reached for a shelf during the one stretch when the item is never on
        one. Take it out of their hands, and fall back to the shelf for the rare case where
        they got home inside the twenty seconds.
      */
      let repris = arracherDesMains(l.thief, l.code)
      // The shelf only when THIS loot landed there: otherwise the fallback would take an item
      // the thief always owned, while the stolen one lies on the floor or in the fuser.
      if (!repris && l.landed) {
        const bv = baseDe(l.thief)
        const idx = bv === undefined ? -1 : bv.items.lastIndexOf(l.code)
        repris = idx >= 0 && removeItem(l.thief, idx) !== null
      }
      if (!repris) { refus(victim, 'recover', 'they no longer have it'); continue }

      if (addItem(victim, l.code) === 'plein') {
        // Unreachable: capacity was settled above and nothing runs in between. Written down
        // rather than assumed, because the line that assumed it is what deleted the item.
        log(`ERROR recover: ${displayName(victim)} could not receive their own ${rarityOf(l.code)}`)
      }
      larcins.splice(i, 1)
      revengesChanged()
      // Taking it back settles the score: the revenge on that theft goes with it.
      pushRevenges(victim)
      void room.send('reclaimed', {
        byName: displayName(victim), fromName: displayName(l.thief), rarity: rarityOf(l.code)
      })
      log(`${displayName(victim)} took back a ${itemName(rarityOf(l.code), mutationDe(l.code))} from ${displayName(l.thief)}`)
      return
    }
    refus(victim, 'recover', 'nothing to recover')
  })

  timers.setInterval(() => {
    // Kept as long as revenge lasts, since the list IS the revenge list now.
    const t = Date.now() - REVENGE_MS
    while (larcins.length > 0 && larcins[0].quand < t) { larcins.shift(); revengesChanged() }
    const now = Date.now()
    for (const [a, until] of tenues) if (until <= now) tenues.delete(a)
    if (revengesDirty) saveRevenges()
  }, 10000)
  loadRevenges()

  log('steal layer ready')
}
