import { isMobile } from '@dcl/sdk/platform'
import { Animator, GltfNodeModifiers, engine, Entity, Transform, GltfContainer, GltfContainerLoadingState, LoadingState, MeshRenderer, Material, PBMaterial_PbrMaterial, Tween, TweenSequence, TweenLoop, EasingFunction } from '@dcl/sdk/ecs'
import { crate, mutation, rarityOf, mutationDe, crateImage } from '../shared/loot-table'
import { FLOOR_HEIGHT } from '../shared/schemas'
import { Quaternion, Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { HUE } from './theme'

/**
 * The toy palette, and the one place the world gets its colours from.
 *
 * Twenty-five hex strings were scattered across eight files, and none of them agreed with the
 * five the interface uses. A theme is first of all a palette in ONE place: every surface in the
 * world names a role here, and changing the world's look is editing this file. The five HUD
 * hues are reused where the world and the interface mean the same thing (money, danger), so a
 * green plate on the floor and a green number on screen are the same green.
 *
 * "Toy" in material terms is plastic: no metal, a soft sheen, one flat colour per part, nothing
 * textured. `plastic()` is the only material the world uses, with a glow only where the game
 * already glowed (rarity, sentries). The reference family (vinyl-toy figures, candy colours) is
 * the genre's own register; every mobile leader in our census sits in it.
 */
export const TOY = {
  /** The ground: a play-mat green, matte, the table the toys stand on. */
  ground: '#4eb85a',   // MEASURED against the genre leader's own grass, not guessed: two map captures average #65b261 (S45 V70) and #43a944 (S62 V67); ours sat at S44 V82, paler and lighter than both (owner, 1 Sep). This sits inside their bracket.
  groundEvent: {
    gold: '#b89a3a', lava: '#b4523a', cursed: '#6a4a8f',
    galaxy: '#3a3f7c', yinyang: '#8c8c90', radioactive: '#5c8a2c', divine: '#c8b78a',
    rainbow: '#9a7a9c', cyber: '#2c7a86', phantom: '#6e9a86'
  },
  /**
   * The street: the strip of ground that is not anybody's, running the length of the field.
   *
   * The reference paints its public ground bright red on plain green, which is the loudest
   * contrast available and the reason its map reads at a glance. Ours borrows the CONTRAST,
   * not the hue: a warm clay against the play-mat green, so the strip separates from the lawn
   * without competing with the yellow ramps or the gold of the interface, which are the two
   * things that must stay the brightest objects on screen.
   */
  street: '#c96f4a',
  /**
   * La place: le sol du centre, ou l'on ne construit pas.
   *
   * Meme famille chaude que la rue, plus clair d'un cran. Le meme ton dirait "c'est la rue",
   * une couleur etrangere ferait une tache; un eclaircissement dit "c'est le meme domaine
   * public, en plus large", ce qui est exactement la regle qu'il porte.
   */
  plaza: '#e0906b',
  /** Bases: cream plastic walls, a brighter roof line, primary-colour accents. */
  wallCream: '#f2e9d8',
  slab: '#e6dcc8',
  plinth: '#d9d0bf',
  plinthAway: '#c9c1b2',
  /** The pad every displayed toy stands on: darker than the slab, so a toy has a place, not a spot. */
  socle: '#bfb5a4',
  post: '#f6f1e8',
  lintel: '#ff6b6b',
  /** The ramp is the one bold primary on a base: yellow, so a way up reads from across the plaza. */
  ramp: '#ffd23f',
  rail: '#ff9f43',
  elevator: '#4dabf7',
  /** Glass in a toy is tinted acrylic, still see-through. */
  glass: Color4.create(0.75, 0.9, 1.0, 0.22),
  /** The belt: a red plastic conveyor on cream legs, the runway everything arrives on. */
  belt: '#e63946',
  beltLeg: '#f2e9d8',
  beltRail: '#ffd23f',
  beltPit: '#2b2d42',
  beltRing: '#8d99ae',
  /** Defences and traps share the interface's colours so the world and the HUD agree. */
  sentry: '#4dd2ff',
  trapPlate: '#adb5bd',
  bomb: '#ff4d6d',
  mine: HUE.money,
  shield: Color4.create(0.30, 0.85, 1.0, 0.30),   // a wall you can see, not a haze (owner, 5 Sep: "tres subtil")
  /*
    Vert quand on peut poser, rouge quand on ne peut pas. Rien d'autre a apprendre.

    Le marqueur valide etait en OR, la couleur de la monnaie, qui dans ce jeu veut dire "de
    l'argent" partout ailleurs: sur un rectangle au sol elle ne disait ni oui ni non, juste
    "quelque chose". Le couple vert/rouge est la convention que personne n'a besoin qu'on lui
    explique, et c'est deja celle des deux autres marqueurs, le socle vise et la caisse
    (proprietaire, 1 Sep).
  */
  markerOk: '#4ddc6a',
  markerBad: HUE.danger
} as const

/*
  Every base gets its own accent, from its owner's address, so five buildings are not five
  copies. A judge's first view is the plaza from its edge, and a tester's screenshot of it
  showed identical glass boxes: nothing said whose was whose, or that any was worth walking to.
  The accent is one of eight toy primaries chosen by hashing the address, painted on the ramp,
  the corner posts and the lintel, which are the parts that read from thirty metres. The name
  plate was the only differentiator, and text is the last thing legible at distance.
*/
const ACCENTS = ['#ff6b6b', '#ffd23f', '#4dabf7', '#51cf66', '#ff9f43', '#cc5de8', '#22b8cf', '#f06595'] as const
export function accentDe(address: string): string {
  return ACCENTS[indexAccent(address)]
}
function indexAccent(address: string): number {
  let h = 0
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) >>> 0
  return h % ACCENTS.length
}

/**
 * Which colour-baked models a base wears.
 *
 * The colour is in the FILE, not in a runtime tint. Tinting a loaded model means
 * `GltfNodeModifiers`, which we have never confirmed works on the Godot mobile client, and a
 * base's accent is how a player finds their own building from across the street: it cannot be
 * the thing that silently fails on half the phones. The palette is bounded, eight owner accents
 * and one per skin, and the geometry is a handful of boxes, so one file per colour costs a few
 * kilobytes and removes the risk entirely. Generated by `tools/model/build-storey.js`.
 */
export function modelesDe(p: { ownerId: string; skin: number }): { accent: string; climb: string; verre: string } {
  const suffixe = p.skin > 0 ? `skin-${p.skin}` : String(indexAccent(p.ownerId))
  return {
    accent: `accent-${suffixe}.glb`,
    climb: `climb-${suffixe}.glb`,
    verre: p.skin > 0 ? `glass-skin-${p.skin}.glb` : 'glass.glb'
  }
}

