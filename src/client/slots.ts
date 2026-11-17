import { TOY, plasticDe } from './toy'
import { place3DText, LISIBLE_3D } from './texte3d'
import {
  engine, Transform, MeshRenderer, Material, TextShape, Billboard, BillboardMode, Entity,
  PointerEvents, PointerEventType, InputAction, inputSystem, Tween, TweenSequence, TweenLoop, EasingFunction, timers
} from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { BASE_SIDE, SCENE_SIDE, snapToGrid, invalidReason, freeSpotNear } from '../shared/schemas'
import { room } from '../shared/messages'
import { Plot } from '../shared/schemas'
import { myClientAddress, theftView } from './theft'
import { welcomeView } from './welcome'
import { sendOrHold } from './intent'
import { poseView } from './pose'
import { moveTo } from './deplacer'



export const slotView = { active: false, valid: false, reason: '', auto: false }

let fantome: Entity
let label: Entity
let glyphes: Entity | null = null
let autres: Array<{ x: number; z: number }> = []
/** Where the other bases stand, as the server last said. Read by `travel.ts` on arrival. */
export function basesConnues(): Array<{ x: number; z: number }> { return autres }
/** Whether the server has said where the other bases are, at least once this session. */
let basesRecues = false
export function basesConnuesRecues(): boolean { return basesRecues }
/** Vrai quand le marqueur s'est allume tout seul, faux quand le joueur l'a demande. */
let auto = false

export function togglePlacing(): void {
  slotView.active = !slotView.active
  auto = false
  slotView.auto = false
  if (!slotView.active) {
    const t = Transform.getMutableOrNull(fantome)
    if (t !== null) t.scale = Vector3.create(0, 0, 0)
    // While BUILD HERE bursts, the label stays up; the system takes it down when the burst ends.
    const e = Transform.getMutableOrNull(label)
    if (e !== null && exitUntil === 0) e.scale = Vector3.create(0, 0, 0)
  }
}

/*
  BUILD HERE, said with the whole body (founder, 17 Nov 2026: much bigger, and a juicy
  animation from game design, not a random one).

  Three beats, from the game-feel canon ("Juice it or lose it", Jonasson and Purho, 2012) and
  Disney's principles of animation (squash and stretch, anticipation, overlapping action):
  - it ENTERS when the square turns green: the letters pop in one after another, left to right,
    overshooting to 125% before settling, so the words write themselves in one stroke;
  - it LOOPS while the player stands on the square: a wave runs through the letters, each one
    jumps in turn, stretching on the way up and squashing as it lands, and the last letter
    lands on the hammer's strike on the E button (`SWING_MS` in ui.tsx, the strike 180 ms
    before the end of the period in `Pouce`, ui-kit.tsx): the world and the button beat
    together and point at the same press;
  - it BURSTS on the press: every letter swells and vanishes in a quarter of a second, the
    payoff just before the building stands up.
  The refusal stays still, in the platform font: a refusal has nothing to celebrate. Each
  letter is three entities (pop, jump, squash: one entity carries one tween), set once and
  played by the client, so nothing is written per frame.
*/
const BUILD_HERE_SIZE = 0.84
const WAVE_PERIOD_MS = 1200
const STRIKE_BEFORE_END_MS = 180
const WAVE_STEP_MS = 60
const POP_STEP_MS = 40
const JUMP_HEIGHT = 0.25
const JUMP_MS = 150
let waveGen = 0
let popHolders: Entity[] = []
let exitUntil = 0
/** The words the marker's glyphs currently spell, '' for none. */
let glyphText = ''

