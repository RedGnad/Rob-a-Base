import {
  engine, Transform, MeshRenderer, MeshCollider, Material, TextShape, Billboard, BillboardMode,
  PointerEvents, PointerEventType, InputAction, AudioSource, Entity, ColliderLayer
} from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import { replay } from './sfx'
import { Raid } from '../shared/schemas'
import { room } from '../shared/messages'
import { flashDamage, floatAmount, playHurt } from './juice'
import { formatIncome, crate } from '../shared/loot-table'
import { plastic, plasticDe } from './toy'
import { alerter, pushToFeed } from './theft'
import { TOAST } from './theme'
import { LISIBLE_3D } from './texte3d'

/**
 * The raid boss, client side: a big hostile toy that walks a circle on the plaza, a life bar
 * over its head that everyone reads the same, a flash when it is hit and a ring when it
 * swipes. Everything drawn comes from one synced component the server writes; the client
 * adds the smoothing between positions and the timing of the flashes.
 */
export const raidView = { active: false, leftS: 0, nextS: 0, hp: 0, hpMax: 1, topName: '', x: 0, z: 0, distance: 0 }

const NOIR = Color3.create(0, 0, 0)
const PEAU = '#7a1f2e'
const CORNE = '#f2e9d8'
const OEIL = '#ffd166'
const HAUTEUR = 1.7
const FLASH_MS = 160
/** The life bar's width, in metres: as wide as the boss itself. */
const BAR_W = 2.6
const BALAI_MS = 420

