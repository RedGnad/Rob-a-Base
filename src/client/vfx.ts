import { engine, Entity, Transform, ParticleSystem, PBParticleSystem, PBParticleSystem_BlendMode, PBParticleSystem_PlaybackState, PBParticleSystem_SimulationSpace } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { crate } from '../shared/loot-table'
import { FUSION_POS, FUSION_ECHELLE } from '../shared/schemas'

/*
  Particles where the game's moments happen: a crate opening, a theft, a sentry shot, a fusion,
  a rare piece coming out, and the air during a rush.

  WHY NOW, when `impact.ts` says the phone draws no particles. That was true of the app the
  testers had on 3 Sep. The mobile client has drawn `ParticleSystem` since godot-explorer
  #2588; release 1.14.0 tied it to the graphics profile (#2812: Very Low draws none) and
  1.16.0 fixed sprites that do not face the camera, which is why every emitter here keeps
  `billboard` on. The flat bursts in `impact.ts` stay: they are what Very Low still shows.

  EACH MOMENT READS ITS CONTEXT (3 Nov). The first pass had one look per moment and only the
  colour changed: a Basic Box and a Mythic Box opened with the same spray, a Common and a
  Legendary were stolen with the same glitter (owner: "les particules sont pas très
  travaillées selon les situations"). Now the crate's tier sets the shape of its opening, from
  dust that drops to three waves of a gold fountain, a themed crate opens in its theme's
  motion (Lava embers rise, Gold glitter falls, Cyber sparks fly fast), a theft and a fusion
  grow with the piece's rarity, and a rush fills the air around the player in its theme.

  THE BUDGET is the reason for the shape of this file. Particles are counted apart from the
  meshes, so they spend none of the material and draw call headroom the bases have used up
  (92% and 77% of the mobile ceiling, 7 Sep); the mobile ceiling that does apply is eight
  emitters per scene, with a warning at eight and a refusal at ten. So seven emitters, created
  once at setup and never deleted, and an emitter is a CHANNEL, not a look: every firing
  writes the whole component, so a look per tier or per theme costs no emitter, and neither
  does a shape: six textures of 128 pixels, 26 KB in all, against the 71 the desktop allows
  this scene (25 used, `get_scene_content_stats`, 3 Nov). The phone's 400 textures are a
  preview overlay, not a production limit (godot-explorer `docs/rn-ui-spec`).

  DIRECTIONS, read off both clients' source (3 Nov): `gravity` multiplies the scene's -9.81,
  so a positive value falls and a negative one rises, on both (`gravityModifier` on the
  desktop, `DCL_GRAVITY * gravity` on the phone). A cone or a box throws along the entity's
  local +Z on both: the desktop resets its prefab's -90 degree tilt (`ResetLocalTRS`) and the
  phone emits along +Z by name (`EMISSION_AXIS`). So a fountain is a cone on an entity turned
  to face up, and a sphere throws every way on both.

  HOW A BURST IS FIRED, read off both clients' source (2 Nov), because the obvious ways fail
  on one of them:
  - A one-shot `bursts` entry, not a continuous rate held open for a moment. On the phone
    every change to the component rebuilds the emitter, so the write that closes a held
    rate could cut the burst it just opened. One write starts it and nothing touches it after.
  - Replayed by STOPPED, then PLAYING two ticks later. The desktop client only calls `Play()`
    on a dirty PLAYING if the system is not already playing; STOPPED clears it, so the next
    PLAYING always replays. The phone ignores a write equal to the last one, and STOPPED then
    PLAYING are never equal. Two ticks rather than one so the two writes cannot arrive in the
    same renderer frame and merge into one.
  - The phone's Low profile simulates on the CPU and skips `bursts` entirely; it still emits
    the pool once over a lifetime, so the same moment shows there as a short spray, and the
    waves of the top tiers arrive there as one.
  - Created at setup, while nothing is happening: both clients fetch a particle texture when
    the component first names it and draw untextured squares until it lands (desktop
    `CleanUpTexture` clears the old one on a change; the phone keys its cache by file hash).
    So setup names every shape once (`warm`), and a firing names its shape on the STOPPED
    write, two ticks before anything is drawn.
*/

type Channel = 'steal' | 'crate' | 'zap' | 'fuse' | 'boss' | 'steam'

