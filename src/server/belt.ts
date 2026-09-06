import { noter } from './records'
import { engine, Transform, PlayerIdentityData, timers } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import {
  Belt, beltPosition, BELT_DURATION_S, BELT_INTERVAL_S, BUY_RANGE, FALL_END, OPEN_RANGE, LUCK_MULT, RUSH_TRAIT_CHANCE
} from '../shared/schemas'
import { room } from '../shared/messages'
import { log } from './log'
import { rollCrateTier, rollCrate, rollMutation, meriteAnnonce, eventTheme } from './loot'
import { tempoDuTapis } from './events'
import { displayName, spend, coinsOf, addCrate, removeCrate, cratesOf, advanceQuest, pushQuests, baseDe, luckUntilOf, MAX_CRATES } from './plots'
import { remettreEnMain, carriesFor } from './carry'
import { tutoFait } from './onboarding'
import { startConvoy } from './convoy'
import { CRATES, encoder, itemName } from '../shared/loot-table'

type Article = {
  id: number
  crateTier: number
  price: number
  progres: number
  vendu: boolean
  entity: ReturnType<typeof engine.addEntity>
}

const DEFERRED_PLACE_MS = 2700

const articles: Article[] = []
let prochainId = 1
let depuisSpawn = 0

function positionOf(address: string): Vector3 | null {
  for (const [e, id] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (id.address?.toLowerCase() !== address) continue
    const t = Transform.getOrNull(e)
    return t ? Vector3.create(t.position.x, t.position.y, t.position.z) : null
  }
  return null
}

function spawnBeltItem(): void {
  const crateTier = rollCrateTier()
  const price = CRATES[crateTier].price
  const e = engine.addEntity()
  const p = beltPosition(0)
  Transform.create(e, { position: Vector3.create(p.x, p.y, p.z) })
  Belt.create(e, { articleId: prochainId, crateTier, price, progres: 0, buyerName: '' })
  syncEntity(e, [Belt.componentId, Transform.componentId])
  articles.push({ id: prochainId, crateTier, price, progres: 0, vendu: false, entity: e })
  prochainId += 1

  if (meriteAnnonce(crateTier)) {
    void room.send('beltAlert', { crateTier })
    log(`announce: ${CRATES[crateTier].name} on the belt`)
  }
}

/**
 * Clear what a previous server left behind.
 *
 * The platform stops this server two minutes after the venue empties and starts a fresh
 * one on the next visit, but the synchronised entities it created outlive it: they sit in
 * the room's state with nobody moving them. Without this sweep, every restart leaves a
 * trail of crates frozen along the belt while new ones slide past them, which is exactly
 * what a phone showed. The in-memory list is empty at this point, so anything still
 * carrying a Belt component belongs to a server that no longer exists.
 *
 * Entities numbered under 512 are the runtime's own, avatars among them, and are never
 * touched.
 */
function balayer(): void {
  let n = 0
  for (const [e] of engine.getEntitiesWith(Belt)) {
    if ((e & 0xffff) < 512) continue
    engine.removeEntity(e)
    n += 1
  }
  if (n > 0) log(`swept ${n} crate(s) left by a previous server`)
}

function retirer(a: Article): void {
  engine.removeEntity(a.entity)
  const i = articles.indexOf(a)
  if (i >= 0) articles.splice(i, 1)
}

