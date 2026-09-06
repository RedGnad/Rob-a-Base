import { noter } from './records'
import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import {
  Carried, DroppedItem, CARRY_TIMEOUT_MS, CARRY_GRIP, PLACE_RANGE, STEAL_REACH,
  LOOT_ITEM_LIFETIME_MS, LOOT_ITEM_PICKUP_RANGE, LOOT_ITEM_OWNER_LOCK_MS,
  FLOOR_HEIGHT, SLOTS_PER_FLOOR, VIDE, SAME_STOREY
} from '../shared/schemas'
import { room } from '../shared/messages'
import { rarityOf, mutationDe } from '../shared/loot-table'
import { log } from './log'
import {
  baseDe, removeItem, addItem, displayName, presents, positionOf, crediterVente,
  advanceQuest, pushQuests, inReach, positionObjet, recordGift, storeAlert
} from './plots'
import { tutoFait } from './onboarding'
import { rompreCape } from './gear'

/**
 * Carrying, which is the one verb the rest of this game turned out to be made of.
 *
 * Taking from a rival, giving to a friend and tidying your own shelves were three mechanics
 * with three messages and three explanations. They are one act performed in three places:
 * lift it, walk, put it down. Where it lands decides what the act was, and nothing has to be
 * explained because the player already watched themselves do it.
 *
 * The server owns every step. A client says "I would like to lift slot four" and "I would
 * like to put this down here"; it never says what it holds, because a client that can assert
 * what it holds can assert anything.
 */

/** One entity per carrier, created here, synced to everyone so the item shows in their hand. */
const portes = new Map<string, ReturnType<typeof engine.addEntity>>()

export function carriesWhat(address: string): number | null {
  const e = portes.get(address)
  if (e === undefined) return null
  return Carried.getOrNull(e)?.code ?? null
}

/** What is in the hand and where it came from, for the callers that must know both. */
export function carriedDetail(address: string): { code: number; origin: string } | null {
  const e = portes.get(address)
  if (e === undefined) return null
  const c = Carried.getOrNull(e)
  return c === null ? null : { code: c.code, origin: c.origin }
}
/** Take the hand's content without a word: the caller is about to say what became of it. */
export function prendreDesMains(address: string): { code: number; origin: string } | null {
  return lacher(address)
}

export function carriesFor(address: string): boolean {
  return carriesWhat(address) !== null
}

function poser(address: string, code: number, origin: string, repris = false): void {
  /*
    Nobody holds two things, and the map used to let them.

    `portes.set` overwrote the previous entry without touching the entity behind it: the old
    `Carried` stayed in the room, synced, glued to that player's hand for the rest of the
    server's life, while the item it named had already left every base. Every caller guards
    against arriving here with full hands, so this line should never fire; it exists because
    the cost of it firing was an item deleted from the game, and the cost of the guard is one
    comparison. Whatever was held goes home rather than nowhere.
  */
  forcerLacher(address, 'you cannot hold two things')
  // A closed hand ends a cloak, whatever its timer said: gear never covers the walk home.
  rompreCape(address)
  const e = engine.addEntity()
  Carried.create(e, { holder: address, code, origin, sinceMs: Date.now(), grip: CARRY_GRIP, repris })
  syncEntity(e, [Carried.componentId])
  portes.set(address, e)
}

function lacher(address: string): { code: number; origin: string } | null {
  const e = portes.get(address)
  if (e === undefined) return null
  const c = Carried.getOrNull(e)
  portes.delete(address)
  engine.removeEntity(e)
  return c === null ? null : { code: c.code, origin: c.origin }
}

/**
 * Send it back where it came from, or to the carrier if that base is gone or full.
 *
 * `addItem` answers with a word, not a boolean: 'expose', 'en-stock' or 'plein'. All three
 * are truthy, so `!addItem(...)` was false whatever happened, the fallback never ran, and a
 * refusal was reported to the player as a successful return. Combined with the older bug
 * where an absent owner's base refused everything, an item handed back to somebody who had
 * logged off was silently deleted from the game.
 */