/*
  The shapes, all from Kenney's Particle Pack (CC0, `tools/vfx/build-particle-textures.py`).
  A star was every particle until 3 Nov; a shape now says what a thing is before its colour
  does: a ghost breathes mist, Lava burns, Radioactive bubbles, Cyber rains in streaks.
  `spark` is how many times the drawn shape the sprite is, so a size below is the shape seen:
  one over the span the build prints, except the star's, set from captures (its rays span three
  quarters of the sprite, but only the core reads: 11% of its pixels are lit, and the first
  captures lost the Basic, Good and Rare openings entirely at five metres).
*/
type Sprite = 'star' | 'puff' | 'flame' | 'ring' | 'streak' | 'swirl'

const SPRITES: Record<Sprite, { src: string; spark: number }> = {
  star: { src: 'assets/textures/fx-star.png', spark: 3 },
  puff: { src: 'assets/textures/fx-puff.png', spark: 1 / 0.85 },
  flame: { src: 'assets/textures/fx-flame.png', spark: 1 / 0.51 },
  ring: { src: 'assets/textures/fx-ring.png', spark: 1 / 0.72 },
  streak: { src: 'assets/textures/fx-streak.png', spark: 1 / 0.69 },
  swirl: { src: 'assets/textures/fx-swirl.png', spark: 1 / 0.8 }
}

type Shot = {
  e: Entity
  /** Ticks left before the PLAYING write; -1 when idle. */
  wait: number
  /** The look the PLAYING write carries. */
  next: PBParticleSystem
  /** When it was last fired, and how long that burst lives: an emitter still playing is not reused while another is free. */
  firedAt: number
  busyMs: number
}

/**
 * A burst described by what it does, turned into the component by `look`.
 *
 * Sizes are the shape seen, in metres, not the sprite around it (see SPRITES), and the camera
 * is a few metres away; counts stay far under the thousand live particles the desktop client renders
 * per scene.
 */
type Spec = {
  /** Particles in the first wave; each later wave carries a little less. */
  count: number
  waves?: number
  life: number
  size: [number, number]
  /** Size at the end of a particle's life, as a share of its start: under 1 it shrinks, over 1 it swells. */
  end: number
  speed: [number, number]
  gravity: number
  /** A ball throws every way; a fountain throws up inside a cone of this half-angle, in degrees. */
  fountain?: number
  radius: number
  /** Added light rather than paint: what keeps a tint from sinking into the green field. */
  glow?: boolean
  /** Each particle is drawn somewhere between these two colours. */
  colors: [string, string]
  /** The colour it drifts towards as it fades out; white keeps its own. */
  fade?: string
  /** A star unless said otherwise. */
  sprite?: Sprite
}

const PARKED = Vector3.create(96, -20, 96)
const REPLAY_TICKS = 2
/** Seconds between two waves of one burst. */
const WAVE_GAP = 0.24
/** Turns an entity's +Z, the axis a cone throws along, to face the sky. */
const UP = Quaternion.fromEulerDegrees(-90, 0, 0)
const FLAT = Quaternion.Identity()

function rgba(hex: string, a = 1): Color4 {
  const c = Color4.fromHexString(hex.slice(0, 7) + 'ff')
  return Color4.create(c.r, c.g, c.b, a)
}

function look(s: Spec): PBParticleSystem {
  const values: Array<{ time: number; count: number }> = []
  let total = 0
  for (let i = 0; i < (s.waves ?? 1); i++) {
    const count = Math.max(1, Math.round(s.count * (1 - i * 0.15)))
    values.push({ time: i * WAVE_GAP, count })
    total += count
  }
  const sprite = SPRITES[s.sprite ?? 'star']
  return {
    loop: false, rate: 0, maxParticles: total, lifetime: s.life,
    gravity: s.gravity,
    initialSize: { start: s.size[0] * sprite.spark, end: s.size[1] * sprite.spark },
    sizeOverTime: { start: 1, end: s.end },
    initialVelocitySpeed: { start: s.speed[0], end: s.speed[1] },
    shape: s.fountain !== undefined
      ? ParticleSystem.Shape.Cone({ angle: s.fountain, radius: s.radius })
      : ParticleSystem.Shape.Sphere({ radius: s.radius }),
    bursts: { values },
    initialColor: { start: rgba(s.colors[0]), end: rgba(s.colors[1]) },
    colorOverTime: { start: rgba('#ffffff'), end: rgba(s.fade ?? '#ffffff', 0) },
    texture: { src: sprite.src },
    blendMode: s.glow === true ? PBParticleSystem_BlendMode.PSB_ADD : PBParticleSystem_BlendMode.PSB_ALPHA,
    billboard: true,
    simulationSpace: PBParticleSystem_SimulationSpace.PSS_WORLD
  }
}

