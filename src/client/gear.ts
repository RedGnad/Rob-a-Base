import { TOY, plasticDe } from './toy'
import { sendOrHold } from './intent'
import { engine, Transform, MeshRenderer, Material, Entity, AvatarModifierArea, AvatarModifierType, PlayerIdentityData } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { Trap, GEARS, Cloaked, Bomb, CENTER } from '../shared/schemas'
import { room } from '../shared/messages'
import { formatIncome } from '../shared/loot-table'
import { myClientAddress, alerter, pushToFeed } from './theft'
import { applyFreeze, setCoil } from './locomotion'
import { carryView } from './carry'
import { TOAST } from './theme'
import { cue } from './ui-kit'
import { puff } from './impact'

/**
 * Gear, client side: what the player holds, and what is lying on the floor.
 *
 * A trap is drawn for everyone, as a plate, because a trap nobody can see is a trap nobody
 * can learn to avoid. What is NOT drawn is who armed it: the component carries the owner for
 * the server's sake, and the plate keeps that to itself. Your own plates are tinted so you do
 * not have to remember where you left them.
 */

export const gearView = {
  /** Pocket counts by gear id, mirrored from the server on every wallet tick. */
  held: new Array<number>(GEARS.length).fill(0),
  /** Which placeable gear is being set right now, or -1: the marker is up while it is not -1. */
  placing: -1,
  /** True while my own cloak is on, so the HUD can say so. */
  cloaked: false,
  /** Seconds left on my own cloak, for the chip that counts it down. */
  cloakLeftS: 0,
  /** The weapon the player chose to wield: 'shoot' (gun), 'slap' or 'taser'. Gun is always owned. */
  armeChoisie: 'shoot' as 'shoot' | 'slap' | 'taser'
}

/** Wield a weapon from the gear menu, or the gun. No HUD button: the held model is the feedback. */
export function wield(type: 'shoot' | 'slap' | 'taser'): void { gearView.armeChoisie = type }

const PLAQUE = Color4.fromHexString(TOY.trapPlate + 'd9')
const MIENNE = Color4.create(0.35, 0.95, 0.45, 0.85)
const vues = new Map<number, Entity>()

let marqueur: Entity

export function canPlace(gear: number): boolean {
  return estPosable(gear) && gearView.held[gear] > 0 && carryView.code < 0
}
/** Only placeable gear goes to the floor; worn gear is used by being held. */
export function estPosable(gear: number): boolean { return GEARS[gear]?.kind === 'place' }

export function togglePlacing(gear = 0): void {
  gearView.placing = gearView.placing === gear ? -1 : gear
}

export function placeTrap(): void {
  const gear = gearView.placing
  gearView.placing = -1
  if (gear < 0) return
  void room.send('placeGear', { gear })
}

export function acheterGear(gear: number): void {
  sendOrHold(() => { void room.send('buyGear', { gear }) })
}
export function buyLuckCharm(): void {
  sendOrHold(() => { void room.send('buyLuck', {}) })
}

/** F, when nothing is drawn and a cloak is in the pocket. The server decides if it takes. */
export function tirerLaCape(): boolean {
  if (gearView.held[3] <= 0 || carryView.code >= 0) return false
  void room.send('cloak', {})
  return true
}

/*
  Invisibility, built from the one primitive the platform offers for it, and built STILL.

  `AvatarModifierArea` hides every avatar inside its volume except the ids it is told to
  exclude ("user IDs that can enter and remain unaffected", its own definition), and the
  component's docs add that the Transform SCALE is ignored: only `area` sizes it.

  The first version put a small volume on each cloaked player and moved it every frame. Two
  faults. The volume was written where the wearer stood a frame ago, so at running speed they
  left their own box and flashed back into view; and `AMT_HIDE_AVATARS` alone leaves the NAME
  TAG floating, so a hidden player was a name walking about (owner, 5 Sep, twice).

  So there is ONE volume, it covers the whole venue, it never moves, and only its exclusion
  list changes: everybody present is excluded except the cloaked players other than me. Nothing
  is created or destroyed while the game runs either, which is the rule the LightSource crash
  taught us (invariant 500). And I always see MYSELF: a player who cannot see their own avatar
  cannot judge where they are, so the wearer keeps their body and the corner chip counts their
  seconds, while everyone else sees nothing at all.
*/
/** Cloaks this client has already announced seeing through, so the line is said once per cloak. */
const vusParRayons = new Set<number>()