/** Set by the theft module: carry cannot import it without a cycle. */
let landedHook: (address: string, code: number) => void = () => {}
export function setLandedHook(fn: (address: string, code: number) => void): void { landedHook = fn }

function rentrer(address: string, quoi: { code: number; origin: string }, pourquoi: string): void {
  const chezOrigine = addItem(quoi.origin, quoi.code) !== 'plein'
  const chezPorteur = !chezOrigine && addItem(address, quoi.code) !== 'plein'
  if (chezPorteur && quoi.origin !== address) landedHook(address, quoi.code)
  if (!chezOrigine && !chezPorteur) {
    /*
      Two full shelves is not a reason to delete somebody's trophy.

      This branch used to log the loss and return, which is the game quietly eating an item
      because two buildings happened to be full at the same second, and telling nobody. The
      floor is already this game's overflow: a dropped item that cannot go home stays on the
      ground and keeps trying. Send it there instead, and say so.
    */
    const p = positionOf(address)
    if (p !== null) {
      jeterAuSol(quoi.code, quoi.origin, address, p)
      void room.send('carryResult', {
        ok: false, reason: `${pourquoi}, no room left: it is on the ground`,
        rarity: rarityOf(quoi.code), mutation: mutationDe(quoi.code)
      }, { to: [address] })
      log(`carry: ${displayName(address)} had nowhere to put a ${rarityOf(quoi.code)}, it is on the ground (${pourquoi})`)
      return
    }
    // Only when we do not even know where they were standing is it truly gone.
    void room.send('carryResult', {
      ok: false, reason: `${pourquoi}, and there was nowhere left to put it`,
      rarity: rarityOf(quoi.code), mutation: mutationDe(quoi.code)
    }, { to: [address] })
    log(`carry: ${displayName(address)} lost a ${rarityOf(quoi.code)}, nowhere to put it (${pourquoi})`)
    return
  }
  void room.send('carryResult', {
    ok: false, reason: pourquoi, rarity: rarityOf(quoi.code), mutation: mutationDe(quoi.code)
  }, { to: [address] })
  log(`carry: ${displayName(address)} released a ${rarityOf(quoi.code)} (${pourquoi})`)
}

/** A theft that has finished prying does not teleport home: it lands in the thief's hands. */
export function remettreEnMain(thief: string, code: number, origin: string): void {
  poser(thief, code, origin)
  void room.send('carryResult', {
    ok: true, reason: 'carrying', rarity: rarityOf(code), mutation: mutationDe(code)
  }, { to: [thief] })
}

/**
 * Take something out of somebody's hands, for the one case where the game says it is not theirs.
 *
 * Recovery has to reach the stolen item wherever it currently is, and since the rework that is
 * a fist far more often than a shelf: the thief holds it for the whole walk home, and the
 * victim's window is shorter than that walk. Deliberately narrow, it names the code it expects,
 * so it can only ever take back the exact thing that was taken.
 */
export function arracherDesMains(address: string, code: number): boolean {
  const e = portes.get(address)
  if (e === undefined) return false
  const c = Carried.getOrNull(e)
  if (c === null || c.code !== code) return false
  lacher(address)
  void room.send('carryResult', {
    ok: false, reason: 'they took it back', rarity: rarityOf(code), mutation: mutationDe(code)
  }, { to: [address] })
  return true
}

/** Shot, disconnected, or simply done with it: whatever the reason, it goes home. */
export function forcerLacher(address: string, pourquoi: string): boolean {
  const quoi = lacher(address)
  if (quoi === null) return false
  rentrer(address, quoi, pourquoi)
  return true
}

/** Put it on the floor, right where they were standing, for whoever gets there first. */
function jeterAuSol(code: number, origin: string, par: string, ou: Vector3): void {
  /*
    Where they stood means their floor too, not a constant half metre.

    The height was fixed, so a piece dropped on the second storey of a base appeared on the
    plaza underneath it, and on the plaza it sat half a metre up in the air with the client
    hanging its model below that again (owner, 7 Sep). The carrier's own y is the floor.
  */
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(ou.x, ou.y, ou.z) })
  DroppedItem.create(e, { code, origin, droppedBy: par, untilMs: Date.now() + LOOT_ITEM_LIFETIME_MS })
  syncEntity(e, [DroppedItem.componentId, Transform.componentId])
}