/*
  The crate ladder. The models already climb from planks to a gold crown (`build-crates.py`,
  2 Nov); the opening climbs with them, and the step that changes is the MOTION before the
  amount. Basic: a handful of small cream stars that drop at once, the humblest sparkle. It was a
  cloud of dull dust, and smoke out of a box you just bought reads as a box that broke or burnt
  (owner, 3 Nov: "bizarre voire négatif"); wood chips were tried next and read as scattered dirt
  (capture, 3 Nov). Every opening is a reward, so every one sparkles, and the tier shows in how
  much and how high. Good and Rare: more stars, thrown wide, that fall back. Epic: the first fountain. Legendary: a gold
  fountain of added light in two waves. Mythic: three waves, the crown's gold mixed into its red.
*/
function tierSpec(tier: number, tint: string): Spec {
  switch (tier) {
    case 0: return { count: 16, life: 0.9, size: [0.1, 0.18], end: 0.5, speed: [1.4, 2.6], gravity: 1.2, radius: 0.3, colors: ['#fff4dc', '#d9b27c'] }
    case 1: return { count: 32, life: 1.1, size: [0.14, 0.28], end: 0.45, speed: [1.6, 3.4], gravity: 0.9, radius: 0.3, colors: ['#ffffff', tint] }
    case 2: return { count: 44, life: 1.2, size: [0.16, 0.36], end: 0.45, speed: [2.4, 5.0], gravity: 0.6, radius: 0.35, colors: ['#ffffff', tint] }
    case 3: return { count: 36, waves: 2, life: 1.4, size: [0.16, 0.34], end: 0.45, speed: [3.5, 6.0], gravity: 1.0, fountain: 30, radius: 0.35, colors: ['#ffffff', tint] }
    case 4: return { count: 40, waves: 2, life: 1.6, size: [0.18, 0.4], end: 0.4, speed: [4.5, 7.0], gravity: 1.05, fountain: 32, radius: 0.4, glow: true, colors: [tint, '#ffe066'] }
    default: return { count: 44, waves: 3, life: 1.9, size: [0.2, 0.45], end: 0.4, speed: [5.0, 8.0], gravity: 1.0, fountain: 36, radius: 0.45, glow: true, colors: [tint, '#ffd84d'] }
  }
}

/*
  One motion per rush theme, keyed by mutation id, shared by the themed crate's opening and the
  rush's air so a theme moves the same way wherever it shows. Every theme in EVENT_THEMES needs
  a line here and in WEATHER; a theme without one falls back to its tier's look.
*/
function themeSpec(theme: number, n: number): Spec | null {
  switch (theme) {
    case 1: return { count: n + 10, life: 1.2, size: [0.08, 0.18], end: 0.5, speed: [2.2, 4.2], gravity: 1.1, radius: 0.35, colors: ['#ffffff', '#ffd700'] }
    case 5: return { count: n, life: 1.5, size: [0.24, 0.46], end: 0.4, speed: [1.0, 2.6], gravity: -0.3, radius: 0.35, glow: true, colors: ['#ffb300', '#ff5722'], fade: '#b3261e', sprite: 'flame' }
    case 9: return { count: n - 6, life: 1.6, size: [0.22, 0.42], end: 1.6, speed: [0.6, 1.6], gravity: -0.12, radius: 0.4, glow: true, colors: ['#9b3dbb', '#d38cf0'], sprite: 'swirl' }
    case 6: return { count: n, life: 1.6, size: [0.06, 0.16], end: 0.6, speed: [1.4, 3.0], gravity: 0, radius: 0.35, glow: true, colors: ['#ffffff', '#b48cff'] }
    case 7: return { count: n, life: 1.2, size: [0.12, 0.26], end: 0.5, speed: [2.0, 4.0], gravity: 0.6, radius: 0.35, colors: ['#151515', '#ffffff'] }
    case 8: return { count: n, life: 1.6, size: [0.14, 0.3], end: 1.4, speed: [0.6, 1.8], gravity: -0.22, radius: 0.35, glow: true, colors: ['#7fff00', '#c6ff5e'], sprite: 'ring' }
    case 10: return { count: n, life: 1.4, size: [0.3, 0.6], end: 0.45, speed: [3.0, 5.5], gravity: 0.15, fountain: 12, radius: 0.3, glow: true, colors: ['#ffffff', '#ffe9a8'], sprite: 'streak' }
    // Drawn between yellow and magenta and faded towards cyan, so each one turns from warm to
    // cool as it falls: two colours per particle is all the component allows, and the product
    // of the two ranges is what reads as a rainbow.
    case 11: return { count: n + 6, life: 1.3, size: [0.12, 0.26], end: 0.5, speed: [2.0, 4.2], gravity: 0.7, radius: 0.35, colors: ['#ffee00', '#ff00ff'], fade: '#00ffff' }
    case 12: return { count: n + 10, life: 0.75, size: [0.2, 0.4], end: 0.4, speed: [3.5, 6.5], gravity: 0, radius: 0.2, glow: true, colors: ['#00e5ff', '#ffffff'], sprite: 'streak' }
    case 13: return { count: n - 6, life: 1.8, size: [0.3, 0.5], end: 1.5, speed: [0.4, 1.2], gravity: -0.08, radius: 0.4, colors: ['#86ffd0', '#e6fff6'], sprite: 'puff' }
    default: return null
  }
}

