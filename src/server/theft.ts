import { engine, Transform, PlayerIdentityData, timers } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import {
  STEAL_RANGE, STEAL_REACH, STEAL_HOLD_REACH, GIFT_RANGE, STEAL_BASE_MS, STEAL_PER_RARITY_MS, RECOVER_RANGE, LOCK_ON_ARRIVAL_MS, LOCK_FREE_MS, SENTRY_FREEZE_MS, SENTRY_LOCK_MS,
  LOCK_BONUS_MS, PENALTY_MS, RECOVER_WINDOW_MS, CARRY_GRIP, SENTRY_TIERS, SHOT_MIN_YIELD, prixParCharge, shieldFor, REVENGE_MS, SLOTS_PER_FLOOR, VIDE, occupe
} from '../shared/schemas'

const BUILD_RANGE = 7
import { room } from '../shared/messages'
import { noter } from './records'
import {
advanceQuest, claimQuestReward, cratesOf, pushQuests, baseDe, useSentryCharge, sentriesOf, buySentryFor, presents, positionObjet, inReach, etatPrevisible, incomePerSecond, spend, incomePerItem, absenceDe, sentriesOnFloor, compterVol, choisirSkin, setSfxOff, reclamerQuotidienne, declareName
} from './plots'
import { dropAt } from './coins'
import { tutoFait } from './onboarding'
import { remettreEnMain, carriesFor, forcerLacher, arracherDesMains, setLandedHook } from './carry'
import { rarityOf, mutationDe, itemName } from '../shared/loot-table'
import { log } from './log'
import {
  nearbyBases, lockOf, setLock, noteLockUse, removeItem, addItem,
  displayName, storeAlert, takeAlerts, coinsOf, tenterRebirth, prestigeOf,
  placeBase, basePoints, buyFloorFor, buySiloFor, lockCooldown, declarerVolEnCours
} from './plots'

/*
  `code`, not `rarity`. An item is `rarity * 100 + mutation`, and this field has always held
  the whole code; calling it a rarity is how it ended up sent as one to the client, which read
  a 402 as rarity 402, fell back to entry zero, and told the room that a Legendary recovered in
  front of witnesses was a Common.
*/
type Larcin = { thief: string; victim: string; code: number; quand: number; landed: boolean }
const larcins: Larcin[] = []
/** Until when a thief frozen by a sentry may not start a theft: the freeze used to be client-side only. */
const geles = new Map<string, number>()

/** Stolen loot reached the thief's own shelf: the most recent open entry for that code. */
export function noteLanded(thief: string, code: number): void {
  for (let i = larcins.length - 1; i >= 0; i--) {
    const l = larcins[i]
    if (l.thief === thief && l.code === code && !l.landed) { l.landed = true; return }
  }
}
setLandedHook(noteLanded)

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

export function delivrerAlertes(address: string): void {
  const a = takeAlerts(address)
  if (a.length === 0) return
  for (const alert of a) {
    const x = alert as { type?: string; byName: string; rarity?: number; mutation?: number; code?: number }
    if (x.type === 'sentry') {
      const y = x as { left?: number; taken?: number }
      void room.send('sentryTriggered', { byName: x.byName, left: y.left ?? 0, taken: y.taken ?? 0 }, { to: [address] })
      continue
    }
    if (x.type === 'trap') {
      void room.send('trapSprung', { byName: x.byName }, { to: [address] })
      continue
    }
    if (x.type === 'gift') {
      const code = x.code ?? 0
      void room.send('wasGifted', { byName: x.byName, rarity: rarityOf(code), mutation: mutationDe(code) }, { to: [address] })
      continue
    }
    void room.send('youWereRobbed', {
      byName: x.byName, rarity: x.rarity ?? 0, mutation: x.mutation ?? 0,
      shieldSec: (x as { shieldSec?: number }).shieldSec ?? 0
    }, { to: [address] })
  }
  log(`${a.length} alert(s) differee(s) delivree(s) a ${displayName(address)}`)
}

/** Has `cible` taken something from `moi` recently enough to owe them an open door? */
function meDoitUneRevanche(moi: string, cible: string): boolean {
  const t = Date.now()
  return larcins.some((l) => l.thief === cible && l.victim === moi && t - l.quand <= REVENGE_MS)
}

export function hasSomethingToRecover(address: string): boolean {
  const t = Date.now()
  return larcins.some((l) => l.victim === address && t - l.quand <= RECOVER_WINDOW_MS)
}

type EnCours = { victim: string; slot: number; code: number; fin: number; total: number; grip: number }
const enCours = new Map<string, EnCours>()

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

      // ABOUTI: l'objet change enfin de main.
      enCours.delete(thief)
      const idx = b.items.indexOf(v.code)
      if (idx < 0) { void room.send('stealFailed', { reason: 'it is gone' }, { to: [thief] }); continue }
      const r = removeItem(v.victim, idx)
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
      larcins.push({ thief, victim: v.victim, code: r, quand: maintenant, landed: false })
      compterVol(thief)
      // The last tutorial step is the game's core verb: a theft that reached the hands (27 Aug).
      tutoFait(thief, 4)
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
      const bouclier = shieldFor(absenceDe(v.victim))
      setLock(v.victim, maintenant + bouclier)

      const nomV = displayName(thief)
      const rar = rarityOf(r), mut = mutationDe(r)
      storeAlert(v.victim, { byName: nomV, rarity: rar, mutation: mut, shieldSec: Math.round(bouclier / 1000) })
      void room.send('youWereRobbed', {
        byName: nomV, rarity: rar, mutation: mut, shieldSec: Math.round(bouclier / 1000)
      }, { to: [v.victim] })
      void room.send('stolen', { byName: nomV, fromName: b.name, rarity: rar, mutation: mut })
      log(`${nomV} took a ${itemName(rar, mut)} from ${b.name}; shield ${Math.round(bouclier / 60000)} min (away ${Math.round(absenceDe(v.victim) / 60000)} min)`)
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
        refus(thief, 'steal', `${c.name} is shielded for ${Math.ceil((lock - maintenant) / 1000)}s`)
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
    // One placement a second: each accepted one rebuilds the synced building on every client.
    const t = Date.now()
    if (t - (dernierePose.get(a) ?? 0) < 1000) return
    dernierePose.set(a, t)
    const p = positionOf(a)
    if (p === null) { refus(a, 'build', 'position unknown'); return }
    const dist = Vector3.distance(p, Vector3.create(d.x, p.y, d.z))
    if (dist > BUILD_RANGE) {
      refus(a, 'build', 'place it where you stand', true)
      return
    }
    const r = placeBase(a, d.x, d.z)
    if (!r.ok) { refus(a, 'build', r.reason ?? 'refused'); return }
    // Une base qui atterrit ailleurs que la ou on a appuye doit le DIRE, sinon le joueur la
    // cherche. Le meme canal que les refus: c'est une information, pas une erreur.
    if (r.reason !== undefined) refus(a, 'build', r.reason)
    tutoFait(a, 0)
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
    while (larcins.length > 0 && larcins[0].quand < t) larcins.shift()
  }, 10000)

  log('steal layer ready')
}
