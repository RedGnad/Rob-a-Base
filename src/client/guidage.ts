import { engine, Transform, MeshRenderer, Material, Entity, Tween, TweenSequence, TweenLoop, EasingFunction } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { Plot, CENTER, BELT_HEIGHT } from '../shared/schemas'
import { plastic } from './toy'
import { currentStep } from './tutorial'
import { nearestFreeSquare, slotView } from './slots'
import { crateFoot } from './box'
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
    // Its FOOT: the ring lies on the ground under the target, and the crate's centre put it
    // through the middle of the crate (founder, 20 Nov 2026).
    const caisse = crateFoot()
    if (caisse !== null) return caisse
    // Before the crate stands: the middle of the base, where the OPEN button will put it. Hidden
    // for a few hours on 20 Nov 2026 because a newcomer builds where they stand and the chevron
    // then hangs over their own head; the founder, watching the onboarding the same day, wants
    // it there: it says "here, in your base" for the step.
    return maBase()
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
  The chevron steps aside while the player stands on the square they can build on.

  There, the green marker, the large jumping BUILD HERE (slots.ts) and the ring at the feet already
  say "here", and a chevron on the same spot only crowded the text and the player's name tag
  (capture, 18 Nov 2026). It comes back over the nearest free square as soon as the player stands
  on a refused one, which is when "where" is the question.
*/
function chevronShown(): boolean {
  return !(currentStep() === 'place' && slotView.active && slotView.valid)
}

/*
  A gold arrow over the player's head, pointing at the free square (founder, 18 Nov 2026).

  On a refused square the marker says FOLLOW THE ARROW, and the arrow over the free square is often
  off screen: behind the player, or to one side. So a second arrow travels with the player, above
  their name tag, and always points at that square, the way Crazy Taxi's arrow always points at the
  destination wherever the camera looks. It is a real 3D arrow, not a picture, so it shows the
  direction in the world; it nudges forward and back so the eye catches it, and it tilts its nose
  a little down so it still reads when it points away from the camera. Shown only while placing a
  first base on a refused square; the marker text sits above it (slots.ts, 3.6 m).
*/
/*
  3.25 m, from 2.75: at 2.75 it read as part of the name tag under it, and at 3.05 it still cut
  the tag a little (founder, 20 Nov 2026). The marker text of a refused square went up with it
  (slots.ts, 4.05 m).
*/
const HEAD_ARROW_Y = 3.25
/** Within this distance of the belt's centre the Buy step's arrow steps aside: the player is there. */
const BELT_NEAR_M = 10
const PARKED = Vector3.create(0, -50, 0)