/**
 * A hit on somebody's hands. Returns what it achieved, so the shooter can be told once.
 *
 * Called before anything else a shot does, because the coin logic returns early when the
 * target has nothing to give: a thief who has just spent everything, or who never had
 * anything, was the one player a bullet could not disarm.
 */
export function hitCarrier(address: string, force: number): 'rien' | 'ebranle' | 'lache' {
  const e = portes.get(address)
  if (e === undefined) return 'rien'
  const c = Carried.getMutableOrNull(e)
  if (c === null) return 'rien'
  c.grip -= force
  if (c.grip > 0) return 'ebranle'
  /*
    It falls where they stood; it does not teleport home.

    Returning it to its base was tidy and it closed the moment instead of opening it. On the
    ground it is a scramble: the owner runs to reclaim what is theirs, the thief can try again
    if they are still standing, and somebody who had no stake at all now has a reason to have
    been carrying a gun.
  */
  const quoi = lacher(address)
  if (quoi === null) return 'rien'
  const p = positionOf(address)
  if (p === null) { rentrer(address, quoi, 'shot, you dropped it'); return 'lache' }
  jeterAuSol(quoi.code, quoi.origin, address, p)
  void room.send('carryResult', {
    ok: false, reason: 'shot, you dropped it', rarity: rarityOf(quoi.code), mutation: mutationDe(quoi.code)
  }, { to: [address] })
  log(`carry: ${displayName(address)} was shot and dropped a ${rarityOf(quoi.code)} on the ground`)
  return 'lache'
}

