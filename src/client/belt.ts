import { TOY, plastic, caisse, demolir , dimCrate} from './toy'
import {
  engine, Transform, MeshRenderer, MeshCollider, Material, TextShape, Billboard, BillboardMode, Entity, PointerEvents, PointerEventType, InputAction, inputSystem, Tween, TextureWrapMode, TextureMovementType, ColliderLayer, AudioSource, GltfContainer
} from '@dcl/sdk/ecs'
import { Color3, Color4, Vector2, Vector3, Quaternion } from '@dcl/sdk/math'
import { Belt, BELT_LENGTH, CENTER, BELT_HEIGHT, beltPosition, BELT_DURATION_S , FALL_END} from '../shared/schemas'
import { clicMonde } from './monde'
import { room } from '../shared/messages'
import { crate, formatIncome, crateSummary } from '../shared/loot-table'
import { HUE, lisible } from './theme'

export const beltView = {
  annonce: '',
  annonceJusqua: 0,
  /**
   * The announcement carries the crate's OWN colour. A single yellow for every tier makes
   * a Basic and an Epic read the same, so the alert stops meaning anything: the point of
   * announcing a rare spawn is that it looks rare.
   */
  annonceColor: '#f5a524',
  annonceTier: 0
}

/**
 * World-label colours, built where they are used.
 *
 * The shared token object is constructed at module load, and the bundler emits these
 * modules with lazy initialisers whose order is its own business: reading it from a
 * function that runs before its module was touched threw every frame. Anything read
 * outside the interface tree therefore builds its own colour from the same hex.
 */
const NOIR = Color3.create(0, 0, 0)
const VERT = Color4.fromHexString(HUE.money + 'ff')

/** One tread cell per belt width, so the pattern is square and tiles without a seam. */
const MAILLE = 2.6
/**
 * Which way the UV offset runs for the tread to travel WITH the crates (+x). The renderer
 * shows the texel at `offset + uv`, so a growing offset moves the picture the other way;
 * -1 is the sign that follows. If a device shows the tread running against the crates, this
 * one number is the fix.
 */
const BELT_DIRECTION = -1

type View = { racine: Entity; item: Entity; label: Entity; nom: Entity; rendement: Entity; progres: number; vu: number; tombe: boolean }
const views = new Map<number, View>()