/*
  One flat plastic. `glow` is the emissive intensity, zero for anything that is not lit.

  A glow nobody could see, explained by one line of the rendering doc: "use emissiveColor with
  a DARK albedoColor for maximum glow visibility". Seventeen sites passed the same bright colour
  as albedo and as emissive, so the surface was already at full brightness under the sky and
  the emissive had nowhere to go; the mobile renderer has no bloom to spill it past the edge.
  The tester saw no glow at any rarity, and that was correct rendering of a wrong material.

  So the albedo darkens as the glow rises: at glow 0 the plastic is its own colour, at glow 2
  it is a quarter of it, and the emissive term is what the eye reads. A lit toy is dark
  plastic with the colour coming out of it, which is also what a lit toy looks like.
*/
export function plastic(hex: string, glow = 0): PBMaterial_PbrMaterial {
  const c = Color4.fromHexString(hex.length === 7 ? hex + 'ff' : hex)
  if (glow <= 0) return { albedoColor: c, metallic: 0, roughness: 0.55 }
  /*
    DARK albedo, bright emissive: the platform's own recipe, "use emissiveColor with a dark
    albedoColor for maximum glow visibility" (advanced-rendering docs). This is how the toy
    glows on its own AND how bloom catches it. On 28 Aug I brightened the albedo to fix a
    "no emission" report, which was really the light budget stripping the point lights, not
    the albedo; a bright albedo washed the surface pale and matte and gave bloom no saturated
    colour to bloom (tester screenshot, medium preset, flat yellow toys). Dark albedo carries
    both: self-glow without a light, and a real bloom halo when the preset runs it.
  */
  // A curve that starts near nothing and climbs: a Rare barely glows (0.64), a Secret blazes
  // (7.2). The old 1.2 + 1.2*glow had a 1.2 floor, so a Rare read as bright as a Legendary
  // (tester, 28 Aug). `glow^1.5` is the slow-start ramp, dark albedo the platform's recipe.
  const sombre = 1 / (1 + glow * 1.2)
  return {
    albedoColor: Color4.create(c.r * sombre, c.g * sombre, c.b * sombre, c.a),
    emissiveColor: Color3.create(c.r, c.g, c.b),
    emissiveIntensity: Math.pow(glow, 1.5) * 0.9,
    metallic: 0,
    roughness: 0.45
  }
}

/** The same rule for a colour that already exists as a Color4. */
/*
  A metal and a gem, for the two mutations that are matter, not energy. Gold reads as metal
  and Diamond as a cut gem, by roughness and metallic, not by a neon glow (tester's call, 28
  Aug); the energy mutations (Lava, Galaxy, ...) keep the emissive glow. Same shader, same
  draw call, same cost as the plastic: this is a look choice, not a performance one.
*/
const METAL = new Set<number>([1, 2])   // Gold, Diamond
export function estMetal(mut: number): boolean { return METAL.has(mut) }
export function metalMaterial(hex: string, mut: number, glow = 0): PBMaterial_PbrMaterial {
  const c = Color4.fromHexString(hex.length === 7 ? hex + 'ff' : hex)
  // The mutation gives the SURFACE (metal or gem); the RARITY still gives the glow, added on
  // top. A Mythic Diamond blazes because it is Mythic, not just a dull gem (tester, 28 Aug).
  const eclat = glow <= 0 ? 0 : Math.pow(glow, 1.5) * 0.9
  const emis = { emissiveColor: Color3.create(c.r, c.g, c.b), emissiveIntensity: eclat }
  /*
    Gold reads as gold, not as copper. A pure metal's colour is carried by its reflections,
    and our clients' image lighting is weak, so #ffd700 at metallic 0.95 came out dark
    bronze (tester, 31 Aug). Same cure that already works for Diamond: a lighter albedo and
    a warm emissive FLOOR under the rarity glow, so even a Common Gold glints.
  */
  /*
    The placeholder-era gold, which the tester validated, then a whisper of emissive.

    Two swings taught the window: pure #ffd700 metal under our weak image lighting reads
    copper, and a lightened albedo with a strong emissive floor reads butter, worse still
    on the Low preset. So: the deep gold tone itself, full metal, and an emissive FLOOR low
    enough to anchor the hue on Low without ever washing it (0.18; rarity glow still adds).
  */
  if (mut === 1) {
    return {
      albedoColor: Color4.fromHexString('#f5c518ff'), metallic: 0.9, roughness: 0.32,
      emissiveColor: Color3.create(0.72, 0.52, 0.10), emissiveIntensity: Math.max(0.18, eclat)
    }
  }
  // diamond: very smooth, a little metallic for the highlight, a base sparkle plus rarity glow
  return { albedoColor: c, metallic: 0.25, roughness: 0.05, emissiveColor: Color3.create(c.r, c.g, c.b), emissiveIntensity: Math.max(0.4, eclat) }
}

