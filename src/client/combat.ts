import { plasticDe, spinLoop } from './toy'
import { engine, Transform, MeshRenderer, Material, TextShape, Billboard, BillboardMode, Entity, GltfContainer, InputAction, inputSystem, PointerEventType, AudioSource, Tween, EasingFunction, AvatarAttach, AvatarAnchorPointType, PlayerIdentityData, CameraMode, CameraType, CameraModeArea, AvatarMask, timers, MaterialTransparencyMode } from '@dcl/sdk/ecs'
import { triggerSceneEmote, stopEmote } from '~system/RestrictedActions'
import { getPlayer } from '@dcl/sdk/players'
import { isMobile } from '@dcl/sdk/platform'
import { Color4, Color3, Vector3, Quaternion } from '@dcl/sdk/math'
import { DroppedCoins, SHOT_RANGE, SHOT_COOLDOWN_MS, inShotCone, LOOT_OWNER_LOCK_MS, SLAP_RANGE, SLAP_COOLDOWN_MS, TASER_COOLDOWN_MS, RAID_HIT_RANGE } from '../shared/schemas'
import { gearView } from './gear'
import { raidView } from './raid'
import { room } from '../shared/messages'
import { formatIncome } from '../shared/loot-table'
import { alerter, theftView } from './theft'
import { cue } from './ui-kit'
import { noterBascule } from './clics'
import { mondeOuvert } from './monde'
import { avantDeplacement } from './deplacer'
import { flashDamage, floatAmount, playHurt } from './juice'
import { setAiming, setArmeIcone } from './locomotion'
import { TOAST } from './theme'
import { puff } from './impact'

/**
 * The pistol, client side.
 *
 * Two models, never both at once. The player picks first or third person in their own
 * client, so a weapon can only be right in one of the two places:
 *
 *   third person -> AvatarAttach on the right hand. The character holds it, and so does
 *                   every other player, since the same attachment is built for each
 *                   address in the scene.
 *   first person -> a view model parented to engine.CameraEntity, because from inside the
 *                   avatar there is no visible body to hang anything on.
 *
 * CameraMode on engine.CameraEntity says which one the player is in, and switches them.
 *
 * The hand anchor rides an animated bone, so it drifts with the walk cycle. That is fine
 * here and only here: the model is decoration. The shot itself is a direction, taken from
 * the camera and resolved by the server against positions the server reads itself. The
 * reticle uses the server's own cone constant, so a target it locks is a target that falls.
 *
 * The avatar's skeleton is only reachable through emotes, and the platform's fixed list
 * holds neither an aim nor a shot. So the scene ships its own two clips, solved against
 * the Decentraland reference rig: the arm raises into a two-handed aim and kicks on the
 * shot. The weapon is holstered until the player aims, which keeps a pistol out of every
 * screenshot of what is, most of the time, a game about running a base.
 */

export const combatView = {
  /** A nudge for a first-timer: on for the first seconds of the first two draws of a session. */
  aideVisee: false,
  aiming: false,
  /** Name of the player the shot would reach right now, empty when the cone is clear. */
  targetName: '',
  targetDist: 0,
  /** 0 when ready, 1 right after a shot. */
  cooldown: 0,
  firstPerson: false,
  /** Le depart et l'impact du dernier coup, pour le kick et le hit-marker du reticule. */
  lastShotAt: 0,
  lastHitAt: 0,
  /** What is in the hand: the HUD button wears this weapon's own picture. */
  arme: 'shoot' as 'shoot' | 'slap' | 'taser'
}

type ArmeType = 'shoot' | 'slap' | 'taser'
type Gun = { racine: Entity; poignee: Entity; parts: Entity[]; type: ArmeType }
const ARME_INT: Record<ArmeType, number> = { shoot: 0, slap: 1, taser: 2 }
const INT_ARME: ArmeType[] = ['shoot', 'slap', 'taser']

const OR = Color4.fromHexString('#ffd166ff')
/** The muzzle flash sprite: a spiky star, white core, orange fringe (tools/ui/build-flash.py). */
const FLASH_TEXTURE = 'assets/ui/flash.png'

const MODELE = 'assets/Models/gun.glb'
/**
 * The same pistol without its outline hull, for the first person view only.
 *
 * `gun.glb` carries a second shell two millimetres outside the body, normals turned in, which
 * is the toon outline: a drawn rim in third person, and at fifty centimetres from the camera
 * two surfaces fighting for the same pixels at every step, a rim that sparkled and read as
 * the gun flickering while running (owner, 5 Sep). `tools/model/build-gun-view.py` writes
 * the body alone from the same file.
 */
const MODELE_VUE = 'assets/Models/gun-view.glb'
/**
 * The two avatar clips, built against the Decentraland reference rig.
 *
 * AIM is a single held pose, looped, so the arms stay up for as long as the player holds
 * the control. FIRE is a one-shot muzzle rise off that same pose, so the two read as one
 * motion. Both are masked to the upper body: the legs stay on locomotion and the player
 * keeps running while aiming and while firing.
 */
const CLIP_VISEE = 'assets/animations/aim_emote.glb'
const CLIP_TIR = 'assets/animations/fire_emote.glb'
/** The kick on a loop whose cycle is the shot cooldown: one emote per burst, not one per round. */
const CLIP_RAFALE = 'assets/animations/burst_emote.glb'
/** A burst ends this long after its last round; the arm goes back to the held aim then. */
const RAFALE_FIN_MS = 420
/**
 * The model's own pivot is 87 cm away from the weapon: measured, its bounds run
 * y 0.563..0.778 and z 0.390..0.700, muzzle at +Z, wooden grip at low Y and low Z.
 * PIVOT brings the grip onto the holder's origin, so every placement below is
 * expressed as "where the hand is", not as an arbitrary correction.
 *
 * The slide is SKEWED in the mesh: the rear sight sits at x +0.0008 (z 0.501) and the
 * front sight at x -0.0154 (z 0.684), a sight line yawed 5.06 degrees; and the client
 * mirrors X on import, so in hand the gun pointed five degrees RIGHT of the reticle and
 * the bolt visibly left it sideways (owner, 4 Sep). The model is turned back by that
 * angle about the grip. PIVOT and BOUCHE are the measured grip and bore centre (muzzle
 * ring centre x -0.0088, y 0.7284, z 0.6996, mirrored) under that turn. The old BOUCHE
 * sat at the top of the bounds, five centimetres ABOVE the bore: the flash and the bolt
 * left the sights, not the barrel.
 */
const MODEL_YAW_DEG = -5.06
const MODEL_ROT = Quaternion.fromEulerDegrees(0, MODEL_YAW_DEG, 0)
const PIVOT = Vector3.create(0.0297, -0.640, -0.4491)
/** Bore centre at the muzzle, relative to the grip, under the same turn. */
const BOUCHE = Vector3.create(-0.0232, 0.0884, 0.2485)

