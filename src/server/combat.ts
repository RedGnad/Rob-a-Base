import { engine, Transform, PlayerIdentityData, timers } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import {
  DroppedCoins, SHOT_RANGE, SHOT_COOLDOWN_MS, inShotCone, SHOT_DROP_SHARE, SHOT_MIN_YIELD, LOOT_OWNER_LOCK_MS, forceDuTir,
  SHOT_DROP_CAP_S, LOOT_PICKUP_RANGE, LOOT_LIFETIME_MS, SLAP_RANGE, SLAP_COOLDOWN_MS, TASER_COOLDOWN_MS, TASER_FREEZE_MS
, MELEE_FORCE, SAME_STOREY} from '../shared/schemas'
import { room } from '../shared/messages'
import { log } from './log'
import { hitCarrier } from './carry'
import { interrompreVol } from './theft'
import { positionOf, displayName, incomePerSecond, crediter, spend, coinsOf, presents, gearsOf, memeEspace } from './plots'
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

    // fortune to one shot, and floored by nothing: shooting a broke player yields nothing.
    /*
      How much a shot is worth is decided by the SHOOTER's economy, not the target's.
      
      This was eight seconds of the target's income, which caps nothing from the attacker's
      side: it scales with the victim. Measured, a brand-new account shooting a developed
      base three times collected around two hundred and ninety-seven thousand coins, a
      hundred and forty-seven Basic crates, without playing. A currency source that pays out
      far beyond every other one is the definition of a faucet the sinks cannot answer, and
      it makes the entire progression curve above it decorative.
      
      Scaled to the shooter it behaves: peers still take real money off each other, because
      their incomes are alike, and a newcomer emptying a whale takes a nuisance rather than a
      fortune. It also means the weapon levels up with the player's own base, without a single
      new system to buy or explain: your gun is already as good as your tycoon.
      
      This part is reasoning rather than citation. The framing is documented, a faucet
      outrunning its sinks inflates the economy; the specific rule of scaling a PvP yield to
      the attacker is ours, and it is written here so it can be argued with later.
    */
    const cap = Math.max(SHOT_MIN_YIELD, Math.floor(incomePerSecond(a) * SHOT_DROP_CAP_S))
    // Pockets pay by the same rule: a shot from across the plaza shakes less loose.
    const wanted = Math.floor(coinsOf(best.addr) * SHOT_DROP_SHARE * force)
    const amount = Math.max(0, Math.min(wanted, cap))
    if (amount <= 0 || !spend(best.addr, amount)) {
      void room.send('shotResult', {
        hitName: displayName(best.addr), dropped: 0,
        reason: codeButin > 0 ? 'hit' : 'nothing to drop', loot: codeButin
      }, { to: [a] })
      if (codeButin > 0) void room.send('wasShot', { byName: displayName(a), lost: 0 }, { to: [best.addr] })
      log(`${displayName(a)} hit ${displayName(best.addr)} for nothing, loot ${butin}`)
      return
    }

    dropAt(best.addr, amount, best.pos)
    void room.send('shotResult', {
      hitName: displayName(best.addr), dropped: amount, reason: 'hit', loot: codeButin
    }, { to: [a] })
    void room.send('wasShot', { byName: displayName(a), lost: amount }, { to: [best.addr] })
    log(`${displayName(a)} hit ${displayName(best.addr)} for ${amount} dropped, loot ${butin}`)
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
    if (best === null) return
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