/** Grows with the piece: a Common glints, a Secret throws three times as much, and from Legendary it shines. */
/*
  WHITE AND THE COLOUR, MIXED, on purpose (3 Nov). The textbook burst is born white and cools to
  its colour; tried here as "born light, dying deep", it made the pale and the green tiers (Basic,
  Good, Common, Uncommon) nearly vanish on the green plaza, while Rare and Epic barely changed
  (before and after captures at the same spot). The white half of a burst is what reads against
  the grass, the coloured half what reads against a base's light floor, so each burst keeps both.
*/
function rankedSpec(r: number, tint: string): Spec {
  return {
    count: 22 + 8 * r, life: 0.9 + 0.08 * r,
    size: [0.14 + 0.02 * r, 0.28 + 0.03 * r], end: 0.45,
    speed: [1.4 + 0.15 * r, 2.8 + 0.3 * r], gravity: 0.35, radius: 0.25,
    glow: r >= 4, colors: ['#ffffff', tint]
  }
}

/*
  The sentry's bolt lands: sparks thrown fast off the thief, gone in half a second.
  Kenney's lightning sprite was tried first and read as a puff of white smoke at this size
  (Explorer capture, 2 Nov); small sharp stars moving fast read as sparks. Added light, not
  paint: tinted sparks in alpha sank into the green field.
*/
const ZAP: Spec = { count: 30, life: 0.55, size: [0.16, 0.34], end: 0.4, speed: [2.0, 4.5], gravity: 0.2, radius: 0.15, glow: true, colors: ['#ffffff', '#ffd84d'] }

/*
  How many bursts of one kind can play at once.

  One emitter per channel means a new burst restarts the one still playing, which is right for
  a crate (the newer moment is the one being watched) and wrong at the fuser: on a busy plaza
  several players fuse in the same seconds, each fusion is instant, and each one's stars and
  puff must play out in full beside the others, never cut by them (founder, 17 Nov 2026: the
  machine running flat out is the point; mixed colours are fine, cut bursts are not). Six of
  each: only a seventh fusion inside two seconds would take over the oldest, and six Epic-sized
  bursts stay far under the live-particle allowance.
*/
const POOL: Record<Channel, number> = { steal: 1, crate: 1, zap: 1, fuse: 6, boss: 1, steam: 6 }
const shots = new Map<Channel, Shot[]>()
/** Shapes setup has not named yet; the first crate burst ends the round, having named its own. */
const warm = (Object.keys(SPRITES) as Sprite[]).filter((k) => k !== 'star')

function fire(channel: Channel, at: Vector3, s: Spec): void {
  const pool = shots.get(channel)
  if (pool === undefined || pool.length === 0) return
  const now = Date.now()
  // A free emitter if there is one; otherwise the one fired longest ago.
  let c = pool[0]
  for (const x of pool) {
    if (now - x.firedAt >= x.busyMs) { c = x; break }
    if (x.firedAt < c.firedAt) c = x
  }
  c.firedAt = now
  c.busyMs = Math.round((s.life + WAVE_GAP * ((s.waves ?? 1) - 1)) * 1000) + 200
  if (channel === 'crate') warm.length = 0
  const t = Transform.getMutableOrNull(c.e)
  if (t === null) return
  t.position = Vector3.create(at.x, at.y, at.z)
  t.rotation = s.fountain !== undefined ? UP : FLAT
  c.next = look(s)
  c.wait = REPLAY_TICKS - 1
  ParticleSystem.createOrReplace(c.e, { ...c.next, playbackState: PBParticleSystem_PlaybackState.PS_STOPPED })
}