export function plasticDe(c: Color4, glow = 0): PBMaterial_PbrMaterial {
  const hex = '#' + [c.r, c.g, c.b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')
  const m = plastic(hex, glow)
  if (m.albedoColor !== undefined) m.albedoColor = Color4.create(m.albedoColor.r, m.albedoColor.g, m.albedoColor.b, c.a)
  return m
}

/** Tinted acrylic: the same plastic, see-through. */
export function acrylic(c: Color4): PBMaterial_PbrMaterial {
  return { albedoColor: c, metallic: 0, roughness: 0.15 }
}

/**
 * Where an artist's model goes, and what stands in until it exists.
 *
 * Every visual that will be replaced by a GLB is created through this, so the swap is a file
 * appearing in `assets/toy/` rather than a code change. The primitive is drawn immediately;
 * when the model reports FINISHED the primitive is hidden, and when it reports NOT_FOUND or
 * an error the primitive simply stays. Positions, scales and colliders never move: the model
 * is authored to the primitive's box, which is what the gameplay was measured against.
 *
 * Both entities share the parent's transform: the model is a child at identity, so whatever
 * the artist exports at the primitive's size lands exactly where the primitive was.
 */
export const TOY_DIR = 'assets/toy/'
const montages = new Map<Entity, { modele: Entity; fichier: string; charge?: boolean }>()

/**
 * The mounts still waiting for their GLB, and only those.
 *
 * The arrival watcher used to walk every mount in the world on every frame to ask each one
 * whether its model had landed yet. A model lands once and then stays landed, so at sixty
 * bases that is upwards of a thousand component reads per frame, forever, to learn nothing.
 * A mount joins this set when it is created and leaves it the moment its model is in, which
 * makes the watcher's cost proportional to what is actually loading rather than to how much
 * of the world exists.
 */
const enAttente = new Set<Entity>()

/*
  The mount owns ONE fact about its primitive: whether the GLB has loaded. It never draws the
  stand-in itself. That is the silhouette's job (`rarityShape`), or the caller's, and two
  functions each "guaranteeing" a renderer on the same entity is how a pedestal ended up with
  a cube drawn back over its toy every time the rarity was mounted (invariant 184: one owner
  per fact).
*/
/*
  Per-file normalisation, measured from the GLBs, not assumed.

  The artist contract asks for a unit cube at identity, and the chess set that finally
  filled the item slots (31 Aug) is a marketplace set: pieces about twenty centimetres
  tall, pivot at the base, half of them exported Z-up. The numbers below are computed from
  each file's accessors (audit in tools history): a rotation for the Z-up ones, a scale to
  the unit height, an offset that puts the base on the stand-in's floor at -0.5. A file
  not listed mounts at identity, which is the contract's default.
*/
export const FIT: Record<string, { scale: number; dy: number; rotX: number; clip?: string }> = {
  'item-0.glb': { scale: 5.545, dy: -0.49, rotX: 0 },  // pion: 0.09 x 0.17 x 0.09 m (noeud applique)
  // Order follows CHESS POINTS, because players know them: pawn 1, knight 3, bishop 3+,
  // rook 5, queen 9, king beyond price. A rook sold as Uncommon under a Rare knight read
  // as a mistake to anyone who plays (owner, 1 Sep), and rarity ladders only work when
  // they agree with what the audience already believes.
  'item-1.glb': { scale: 4.885, dy: -0.49, rotX: 0 },  // cavalier: 0.07 x 0.20 x 0.12 m (noeud applique)
  'item-2.glb': { scale: 4.455, dy: -0.49, rotX: 0 },  // fou: 0.09 x 0.22 x 0.10 m (noeud applique)
  'item-3.glb': { scale: 5.814, dy: -0.49, rotX: 0 },  // tour: 0.09 x 0.17 x 0.09 m (noeud applique)
  'item-4.glb': { scale: 4.127, dy: -0.49, rotX: 0 },  // dame: 0.10 x 0.23 x 0.10 m (noeud applique)
  'item-5.glb': { scale: 4.002, dy: -0.49, rotX: 0 },  // roi: 0.09 x 0.24 x 0.08 m (noeud applique)
  'item-6.glb': { scale: 1, dy: 0, rotX: 0, clip: 'spin' }  // Secret: planet and ring at authored size, the planet spins on its own tilted axis
}

/*
  Baked pieces: `item-<rarity>-<mutation>.glb`, one file per tint (tools/model/build-item-variants.py).

  The mobile client counts UNIQUE materials against its budget and duplicates one for every
  piece tinted through a node modifier, so each exposed piece used to cost a material. Instances
  of one file share theirs: a baked piece costs nothing there however many stand on the field.
  The stand-in silhouette and the hand marker keep the tinted path (few, and the hand is a ghost).
*/
const CUIT = /^item-\d+-\d+\.glb$/
const cuits = new Set<Entity>()
export function itemFile(code: number): string {
  const r = rarityOf(code)
  return `item-${Math.min(6, r)}-${mutationDe(code)}.glb`
}
/** The fit is the rarity model's, whatever tint the file carries. */
function fitKey(fichier: string): string {
  return fichier.replace(/^(item-\d+)-\d+\.glb$/, '$1.glb')
}
function noterCuisson(modele: Entity, fichier: string): void {
  if (CUIT.test(fichier)) {
    cuits.add(modele)
    if (GltfNodeModifiers.has(modele)) GltfNodeModifiers.deleteFrom(modele)
    teintes.delete(modele)
  } else {
    cuits.delete(modele)
  }
}

function applyFit(modele: Entity, fichier: string): void {
  const f = FIT[fitKey(fichier)]
  const t = Transform.getMutableOrNull(modele)
  if (t === null) return
  // A new file is a new occupant: the float of the previous one, and the floor it remembered,
  // must not outlive it. A queen put where a Secret had floated was set back on the Secret's
  // floor (dy 0) instead of her own (-0.49) and hung a metre in the air (owner, 5 Sep).
  if (Tween.has(modele)) { Tween.deleteFrom(modele); TweenSequence.deleteFrom(modele) }
  floatFloor.delete(modele)
  t.position = Vector3.create(0, f?.dy ?? 0, 0)
  t.scale = Vector3.create(f?.scale ?? 1, f?.scale ?? 1, f?.scale ?? 1)
  t.rotation = Quaternion.fromEulerDegrees(f?.rotX ?? 0, 0, 0)
}

export function montable(primitive: Entity, fichier: string): void {
  const modele = engine.addEntity()
  // Child of the stand-in: it inherits position, rotation and scale, then the fit above.
  Transform.create(modele, { parent: primitive })
  applyFit(modele, fichier)
  GltfContainer.create(modele, { src: TOY_DIR + fichier, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  /*
    Animation policy lives in the FIT table. A clip named there loops (the crown spins,
    which is what a Mythic does anyway); a file with clips but no entry gets an Animator
    holding everything OFF, because a model with clips and no Animator autoplays its first
    one, and the treasure chest's first clip is 'close' played at a random moment.
  */
  const fit = FIT[fitKey(fichier)]
  if (fit?.clip !== undefined) {
    Animator.create(modele, { states: [{ clip: fit.clip, playing: true, loop: true }] })
  }
  montages.set(primitive, { modele, fichier })
  noterCuisson(modele, fichier)
  enAttente.add(primitive)
}

/**
 * Swap which model a mount shows. Mutating `src` reloads the GLB on the same entity, which
 * is what a pedestal needs when the item on it changes rarity. A no-op when nothing changed,
 * so calling it from a render loop costs one string compare.
 */
/**
 * A full turn that loops, in three legs of a hundred and twenty degrees.
 *
 * Every turning thing was one tween from zero to a half turn, restarted: a slerp to 180
 * degrees has no shortest way round, so the renderer picked a side, and at the restart the
 * thing SNAPPED back through the other half. Symmetric pieces hid it; a knight, a rook or
 * anything with a front "never finished the turn and clipped back to where it started"
 * (owner, 4 Sep). Three legs under 180 degrees each have one way round, and 360 is the
 * identity, so the restart is seamless.
 */
export function spinLoop(entity: Entity, msPerTurn: number): void {
  const leg = Math.max(1, Math.round(msPerTurn / 3))
  const rot = (deg: number) => Quaternion.fromEulerDegrees(0, deg, 0)
  Tween.createOrReplace(entity, {
    mode: Tween.Mode.Rotate({ start: rot(0), end: rot(120) }),
    duration: leg,
    easingFunction: EasingFunction.EF_LINEAR
  })
  TweenSequence.createOrReplace(entity, {
    sequence: [
      { mode: Tween.Mode.Rotate({ start: rot(120), end: rot(240) }), duration: leg, easingFunction: EasingFunction.EF_LINEAR },
      { mode: Tween.Mode.Rotate({ start: rot(240), end: rot(360) }), duration: leg, easingFunction: EasingFunction.EF_LINEAR }
    ],
    loop: TweenLoop.TL_RESTART
  })
}

export function remonter(primitive: Entity, fichier: string): void {
  const m = montages.get(primitive)
  if (m === undefined) { montable(primitive, fichier); return }
  if (m.fichier === fichier) return
  m.fichier = fichier
  // A new file is a new load: the arrival has to be watched for again.
  if (m.charge === true) { montages.set(primitive, { ...m, charge: false }); enAttente.add(primitive) }
  applyFit(m.modele, fichier)
  noterCuisson(m.modele, fichier)
  const g = GltfContainer.getMutableOrNull(m.modele)
  if (g !== null) g.src = TOY_DIR + fichier
}

/**
 * Coupe l'ombre portee d'un modele monte.
 *
 * `GltfNodeModifiers` avec un chemin vide s'applique a tous les noeuds du fichier. Sert au
 * panneau central, qui flotte au-dessus du tapis et posait une grande dalle d'ombre en
 * travers de la place (proprietaire, 2 Sep).
 */
export function sansOmbre(primitive: Entity): void {
  const m = montages.get(primitive)
  if (m === undefined) return
  GltfNodeModifiers.createOrReplace(m.modele, { modifiers: [{ path: '', castShadows: false }] })
}

/** Take the model off a mount and bring the stand-in back, for a pedestal that emptied. */
/**
 * Take the arrival pop off a mount's model, and leave it at its fitted size.
 *
 * The watcher gives every model that lands a scale overshoot, which is right on a shelf and
 * wrong in the reveal: there the holder is already playing a pop of its own, and the two
 * played one inside the other (owner, 5 Sep: the piece "sans pop satisfaisant").
 */
export function figerMonture(primitive: Entity): void {
  const m = montages.get(primitive)
  if (m === undefined) return
  if (Tween.has(m.modele)) Tween.deleteFrom(m.modele)
  if (TweenSequence.has(m.modele)) TweenSequence.deleteFrom(m.modele)
  const f = FIT[fitKey(m.fichier)]
  const t = Transform.getMutableOrNull(m.modele)
  if (t !== null) t.scale = Vector3.create(f?.scale ?? 1, f?.scale ?? 1, f?.scale ?? 1)
}

/** Whether the GLB on this mount has really landed: the reveal asks before it shows one. */
export function monte(primitive: Entity): boolean {
  return montages.get(primitive)?.charge === true
}

export function demonter(primitive: Entity): void {
  const m = montages.get(primitive)
  if (m === undefined) return
  montages.delete(primitive)
  enAttente.delete(primitive)
  engine.removeEntity(m.modele)
}

/**
 * Seven toys from four primitives, until the artist's models arrive.
 *
 * The engine draws boxes, spheres, planes and cylinders, and a cylinder with a zero top radius
 * is a cone, point up. Two children under a unit-cube parent, each a flat plastic, give every
 * rarity its own silhouette readable from across the plaza:
 *
 *   Common     a marble, plain sphere
 *   Uncommon   stacked blocks: a cube with a smaller cube sat on it
 *   Rare       a party hat on a plate: cone on a disc
 *   Epic       a rocket: cylinder with a cone nose
 *   Legendary  a tree: wide cone on a stem
 *   Mythic     a pagoda: two cones stacked
 *   Secret     a star: sphere with a wide flat ring
 *
 * Every part stays INSIDE the unit cube, y from -0.5 to 0.5. The pedestal puts the cube's
 * bottom face on the slab, so anything below -0.5 is inside the floor, and on a storey above
 * it hangs out through the ceiling of the room underneath: the tester saw the stem of a
 * Legendary and the base of an Epic as coloured pucks on his ground-floor ceiling. The same
 * rule is the artist's contract in assets/toy/README.md, so a model and its stand-in agree.
 *
 * All parts are children of the pedestal entity at unit scale, so the pedestal's own scale
 * (rarity, mutation) sizes the whole toy, and `montable()` still swaps the lot for a GLB the
 * moment the file exists. The pedestal itself stops drawing: it is the parent, not the toy.
 * Two extra entities per pedestal is 8,640 more on a full field, against a cap of 28,800.
 */
const formes = new Map<Entity, { parts: Entity[]; rarete: number }>()

function part(parent: Entity, pos: Vector3, scale: Vector3, kind: 'box' | 'sphere' | 'cone' | 'cyl' | 'disc'): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position: pos, scale })
  if (kind === 'box') MeshRenderer.setBox(e)
  else if (kind === 'sphere') MeshRenderer.setSphere(e)
  else if (kind === 'cone') MeshRenderer.setCylinder(e, 0.5, 0.0)
  else if (kind === 'cyl') MeshRenderer.setCylinder(e, 0.5, 0.5)
  else MeshRenderer.setCylinder(e, 0.5, 0.5)
  return e
}