/*
  A BURST WHERE A BODY WAS, because vanishing without one reads as a crash.

  The hiding volume is binary: an avatar and its name tag are drawn on one frame and gone on
  the next, with nothing in between. Every game with invisibility marks that instant, and for a
  reason that is about reading rather than beauty: an observer who sees a player blink out with
  no tell cannot tell "he cloaked" from "he disconnected", and the mechanic that just fired at
  them is invisible in both senses (owner, 9 Sep).

  So the moment an address enters this client's hidden list, a burst is drawn where that body
  stood, at chest height and about as wide as an avatar. The colour is the same cyan the X-ray
  glasses use for the one line they say, so the two things that speak about cloaks speak in one
  colour. It costs nothing new: `puff` runs on three pooled sprites parked under the map.

  ONE GUARD, and it is the difference between a tell and a leak: the list is seeded on the first
  pass without drawing anything. Otherwise a player who was ALREADY invisible when this client
  arrived would get a burst at their feet, which hands a newcomer the position of somebody who
  paid for the opposite.
*/
const CAPE_HEX = '#4dd2ff'
const CAPE_HAUTEUR = 1.0
const CAPE_TAILLE = 1.7
let capesVues: string[] = []
let capesSemees = false

let zoneCape: Entity

export function setupGear(): void {
  /*
    The venue-wide hiding volume, made once and never touched again: only its exclusion list
    moves. 200 by 80 by 200 covers the whole place and every floor of every base.
  */
  zoneCape = engine.addEntity()
  Transform.create(zoneCape, { position: Vector3.create(CENTER.x, 30, CENTER.z) })
  AvatarModifierArea.create(zoneCape, {
    area: Vector3.create(200, 80, 200),
    modifiers: [AvatarModifierType.AMT_HIDE_AVATARS, AvatarModifierType.AMT_HIDE_NAMETAGS],
    excludeIds: []
  })
  marqueur = engine.addEntity()
  Transform.create(marqueur, { position: Vector3.create(0, -50, 0), scale: Vector3.Zero() })
  MeshRenderer.setCylinder(marqueur, 0.5, 0.5)
  Material.setPbrMaterial(marqueur, plasticDe(Color4.create(0.35, 0.95, 0.45, 0.42), 0.7))

  room.onMessage('gearHeld', (d) => {
    for (let i = 0; i < GEARS.length; i++) gearView.held[i] = d.counts[i] ?? 0
    // Worn gear is passive: holding it is using it.
    setCoil(gearView.held[1] > 0)
  })
  /*
    Achete depuis la boutique, en regardant la ligne qui vient de changer.

    La banniere disait "TU EN AS N" alors que le titre de la ligne sous le doigt dit deja
    `<nom> xN` et se met a jour au meme instant (`shop-ui.tsx`, ligne du titre). Elle repetait
    donc, en travers de l'ecran, ce que le joueur etait deja en train de lire. Le tiroir-caisse
    dit que l'argent est parti, la ligne dit ce qu'on a: il ne manque rien.
  */
  room.onMessage('gearBought', () => {
    cue('till.wav', 0.7)
  })
  room.onMessage('gearPlaced', (d) => {
    alerter(`${GEARS[d.gear].name} SET  ·  ${d.held} left`, '#4dd2ff', TOAST.result)
  })
  room.onMessage('trapped', (d) => {
    applyFreeze(d.gelMs)
    alerter(d.mine
      ? `${d.ownerName.toUpperCase()}'S MINE  ·  frozen ${Math.round(d.gelMs / 1000)}s`
      : `${d.ownerName.toUpperCase()}'S TRAP  ·  frozen ${Math.round(d.gelMs / 1000)}s`, '#ff6b6b', TOAST.warning)
  })
  room.onMessage('tased', (d) => {
    applyFreeze(d.gelMs)
    alerter(`TASED BY ${d.byName.toUpperCase()}  ·  ${Math.round(d.gelMs / 1000)}s`, '#ff6b6b', TOAST.warning)
  })
  room.onMessage('luckBought', (d) => {
    cue('till.wav', 0.7)
    alerter(`LUCKY CHARM  ·  x2 for ${Math.ceil(d.sec / 60)} min`, '#4dd2ff', TOAST.result)
  })
  room.onMessage('bombed', (d) => {
    alerter(d.dropped
      ? `${d.ownerName.toUpperCase()}'S BOMB  ·  you dropped it`
      : `${d.ownerName.toUpperCase()}'S BOMB went off`, '#ff6b6b', TOAST.warning)
  })
  room.onMessage('trapSprung', (d) => {
    alerter(`YOUR TRAP CAUGHT ${d.byName.toUpperCase()}`, '#4dd2ff', TOAST.warning, true)
    pushToFeed(`${d.byName} stepped on a trap`)
  })

  engine.addSystem(() => {
    const moi = myClientAddress()
    const vivants = new Set<number>()
    for (const [e, t] of engine.getEntitiesWith(Trap)) {
      const id = e as unknown as number
      const mienne = t.owner.toLowerCase() === moi
      // A mine is drawn for the one player who set it. To everyone else it is floor.
      if (t.mine && !mienne) continue
      vivants.add(id)
      if (vues.has(id)) continue
      const tr = Transform.getOrNull(e)
      if (tr === null) continue
      const plaque = engine.addEntity()
      Transform.create(plaque, {
        position: Vector3.create(tr.position.x, tr.position.y + 0.04, tr.position.z),
        scale: t.mine ? Vector3.create(0.6, 0.05, 0.6) : Vector3.create(1, 0.08, 1)
      })
      MeshRenderer.setCylinder(plaque, 0.55, 0.55)
      const teinte = mienne ? MIENNE : PLAQUE
      Material.setPbrMaterial(plaque, plasticDe(teinte, 0.4))
      vues.set(id, plaque)
    }
    // Bombs: a dark plate with a short life, everyone sees it coming for three seconds.
    for (const [e, b] of engine.getEntitiesWith(Bomb)) {
      const id = e as unknown as number
      vivants.add(id)
      if (vues.has(id)) continue
      const tr = Transform.getOrNull(e)
      if (tr === null) continue
      const plaque = engine.addEntity()
      Transform.create(plaque, { position: Vector3.create(tr.position.x, tr.position.y + 0.15, tr.position.z), scale: Vector3.create(0.5, 0.5, 0.5) })
      MeshRenderer.setSphere(plaque)
      const teinte = b.owner.toLowerCase() === moi ? MIENNE : Color4.fromHexString(TOY.bomb + 'ff')
      Material.setPbrMaterial(plaque, plasticDe(teinte, 1.2))
      vues.set(id, plaque)
    }
    for (const [id, p] of [...vues]) {
      if (vivants.has(id)) continue
      engine.removeEntity(p)
      vues.delete(id)
    }

    // Cloaks: one hiding volume per cloaked player, excluding everyone but them.
    const presentHere: string[] = []
    // Where each of them stands, taken on the same pass: the burst needs the body's last point.
    const ouIls = new Map<string, Vector3>()
    for (const [e, id] of engine.getEntitiesWith(PlayerIdentityData)) {
      const a = id.address?.toLowerCase()
      if (!a) continue
      presentHere.push(a)
      const t = Transform.getOrNull(e)
      if (t !== null) ouIls.set(a, Vector3.create(t.position.x, t.position.y, t.position.z))
    }
    const cachees: string[] = []
    gearView.cloaked = false
    gearView.cloakLeftS = 0
    const maintenant = Date.now()
    // X-ray glasses: somebody else's cloak hides nothing from THIS client. The volume that
    // would hide them is simply never built here, and one already built comes down.
    const rayonsX = gearView.held[6] > 0
    for (const [e, c] of engine.getEntitiesWith(Cloaked)) {
      const id = e as unknown as number
      const qui = c.who.toLowerCase()
      // An expired cloak hides nobody, whatever the room still holds: the client stops drawing
      // it the second its own clock says so, without waiting for the server to sweep.
      if (c.untilMs <= maintenant) continue
      if (qui === moi) { gearView.cloaked = true; gearView.cloakLeftS = Math.ceil((c.untilMs - maintenant) / 1000) }
      if (rayonsX && qui !== moi) {
        if (!vusParRayons.has(id)) {
          vusParRayons.add(id)
          alerter('X-RAY  ·  SOMEONE NEARBY IS CLOAKED', '#4dd2ff', TOAST.warning)
        }
        continue
      }
      if (qui !== moi) cachees.push(qui)
    }
    // The edge: an address that was visible last pass and is hidden on this one.
    if (capesSemees) {
      for (const a of cachees) {
        if (capesVues.includes(a)) continue
        const ou = ouIls.get(a)
        if (ou === undefined) continue
        puff(Vector3.create(ou.x, ou.y + CAPE_HAUTEUR, ou.z), CAPE_HEX, CAPE_TAILLE)
      }
    }
    capesVues = cachees
    capesSemees = true

    /*
      One list, rewritten only when it changes: everybody present except the cloaked players
      who are not me. A mutable write on an unchanged list is a serialise-and-compare every
      frame, and this list is identical almost every frame.
    */
    const voulu = presentHere.filter((a) => !cachees.includes(a))
    const actuel = AvatarModifierArea.getOrNull(zoneCape)?.excludeIds ?? []
    if (actuel.length !== voulu.length || actuel.some((a, i) => a !== voulu[i])) {
      const am = AvatarModifierArea.getMutableOrNull(zoneCape)
      if (am !== null) am.excludeIds = voulu
    }

    // The marker sits at the player's feet while they are choosing, and nowhere otherwise.
    const m = Transform.getMutableOrNull(marqueur)
    if (m === null) return
    if (gearView.placing < 0 || !canPlace(gearView.placing)) {
      gearView.placing = -1
      if (m.scale.x !== 0) m.scale = Vector3.Zero()
      return
    }
    const me = Transform.getOrNull(engine.PlayerEntity)
    if (me === null) return
    m.position = Vector3.create(me.position.x, me.position.y + 0.05, me.position.z)
    m.scale = Vector3.create(1, 0.06, 1)
  })
}