export function setupRaid(): void {
  const racine = engine.addEntity()
  Transform.create(racine, { position: Vector3.create(0, -50, 0), scale: Vector3.Zero() })

  /*
    A column of light standing on the boss, tall enough to be read from anywhere on the field.

    A three minute event that everybody is meant to converge on is worth nothing if nobody can
    find it: the tester had a raid running and no way to tell where on the map it was. Every
    game of the genre answers this the same way, with a beam you run towards, and a beam costs
    one entity and no collider. It is deliberately taller than anything built: sixty metres
    against a base's thirty-four at twelve storeys, so it clears the skyline from the far
    corner. Off while no raid runs, and it never gets a collider, because players will walk
    straight through where it stands.
  */
  const phare = engine.addEntity()
  Transform.create(phare, { position: Vector3.create(0, -50, 0), scale: Vector3.Zero() })
  MeshRenderer.setCylinder(phare, 0.55, 0.55)
  Material.setPbrMaterial(phare, {
    albedoColor: Color4.fromHexString('#ff6b6b66'),
    emissiveColor: Color3.fromHexString('#ff6b6b'),
    emissiveIntensity: 2.2,
    alphaTest: 0,
    transparencyMode: 2,
    roughness: 1
  })

  const corps = engine.addEntity()
  Transform.create(corps, { parent: racine, scale: Vector3.create(2.6, 2.6, 2.6) })
  MeshRenderer.setSphere(corps)
  // Pointer only: a physics sphere walking a circle through the crowd shoved avatars around.
  MeshCollider.setSphere(corps, ColliderLayer.CL_POINTER)
  Material.setPbrMaterial(corps, plastic(PEAU, 0.35))
  PointerEvents.create(corps, {
    pointerEvents: [
      { eventType: PointerEventType.PET_DOWN, eventInfo: { showFeedback: false, button: InputAction.IA_POINTER, hoverText: 'RAID BOSS  ·  draw (F) and fire (E)' } }
    ]
  })

  const cornes: Entity[] = []
  for (const cote of [-1, 1]) {
    const c = engine.addEntity()
    Transform.create(c, { parent: racine, position: Vector3.create(cote * 0.9, 1.25, 0), scale: Vector3.create(0.5, 1.1, 0.5) })
    MeshRenderer.setCylinder(c, 0.5, 0)
    Material.setPbrMaterial(c, plastic(CORNE))
    cornes.push(c)
    const oeil = engine.addEntity()
    Transform.create(oeil, { parent: racine, position: Vector3.create(cote * 0.5, 0.35, -1.15), scale: Vector3.create(0.36, 0.36, 0.2) })
    MeshRenderer.setSphere(oeil)
    Material.setPbrMaterial(oeil, plastic(OEIL, 2.5))
  }

  // The halo is an opaque emissive ring at the waist, not a translucent sphere: no alpha.
  const halo = engine.addEntity()
  Transform.create(halo, { parent: racine, scale: Vector3.create(3.4, 0.14, 3.4) })
  MeshRenderer.setCylinder(halo, 0.5, 0.5)
  Material.setPbrMaterial(halo, plastic('#ff4d5e', 3))

  const ombre = engine.addEntity()
  Transform.create(ombre, { parent: racine, position: Vector3.create(0, -HAUTEUR + 0.03, 0), scale: Vector3.create(3.2, 0.02, 3.2) })
  MeshRenderer.setCylinder(ombre, 0.5, 0.5)
  Material.setPbrMaterial(ombre, plasticDe(Color4.create(0, 0, 0, 0.35)))

  const titre = engine.addEntity()
  Transform.create(titre, { parent: racine, position: Vector3.create(0, 2.6, 0), scale: Vector3.create(0.5, 0.5, 0.5) })
  Billboard.create(titre, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(titre, { text: 'RAID BOSS', fontSize: 5, textColor: Color4.fromHexString('#ff6b6bff'), ...LISIBLE_3D })
  /*
    The life bar is a BAR: a dark track and a red fill that shortens, over the head, turned
    to face whoever looks. It was a line of hash marks in a text shape, which reads as a
    console and not as a wound (owner, 3 Sep). Two boxes, opaque, on the budget only while
    a raid runs. The text below it keeps the one thing a bar cannot say: who leads.
  */
  const jauge = engine.addEntity()
  Transform.create(jauge, { parent: racine, position: Vector3.create(0, 2.2, 0) })
  Billboard.create(jauge, { billboardMode: BillboardMode.BM_Y })
  const piste = engine.addEntity()
  Transform.create(piste, { parent: jauge, scale: Vector3.create(BAR_W, 0.24, 0.05) })
  MeshRenderer.setBox(piste)
  Material.setPbrMaterial(piste, plasticDe(Color4.create(0.05, 0.08, 0.16, 1)))
  const vie = engine.addEntity()
  Transform.create(vie, { parent: jauge, position: Vector3.create(0, 0, -0.04), scale: Vector3.create(BAR_W, 0.18, 0.05) })
  MeshRenderer.setBox(vie)
  Material.setPbrMaterial(vie, plastic('#ff4d5e', 1.8))
  const barre = engine.addEntity()
  Transform.create(barre, { parent: racine, position: Vector3.create(0, 1.85, 0), scale: Vector3.create(0.5, 0.5, 0.5) })
  Billboard.create(barre, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(barre, { text: '', fontSize: 2.6, textColor: Color4.White(), ...LISIBLE_3D })

  const son = engine.addEntity()
  Transform.create(son, { parent: engine.PlayerEntity, position: Vector3.create(0, 1, 0) })
  // The bell, shared with the rush: an event's voice, not the common crate's (ledger, 5 Sep).
  AudioSource.create(son, { audioClipUrl: 'assets/sounds/bell.wav', playing: false, loop: false, volume: 0.85 })

  room.onMessage('raidSwipe', (d) => {
    flashDamage()
    floatAmount(d.lost, true)
    playHurt()
    /*
      Pas de toast, exactement comme un tir recu.

      Ces trois lignes SONT les trois canaux que `combat.ts` a retenus le 6 Sep pour `wasShot`:
      le flash rouge dit que c'est arrive, le chiffre rouge dit ce que ca coute, le son dit que
      ca fait mal. La plaque qui suivait etait une quatrieme copie, posee en plein milieu du
      combat, et elle disait en mots ce que les pieces qui tombent au sol montrent deja
      (proprietaire, 8 Sep: "ce qui se passe a l'ecran est assez signifiant").

      Meme situation que le tir, donc meme regle: le monde repond, l'interface se tait.
    */
  })
  room.onMessage('raidWon', (d) => {
    alerter(`BOSS DOWN  ·  ${crate(d.crate).name} is yours`, '#ffd166', TOAST.event)
  })
  room.onMessage('raidOver', (d) => {
    pushToFeed(d.slain ? `${d.winner} slew the boss` : 'the boss left')
  })

  let etaitActif = false
  let vu = { x: 0, z: 0 }
  let barText = ''
  let dernierePart = -1
  let flashOn = false
  /*
    Two clocks, never subtracted from each other.

    The flash and the swipe read `now - r.hitAtMs`, with `now` the CLIENT's clock and the
    stamp the SERVER's. The two are never in step: a client a fifth of a second ahead sees
    every window already expired and nothing ever flashes, one behind sees a window that
    never closes and the boss stays white (owner, 5 Sep: "le boss ne clignote plus"). So the
    client watches the stamp CHANGE and starts its own window from its own clock.
  */
  let vuHit = 0
  let hitLocal = -1e9
  let vuSwipe = 0
  let swipeLocal = -1e9
  engine.addSystem((dt) => {
    let r: ReturnType<typeof Raid.get> | null = null
    for (const [, v] of engine.getEntitiesWith(Raid)) { r = v; break }
    const now = Date.now()
    if (r === null) { raidView.active = false; return }
    raidView.active = r.active
    raidView.leftS = r.active ? Math.max(0, Math.ceil((r.untilMs - now) / 1000)) : 0
    raidView.nextS = !r.active && r.nextMs > now ? Math.ceil((r.nextMs - now) / 1000) : 0
    raidView.hp = r.hp
    raidView.hpMax = Math.max(1, r.hpMax)
    raidView.topName = r.topName
    raidView.x = r.x
    raidView.z = r.z

    const t = Transform.getMutableOrNull(racine)
    if (t === null) return
    if (!r.active) {
      if (t.scale.x !== 0) t.scale = Vector3.Zero()
      const pe = Transform.getMutableOrNull(phare)
      if (pe !== null && pe.scale.x !== 0) pe.scale = Vector3.Zero()
      raidView.distance = 0
      etaitActif = false
      return
    }
    if (!etaitActif) {
      etaitActif = true
      vu = { x: r.x, z: r.z }
      /*
        La caisse n'est plus la Legendary depuis le 2 Sep, et cette phrase le promettait encore.

        `crateDuButin` donne un cran au-dessus du meilleur objet du gagnant: une Good a qui n'a
        que des Commons, une Mythic a qui tient des Legendary. Annoncer "A LEGENDARY" a toute la
        place etait donc faux pour presque tout le monde, et faux publiquement. On annonce ce qui
        est vrai a tous les paliers, et le palier exact se decouvre en gagnant.
      */
      alerter('BOSS UP  ·  top damage takes a crate', '#ff6b6b', TOAST.event)
      replay(son)
    }
    // Glide toward the last position the server wrote.
    vu = { x: vu.x + (r.x - vu.x) * Math.min(1, dt * 6), z: vu.z + (r.z - vu.z) * Math.min(1, dt * 6) }
    const bob = Math.sin(now / 350) * 0.12
    t.position = Vector3.create(vu.x, HAUTEUR + bob, vu.z)
    // Face where the server says it looks: the carved face is on the model's -z, so +z points
    // away, hence atan2(-faceX, -faceZ). The server already turned at a bounded rate.
    if (Math.hypot(r.faceX, r.faceZ) > 0.01) {
      t.rotation = Quaternion.fromEulerDegrees(0, Math.atan2(-r.faceX, -r.faceZ) * 180 / Math.PI, 0)
    }
    /*
      Hit: the body swells AND goes white for the flash window. The swell alone was read
      as the boss breathing, not as a hit landing (testers, 3 Sep). A white flash is the
      genre's hit signal for the thing being hit, red being reserved for the player's own
      damage; the material swap happens on the edges only, never per frame.
    */
    if (r.hitAtMs !== vuHit) { vuHit = r.hitAtMs; if (r.hitAtMs > 0) hitLocal = now }
    const touche = now - hitLocal < FLASH_MS
    const frappe = touche ? 1.12 : 1
    t.scale = Vector3.create(frappe, frappe, frappe)
    if (touche !== flashOn) {
      flashOn = touche
      Material.setPbrMaterial(corps, touche ? plastic('#ffffff', 4) : plastic(PEAU, 0.35))
    }

    // The beam follows the same smoothed position, breathing so it reads as alive from afar.
    const souffle = 1 + Math.sin(now / 420) * 0.14
    const pe = Transform.getMutableOrNull(phare)
    if (pe !== null) {
      pe.position = Vector3.create(vu.x, 30, vu.z)
      pe.scale = Vector3.create(souffle, 60, souffle)
    }
    if (Transform.has(engine.PlayerEntity)) {
      const moi = Transform.get(engine.PlayerEntity).position
      raidView.distance = Math.round(Math.hypot(moi.x - vu.x, moi.z - vu.z))
    }

    // The swipe: the halo swells for a moment, which is the warning and the hit in one shape.
    if (r.swipeAtMs !== vuSwipe) { vuSwipe = r.swipeAtMs; if (r.swipeAtMs > 0) swipeLocal = now }
    const balai = now - swipeLocal
    const ht = Transform.getMutableOrNull(halo)
    if (ht !== null) {
      const s = balai >= 0 && balai < BALAI_MS ? 3.4 + (1 - balai / BALAI_MS) * 4.6 : 3.4
      if (Math.abs(ht.scale.x - s) > 0.01) ht.scale = Vector3.create(s, 0.14, s)
    }

    const part = Math.max(0, Math.min(1, r.hp / Math.max(1, r.hpMax)))
    if (Math.abs(part - dernierePart) > 0.004) {
      dernierePart = part
      const vt = Transform.getMutableOrNull(vie)
      if (vt !== null) {
        // Anchored on the left: the fill shrinks toward the start of the track, as bars do.
        vt.scale = Vector3.create(Math.max(0.001, BAR_W * part), 0.18, 0.05)
        vt.position = Vector3.create(-(BAR_W * (1 - part)) / 2, 0, -0.04)
      }
    }
    const ligne = `${Math.round(part * 100)}%${r.topName !== '' ? `   ·   top: ${r.topName}` : ''}`
    if (ligne !== barText) {
      barText = ligne
      const tb = TextShape.getMutableOrNull(barre)
      if (tb !== null) tb.text = ligne
    }
  })
}