export function startCarry(): void {
  room.onMessage('pickUp', (d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    if (carriesFor(a)) { void room.send('carryResult', { ok: false, reason: 'hands full', rarity: 0, mutation: 0 }, { to: [a] }); return }
    const b = baseDe(a)
    if (b === undefined) { void room.send('carryResult', { ok: false, reason: 'you have no base', rarity: 0, mutation: 0 }, { to: [a] }); return }
    const slot = d?.slot
    if (!Number.isInteger(slot) || slot < 0 || slot >= b.items.length || b.items[slot] === VIDE) { void room.send('carryResult', { ok: false, reason: 'no such item', rarity: 0, mutation: 0 }, { to: [a] }); return }
    /*
      Reaching your own shelf is reaching a shelf, and it was the one the server never checked.

      Taking from a rival is checked twice, by the pointer collider on the client and by
      `inReach` here, because a modified client cannot be trusted about where it stands.
      Lifting from your OWN base had no check of any kind: the message named a slot and the
      server obeyed, from anywhere on the map, through any number of floors. That is a free
      remote hand, and worse, it is the way to arrive at `poser` with hands that are already
      full from somewhere else. Same rule as theft, for the same reason.
    */
    const p = positionOf(a)
    const objet = positionObjet(a, slot)
    if (p === null || objet === null || !inReach(p, objet, STEAL_REACH)) {
      void room.send('carryResult', { ok: false, reason: 'too far, or not on this floor', rarity: 0, mutation: 0 }, { to: [a] })
      return
    }
    const code = removeItem(a, slot)
    if (code === null) { void room.send('carryResult', { ok: false, reason: 'it is gone', rarity: 0, mutation: 0 }, { to: [a] }); return }
    poser(a, code, a, true)
    void room.send('carryResult', { ok: true, reason: 'carrying', rarity: rarityOf(code), mutation: mutationDe(code) }, { to: [a] })
    log(`carry: ${displayName(a)} picked up a ${rarityOf(code)} from their own base`)
  })

  room.onMessage('placeDown', (d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    const e = portes.get(a)
    const c = e === undefined ? null : Carried.getOrNull(e)
    if (c === null) { void room.send('carryResult', { ok: false, reason: 'you are not carrying anything', rarity: 0, mutation: 0 }, { to: [a] }); return }

    const p = positionOf(a)
    if (p === null) return
    const vise = (d?.ownerId ?? '').toLowerCase()
    /*
      You put it down in the building you are standing in, and that is the whole interface.
      Giving used to be a click on somebody's plinth from wherever you happened to be; now it
      is walking into their place with the thing in your hands, which needs no wording at all.
    */
    const b = baseDe(vise)
    if (b === undefined) { void room.send('carryResult', { ok: false, reason: 'no base there', rarity: 0, mutation: 0 }, { to: [a] }); return }
    const t = Transform.getOrNull(b.entity)
    if (t === null) return
    const dx = p.x - t.position.x, dz = p.z - t.position.z
    if (Math.sqrt(dx * dx + dz * dz) > PLACE_RANGE) {
      void room.send('carryResult', { ok: false, reason: 'get closer to that base', rarity: 0, mutation: 0 }, { to: [a] })
      return
    }
    /*
      The client proposes a pedestal; the server decides the storey.

      An item's index decides its storey, and its storey decides whether a thief can reach it
      without climbing, so the storey is the part that must not be forgeable. It comes from
      the position the server reads itself. Within that storey the client's choice is honoured,
      because which of the six pedestals it lands on changes nothing a thief cares about: they
      span 7.2 m against a 10 m reach, so all six are reachable from any of them. Free where it
      is only pleasant, authoritative where it matters.

      Beyond the top of the shelf it clamps rather than refuses, since the shelf is a dense
      queue and an index past the end would be a hole.
    */
    const targetFloor = Math.max(0, Math.round(p.y / FLOOR_HEIGHT))
    const bas = targetFloor * SLOTS_PER_FLOOR
    const propose = Number.isInteger(d?.slot) ? d.slot : bas
    // The storey is the server's, the pedestal within it is the client's wish; capacity bounds both.
    const ou = Math.max(bas, Math.min(propose, bas + SLOTS_PER_FLOOR - 1))
    const realFloor = Math.floor(ou / SLOTS_PER_FLOOR)

    // Same word-not-a-boolean trap: a full base used to accept the item and lose it.
    if (addItem(vise, c.code, ou) === 'plein') {
      void room.send('carryResult', { ok: false, reason: 'that base is full', rarity: 0, mutation: 0 }, { to: [a] })
      return
    }
    // Read before releasing: `c` is the component's own value and `lacher` destroys the entity.
    const rar = rarityOf(c.code), mut = mutationDe(c.code)
    const code = c.code, origine = c.origin, repris = c.repris
    lacher(a)
    void room.send('carryResult', {
      ok: true, reason: vise === a ? `placed on floor ${realFloor + 1}` : 'given', rarity: rar, mutation: mut
    }, { to: [a] })

    /*
      Everything below is credited HERE, because this is where the act happens now.

      Leaving something on somebody else's base used to be its own message, and every hook
      that hung off it went with it: the quest, the tutorial's last step, both social
      counters, and the two notifications. Carrying replaced the message; the hooks stayed
      behind on a handler no client calls any more. The quest was unwinnable and the tutorial
      could not finish, which a player discovers by doing exactly what the screen asks.
    */
    if (vise === a) {
      /*
        Putting back what was already yours is not placing an item.

        The credit used to be unconditional, so lifting your own trophy off its plinth and
        setting it down again advanced the quest: six of those is twenty seconds for a free
        crate. The first fix tested `origin !== a`, and that broke the moment crates started
        landing in the hand: a freshly opened item carries your own address as its origin, so
        placing it no longer counted, which is the one act the quest is named after. `repris`
        is set only when the item was lifted off your OWN shelf. Everything else you put down
        at home, opened, stolen or picked up off the floor, is a placement.
      */
      if (!repris) { advanceQuest(a, 'poser'); pushQuests(a); tutoFait(a, 2) }
      if (origine !== a) landedHook(a, code)
      log(`carry: ${displayName(a)} placed a ${rar} on floor ${realFloor + 1} of their own base`)
      return
    }

    recordGift(a, vise)
    noter('don', displayName(a), displayName(vise), 0)
    advanceQuest(a, 'gift')
    pushQuests(a)

    /*
      Both ends of a gift get told, which is the whole reason anybody gives one.

      The act produced a single line in a feed everyone shares and nothing else: the giver got
      no confirmation, and the person receiving a trophy learned about it the same way a
      stranger did. `gaveItem` and `wasGifted` are the two messages the client has always been
      listening for; nothing had sent them since carrying replaced the old handler.
    */
    void room.send('gaveItem', { toName: b.name, rarity: rar, mutation: mut }, { to: [a] })
    if (presents().has(vise)) {
      void room.send('wasGifted', { byName: displayName(a), rarity: rar, mutation: mut }, { to: [vise] })
    } else {
      // Away right now: it waits on their profile and is delivered when they next arrive.
      storeAlert(vise, { type: 'gift', byName: displayName(a), code })
    }
    void room.send('gifted', { byName: displayName(a), toName: b.name, rarity: rar })
    log(`carry: ${displayName(a)} placed a ${rar} in ${b.name}'s base`)
  })

  /*
    Selling from the hand, because the shelf is no longer where a decision gets made.

    The resale used to hang off the two-step selection that carrying replaced. It belongs
    here now, and arguably always did: you sell a thing you are holding, having looked at it,
    rather than a thing you had ticked in a list.
  */
  room.onMessage('sellCarried', (_d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a) return
    const e = portes.get(a)
    const c = e === undefined ? null : Carried.getOrNull(e)
    if (c === null) { void room.send('carryResult', { ok: false, reason: 'you are not carrying anything', rarity: 0, mutation: 0 }, { to: [a] }); return }
    /*
      Stolen goods cannot be cashed on the spot.
      
      Selling from the hand was written for tidying your own shelves and applied to anything in
      them, so a thief could turn somebody else's trophy into coins standing in their doorway.
      That deletes the walk home, which is the only part of a theft the victim can contest, and
      with it the whole reason the carry exists. What is not yours has to reach a base first.
    */
    if (c.origin !== a) {
      void room.send('carryResult', { ok: false, reason: 'not yours to sell, put it down first', rarity: 0, mutation: 0 }, { to: [a] })
      return
    }
    const quoi = lacher(a)
    if (quoi === null) return
    const gain = crediterVente(a, quoi.code)
    advanceQuest(a, 'vendre')
    pushQuests(a)
    void room.send('sold', { gain, rarity: rarityOf(quoi.code) }, { to: [a] })
    log(`carry: ${displayName(a)} sold a ${rarityOf(quoi.code)} out of hand for ${gain}`)
  })

  room.onMessage('dropCarried', (_d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (a) forcerLacher(a, 'you dropped it')
  })

  /*
    Nobody carries anything for ever.

    A player who closes the tab holding a trophy would otherwise take it out of the game
    entirely: gone from the base it was taken from, gone from every base. Anything held past
    the timeout, or held by somebody who is no longer here, goes back where it came from.
  */
  let acc = 0
  /*
    Which entities looked orphaned on the previous tick, and nothing more.

    A one-tick grace, because `lacher` removes an entity and the sweep below runs in the same
    system: without it, an item legitimately released this second could be read as abandoned
    before the engine has finished forgetting it, and handed back to its base a second time.
    Seeing it twice costs one second and removes the question entirely.
  */
  const orphelinsVus = new Set<number>()
  engine.addSystem((dt) => {
    acc += dt
    if (acc < 1) return
    acc = 0
    const ici = presents()
    const now = Date.now()

    /*
      Whatever is lying on the floor goes to the nearest person who is allowed to take it,
      and the one who just dropped it is not allowed to for a couple of seconds. Anything
      nobody reaches in time gives up and goes back to the base it belonged to.
    */
    for (const [e, d] of engine.getEntitiesWith(DroppedItem)) {
      const t = Transform.getOrNull(e)
      if (t === null) continue
      if (d.untilMs < now) {
        // If home cannot take it back it stays on the floor rather than evaporating.
        const ou = addItem(d.origin, d.code)
        if (ou === 'plein') {
          const m = DroppedItem.getMutableOrNull(e)
          if (m !== null) m.untilMs = now + LOOT_ITEM_LIFETIME_MS
          continue
        }
        /*
          Told to its owner. It went home in silence, and a piece that leaves the floor
          without a word reads as lost, to its owner most of all (owner, playing with the
          testers, 4 Sep). Whether it landed on a shelf or in the stock is the one thing
          they need to know to find it again.
        */
        void room.send('itemHome', { rarity: rarityOf(d.code), mutation: mutationDe(d.code), stocked: ou === 'en-stock' }, { to: [d.origin] })
        engine.removeEntity(e)
        continue
      }
      const ouvert = d.untilMs - LOOT_ITEM_LIFETIME_MS + LOOT_ITEM_OWNER_LOCK_MS
      let gagnant: string | null = null
      let plusPres = LOOT_ITEM_PICKUP_RANGE
      for (const addr of ici) {
        if (addr === d.droppedBy && now < ouvert) continue
        if (carriesFor(addr)) continue
        const p = positionOf(addr)
        if (p === null) continue
        // A piece now lies on the storey it fell on, so the storey has to count: reaching
        // one is walking to it, never standing under the floor it rests on.
        if (Math.abs(p.y - t.position.y) > SAME_STOREY) continue
        const dist = Math.sqrt((p.x - t.position.x) ** 2 + (p.z - t.position.z) ** 2)
        if (dist > plusPres) continue
        plusPres = dist
        gagnant = addr
      }
      if (gagnant !== null) {
        poser(gagnant, d.code, d.origin)
        void room.send('carryResult', {
          ok: true, reason: 'picked it up', rarity: rarityOf(d.code), mutation: mutationDe(d.code)
        }, { to: [gagnant] })
        log(`carry: ${displayName(gagnant)} picked a ${rarityOf(d.code)} up off the ground`)
        // And everyone else learns who has it now, on the feed: the floor never went quiet.
        void room.send('itemPicked', { byName: displayName(gagnant), rarity: rarityOf(d.code) })
        engine.removeEntity(e)
      }
    }
    for (const [a, e] of [...portes]) {
      const c = Carried.getOrNull(e)
      if (c === null) { portes.delete(a); continue }
      if (!ici.has(a)) { forcerLacher(a, 'you left'); continue }
      if (now - c.sinceMs > CARRY_TIMEOUT_MS) forcerLacher(a, 'you held it too long')
    }

    /*
      And now everything the server does NOT know it is holding, which a restart guarantees.

      The loop above walks `portes`, this server's memory of who is carrying what. The platform
      stops the server two minutes after the venue empties, and `portes` dies with it, but the
      `Carried` entity does not: it was synced, so it sits in the room's snapshot and the next
      server inherits it knowing nothing about it. The item had already been taken off its
      base, so it was gone from every shelf in the game, and the trophy stayed welded to a
      player's hand for as long as that scene lived. The floor and the belt are both swept at
      start-up; hands were the one place nobody looked.

      Two rules make this safe to run every second rather than only at boot. It never touches
      an entity `portes` knows about, so a live carry is never interrupted. And it never
      destroys: if the item's home cannot take it back, because the bases have not finished
      loading or that base is full, the entity is simply left alone and tried again a second
      later. A ghost that outlives its usefulness is a cosmetic bug; a deleted trophy is not.
    */
    const connus = new Set<number>()
    for (const e of portes.values()) connus.add(e as unknown as number)
    const orphelins = new Set<number>()
    for (const [e, c] of engine.getEntitiesWith(Carried)) {
      const id = e as unknown as number
      if (connus.has(id)) continue
      // Reserved/avatar slots belong to the runtime and are never ours to remove.
      if ((id & 0xffff) < 512) continue
      orphelins.add(id)
      if (!orphelinsVus.has(id)) continue
      if (addItem(c.origin, c.code) === 'plein') continue
      log(`carry: an orphaned ${rarityOf(c.code)} was found in nobody's hands and sent home`)
      engine.removeEntity(e)
    }
    orphelinsVus.clear()
    for (const id of orphelins) orphelinsVus.add(id)
  })

  log('carry ready')
}
