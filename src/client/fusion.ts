import { engine, Transform, MeshRenderer, MeshCollider, Material, PointerEvents, PointerEventType, InputAction, inputSystem, Entity, ColliderLayer, Tween, EasingFunction, GltfContainer } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { Fusion, FUSION_POS, FUSION_NEEDS, FUSION_ECHELLE, FUSION_RANGE, CENTER } from '../shared/schemas'
import { room } from '../shared/messages'
import { RARITIES, rarityOf, mutationDe, itemName, itemColor, rarity } from '../shared/loot-table'
import { plasticDe, plastic, vif, TOY, remonter, demonter, spinLoop, itemFile } from './toy'
import { carryView } from './carry'
import { revealItem } from './box'
import { openFuser, closeFuser, fuserPanelView } from './fusion-ui'
import { clicMonde } from './monde'
import { pushToFeed } from './theft'
import { fuseBurst, startFuserSteam, steamPuff } from './vfx'

/**
 * The fusion machine, client side: a small steam machine beside the records board, with three
 * funnels, a pressure gauge, a porthole and a chimney (since 17 Nov 2026; it was a drum with
 * three sockets and a floating ball).
 *
 * What it shows is decided by two sources. The funnels, the gauge and the piece in the porthole
 * are YOURS: they show what you have fed so far, read from the per-player state the server
 * sends. The porthole's back light is EVERYONE'S: it takes the colour of the last thing that
 * came out of the machine, for a while, so a player crossing the plaza sees that somebody just
 * made a Rare, which is the point of putting the machine where people walk.
 */
export const fuserView = { codes: [] as number[] }

const NOIR = Color3.create(0, 0, 0)
const DOME_BRILLE_MS = 45_000
/*
  La boule RESPIRE en blanc, sur une periode qui n'est pas celle de son flottement.

  Le mouvement l'avait sortie du decor, mais une bille creme immobile en VALEUR reste une
  bille. Apres le deplacement, ce que la vision peripherique lit le mieux est le changement de
  luminosite, donc la respiration passe par l'emissif. C'est aussi la seule voie qui rende
  partout: les `LightSource` ne sont pas rendues sur le preset telephone
  (`sceneLightsEnabled: 0`) et sont bannies ici de toute facon, elles font planter le client
  bureau (voir la note plus bas). L'emissif, lui, rend sur mobile: c'est meme la recette que la
  doc donne pour ce client, un albedo SOMBRE d'ou sort la couleur, ce que fait `plastic()`.

  Deux periodes qui ne se rencontrent pas: 2100 ms pour le flottement, 3400 ms pour la
  lumiere. Leur rapport vaut 1,619, le nombre d'or a trois milliemes, donc les deux vagues ne
  se realignent jamais dans le temps d'un regard. Une periode partagee aurait donne un
  clignotant, c'est-a-dire une machine: exactement le defaut corrige sur les pieces des
  etageres.

  Et elle reste FAIBLE: 0,55 d'emissif au sommet contre 1,6 quand une fusion la colore. La
  respiration dit "cette chose est vivante", la couleur dit "quelqu'un vient de fabriquer",
  et les deux ne doivent pas se disputer le meme niveau.

  Le materiau n'est PAS reecrit a chaque image. La valeur est arrondie a vingt-quatre paliers
  par cycle, sept ecritures par seconde au lieu de soixante, et l'ecart entre deux paliers
  voisins vaut 0,019 d'emissif, sous le seuil de perception. Une ecriture de materiau par
  image est une mise a jour reseau par image, ce que ce fichier refuse partout ailleurs.
*/
const PULSE_MS = 3400
const PULSE_PAS = 24
const PULSE_MIN = 0.10
const PULSE_MAX = 0.55
/** Le repos de la boule: un creme assombri d'ou sort de la lumiere blanche, jamais l'inverse. */
function domeRepos(k: number) {
  const c = Color4.fromHexString(TOY.wallCream + 'ff')
  const sombre = 0.55
  return {
    albedoColor: Color4.create(c.r * sombre, c.g * sombre, c.b * sombre, 1),
    emissiveColor: Color3.create(1, 1, 1),
    emissiveIntensity: PULSE_MIN + k * (PULSE_MAX - PULSE_MIN),
    metallic: 0,
    roughness: 0.45
  }
}
const AMPOULE = 16000