export function setupBelt(): void {
  /*
    The frame ends where the ride ends. It used to run a full metre past the last point a
    crate travels, and the new falling arc tumbled THROUGH that overhang (owner, 1 Sep,
    screenshot). A decimetre of lip on each end, and every part below, tread speed
    included, derives from this one length so they cannot disagree again.
  */
  const LONG_TAPIS = BELT_LENGTH + 0.2
  /*
    ONE object for the whole installation, frame and pit together.

    It was twelve SDK primitives with six materials: a slab, two rails, seven posts, a pit
    floor and four walls. Twelve rendered objects and six materials is a lot to spend on a
    shape that still read as boxes standing where a conveyor should be, and those two counters
    are exactly the ones that are tight on a phone (775 draw calls of 1000 and 295 materials of
    400 on the full field, against 27 percent of the triangles used). `tools/model/build-belt.py`
    bakes the frame, the end drums, the rollers, the legs, their floor beam, the safety stripe
    and the pit into one mesh of about a thousand triangles with a single six colour swatch
    atlas: one draw call, one material, and a silhouette that says conveyor from any angle.

    The tread stays a plane of its own below, because it is the one part that has to scroll.
  */
  const chassis = engine.addEntity()
  Transform.create(chassis, { position: Vector3.create(CENTER.x, 0, CENTER.z) })
  GltfContainer.create(chassis, {
    src: 'assets/Models/belt.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })

  /*
    The belt moves, because a belt that does not is a table.

    The crates glided and the surface under them stood still, which is the one thing a
    conveyor cannot do. The platform slides a texture's UV offset at a constant speed, and
    that is the whole effect: a tread pattern on a plane laid over the band, scrolling at the
    crates' own speed. It is a plane and not the band's own texture because a box stretches
    its texture onto its sides too; the plane has one clean face, squared by the tiling.
  */
  const tapis = engine.addEntity()
  Transform.create(tapis, {
    position: Vector3.create(CENTER.x, BELT_HEIGHT + 0.18, CENTER.z),
    scale: Vector3.create(LONG_TAPIS, MAILLE, 1),
    rotation: Quaternion.fromEulerDegrees(-90, 0, 0)
  })
  MeshRenderer.setPlane(tapis)
  /*
    The tread is one image of sixteen cells and the material's tiling is (1, 1), on purpose.

    It used to be one cell tiled ten times, and on the handset the tread slid much faster than
    the crates while the desktop was fine (tester, 30 Aug). Read in the mobile client: its
    texture tweens apply their own UV scale, (1, 1) by default, over the material's tiling
    (godot-explorer, scene_runner/components/tween.rs). One cell stretched over the plane,
    moving at the cell rate, is eleven times too fast. With the repetition baked into the
    image, tiling 1 is the truth everywhere, and the offset's unit is one belt length: the
    speed is the crates' metres per second over the plane's length.
  */
  Material.setPbrMaterial(tapis, {
    texture: Material.Texture.Common({
      src: 'assets/textures/belt-strip.png',
      wrapMode: TextureWrapMode.TWM_REPEAT,
      tiling: Vector2.create(1, 1)
    }),
    albedoColor: Color4.White(),
    metallic: 0,
    roughness: 0.55
  })
  Tween.setTextureMoveContinuous(tapis, Vector2.create(BELT_DIRECTION, 0), (BELT_LENGTH / BELT_DURATION_S) / LONG_TAPIS, TextureMovementType.TMT_OFFSET)

  /*
    Drawn from `progres`, advanced locally, corrected by the network.

    Each crate is one parent entity that carries the box, the price, the name and the yield as
    children at fixed offsets, so moving a crate is one Transform write a frame instead of
    four. Between two values from the server the client advances `progres` itself at the same
    rate the server does (`dt / BELT_DURATION_S`), and when a fresh value arrives it snaps to
    it only if the drift is large; small drift is folded in over the next frames. The result
    is a crate that glides even when the server is late, and stops where the server says.
  */
  engine.addSystem((dt) => {
    const vivants = new Set<number>()

    for (const [ent, b] of engine.getEntitiesWith(Belt)) {
      vivants.add(b.articleId)
      let v = views.get(b.articleId)
      if (!v) {
        const r = crate(b.crateTier)
        const c = Color4.fromHexString(r.color + 'ff')
        const p0 = beltPosition(b.progres)

        const racine = engine.addEntity()
        Transform.create(racine, { position: Vector3.create(p0.x, p0.y, p0.z) })

        // Standing ON the belt: the root rides at the belt's reference height, the crate's
        // bottom face sits on the tread, and the labels stack above whatever its size is.
        const item = engine.addEntity()
        Transform.create(item, { parent: racine, position: Vector3.create(0, r.size / 2 - 0.27, 0), scale: Vector3.create(r.size, r.size, r.size) })
        // Pointer only: a crate on the belt is bought with a tap, and it rides above head height.
        // Solid again, on trial. The body was dropped after two ejections blamed on it (1 and
        // 2 Sep); the owner doubts that reading and wants it tested: back to a body, and out
        // again the moment a push reproduces without another cause (owner, 4 Sep).
        MeshCollider.setBox(item, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)
        caisse(item, b.crateTier)
        const haut = r.size - 0.27
        PointerEvents.create(item, {
          pointerEvents: [
            { eventType: PointerEventType.PET_DOWN, eventInfo: { button: InputAction.IA_POINTER, hoverText: `Buy ${r.name}  ${formatIncome(b.price)}  ·  ${crateSummary(b.crateTier)}` } }
          ]
        })

        const label = engine.addEntity()
        Transform.create(label, { parent: racine, position: Vector3.create(0, haut + 0.92, 0), scale: Vector3.create(0.5, 0.5, 0.5) })
        Billboard.create(label, { billboardMode: BillboardMode.BM_Y })
        TextShape.create(label, { text: formatIncome(b.price), fontSize: 4.2, textColor: VERT, outlineWidth: 0.22, outlineColor: NOIR })

        const nom = engine.addEntity()
        Transform.create(nom, { parent: racine, position: Vector3.create(0, haut + 0.56, 0), scale: Vector3.create(0.5, 0.5, 0.5) })
        Billboard.create(nom, { billboardMode: BillboardMode.BM_Y })
        TextShape.create(nom, { text: r.name, fontSize: 3, textColor: Color4.fromHexString(lisible(r.color) + 'ff'), outlineWidth: 0.22, outlineColor: NOIR })

        const rendement = engine.addEntity()
        Transform.create(rendement, { parent: racine, position: Vector3.create(0, haut + 0.28, 0), scale: Vector3.create(0.5, 0.5, 0.5) })
        Billboard.create(rendement, { billboardMode: BillboardMode.BM_Y })
        TextShape.create(rendement, { text: crateSummary(b.crateTier), fontSize: 2.2, textColor: VERT, outlineWidth: 0.22, outlineColor: NOIR })

        v = { racine, item, label, nom, rendement, progres: b.progres, vu: b.progres, tombe: false }
        views.set(b.articleId, v)
      }

      // Advance locally; when the server's value moves, converge on it.
      v.progres += dt / BELT_DURATION_S
      if (b.progres !== v.vu) {
        v.vu = b.progres
        const ecart = b.progres - v.progres
        if (Math.abs(ecart) > 0.05) v.progres = b.progres
        else v.progres += ecart * 0.5
      }
      const tr = Transform.getMutableOrNull(v.racine)
      if (tr !== null) {
        const p = beltPosition(v.progres)
        tr.position = Vector3.create(p.x, p.y, p.z)
        // Off the end, the crate TUMBLES: a turn and a half nose-first over the edge, the
        // little show a conveyor owes its spectators. The price tags vanish at the lip,
        // because a thing falling into a pit is no longer for sale.
        if (v.progres > 1) {
          const t = Math.min((v.progres - 1) / FALL_END, 1)
          tr.rotation = Quaternion.fromEulerDegrees(0, 0, -t * 540)
          // Per frame: the glow has a tween to lose, and losing it takes more than one try.
          dimCrate(v.item)
          /*
            And once the fall is over, nothing of this crate is drawn at all. The server
            retires it a breath later; until then a crate that has landed would sit in the
            pit as scenery, which is what a witness photographed. The view is dropped in the
            same pass that drops a crate the server has already taken away.
          */
          if (v.progres > 1 + FALL_END + 0.004) tr.scale = Vector3.Zero()
          if (!v.tombe) {
            v.tombe = true
            for (const e of [v.label, v.nom, v.rendement]) {
              const te = Transform.getMutableOrNull(e)
              if (te !== null) te.scale = Vector3.Zero()
            }
            // No longer for sale: the Buy prompt goes with the glow.
            PointerEvents.deleteFrom(v.item)
          }
        }
      }

      if (clicMonde(v.item)) {
        void room.send('buyBelt', { articleId: b.articleId })
      }
    }

    for (const [id, v] of views) {
      if (vivants.has(id)) continue
      // The crate's parts, light and mount are the toy module's; it takes them down itself.
      demolir(v.item)
      engine.removeEntityWithChildren(v.racine)
      views.delete(id)
    }

    if (beltView.annonce !== '' && Date.now() > beltView.annonceJusqua) beltView.annonce = ''
  })

  /*
    The announcement's own emitter, parented to the player so it plays at a steady volume
    wherever they stand: the belt can be a hundred metres away and the news still matters.
  */
  const sonAnnonce = engine.addEntity()
  Transform.create(sonAnnonce, { parent: engine.PlayerEntity, position: Vector3.create(0, 1, 0) })
  AudioSource.create(sonAnnonce, { audioClipUrl: 'assets/sounds/belt.wav', playing: false, loop: false, volume: 0.7 })

  room.onMessage('beltAlert', (d) => {
    const r = crate(d.crateTier)
    beltView.annonce = `${r.name} on the belt!  ${crateSummary(d.crateTier)}`
    beltView.annonceColor = r.color
    beltView.annonceTier = d.crateTier
    // A rarer crate stays a little longer, within the same window as every other moment on the
    // band: five to fifteen seconds read as a stuck banner next to toasts that leave in four
    // (owner, 5 Sep). The crate itself glows on the belt for as long as it rolls.
    beltView.annonceJusqua = Date.now() + 3500 + d.crateTier * 500
    // And it is HEARD. The band is at the top of the screen; a player at their own base is
    // looking the other way, which is the very reason the rush has a bell (owner, 5 Sep).
    const a = AudioSource.getMutableOrNull(sonAnnonce)
    if (a !== null) { a.playing = false; a.playing = true }
    console.log(`[CLIENT] announced: ${r.name}`)
  })

  room.onMessage('bought', (d) => {
    console.log(`[CLIENT] ${d.byName} grabbed a ${crate(d.crateTier).name} for ${d.price}`)
  })
}

/**
 * The belt crate within reach of the player, or null.
 *
 * The contextual button's version of the click on a crate: standing at the belt is the
 * intent, the nearest crate is the target, and the hint names it and its price so the
 * player knows which one a press buys before pressing. Reach is one crate's width, so a
 * player walking past the belt is never offered a purchase they did not come for.
 */
export const BELT_REACH = 2.6
export function crateInReach(): { articleId: number; price: number; crateTier: number } | null {
  const t = Transform.getOrNull(engine.PlayerEntity)
  if (t === null) return null
  let best: { articleId: number; price: number; crateTier: number } | null = null
  let dist = BELT_REACH
  for (const [, b] of engine.getEntitiesWith(Belt)) {
    if (b.buyerName !== '') continue
    const p = beltPosition(b.progres)
    const d = Math.hypot(t.position.x - p.x, t.position.z - p.z)
    if (d < dist) { dist = d; best = { articleId: b.articleId, price: b.price, crateTier: b.crateTier } }
  }
  return best
}
export function buyCrate(articleId: number): void { void room.send('buyBelt', { articleId }) }
