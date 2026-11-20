import { engine, Transform, timers } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import {
  Convoy, CONVOY_SPEED, CONVOY_MIN_S, CONVOY_OUTBID, CONVOY_RANGE,
  convoyPosition, convoyLongueur
} from '../shared/schemas'
import { room } from '../shared/messages'
import { log } from './log'
import {
  positionOf, displayName, addCrate, cratesOf, spend, crediter, baseDe, advanceQuest, pushQuests
} from './plots'
import { crate } from '../shared/loot-table'
import { bankToCover } from './collect'
import { stepDone } from './onboarding'

type State = {
  id: number
  entity: ReturnType<typeof engine.addEntity>
  crateTier: number
  /** What an outbid is computed on: the list price at the belt, then each outbid's price. */
  pricePaid: number
  /** What the holder really paid, and gets back when outbid: less than `pricePaid` for a newcomer's first box. */
  refund: number
  owner: string
  depart: { x: number; z: number }
  cible: { x: number; z: number }
  debutMs: number
  durationMs: number
}

const convoys = new Map<number, State>()
let prochainId = 1

function durationMs(depart: { x: number; z: number }, cible: { x: number; z: number }): number {
  // The route's length, not the crow's flight: the crate goes round by the street.
  const d = convoyLongueur(depart, cible)
  return Math.max(CONVOY_MIN_S, d / CONVOY_SPEED) * 1000
}

function publish(e: State): void {
  const c = Convoy.getMutableOrNull(e.entity)
  if (c === null) return
  c.convoyId = e.id
  c.crateTier = e.crateTier
  c.pricePaid = e.pricePaid
  c.owner = e.owner
  c.holderName = displayName(e.owner)
  c.departX = e.depart.x; c.departZ = e.depart.z
  c.cibleX = e.cible.x;   c.cibleZ = e.cible.z
}

function position(e: State, t: number): { x: number; z: number } {
  return convoyPosition(e.depart, e.cible, t)
}

/**
 * Starts a convoy. Returns false when the buyer has no base yet: the caller then delivers
 * straight to inventory, rather than blocking a purchase and breaking the tutorial order.
 */
export function startConvoy(buyer: string, crateTier: number, price: number, from: { x: number; z: number }, paid: number = price): boolean {
  const b = baseDe(buyer)
  if (b === undefined) return false

  const e: State = {
    id: prochainId++,
    entity: engine.addEntity(),
    crateTier,
    pricePaid: price,
    refund: paid,
    owner: buyer,
    depart: { x: from.x, z: from.z },
    cible: { x: b.x, z: b.z },
    debutMs: Date.now(),
    durationMs: 0
  }
  e.durationMs = durationMs(e.depart, e.cible)

  Transform.create(e.entity, { position: Vector3.create(e.depart.x, 1.0, e.depart.z) })
  Convoy.create(e.entity, {
    convoyId: e.id, crateTier, pricePaid: price,
    owner: buyer, holderName: displayName(buyer),
    progres: 0,
    departX: e.depart.x, departZ: e.depart.z, cibleX: e.cible.x, cibleZ: e.cible.z
  })
  syncEntity(e.entity, [Convoy.componentId, Transform.componentId])
  convoys.set(e.id, e)
  log(`convoy ${e.id}: ${crate(crateTier).name} to ${displayName(buyer)}, window ${Math.round(e.durationMs / 1000)}s`)
  return true
}

/** Convoys left by a previous server: same trail as the belt and the loot piles. */
export function sweepConvoys(): void {
  let n = 0
  for (const [e] of engine.getEntitiesWith(Convoy)) {
    if ((e & 0xffff) < 512) continue
    engine.removeEntity(e); n += 1
  }
  if (n > 0) log(`swept ${n} convoy(s) left by a previous server`)
}