/*
  The reveal's glitter is a continuous emitter: it runs for as long as the piece is held up.
  It hangs off the camera like the piece, in its local space, so it stays around the piece
  wherever the camera turns.
*/
let glitter: Entity | null = null
/** Same distance as the piece in `reveal-toy.ts`. */
const GLITTER_Z = 1.15
/**
 * Particles a second by rarity: nothing for a Common, a few for an Uncommon, then rising with
 * each tier. Uncommon had none until 3 Nov, so it was revealed exactly like a Common.
 */
const GLITTER_RATE = [0, 6, 14, 26, 40, 56, 80]

const GLITTER: PBParticleSystem = {
  loop: true, rate: 0, maxParticles: 120, lifetime: 1.1,
  gravity: -0.02,
  initialSize: { start: 0.03, end: 0.085 },
  sizeOverTime: { start: 1, end: 0 },
  initialVelocitySpeed: { start: 0.03, end: 0.12 },
  shape: ParticleSystem.Shape.Box({ size: Vector3.create(1.3, 0.95, 0.1) }),
  texture: { src: SPRITES.star.src },
  blendMode: PBParticleSystem_BlendMode.PSB_ALPHA,
  billboard: true,
  simulationSpace: PBParticleSystem_SimulationSpace.PSS_LOCAL,
  playbackState: PBParticleSystem_PlaybackState.PS_STOPPED
}

/*
  The air during a rush, the sixth emitter. The rush repaints the whole field, so its air
  follows the player rather than standing over the plaza: a box around them, carried by their
  avatar, whose particles stay where they were born (world space), so walking moves through
  them instead of dragging them along. Three heights: born at the feet and rising (embers,
  bubbles, motes), born overhead and falling (glitter, confetti, digital rain), or hanging in
  the air around them (stars, wisps). Gravity alone carries each one; the box's own throw is
  a few centimetres a second.

  It shares nothing with the bursts, and the boss's rage borrows it (`startBossRage`): a rush and
  a raid never run together (`server/raid.ts` skips a slot during a rush, `server/events.ts`
  opens no rush while the boss is up).
*/
type Weather = {
  rate: number
  life: number
  size: [number, number]
  end: number
  gravity: number
  from: 'ground' | 'sky' | 'air'
  glow?: boolean
  colors: [string, string]
  fade?: string
  sprite?: Sprite
}

const WEATHER: Record<number, Weather> = {
  1: { rate: 54, life: 5, size: [0.08, 0.16], end: 0.8, gravity: 0.05, from: 'sky', colors: ['#ffffff', '#ffd700'] },
  5: { rate: 42, life: 3.2, size: [0.2, 0.38], end: 0.2, gravity: -0.06, from: 'ground', glow: true, colors: ['#ffb300', '#ff5722'], fade: '#b3261e', sprite: 'flame' },
  9: { rate: 35, life: 3.5, size: [0.2, 0.4], end: 1.4, gravity: -0.015, from: 'air', glow: true, colors: ['#9b3dbb', '#d38cf0'], sprite: 'swirl' },
  6: { rate: 58, life: 2.4, size: [0.08, 0.18], end: 0.5, gravity: 0, from: 'air', glow: true, colors: ['#ffffff', '#b48cff'] },
  7: { rate: 48, life: 5, size: [0.08, 0.16], end: 0.8, gravity: 0.045, from: 'sky', colors: ['#151515', '#ffffff'] },
  8: { rate: 35, life: 3.5, size: [0.12, 0.26], end: 1.6, gravity: -0.035, from: 'ground', glow: true, colors: ['#7fff00', '#c6ff5e'], sprite: 'ring' },
  10: { rate: 38, life: 3, size: [0.3, 0.55], end: 0.5, gravity: -0.09, from: 'ground', glow: true, colors: ['#ffffff', '#ffe9a8'], sprite: 'streak' },
  11: { rate: 54, life: 4.5, size: [0.1, 0.2], end: 0.9, gravity: 0.1, from: 'sky', colors: ['#ffee00', '#ff00ff'], fade: '#00ffff' },
  12: { rate: 80, life: 1.6, size: [0.3, 0.6], end: 0.6, gravity: 0.45, from: 'sky', glow: true, colors: ['#00e5ff', '#9ff6ff'], sprite: 'streak' },
  13: { rate: 29, life: 4, size: [0.35, 0.6], end: 1.5, gravity: -0.01, from: 'air', colors: ['#86ffd0', '#e6fff6'], sprite: 'puff' }
}

/**
 * The side of the box of air around the player, and the height and thickness of each layer above
 * their feet. A 22 metre box spread the same air too thin to read, and glitter born at six metres
 * spent its life over the player's head (captures, 3 Nov).
 */