function couleur(rarete: number, mut = 0): Color4 {
  return vif(itemColor(Math.max(0, Math.min(rarete, RARITIES.length - 1)), mut))
}

/*
  The machine's body is one model (tools/model/build-fuser.py, a small steam machine). These are
  the parts of it that move, placed with the numbers that file builds around: machine units,
  front on -Z, before the root's `FUSION_ECHELLE`. Each moving part says one rule of the fusion
  (founder, 17 Nov 2026): a lit ball drops into a funnel per piece fed, the gauge's needle climbs
  a third per piece, the porthole spins the piece being fused, the chimney breathes steam.
*/
const FUNNEL_X = [-0.55, 0, 0.55]
const FUNNEL_Z = -0.25
const FUNNEL_BALL_Y = 2.88
const FUNNEL_BALL = 0.34
const FRONT = -0.85
const GAUGE_Y = 1.6
const PORTHOLE_Y = 0.85
const PORTHOLE_DISC = 0.56
const PIECE_SCALE = 0.42
const CHIMNEY_TOP = Vector3.create(0, 3.34, 0.42)
/** The gauge's marks, in degrees on the dial seen from the front: empty, one third, two thirds, full. */
function needleDeg(fed: number): number { return 225 - 90 * Math.max(0, Math.min(FUSION_NEEDS, fed)) * (3 / FUSION_NEEDS) }

/** The machine turns its front, porthole and gauge to the middle of the plaza, where people walk. */
const FACING_DEG = Math.atan2(-(CENTER.x - FUSION_POS.x), -(CENTER.z - FUSION_POS.z)) * 180 / Math.PI

/** A point of the machine, in the world: what a world-space effect needs. */
function machinePoint(local: Vector3): Vector3 {
  const a = FACING_DEG * Math.PI / 180
  const x = local.x * Math.cos(a) + local.z * Math.sin(a)
  const z = -local.x * Math.sin(a) + local.z * Math.cos(a)
  return Vector3.create(FUSION_POS.x + x * FUSION_ECHELLE, local.y * FUSION_ECHELLE, FUSION_POS.z + z * FUSION_ECHELLE)
}

