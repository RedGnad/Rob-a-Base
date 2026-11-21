import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import {
  GEARS, Trap, TRAP_TRIGGER_RANGE, MINE_FREEZE_MS, prixGear, luckCost, LUCK_MS,
  Cloaked, CLOAK_MS, CLOAK_COOLDOWN_MS, Bomb, BOMB_FUSE_MS, BOMB_RADIUS, shieldFor
} from '../shared/schemas'
import { room } from '../shared/messages'
import { log } from './log'
import {
  displayName, presents, positionOf, spend, prestigeOf,
  gearsOf, addGear, removeGear, storeAlert, baseDe, luckUntilOf, setLuckUntil, luckBuysOf, noteLuckBuy,
  placedOnBase, placeOnBase, removeFromBase, toutesLesBases, absenceDe, raiseKeepOutField
} from './plots'
import { banFromBase } from './bans'
import { carriesFor, hitCarrier, carriedDetail, forcerLacher } from './carry'

/**
 * Gear, server side: bought into a pocket, put down where you stand, and it acts on its own.
 *
 * Three rules from the genre, each enforced here rather than trusted to the client. A gear is
 * gated by prestige, so the door prestige opens is a real door. It cannot be used while
 * carrying loot, so nothing a thief buys makes the walk home safe. And a placed thing has a
 * count: five plates, two mines. Plates and mines go inside their owner's own base and wait
 * there until somebody steps on them, so nobody else's floor fills with them.
 */

function placedTraps(address: string, gear: number): number {
  let n = 0
  if (gear === 0) n += placedOnBase(address).filter((m) => m.plate === true).length
  if (gear === 7) n += placedOnBase(address).filter((m) => m.plate !== true).length
  if (gear === 4) for (const [, b] of engine.getEntitiesWith(Bomb)) if (b.owner === address) n += 1
  return n
}

const capes = new Map<string, ReturnType<typeof engine.addEntity>>()
const dernierCloak = new Map<string, number>()

/** Called by carry when a hand closes on something: the cloak ends there, not on its timer. */
export function rompreCape(address: string): void {
  const e = capes.get(address)
  if (e === undefined) return
  capes.delete(address)
  engine.removeEntity(e)
  log(`${displayName(address)}'s cloak broke on touching loot`)
}