function animateBuildHere(root: Entity): void {
  waveGen += 1
  const gen = waveGen
  const quads: Array<{ e: Entity; x: number }> = []
  for (const [e, t] of engine.getEntitiesWith(Transform)) if (t.parent === root) quads.push({ e, x: t.position.x })
  quads.sort((a, b) => a.x - b.x)
  const n = quads.length
  const now = Date.now()
  const one = Vector3.One()
  const big = Vector3.create(1.25, 1.25, 1.25)
  popHolders = []
  quads.forEach((q, i) => {
    const qt = Transform.getMutable(q.e)
    const s = Vector3.create(qt.scale.x, qt.scale.y, qt.scale.z)
    const pop = engine.addEntity()
    Transform.create(pop, { parent: root, position: Vector3.create(q.x, 0, 0), scale: Vector3.Zero() })
    const jump = engine.addEntity()
    Transform.create(jump, { parent: pop })
    qt.parent = jump
    qt.position = Vector3.Zero()
    popHolders.push(pop)
    // Enter: wait for its turn, pop past full size, settle.
    Tween.create(pop, { mode: Tween.Mode.Scale({ start: Vector3.Zero(), end: Vector3.Zero() }), duration: 1 + POP_STEP_MS * i, easingFunction: EasingFunction.EF_LINEAR })
    TweenSequence.create(pop, {
      sequence: [
        { mode: Tween.Mode.Scale({ start: Vector3.Zero(), end: big }), duration: 180, easingFunction: EasingFunction.EF_EASEOUTBACK },
        { mode: Tween.Mode.Scale({ start: big, end: one }), duration: 140, easingFunction: EasingFunction.EF_EASEOUTQUAD }
      ]
    })
    // Loop: this letter lands WAVE_STEP_MS per letter before the last one, which lands on the strike.
    const landAt = WAVE_PERIOD_MS - STRIKE_BEFORE_END_MS - WAVE_STEP_MS * (n - 1 - i)
    const delay = (((landAt - 2 * JUMP_MS - (now % WAVE_PERIOD_MS)) % WAVE_PERIOD_MS) + WAVE_PERIOD_MS) % WAVE_PERIOD_MS
    timers.setTimeout(() => { if (gen === waveGen && Transform.has(jump)) startLetterJump(jump, q.e, s) }, delay)
  })
}

function startLetterJump(jump: Entity, quad: Entity, s: Vector3): void {
  const rest = Vector3.Zero()
  const up = Vector3.create(0, JUMP_HEIGHT, 0)
  Tween.createOrReplace(jump, { mode: Tween.Mode.Move({ start: rest, end: up }), duration: JUMP_MS, easingFunction: EasingFunction.EF_EASEOUTQUAD })
  TweenSequence.createOrReplace(jump, {
    sequence: [
      { mode: Tween.Mode.Move({ start: up, end: rest }), duration: JUMP_MS, easingFunction: EasingFunction.EF_EASEINQUAD },
      { mode: Tween.Mode.Move({ start: rest, end: rest }), duration: WAVE_PERIOD_MS - 2 * JUMP_MS, easingFunction: EasingFunction.EF_LINEAR }
    ],
    loop: TweenLoop.TL_RESTART
  })
  // Stretched on the way up, squashed as it lands, then back with a little overshoot.
  const k = (x: number, y: number): Vector3 => Vector3.create(s.x * x, s.y * y, s.z)
  Tween.createOrReplace(quad, { mode: Tween.Mode.Scale({ start: k(1, 1), end: k(0.88, 1.18) }), duration: JUMP_MS, easingFunction: EasingFunction.EF_EASEOUTQUAD })
  TweenSequence.createOrReplace(quad, {
    sequence: [
      { mode: Tween.Mode.Scale({ start: k(0.88, 1.18), end: k(1, 1) }), duration: JUMP_MS, easingFunction: EasingFunction.EF_EASEINQUAD },
      { mode: Tween.Mode.Scale({ start: k(1, 1), end: k(1.22, 0.78) }), duration: 70, easingFunction: EasingFunction.EF_EASEOUTQUAD },
      { mode: Tween.Mode.Scale({ start: k(1.22, 0.78), end: k(1, 1) }), duration: 160, easingFunction: EasingFunction.EF_EASEOUTBACK },
      { mode: Tween.Mode.Scale({ start: k(1, 1), end: k(1, 1) }), duration: WAVE_PERIOD_MS - 2 * JUMP_MS - 230, easingFunction: EasingFunction.EF_LINEAR }
    ],
    loop: TweenLoop.TL_RESTART
  })
}

/*
  The same press turns the camera towards the free square, so the gold arrow over it comes into
  the frame. Only on the press, never on its own: a camera that moves without the player asking
  disorients, and stepping onto a refused square happens all the time while walking (founder,
  18 Nov 2026: the camera turns when they press BUILD on a red marker).
*/
function turnTowardsFreeSquare(): void {
  const me = Transform.getOrNull(engine.PlayerEntity)
  const spot = nearestFreeSquare()
  if (me === null || spot === null) return
  moveTo('follow the arrow', Vector3.create(me.position.x, me.position.y, me.position.z), Vector3.create(spot.x, 1.2, spot.z))
}

