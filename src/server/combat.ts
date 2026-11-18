import { engine, Transform, PlayerIdentityData, timers } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import {
  DroppedCoins, SHOT_RANGE, SHOT_COOLDOWN_MS, inShotCone, SHOT_DROP_SHARE, LOOT_OWNER_LOCK_MS, forceDuTir,
  LOOT_PICKUP_RANGE, LOOT_LIFETIME_MS, SLAP_RANGE, SLAP_COOLDOWN_MS, TASER_COOLDOWN_MS, TASER_FREEZE_MS
, MELEE_FORCE, SAME_STOREY} from '../shared/schemas'
import { room } from '../shared/messages'
import { log } from './log'
import { hitCarrier, carriesFor } from './carry'
import { interrompreVol, isPrying } from './theft'
import { positionOf, displayName, incomePerSecond, crediter, spend, coinsOf, presents, gearsOf, memeEspace, shelteredAtHome } from './plots'
import { dropAt } from './coins'
import { raidHit } from './raid'

/**
 * Combat, server side.
 *
 * The client says "I fired towards this point"; it never says who it hit. The server
 * resolves the shot against the positions it reads itself from PlayerIdentityData, the
 * same source it uses for theft range. A hit does not kill: it knocks coins loose.
 */

const lastShot = new Map<string, number>()

