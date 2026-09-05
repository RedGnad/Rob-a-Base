import { engine, Entity, Transform, MeshRenderer, Material } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { itemFile, montable, demonter, monte, figerMonture } from './toy'

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
/** Where it starts, before it comes at you: the pop is a move as well as a scale. */
const DIST_POP = 1.55
/** The piece's height in metres. The fit table normalises every model to one metre tall. */
const HAUTEUR = 0.72
const POP_MS = 380
const SORTIE_MS = 240
/**
 * Seconds for a full turn.
 *
 * It was fourteen, and a reveal lasts a little over two: the piece turned fifty degrees in
 * all and read as a photograph (owner, 5 Sep, "pas en rotation"). At four and a half it turns
 * most of the way round while you look at it, which is what says "this is an object".
 */
const TOUR_S = 4.5
/** Tipped, like the pictures on the cards: a piece square to the camera is an inventory row. */
const ROULIS = 8
const PIQUE = -7
/**
 * The dark plate the piece stands against.
 *
 * The interface can cut a window in its veil, and behind that window is the world, bright and
 * busy: the owner saw "des carres plus clairs" and a piece he could not read. A screen cannot
 * darken what is behind it, so the darkness has to be an object too: one plane, parented to
 * the same camera, just behind the piece, big enough to fill the window from that distance.
 */
const FOND_Z = 0.55
/*
  Sized to the window and no wider.

  It was 3.2 by 2.2 m at two metres, which covers nearly the whole screen: on a monitor wider
  than the interface canvas it showed as a black slab beside the veil (owner, 5 Sep). The
  window the interface cuts is about 380 units of a 1080 tall canvas, a bit over a third of
  the height, so at 1.7 m with a sixty degree field the plate needs about 0.8 m of height and
  a little more width. Pure black, like the veil around it, so the two read as one field
  rather than as two different darks.
*/
const FOND_L = 1.25
const FOND_H = 0.95
/** The scene is 12 by 12 parcels; a metre of margin keeps the holder honestly inside. */
const BORD = 2

let support: Entity | null = null
let fond: Entity | null = null
let phase: 'vide' | 'entre' | 'tient' | 'sort' = 'vide'
let debut = 0
let angle = 0
let fige = false

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
    position: Vector3.create(0, 0, DIST_POP),
    scale: Vector3.Zero()
  })
  montable(e, itemFile(code))
  support = e

  const f = engine.addEntity()
  Transform.create(f, {
    parent: engine.CameraEntity,
    position: Vector3.create(0, 0, DIST + FOND_Z),
    scale: Vector3.Zero()
  })
  MeshRenderer.setPlane(f)
  Material.setPbrMaterial(f, {
    albedoColor: Color4.create(0, 0, 0, 1),
    emissiveColor: Color3.Black(),
    metallic: 0, roughness: 1, specularIntensity: 0
  })
  fond = f

  phase = 'vide'
  angle = 0
  fige = false
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
  if (fond !== null) engine.removeEntity(fond)
  support = null
  fond = null
  phase = 'vide'
  fige = false
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
    t.rotation = Quaternion.fromEulerDegrees(PIQUE, angle, ROULIS)

    // The piece shows only when the model is in AND the holder is inside the parcels.
    const pret = monte(support) && dansLaScene()
    if (pret && !fige) { figerMonture(support); fige = true }
    const age = Date.now() - debut
    const tf = fond === null ? null : Transform.getMutableOrNull(fond)

    const poser = (k: number): void => {
      t.scale = Vector3.create(HAUTEUR * k, HAUTEUR * k, HAUTEUR * k)
      t.position = Vector3.create(0, 0, DIST_POP + (DIST - DIST_POP) * Math.min(1, k))
      if (tf !== null) tf.scale = Vector3.create(FOND_L * Math.min(1, k * 1.6), FOND_H * Math.min(1, k * 1.6), 1)
    }

    if (phase === 'entre') {
      const k = pret ? easeOutBack(Math.min(1, age / POP_MS)) : 0
      poser(k)
      revealToyView.visible = pret && k > 0.05
      if (age >= POP_MS && pret) phase = 'tient'
      return
    }
    if (phase === 'tient') {
      poser(pret ? 1 : 0)
      revealToyView.visible = pret
      return
    }
    // Leaving: back away and shrink, the entrance played backwards and faster.
    const k = Math.max(0, 1 - age / SORTIE_MS)
    poser(k * k)
    revealToyView.visible = false
    if (age >= SORTIE_MS) retirer()
  })
}