const AIR_SIDE = 16
const LAYER: Record<Weather['from'], { y: number; h: number }> = {
  ground: { y: 0.3, h: 0.5 },
  sky: { y: 4.5, h: 1 },
  air: { y: 2.8, h: 5 }
}

let air: Entity | null = null
let airTheme = -1

function weatherLook(w: Weather): PBParticleSystem {
  const layer = LAYER[w.from]
  const sprite = SPRITES[w.sprite ?? 'star']
  return {
    loop: true, rate: w.rate, maxParticles: Math.ceil(w.rate * w.life * 1.2), lifetime: w.life,
    gravity: w.gravity,
    initialSize: { start: w.size[0] * sprite.spark, end: w.size[1] * sprite.spark },
    sizeOverTime: { start: 1, end: w.end },
    initialVelocitySpeed: { start: 0.02, end: 0.12 },
    shape: ParticleSystem.Shape.Box({ size: Vector3.create(AIR_SIDE, layer.h, AIR_SIDE) }),
    initialColor: { start: rgba(w.colors[0]), end: rgba(w.colors[1]) },
    colorOverTime: { start: rgba('#ffffff'), end: rgba(w.fade ?? '#ffffff', 0) },
    texture: { src: sprite.src },
    blendMode: w.glow === true ? PBParticleSystem_BlendMode.PSB_ADD : PBParticleSystem_BlendMode.PSB_ALPHA,
    billboard: true,
    simulationSpace: PBParticleSystem_SimulationSpace.PSS_WORLD,
    playbackState: PBParticleSystem_PlaybackState.PS_PLAYING
  }
}

export function setupVfx(): void {
  for (const channel of Object.keys(POOL) as Channel[]) {
    const pool: Shot[] = []
    for (let i = 0; i < POOL[channel]; i++) {
      const e = engine.addEntity()
      Transform.create(e, { position: PARKED })
      const next = look(ZAP)
      ParticleSystem.create(e, { ...next, playbackState: PBParticleSystem_PlaybackState.PS_STOPPED })
      pool.push({ e, wait: -1, next, firedAt: 0, busyMs: 0 })
    }
    shots.set(channel, pool)
  }

  const g = engine.addEntity()
  Transform.create(g, { parent: engine.CameraEntity, position: Vector3.create(0, 0, GLITTER_Z) })
  ParticleSystem.create(g, GLITTER)
  glitter = g

  const a = engine.addEntity()
  Transform.create(a, { parent: engine.PlayerEntity, position: Vector3.create(0, LAYER.air.y, 0) })
  ParticleSystem.create(a, { ...weatherLook(WEATHER[1]), playbackState: PBParticleSystem_PlaybackState.PS_STOPPED })
  air = a

  // Names each shape once on the parked crate channel, one a tick, so both clients have every
  // texture before the first moment that wants it (see HOW A BURST IS FIRED).
  engine.addSystem(() => {
    const crateShot = shots.get('crate')?.[0]
    if (warm.length > 0 && crateShot !== undefined && crateShot.wait < 0) {
      const sprite = warm.shift()!
      ParticleSystem.createOrReplace(crateShot.e, { ...look({ ...ZAP, sprite }), playbackState: PBParticleSystem_PlaybackState.PS_STOPPED })
    }
    for (const c of [...shots.values()].flat()) {
      if (c.wait < 0) continue
      if (c.wait > 0) { c.wait -= 1; continue }
      c.wait = -1
      ParticleSystem.createOrReplace(c.e, { ...c.next, playbackState: PBParticleSystem_PlaybackState.PS_PLAYING })
    }
  })
}

/**
 * The crate bursts open at `at`. Firing again before the last one finished restarts it at the
 * new place: the newer moment is the one being watched.
 */
export function crateBurst(crateId: number, at: Vector3): void {
  const b = crate(crateId)
  const themed = b.theme >= 0 ? themeSpec(b.theme, 34 + 8 * b.tier) : null
  fire('crate', at, themed ?? tierSpec(b.tier, b.color))
}

/** Hot goods landing in a hand that is not their owner's, in the piece's colour, as big as its rarity. */
export function stealBurst(rarityId: number, hex: string, at: Vector3): void {
  fire('steal', at, rankedSpec(rarityId, hex))
}

export function zapBurst(at: Vector3): void {
  fire('zap', at, ZAP)
}