function silhouette(parent: Entity, rarete: number): Entity[] {
  const V = Vector3.create
  switch (rarete) {
    case 0: return [part(parent, V(0, 0, 0), V(1, 1, 1), 'sphere')]
    case 1: return [part(parent, V(0, -0.25, 0), V(1, 0.5, 1), 'box'), part(parent, V(0.12, 0.25, 0.08), V(0.5, 0.5, 0.5), 'box')]
    case 2: return [part(parent, V(0, -0.35, 0), V(1, 0.3, 1), 'disc'), part(parent, V(0, 0.15, 0), V(0.8, 0.7, 0.8), 'cone')]
    case 3: return [part(parent, V(0, -0.15, 0), V(0.6, 0.7, 0.6), 'cyl'), part(parent, V(0, 0.35, 0), V(0.6, 0.3, 0.6), 'cone')]
    case 4: return [part(parent, V(0, -0.3, 0), V(0.3, 0.4, 0.3), 'cyl'), part(parent, V(0, 0.2, 0), V(1, 0.6, 1), 'cone')]
    case 5: return [part(parent, V(0, 0.25, 0), V(0.8, 0.5, 0.8), 'cone'), part(parent, V(0, -0.25, 0), V(0.8, 0.5, 0.8), 'cone')]
    default: return [part(parent, V(0, 0, 0), V(0.6, 0.6, 0.6), 'sphere'), part(parent, V(0, 0, 0), V(1.3, 0.08, 1.3), 'disc')]
  }
}

/** Give a pedestal (or a hand, or a belt crate) the toy of a rarity, rebuilt only if it changed. */
/*
  The mounted model wears the stand-in's exact material, painted over the whole GLB.

  The chess set is black with a dark baked texture, so mounted pieces lost the one thing
  the silhouettes carried: colour as meaning: rarity's hue, a mutation's dye, gold and
  diamond as metal (tester, 31 Aug: "all the toys are black"). `GltfNodeModifiers` with an
  empty path overrides every node's material, so the same PBR object the silhouette wore
  goes onto the piece. Cached by its own JSON: the writer runs on every pass of the shelf
  loop and the override must not be re-sent for an unchanged toy.
*/
const teintes = new Map<Entity, string>()
/*
  The material each pedestal last asked for, remembered for the load system.

  `rarityShape` runs when the Plot CHANGES, and the GLB finishes seconds later: at flip
  time nobody calls it again, so painting from there alone left every piece black (31 Aug,
  read in the mount logs: the tint line never printed). The shelf loop writes the wish
  here; whoever erases the stand-in paints the model with it.
*/
const dernierMateriau = new Map<Entity, PBMaterial_PbrMaterial>()
export function teindreModele(modele: Entity, materiau: PBMaterial_PbrMaterial): void {
  // A baked piece already wears its colour; a modifier would only cost the phone a material.
  if (cuits.has(modele)) return
  const cle = JSON.stringify(materiau)
  if (teintes.get(modele) === cle) return
  teintes.set(modele, cle)
  // The baked texture is dark; a multiply would keep every piece black. Overriding the
  // texture with the flat white square makes the albedo colour the whole story.
  GltfNodeModifiers.createOrReplace(modele, {
    modifiers: [{
      path: '',
      material: {
        material: {
          $case: 'pbr',
          pbr: { ...materiau, texture: Material.Texture.Common({ src: 'assets/textures/blank.png' }) }
        }
      }
    }]
  })
}

/**
 * La forme TENUE EN MAIN, toujours en primitives, jamais en modele.
 *
 * Un `GltfContainer` ne s'affiche pas sur une entite portee par `AvatarAttach`, ni sur une
 * de ses filles: verifie en jeu le 2 Sep, dans les deux dispositions, la main restait vide
 * pour toutes les raretes. Un `MeshRenderer` s'y affiche, lui: l'anneau rouge du voleur est
 * pose directement sur une entite attachee, et les anciennes silhouettes, qui etaient des
 * filles, se voyaient. Un `TextShape` aussi, c'est l'etiquette au-dessus de la tete, et c'est
 * elle qui a mis sur la voie: elle s'affichait pendant que la piece, elle, ne s'affichait pas.
 *
 * Donc la main garde les silhouettes. Ce sont les "bracelets et boules autour du poignet"
 * d'avant, que le proprietaire a redemandes le 2 Sep ("visuellement c'etait tres bien, on
 * voyait tout de suite qu'on tient un truc"). Sur un socle ou un fantome de pose, ou le
 * modele s'affiche, `rarityShape` reste la regle et n'en dessine aucune.
 */
