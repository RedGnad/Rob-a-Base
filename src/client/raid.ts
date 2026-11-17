import {
  engine, Transform, MeshRenderer, MeshCollider, Material, TextShape, Billboard, BillboardMode,
  PointerEvents, PointerEventType, InputAction, AudioSource, Entity, ColliderLayer, Animator, GltfContainer
} from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import { replay, volumeInitial } from './sfx'
import { puff } from './impact'
import { Raid, RAID_RAGE_AT, RAID_SWIPE_RANGE } from '../shared/schemas'
import { room } from '../shared/messages'
import { flashDamage, floatAmount, playHurt } from './juice'
import { crate } from '../shared/loot-table'
import { plastic, plasticDe } from './toy'
import { alerter, pushToFeed } from './theft'
import { TOAST } from './theme'
import { LISIBLE_3D } from './texte3d'
import { bossDeathBurst, bossLandBurst, bossLeaveBurst, bossSlamBurst, startBossRage, stopBossRage } from './vfx'

/**
 * The raid boss, client side: a big hostile toy that hunts across the plaza, a life bar over
 * its head that everyone reads the same, a flash when it is hit, and its slam: it rears up, a
 * red disc fills on the floor, and it lands. Everything drawn comes from one synced component
 * and one message the server writes; the client adds the smoothing between positions and the
 * timing of the moments.
 */
export const raidView = { active: false, leftS: 0, nextS: 0, hp: 0, hpMax: 1, topName: '', x: 0, z: 0, distance: 0 }

const SKIN = '#7a1f2e'
/**
 * At half life it runs hot: a deeper red with a little of it coming out. A brighter red at a
 * stronger glow washed out to pink under the sky (capture, 3 Nov), which reads cute, not angry.
 */
const SKIN_RAGE = '#b3201a'
const HORN = '#f2e9d8'
const EYE = '#ffd166'
const EYE_RAGE = '#ff5a1f'
const HEIGHT = 1.7
const FLASH_MS = 160
/** The life bar's width, in metres: as wide as the boss itself. */
const BAR_W = 2.6
/** The slam's shock wave: from the feet to the edge of the announced disc, in this long. */
const WAVE_MS = 300
/** The hit flash on a monster, at most this often: no flash above three a second (photosensitivity). */
const HIT_FLASH_EVERY_MS = 340
/** The "boss stop": it freezes on a white flash for this long before it falls. */
const STOP_MS = 200
/** It falls from this high when it appears, over ARRIVE_MS, and lands with a slam's dust. */
const ARRIVE_H = 14
const ARRIVE_MS = 550
/** How high it rears before it slams, and how long the squash of the landing lasts. */
const REAR_H = 1.2
const IMPACT_MS = 180
/** Felled: it swells white for this long, then bursts. Left: it sinks into the floor over LEAVE_MS. */
const DEATH_SWELL_MS = 260
const LEAVE_MS = 900
/** A disc whose slam never came (message lost, raid over) is cleared this long after it filled. */
const WINDUP_GRACE_MS = 700

/*
  THE MONSTER (3 Nov, owner: "un vrai modèle rigé pour le monstre ? voire plusieurs"). Three of
  Quaternius' Ultimate Monsters (CC0, `NOTICE.md`), one per raid in turn, picked from the raid's
  end time so every client draws the same one without a new synced field. They share one rig and
  one set of clip names, so one table of moments drives them all. The toy made of spheres stays
  underneath as the fallback: an empty list draws it.

  The cost, measured on the desktop with the two alternating every 20 s in the same raid, seen
  from the same spot (3 Nov): 59.5 and 59.3 frames a second with the monster, 59.2 and 57.7
  with the toy, against a 60 cap that would hide a small difference. 5,800 to 6,100 triangles,
  one skin of 43 joints, five or six plain materials and no texture per monster; only one is
  drawn at a time. Not measured on a phone.

  The pointer sphere stays the target for both: a skinned mesh cannot be a collider (protocol),
  and the shots already resolve against the server's disc, not against the drawn body.
*/
const MONSTERS = ['assets/Models/boss-bluedemon.glb', 'assets/Models/boss-mushroomking.glb', 'assets/Models/boss-yeti.glb']
/**
 * About 3.5 m tall, twice a player. At 4 m it towered from the plaza, but the boss holds 2.8 m
 * from its prey, and the weapon's first person view saw nothing but its belly (capture, 3 Nov).
 */