/*
  A fusion seen from the plaza. The maker gets the reveal in front of their camera; everyone
  else only had a line in the feed. Stars now spring from the top of the floating ball and rain
  back around it, in the new piece's colour, more of them and in two waves as its rarity
  climbs, so a Legendary fused across the plaza is a thing people turn towards.

  Born above the machine, not inside it: born inside, they spent their whole life hidden from
  every side of the plaza (side capture, 3 Nov). Painted in the rarity's full colour, never
  added light or white: from the plaza the machine stands against the sky, and added white over
  a cloud showed nothing at all (third person capture, 3 Nov).
*/
/** Just over the funnels' rims, in the machine's units (`tools/model/build-fuser.py`, FUNNEL_TOP 2.86). */
const FUSE_TOP = 3.05

export function fuseBurst(rarityId: number, hex: string): void {
  const r = Math.max(0, Math.min(6, rarityId))
  const s = rankedSpec(r, hex)
  fire('fuse', Vector3.create(FUSION_POS.x, FUSE_TOP * FUSION_ECHELLE, FUSION_POS.z), {
    ...s, count: 30 + 12 * r, waves: r >= 4 ? 2 : 1, life: 1.8,
    // Bigger and denser than a theft: it is watched from across the plaza, thirteen metres and more.
    size: [0.26, 0.5], end: 0.5,
    // A crown that opens wide and rains down the machine, not a jet: the records board hangs
    // over the machine, and from the belt side it cut a jet off a metre above the ball.
    speed: [2.2, 3.6], gravity: 0.6, fountain: 38, radius: 0.35, glow: false, colors: [hex, hex]
  })
}

/*
  The fuser's chimney breathes, all the time, a little.

  The machine used to carry a floating ball whose movement was what caught the eye from the side
  of the plaza: peripheral vision is poor at detail and colour and very good at motion. The steam
  takes that job: a slow wisp, a few puffs a second, light grey on the sky. At a fusion the chimney
  blows a real puff on top of it, on its own channel so the stars over the funnels are not cut.
*/
const STEAM_RATE = 3
const STEAM_LIFE = 2.6
export function startFuserSteam(at: Vector3): void {
  const e = engine.addEntity()
  Transform.create(e, { position: at, rotation: UP })
  const sprite = SPRITES.puff
  ParticleSystem.create(e, {
    loop: true, rate: STEAM_RATE, maxParticles: Math.ceil(STEAM_RATE * STEAM_LIFE * 1.3), lifetime: STEAM_LIFE,
    gravity: -0.06,
    initialSize: { start: 0.18 * sprite.spark, end: 0.26 * sprite.spark },
    sizeOverTime: { start: 1, end: 2.6 },
    initialVelocitySpeed: { start: 0.35, end: 0.7 },
    shape: ParticleSystem.Shape.Cone({ angle: 10, radius: 0.12 }),
    initialColor: { start: rgba('#f5f5f2', 0.75), end: rgba('#dcdcd8', 0.6) },
    colorOverTime: { start: rgba('#ffffff'), end: rgba('#ffffff', 0) },
    texture: { src: sprite.src },
    blendMode: PBParticleSystem_BlendMode.PSB_ALPHA,
    billboard: true,
    simulationSpace: PBParticleSystem_SimulationSpace.PSS_WORLD,
    playbackState: PBParticleSystem_PlaybackState.PS_PLAYING
  })
}

export function steamPuff(at: Vector3): void {
  fire('steam', at, {
    count: 22, life: 1.7, size: [0.35, 0.6], end: 2.4, speed: [1.6, 3.2], gravity: -0.25, fountain: 18, radius: 0.15,
    colors: ['#ffffff', '#d9d9d4'], sprite: 'puff'
  })
}

/*
  The boss's moments, on their own emitter so a crate opened mid-fight never cuts a slam short.
  Dust thrown flat from its feet when it lands and each time it slams, out to about the four
  metres of the disc the slam was announced with (a cone opened to 84 degrees throws nearly
  flat); stars when it falls; a dark cloud it sinks into when it walks away.
*/
function bossDust(rage: boolean): Spec {
  return {
    count: 40, life: 0.85, size: [0.7, 1.2], end: 1.8, speed: [3.4, 5.0], gravity: -0.05, fountain: 84, radius: 1.2,
    colors: rage ? ['#c0603f', '#7d3a2a'] : ['#b3a58c', '#7d7262'], sprite: 'puff'
  }
}

export function bossSlamBurst(x: number, z: number, rage: boolean): void {
  fire('boss', Vector3.create(x, 0.15, z), bossDust(rage))
}

export function bossLandBurst(x: number, z: number): void {
  fire('boss', Vector3.create(x, 0.15, z), { ...bossDust(false), count: 46, speed: [4.2, 6.0] })
}