export function startBelt(): void {
  balayer()
  /*
    The server keeps the clock; the client draws the motion.

    This used to write BOTH `progres` and a fresh Transform for every crate on every server
    frame, and the client copied that Transform straight into four entities of its own each
    frame. Nothing interpolated anywhere, so a crate moved exactly as smoothly as the network
    delivered positions, and when the server hiccupped the belt visibly stuttered. `beltPosition`
    is shared and deterministic, so the client can place a crate from `progres` alone and glide
    between the values it receives. The Transform is still synced, but written once at spawn:
    it is where the crate IS for purchase range, not how it moves.

    Ten writes a second is enough for a value the client only uses to correct its own clock.
  */
  let sync = 0
  engine.addSystem((dt: number) => {
    depuisSpawn += dt
    // The grand rush is the reference's extra lanes, done with one belt: twice the crates.
    if (depuisSpawn >= BELT_INTERVAL_S / tempoDuTapis()) {
      depuisSpawn = 0
      spawnBeltItem()
    }
    sync += dt
    const publier = sync >= 0.1
    if (publier) sync = 0
    for (const a of [...articles]) {
      a.progres += dt / BELT_DURATION_S
      if (a.progres >= 1 + FALL_END) { retirer(a); continue }
      if (!publier) continue
      const c = Belt.getMutableOrNull(a.entity)
      if (c !== null) c.progres = a.progres
    }
  })

  room.onMessage('buyBelt', (d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    const art = articles.find((x) => x.id === d.articleId)
    if (!art) { void room.send('actionRejected', { action: 'purchase', reason: 'that box is already gone', antiCheat: false }, { to: [a] }); return }
    if (art.vendu) { void room.send('actionRejected', { action: 'purchase', reason: 'someone paid before you', antiCheat: false }, { to: [a] }); return }

    const p = positionOf(a)
    if (p === null) { void room.send('actionRejected', { action: 'purchase', reason: 'position unknown', antiCheat: false }, { to: [a] }); return }
    if (art.progres >= 1) {
      void room.send('actionRejected', { action: 'purchase', reason: 'it fell into the pit', antiCheat: false }, { to: [a] })
      return
    }
    const pos = beltPosition(art.progres)
    const dist = Vector3.distance(p, Vector3.create(pos.x, pos.y, pos.z))
    if (dist > BUY_RANGE) {
      void room.send('actionRejected', { action: 'purchase', reason: `too far (${dist.toFixed(1)}m)`, antiCheat: true }, { to: [a] })
      return
    }

    if (cratesOf(a).length >= MAX_CRATES) {
      void room.send('actionRejected', { action: 'purchase', reason: `your box stock is full (${MAX_CRATES}), open some first`, antiCheat: false }, { to: [a] })
      return
    }
    if (!spend(a, art.price)) {
      void room.send('actionRejected', { action: 'purchase', reason: `you need ${art.price - coinsOf(a)} more coins`, antiCheat: false }, { to: [a] })
      return
    }

    if (!startConvoy(a, art.crateTier, art.price, { x: pos.x, z: pos.z })) {
      addCrate(a, art.crateTier)
      void room.send('inventory', { crates: cratesOf(a) }, { to: [a] })
    }
    tutoFait(a, 3)
    advanceQuest(a, 'acheter')
    pushQuests(a)
    art.vendu = true
    const name = displayName(a)
    const c = Belt.getMutableOrNull(art.entity)
    if (c !== null) c.buyerName = name
    void room.send('bought', { byName: name, crateTier: art.crateTier, price: art.price })
    log(`${name} bought a ${CRATES[art.crateTier].name} for ${art.price}`)
    retirer(art)
  })

  const inFlight = new Map<string, number>()

  room.onMessage('openBox', (d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    // Crates are opened at home. The client refuses first, this is the authority.
    const base = baseDe(a)
    const ici = positionOf(a)
    if (base === undefined) {
      void room.send('actionRejected', { action: 'opening', reason: 'build your base first', antiCheat: false }, { to: [a] })
      return
    }
    if (ici === null || Math.sqrt((ici.x - base.x) ** 2 + (ici.z - base.z) ** 2) > OPEN_RANGE) {
      void room.send('actionRejected', { action: 'opening', reason: 'go to your base to open it', antiCheat: true }, { to: [a] })
      return
    }
    /*
      Hands, not shelves, are what has to be free.

      The item goes into the player's hand after the reel, the way a stolen one does, and
      they put it down where they choose. So the only thing that can refuse an opening is a
      hand already holding something, or a reel already spinning. A full base is not a
      reason: they can still open, hold, and go sell or make room.
    */
    if (carriesFor(a) || inFlight.get(a) !== undefined) {
      void room.send('actionRejected', { action: 'opening', reason: 'put down what you are carrying first', antiCheat: false }, { to: [a] })
      return
    }
    if (!removeCrate(a, d.crateTier)) {
      void room.send('actionRejected', { action: 'opening', reason: 'you do not have that box', antiCheat: true }, { to: [a] })
      return
    }
    tutoFait(a, 1)
    advanceQuest(a, 'ouvrir')
    if (d.crateTier >= 1) advanceQuest(a, 'ouvrirRare')
    const rarity = rollCrate(d.crateTier)
    const mut = rollMutation(d.crateTier, luckUntilOf(a) > Date.now() ? LUCK_MULT : 1)
    // During a rush a crate has the reference's chance of coming out marked by it.
    const traits = eventTheme >= 0 && Math.random() < RUSH_TRAIT_CHANCE ? 1 : 0
    const code = encoder(rarity, mut, traits)
    log(`${displayName(a)} opened a crate ${d.crateTier} -> ${itemName(rarity, mut)}`)
    // Epic and above go on the board, the way the reference game's live board shows rare spawns only.
    if (rarity >= 3) noter('tirage', displayName(a), '', code)
    void room.send('boxResult', { traits, crateTier: d.crateTier, rarity, mutation: mut, state: 'main' }, { to: [a] })
    void room.send('inventory', { crates: cratesOf(a) }, { to: [a] })

    inFlight.set(a, code)
    pushQuests(a)

    // After the reel has shown it, it is in their hand. Same landing as a theft.
    timers.setTimeout(() => {
      inFlight.delete(a)
      remettreEnMain(a, code, a)
    }, DEFERRED_PLACE_MS)
  })

  log('belt ready')
}