export function handShape(parent: Entity, rarete: number, materiau: PBMaterial_PbrMaterial): void {
  const cur = formes.get(parent)
  if (cur !== undefined && cur.rarete === rarete) {
    for (const e of cur.parts) Material.setPbrMaterial(e, materiau)
    return
  }
  if (cur !== undefined) for (const e of cur.parts) engine.removeEntity(e)
  const parts = silhouette(parent, Math.max(0, Math.min(rarete, 6)))
  for (const e of parts) Material.setPbrMaterial(e, materiau)
  formes.set(parent, { parts, rarete })
  // Le parent est un contenant: sa propre boite se tiendrait a l'interieur de la forme.
  if (MeshRenderer.has(parent)) MeshRenderer.deleteFrom(parent)
}

export function rarityShape(parent: Entity, rarete: number, materiau: PBMaterial_PbrMaterial): void {
  // A loaded model is the body; the silhouette only stands in while there is none, and the
  // body takes the silhouette's colours: rarity, mutation, metal and glow survive the swap.
  dernierMateriau.set(parent, materiau)
  const monte = montages.get(parent)
  if (monte?.charge === true) { teindreModele(monte.modele, materiau); clearShape(parent); return }
  const cur = formes.get(parent)
  if (cur !== undefined && cur.rarete === rarete) {
    for (const e of cur.parts) Material.setPbrMaterial(e, materiau)
    return
  }
  if (cur !== undefined) for (const e of cur.parts) engine.removeEntity(e)
  /*
    Rarities zero to five ARE the chess set now, and its files always ship, so the old
    fantasy silhouettes only ever appeared as a wrong shape flashing before the piece
    loaded (owner, 1 Sep). Those slots draw nothing while loading: the lit pad holds the
    place and the piece pops in. Six keeps its star, which is not a stand-in but the
    Secret's actual body.
  */
  // Six included since 5 Sep: the Secret is a model now (tools/model/build-secret.py), baked like the rest.
  if (rarete <= 6) { formes.delete(parent); if (MeshRenderer.has(parent)) MeshRenderer.deleteFrom(parent); return }
  const parts = silhouette(parent, rarete)
  for (const e of parts) Material.setPbrMaterial(e, materiau)
  formes.set(parent, { parts, rarete })
  // The parent is a container now: its own box would sit inside the toy.
  if (MeshRenderer.has(parent)) MeshRenderer.deleteFrom(parent)
}

/*
 * Every displayed toy stands on a pad; a mutation colours the pad.
 *
 * The first version drew a disc only under mutated toys, sized with the toy (1.9 times it),
 * to make a mutation a BODY change readable across the plaza. The tester's word for the
 * result was "messy": a floor where some toys had a plate and others had nothing read as
 * inconsistency, not as information, and a Gold Epic's disc was 3.2 m wide on pedestals
 * 3.06 m apart, so neighbouring discs cut into each other. A pastel mutation (Candy) at
 * emissive 1.6 also clipped to plain white.
 *
 * So the pad is a FIXED 1.4 m stand under every occupied slot, never scaled by the toy: pads
 * are 1.66 m apart on the tightest pitch and never touch. Plain toys stand on a neutral pad,
 * darker than the slab; a mutated toy's pad takes the mutation's colour, with an emissive
 * term below 1 so no hue clips to white. The same fact is written for every occupied slot,
 * which is what makes it read as a rule. The toy stands ON the pad, so the pedestal's height
 * includes the pad's thickness (`PEDESTAL_THICKNESS`) and a hair of air above the slab.
 */
export const PEDESTAL_DIAMETER = 1.4
export const PEDESTAL_THICKNESS = 0.08
const socles = new Map<Entity, Entity>()

/** The pad file for a colour: the plain pad, or a lit pad; its pool is `poolFile`. */
export function padFile(mutationHex: string | null): string {
  return mutationHex === null ? 'pad-socle.glb' : `pad-${mutationHex.slice(1, 7).toLowerCase()}.glb`
}
/** Three baked intensities of pool: soft below 1.6 of glow (Rare, Epic), strong below 3 (Legendary, Mythic), blazing above (Secret). */
export function poolTier(glow: number): number { return glow < 1.6 ? 1 : glow < 3 ? 2 : 3 }
function poolFile(mutationHex: string, glow: number): string { return `pool-${mutationHex.slice(1, 7).toLowerCase()}-${poolTier(glow)}.glb` }

/*
  A pad is a FILE per colour (tools/model/build-pads.py), no longer an SDK cylinder with its own
  material. Two reasons. The phone counts one material per SDK primitive, so twelve pads in a
  base were twelve materials from the tightest budget; every pad of one colour now shares one
  file. And the point light that pooled colour on the slab does not render on the mobile client
  before its v1.13.0, so a lit pad carries its pool PAINTED: a translucent disc around it, radial
  falloff, emissive, the fake every mobile game uses for a light on the floor (owner, 5 Sep:
  "la flaque de lumiere est un element relativement important"). The pool is a child of the
  pad in its own file, scaled by the piece's glow the way the light's range grew with it: a
  Rare's pool hugs its pad, a Secret's floods the shelf.
*/
const flaques = new Map<Entity, Entity>()
/** How wide a pool spreads for a glow: the light's range (0.8 + 0.7 glow) over the Rare's. */
function poolScale(glow: number): number { return Math.max(0.8, Math.min(2.4, (0.8 + 0.7 * glow) / 1.36)) }