export function bossDeathBurst(x: number, y: number, z: number): void {
  fire('boss', Vector3.create(x, y, z), {
    count: 60, waves: 3, life: 1.8, size: [0.26, 0.52], end: 0.5, speed: [5, 9], gravity: 0.9, fountain: 40, radius: 1.0,
    glow: true, colors: ['#ff4d5e', '#ffd166']
  })
}

export function bossLeaveBurst(x: number, z: number): void {
  fire('boss', Vector3.create(x, 0.3, z), {
    count: 30, life: 1.3, size: [0.5, 0.9], end: 1.6, speed: [0.8, 2.0], gravity: -0.25, radius: 1.4,
    colors: ['#5a4a52', '#2f2a30'], sprite: 'puff'
  })
}

/*
  The rage at half life: embers rising off the boss and trailing behind it as it chases, on the
  air's emitter, carried by the boss instead of the player for as long as the rage lasts.
*/
let bossAura = false

function rageLook(): PBParticleSystem {
  const sprite = SPRITES.flame
  return {
    loop: true, rate: 36, maxParticles: 60, lifetime: 1.2,
    gravity: -0.35,
    initialSize: { start: 0.2 * sprite.spark, end: 0.38 * sprite.spark },
    sizeOverTime: { start: 1, end: 0.3 },
    initialVelocitySpeed: { start: 0.2, end: 0.7 },
    shape: ParticleSystem.Shape.Box({ size: Vector3.create(2.8, 1.6, 2.8) }),
    initialColor: { start: rgba('#ff6b2d'), end: rgba('#ffd166') },
    colorOverTime: { start: rgba('#ffffff'), end: rgba('#b3261e', 0) },
    texture: { src: sprite.src },
    blendMode: PBParticleSystem_BlendMode.PSB_ADD,
    billboard: true,
    simulationSpace: PBParticleSystem_SimulationSpace.PSS_WORLD,
    playbackState: PBParticleSystem_PlaybackState.PS_PLAYING
  }
}

/** Embers off `host`, the boss's root, until `stopBossRage`. A running rush keeps its air. */
export function startBossRage(host: Entity): void {
  if (air === null || airTheme >= 0 || bossAura) return
  const t = Transform.getMutableOrNull(air)
  if (t === null) return
  t.parent = host
  t.position = Vector3.create(0, -0.4, 0)
  bossAura = true
  ParticleSystem.createOrReplace(air, rageLook())
}

export function stopBossRage(): void {
  if (air === null || !bossAura) return
  bossAura = false
  ParticleSystem.createOrReplace(air, { ...rageLook(), playbackState: PBParticleSystem_PlaybackState.PS_STOPPED })
  const t = Transform.getMutableOrNull(air)
  if (t === null) return
  t.parent = engine.PlayerEntity
  t.position = Vector3.create(0, LAYER.air.y, 0)
}

/** The rush's air around the player, for as long as the rush runs. */
export function startRushAir(theme: number): void {
  if (air === null || theme === airTheme) return
  stopBossRage()
  const w = WEATHER[theme]
  if (w === undefined) { stopRushAir(); return }
  airTheme = theme
  const t = Transform.getMutableOrNull(air)
  if (t !== null) t.position = Vector3.create(0, LAYER[w.from].y, 0)
  ParticleSystem.createOrReplace(air, weatherLook(w))
}

export function stopRushAir(): void {
  if (air === null || airTheme < 0) return
  const w = WEATHER[airTheme]
  airTheme = -1
  if (w !== undefined) ParticleSystem.createOrReplace(air, { ...weatherLook(w), playbackState: PBParticleSystem_PlaybackState.PS_STOPPED })
}

/** Glitter around the revealed piece, in its colour, as dense as its rarity deserves. */
export function startGlitter(hex: string, rarityId: number): void {
  if (glitter === null) return
  const rate = GLITTER_RATE[Math.max(0, Math.min(GLITTER_RATE.length - 1, rarityId))]
  if (rate <= 0) return
  ParticleSystem.createOrReplace(glitter, {
    ...GLITTER,
    rate,
    initialColor: { start: rgba('#ffffff'), end: rgba(hex) },
    colorOverTime: { start: rgba('#ffffff'), end: rgba('#ffffff', 0) },
    playbackState: PBParticleSystem_PlaybackState.PS_PLAYING
  })
}

export function stopGlitter(): void {
  if (glitter === null) return
  const ps = ParticleSystem.getOrNull(glitter)
  if (ps === null || ps.playbackState === PBParticleSystem_PlaybackState.PS_STOPPED) return
  ParticleSystem.createOrReplace(glitter, { ...GLITTER })
}

