import { engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { itemFile, montable, demonter, monte } from './toy'

/**
 * The piece you just won, in three dimensions, in front of your own camera and nobody else's.
 *
 * The reveal drew a picture of the toy. The toy itself exists: it is the same
 * `assets/toy/item-<rarity>-<mutation>.glb` that will stand on the shelf a second later, with
 * the real baked mutation on it, and the owner asked whether it could be shown rather than
 * drawn (5 Sep). It can, and nothing here is a trick:
 *
 *   VISIBLE TO ONE PLAYER. In this scene an entity is shared only when the server passes it
 *   through `syncEntity`. This one is created by the client, so it lives in that client's
 *   engine and no one else ever sees it.
 *
 *   CENTRED ON THE SCREEN. The holder is parented to `engine.CameraEntity`, which follows the
 *   yaw AND the pitch, so the piece keeps its place on screen while the player looks around.
 *
 *   NEVER LATE. The server names the result seconds before the strip stops, so the model is
 *   mounted then and loads during the spin. `monte()` says when the GLB is really in, and
 *   until it is the interface keeps its 2D card: a reveal can be plainer than intended, it can
 *   never be an empty frame.
 *
 * The two costs are real and small: one holder plus one model entity, one or two materials
 * shared with the shelves, and 660 to 1224 triangles for the length of a reveal, against the
 * 261 k the full field already spends of a million.
 *
 * The one true constraint is the scene's own footprint. An entity entirely outside the parcels
 * is not rendered, and a holder 1.15 m in front of the camera leaves the 192 by 192 m when the
 * player stands at the edge and looks out. That is checked every frame, and the answer is the
 * same as for a model that has not loaded: say so, and let the card carry the moment.
 */
export const revealToyView = {
  /** True only while the piece is really on screen: the interface cuts its hole on this. */
  visible: false
}

/** How far in front of the camera. Closer than an avatar in third person, so it never clips. */
const DIST = 1.15
/** The piece's height in metres. The fit table normalises every model to one metre tall. */
const HAUTEUR = 0.72
const POP_MS = 320
const SORTIE_MS = 220
/** Seconds for a full turn: slow enough to read the shape, fast enough to say "it turns". */
const TOUR_S = 14
/** The scene is 12 by 12 parcels; a metre of margin keeps the holder honestly inside. */
const BORD = 2

let support: Entity | null = null
let phase: 'vide' | 'entre' | 'tient' | 'sort' = 'vide'
let debut = 0
let angle = 0

function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/** Mount the winning piece, hidden, so the GLB loads while the strip is still turning. */
export function preparerRevealToy(code: number): void {
  // Take the previous one away OUTRIGHT, whatever it was doing. Asking it to leave politely
  // would set it to 'sort' and return, and the line below would then overwrite the handle:
  // the old holder would stay parented to the camera, at full size, for ever.
  retirer()
  const e = engine.addEntity()
  Transform.create(e, {
    parent: engine.CameraEntity,
    position: Vector3.create(0, 0, DIST),
    scale: Vector3.Zero()
  })
  montable(e, itemFile(code))
  support = e
  phase = 'vide'
  angle = 0
}

/** The strip has stopped and the hero is coming: grow the piece out of nothing. */
export function ouvrirRevealToy(): void {
  if (support === null) return
  phase = 'entre'
  debut = Date.now()
}

/** The reveal is closing, or the scene is done with the piece. */
function retirer(): void {
  if (support !== null) {
    demonter(support)
    engine.removeEntity(support)
  }
  support = null
  phase = 'vide'
  revealToyView.visible = false
}

/** The reveal is closing: shrink out if it is showing, otherwise just go. */
export function fermerRevealToy(): void {
  if (support !== null && (phase === 'entre' || phase === 'tient')) {
    phase = 'sort'
    debut = Date.now()
    return
  }
  retirer()
}

/** Where the holder really is in the scene, since it hangs off the camera. */
function dansLaScene(): boolean {
  const cam = Transform.getOrNull(engine.CameraEntity)
  if (cam === null) return false
  const devant = Vector3.rotate(Vector3.create(0, 0, DIST), cam.rotation)
  const p = Vector3.add(cam.position, devant)
  return p.x > BORD && p.x < 192 - BORD && p.z > BORD && p.z < 192 - BORD && p.y > 0.5 && p.y < 60
}

export function setupRevealToy(): void {
  engine.addSystem((dt: number) => {
    if (support === null || phase === 'vide') return
    const t = Transform.getMutableOrNull(support)
    if (t === null) return

    angle = (angle + (360 / TOUR_S) * dt) % 360
    t.rotation = Quaternion.fromEulerDegrees(0, angle, 0)

    // The piece shows only when the model is in AND the holder is inside the parcels.
    const pret = monte(support) && dansLaScene()
    const age = Date.now() - debut

    if (phase === 'entre') {
      const k = pret ? easeOutBack(Math.min(1, age / POP_MS)) : 0
      t.scale = Vector3.create(HAUTEUR * k, HAUTEUR * k, HAUTEUR * k)
      revealToyView.visible = pret && k > 0.05
      if (age >= POP_MS && pret) phase = 'tient'
      return
    }
    if (phase === 'tient') {
      const s = pret ? HAUTEUR : 0
      t.scale = Vector3.create(s, s, s)
      revealToyView.visible = pret
      return
    }
    // Leaving: shrink, then take the entity away for good.
    const k = Math.max(0, 1 - age / SORTIE_MS)
    t.scale = Vector3.create(HAUTEUR * k, HAUTEUR * k, HAUTEUR * k)
    revealToyView.visible = false
    if (age >= SORTIE_MS) retirer()
  })
}