/**
 * Where the grip sits on the hand bone.
 *
 * Not guessed: the aim pose was solved first, then the right hand's world orientation was
 * read out of it, and this rotation is its inverse. That makes the barrel point along the
 * character's forward axis exactly when the arm is extended, which is the only pose the
 * weapon is ever visible in. The hand bone runs along its own +Y, toward the fingers, so
 * the grip sits a few centimetres up that axis.
 */
const MAIN_POS = Vector3.create(0.045, 0.015, 0)
const MAIN_ROT = Quaternion.fromEulerDegrees(-90, 0, 180)
/** Where the view model sits relative to the camera: right, below, ahead. */
const VIEW_POS = Vector3.create(0.13, -0.20, 0.52)
const VIEW_ROT = Quaternion.fromEulerDegrees(0, 0, 0)
/** The same, pulled to centre and closer when aiming down the barrel. */
const VISEE_POS = Vector3.create(0.05, -0.16, 0.58)
/** Beyond this many other players, distant ones go unarmed: one renderer per mesh adds up. */
const ARMES_MAX = 10
/** Muzzle rise on the shot, in degrees, decayed back to rest. */
const RECUL_DEG = 20
/** How far a melee weapon swings forward on the tap, in degrees. */
const SWING_DEG = 55
/** Length of the shot clip, in milliseconds. Matches tools/emotes/build-emotes.js. */
/** Shortest gap between two arm animations, whatever the weapon's own rate. */

/**
 * Whether the avatar is posed at all.
 *
 * Both clips are masked to the upper body so the legs stay on locomotion, and the mobile
 * client lists upper-body masks among the features it does not support. Unmasked, the clip
 * takes the whole body and any step cancels it, so a held aim would flicker on and off with
 * every movement. The pose is therefore skipped there rather than played badly: the weapon
 * still appears in the hand, the reticle still locks, and the weapon still kicks, because
 * none of those go through an emote.
 */
function placeAvailable(): boolean { return !isMobile() }
/**
 * The first-person volume that rides the player while the weapon is out. A camera area is
 * a region and not a per-player flag, so it stays barely wider than one body: anyone
 * standing closer than sixty centimetres would be pulled into it as well.
 */
/*
  Wide enough to run in. At 1.2 m across, a sprinting player left the box within a frame of
  transform lag and the camera flipped between first and third person until they stopped
  (mobile tester, 3 Sep). 2.2 m still only catches a neighbour standing inside arm's reach.
*/
/*
  Eight metres a side, from two point two.

  The area is a trigger volume the client tests against the avatar's own collider: read in
  both clients on 6 Sep (`CameraModeAreaHandlerSystem.cs` on desktop, `camera_mode_area_
  detector.gd` on the phone), the mode is applied on ENTER and released on EXIT, nothing
  else. A box barely wider than the avatar, parented to a player running at eight metres a
  second, sits one frame behind the body on the clients that move the avatar in physics and
  the scene graph in another step: the body clips the wall of the box, exits, re-enters, and
  the camera flips with it. That is the "camera qui clignote quand on court en visee" of
  every playtest since August. A box the avatar cannot leave in one frame ends it. Nobody
  else is affected: the desktop only tests the main player, the phone only its own detector.
*/
const ZONE_VISEE = Vector3.create(8, 8, 8)
/** Where the area waits while the weapon is away: far under the map, relative to the player. */
const ZONE_RANGEE = Vector3.create(0, -300, 0)
const ZONE_EN_JOUE = Vector3.create(0, 1, 0)
/** How long the explorer takes to slide from one camera mode to the other. */
const TRANSITION_MS = 350

const armes = new Map<string, Gun>()
let vue: Gun | null = null
let flash = 0 as unknown as Entity
let moi = ''
let dernierTir = 0
let flashScale = 0
/** This shot's peak: the star is never the same size twice. */
let flashPeak = 0
/**
  The muzzle flash: the star's width in metres at its peak, and how long it takes to
  shrink away. Big on the frame of the shot, half on the next, gone on the third: the
  way a real flash reads, and enough to hide the seam where the streak leaves the barrel
  while the gun is already kicking.
*/
const FLASH_PEAK = 0.30
const FLASH_LIFE_S = 0.07
let zoneVisee: Entity | null = null
let viewVisibleAfter = 0
let dernierClipTir = 0
let degainages = 0
let armeAffichee: ArmeType = 'shoot'
let enRafale = false
let rafaleJusqua = 0
let dernierRecensement = 0
let targetName = ''
let cbtTargetAddr = ''
let recul = 0
let hitmark = 0 as unknown as Entity
let emetteurDraw: Entity | null = null
let emetteurRange: Entity | null = null

/** The holster: the rub rising when the weapon comes out, falling when it goes back. */
function jouerDraw(sortie: boolean): void {
  const e = sortie ? emetteurDraw : emetteurRange
  if (e === null) return
  const a = AudioSource.getMutableOrNull(e)
  if (a !== null) { a.playing = false; a.playing = true }
}
/** Addresses whose weapon is drawn right now, as relayed by the server. */
const enJoue = new Set<string>()
const armeDe = new Map<string, ArmeType>()

const piles = new Map<number, { chute: Entity; body: Entity; label: Entity }>()

/**
 * A holder whose origin is the grip, and the model hung off it by its measured pivot.
 * The weapon carries no collider at all: it rides a moving avatar, and a collider there
 * would push the third-person camera around and swallow pointer clicks.
 */
