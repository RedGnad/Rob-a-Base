import { engine, Transform, MeshRenderer, Material, Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { Plot, CENTER, BELT_HEIGHT } from '../shared/schemas'
import { plastic } from './toy'
import { currentStep } from './tutorial'
import { nearestFreeSquare } from './slots'
import { cratePosition } from './box'
import { myClientAddress } from './theft'
import { rushAgeS } from './events'

/**
 * The step beacon: where to go, said without a word.
 *
 * The organisers' recap of the Show & Tell asks for "visual guidance instead of text-heavy
 * tutorials", and their live sessions showed why: a player with a paragraph on screen still
 * says "I don't know what to do". The panel says why, the central button says what to
 * press; this is the missing third voice, WHERE. One gold column of light and a bobbing
 * chevron over the current step's target: the crate to smash, the belt to buy from, the
 * neighbour to rob, the square your base can take, your own base when coins wait there.
 *
 * Two entities, emissive plastic, no light, no collider, no alpha: the phone budget's idea
 * of free. Hidden by scale, parked underground, like every other transient in the scene.
 */
const OR = '#ffd23f'
/** How long the beacon stands on the belt when a rush begins. */
const RUSH_BEACON_S = 20
let anneau: Entity | null = null
let fleche: Entity | null = null
let filage = 0

/** Where my own base stands, or null before it does. */
function maBase(): Vector3 | null {
  const moi = myClientAddress()
  for (const [e, p] of engine.getEntitiesWith(Plot)) {
    if (p.ownerId.toLowerCase() !== moi) continue
    const t = Transform.getOrNull(e)
    if (t !== null) return Vector3.create(t.position.x, 0, t.position.z)
  }
  return null
}

function cible(): Vector3 | null {
  /*
    A rush points at the belt for its first moments, for everyone past the tutorial. The
    world says a rush is on (the floor flows in its colour) and the chip says what it drops;
    neither says WHERE, and a player at their base asked what the rush was (4 Sep). The
    beacon is the third voice, and it costs nothing that is not already built.
  */
  const rush = rushAgeS()
  const step = currentStep()
  if (step === null) {
    return rush >= 0 && rush < RUSH_BEACON_S ? Vector3.create(CENTER.x, BELT_HEIGHT, CENTER.z) : null
  }
  if (step === 'place') {
    /*
      "Place your base" is a WHERE: the square the hammer builds on, which is where the player
      stands when that is legal and the nearest legal square otherwise (slots.ts). The press
      builds exactly there (design page 1, point 2), so the beacon is the answer to "where will
      it go". It used to search with the base's side as the scene's side, which made every
      square "too close to the edge": the beacon never showed for this step.
    */
    const spot = nearestFreeSquare()
    return spot === null ? null : Vector3.create(spot.x, 0, spot.z)
  }
  if (step === 'open') {
    // The crate being opened; before it stands, home, where the OPEN button will put it.
    const caisse = cratePosition()
    return caisse !== null ? caisse : maBase()
  }
  if (step === 'shelve') return maBase()
  // Collecting is the button, and the button pulses with the amount on it: nowhere to go.
  if (step === 'collect') return null
  if (step === 'buy') return Vector3.create(CENTER.x, BELT_HEIGHT, CENTER.z)
  if (step === 'steal') {
    // The nearest base that is not mine and has something on its shelves worth taking.
    const moi = myClientAddress()
    const ici = Transform.getOrNull(engine.PlayerEntity)
    if (ici === null) return null
    let best: Vector3 | null = null
    let dist = Infinity
    for (const [e, p] of engine.getEntitiesWith(Plot)) {
      if (p.ownerId.toLowerCase() === moi) continue
      if (!p.items.some((c) => c >= 0)) continue
      const t = Transform.getOrNull(e)
      if (t === null) continue
      const d = Math.hypot(t.position.x - ici.position.x, t.position.z - ici.position.z)
      if (d < dist) { dist = d; best = Vector3.create(t.position.x, 0, t.position.z) }
    }
    return best
  }
  return null
}

/*
  How high the chevron floats over its target. Over a square to build on it rides above the
  marker's BUILD HERE, which stands at 2.4 m on the same spot: at the usual height the two
  were drawn through each other.
*/
function chevronHeight(): number {
  return currentStep() === 'place' ? 3.4 : 2.6
}

export function setupGuidage(): void {
  /*
    The genre's marker, not a surveyor's pole. A solid gold column read as amateur noise
    (tester, 31 Aug), and no reference game plants a cylinder: they float a bouncing,
    slowly turning chevron over the target and pulse a flat ring on the ground under it.
    Both ours: emissive plastic, no alpha, no light, two entities as before.
  */
  anneau = engine.addEntity()
  Transform.create(anneau, { position: Vector3.create(0, -50, 0), scale: Vector3.Zero() })
  MeshRenderer.setCylinder(anneau, 0.5, 0.5)
  Material.setPbrMaterial(anneau, plastic(OR, 2.2))
  fleche = engine.addEntity()
  Transform.create(fleche, { position: Vector3.create(0, -50, 0), scale: Vector3.Zero() })
  // A cone with its apex at the bottom: an arrowhead pointing at the spot.
  MeshRenderer.setCylinder(fleche, 0, 0.5)
  Material.setPbrMaterial(fleche, plastic(OR, 2.6))

  let acc = 0
  engine.addSystem((dt) => {
    // Five checks a second: a beacon target moves at walking pace, not at frame pace.
    acc += dt
    if (acc < 0.2) return
    acc = 0
    const c = anneau === null ? null : Transform.getMutableOrNull(anneau)
    const f = fleche === null ? null : Transform.getMutableOrNull(fleche)
    if (c === null || f === null) return
    const ou = cible()
    if (ou === null) {
      if (c.scale.x !== 0) { c.scale = Vector3.Zero(); f.scale = Vector3.Zero() }
      return
    }
    const t = Date.now()
    // The ring breathes on the ground; the chevron bobs and slowly turns above the spot.
    const souffle = 1.5 + Math.sin(t / 420) * 0.35
    c.position = Vector3.create(ou.x, ou.y + 0.06, ou.z)
    c.scale = Vector3.create(souffle, 0.04, souffle)
    const bob = Math.sin(t / 320) * 0.35
    filage = (filage + 4.2) % 360
    f.position = Vector3.create(ou.x, ou.y + chevronHeight() + bob, ou.z)
    f.scale = Vector3.create(0.9, 0.75, 0.9)
    const ft = Transform.getMutableOrNull(fleche as Entity)
    if (ft !== null) ft.rotation = Quaternion.fromEulerDegrees(0, filage, 0)
  })
}
