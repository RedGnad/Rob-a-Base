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
/*
  THE DARKNESS IS THE PLANE, and there is no hole anywhere.

  The first design cut a window in the interface's veil and stood the piece in it. That cannot
  be made to work, and the reason is worth writing down: the piece hangs off the CAMERA, so it
  sits at the middle of the screen, while an interface element sits on a canvas whose aspect
  ratio is fixed. On any screen that is not that aspect the two centres are different points,
  and no amount of measuring makes a rectangle drawn in one space line up with an object living
  in the other. The owner's instruction settles it: this must not depend on the screen, on
  desktop or on a phone (5 Sep).

  So the veil is not drawn at all while the piece is out, and the plate behind the piece is
  what darkens the world. It is a world object parented to the camera, so it is centred on the
  view by construction, at any aspect, forever. Sized once to cover the widest screen anyone
  will bring: at 1.7 m, a sixty degree vertical field shows 1.96 m of height, and 5.6 m of
  width covers an aspect of 2.85, well past the 2.30 of an ultra wide monitor and the 2.22 of a
  phone. Two triangles and one material for a thing that cannot be misaligned.
*/
const FOND_Z = 0.55
const FOND_L = 5.6
const FOND_H = 2.4
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
      // The plate opens FIRST and closes last: the room goes dark, then the piece arrives.
      if (tf !== null) {
        const kf = Math.min(1, k * 2.2)
        tf.scale = Vector3.create(FOND_L * kf, FOND_H * kf, 1)
      }
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