export function setupFuser(): void {
  const racine = engine.addEntity()
  Transform.create(racine, {
    position: Vector3.create(FUSION_POS.x, 0, FUSION_POS.z),
    rotation: Quaternion.fromEulerDegrees(0, FACING_DEG, 0),
    // Everything is a child of this root, so the body, its collider and the moving parts all
    // follow one number.
    scale: Vector3.create(FUSION_ECHELLE, FUSION_ECHELLE, FUSION_ECHELLE)
  })

  const model = engine.addEntity()
  Transform.create(model, { parent: racine })
  GltfContainer.create(model, { src: 'assets/Models/fuser.glb', visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })

  // The body is solid and clickable through two plain colliders, not through the model's
  // thousand triangles: the plinth, and a drum round the boiler.
  const plinth = engine.addEntity()
  Transform.create(plinth, { parent: racine, position: Vector3.create(0, 0.15, 0), scale: Vector3.create(2.6, 0.3, 2.6) })
  MeshCollider.setBox(plinth)
  const body = engine.addEntity()
  Transform.create(body, { parent: racine, position: Vector3.create(0, 1.3, 0), scale: Vector3.create(1.8, 2.0, 1.8) })
  // Solid as well as clickable: a body there stops a player walking through the machine (owner, 4 Sep).
  MeshCollider.setCylinder(body, 0.5, 0.5, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)
  PointerEvents.create(body, {
    pointerEvents: [
      { eventType: PointerEventType.PET_DOWN, eventInfo: { showFeedback: false, button: InputAction.IA_POINTER, hoverText: `Fuse  ·  ${FUSION_NEEDS} of a kind become one better` } }
    ]
  })

  /*
    The porthole's back light carries what the floating ball carried: it is EVERYONE'S. At rest
    it breathes white, which the eye catches from the side of the plaza; after a fusion by
    anybody it takes the new piece's colour for a while and takes the hit with an elastic
    shake. The tube of the porthole hides whatever of the shake overflows the window.
  */
  const glow = engine.addEntity()
  const GLOW = Vector3.create(PORTHOLE_DISC, 0.02, PORTHOLE_DISC)
  Transform.create(glow, {
    parent: racine, position: Vector3.create(0, PORTHOLE_Y, FRONT - 0.045),
    rotation: Quaternion.fromEulerDegrees(90, 0, 0), scale: GLOW
  })
  MeshRenderer.setCylinder(glow, 0.5, 0.5)
  Material.setPbrMaterial(glow, domeRepos(0))

  // The piece being fused is YOURS: the last one you fed turns in the porthole.
  const piece = engine.addEntity()
  Transform.create(piece, { parent: racine, position: Vector3.create(0, PORTHOLE_Y, FRONT - 0.17), scale: Vector3.create(PIECE_SCALE, PIECE_SCALE, PIECE_SCALE) })
  spinLoop(piece, 6000)

  // One ball per funnel, shown only for the pieces you have fed, in their rarity's colour.
  const balls: Entity[] = []
  for (let i = 0; i < FUSION_NEEDS; i++) {
    const b = engine.addEntity()
    Transform.create(b, { parent: racine, position: Vector3.create(FUNNEL_X[i % FUNNEL_X.length], FUNNEL_BALL_Y, FUNNEL_Z), scale: Vector3.Zero() })
    MeshRenderer.setSphere(b)
    balls.push(b)
  }

  // The needle turns about the dial's centre: a pivot, and a bar that starts at it.
  const needle = engine.addEntity()
  Transform.create(needle, { parent: racine, position: Vector3.create(0, GAUGE_Y, FRONT - 0.135), rotation: Quaternion.fromEulerDegrees(0, 0, needleDeg(0)) })
  const bar = engine.addEntity()
  Transform.create(bar, { parent: needle, position: Vector3.create(0.075, 0, 0), scale: Vector3.create(0.16, 0.03, 0.012) })
  MeshRenderer.setBox(bar)
  Material.setPbrMaterial(bar, plastic('#b3261e'))

  startFuserSteam(machinePoint(CHIMNEY_TOP))

  /*
    NO TEXT ABOVE THE MACHINE. There were two lines, the FUSE sign and the sentence explaining
    the rule; nobody reads an instruction floating over an object, and the sign went with it:
    the machine says itself, by its shape and its moving parts, and the contextual button says
    FUSE as soon as you come near (owner, 7 Sep). One sign less is also four glyph planes and
    their materials less, on the one counter that nears its ceiling.
  */
  room.onMessage('fusionState', (d) => {
    fuserView.codes = [...d.codes]
    if (d.made >= 0) {
      // The same reveal as a crate, and nothing else: it already names the piece, and a
      // toast saying it again at the same instant told the story twice (owner, 6 Sep).
      revealItem(d.made)
    }
  })
  room.onMessage('fused', (d) => {
    pushToFeed(`${d.byName} fused a ${rarity(d.rarity).name}`)
    // Everyone on the plaza sees it happen at the machine, not only in the feed: stars over
    // the funnels, a puff out of the chimney.
    fuseBurst(d.rarity, itemColor(d.rarity, d.mutation))
    steamPuff(machinePoint(CHIMNEY_TOP))
  })

  let drawn = ''
  let lastPulse = 0
  let pulseSeen = -1
  let fusionSeen = 0
  let fusionLocal = -1e9
  let needleAt = 0
  engine.addSystem(() => {
    // A toy in hand feeds the machine; empty hands open the panel that fuses from the shelves.
    if (clicMonde(body)) {
      if (carryView.code < 0) openFuser()
      else void room.send('feedFusion', {})
    }

    /*
      THE WINDOW FOLLOWS THE MACHINE, and closes when the player leaves it.

      Nothing was closing it, so a player could open the panel, walk home, and press FUSE from
      their own base (owner, 9 Sep). The server measures the distance itself before it fuses
      anything (src/server/fusion.ts), so the window closes on the server's own constant.
    */
    if (fuserPanelView.open && Transform.has(engine.PlayerEntity)) {
      const p = Transform.get(engine.PlayerEntity).position
      const dx = p.x - FUSION_POS.x
      const dz = p.z - FUSION_POS.z
      if (Math.sqrt(dx * dx + dz * dz) > FUSION_RANGE) closeFuser()
    }

    let f: { byName: string; rarity: number; count: number; lastName: string; lastCode: number; atMs: number } | null = null
    for (const [, v] of engine.getEntitiesWith(Fusion)) { f = v; break }
    const now = Date.now()
    // The stamp is the SERVER's clock, so the client watches it CHANGE and runs the window on
    // its own clock (owner, 5 Sep).
    if (f !== null && f.atMs !== fusionSeen) { fusionSeen = f.atMs; if (f.atMs > 0) fusionLocal = now }
    const lit = f !== null && f.lastCode >= 0 && now - fusionLocal < DOME_BRILLE_MS
    // The breathing runs outside the key below: it changes all the time, the key almost never.
    if (lit) pulseSeen = -1
    else {
      const wave = 0.5 - 0.5 * Math.cos(((now % PULSE_MS) / PULSE_MS) * Math.PI * 2)
      const step = Math.round(wave * PULSE_PAS)
      if (step !== pulseSeen) { pulseSeen = step; Material.setPbrMaterial(glow, domeRepos(step / PULSE_PAS)) }
    }
    const mine = fuserView.codes.length
    const myRarity = mine > 0 ? rarityOf(fuserView.codes[0]) : -1
    const myLast = mine > 0 ? fuserView.codes[mine - 1] : -1
    if (f !== null && f.atMs > lastPulse && f.lastCode >= 0) {
      lastPulse = f.atMs
      Tween.createOrReplace(glow, {
        mode: Tween.Mode.Scale({ start: Vector3.create(GLOW.x * 1.3, GLOW.y, GLOW.z * 1.3), end: GLOW }),
        duration: 520,
        easingFunction: EasingFunction.EF_EASEOUTELASTIC
      })
    }

    // One string for everything drawn, rewritten only when it changes: a material written
    // every frame is a network update every frame.
    const key = `${mine}|${myRarity}|${myLast}|${lit ? f!.lastCode : -1}|${f?.count ?? 0}|${f?.rarity ?? -1}|${f?.byName ?? ''}`
    if (key === drawn) return
    drawn = key

    for (let i = 0; i < balls.length; i++) {
      const full = i < mine
      const t = Transform.getMutable(balls[i])
      t.scale = full ? Vector3.create(FUNNEL_BALL, FUNNEL_BALL, FUNNEL_BALL) : Vector3.Zero()
      if (full) Material.setPbrMaterial(balls[i], plasticDe(couleur(myRarity), 1.4))
    }
    if (mine > 0) remonter(piece, itemFile(myLast))
    else demonter(piece)
    if (mine !== needleAt) {
      const from = needleDeg(needleAt)
      needleAt = mine
      Tween.createOrReplace(needle, {
        mode: Tween.Mode.Rotate({ start: Quaternion.fromEulerDegrees(0, 0, from), end: Quaternion.fromEulerDegrees(0, 0, needleDeg(mine)) }),
        duration: 450,
        easingFunction: EasingFunction.EF_EASEOUTBACK
      })
    }
    if (lit && f !== null) {
      const c = couleur(rarityOf(f.lastCode), mutationDe(f.lastCode))
      /*
        NO LightSource here, and none anywhere else in this scene: creating then deleting one
        crashed the desktop client (NullReferenceException in `LightSourceApplyPropertiesSystem`,
        5 Sep), and the component did not exist on mobile before v1.13.0. The emissive back
        light carries the whole effect.
      */
      Material.setPbrMaterial(glow, plasticDe(Color4.create(c.r, c.g, c.b, 1), 1.6))
    } else {
      // Nothing to write: the breathing takes over on the next frame and sets the rest state.
      pulseSeen = -1
    }
  })
}

/** Standing at the fuser: empty hands open the panel, a toy in hand feeds the machine. */
export const FUSER_REACH = 3
export function fuserInReach(): boolean {
  const t = Transform.getOrNull(engine.PlayerEntity)
  if (t === null) return false
  return Math.hypot(t.position.x - FUSION_POS.x, t.position.z - FUSION_POS.z) <= FUSER_REACH
}
export function agirSurFuser(): void {
  if (carryView.code < 0) openFuser()
  else void room.send('feedFusion', {})
}