/*
  Three held models from primitives, plus the gun's own GLB. Small parts hung on the grip:
  the gun stays the authored model; a slap is a flat paddle on a handle; a taser is a rod with
  two prongs and a lit tip. The player sees which weapon they hold, which is the whole point
  of a gear that "replaces the gun" (tester, 28 Aug: "I still see a gun").
*/
function weaponItem(poignee: Entity, pos: Vector3, scale: Vector3, hex: string, glow = 0, cyl = false): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent: poignee, position: pos, scale })
  if (cyl) MeshRenderer.setCylinder(e, 0.5, 0.5); else MeshRenderer.setBox(e)
  Material.setPbrMaterial(e, plasticDe(Color4.fromHexString(hex + 'ff'), glow))
  return e
}
function modeleArme(poignee: Entity, type: ArmeType, contour = true): Entity[] {
  const V = Vector3.create
  if (type === 'slap') {
    return [
      weaponItem(poignee, V(0, -0.10, 0), V(0.04, 0.24, 0.04), '#7a4a2a'),                 // handle
      weaponItem(poignee, V(0, 0.10, 0), V(0.26, 0.20, 0.03), '#f2e9d8'),                  // paddle
      weaponItem(poignee, V(0, 0.10, 0), V(0.30, 0.04, 0.035), '#e63946')                 // red rim
    ]
  }
  if (type === 'taser') {
    return [
      weaponItem(poignee, V(0, -0.10, 0), V(0.04, 0.24, 0.04), '#2b2d42'),                 // handle
      weaponItem(poignee, V(0, 0.06, 0), V(0.05, 0.12, 0.05), '#4dabf7'),                  // body
      weaponItem(poignee, V(-0.03, 0.20, 0), V(0.015, 0.10, 0.015), '#c9d6ff'),            // prong L
      weaponItem(poignee, V(0.03, 0.20, 0), V(0.015, 0.10, 0.015), '#c9d6ff'),             // prong R
      weaponItem(poignee, V(0, 0.27, 0), V(0.05, 0.05, 0.05), '#7cf0ff', 3, true)          // lit tip
    ]
  }
  const modele = engine.addEntity()
  Transform.create(modele, { parent: poignee, position: PIVOT, rotation: MODEL_ROT })
  GltfContainer.create(modele, { src: contour ? MODELE : MODELE_VUE, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  return [modele]
}
function construireArme(parent: Entity, pos: Vector3, rot: Quaternion, type: ArmeType = 'shoot', contour = true): Gun {
  const poignee = engine.addEntity()
  Transform.create(poignee, { parent, position: pos, rotation: rot })
  return { racine: parent, poignee, parts: modeleArme(poignee, type, contour), type }
}
/** Swap the held model to another weapon, keeping the grip and the flash in place. */
function equiperArme(g: Gun | null, type: ArmeType): void {
  if (g === null || g.type === type) return
  for (const e of g.parts) engine.removeEntity(e)
  g.parts = modeleArme(g.poignee, type, g !== vue)
  g.type = type
  // The sound follows the weapon: a paddle thwacks, a taser crackles, only a gun reports.
  const s = AudioSource.getMutableOrNull(g.racine)
  if (s !== null) s.audioClipUrl = SON_ARME[type]
}

/** What each weapon sounds like on the tap. */
const SON_ARME: Record<ArmeType, string> = {
  shoot: 'assets/sounds/shot.wav',
  slap: 'assets/sounds/slap.wav',
  taser: 'assets/sounds/taser.wav'
}

/** Reads before it writes, so calling it every frame costs nothing when nothing changed. */
function montrer(g: Gun | null, on: boolean): void {
  if (g === null) return
  const t = Transform.getOrNull(g.poignee)
  if (t === null) return
  const v = on ? 1 : 0
  if (t.scale.x === v) return
  Transform.getMutable(g.poignee).scale = Vector3.create(v, v, v)
}

/**
 * Who has a weapon out, and which of the two local models carries it.
 *
 * One rule for everyone: the weapon is drawn only while its owner is aiming. Their aim
 * state comes from the server relay, so a bystander sees exactly what the shooter sees.
 * The local player is the one special case, because first person and third person need
 * two different models and only one of them may be on screen at a time.
 */
/*
  Which of the two guns the player sees depends on the DRAW, never on the camera report.

  It depended on `combatView.firstPerson`, which is the client's own `CameraMode` component
  as the scene last heard it. When that report lagged or never came, the scene believed it
  was still in third person while the client was already in first: it hid the view model and
  showed the HAND gun, an item attached to the right hand of a body the first-person camera
  does not draw. What is left on screen is a pistol off to the right, turned with the arm,
  floating: the "pistolet bloque en position laterale, rotate bizarrement" reported since
  August and photographed on 6 Sep. Drawing forces first person by construction, so while the
  weapon is out the player sees the view model and never their own hand gun. Other players
  still see this player's hand gun, which is what `a !== moi` keeps.
*/
function rafraichirVisibilite(): void {
  for (const [a, g] of armes) {
    const arme = enJoue.has(a)
    montrer(g, a === moi ? false : arme)
  }
  // The camera slides into first person over `TRANSITION_MS` from the draw; a view model
  // shown before the slide ends is drawn at third-person distance and fills the screen.
  montrer(vue, combatView.aiming && Date.now() >= viewVisibleAfter)

  const porteur = combatView.aiming ? vue : (armes.get(moi) ?? null)
  if (porteur !== null) {
    const t = Transform.getOrNull(flash)
    if (t !== null && t.parent !== porteur.poignee) {
      const ft = Transform.getMutableOrNull(flash)
      if (ft !== null) ft.parent = porteur.poignee
    }
  }
}

export function setupCombat(): void {




  // View model: one entity parented to the camera, shown only in first person.
  const ancre = engine.addEntity()
  Transform.create(ancre, { parent: engine.CameraEntity, position: VIEW_POS, rotation: VIEW_ROT })
  vue = construireArme(ancre, Vector3.Zero(), Quaternion.Identity(), 'shoot', false)
  montrer(vue, false)

  /*
    The flash was a plain emissive sphere, then a smaller one; a ball is not what a gun
    draws (owner, 4 Sep: "small and discreet is not juicy"). What every mobile shooter
    draws instead, particles or not: a spiky star sprite at the barrel's mouth, one or
    two frames, a different roll and size each shot. Two quads facing the shooter, the
    second smaller and turned, so the star has body; the holder carries the roll.
  */
  flash = engine.addEntity()
  Transform.create(flash, { parent: vue.poignee, position: BOUCHE, scale: Vector3.Zero() })
  const petales: Array<[number, number, number]> = [[0, 1, 3.6], [45, 0.62, 2.6]]
  petales.forEach(([roll, size, glow], i) => {
    const q = engine.addEntity()
    Transform.create(q, {
      parent: flash,
      position: Vector3.create(0, 0, 0.015 * i),
      rotation: Quaternion.fromEulerDegrees(0, 0, roll),
      scale: Vector3.create(size, size, 1)
    })
    MeshRenderer.setPlane(q)
    Material.setPbrMaterial(q, {
      texture: Material.Texture.Common({ src: FLASH_TEXTURE }),
      emissiveTexture: Material.Texture.Common({ src: FLASH_TEXTURE }),
      albedoColor: Color4.White(),
      emissiveColor: Color3.White(),
      emissiveIntensity: glow,
      metallic: 0, roughness: 1, specularIntensity: 0,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND, castShadows: false
    })
  })

  /*
    A report of its own. The gun fired the crate-smash clip at half volume: a shot sounded
    like a thud on wood, and testers said the weapon felt like nothing (3 Sep). And a
    second, separate cue when the round LANDS, on the player, so fire and hit are told apart
    by ear: the hit marker's tick, the genre's convention.
  */
  AudioSource.create(ancre, { audioClipUrl: 'assets/sounds/shot.wav', playing: false, loop: false, volume: 0.7 })
  hitmark = engine.addEntity()
  Transform.create(hitmark, { parent: engine.PlayerEntity, position: Vector3.create(0, 1, 0) })
  AudioSource.create(hitmark, { audioClipUrl: 'assets/sounds/hitmark.wav', playing: false, loop: false, volume: 0.7 })
  // The holster. Its emitter was declared and never created, so `jouerDraw` returned on its
  // first line and drawing stayed silent (owner, 5 Sep: "je n'entends aucun son quand je vise").
  // Two files, because the two acts are told apart by ear: the rub rises as the thing comes
  // out and falls as it goes back in (owner, 5 Sep: "ne fait pas penser a sortir / ranger").
  emetteurDraw = engine.addEntity()
  Transform.create(emetteurDraw, { parent: engine.PlayerEntity, position: Vector3.create(0, 1, 0) })
  AudioSource.create(emetteurDraw, { audioClipUrl: 'assets/sounds/draw.wav', playing: false, loop: false, volume: 0.75 })
  emetteurRange = engine.addEntity()
  Transform.create(emetteurRange, { parent: engine.PlayerEntity, position: Vector3.create(0, 1, 0) })
  AudioSource.create(emetteurRange, { audioClipUrl: 'assets/sounds/holster.wav', playing: false, loop: false, volume: 0.7 })

  /*
    Any move of the player puts the weapon away first.

    The aim is a first-person area parented to the player, and `movePlayerTo` relocates that
    player in a single frame, area and all. The lift, GO HOME and TO BELT all do this, and the
    screenshot of the stuck state (owner, 6 Sep) shows exactly what a client that lost the
    thread of it would draw: a third-person camera off the avatar, the cursor free, and the
    view model floating where the first-person camera last was. A holster before the move
    removes the whole case rather than guessing at the client.
  */
  avantDeplacement(() => degainer(false))

  CameraMode.onChange(engine.CameraEntity, (c) => {
    if (c === undefined) return
    // TEMPORARY: counted on screen, to tell a camera mode flip from a render flicker.
    noterBascule()
    applyView(c.mode === CameraType.CT_FIRST_PERSON)
  })

  /*
    Both messages now say what to do about it.

    "840 dropped" is a fact about a number, and it left a player who had just landed a shot
    with no idea that coins were lying on the ground several metres away, waiting to be
    walked over. The shot is only half the move; the run is the other half, and the run is
    where the other player gets to stop you.
  */
  room.onMessage('shotResult', (d) => {
    /*
      Every landed round gets the marker and the tick, the boss and the empty-handed
      included. The marker used to fire only when coins dropped, so most hits on the boss
      and on a broke thief left the reticle mute: "I can't feel whether I hit" (3 Sep).
    */
    if (d.reason !== 'missed') {
      combatView.lastHitAt = Date.now()
      const h = AudioSource.getMutableOrNull(hitmark)
      if (h !== null) { h.playing = false; h.playing = true }
    }
    // The boss flashes when hit; a line per round at five rounds a second would be noise.
    if (d.reason === 'boss') return
    // One shot, one line. What it did to their hands leads, because that is the bigger prize.
    const qui = d.hitName.toUpperCase()
    if (d.loot > 0) combatView.lastHitAt = Date.now()
    if (d.loot === 3) {
      alerter(`${qui} LOST THEIR GRIP, THE THEFT IS OFF`, '#8fe08f', TOAST.result)
    } else if (d.loot === 2) {
      alerter(`${qui} DROPPED IT, GRAB IT OFF THE GROUND`, '#ff6b6b', TOAST.warning)
    } else if (d.loot === 1) {
      alerter(`${qui} ALMOST LOST IT, KEEP FIRING`, '#ffd166', TOAST.result)
    } else if (d.reason === 'hit') {
      combatView.lastHitAt = Date.now()
      // No sum in a toast (memo 420): the pile on the ground says how much. The same line on
      // every hit refreshes the one on screen instead of churning the stack at four rounds a second.
      alerter(`HIT ${qui}  ·  COINS ON THE GROUND, GO TAKE THEM`, '#ffd166', TOAST.result)
    } else if (d.reason === 'nothing to drop') {
      alerter(`${qui} HAS NOTHING TO DROP`, '#9aa3ad', TOAST.result)
    }
  })
  room.onMessage('wasShot', (d) => {
    flashDamage()
    floatAmount(d.lost, true)
    playHurt()
    const s = Math.round(LOOT_OWNER_LOCK_MS / 1000)
    alerter(`${d.byName.toUpperCase()} SHOT YOU  ·  YOURS AGAIN IN ${s}s`, '#ff6b6b', TOAST.warning)
  })
  // Same channel as collecting: the number says how much, and a sound says it landed. The
  // sound is the soft take rather than the coin, because a pile off the floor is the most
  // repeated pick in the game and the owner found the coin harsh on it (5 Sep); it plays
  // HERE, on the server's word, and not on the press, so it is heard once.
  room.onMessage('pickedUp', (d) => {
    floatAmount(d.amount, false); cue('take.wav', 0.6)
    // And a burst at the feet: the pile is gone from the floor, something has to mark the spot.
    const moi = Transform.getOrNull(engine.PlayerEntity)
    if (moi !== null) puff(Vector3.create(moi.position.x, moi.position.y + 0.5, moi.position.z), '#8fe08f', 1.0)
  })
  room.onMessage('aiming', (d) => {
    const a = d.addr.toLowerCase()
    if (d.on) enJoue.add(a); else enJoue.delete(a)
    const t = INT_ARME[d.arme] ?? 'shoot'
    armeDe.set(a, t)
    if (a !== moi) equiperArme(armes.get(a) ?? null, t)
  })

  creerTraceurs()
  engine.addSystem(gunSystem)
  engine.addSystem(traceurSystem)
  engine.addSystem(pileSystem)
}

function applyView(fp: boolean): void {
  if (fp && !combatView.firstPerson) viewVisibleAfter = Date.now() + TRANSITION_MS
  combatView.firstPerson = fp
  rafraichirVisibilite()
}

/**
 * Every player nearby carries the weapon on their hand, including this one.
 *
 * The model renders as seven objects, and the engine instantiates a material per rendered
 * object, so an unbounded roster spends the scene's material budget on pistols nobody can
 * make out. The nearest ARMES_MAX are armed; past that the weapon is a dot anyway.
 */
function reconcilierArmes(): void {
  const moiT = Transform.getOrNull(engine.PlayerEntity)
  const candidats: { a: string; d: number }[] = []
  for (const [ent, id] of engine.getEntitiesWith(PlayerIdentityData)) {
    const a = id.address?.toLowerCase()
    if (a === undefined || a === '') continue
    if (a === moi) { candidats.push({ a, d: -1 }); continue }
    const t = Transform.getOrNull(ent)
    candidats.push({ a, d: t === null || moiT === null ? 1e9 : Vector3.distance(t.position, moiT.position) })
  }
  candidats.sort((x, y) => x.d - y.d)

  const vus = new Set<string>()
  for (const { a } of candidats.slice(0, ARMES_MAX)) {
    vus.add(a)
    if (armes.has(a)) continue
    const racine = engine.addEntity()
    Transform.create(racine, {})
    AvatarAttach.create(racine, { avatarId: a, anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND })
    const g = construireArme(racine, MAIN_POS, MAIN_ROT, armeDe.get(a) ?? 'shoot')
    armes.set(a, g)
    montrer(g, false)
  }
  for (const [a, g] of [...armes]) {
    /*
      My own weapon is never taken down by the roster. `PlayerIdentityData` blinks for a tick
      now and then (invariant on presence, server side), and a blink here removed my weapon
      WITH its children, the muzzle flash among them: every later shot then wrote to a
      deleted Transform and the fire path died mid-raid (tester, 28 Aug: "the gun stayed in
      the air and I could not aim any more").
    */
    if (vus.has(a) || a === moi) continue
    engine.removeEntityWithChildren(g.racine)
    armes.delete(a)
  }
  rafraichirVisibilite()
}

/** The muzzle flash, written through one door that tolerates a missing entity. */
function placeFlash(scale: number): void {
  const t = Transform.getMutableOrNull(flash)
  if (t !== null) t.scale = Vector3.create(scale, scale, scale)
}
/** A new star each shot: random roll, size between 85 and 115 percent of the peak. */
function allumerFlash(): void {
  flashPeak = FLASH_PEAK * (0.85 + Math.random() * 0.3)
  flashScale = flashPeak
  const t = Transform.getMutableOrNull(flash)
  if (t !== null) {
    t.rotation = Quaternion.fromEulerDegrees(0, 0, Math.random() * 360)
    t.scale = Vector3.create(flashScale, flashScale, flashScale)
  }
}

/**
 * Aim, fire, and what the reticle is allowed to claim.
 *
 * Press holds the aim, release fires: one control, two readable moments, and it behaves
 * the same under a tap as under a held key because both edges are read as events.
 */
function gunSystem(dt: number): void {
  if (moi === '') {
    const me = getPlayer()
    if (me === null) return
    moi = me.userId.toLowerCase()
    const c = CameraMode.getOrNull(engine.CameraEntity)
    applyView(c !== null && c.mode === CameraType.CT_FIRST_PERSON)
  }
  const now = Date.now()
  // The roster changes when someone joins or leaves, not every frame.
  if (now - dernierRecensement > 500) { dernierRecensement = now; reconcilierArmes() }

  const reste = dernierTir + SHOT_COOLDOWN_MS - now
  combatView.cooldown = reste > 0 ? reste / SHOT_COOLDOWN_MS : 0
  // Keep the held model in step with the chosen weapon, and tell the room when it changes.
  const arme = armeEnMain()
  if (arme !== armeAffichee) {
    armeAffichee = arme
    combatView.arme = arme
    setArmeIcone(combatView.aiming, arme)
    equiperArme(vue, arme)
    equiperArme(armes.get(moi) ?? null, arme)
    void room.send('aim', { on: combatView.aiming, arme: ARME_INT[arme] })
  }
  // The burst is over: the arm returns to the held aim, once.
  if (enRafale && now > rafaleJusqua) {
    enRafale = false
    if (combatView.aiming && placeAvailable()) void triggerSceneEmote({ src: CLIP_VISEE, loop: true, mask: AvatarMask.AM_UPPER_BODY })
  }

  // One control, and it toggles rather than being held.
  //
  // Holding costs a thumb, and on a phone the other one is already on the joystick, which
  // leaves nothing to look around with. Drawing is a state instead, and while the weapon
  // is out the shot leaves on its own as soon as the reticle locks someone. That is the
  // fire mode Fortnite recommends to players new to mobile, and a judge here has five
  // minutes: a second button for the trigger would buy nothing and cost a thumb.
  /*
    The DRAW is gated on the world being open; the HOLSTER never is.

    Both went through `mondeOuvert()` since the menu wall (6 Sep), and the playtest that night
    reported players stuck with the weapon out, unable to fire and unable to put it away, on
    phones and on the owner's desktop alike. Whatever put the client in that state, a way out
    that depends on a gate is not a way out. Drawing can be refused; holstering cannot, ever.
    F draws and holsters, and does nothing else (the cloak has its own row, owner, 5 Sep).
  */
  if (inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN) && (combatView.aiming || mondeOuvert())) {
    degainer(!combatView.aiming)
  }

  // A tap anywhere fires, and nothing fires on its own.
  //
  // Of the three fire modes Fortnite ships on mobile, the automatic one is the one it
  // recommends to newcomers, and it is the wrong one here. That advice assumes everything
  // on screen is an enemy. This venue is a gathering place built around one belt, so a
  // drawn weapon on automatic would shoot every neutral who crossed the cone, and a shot
  // costs the target real coins. Drawing already carries the intent; the tap carries the
  // shot. The reticle naming its target is the assist, rather than firing for the player.
  /*
    Two ways to fire, and the big one is the point.

    The trigger was the client's interaction button alone, which is the small one off to the
    side and wears a pointing hand: correct for picking things up, silent about being a
    trigger, and the reason the first question asked of this game was how to shoot. E is the
    central button, the largest and the one a thumb finds without looking, and while the
    weapon is out it has nothing else to do. So it fires, and it wears a reticle for as long
    as it does. The interaction button keeps working for anyone who already found it.
  */
  /*
    One tap, one round. Measured on the handset (28 Aug): `isPressed(IA_POINTER)` stays true
    for the whole of a camera drag on a touch screen, so a drawn weapon fired on its own every
    time the player looked around. The trigger is therefore the DOWN EDGE only, and on a phone
    it is the central button alone, the one wearing the reticle; a touch anywhere else is the
    camera. On a desktop the click and E both fire. `tirer` holds the cadence, four rounds a
    second at most, the tester's cap, and the per-hit yield stayed where it was, so theft
    per second is a quarter of what the machine gun took.
  */
  // No round while a panel is up: the click that presses a menu button is the same click
  // the trigger listens to, and a drawn weapon fired at every tab (owner, 6 Sep).
  const gachette = mondeOuvert() && (inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)
    || (!isMobile() && inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)))
  if (combatView.aiming && gachette && tirer(now)) {
    // The arm keeps its own, slower beat.
    //
    // The weapon can leave five and a half rounds a second and the clip lasts three
    // hundred milliseconds, so animating every one of them would restart the emote before
    // it played and turn a burst into a twitch, at one restricted call per round. The
    // muzzle flash and the weapon's own kick carry the cadence; the arm plays about three
    // times a second and that is enough to read as recoil.
    /*
      One looping clip per burst, not one clip per round. The loop's cycle is the shot cooldown,
      so fire at full cadence reads as fire; the avatar takes two emote calls per burst (in,
      then back to the held aim) instead of one per round, which is what froze the arm over a
      sixty-round raid (28 Aug). `CLIP_TIR` stays for a single shot's feel: the burst loop is
      only started on the second round within the window.
    */
    if (placeAvailable()) {
      if (!enRafale) {
        enRafale = true
        dernierClipTir = now
        void triggerSceneEmote({ src: CLIP_RAFALE, loop: true, mask: AvatarMask.AM_UPPER_BODY })
      }
      rafaleJusqua = now + RAFALE_FIN_MS
    }
  }

  // The view model pulls to centre while aiming, and stops being written once it is
  // there: asking for a mutable Transform every frame dirties the component every frame.
  if (vue !== null && combatView.aiming) {
    const cible = VISEE_POS
    const t = Transform.getOrNull(vue.racine)
    if (t !== null && Vector3.distance(t.position, cible) > 0.002) {
      Transform.getMutable(vue.racine).position = Vector3.lerp(t.position, cible, Math.min(1, dt * 12))
    }
  }

  if (flashScale > 0) {
    flashScale = Math.max(0, flashScale - dt * flashPeak / FLASH_LIFE_S)
    placeFlash(flashScale)
  }

  // Recoil. The avatar's arm cannot move, so the weapon does: it rises on the shot and
  // settles back. Applied to whichever of the two models is the one on screen.
  /*
    A gun kicks back; a paddle and a taser SWING forward. The same upward jerk served all
    three, so a slap looked like a misfire (testers, 3 and 4 Sep: "the weapons don't feel
    like anything"). The swing is wider and a touch slower, the way an arm is.
  */
  if (recul > 0) {
    const porteur = combatView.firstPerson ? vue : (armes.get(moi) ?? null)
    const melee = porteur !== null && porteur.type !== 'shoot'
    recul = Math.max(0, recul - dt * (melee ? 6 : 9))
    if (porteur !== null) {
      const base = combatView.firstPerson ? Quaternion.Identity() : MAIN_ROT
      const deg = melee ? Math.sin(recul * Math.PI) * SWING_DEG : -recul * RECUL_DEG
      Transform.getMutable(porteur.poignee).rotation =
        Quaternion.multiply(base, Quaternion.fromEulerDegrees(deg, 0, 0))
    }
  }

  rafraichirVisibilite()
  viser()
}