/*
  A press on a refused square does not build (founder, 18 Nov 2026): FOLLOW THE ARROW shakes
  sideways, the "no" every player knows from a rejected password field, and points the player to
  the gold arrow over the nearest free square. The whole word shakes, on its own root, so the
  letters' entrance, wave and squash keep running underneath.
*/
export function shakeMarkerText(): void {
  turnTowardsFreeSquare()
  if (glyphes === null || glyphText !== 'FOLLOW THE ARROW') return
  const at = (x: number): Vector3 => Vector3.create(x, 0, 0)
  Tween.createOrReplace(glyphes, { mode: Tween.Mode.Move({ start: at(0), end: at(0.22) }), duration: 60, easingFunction: EasingFunction.EF_EASEOUTQUAD })
  TweenSequence.createOrReplace(glyphes, {
    sequence: [
      { mode: Tween.Mode.Move({ start: at(0.22), end: at(-0.22) }), duration: 90, easingFunction: EasingFunction.EF_EASEQUAD },
      { mode: Tween.Mode.Move({ start: at(-0.22), end: at(0.14) }), duration: 80, easingFunction: EasingFunction.EF_EASEQUAD },
      { mode: Tween.Mode.Move({ start: at(0.14), end: at(0) }), duration: 70, easingFunction: EasingFunction.EF_EASEOUTQUAD }
    ]
  })
}

/** The press: every letter swells and vanishes, and the label comes down when they are gone. */
function burstBuildHere(): void {
  if (glyphes === null) return
  waveGen += 1
  const swell = Vector3.create(1.5, 1.5, 1.5)
  for (const p of popHolders) {
    if (!Transform.has(p)) continue
    Tween.createOrReplace(p, { mode: Tween.Mode.Scale({ start: Vector3.One(), end: swell }), duration: 110, easingFunction: EasingFunction.EF_EASEOUTQUAD })
    TweenSequence.createOrReplace(p, { sequence: [{ mode: Tween.Mode.Scale({ start: swell, end: Vector3.Zero() }), duration: 150, easingFunction: EasingFunction.EF_EASEINBACK }] })
  }
  exitUntil = Date.now() + 280
}

/*
  The square a press of the hammer builds on: where the player stands when that is legal,
  otherwise the nearest legal square, the one the beacon stands on (guidage.ts).

  The same search, on the same snapped point and the same list of bases, as the server's
  fallback in `placeBase`, so the base lands where the beacon said it would. Kept until the
  player crosses a grid line or the bases move: the ring search is cheap but the button asks
  for it several times a frame.
*/
let othersVersion = 0
let freeKey = ''
let freeSquare: { x: number; z: number } | null = null
export function nearestFreeSquare(): { x: number; z: number } | null {
  const t = Transform.getOrNull(engine.PlayerEntity)
  if (t === null) return null
  const x = snapToGrid(t.position.x)
  const z = snapToGrid(t.position.z)
  const key = `${x},${z},${othersVersion}`
  if (key !== freeKey) {
    freeKey = key
    freeSquare = freeSpotNear(x, z, SCENE_SIDE, obstacles())
  }
  return freeSquare
}

/** Every other base: my own is never in my way, since placing again moves it. */
function obstacles(): Array<{ x: number; z: number }> {
  const mine = myBasePoint()
  return mine === null
    ? autres
    : autres.filter((a) => Math.abs(a.x - mine.x) > 0.01 || Math.abs(a.z - mine.z) > 0.01)
}

function myBasePoint(): { x: number; z: number } | null {
  const moi = myClientAddress()
  if (moi === '') return null
  for (const [e, p] of engine.getEntitiesWith(Plot)) {
    if (p.ownerId.toLowerCase() !== moi) continue
    const t = Transform.getOrNull(e)
    return t === null ? null : { x: t.position.x, z: t.position.z }
  }
  return null
}