export function toyPedestal(parent: Entity, size: number, mutationHex: string | null, glow = 0): void {
  let e = socles.get(parent)
  if (e === undefined) { e = engine.addEntity(); socles.set(parent, e) }
  // Child of a parent scaled by `size`: divide, so the pad keeps its world size whatever the toy.
  // The file is authored at world size; its top face is the cube's bottom face, the toy stands on it.
  Transform.createOrReplace(e, {
    parent,
    position: Vector3.create(0, -0.5 - PEDESTAL_THICKNESS / 2 / size, 0),
    scale: Vector3.create(1 / size, 1 / size, 1 / size)
  })
  const src = TOY_DIR + padFile(mutationHex)
  const g = GltfContainer.getMutableOrNull(e)
  if (g === null) GltfContainer.create(e, { src, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  else if (g.src !== src) g.src = src
  let f = flaques.get(e)
  if (mutationHex === null) {
    if (f !== undefined) { engine.removeEntity(f); flaques.delete(e) }
    return
  }
  if (f === undefined) { f = engine.addEntity(); flaques.set(e, f) }
  const k = poolScale(glow)
  Transform.createOrReplace(f, { parent: e, scale: Vector3.create(k, 1, k) })
  const psrc = TOY_DIR + poolFile(mutationHex, glow)
  const pg = GltfContainer.getMutableOrNull(f)
  if (pg === null) GltfContainer.create(f, { src: psrc, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  else if (pg.src !== psrc) pg.src = psrc
}

/*
  Rays, for what is worth crossing the room for.

  The mobile client draws no particles and no bloom; the one glow it draws for everyone is
  geometry. A flat quad of rays (the reveal's own burst texture, alpha-tested, in the
  piece's colour) hangs above the toy and turns slowly: from the plaza edge an Epic reads
  as a crown of light, which is what "the pieces are boring" was asking for (tester, 4 Sep).
  Two entities, one rendered: a holder that spins about the world's up, and the tilted quad
  inside it. Only from Epic up, so the world never fills with crowns.
*/
const RAYS_TEXTURE = 'assets/ui/burst.png'
const RAYS_DIAMETER = 1.9
const rayons = new Map<Entity, Entity>()

function raysMaterial(hex: string, glow: number): PBMaterial_PbrMaterial {
  return {
    texture: Material.Texture.Common({ src: RAYS_TEXTURE }),
    emissiveTexture: Material.Texture.Common({ src: RAYS_TEXTURE }),
    albedoColor: Color4.fromHexString(hex + 'ff'),
    emissiveColor: Color3.fromHexString(hex),
    emissiveIntensity: glow,
    metallic: 0, roughness: 1, specularIntensity: 0,
    transparencyMode: 1, alphaTest: 0.5, castShadows: false
  }
}

/** A spinning crown of rays of `diameter` metres, parented at `position`; returns the holder. */
export function spawnRays(parent: Entity, position: Vector3, diameter: number, hex: string, glow: number, degPerSec: number): Entity {
  const holder = engine.addEntity()
  Transform.create(holder, { parent, position })
  const quad = engine.addEntity()
  Transform.create(quad, { parent: holder, rotation: Quaternion.fromEulerDegrees(-90, 0, 0), scale: Vector3.create(diameter, diameter, 1) })
  MeshRenderer.setPlane(quad)
  Material.setPbrMaterial(quad, raysMaterial(hex, glow))
  Tween.setRotateContinuous(holder, Quaternion.fromEulerDegrees(0, 90, 0), degPerSec)
  return holder
}

/*
  Keyed by the toy, parented to the BASE. The crown was a child of the toy's entity, and the
  client outlines a hovered entity with its children: aim at the piece and a green square,
  the crown's quad, appeared over it (owner, 4 Sep). Hung from the base's root at the pad's
  position instead, it is not part of what the pointer hits, so nothing outlines it.
*/
export function toyRays(key: Entity, base: Entity, position: Vector3, hex: string | null): void {
  const cur = rayons.get(key)
  if (hex === null) {
    if (cur !== undefined) { engine.removeEntityWithChildren(cur); rayons.delete(key) }
    return
  }
  if (cur !== undefined) {
    const t = Transform.getMutableOrNull(cur)
    if (t !== null) t.position = position
    return
  }
  rayons.set(key, spawnRays(base, position, RAYS_DIAMETER, hex, 1.6 * glowLift(hex), 30))
}

export function clearRays(key: Entity): void { toyRays(key, key, Vector3.Zero(), null) }

/*
  A piece that floats: the Secret hangs a hand above its pad and breathes up and down.

  The pedestal entity already turns (one tween per entity, and that one is the spin), so the
  float rides on its CHILDREN: the mounted model when there is one, the silhouette's parts
  otherwise. Each child keeps the position it was fitted at as its floor and yoyos a little
  above it. Tweens run in the renderer, so this costs no object and no frame time in the
  scene (owner, 4 Sep: "the Secret piece is good but does not move").
*/
const FLOAT_MS = 1800
const floatFloor = new Map<Entity, Vector3>()

function floatChild(child: Entity, amplitude: number | null): void {
  const t = Transform.getOrNull(child)
  if (t === null) return
  let floor = floatFloor.get(child)
  if (floor === undefined) { floor = Vector3.create(t.position.x, t.position.y, t.position.z); floatFloor.set(child, floor) }
  if (amplitude === null) {
    if (Tween.has(child)) { Tween.deleteFrom(child); TweenSequence.deleteFrom(child) }
    Transform.getMutable(child).position = Vector3.create(floor.x, floor.y, floor.z)
    floatFloor.delete(child)
    return
  }
  Tween.setMove(child, Vector3.create(floor.x, floor.y, floor.z), Vector3.create(floor.x, floor.y + amplitude, floor.z), FLOAT_MS, EasingFunction.EF_EASESINE)
  TweenSequence.createOrReplace(child, { sequence: [], loop: TweenLoop.TL_YOYO })
}

/** Float everything that draws this toy by `amplitude` (parent-local units), or ground it with null. */
export function toyFloat(parent: Entity, amplitude: number | null): void {
  const m = montages.get(parent)
  if (m !== undefined) floatChild(m.modele, amplitude)
  const f = formes.get(parent)
  if (f !== undefined) for (const part of f.parts) floatChild(part, amplitude)
}

export function clearPedestal(parent: Entity): void {
  const cur = socles.get(parent)
  if (cur === undefined) return
  const f = flaques.get(cur)
  if (f !== undefined) { engine.removeEntity(f); flaques.delete(cur) }
  engine.removeEntity(cur)
  socles.delete(parent)
}

/*
 * Light, for the toys worth crossing the room for.
 *
 * Emissive is a surface property: a lit toy glows and nothing around it knows. The mobile
 * renderer has no bloom to spill that glow onto the slab, so from the doorway a Legendary was
 * a bright shape standing on the same cream as a Common. A point light in the toy's colour is
 * the platform's own way to make an object light its room. On the phone it is absent until the
 * mobile client's v1.13.0 ships LightSource (docs, missing-features, September 2026): no cost
 * there, a desktop flourish until then. One entity, a child at the toy's base, so the pool
 * lands on the slab and follows the toy's size.
 *
 * The renderer draws the four to ten lights nearest the player and drops the rest, which is
 * the right rule here: the lights that render are the ones in the base the judge is standing
 * in. Hue comes from the item, at full brightness so a dark mutation (Cursed, Blood) still
 * throws a coloured light; brightness comes from the glow; the range is explicit so a light
 * stays a pool under its own toy rather than a wash over the floor.
 *
 * The scale is the documentation's own anchor, not an example: "the default intensity is
 * 16000, this is the brightness of an average lightbulb", and "a light with the default
 * brightness will be hardly visible with the midday sun, like in the real world". A pool that
 * has to read under the sky therefore starts at one bulb and grows with the glow. The first
 * version took 200 to 700 candela from a sample snippet and was invisible by construction.
 * The light sits at the toy's centre: half a toy above the slab is where a point source makes
 * a pool about one toy wide, rather than a pin-prick at floor level.
 */
export const LIGHT_MIN_GLOW = 0.8     // Rare and above; a mutation adds 1 and lights anything
const AMPOULE = 16000                    // candela; the documentation's "average lightbulb"
const lumieres = new Map<Entity, Entity>()

/*
  How much a hue's glow must be pushed to be SEEN as bright as a gold one.

  `vif` gives every hue its channels at full stretch, but the eye weighs green far above
  blue: a vivid purple at (0.85, 0.15, 1) has a third of the luminance of a gold at the
  same intensity. So a Cursed Secret's floodlight, brighter in candela than an Epic's, read
  dimmer (owner, 4 Sep). The lift is the inverse of the hue's relative luminance (Rec. 709
  weights), capped so a near-black hue does not turn into a searchlight.
*/
/** Blood and Cursed are dark on purpose: their glow stays low so the pad reads as deep, not loud (owner, 5 Sep). */
export function sombreParNature(hex: string): boolean {
  const c = Color4.fromHexString(hex.length === 7 ? hex + 'ff' : hex)
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 0.15
}

export function glowLift(hex: string): number {
  const c = vif(hex)
  const y = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  return Math.max(1, Math.min(2.6, 0.62 / Math.max(y, 0.05)))
}

/** A hue at full brightness: the colour with its largest channel pushed to 1. */
export function vif(hex: string): Color4 {
  const c = Color4.fromHexString(hex.length === 7 ? hex + 'ff' : hex)
  const k = 1 / Math.max(c.r, c.g, c.b, 0.05)
  return Color4.create(Math.min(1, c.r * k), Math.min(1, c.g * k), Math.min(1, c.b * k), 1)
}

/*
  A light BUDGET, not a light per toy.

  Every Rare-or-better and every mutated toy asks for a point light, and so does every lit
  crate; sixty bases full of them is hundreds of lights, which the workshop names first among
  what a phone cannot carry ("don't overuse lights, use emission"). The wish is recorded here;
  a system every half second lights only the `LIGHTS_MAX` nearest to the player and takes
  the light off the rest. Emission on the toy's own plastic carries the rest of the glow.
*/
const LIGHTS_MAX = 16
const souhaits = new Map<Entity, { hex: string; glow: number }>()

/*
  The scene's point lights, off for now on every client: the mobile client does not render them
  before its v1.13.0, the pool under a lit piece is painted into its pad instead, and the desktop
  shows what a phone shows so the two can be compared (owner, 5 Sep). Flip to bring them back.
*/
const SCENE_LIGHTS = false
export function toyLight(parent: Entity, hex: string | null, glow: number): void {
  if (!SCENE_LIGHTS) return
  // No point lights on a phone: the client disables scene lights on the mobile preset, so
  // the budget would sort and create lights nobody renders, spending CPU for nothing (tester,
  // 28 Aug). The emissive material carries the whole glow there, which is free on every preset.
  if (isMobile()) return
  if (hex === null) {
    souhaits.delete(parent)
    const cur = lumieres.get(parent)
    if (cur !== undefined) { engine.removeEntity(cur); lumieres.delete(parent) }
    return
  }
  souhaits.set(parent, { hex, glow })
}

/** World position of an entity, up its parent chain; rotation ignored, which is fine for a distance. */
function positionMonde(e: Entity): Vector3 | null {
  // The toy itself must have a Transform; if it does not, it is not on screen.
  if (!Transform.has(e)) return null
  let x = 0, y = 0, z = 0
  let cur: Entity | undefined = e
  for (let n = 0; n < 8 && cur !== undefined && cur !== engine.RootEntity; n++) {
    const t = Transform.getOrNull(cur)
    // The chain ends at the scene root, which has no Transform: STOP with the sum so far,
    // never return null. Returning null here excluded every toy from the light budget and
    // took ALL toy lights down with it (tester, 28 Aug: "no glow, we regressed").
    if (t === null) break
    x += t.position.x; y += t.position.y; z += t.position.z
    cur = t.parent
  }
  return Vector3.create(x, y, z)
}

function allumer(parent: Entity, hex: string, glow: number): void {
  /*
    Dead on purpose, and kept as a scar. A `LightSource` created and deleted on the same
    entity crashes the desktop client's own system (NullReferenceException in
    `LightSourceApplyPropertiesSystem`, read in its log at the second the owner's game froze,
    5 Sep), and the component does not render on the mobile client before v1.13.0. The pool
    of colour under a rare piece is PAINTED into its pad instead (tools/model/build-pads.py).
  */
  void parent; void hex; void glow
}

function lightBudget(): void {
  const moi = Transform.getOrNull(engine.PlayerEntity)
  if (moi === null) return
  // The game is played by floor, so a toy on the player's own storey wins a light before one
  // a floor up that happens to be nearer in 3D (tester, 28 Aug). Rank by floor gap first,
  // then by distance within it.
  const monEtage = Math.round(moi.position.y / FLOOR_HEIGHT)
  const classes: Array<{ parent: Entity; etage: number; d: number }> = []
  for (const [parent] of souhaits) {
    if (!Transform.has(parent)) { souhaits.delete(parent); continue }
    const p = positionMonde(parent)
    if (p === null) continue
    classes.push({ parent, etage: Math.abs(Math.round(p.y / FLOOR_HEIGHT) - monEtage), d: Vector3.distanceSquared(p, moi.position) })
  }
  classes.sort((a, b) => a.etage - b.etage || a.d - b.d)
  const garder = new Set(classes.slice(0, LIGHTS_MAX).map((c) => c.parent))
  for (const parent of garder) {
    const s = souhaits.get(parent)
    if (s !== undefined) allumer(parent, s.hex, s.glow)
  }
  for (const [parent, e] of [...lumieres]) {
    if (garder.has(parent)) continue
    engine.removeEntity(e)
    lumieres.delete(parent)
  }
}

export function clearLight(parent: Entity): void { toyLight(parent, null, 0) }

/**
 * Remove an entity and everything this module hung under it.
 *
 * `removeEntity` does not take children, and the silhouette, the pad, the light and the
 * mounted model are all children, held in maps keyed by the parent. A view torn down with a
 * bare `removeEntity` left them behind twice: as orphans in the world, drawn at their local
 * offsets from a parent that no longer exists, and as map entries nothing would ever clear.
 * The ramp's handrails had the same bug, and the same fix.
 */
export function demolir(parent: Entity): void {
  clearShape(parent)
  clearCrate(parent)
  clearPedestal(parent)
  clearLight(parent)
  demonter(parent)
  engine.removeEntity(parent)
}

export function clearShape(parent: Entity): void {
  const cur = formes.get(parent)
  if (cur === undefined) return
  for (const e of cur.parts) engine.removeEntity(e)
  formes.delete(parent)
}

/*
 * A crate is a lidded box with straps, and the lid is what glows.
 *
 * Crates were plain cubes in three places (the belt, the convoy, the smash in front of the
 * player), each drawn by its own code, each a cube with one emissive tint. A cube says
 * nothing about being a container, and nothing about what is inside. This is the one crate:
 * a body in the tier's plastic, two straps, a latch, and a lid that glows harder as the tier
 * rises and floats a few centimetres, so a crate on the belt reads as alive from across the
 * plaza. A themed crate (Gold, Lava, Cursed) wears its mutation as glowing straps: the thing
 * it is likely to yield is written on it. Rare and above, and every themed crate, also throw
 * a light on the belt. `chauffe` is how far along a smash it is: the whole crate heats up.
 * The artist's `crate-<id>.glb` replaces all of it through the same mount as the toys.
 */
type Caisse = { halo: Entity | null; crateId: number; chaud: number }
const caisses = new Map<Entity, Caisse>()

/*
  La caisse est un modele, plus un disque quand elle brille.

  Elle etait six primitives: corps, ceinture, sangle, couvercle, loquet, disque. Six objets
  rendus par caisse, sept caisses sur le tapis, une par convoi: apres la vegetation, le poste
  le plus cher du decor, pour un objet de la taille d'une main. Le client compte les objets
  RENDUS et en plafonne a cinq cents, alors les morceaux sont maintenant fondus dans un seul
  maillage a un seul materiau, colore par un atlas (`tools/model/build-crates.py`).

  Ce qui se perd: le couvercle ne respire plus, il etait anime a part. Un couvercle qui monte
  de six centimetres sur une caisse d'un metre, vue depuis le bord de la place, ne valait pas
  cinq objets par caisse. Ce qui reste: le disque de lumiere sous les caisses Rare et plus,
  qui lui respire toujours, et la chauffe pendant le cassage.
*/
export function caisse(racine: Entity, crateId: number, chauffe = 0, avecHalo = true): void {
  const c = crate(crateId)
  const theme = c.theme >= 0 ? mutation(c.theme).color : null
  const eclaire = c.tier >= 2 || theme !== null
  let k = caisses.get(racine)
  if (k !== undefined && k.crateId !== crateId) { clearCrate(racine); k = undefined }
  if (k === undefined) {
    /*
      Le cube du support tient lieu de caisse le temps que le modele arrive, et le montage
      l'efface a l'atterrissage. C'est la meme attente que pour les jouets, et elle ne coute
      rien: le support existe de toute facon.
    */
    MeshRenderer.setBox(racine)
    Material.setPbrMaterial(racine, plastic(c.color))
    k = { halo: eclaire && avecHalo ? part(racine, Vector3.create(0, -0.52, 0), Vector3.Zero(), 'cyl') : null, crateId, chaud: -1 }
    caisses.set(racine, k)
  }
  remonter(racine, `crate-${crateId}.glb`)
  toyLight(racine, eclaire ? (theme ?? c.color) : null, 0.8 + c.tier * 0.6)

  /*
    La chauffe repeint le modele entier, texture comprise. Un modificateur de noeud REMPLACE
    le materiau: sans lui redonner l'atlas, la caisse virerait au blanc uni des le premier
    coup. D'ou `crate-atlas.png`, le meme fichier que les neuf modeles citent. On ne repeint
    qu'aux paliers, pas a chaque image.
  */
  const chaud = Math.max(0, Math.min(8, Math.round(chauffe * 8)))
  if (k.chaud !== chaud) {
    k.chaud = chaud
    heatCrate(racine, chaud / 8)
  }

  /*
    Le disque de lumiere est OPAQUE et emissif, pose sous la caisse, et il respire. La lumiere
    ponctuelle et l'emissif dependent du profil graphique du client (pas de lumieres de scene
    en Bas, bloom a partir de Moyen); un testeur n'a vu briller aucune caisse, hauts paliers
    compris. Un disque allume se lit depuis le bord de la place sur n'importe quel profil.
  */
  const halo = k.halo
  if (halo === null) return
  const hex = theme ?? c.color
  Material.setPbrMaterial(halo, plastic(hex, 2.5 + c.tier))
  const ht = Transform.getMutableOrNull(halo)
  const taille = 1.7 + c.tier * 0.15
  if (ht !== null && ht.scale.x === 0) ht.scale = Vector3.create(taille, 0.05, taille)
  if (!Tween.has(halo)) {
    Tween.setScale(halo, Vector3.create(taille, 0.05, taille), Vector3.create(taille * 1.18, 0.05, taille * 1.18), 1100, EasingFunction.EF_EASESINE)
    TweenSequence.create(halo, { sequence: [], loop: TweenLoop.TL_YOYO })
  }
}

/** Chauffe la caisse montee: blanc croissant sur l'atlas, rendu au modele et pas au support. */
function heatCrate(racine: Entity, chauffe: number): void {
  const m = montages.get(racine)
  const crateId = caisses.get(racine)?.crateId ?? 0
  if (m === undefined) return
  if (chauffe <= 0) { GltfNodeModifiers.deleteFrom(m.modele); return }
  GltfNodeModifiers.createOrReplace(m.modele, {
    modifiers: [{
      path: '',
      material: {
        material: {
          $case: 'pbr',
          pbr: {
            texture: Material.Texture.Common({ src: `${TOY_DIR}${crateImage(crateId)}` }),
            albedoColor: Color4.White(),
            /*
              La chauffe est ORANGE, jamais blanche.

              Elle etait un emissif blanc jusqu'a 2,4: passe un coup ou deux la caisse virait
              au blanc uni, texture comprise, et on ne voyait plus ce qu'on cassait. C'est
              exactement le reproche deja fait a l'emissif des etages: "l'emissif permet mal
              d'augmenter la clarte sans juste rendre tout blanc" (proprietaire, 2 puis 3 Sep).
              Une braise chaude dans la teinte du metal chauffe, a intensite moderee, se lit
              comme une montee en temperature et laisse l'albedo raconter la caisse.
            */
            emissiveColor: Color4.fromHexString('#ff6a28ff'),
            emissiveIntensity: chauffe * 1.1,
            metallic: 0,
            roughness: 0.9
          }
        }
      }
    }]
  })
}

export function dimCrate(racine: Entity): void {
  const k = caisses.get(racine)
  if (k === undefined || k.halo === null) return
  const halo = k.halo
  /*
    Appele a CHAQUE image de la chute, pas une fois, et sans frais quand il n'y a plus rien
    a faire. Un tween reecrit le Transform de son entite a chaque image ou il vit: supprimer
    le tween et remettre l'echelle a zero dans la meme image est une course que le rendu peut
    gagner, son ecriture arrive apres la notre, le disque garde sa taille, et comme l'extinction
    n'a tourne qu'une fois il n'y a jamais de seconde chance. Le disque d'une caisse tombee
    dans la fosse restait allume au fond (proprietaire, 1er Sep). Idempotent, donc l'appeler a
    chaque image coute une comparaison une fois qu'il a pris.
  */
  /*
    On SUPPRIME le disque, on ne l'eteint plus.

    L'extinction remettait son echelle a zero en luttant contre un tween qui reecrit le
    Transform a chaque image, d'ou l'appel repete a chaque image de la chute. Ca ne suffisait
    pas: la caisse fait un tour et demi en tombant, le disque tourne avec elle puisqu'il en est
    l'enfant, et on le voyait DE PROFIL, une barre pale sous la caisse (proprietaire, 3 Sep).
    Une entite detruite, elle, ne peut pas etre dessinee, quoi que fasse le tween.
  */
  engine.removeEntity(halo)
  caisses.set(racine, { ...k, halo: null })
  toyLight(racine, null, 0)
}

export function clearCrate(racine: Entity): void {
  const k = caisses.get(racine)
  if (k === undefined) return
  if (k.halo !== null) engine.removeEntity(k.halo)
  demonter(racine)
  caisses.delete(racine)
}

export function setupToy(): void {
  // The light budget only runs where there are lights to budget: not on a phone.
  if (!isMobile()) {
    let lightAcc = 0
    engine.addSystem((dt) => {
      lightAcc += dt
      if (lightAcc >= 0.5) { lightAcc = 0; lightBudget() }
    })
  }
  engine.addSystem(() => {
    for (const primitive of enAttente) {
      const m = montages.get(primitive)
      if (m === undefined) { enAttente.delete(primitive); continue }
      const st = GltfContainerLoadingState.getOrNull(m.modele)
      if (st === null) continue
      if (st.currentState === LoadingState.FINISHED) {
        enAttente.delete(primitive)
        // The model is in: the stand-in, box or toy, stops drawing but keeps its collider and slot.
        if (MeshRenderer.has(primitive)) MeshRenderer.deleteFrom(primitive)
        clearShape(primitive)
        montages.set(primitive, { ...m, charge: true })
        // And it takes the colours the shelf asked for while it was still loading.
        const voulu = dernierMateriau.get(primitive)
        if (voulu !== undefined) teindreModele(m.modele, voulu)
        // The arrival is the animation: from nothing to its fitted size with a little
        // overshoot, the pop every idle game gives a thing that just became yours.
        // Not on a model that floats: an entity holds one Tween, so the pop would replace
        // the float's Move tween while the float's yoyo sequence stays, and the Secret then
        // scaled between nothing and its size forever (owner, 5 Sep: "bounce entre la
        // presence et rien"). The float is its arrival.
        const tm = Transform.getOrNull(m.modele)
        if (tm !== null && !floatFloor.has(m.modele)) {
          Tween.createOrReplace(m.modele, {
            mode: Tween.Mode.Scale({ start: Vector3.Zero(), end: Vector3.create(tm.scale.x, tm.scale.y, tm.scale.z) }),
            duration: 190,
            easingFunction: EasingFunction.EF_EASEOUTBACK
          })
        }
      }
    }
  })
}