/**
 * Weapon out or weapon away. Everything that depends on the state is set from here.
 *
 * Drawing forces first person, and that is not a matter of taste: the shot, the reticle
 * and the aiming pose all have to mean one direction. In third person the body keeps the
 * heading it last walked on while the camera looks elsewhere, measured ninety degrees
 * apart on a live client, so the character would aim at nothing while the round went
 * somewhere else. Turning the body back with movePlayerTo was the alternative, and that
 * call is documented as interruptible by player input, so it cannot be issued every frame
 * and always leaves drift. First person has the body track the camera exactly and for
 * nothing: measured identical to the hundredth of a degree, before and after a 192 degree
 * turn. Holstering drops the area and the explorer restores the camera the player chose.
 */
/** The one aim area of the session, parented to the player: see `ZONE_VISEE` and `degainer`. */
function placerZone(ou: Vector3): void {
  if (zoneVisee === null) {
    zoneVisee = engine.addEntity()
    Transform.create(zoneVisee, { parent: engine.PlayerEntity, position: ou, scale: ZONE_VISEE })
    CameraModeArea.create(zoneVisee, { area: ZONE_VISEE, mode: CameraType.CT_FIRST_PERSON })
    return
  }
  const t = Transform.getMutableOrNull(zoneVisee)
  if (t !== null) t.position = ou
}