export function runConvoys(): void {
  room.onMessage('outbid', (d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    const e = convoys.get(d.convoyId)
    if (e === undefined) { refus(a, 'it already arrived'); return }
    if (e.owner === a) { refus(a, 'it is already yours'); return }
    if (baseDe(a) === undefined) { refus(a, 'place your base first'); return }

    const p = positionOf(a)
    if (p === null) { refus(a, 'position unknown'); return }
    const ici = position(e, (Date.now() - e.debutMs) / e.durationMs)
    const dist = Math.sqrt((ici.x - p.x) ** 2 + (ici.z - p.z) ** 2)
    if (dist > CONVOY_RANGE) { refus(a, `too far (${dist.toFixed(1)}m)`, true); return }

    /*
      No pause between outbids (founder, 18 Nov 2026). A player who had just been outbid could
      not be outbid again for 30 s, and a convoy mostly arrives within 30 s, so a duel stopped at
      the second outbid: testers said they could only outbid twice (playtest of 17 Nov). Each
      outbid costs half as much again as the last, which ends a bidding war by itself, and the
      holder who loses the crate is refunded in full.
    */
    const price = Math.ceil(e.pricePaid * CONVOY_OUTBID)
    // A short balance is topped up from the pot when the pot covers it, as at the belt.
    if (!bankToCover(a, price, 'to outbid') || !spend(a, price)) { refus(a, `you need ${price} coins`); return }

    // The outbid holder is refunded in full. Without it, buying early would be strictly
    // losing and nobody would ever buy before the belt's end.
    crediter(e.owner, e.refund)
    const previous = e.owner
    void room.send('outbidLost', { byName: displayName(a), rembourse: e.refund, crateTier: e.crateTier }, { to: [previous] })

    const nb = baseDe(a)
    if (nb === undefined) return
    e.depart = { x: ici.x, z: ici.z }
    e.cible = { x: nb.x, z: nb.z }
    e.owner = a
    e.pricePaid = price
    e.refund = price
    e.debutMs = Date.now()
    e.durationMs = durationMs(e.depart, e.cible)
    publish(e)

    void room.send('outbidWon', { fromName: displayName(previous), price, crateTier: e.crateTier }, { to: [a] })
    void room.send('outbidFeed', { byName: displayName(a), fromName: displayName(previous), price })
    advanceQuest(a, 'outbid')
    // An outbid is a purchase: the tutorial's Buy step pulses on OUTBID too, and it now completes on it.
    stepDone(a, 'buy')
    pushQuests(a)
    log(`convoy ${e.id}: ${displayName(a)} outbid ${displayName(previous)} for ${price}`)
  })

  // Ten writes a second, like the belt: the client animates from `progres` and only corrects
  // its clock with what it receives, so thirty full component resends a second bought nothing.
  let sync = 0
  engine.addSystem((dt: number) => {
    const maintenant = Date.now()
    sync += dt
    const publier = sync >= 0.1
    if (publier) sync = 0
    for (const [id, e] of [...convoys]) {
      const t = (maintenant - e.debutMs) / e.durationMs
      if (publier || t >= 1) {
        const c = Convoy.getMutableOrNull(e.entity)
        if (c !== null) c.progres = Math.max(0, Math.min(1, t))
        const pos = position(e, t)
        const tr = Transform.getMutableOrNull(e.entity)
        if (tr !== null) tr.position = Vector3.create(pos.x, 1.0, pos.z)
      }
      if (t < 1) continue

      addCrate(e.owner, e.crateTier)
      void room.send('inventory', { crates: cratesOf(e.owner) }, { to: [e.owner] })
      void room.send('convoyArrived', { crateTier: e.crateTier }, { to: [e.owner] })
      log(`convoy ${id}: delivered to ${displayName(e.owner)}`)
      Convoy.deleteFrom(e.entity)
      engine.removeEntity(e.entity)
      convoys.delete(id)
    }
  })

  log('convoys ready')
}

function refus(a: string, reason: string, antiCheat = false): void {
  void room.send('actionRejected', { action: 'outbid', reason, antiCheat }, { to: [a] })
}