const MODEL_SCALE = 1.4
const MODEL_YAW = 180
/** The clips used, with their loop flag; every clip of the rig is listed in `Animator.states` or it autoplays. */
const CLIPS: Array<[string, boolean]> = [
  ['Idle', true], ['Walk', true], ['Run', true], ['Run2', true], ['Jump', false], ['Jump_Idle', true], ['Jump_Land', false],
  ['HitReact', false], ['Death', false], ['Wave', false], ['Punch', false], ['Weapon', false], ['Duck', false], ['Yes', false], ['No', false]
]
const clip = (name: string): string => `CharacterArmature|${name}`
/** Clip lengths read from the files (`Jump`, `Jump_Land` 0.33 s, `HitReact` 0.58 s, `Death` 0.75 s). */
const JUMP_MS = 330
const HIT_REACT_MS = 580
/** A hit replays the flinch at most this often, or a stream of shots would freeze it in one. */
const HIT_REACT_EVERY_MS = 2_000
const DEATH_MODEL_MS = 800
/** Over the toy's ball, or over the monster's head (about 1.9 m above its middle at MODEL_SCALE). */
const LABELS_TOY = { title: 2.6, gauge: 2.2, line: 1.85 }
const LABELS_MONSTER = { title: 3.1, gauge: 2.7, line: 2.35 }

function disc(color: Color4, glow: number): Parameters<typeof Material.setPbrMaterial>[1] {
  return {
    albedoColor: color,
    emissiveColor: Color3.create(color.r, color.g, color.b),
    emissiveIntensity: glow,
    transparencyMode: 2,
    roughness: 1
  }
}