function degainer(on: boolean): void {
  if (combatView.aiming === on) return
  // Drawing and putting away were both silent: the emote played and nothing was heard.
  jouerDraw(on)
  combatView.aiming = on
  setAiming(on)
  setArmeIcone(on, armeEnMain())
  if (on) enJoue.add(moi)
  else enJoue.delete(moi)
  void room.send('aim', { on, arme: ARME_INT[armeEnMain()] })
  if (on) {
    degainages += 1
    /*
      Gated like every other emote here. This one call was not: a phone drew the weapon
      and started the looping aim pose, and the stop below was gated, so the pose was
      never stopped on that phone. On everyone else's screen that player slid across the
      floor frozen in the aim (owner, playing with the testers, 4 Sep).
    */
    if (placeAvailable()) void triggerSceneEmote({ src: CLIP_VISEE, loop: true, mask: AvatarMask.AM_UPPER_BODY })
    /*
      The view model shows after the camera's own slide, timed from the draw itself.

      It used to wait on the camera reporting first person, and that report is what the
      lateral gun came from (see `rafraichirVisibilite`). The draw is the one moment the scene
      knows for certain; the client's slide takes `TRANSITION_MS` from it.
    */
    viewVisibleAfter = Date.now() + TRANSITION_MS
    /*
      The area is moved onto the player, never created here.

      It was created on every draw and destroyed on every holster, and destruction is the one
      path the clients handle worst. On the desktop, destroying the entity fires the exit
      handler whether or not the player had already left the box; on the phone, freeing the
      Area3D node can leave a dead reference in the detector's overlap list, after which the
      detector reads a freed object and the forced mode never lifts: the "stuck in first
      person, holster does nothing" of the 6 Sep playtest, on desktop and phone alike. The
      enter and exit path, by contrast, is what every scene with a camera area exercises. So
      the area lives for the whole session and is moved three hundred metres under the map
      when the weapon is away, which is an ordinary exit on both clients.
    */
    placerZone(ZONE_EN_JOUE)
  } else {
    enRafale = false
    // Unconditional: stopping an emote that is not playing costs nothing, and a pose that
    // was started by an older build must still be stoppable.
    void stopEmote({})
    placerZone(ZONE_RANGEE)
    // The cursor is NOT given back here any more. This used to release the capture on the
    // way out of first person, and since 27 Aug the desktop policy is the opposite: captured
    // while the HUD is on screen (setup.ts owns it). Releasing here undid that policy every
    // time the weapon was holstered (tester: "aim and back, the camera follow is gone").
  }
}