export function startCombat(): void {
  // Same trail as the belt: coins dropped by a server that no longer exists would sit on
  // the ground for ever, pickable and never expiring, because nothing ticks their timer.
  let vieux = 0
  for (const [e] of engine.getEntitiesWith(DroppedCoins)) {
    if ((e & 0xffff) < 512) continue
    engine.removeEntity(e); vieux += 1
  }
  if (vieux > 0) log(`swept ${vieux} pile(s) left by a previous server`)

  // Drawing a weapon is public: relayed so every client shows the same armed players.
  // Relayed on a change of state only, and never twice in 150 ms: a client repeating `aim`
  // at full speed used to make every other client rebuild the weapon entities per message.
  const dernierAim = new Map<string, { etat: string; t: number }>()
  room.onMessage('aim', (d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    const arme = Number.isInteger(d?.arme) ? d.arme : 0
    const etat = `${d.on ? 1 : 0}:${arme}`
    const avant = dernierAim.get(a)
    const t = Date.now()
    if (avant !== undefined && (avant.etat === etat || t - avant.t < 150)) return
    dernierAim.set(a, { etat, t })
    void room.send('aiming', { addr: a, on: d.on, arme })
  })

  /*
    One resolution for two weapons.

    A slap is a shot with the reach of an arm, and nothing else differs on the server: the
    same cone, the same nearest-target rule, the same disarm and coin logic afterwards. So the
    lookup is one function with a range parameter, and the two handlers below differ only in
    what reach they ask for, what cooldown they keep, and what force they land with.
  */
  function cible(a: string, from: Vector3, d: { x: number; z: number }, portee: number): { addr: string; pos: Vector3; d: number } | null {
    // Nearest player along the aim, within range. The server owns every position here.
    const aim = Vector3.normalize(Vector3.create(d.x - from.x, 0, d.z - from.z))
    let best: { addr: string; pos: Vector3; d: number } | null = null
    for (const [ent, id] of engine.getEntitiesWith(PlayerIdentityData)) {
      const other = id.address?.toLowerCase()
      if (!other || other === a) continue
      const t = Transform.getOrNull(ent)
      if (t === null) continue
      const to = Vector3.create(t.position.x - from.x, 0, t.position.z - from.z)
      const dist = Vector3.length(to)
      if (dist > portee || dist < 0.5) continue
      // Un mur entre les deux, et il n'y a pas de tir.
      if (!memeEspace(from.x, from.z, t.position.x, t.position.z)) continue
      // Same cone the client draws its reticle from, so both agree on what is a target.
      const dot = (to.x * aim.x + to.z * aim.z) / dist
      if (!inShotCone(dist, dot)) continue
      if (best === null || dist < best.d) {
        best = { addr: other, pos: Vector3.create(t.position.x, t.position.y, t.position.z), d: dist }
      }
    }
    return best
  }

  /*
    A short immunity for a player who is being hammered (founder, 18 Nov 2026).

    Without coins to win the spam has no reason left, but the target still had no defence away
    from home: hit after hit, flash after flash. After six hits landed on them inside three
    seconds, from anyone, they cannot be hit for three seconds; the same idea as World of
    Warcraft's immunity after repeated stuns. It covers only a player who carries nothing and is
    not stealing: a thief running home with a piece stays open to every shot, or the escape
    shootout, the part testers liked best, would end after six hits.
  */
  const HIT_BURST = 6
  const HIT_BURST_MS = 3_000
  const HIT_IMMUNE_MS = 3_000
  const recentHits = new Map<string, number[]>()
  const immuneUntil = new Map<string, number>()
  function innocent(target: string): boolean { return !carriesFor(target) && !isPrying(target) }
  function immuneNow(target: string, now: number): boolean {
    return innocent(target) && (immuneUntil.get(target) ?? 0) > now
  }
  function noteHit(target: string, now: number): void {
    if (!innocent(target)) return
    const hits = (recentHits.get(target) ?? []).filter((t) => now - t < HIT_BURST_MS)
    hits.push(now)
    if (hits.length >= HIT_BURST) {
      immuneUntil.set(target, now + HIT_IMMUNE_MS)
      recentHits.delete(target)
      log(`${displayName(target)} is immune to hits for ${HIT_IMMUNE_MS / 1000} s after ${HIT_BURST} in ${HIT_BURST_MS / 1000} s`)
      return
    }
    recentHits.set(target, hits)
  }

  /** What a shooter may still shake loose: a tenth of their production, banked up to ten seconds of it. */
  const SHOT_PAY_SHARE = 0.1
  const SHOT_PAY_BURST_S = 10
  /** Each repeat paying hit on the same player pays this much less; the count resets after a quiet minute. */
  const REPEAT_STEP = 0.25
  const REPEAT_RESET_MS = 60_000
  const budgets = new Map<string, { coins: number; at: number }>()
  const repeats = new Map<string, { n: number; at: number }>()
  function shotBudget(a: string, now: number): number {
    const rate = incomePerSecond(a) * SHOT_PAY_SHARE
    const full = rate * SHOT_PAY_BURST_S
    const b = budgets.get(a)
    const coins = b === undefined ? full : Math.min(full, b.coins + rate * (now - b.at) / 1000)
    budgets.set(a, { coins, at: now })
    return coins
  }
  function spendBudget(a: string, amount: number): void {
    const b = budgets.get(a)
    if (b !== undefined) b.coins = Math.max(0, b.coins - amount)
  }

  function frapper(a: string, d: { x: number; z: number }, portee: number, cooldown: number, pleineForce: boolean): void {
    const now = Date.now()
    if ((lastShot.get(a) ?? 0) + cooldown > now) return
    lastShot.set(a, now)

    const from = positionOf(a)
    if (from === null) return
    // A raid boss in the line of fire takes the hit before any player does.
    if (raidHit(a, from, d, pleineForce ? MELEE_FORCE : 1)) {
      void room.send('shotResult', { hitName: 'RAID BOSS', dropped: 0, reason: 'boss', loot: 0 }, { to: [a] })
      return
    }
    const best = cible(a, from, d, portee)

    if (best === null) {
      void room.send('shotResult', { hitName: '', dropped: 0, reason: 'missed', loot: 0 }, { to: [a] })
      return
    }

    /*
      A shielded owner standing in their own base cannot be touched.

      Checked BEFORE anything lands, so the round costs its cooldown and does nothing else: no
      grip loosened, no theft cut, no coin dropped. This one is SPOKEN, unlike the wall, which
      stays mute: a wall explains itself by being a wall, whereas nothing on screen tells the
      shooter why a round that clearly reached its target did nothing at all.
    */
    if (shelteredAtHome(best.addr)) {
      void room.send('shotResult', {
        hitName: displayName(best.addr), dropped: 0, reason: 'shielded', loot: 0
      }, { to: [a] })
      return
    }
    if (immuneNow(best.addr, now)) {
      void room.send('shotResult', { hitName: displayName(best.addr), dropped: 0, reason: 'immune', loot: 0 }, { to: [a] })
      return
    }
    noteHit(best.addr, now)

    // A share of what the target is CARRYING, capped so a rich player never loses a
    /*
      Hands before pockets.

      Everything below can return early: a target with no coins, or no income to cap against,
      produces "nothing to drop" and the function ends. That put the one player a bullet
      really ought to disarm, a thief who has just spent everything or never had anything, out
      of reach of being disarmed at all. What they are holding is settled first, and the shot
      reports both facts in one message rather than two, the second of which used to erase the
      first on the way to the screen.
    */
    /*
      One shot, one strength, spent on everything it touches.

      How much a hit is worth falls with the square of the distance, so the same number
      loosens a grip, breaks a theft in progress and shakes coins loose, and a player learns
      all three by learning one. It replaced a hard ten-metre cut that did everything on one
      side and nothing on the other, which balanced the chase and asked the player to discover
      an invisible wall.
    */
    // An arm at full reach lands with everything; a bullet fades with the square of the range.
    const force = pleineForce ? MELEE_FORCE : forceDuTir(best.d)
    const butin = hitCarrier(best.addr, force)
    // A shot lands on the prying too, which is the one window a gun used to do nothing about.
    const coupe = interrompreVol(best.addr, force)
    const codeButin = butin === 'lache' ? 2
      : coupe === 'coupe' ? 3
      : (butin === 'ebranle' || coupe === 'ebranle') ? 1
      : 0

    /*
      Shooting pays, but it is never worth more than playing (founder, 18 Nov 2026).

      A hit was worth up to eight seconds of the shooter's own income, at four hits a second, with a
      floor of 67 coins: a burst of fire earned up to thirty-two times what the shooter's shelves
      made in the same time, and a brand-new account earned about 268 coins a second against seven
      from its first piece. At the playtest of 17 Nov one new account landed 1,151 hits, 797 of them
      on one player, for 35 M. Coins still drop, so a hit still means something; two rules keep the
      gun a nuisance and never a job:
      - over time, shooting pays at most a tenth of what the shooter's own base produces: a budget
        that fills at that rate and holds ten seconds of it, so farming crates and stealing pieces
        stay far ahead, and an account with nothing on its shelves earns nothing by shooting;
      - hitting the same player again pays less each time, a quarter less per hit and nothing from
        the fifth, until a minute passes without hitting them: harassing one victim stops paying,
        and that victim loses a few small sums. This is the rule of World of Warcraft Classic's
        honour, where killing the same player again gave 25 % less honour each time (10 % from patch
        1.12), down to nothing for the day.
      The starting values are to be measured at the next playtest.
    */
    const key = `${a}|${best.addr}`
    const seen = repeats.get(key)
    const n = seen !== undefined && now - seen.at < REPEAT_RESET_MS ? seen.n : 0
    const factor = Math.max(0, 1 - REPEAT_STEP * n)
    const budget = shotBudget(a, now)
    // Pockets pay by the same rule: a shot from across the plaza shakes less loose.
    const wanted = Math.floor(coinsOf(best.addr) * SHOT_DROP_SHARE * force * factor)
    const amount = Math.max(0, Math.min(wanted, Math.floor(budget)))
    // Every hit on that player keeps the count alive, paying or not: spamming never resets it.
    repeats.set(key, { n: amount > 0 ? n + 1 : n, at: now })
    if (amount > 0) spendBudget(a, amount)
    if (amount <= 0 || !spend(best.addr, amount)) {
      void room.send('shotResult', {
        hitName: displayName(best.addr), dropped: 0,
        reason: codeButin > 0 ? 'hit' : 'nothing to drop', loot: codeButin
      }, { to: [a] })
      if (codeButin > 0) void room.send('wasShot', { byName: displayName(a), lost: 0 }, { to: [best.addr] })
      log(`${displayName(a)} hit ${displayName(best.addr)} for nothing (repeat ${n}), loot ${butin}`)
      return
    }

    dropAt(best.addr, amount, best.pos)
    void room.send('shotResult', {
      hitName: displayName(best.addr), dropped: amount, reason: 'hit', loot: codeButin
    }, { to: [a] })
    void room.send('wasShot', { byName: displayName(a), lost: amount }, { to: [best.addr] })
    log(`${displayName(a)} hit ${displayName(best.addr)} for ${amount} dropped (repeat ${n}), loot ${butin}`)
  }

  room.onMessage('shoot', (d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (a) frapper(a, d, SHOT_RANGE, SHOT_COOLDOWN_MS, false)
  })

  // The slap is only honoured for a player who holds one; the client asking is not proof.
  room.onMessage('slap', (d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    if (gearsOf(a)[2] <= 0) return
    frapper(a, d, SLAP_RANGE, SLAP_COOLDOWN_MS, true)
  })

  /*
    The taser is a slap that also freezes. The target is resolved here first, with the same
    function the hit uses, so the freeze goes to exactly the player the hit lands on; the
    cooldown is checked here too, because a hit refused for cadence must not freeze anybody.
  */
  room.onMessage('taser', (d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    if (gearsOf(a)[5] <= 0) return
    const now = Date.now()
    if ((lastShot.get(a) ?? 0) + TASER_COOLDOWN_MS > now) return
    const from = positionOf(a)
    if (from === null) return
    const best = cible(a, from, d, SLAP_RANGE)
    frapper(a, d, SLAP_RANGE, TASER_COOLDOWN_MS, true)
    // The freeze is resolved here rather than inside `frapper`, so the shelter has to be
    // asked about twice: a shielded owner who could not be hit must not be frozen either.
    if (best === null || shelteredAtHome(best.addr) || immuneNow(best.addr, now)) return
    void room.send('tased', { byName: displayName(a), gelMs: TASER_FREEZE_MS }, { to: [best.addr] })
    log(`${displayName(a)} tased ${displayName(best.addr)}`)
  })

  // Pickup and decay.
  let acc = 0
  engine.addSystem((dt) => {
    acc += dt
    if (acc < 0.3) return
    acc = 0
    const now = Date.now()
    const ici = [...presents()]
    for (const [ent, c] of engine.getEntitiesWith(DroppedCoins)) {
      const t = Transform.getOrNull(ent)
      if (t === null) continue
      if (c.untilMs < now) { engine.removeEntity(ent); continue }
      /*
        The nearest eligible player takes it, and for the first few seconds the player it
        fell from is not eligible.

        This used to credit the first player found within range, in whatever order the
        roster happened to be in. The pile lands on the victim, so the victim was always
        within range and usually first: they picked their own coins straight back up and a
        hit was worth nothing to anybody. Nearest rather than first also settles the case
        where two people arrive together.
      */
      const ouvert = c.untilMs - LOOT_LIFETIME_MS + LOOT_OWNER_LOCK_MS
      let gagnant: string | null = null
      let plusPres = LOOT_PICKUP_RANGE
      for (const addr of ici) {
        if (addr === c.droppedBy && now < ouvert) continue
        const p = positionOf(addr)
        if (p === null) continue
        // Same rule as a dropped piece: a pile lies on a storey, and you reach it from there.
        if (Math.abs(p.y - t.position.y) > SAME_STOREY) continue
        const d = Math.sqrt((p.x - t.position.x) ** 2 + (p.z - t.position.z) ** 2)
        if (d > plusPres) continue
        plusPres = d
        gagnant = addr
      }
      if (gagnant !== null) {
        crediter(gagnant, c.amount)
        void room.send('pickedUp', { amount: c.amount }, { to: [gagnant] })
        log(`${displayName(gagnant)} picked up ${c.amount}`)
        engine.removeEntity(ent)
      }
    }
  })

  log('combat ready')
}