export function setupSlots(): void {
  fantome = engine.addEntity()
  Transform.create(fantome, { position: Vector3.create(0, 0.08, 0), scale: Vector3.create(0, 0, 0) })
  MeshRenderer.setBox(fantome)

  label = engine.addEntity()
  Transform.create(label, { position: Vector3.create(0, 2.2, 0), scale: Vector3.create(0, 0, 0) })
  Billboard.create(label, { billboardMode: BillboardMode.BM_Y })
  /*
    The line a player reads while standing on grass, so it carries its own contrast.

    It was white text at size 3 with nothing behind it, over a bright green field, and the
    owner could not read it while placing a base (5 Sep). A world-space label has no plate to
    sit on, so the platform's own answer is the outline: `outlineWidth` with a dark
    `outlineColor` draws the glyph's own edge, which holds on grass, on lava and on the sky
    alike. The size goes up with it, because this is the one sentence in the game a player
    reads before they own anything.
  */
  TextShape.create(label, {
    // Ces valeurs vivent maintenant dans `LISIBLE_3D`: elles ont ete reglees ici, sur une
    // plainte reelle, et tout le monde les porte depuis (voir la note du 7 Sep dans texte3d.ts).
    text: '', fontSize: 4.2, textColor: Color4.White(), ...LISIBLE_3D
  })

  room.onMessage('basePositions', (d) => {
    autres = d.xs.map((x, i) => ({ x, z: d.zs[i] ?? 0 }))
    basesRecues = true
    othersVersion += 1
  })

  /*
    Un joueur qui n'a pas encore de base voit tout de suite ou elle irait.

    Le marqueur etait une bascule: il fallait deviner qu'une premiere pression le faisait
    apparaitre, puis une seconde le posait. Or a l'arrivee le bouton dit deja POSER TA BASE et
    l'etape 1 du tutoriel aussi: le contexte est sans ambiguite, le marqueur n'a aucune raison
    d'attendre qu'on le demande (proprietaire, 1 Sep). Il s'allume donc de lui-meme tant qu'on
    n'a pas de base, et redevient une bascule ensuite, pour la deplacer.
  */
  engine.addSystem(() => {
    // The press's burst is over: take the letters and the label down.
    if (exitUntil > 0 && Date.now() >= exitUntil) {
      exitUntil = 0
      if (glyphes !== null) { engine.removeEntityWithChildren(glyphes); glyphes = null; glyphText = '' }
      if (!slotView.active) {
        const e = Transform.getMutableOrNull(label)
        if (e !== null) e.scale = Vector3.Zero()
      }
    }
    /*
      Le marqueur qui s'allume tout seul ne dit que OUI, jamais NON.

      Un joueur qui arrive apparait sur le couloir du tapis, qui est justement une bande ou l'on
      ne peut pas construire: la premiere image du jeu etait donc un grand rectangle ROUGE avec
      son motif ecrit deux fois (proprietaire, 2 Sep). Un refus qu'on n'a pas demande n'apprend
      rien, il encombre. Quand il s'allume de lui-meme il ne se montre donc que sur un
      emplacement valide, et c'est son APPARITION qui dit "ici, oui".

      La bascule manuelle, elle, garde le rouge et sa raison: la, le joueur cherche
      deliberement une place et a besoin de savoir pourquoi celle-ci est refusee.
    */
    /*
      And it waits for the server. `basePosee` is false until the wallet answers, so on a fresh
      start the marker lit for a frame or two, with its BUILD HERE over it, in front of a player
      who owns a three-storey base: the first thing the game showed was a lie about itself
      (owner, 5 Sep). `walletRecu` is the difference between "you have no base" and "nobody has
      said yet".
    */
    if (theftView.walletRecu && !welcomeView.open && !theftView.basePosee && !slotView.active && !poseView.pending) {
      slotView.active = true
      auto = true
      slotView.auto = true
    }
    /*
      And it goes OUT by itself. It lit while the wallet had not spoken yet (a fresh
      connection, a server just replaced) and nothing ever turned it off once the wallet
      said "you have a base": the owner stood in front of their own three-storey building
      reading BUILD HERE and a PLACE HERE button (owner, 4 Sep). What lit on a guess is
      put out by the fact.
    */
    if (auto && theftView.basePosee) {
      auto = false
      slotView.auto = false
      slotView.active = false
      const t = Transform.getMutableOrNull(fantome)
      if (t !== null) t.scale = Vector3.Zero()
      const e = Transform.getMutableOrNull(label)
      if (e !== null) e.scale = Vector3.Zero()
      return
    }
    if (!slotView.active) return
    if (!Transform.has(engine.PlayerEntity)) return
    const p = Transform.get(engine.PlayerEntity).position
    const x = snapToGrid(p.x)
    const z = snapToGrid(p.z)

    const reason = invalidReason(x, z, SCENE_SIDE, obstacles())
    slotView.valid = reason === null
    slotView.reason = reason ?? ''

    /*
      The ghost that lights by itself says NO as well now, in red, with the reason.

      It used to show only on a valid spot (2 Sep: the first frame of the game was a red
      rectangle on the belt corridor, where everyone spawns). The playtest of 6 Sep turned
      that around: a player with an inert hammer and no ghost had no idea what was wrong, and
      the owner asked for the red ghost back. The hammer no longer swings on a red ghost, so
      the two together read as one sentence: not here, and this is why.
    */
    const muet = false
    const t = Transform.getMutableOrNull(fantome)
    if (t !== null) {
      t.position = Vector3.create(x, 0.08, z)
      t.scale = muet ? Vector3.Zero() : Vector3.create(BASE_SIDE, 0.16, BASE_SIDE)
    }
    const c = Color4.fromHexString((slotView.valid ? TOY.markerOk : TOY.markerBad) + 'ff')
    Material.setPbrMaterial(fantome, plasticDe(c, 0.7))

    const te = Transform.getMutableOrNull(label)
    if (te !== null) {
      // 3.6 m: the large, jumping text rides clear above the player's own name tag, which hangs
      // over the head at the very spot where the player stands, and above the gold arrow that
      // points the way from a refused square (guidage.ts, 2.75 m) (captures, 18 Nov 2026).
      te.position = Vector3.create(x, 3.6, z)
      te.scale = muet ? Vector3.Zero() : Vector3.create(0.7, 0.7, 0.7)
    }
    /*
      BUILD HERE is written in the game's own face, like everything else the WORLD says.

      The platform font with an outline was readable, and readable was all it was. Look at what
      else is written out there: a base's name and its owner, both in the atlas face through
      `place3DText`. The world speaks in one voice and the interface in another, and this line
      belongs to the world (owner's question, 5 Sep: redundant? It is the opposite, it is what
      makes the two lines look like the same game).

      It costs one quad per letter, nine here, and only while somebody is placing a base. The
      REFUSALS keep the platform font: a reason is a sentence, and prose is exactly what an
      atlas of capitals is not for.
    */
    /*
      What the marker says, in as few words as possible: what to DO (founder, 18 Nov 2026).

      On a square that can be taken, BUILD HERE in gold. On a refused square while placing a first
      base, FOLLOW THE ARROW in red: the gold arrow (guidage.ts) stands over the nearest free
      square, and the press does not build here. The cause is no longer written: "the plaza stays
      open" stated a rule the game never teaches, and the red marker already says "not here". A
      base being MOVED by hand keeps its reason in the platform font: no arrow guides that.
    */
    const wanted = muet ? '' : slotView.valid ? 'BUILD HERE' : slotView.auto ? 'FOLLOW THE ARROW' : ''
    const ts = TextShape.getMutableOrNull(label)
    if (ts !== null) {
      ts.text = slotView.valid || slotView.auto || muet ? '' : slotView.reason
      ts.textColor = c
    }
    if (wanted !== glyphText && exitUntil === 0) {
      // With its letters: removing the root alone left every letter orphaned in the scene.
      if (glyphes !== null) { waveGen += 1; engine.removeEntityWithChildren(glyphes); glyphes = null }
      glyphText = wanted
      if (wanted !== '') {
        glyphes = place3DText(label, [{ texte: wanted, role: wanted === 'BUILD HERE' ? 'money' : 'danger', taille: BUILD_HERE_SIZE }], false)
        animateBuildHere(glyphes)
      }
    }
  })
}

export function placeHere(): void {
  if (!Transform.has(engine.PlayerEntity)) return
  const p = Transform.get(engine.PlayerEntity).position
  const x = snapToGrid(p.x), z = snapToGrid(p.z)
  poseView.pending = true
  sendOrHold(() => { void room.send('claimSlot', { x, z }) })
  burstBuildHere()
  togglePlacing()
}