/**
 * Put the weapon away, from anywhere.
 *
 * The pad's weapon disc calls this DIRECTLY while the weapon is out, instead of emitting the
 * secondary action for the input system to toggle. Two reasons. A direct call does not depend
 * on the input reaching the scene at all, which is the second independent way out the stuck
 * state needs. And a toggle raced with the binding: had the disc kept its action while also
 * calling this, one press would holster here and draw again on the action a frame later.
 * `degainer` is idempotent, so a second call from any path costs nothing.
 */
export function holster(): void { degainer(false) }

/**
 * What the shot would reach, computed the way the server computes it.
 *
 * Only while aiming: a reticle that is always on screen is decoration in a game whose
 * usual act is managing a base, and scanning the roster every frame to feed it is waste.
 */
function viser(): void {
  combatView.targetName = ''
  combatView.targetDist = 0
  if (!combatView.aiming) { cbtTargetAddr = ''; return }
  const cam = Transform.getOrNull(engine.CameraEntity)
  const moiT = Transform.getOrNull(engine.PlayerEntity)
  if (cam === null || moiT === null) return

  const f = Vector3.rotate(Vector3.create(0, 0, 1), cam.rotation)
  const plat = Math.sqrt(f.x * f.x + f.z * f.z)
  if (plat < 0.0001) return
  const ax = f.x / plat
  const az = f.z / plat

  let best: { addr: string; d: number } | null = null
  for (const [ent, id] of engine.getEntitiesWith(PlayerIdentityData)) {
    const a = id.address?.toLowerCase()
    if (a === undefined || a === '' || a === moi) continue
    const t = Transform.getOrNull(ent)
    if (t === null) continue
    const dx = t.position.x - moiT.position.x
    const dz = t.position.z - moiT.position.z
    const d = Math.sqrt(dx * dx + dz * dz)
    if (d > weaponReach() || d < 0.5) continue
    if (!inShotCone(d, (dx * ax + dz * az) / d)) continue
    if (best === null || d < best.d) best = { addr: a, d }
  }
  // The raid boss is a target like any other, and the nearer one wins the reticle.
  if (raidView.active) {
    const dx = raidView.x - moiT.position.x
    const dz = raidView.z - moiT.position.z
    const d = Math.sqrt(dx * dx + dz * dz)
    // The boss locks out to the raid range whatever the weapon: a taser (2.5 m) still aims at it.
    if (d <= RAID_HIT_RANGE && d >= 0.5 && inShotCone(d, (dx * ax + dz * az) / d) && (best === null || d < best.d)) {
      cbtTargetAddr = 'raid-boss'
      targetName = 'RAID BOSS'
      combatView.targetName = targetName
      combatView.targetDist = d
      return
    }
  }
  if (best === null) { cbtTargetAddr = ''; return }
  // Resolving a display name is a lookup: do it when the target changes, not every frame.
  if (best.addr !== cbtTargetAddr) {
    cbtTargetAddr = best.addr
    targetName = getPlayer({ userId: best.addr })?.name ?? 'PLAYER'
  }
  combatView.targetName = targetName
  combatView.targetDist = best.d
}