function setupHeadArrow(): void {
  const root = engine.addEntity()
  Transform.create(root, { position: PARKED, scale: Vector3.Zero() })
  const nudge = engine.addEntity()
  Transform.create(nudge, { parent: root })
  Tween.create(nudge, {
    mode: Tween.Mode.Move({ start: Vector3.create(0, 0, -0.08), end: Vector3.create(0, 0, 0.22) }),
    duration: 420,
    easingFunction: EasingFunction.EF_EASEOUTQUAD
  })
  TweenSequence.create(nudge, { sequence: [], loop: TweenLoop.TL_YOYO })
  const shaft = engine.addEntity()
  Transform.create(shaft, { parent: nudge, position: Vector3.create(0, 0, -0.28), scale: Vector3.create(0.17, 0.17, 0.72) })
  MeshRenderer.setBox(shaft)
  // The same glow as the beacon: at 2.6 the gold burnt to white (capture, 20 Nov 2026).
  Material.setPbrMaterial(shaft, plastic(OR, 1))
  const head = engine.addEntity()
  // A cone whose point is turned from +Y to +Z, the direction the arrow points.
  Transform.create(head, {
    parent: nudge, position: Vector3.create(0, 0, 0.3),
    rotation: Quaternion.fromEulerDegrees(90, 0, 0), scale: Vector3.create(0.52, 0.46, 0.52)
  })
  MeshRenderer.setCylinder(head, 0.5, 0)
  Material.setPbrMaterial(head, plastic(OR, 1))

  engine.addSystem(() => {
    const t = Transform.getMutableOrNull(root)
    if (t === null) return
    /*
      Two moments ask "which way": a first base on a refused square, and the Buy step, whose
      target, the belt, is often behind a newcomer who has just shelved inside their base
      (founder, 20 Nov 2026). Shown whichever way the camera looks: for an hour it hid while
      the belt was on screen, and the founder, facing the belt, looked for it and found nothing.
    */
    const step = currentStep()
    const placing = step === 'place' && slotView.active && slotView.auto && !slotView.valid
    const me = placing || step === 'buy' ? Transform.getOrNull(engine.PlayerEntity) : null
    let spot: { x: number; z: number } | null = null
    if (me !== null && placing) spot = nearestFreeSquare()
    else if (me !== null && Math.hypot(CENTER.x - me.position.x, CENTER.z - me.position.z) > BELT_NEAR_M) spot = CENTER
    if (me === null || spot === null) {
      if (t.scale.x !== 0) { t.scale = Vector3.Zero(); t.position = PARKED }
      return
    }
    const yaw = Math.atan2(spot.x - me.position.x, spot.z - me.position.z) * 180 / Math.PI
    t.position = Vector3.create(me.position.x, me.position.y + HEAD_ARROW_Y, me.position.z)
    t.rotation = Quaternion.fromEulerDegrees(14, yaw, 0)
    if (t.scale.x !== 1) t.scale = Vector3.One()
  })
}

export function setupGuidage(): void {
  setupHeadArrow()
  /*
    The genre's marker, not a surveyor's pole. A solid gold column read as amateur noise
    (tester, 31 Aug), and no reference game plants a cylinder: they float a bouncing,
    slowly turning chevron over the target and pulse a flat ring on the ground under it.
    Both ours: emissive plastic, no alpha, no light, two entities as before.
  */
  anneau = engine.addEntity()
  Transform.create(anneau, { position: Vector3.create(0, -50, 0), scale: Vector3.Zero() })
  MeshRenderer.setCylinder(anneau, 0.5, 0.5)
  // A glow the gold survives: at 2.2 and 2.6 the emissive ran every channel past white and the
  // marker read as a white disc and a white cone (capture, 20 Nov 2026).
  Material.setPbrMaterial(anneau, plastic(OR, 1))
  fleche = engine.addEntity()
  Transform.create(fleche, { position: Vector3.create(0, -50, 0), scale: Vector3.Zero() })
  // A cone with its apex at the bottom: an arrowhead pointing at the spot.
  MeshRenderer.setCylinder(fleche, 0, 0.5)
  Material.setPbrMaterial(fleche, plastic(OR, 1))

  /*
    The TARGET is looked up five times a second, the MOTION is written every frame.

    Both ran on the five-a-second tick, so the chevron bobbed and turned in five steps a second
    (founder, 20 Nov 2026: "le chevron est a 4 fps"). Finding the target walks the bases and is
    worth throttling: a target moves at walking pace. Two Transforms a frame are not.
  */
  let acc = 1
  let ou: Vector3 | null = null
  engine.addSystem((dt) => {
    acc += dt
    if (acc >= 0.2) { acc = 0; ou = cible() }
    const c = anneau === null ? null : Transform.getMutableOrNull(anneau)
    const f = fleche === null ? null : Transform.getMutableOrNull(fleche)
    if (c === null || f === null) return
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
    // 21 degrees a second, what 4.2 degrees a tick gave at five ticks a second.
    filage = (filage + 21 * dt) % 360
    f.position = Vector3.create(ou.x, ou.y + 2.6 + bob, ou.z)
    f.scale = chevronShown() ? Vector3.create(0.9, 0.75, 0.9) : Vector3.Zero()
    const ft = Transform.getMutableOrNull(fleche as Entity)
    if (ft !== null) ft.rotation = Quaternion.fromEulerDegrees(0, filage, 0)
  })
}