export function startGear(): void {
  // Entities left by a previous server: plates and mines are grown again from the base records below.
  let vieux = 0
  for (const [e] of engine.getEntitiesWith(Trap)) {
    if ((e & 0xffff) < 512) continue
    engine.removeEntity(e); vieux += 1
  }
  for (const [e] of engine.getEntitiesWith(Bomb)) {
    if ((e & 0xffff) < 512) continue
    engine.removeEntity(e); vieux += 1
  }
  for (const [e] of engine.getEntitiesWith(Cloaked)) {
    if ((e & 0xffff) < 512) continue
    engine.removeEntity(e); vieux += 1
  }
  if (vieux > 0) log(`swept ${vieux} trap(s) left by a previous server`)

  room.onMessage('buyGear', (d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    const gear = Number.isInteger(d?.gear) ? d.gear : -1
    const g = GEARS[gear]
    if (g === undefined) return
    if (prestigeOf(a) < g.prestige) {
      void room.send('actionRejected', { action: 'gear', reason: `${g.name} unlocks at prestige ${g.prestige}`, antiCheat: false }, { to: [a] })
      return
    }
    // The cap counts pocket AND floor together, as the reference does: five, wherever they are.
    if (gearsOf(a)[gear] + placedTraps(a, gear) >= g.max) {
      void room.send('actionRejected', { action: 'gear', reason: `you already have ${g.max} ${g.name.toLowerCase()}s out or in your pocket`, antiCheat: false }, { to: [a] })
      return
    }
    const cost = prixGear(gear)
    if (!spend(a, cost)) {
      void room.send('actionRejected', { action: 'gear', reason: `you need ${cost} coins`, antiCheat: false }, { to: [a] })
      return
    }
    addGear(a, gear)
    void room.send('gearBought', { gear, held: gearsOf(a)[gear], cost }, { to: [a] })
    log(`${displayName(a)} bought a ${g.name} for ${cost}`)
  })

  room.onMessage('placeGear', (d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    const gear = Number.isInteger(d?.gear) ? d.gear : -1
    const g = GEARS[gear]
    if (g === undefined || g.kind !== 'place') return
    if (carriesFor(a)) {
      void room.send('actionRejected', { action: 'gear', reason: 'not while carrying something', antiCheat: false }, { to: [a] })
      return
    }
    if (gearsOf(a)[gear] <= 0) {
      void room.send('actionRejected', { action: 'gear', reason: `no ${g.name.toLowerCase()} in your pocket`, antiCheat: false }, { to: [a] })
      return
    }
    const p = positionOf(a)
    if (p === null) return
    if (gear === 7 || gear === 0) {
      // A mine or a plate is a record on the base, not an entity: the entity is grown from the
      // record below, now and after every restart, until somebody steps on it (invariant 222).
      // Plates joined the mines there on 21 Nov 2026: a plate that lasted thirty minutes and died
      // with the server was no use to the absent owner, who is the one who needs it.
      const plate = gear === 0
      if (!placeOnBase(a, { x: p.x, y: p.y, z: p.z, plate })) {
        void room.send('actionRejected', { action: 'gear', reason: `a ${plate ? 'trap' : 'mine'} goes inside your own base`, antiCheat: false }, { to: [a] })
        return
      }
      removeGear(a, gear)
    } else {
      removeGear(a, gear)
      const e = engine.addEntity()
      Transform.create(e, { position: Vector3.create(p.x, p.y, p.z) })
      Bomb.create(e, { owner: a, atMs: Date.now() + BOMB_FUSE_MS })
      syncEntity(e, [Bomb.componentId, Transform.componentId])
    }
    void room.send('gearPlaced', { gear, held: gearsOf(a)[gear] }, { to: [a] })
    log(`${displayName(a)} set a ${g.name} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`)
  })

  /*
    Luck is a timer on the profile, and buying more adds to what is left rather than
    restarting it: paying twice for the same quarter of an hour is the kind of thing a shop
    does to a player who did not read the small print, and this one has none.
  */
  room.onMessage('buyLuck', (_d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    const cost = luckCost(prestigeOf(a), luckBuysOf(a))
    if (!spend(a, cost)) {
      void room.send('actionRejected', { action: 'luck', reason: `you need ${cost} coins`, antiCheat: false }, { to: [a] })
      return
    }
    const now = Date.now()
    const until = Math.max(now, luckUntilOf(a)) + LUCK_MS
    noteLuckBuy(a)
    setLuckUntil(a, until)
    void room.send('luckBought', { cost, sec: Math.ceil((until - now) / 1000) }, { to: [a] })
    log(`${displayName(a)} bought x2 luck for ${cost}, ${Math.ceil((until - now) / 60000)} min left`)
  })

  room.onMessage('cloak', (_d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    if (gearsOf(a)[3] <= 0) return
    if (carriesFor(a)) {
      void room.send('actionRejected', { action: 'gear', reason: 'not while carrying something', antiCheat: false }, { to: [a] })
      return
    }
    const now = Date.now()
    const reste = (dernierCloak.get(a) ?? 0) + CLOAK_COOLDOWN_MS - now
    if (reste > 0) {
      void room.send('actionRejected', { action: 'gear', reason: `cloak recharging, ${Math.ceil(reste / 1000)}s`, antiCheat: false }, { to: [a] })
      return
    }
    if (capes.has(a)) return
    dernierCloak.set(a, now)
    const e = engine.addEntity()
    Cloaked.create(e, { who: a, untilMs: now + CLOAK_MS })
    syncEntity(e, [Cloaked.componentId])
    capes.set(a, e)
    log(`${displayName(a)} pulled the cloak on`)
  })

  /*
    The plate fires on its own, on the server, on whoever steps on it first but its owner.

    It used to skip anybody holding loot, so it never caught the one thief who mattered, the
    one leaving with your piece. The reference's trap "freezes thieves" (wiki `Gears`), and what
    makes it worth buying there is what follows: a thief who is hit loses what they carry. Here
    the plate puts the intruder out at the door at once, closes the base to them, and a piece
    of this base in their hands goes back to its shelf: a player the base is closed to does not
    walk out of it with its piece (founder, 21 Nov 2026).
  */
  let acc = 0
  let reconcile = 4
  const seenMines = new Map<string, { cle: string; entites: Array<ReturnType<typeof engine.addEntity>> }>()
  engine.addSystem((dt) => {
    acc += dt
    if (acc < 0.25) return
    acc = 0
    const now = Date.now()
    const ici = presents()

    /*
      Mines and plates are grown from the base records, once a second, whenever a record
      changed: at server start (the sweep above took every old entity with it), after one is
      set, after one fires, after a base moves. One key per base, rebuilt whole when it differs.
    */
    reconcile += 1
    if (reconcile >= 4) {
      reconcile = 0
      const vivantes = new Set<string>()
      for (const b of toutesLesBases()) {
        vivantes.add(b.address)
        const cle = b.mines.map((m) => `${m.x.toFixed(2)},${m.y.toFixed(2)},${m.z.toFixed(2)},${m.plate === true ? 'p' : 'm'}`).join('|')
        const cur = seenMines.get(b.address)
        if (cur !== undefined && cur.cle === cle) continue
        if (cur !== undefined) for (const e of cur.entites) engine.removeEntity(e)
        const entites = b.mines.map((m) => {
          const e = engine.addEntity()
          Transform.create(e, { position: Vector3.create(m.x, m.y, m.z) })
          Trap.create(e, { owner: b.address, untilMs: 0, mine: m.plate !== true })
          syncEntity(e, [Trap.componentId, Transform.componentId])
          return e
        })
        seenMines.set(b.address, { cle, entites })
      }
      for (const [a, cur] of [...seenMines]) {
        if (vivantes.has(a)) continue
        for (const e of cur.entites) engine.removeEntity(e)
        seenMines.delete(a)
      }
    }

    /*
      Cloaks end on their timer, or when their wearer leaves, and the sweep reads the COMPONENT
      rather than the map it was put in. A server replacement empties that map while the synced
      entity survives in the room, so a cloak from before a deploy was worn for ever: the owner
      stayed invisible with nothing left to end it (owner, 5 Sep).
    */
    for (const [e, c] of engine.getEntitiesWith(Cloaked)) {
      const qui = c.who.toLowerCase()
      if (c.untilMs >= now && ici.has(qui)) continue
      capes.delete(qui)
      engine.removeEntity(e)
    }

    /*
      A bomb that has burned its fuse hits everyone within reach who is holding something, and
      the owner too if they stayed: a weapon with no friendly fire is a weapon with no decision
      in where you stand. Full grip force, so anything held is dropped where they stand.
    */
    for (const [e, b] of engine.getEntitiesWith(Bomb)) {
      if (b.atMs > now) continue
      const tr = Transform.getOrNull(e)
      engine.removeEntity(e)
      if (tr === null) continue
      const proprio = baseDe(b.owner)?.name ?? displayName(b.owner)
      for (const addr of ici) {
        const p = positionOf(addr)
        if (p === null) continue
        const d = Math.sqrt((p.x - tr.position.x) ** 2 + (p.z - tr.position.z) ** 2)
        if (d > BOMB_RADIUS || Math.abs(p.y - tr.position.y) > 2.5) continue
        const lache = hitCarrier(addr, 5) === 'lache'
        void room.send('bombed', { ownerName: proprio, dropped: lache }, { to: [addr] })
      }
      log(`${proprio}'s bomb went off`)
    }

    for (const [e, t] of engine.getEntitiesWith(Trap)) {
      const tr = Transform.getOrNull(e)
      if (tr === null) continue
      for (const addr of ici) {
        if (addr === t.owner) continue
        const p = positionOf(addr)
        if (p === null) continue
        const d = Math.sqrt((p.x - tr.position.x) ** 2 + (p.z - tr.position.z) ** 2)
        if (d > TRAP_TRIGGER_RANGE || Math.abs(p.y - tr.position.y) > 2) continue
        // A plate does not freeze: nothing here follows a freeze, and the door does the job.
        const gel = t.mine ? MINE_FREEZE_MS : 0
        engine.removeEntity(e)
        const proprio = baseDe(t.owner)?.name ?? displayName(t.owner)
        removeFromBase(t.owner, tr.position, !t.mine)
        let saved = false
        if (t.mine) hitCarrier(addr, 5)
        else if (carriedDetail(addr)?.origin === t.owner) saved = forcerLacher(addr, `${proprio}'s trap sent it home`)
        /*
          A trap does what a kill does in the reference (founder, 18 Nov 2026). There, the trap
          freezes a thief for seven seconds so the owner can kill them, and the thief starts
          again from the spawn; with no death here, seven seconds were all an absent owner got
          for an expensive trap. Now the intruder is put out at the door (the client does it),
          and this base stays closed to them for as long as a thief would be kept out: a minute
          when the owner is there, up to eight hours when they have been away for long. Banned
          from one base, never from the game.
        */
        const banMs = t.mine ? 0 : shieldFor(absenceDe(t.owner))
        if (banMs > 0) {
          banFromBase(addr, t.owner, now + banMs)
          raiseKeepOutField(t.owner, now + banMs)
          void room.send('bannedFrom', { ownerId: t.owner, leftMs: banMs }, { to: [addr] })
        }
        void room.send('trapped', { ownerName: proprio, gelMs: gel, mine: t.mine, ownerId: t.owner, banMs }, { to: [addr] })
        const info = { type: 'trap', byName: displayName(addr) }
        if (ici.has(t.owner)) void room.send('trapSprung', { byName: displayName(addr), saved }, { to: [t.owner] })
        else storeAlert(t.owner, info)
        log(`${displayName(addr)} stepped on ${proprio}'s ${t.mine ? 'mine' : `trap, kept out ${Math.round(banMs / 60000)} min${saved ? ', the piece went home' : ''}`}`)
        break
      }
    }
  })

  log('gear ready')
}