/**
 * Fire. The client reports a point, never a victim.
 *
 * The point is taken from the PLAYER position along the CAMERA facing, so the direction
 * the server rebuilds from it is exactly the camera's, whichever camera the player chose.
 * Reading it from the camera position instead would tilt the shot by the third-person
 * offset, and the reticle would stop telling the truth as soon as the player switched view.
 */
/** Reach and rhythm of whatever is in hand, read in one place so reticle and shot agree. */
/** True when the player actually owns that weapon; the gun is always owned. */
function possedeArme(a: ArmeType): boolean {
  return a === 'shoot' || (a === 'slap' && gearView.held[2] > 0) || (a === 'taser' && gearView.held[5] > 0)
}
/*
  The player's WIELD choice wins as long as they own it; otherwise fall back to the best owned.
  Without this the choice was ignored and buying a slap silently overrode the gun for good
  (tester, 28 Aug: "HOLD GUN and I still hold the slap").
*/
function armeEnMain(): ArmeType {
  if (possedeArme(gearView.armeChoisie)) return gearView.armeChoisie
  return gearView.held[5] > 0 ? 'taser' : gearView.held[2] > 0 ? 'slap' : 'shoot'
}
function weaponReach(): number { return armeEnMain() === 'shoot' ? SHOT_RANGE : SLAP_RANGE }
function cadenceArme(): number {
  const arme = armeEnMain()
  return arme === 'taser' ? TASER_COOLDOWN_MS : arme === 'slap' ? SLAP_COOLDOWN_MS : SHOT_COOLDOWN_MS
}

function tirer(now: number): boolean {
  if (dernierTir + cadenceArme() > now) return false
  const cam = Transform.getOrNull(engine.CameraEntity)
  const moiT = Transform.getOrNull(engine.PlayerEntity)
  if (cam === null || moiT === null) return false
  dernierTir = now

  const f = Vector3.rotate(Vector3.create(0, 0, 1), cam.rotation)
  const plat = Math.sqrt(f.x * f.x + f.z * f.z)
  if (plat < 0.0001) return false
  /*
    The weapon in hand decides which message leaves. A slap is the gun with an arm's reach and
    full force at every hit; the server checks the pocket before honouring it, so the client
    asking is only ever a preference.
  */
  const portee = weaponReach()
  void room.send(armeEnMain(), {
    x: moiT.position.x + (f.x / plat) * portee,
    y: moiT.position.y,
    z: moiT.position.z + (f.z / plat) * portee
  })

  // A gun flashes and cracks; a melee weapon swings. No bullets out of a paddle (tester, 28 Aug).
  const gun = armeEnMain() === 'shoot'
  if (gun) allumerFlash(); else { flashScale = 0; placeFlash(0) }
  recul = 1
  combatView.lastShotAt = now
  /*
    The tracer: a streak that FLIES, from the muzzle to where the reticle points. It was a
    line laid once along the aim ray for seventy milliseconds: it left the eye instead of
    the barrel, then stayed behind a player on the move, then ran straight while the gun
    kicked twenty degrees up on the same frame, so the gun fired "sideways" from its own
    trail (owner, 4 Sep, three reports). A bolt that leaves the muzzle at seventy metres a
    second is out of the barrel before the kick shows, ends on the target the reticle
    claims with a burst there, and dies at range on a miss so the miss still SHOWS.
  */
  if (gun && cam !== null) {
    const long = SHOT_RANGE * 0.9
    const fin = Vector3.create(cam.position.x + f.x * long, cam.position.y + f.y * long, cam.position.z + f.z * long)
    const anchor = combatView.firstPerson && vue !== null ? Transform.getOrNull(vue.racine) : null
    const debut = anchor !== null
      ? Vector3.add(cam.position, Vector3.rotate(Vector3.add(anchor.position, BOUCHE), cam.rotation))
      : Vector3.create(cam.position.x + f.x * 0.7, cam.position.y - 0.12 + f.y * 0.7, cam.position.z + f.z * 0.7)
    const trait = Vector3.subtract(fin, debut)
    const portee = Vector3.length(trait)
    if (portee > 0.01) {
      const cible = combatView.aiming && combatView.targetDist > 0
      // The reticle's distance is player-to-target on the ground; the muzzle sits ahead of
      // the player and the burst belongs on the near face of the body, hence the trim.
      const bout = cible ? Math.min(portee, Math.max(0.5, combatView.targetDist - 0.6)) : portee
      lancerTraceur(debut, Vector3.scale(trait, 1 / portee), bout, cible, anchor !== null)
    }
  }
  if (vue !== null) {
    const s = AudioSource.getMutableOrNull(vue.racine)
    if (s !== null) { s.playing = false; s.playing = true }
  }
  return true
}

/** A bolt from one world point to another, with a burst where it lands: the sentry's shot. */
export function boltBetween(from: Vector3, to: Vector3): void {
  if (traceurs.length === 0) return
  const trait = Vector3.subtract(to, from)
  const portee = Vector3.length(trait)
  if (portee < 0.05) return
  lancerTraceur(from, Vector3.scale(trait, 1 / portee), portee, true, false)
}