export function setupRaid(): void {
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.create(0, -50, 0), scale: Vector3.Zero() })

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
  const beacon = engine.addEntity()
  Transform.create(beacon, { position: Vector3.create(0, -50, 0), scale: Vector3.Zero() })
  MeshRenderer.setCylinder(beacon, 0.55, 0.55)
  Material.setPbrMaterial(beacon, {
    albedoColor: Color4.fromHexString('#ff6b6b66'),
    emissiveColor: Color3.fromHexString('#ff6b6b'),
    emissiveIntensity: 2.2,
    alphaTest: 0,
    transparencyMode: 2,
    roughness: 1
  })

  // The target, never drawn: the same sphere for the toy and the monster.
  const body = engine.addEntity()
  Transform.create(body, { parent: root, scale: Vector3.create(2.6, 2.6, 2.6) })
  // Pointer only: a physics sphere walking a circle through the crowd shoved avatars around.
  MeshCollider.setSphere(body, ColliderLayer.CL_POINTER)
  PointerEvents.create(body, {
    pointerEvents: [
      { eventType: PointerEventType.PET_DOWN, eventInfo: { showFeedback: false, button: InputAction.IA_POINTER, hoverText: 'RAID BOSS  ·  draw (F) and fire (E)' } }
    ]
  })

  // The toy: a ball with horns and eyes, drawn when no monster is.
  const toy = engine.addEntity()
  Transform.create(toy, { parent: root })
  const ball = engine.addEntity()
  Transform.create(ball, { parent: toy, scale: Vector3.create(2.6, 2.6, 2.6) })
  MeshRenderer.setSphere(ball)
  Material.setPbrMaterial(ball, plastic(SKIN, 0.35))
  const eyes: Entity[] = []
  for (const side of [-1, 1]) {
    const horn = engine.addEntity()
    Transform.create(horn, { parent: toy, position: Vector3.create(side * 0.9, 1.25, 0), scale: Vector3.create(0.5, 1.1, 0.5) })
    MeshRenderer.setCylinder(horn, 0.5, 0)
    Material.setPbrMaterial(horn, plastic(HORN))
    const eye = engine.addEntity()
    Transform.create(eye, { parent: toy, position: Vector3.create(side * 0.5, 0.35, -1.15), scale: Vector3.create(0.36, 0.36, 0.2) })
    MeshRenderer.setSphere(eye)
    Material.setPbrMaterial(eye, plastic(EYE, 2.5))
    eyes.push(eye)
  }

  // The toy's halo is an opaque emissive ring at the waist, not a translucent sphere: no alpha.
  const halo = engine.addEntity()
  Transform.create(halo, { parent: toy, scale: Vector3.create(3.4, 0.14, 3.4) })
  MeshRenderer.setCylinder(halo, 0.5, 0.5)
  Material.setPbrMaterial(halo, plastic('#ff4d5e', 3))

  const shadow = engine.addEntity()
  Transform.create(shadow, { parent: root, position: Vector3.create(0, -HEIGHT + 0.03, 0), scale: Vector3.create(3.2, 0.02, 3.2) })
  MeshRenderer.setCylinder(shadow, 0.5, 0.5)
  Material.setPbrMaterial(shadow, plasticDe(Color4.create(0, 0, 0, 0.35)))

  const title = engine.addEntity()
  Transform.create(title, { parent: root, position: Vector3.create(0, 2.6, 0), scale: Vector3.create(0.5, 0.5, 0.5) })
  Billboard.create(title, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(title, { text: 'RAID BOSS', fontSize: 5, textColor: Color4.fromHexString('#ff6b6bff'), ...LISIBLE_3D })
  /*
    The life bar is a BAR: a dark track and a red fill that shortens, over the head, turned
    to face whoever looks. It was a line of hash marks in a text shape, which reads as a
    console and not as a wound (owner, 3 Sep). Two boxes, opaque, on the budget only while
    a raid runs. The text below it keeps the one thing a bar cannot say: who leads.
  */
  const gauge = engine.addEntity()
  Transform.create(gauge, { parent: root, position: Vector3.create(0, 2.2, 0) })
  Billboard.create(gauge, { billboardMode: BillboardMode.BM_Y })
  const track = engine.addEntity()
  Transform.create(track, { parent: gauge, scale: Vector3.create(BAR_W, 0.24, 0.05) })
  MeshRenderer.setBox(track)
  Material.setPbrMaterial(track, plasticDe(Color4.create(0.05, 0.08, 0.16, 1)))
  const life = engine.addEntity()
  Transform.create(life, { parent: gauge, position: Vector3.create(0, 0, -0.04), scale: Vector3.create(BAR_W, 0.18, 0.05) })
  MeshRenderer.setBox(life)
  Material.setPbrMaterial(life, plastic('#ff4d5e', 1.8))
  const barLabel = engine.addEntity()
  Transform.create(barLabel, { parent: root, position: Vector3.create(0, 1.85, 0), scale: Vector3.create(0.5, 0.5, 0.5) })
  Billboard.create(barLabel, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(barLabel, { text: '', fontSize: 2.6, textColor: Color4.White(), ...LISIBLE_3D })

  /*
    The slam's warning on the floor: the disc it will land on, and a second disc filling it from
    the centre, so the edge is where to be and the fill says how long is left. On the world, not
    on the boss, which bobs, rears and swells: the disc stays flat where the server will hit.
  */
  const zone = engine.addEntity()
  Transform.create(zone, { position: Vector3.create(0, -50, 0), scale: Vector3.Zero() })
  MeshRenderer.setCylinder(zone, 0.5, 0.5)
  Material.setPbrMaterial(zone, disc(Color4.create(1, 0.23, 0.27, 0.28), 0.4))
  const fill = engine.addEntity()
  Transform.create(fill, { position: Vector3.create(0, -50, 0), scale: Vector3.Zero() })
  MeshRenderer.setCylinder(fill, 0.5, 0.5)
  const fillLook = (rage: boolean): Parameters<typeof Material.setPbrMaterial>[1] =>
    disc(rage ? Color4.create(1, 0.42, 0.1, 0.55) : Color4.create(1, 0.12, 0.16, 0.5), 0.9)
  Material.setPbrMaterial(fill, fillLook(false))

  const monsters = MONSTERS.map((src) => {
    const e = engine.addEntity()
    Transform.create(e, { parent: root, position: Vector3.create(0, -HEIGHT, 0), rotation: Quaternion.fromEulerDegrees(0, MODEL_YAW, 0), scale: Vector3.Zero() })
    GltfContainer.create(e, { src, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
    Animator.create(e, { states: CLIPS.map(([name, loop]) => ({ clip: clip(name), playing: name === 'Idle', loop })) })
    return e
  })
  /** This raid's monster, the one drawn now (null while the toy is), and its clip. */
  let monster: Entity | null = null
  let shown: Entity | null | undefined = undefined
  let clipNow = ''
  let hitReactAt = -1e9
  const play = (name: string): void => {
    if (shown === null || shown === undefined || name === clipNow) return
    clipNow = name
    Animator.playSingleAnimation(shown, clip(name), true)
    // A clip the boss stop froze plays at its own pace again the next time it is chosen.
    const st = Animator.getMutable(shown).states.find((s) => s.clip === clip(name))
    if (st !== undefined && st.speed === 0) st.speed = 1
  }
  /** Holds the monster in the pose it has, for the boss stop. */
  const freeze = (): void => {
    if (shown === null || shown === undefined || clipNow === '') return
    const st = Animator.getMutable(shown).states.find((s) => s.clip === clip(clipNow))
    if (st !== undefined) st.speed = 0
  }
  let lastHitFlash = -1e9
  /** A flash on the boss's side facing this player's camera, so its own body never hides it. */
  const flashOnBoss = (size: number): void => {
    const cam = Transform.getOrNull(engine.CameraEntity)
    let dx = 0, dz = 1
    if (cam !== null) {
      const l = Math.hypot(cam.position.x - drawn.x, cam.position.z - drawn.z)
      if (l > 0.01) { dx = (cam.position.x - drawn.x) / l; dz = (cam.position.z - drawn.z) / l }
    }
    puff(Vector3.create(drawn.x + dx * 1.4, HEIGHT + 0.5, drawn.z + dz * 1.4), '#ffffff', size)
  }

  const bell = engine.addEntity()
  Transform.create(bell, { parent: engine.PlayerEntity, position: Vector3.create(0, 1, 0) })
  // The bell, shared with the rush: an event's voice, not the common crate's (ledger, 5 Sep).
  AudioSource.create(bell, { audioClipUrl: 'assets/sounds/bell.wav', playing: false, loop: false, volume: 0.85 })
  // The slam is heard from the boss, so only the players near it hear it loud.
  const slamVoice = engine.addEntity()
  Transform.create(slamVoice, { parent: root })
  AudioSource.create(slamVoice, { audioClipUrl: 'assets/sounds/slam.wav', playing: false, loop: false, volume: volumeInitial(0.9, slamVoice) })
  /*
    The wind-up is heard as well as seen: a growl rising to the impact, so a player can dodge
    without looking at the floor, and sound is the cheapest layer of feedback there is (Jonasson
    and Purho, "Juice it or lose it"). The clip is 0.65 s at pitch 1 and plays at 0.65 / wind-up
    seconds (`tools/sounds/build-raid.py`), so it always ends on the slam: deeper when calm,
    higher and quicker in rage.
  */
  const windVoice = engine.addEntity()
  Transform.create(windVoice, { parent: root })
  AudioSource.create(windVoice, { audioClipUrl: 'assets/sounds/windup.wav', playing: false, loop: false, volume: volumeInitial(0.8, windVoice) })

  /*
    The slam's shock wave: a ring that leaves the boss's feet and stops on the edge of the disc
    it announced. It used to be the waist halo swelling to eight metres and shrinking back, a
    wave run backwards; a shock wave travels out from its source and dies at its reach, which
    is also what confirms the zone that was hit. Flat on the floor, on the world rather than on
    the boss, which squashes as it lands.
  */
  const wave = engine.addEntity()
  Transform.create(wave, { position: Vector3.create(0, -50, 0), rotation: Quaternion.fromEulerDegrees(90, 0, 0), scale: Vector3.Zero() })
  MeshRenderer.setPlane(wave)
  const RING = Material.Texture.Common({ src: 'assets/textures/fx-ring.png' })
  const waveLook = (rage: boolean): Parameters<typeof Material.setPbrMaterial>[1] => {
    const c = Color4.fromHexString(rage ? '#ff8a2dff' : '#ff5a5aff')
    return {
      texture: RING, emissiveTexture: RING, albedoColor: c, emissiveColor: Color3.create(c.r, c.g, c.b),
      emissiveIntensity: 2.2, transparencyMode: 2, metallic: 0, roughness: 1, specularIntensity: 0, castShadows: false
    }
  }
  Material.setPbrMaterial(wave, waveLook(false))
  let waveRage = false
  let waveAt = { x: 0, z: 0 }

  let windLocal = 0
  let windMs = 1000
  let windAt = { x: 0, z: 0 }
  let fillRage = false
  let hintShown = false
  room.onMessage('raidWindup', (d) => {
    windLocal = Date.now()
    windMs = Math.max(100, d.ms)
    windAt = { x: d.x, z: d.z }
    const voice = AudioSource.getMutableOrNull(windVoice)
    if (voice !== null) voice.pitch = 0.65 / (windMs / 1000)
    replay(windVoice)
    // Enraged, the fill burns orange: the same disc, coming quicker.
    if (d.rage !== fillRage) { fillRage = d.rage; Material.setPbrMaterial(fill, fillLook(d.rage)) }
    // Said once a session, to whoever stands in it: the disc is the rule, the words teach it.
    if (!hintShown && Transform.has(engine.PlayerEntity)) {
      const me = Transform.get(engine.PlayerEntity).position
      if (Math.hypot(me.x - d.x, me.z - d.z) < RAID_SWIPE_RANGE + 2) {
        hintShown = true
        alerter('GET OUT OF THE RED  ·  the slam is coming', '#ff6b6b', TOAST.warning, false)
      }
    }
  })
  room.onMessage('raidSwipe', (d) => {
    flashDamage()
    floatAmount(d.lost, true)
    playHurt()
    /*
      No toast, exactly as for a shot taken.

      These three lines ARE the three channels `combat.ts` kept on 6 Sep for `wasShot`: the red
      flash says it happened, the red number says what it cost, the sound says it hurts. The
      plate that followed was a fourth copy, dropped in the middle of the fight, saying in words
      what the coins falling to the floor already show (owner, 8 Sep: "ce qui se passe à
      l'écran est assez signifiant"). Same situation as the shot, same rule: the world answers,
      the interface stays quiet.
    */
  })
  room.onMessage('raidWon', (d) => {
    alerter(`BOSS DOWN  ·  ${crate(d.crate).name} is yours`, '#ffd166', TOAST.event)
  })
  room.onMessage('raidOver', (d) => {
    pushToFeed(d.slain ? `${d.winner} slew the boss` : 'the boss left')
  })

  let wasActive = false
  let drawn = { x: 0, z: 0 }
  /** One server tick of the boss mover (server/raid.ts, `acc`): the glide spans exactly one. */
  const SERVER_TICK_MS = 500
  /** The last server position taken as a target, the rendered spot the glide left from, and when. */
  let glideTo = { x: 0, z: 0 }, glideFrom = { x: 0, z: 0 }, glideAt = 0
  let barText = ''
  let lastShare = -1
  let flashOn = false
  let raging = false
  let arriveLocal = 0
  let landed = true
  let impactLocal = -1e9
  /** How a raid that just ended is leaving the screen, from when. */
  let exit: 'none' | 'fall' | 'leave' = 'none'
  let exitLocal = 0
  let burst = false
  let zoneShown = false

  const skin = (): Parameters<typeof Material.setPbrMaterial>[1] => raging ? plastic(SKIN_RAGE, 0.6) : plastic(SKIN, 0.35)
  const hideZone = (): void => {
    windLocal = 0
    if (!zoneShown) return
    zoneShown = false
    for (const e of [zone, fill]) {
      const t = Transform.getMutableOrNull(e)
      if (t !== null) { t.position = Vector3.create(0, -50, 0); t.scale = Vector3.Zero() }
    }
  }
  const setRage = (on: boolean): void => {
    if (on === raging) return
    raging = on
    if (!flashOn) Material.setPbrMaterial(ball, skin())
    for (const e of eyes) Material.setPbrMaterial(e, plastic(on ? EYE_RAGE : EYE, on ? 4 : 2.5))
    Material.setPbrMaterial(halo, plastic(on ? '#ff8a2d' : '#ff4d5e', 3))
    if (on) {
      startBossRage(root)
      alerter('BOSS ENRAGED  ·  faster, and it slams sooner', '#ff8a2d', TOAST.warning, false)
    } else stopBossRage()
  }
  /*
    Two clocks, never subtracted from each other.

    The flash and the swipe read `now - r.hitAtMs`, with `now` the CLIENT's clock and the
    stamp the SERVER's. The two are never in step: a client a fifth of a second ahead sees
    every window already expired and nothing ever flashes, one behind sees a window that
    never closes and the boss stays white (owner, 5 Sep: "le boss ne clignote plus"). So the
    client watches the stamp CHANGE and starts its own window from its own clock.
  */
  let seenHit = 0
  let hitLocal = -1e9
  let seenSwipe = 0
  let swipeLocal = -1e9
  engine.addSystem(() => {
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

    const t = Transform.getMutableOrNull(root)
    if (t === null) return
    if (!r.active) {
      if (wasActive) {
        /*
          The end is a moment too. It used to vanish between two frames, felled or not, so the
          kill the whole plaza had worked for showed nothing but coins appearing. Felled (no
          life left, `server/raid.ts` closeRaid): it swells white and bursts into stars. Left
          with life to spare: it sinks into the floor in a dark cloud.
        */
        wasActive = false
        hideZone()
        setRage(false)
        const wt = Transform.getMutableOrNull(wave)
        if (wt !== null) { wt.scale = Vector3.Zero(); wt.position = Vector3.create(0, -50, 0) }
        const pe = Transform.getMutableOrNull(beacon)
        if (pe !== null) pe.scale = Vector3.Zero()
        raidView.distance = 0
        exit = r.hp <= 0 ? 'fall' : 'leave'
        exitLocal = now
        burst = false
        /*
          Felled: the boss stop first (Sakurai's name for it): it freezes in the pose it was hit
          in, on a white flash, for a fifth of a second, and only then falls. The kill is the
          biggest moment of a session, and a stop is how a game says so; the reward rain follows
          as a beat of its own. The monster then plays its death, the toy swells white.
        */
        if (exit === 'fall') {
          flashOnBoss(4)
          if (shown) freeze()
          else { flashOn = true; Material.setPbrMaterial(ball, plastic('#ffffff', 4)) }
        } else {
          if (shown) play('Wave')
          bossLeaveBurst(drawn.x, drawn.z)
        }
      }
      if (exit === 'fall') {
        if (shown && now - exitLocal >= STOP_MS) play('Death')
        const k = (now - exitLocal) / (shown ? STOP_MS + DEATH_MODEL_MS : DEATH_SWELL_MS)
        if (k < 1) {
          const s = shown ? 1 : 1 + 0.4 * k
          t.scale = Vector3.create(s, s, s)
          return
        }
        if (!burst) {
          burst = true
          bossDeathBurst(drawn.x, HEIGHT, drawn.z)
          replay(slamVoice)
        }
        exit = 'none'
      } else if (exit === 'leave') {
        const k = (now - exitLocal) / LEAVE_MS
        if (k < 1) {
          t.position = Vector3.create(drawn.x, HEIGHT - (HEIGHT + 1.8) * k * k, drawn.z)
          return
        }
        exit = 'none'
      }
      if (t.scale.x !== 0) t.scale = Vector3.Zero()
      if (flashOn) { flashOn = false; Material.setPbrMaterial(ball, skin()) }
      return
    }
    if (!wasActive) {
      wasActive = true
      exit = 'none'
      drawn = { x: r.x, z: r.z }
      glideTo = { x: r.x, z: r.z }; glideFrom = { x: r.x, z: r.z }; glideAt = now
      arriveLocal = now
      landed = false
      monster = monsters.length > 0 ? monsters[Math.floor(r.untilMs / 1000) % monsters.length] : null
      shown = undefined
      // Already past the slam the server last made, so an old stamp is not taken for a new slam.
      seenSwipe = r.swipeAtMs
      /*
        The crate has not been the Legendary since 2 Sep, and this line still promised it.

        `crateDuButin` gives one step above the winner's best piece: a Good to someone holding
        only Commons, a Mythic to someone holding Legendaries. Announcing "A LEGENDARY" to the
        whole plaza was false for nearly everyone, and false in public. What is announced is what
        is true at every step; the exact crate is found out by winning.
      */
      alerter('BOSS UP  ·  top damage takes a crate', '#ff6b6b', TOAST.event, false)
      replay(bell)
    }
    /*
      A straight glide from where it stands to the last position the server wrote, over
      exactly one server tick.

      The server moves the boss every 0.5 s, so a client gets a new target twice a second:
      0.55 m apart on a stroll, 1.5 m in a chase. The glide used to be an exponential pull at
      6/s, which covered most of each step in 0.3 s and then stood still until the next one,
      a walk stuttering at 2 Hz, hidden by the pace of a chase and plain on the stroll (owner,
      11 Sep). A line from the rendered spot to the new target over SERVER_TICK_MS renders one
      tick late, at the server's own speed, and never jumps: a late or early packet only bends
      the speed, since every segment starts from where the boss is drawn.
    */
    if (r.x !== glideTo.x || r.z !== glideTo.z) {
      glideFrom = { x: drawn.x, z: drawn.z }; glideTo = { x: r.x, z: r.z }; glideAt = now
    }
    const k = Math.min(1, (now - glideAt) / SERVER_TICK_MS)
    drawn = { x: glideFrom.x + (glideTo.x - glideFrom.x) * k, z: glideFrom.z + (glideTo.z - glideFrom.z) * k }

    // It falls from the sky when it appears, and the landing throws the slam's dust.
    const ka = Math.min(1, (now - arriveLocal) / ARRIVE_MS)
    const drop = ARRIVE_H * (1 - ka * ka)
    if (!landed && ka >= 1) {
      landed = true
      impactLocal = now
      bossLandBurst(drawn.x, drawn.z)
      replay(slamVoice)
    }

    setRage(r.hp > 0 && r.hp <= r.hpMax * RAID_RAGE_AT)

    // The slam lands: the server stamps it, and the dust, the thud and the squash answer.
    if (r.swipeAtMs !== seenSwipe) {
      seenSwipe = r.swipeAtMs
      if (r.swipeAtMs > 0) {
        swipeLocal = now
        impactLocal = now
        waveAt = { x: drawn.x, z: drawn.z }
        if (raging !== waveRage) { waveRage = raging; Material.setPbrMaterial(wave, waveLook(raging)) }
        hideZone()
        bossSlamBurst(drawn.x, drawn.z, raging)
        replay(slamVoice)
      }
    }

    // The wind-up: it rears while the disc fills from its centre to the edge it will hit.
    const kw = windLocal > 0 ? (now - windLocal) / windMs : -1
    if (kw > 1 + WINDUP_GRACE_MS / windMs) hideZone()
    let rear = 0
    if (windLocal > 0 && kw >= 0) {
      const f = Math.min(1, kw)
      rear = REAR_H * (1 - (1 - f) * (1 - f))
      const zt = Transform.getMutableOrNull(zone)
      const ft = Transform.getMutableOrNull(fill)
      if (zt !== null && ft !== null) {
        const d = RAID_SWIPE_RANGE * 2
        zt.position = Vector3.create(windAt.x, 0.05, windAt.z)
        zt.scale = Vector3.create(d, 0.02, d)
        ft.position = Vector3.create(windAt.x, 0.07, windAt.z)
        const fd = Math.max(0.05, d * f)
        ft.scale = Vector3.create(fd, 0.02, fd)
        zoneShown = true
      }
    }

    // This raid's monster, or the toy when there is none.
    if (monster !== shown) {
      shown = monster
      clipNow = ''
      const tt = Transform.getMutableOrNull(toy)
      if (tt !== null) tt.scale = shown === null ? Vector3.One() : Vector3.Zero()
      const at = shown === null ? LABELS_TOY : LABELS_MONSTER
      for (const [e, y] of [[title, at.title], [gauge, at.gauge], [barLabel, at.line]] as Array<[Entity, number]>) {
        const lt = Transform.getMutableOrNull(e)
        if (lt !== null) lt.position = Vector3.create(0, y, 0)
      }
      for (const e of monsters) {
        const mt = Transform.getMutableOrNull(e)
        if (mt !== null) mt.scale = e === shown ? Vector3.create(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE) : Vector3.Zero()
      }
    }

    const bob = rear > 0 || shown !== null ? 0 : Math.sin(now / 350) * 0.12
    t.position = Vector3.create(drawn.x, HEIGHT + bob + rear + drop, drawn.z)
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
    if (r.hitAtMs !== seenHit) {
      seenHit = r.hitAtMs
      if (r.hitAtMs > 0) {
        hitLocal = now
        if (now - hitReactAt > HIT_REACT_EVERY_MS && rear === 0) hitReactAt = now
        /*
          The thing that is hit flashes white: the genre's hit signal (Nijman, "The art of
          screenshake"), and the toy has always had it. The monsters had none, because the flash
          swaps the toy ball's material and a monster hides the ball. A white burst on the side
          facing the camera stands in until a material override is safe on a skinned model.
        */
        if (shown !== null && now - lastHitFlash > HIT_FLASH_EVERY_MS) { lastHitFlash = now; flashOnBoss(1.6) }
      }
    }
    const hit = now - hitLocal < FLASH_MS
    const swell = hit ? 1.12 : 1
    // Squat as it rears, flattened for a moment when it lands.
    const ki = (now - impactLocal) / IMPACT_MS
    const squash = ki >= 0 && ki < 1 ? 0.22 * (1 - ki) : -0.08 * (rear / REAR_H)
    t.scale = Vector3.create(swell * (1 + squash), swell * (1 - squash), swell * (1 + squash))
    if (hit !== flashOn) {
      flashOn = hit
      Material.setPbrMaterial(ball, hit ? plastic('#ffffff', 4) : skin())
    }

    // The beam follows the same smoothed position, breathing so it reads as alive from afar. It
    // starts over the head: from the ground it ran through the monster's chest (capture, 3 Nov).
    const breath = 1 + Math.sin(now / 420) * 0.14
    const pe = Transform.getMutableOrNull(beacon)
    if (pe !== null) {
      pe.position = Vector3.create(drawn.x, 35, drawn.z)
      pe.scale = Vector3.create(breath, 60, breath)
    }
    if (Transform.has(engine.PlayerEntity)) {
      const me = Transform.get(engine.PlayerEntity).position
      raidView.distance = Math.round(Math.hypot(me.x - drawn.x, me.z - drawn.z))
    }

    // The shock wave runs out from the feet and stops on the disc's edge, easing out.
    const since = now - swipeLocal
    const wt = Transform.getMutableOrNull(wave)
    if (wt !== null) {
      if (since >= 0 && since < WAVE_MS) {
        const q = since / WAVE_MS
        const d = 1.5 + (RAID_SWIPE_RANGE * 2 - 1.5) * (1 - (1 - q) * (1 - q))
        wt.position = Vector3.create(waveAt.x, 0.1, waveAt.z)
        wt.scale = Vector3.create(d, d, 1)
      } else if (wt.scale.x !== 0) {
        wt.scale = Vector3.Zero()
        wt.position = Vector3.create(0, -50, 0)
      }
    }

    // The monster's clip for this moment, most urgent first; written only when it changes.
    if (shown !== null) {
      const sinceImpact = now - impactLocal
      const pace = k < 1 ? Math.hypot(glideTo.x - glideFrom.x, glideTo.z - glideFrom.z) / (SERVER_TICK_MS / 1000) : 0
      if (ka < 1) play('Jump_Idle')
      else if (sinceImpact >= 0 && sinceImpact < JUMP_MS) play('Jump_Land')
      else if (rear > 0) play(now - windLocal < JUMP_MS ? 'Jump' : 'Jump_Idle')
      else if (now - hitReactAt < HIT_REACT_MS) play('HitReact')
      else play(pace > 2 ? 'Run' : pace > 0.3 ? 'Walk' : 'Idle')
    }

    const share = Math.max(0, Math.min(1, r.hp / Math.max(1, r.hpMax)))
    if (Math.abs(share - lastShare) > 0.004) {
      lastShare = share
      const vt = Transform.getMutableOrNull(life)
      if (vt !== null) {
        // Anchored on the left: the fill shrinks toward the start of the track, as bars do.
        vt.scale = Vector3.create(Math.max(0.001, BAR_W * share), 0.18, 0.05)
        vt.position = Vector3.create(-(BAR_W * (1 - share)) / 2, 0, -0.04)
      }
    }
    const line = `${Math.round(share * 100)}%${raging ? '   ·   ENRAGED' : ''}${r.topName !== '' ? `   ·   top: ${r.topName}` : ''}`
    if (line !== barText) {
      barText = line
      const tb = TextShape.getMutableOrNull(barLabel)
      if (tb !== null) tb.text = line
    }
  })
}