/** The bolt: metres per second, its length, and how far out of the muzzle it is drawn on the frame of the shot. */
const TRACER_SPEED = 70
const TRACER_LENGTH = 1.6
const TRACER_HEAD_START = 0.9
/** The burst where a bolt lands, in the flash's own colour. */
const IMPACT_HEX = '#ffe9a8'
const IMPACT_SIZE = 0.55
/**
  The scene's picture of the camera LAGS the picture on screen by the round trip through the
  renderer, so anything placed in the world from `Transform(CameraEntity)` is placed where
  the camera WAS. A bolt spawned that way left the muzzle's previous position: strafing
  right, it appeared to start left of the barrel (owner, 4 Sep, after the alignment fix).
  A child of the camera has no such lag: the renderer draws it against the camera it has.
  So in first person the bolt is a camera child, and every frame its local transform is
  recomputed from its frozen WORLD path against the scene's current camera: at the muzzle
  the two frames coincide and the bolt is exact; further out, the lag error is bounded by
  the camera's speed times the round trip, far too small to see at that distance.
*/
type Tracer = {
  e: Entity
  /** The world path, frozen at the shot: origin, direction, and the box's rotation along it. */
  origin: Vector3
  dir: Vector3
  rot: Quaternion
  /** Drawn as a child of the camera (first person) or in the world (third person). */
  onCamera: boolean
  at: number
  end: number
  impact: boolean
}
/** The tracer pool: four bolts in flight at most (four rounds a second, a third of a second each), reused round-robin. */
const traceurs: Tracer[] = []
let traceurSuivant = 0
function creerTraceurs(): void {
  for (let i = 0; i < 4; i++) {
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(0, -60, 0), scale: Vector3.Zero() })
    MeshRenderer.setBox(e)
    Material.setPbrMaterial(e, plasticDe(Color4.create(1, 0.85, 0.45, 1), 3))
    traceurs.push({
      e, origin: Vector3.Zero(), dir: Vector3.Forward(), rot: Quaternion.Identity(),
      onCamera: false, at: 0, end: 0, impact: false
    })
  }
}
/** A unit quaternion's inverse is its conjugate. */
function inverse(q: Quaternion): Quaternion {
  return Quaternion.create(-q.x, -q.y, -q.z, q.w)
}
/** Lay the bolt with its head `head` metres along its path; the tail never goes back into the muzzle. */
function poserTraceur(t: Tracer, tt: { position: Vector3; rotation: Quaternion; scale: Vector3 }, head: number): void {
  const tail = Math.max(0, head - TRACER_LENGTH)
  const mid = (head + tail) / 2
  const monde = Vector3.create(t.origin.x + t.dir.x * mid, t.origin.y + t.dir.y * mid, t.origin.z + t.dir.z * mid)
  const cam = t.onCamera ? Transform.getOrNull(engine.CameraEntity) : null
  if (cam !== null) {
    const inv = inverse(cam.rotation)
    tt.position = Vector3.rotate(Vector3.subtract(monde, cam.position), inv)
    tt.rotation = Quaternion.multiply(inv, t.rot)
  } else {
    tt.position = monde
    tt.rotation = t.rot
  }
  tt.scale = Vector3.create(0.025, 0.025, head - tail)
}
function lancerTraceur(origin: Vector3, dir: Vector3, end: number, impact: boolean, onCamera: boolean): void {
  const t = traceurs[traceurSuivant]
  traceurSuivant = (traceurSuivant + 1) % traceurs.length
  t.origin = origin
  t.dir = dir
  const up = Math.abs(dir.y) > 0.99 ? Vector3.Forward() : Vector3.Up()
  t.rot = Quaternion.lookRotation(dir, up)
  t.onCamera = onCamera
  t.at = Date.now()
  t.end = end
  t.impact = impact
  const tt = Transform.getMutableOrNull(t.e)
  if (tt === null) { t.at = 0; return }
  tt.parent = onCamera ? engine.CameraEntity : engine.RootEntity
  poserTraceur(t, tt, Math.min(TRACER_HEAD_START, end))
}
function traceurSystem(): void {
  const now = Date.now()
  for (const t of traceurs) {
    if (t.at === 0) continue
    const tt = Transform.getMutableOrNull(t.e)
    if (tt === null) { t.at = 0; continue }
    const head = TRACER_HEAD_START + (now - t.at) / 1000 * TRACER_SPEED
    if (head < t.end) { poserTraceur(t, tt, head); continue }
    t.at = 0
    tt.scale = Vector3.Zero()
    if (t.impact) {
      puff(Vector3.create(t.origin.x + t.dir.x * t.end, t.origin.y + t.dir.y * t.end, t.origin.z + t.dir.z * t.end), IMPACT_HEX, IMPACT_SIZE)
    }
  }
}

/** The dropped coin's size, in metres: readable from the far side of a base. */
const COIN_DIAMETER = 0.8
const COIN_THICKNESS = 0.16

/** Dropped piles: the server owns them, the client only draws what it publishes. */
function pileSystem(): void {
  const alive = new Set<number>()
  for (const [ent, c] of engine.getEntitiesWith(DroppedCoins, Transform)) {
    const id = ent as unknown as number
    alive.add(id)
    const t = Transform.get(ent)
    if (piles.has(id)) continue
    /*
      Two entities per coin, because one of them can only be doing one thing.

      An entity carries at most one Tween, and this one has to both fall and spin. So the
      outer one falls, once, with a bounce at the end, and the coin itself hangs from it and
      turns for ever. Parenting composes the two transforms, which is the cheapest way to get
      a second animation out of an engine that allows one.
    */
    const chute = engine.addEntity()
    const sol = Vector3.create(t.position.x, t.position.y, t.position.z)
    const haut = Vector3.create(t.position.x, t.position.y + 1.2, t.position.z)
    Transform.create(chute, { position: haut })
    Tween.setMove(chute, haut, sol, 520, EasingFunction.EF_EASEOUTBOUNCE)

    /*
      A coin you can see from across a base. It was 23 cm across, the footprint of the
      cube it replaced, and a thief's dropped coins were the smallest thing on the floor
      while the toys on the shelves stood at a metre (owner, 3 Sep). Eighty centimetres,
      lifted by half its thickness so it lies ON the ground rather than in it.
    */
    const body = engine.addEntity()
    Transform.create(body, { parent: chute, position: Vector3.create(0, COIN_THICKNESS / 2, 0), scale: Vector3.create(COIN_DIAMETER, COIN_THICKNESS, COIN_DIAMETER) })
    MeshRenderer.setCylinder(body, 0.5, 0.5)
    Material.setPbrMaterial(body, plasticDe(OR, 1.6))
    spinLoop(body, 3200)
    // Hung from the same faller, so the number arrives with the coin instead of waiting for it.
    const label = engine.addEntity()
    Transform.create(label, { parent: chute, position: Vector3.create(0, COIN_THICKNESS + 0.75, 0), scale: Vector3.create(0.6, 0.6, 0.6) })
    Billboard.create(label, { billboardMode: BillboardMode.BM_Y })
    TextShape.create(label, { text: formatIncome(c.amount), fontSize: 3, textColor: OR })
    piles.set(id, { chute, body, label })
  }
  for (const [id, v] of [...piles]) {
    if (alive.has(id)) continue
    engine.removeEntity(v.body); engine.removeEntity(v.chute); engine.removeEntity(v.label)
    piles.delete(id)
  }
}
