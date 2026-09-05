import { plasticDe, caisse, FIT, TOY_DIR, spinLoop } from './toy'
import { engine, Transform, MeshRenderer, MeshCollider, ColliderLayer, Material, PointerEvents, PointerEventType, InputAction, inputSystem, Tween, TweenSequence, EasingFunction, Entity, AudioSource, timers, GltfContainer } from '@dcl/sdk/ecs'
import { Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { room } from '../shared/messages'
import { Plot, SLOTS_PER_FLOOR, OPEN_RANGE, occupe } from '../shared/schemas'
import { rarity, crate, mutation, itemName, itemColor, rarityOf, mutationDe } from '../shared/loot-table'
import { alerter } from './theft'
import { verb } from './verb'
import { carryView } from './carry'
import { sendOrHold } from './intent'
import { TOAST } from './theme'
import { preparerRevealToy, ouvrirRevealToy, fermerRevealToy, revealToyView } from './reveal-toy'

let monAdresse = ''

const COUPS = 3
/*
  A crate you walk away from is a crate you did not open.

  The smash phase had exactly one exit, the third blow. Tap OPEN, get distracted, walk off,
  and the phase stayed `smash` for the rest of the session; since the action button tests it
  first, it said SMASH everywhere, at other people's bases, in front of their shelves, and no
  other verb could ever surface (mobile tester, 3 Sep: STEAL "only appeared later", the icon
  "never changed after buying"; all one bug). The crate is not consumed before the third blow,
  so abandoning it costs nothing: it stays in stock.
*/
const SMASH_ABANDON_M = 3.5
const SMASH_TIMEOUT_MS = 20_000

/**
 * One crate at a time, from the floor to your hand.
 *
 * `opening` and `roule` were two booleans, and between them were gaps: after the third blow
 * and before the server answered, and after the reel stopped and before the item landed in
 * the hand, neither was set, so the action button offered OPEN again and a fourth press in a
 * rhythm put a second crate on the floor under the first one's reel. The server refused the
 * second opening, the crate burst into nothing, and the player saw a bug. One phase now, and
 * the interface offers nothing but SMASH while a crate is in flight, whatever the phase.
 */
export type PhaseCaisse = 'idle' | 'smash' | 'wait' | 'roll' | 'land'

export const boxView = {
  stock: [] as number[],
  phase: 'idle' as PhaseCaisse,
  /** When a phase that waits on something gives up and returns to idle. */
  phaseJusqua: 0,
  opening: false,
  coups: 0,
  typeEnCours: 0,
  roule: false,
  /**
   * The reel, and where it has travelled to.
   *
   * `reel` is a strip of candidate rarities with the real result planted at REEL_WIN, and
   * `progres` is how many cards have passed the centre line so far, as a float. One number
   * drives the whole animation, so the interface only has to read it and draw.
   */
  reel: [] as number[],
  progres: 0,
  /** When the strip stopped, for the pop and the flash the interface draws from it. */
  gagneA: 0,
  /*
    Une revelation SANS roulette: la fusion n'a pas tire au sort, elle a produit.

    La roulette est le tambour d'une caisse, et elle se dessine des que `resultat` est pose.
    La fusion reutilise la meme revelation, qui est deja le moment "vous avez obtenu quelque
    chose" du jeu, mais elle arrive sans tirage: montrer une bande qui s'arrete mentirait sur
    ce qui vient de se passer.
  */
  sansRoulette: false,
  /** The last card that crossed the line, so the tick plays once per card. */
  dernierPas: 0,
  resultat: -1,
  resultatMutation: 0,
  resultatTraits: 0,
  resultatJusqua: 0,
  state: 'expose',
  message: ''
}

let crateMesh: Entity
let hitSound: Entity
let sonBurst: Entity
let sonLand: Entity
let sonMutation: Entity
let sonReveal: Entity
let sonRevealRare: Entity
let sonRevealBig: Entity
let sonRevealHuge: Entity
const eclats: Entity[] = []
const ECLATS = 14
let sonTic: Entity
let sonTic2: Entity
let dernierTic = 0
let bascule = false

/*
  Two emitters, and a floor on the rate.

  One AudioSource restarted per card cannot be heard when the cards fly: each restart cuts the
  one before it, so the start of a spin was silence and the end was a click (owner, 5 Sep).
  Alternating two sources lets a blip finish while the next begins, and refusing to fire more
  than once every 70 ms turns the opening rattle into a rhythm.
*/
function ticRoulette(): void {
  const t = Date.now()
  if (t - dernierTic < 70) return
  dernierTic = t
  bascule = !bascule
  jouer(bascule ? sonTic : sonTic2)
}
let left = 0
let reelS = 1

/**
 * Length of the strip, where the winning card sits in it, and how long it runs.
 *
 * The run is the reward's own drumroll, so it grows with the rarity: a Common is over in three
 * seconds, a Secret crawls for more than six. Loot-box openings across the genre put their
 * whole effect in that delay before the reveal, and the reference reels (CS:GO and its clones)
 * run five to eight seconds over a strip far longer than the window. Forty-four cards at two
 * hundred pixels is a strip of nine metres of screen for a window that shows eight of them.
 */
const REEL_LEN = 44
export const REEL_WIN = 38

/**
 * The beat between the strip stopping and the hero rising, matched to the sting's riser so
 * the glyph lands ON the impact: nothing for the small pulls, the riser's length above.
 *
 * It lives here rather than in the interface because the 3D piece keys on the same beat, and
 * two copies of one number is how a picture and an object end up arriving apart.
 */
export function revealHold(rarete: number): number { return rarete >= 5 ? 340 : rarete >= 3 ? 220 : 0 }
const REEL_BASE_S = 3.0
const REEL_PER_RARITY_S = 0.55

/**
 * A plausible strip to scroll past.
 *
 * The cards the player does not win still have to look like things they could have won,
 * so the filler is drawn against falling weights rather than uniformly: mostly commons,
 * the occasional legendary, which is what makes the strip read as a gamble.
 */
const POIDS_REEL = [50, 24, 10, 6, 5, 3, 2]
function rareteDecor(): number {
  const total = POIDS_REEL.reduce((a, b) => a + b, 0)
  let n = Math.random() * total
  for (let i = 0; i < POIDS_REEL.length; i++) {
    n -= POIDS_REEL[i]
    if (n <= 0) return i
  }
  return 0
}

export function setupBox(): void {
  setupCrateGhost()

  crateMesh = engine.addEntity()
  Transform.create(crateMesh, { position: Vector3.create(0, -10, 0), scale: Vector3.create(0, 0, 0) })
  /*
    La caisse se frappe, elle ne se heurte pas.

    C'est la meme regle que le convoi, et pour la meme raison: cette entite est UNIQUE et sa
    position saute de (0,-10,0) a deux metres devant le joueur, dans une base dont les murs et
    la bordure de la carte sont a quelques metres. Un solide qui apparait la coince le corps
    entre lui et le decor, et le moteur resout l'interpenetration en poussant, sans limite de
    distance. Le proprietaire s'est fait ejecter hors du terrain en ouvrant sa caisse chez lui
    (2 Sep), apres l'avoir ete par le convoi la veille au tapis: deux fois le meme objet, deux
    fois le meme mecanisme.

    Frapper passe par un clic sur elle ou par le bouton contextuel: le pointeur suffit aux
    deux, la physique n'apportait qu'un obstacle qu'on n'a jamais voulu.
  */
  // Solid again, on trial: see belt.ts, same reasoning, same exit if a push reproduces.
  MeshCollider.setBox(crateMesh, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)
  PointerEvents.create(crateMesh, {
    pointerEvents: [
      { eventType: PointerEventType.PET_DOWN, eventInfo: { button: InputAction.IA_POINTER, hoverText: 'Smash' } }
    ]
  })

  const emetteur = (clip: string, steal: number): Entity => {
    const e = engine.addEntity()
    Transform.create(e, { parent: engine.PlayerEntity, position: Vector3.create(0, 1, 0) })
    AudioSource.create(e, { audioClipUrl: clip, playing: false, loop: false, volume: steal })
    return e
  }
  hitSound = emetteur('assets/sounds/hit.wav', 0.9)
  sonBurst = emetteur('assets/sounds/burst.wav', 1)
  sonMutation = emetteur('assets/sounds/mutation.wav', 0.75)
  sonLand = emetteur('assets/sounds/land.wav', 0.8)
  sonReveal = emetteur('assets/sounds/reveal.wav', 0.85)
  sonRevealRare = emetteur('assets/sounds/reveal-rare.wav', 0.85)
  sonRevealBig = emetteur('assets/sounds/reveal-big.wav', 0.85)
  sonRevealHuge = emetteur('assets/sounds/reveal-huge.wav', 0.9)
  sonTic = emetteur('assets/sounds/reel.wav', 0.6)
  sonTic2 = emetteur('assets/sounds/reel.wav', 0.6)
  // Le refus se dit au son, pas au texte: un etage plein est une chose qu'on entend une fois
  // et qu'on comprend, la ou une plaque "FLOOR FULL" reste a lire a chaque tentative.
  refuseSound = emetteur('assets/sounds/tick.wav', 0.35)

  /*
    Plus d'eclats en attente sous le sol.

    Quatorze boites etaient creees ici et garees a dix metres sous terre, a l'echelle zero, en
    attendant la prochaine caisse. Le client les comptait quand meme: quatorze objets rendus,
    quatorze materiaux, en permanence, pour un effet qui dure huit cent cinquante millisecondes
    (mesure du 2 Sep). Ils naissent dans `exploser` et meurent avec l'effet.
  */

  room.onMessage('inventory', (d) => { boxView.stock = [...d.crates] })

  engine.addSystem(() => {
    if (monAdresse !== '') return
    const me = getPlayer()
    if (me !== null) monAdresse = me.userId.toLowerCase()
  })

  room.onMessage('boxResult', (d) => {
    boxView.phase = 'roll'
    /*
      Le drapeau se leve ICI, au depart du tambour, pas a son arret.

      Il etait remis a faux quand la bande s'immobilise, or la roulette se dessine pendant
      TOUT son tour: apres une fusion, qui l'avait mis a vrai, la caisse suivante tournait
      sans que rien ne s'affiche, et le joueur n'a vu que le resultat surgir de nulle part
      (proprietaire, 3 Sep). Un drapeau qui gouverne un affichage se remet a zero au debut de
      cet affichage, jamais a sa fin.
    */
    boxView.sansRoulette = false
    boxView.roule = true
    boxView.resultat = d.rarity
    boxView.resultatMutation = d.mutation
    boxView.resultatTraits = d.traits
    boxView.state = d.state
    boxView.reel = Array.from({ length: REEL_LEN }, () => rareteDecor())
    boxView.reel[REEL_WIN] = d.rarity
    // The real toy, mounted now and hidden: it has the whole spin to load.
    preparerRevealToy(d.rarity * 100 + d.mutation)
    boxView.progres = 0
    boxView.dernierPas = 0
    reelS = REEL_BASE_S + d.rarity * REEL_PER_RARITY_S
    left = reelS

    const depart = lastPosition
    if (depart !== null) {
      /*
        The flight is the FALLBACK, not a second showing.

        A toy leaving the crate and flying to the hand answered "where did it go" back when the
        reveal was a picture. Now the real piece turns in front of the camera and then leaves,
        which says the same thing better: playing both told the story twice and made the moment
        harder to read (owner, 5 Sep). So the flight only happens when the piece did not show,
        which is exactly when the question needs answering.
      */
      timers.setTimeout(() => {
        if (!revealToyView.visible) sendToHand(depart, d.rarity, d.mutation)
      }, Math.round(reelS * 1000) + 120)
    }
  })

  engine.addSystem((dt: number) => {
    if (boxView.opening && inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN, crateMesh)) {
      frapper()
    }

    if (boxView.roule) {
      left -= dt
      // Quartic ease-out: the strip leaves fast and crawls onto the winning card, which is
      // the whole tension of the thing. One float, read straight by the interface.
      const t = Math.min(1, Math.max(0, 1 - left / reelS))
      boxView.progres = (1 - Math.pow(1 - t, 4)) * REEL_WIN
      // One tick per card crossing the line: the rhythm IS the deceleration.
      const pas = Math.floor(boxView.progres + 0.5)
      if (pas !== boxView.dernierPas) { boxView.dernierPas = pas; ticRoulette() }
      if (left <= 0) {
        boxView.roule = false
        boxView.phase = 'land'
        boxView.phaseJusqua = Date.now() + 5000
        boxView.progres = REEL_WIN
        boxView.sansRoulette = false
        boxView.gagneA = Date.now()
        // The stop has its own weight, under the sting that climbs out of it.
        jouer(sonLand)
        jouerReveal(boxView.resultat)
        timers.setTimeout(ouvrirRevealToy, revealHold(boxView.resultat))
        // Long enough to read the name once, gone before it outstays the win: the
        // genre closes its reveals fast and lets the item in the hand carry the memory.
        boxView.resultatJusqua = Date.now() + 2200
        console.log(`[CLIENT] crate ouverte -> ${itemName(boxView.resultat, boxView.resultatMutation)}`)
      }
    } else if (boxView.resultat >= 0 && Date.now() > boxView.resultatJusqua) {
      boxView.resultat = -1
      boxView.message = ''
      fermerRevealToy()
    }

    // The two waits end on what they wait for, or on a timeout when it never comes: the
    // server refusing the opening, or the item not reaching the hand.
    const now = Date.now()
    if (boxView.phase === 'smash') {
      const c = cratePosition()
      const pl = Transform.getOrNull(engine.PlayerEntity)
      const loin = c !== null && pl !== null && Math.hypot(pl.position.x - c.x, pl.position.z - c.z) > SMASH_ABANDON_M
      if (loin || now > boxView.phaseJusqua) abandonSmash()
    }
    if (boxView.phase === 'wait' && now > boxView.phaseJusqua) boxView.phase = 'idle'
    if (boxView.phase === 'land' && (carryView.code >= 0 || now > boxView.phaseJusqua)) boxView.phase = 'idle'
  })
}

/** One blow on the crate in front of you, from a click on it or from the action button. */
/** Give up on the crate in front of you: phase back to idle, mesh away, stock untouched. */
function abandonSmash(): void {
  boxView.phase = 'idle'
  boxView.opening = false
  boxView.coups = 0
  const t = Transform.getMutableOrNull(crateMesh)
  if (t !== null) t.scale = Vector3.Zero()
  console.log('[CLIENT] crate opening abandoned, crate stays in stock')
}

export function frapper(): void {
  if (!boxView.opening) return
  boxView.coups += 1
  // Every blow buys more time: only a crate nobody is hitting gets abandoned.
  boxView.phaseJusqua = Date.now() + SMASH_TIMEOUT_MS
  const b = crate(boxView.typeEnCours)
  Tween.createOrReplace(crateMesh, {
    mode: Tween.Mode.Scale({
      start: Vector3.create(b.size * 0.72, b.size * 1.25, b.size * 0.72),
      end: Vector3.create(b.size, b.size, b.size)
    }),
    duration: 190,
    easingFunction: EasingFunction.EF_EASEOUTELASTIC,
    currentTime: 0
  })
  jouer(hitSound)

  // The crate heats up as it is hit: the whole thing, lid, straps and body, glows harder.
  // Pas de disque au sol: la caisse qu'on ouvre flotte a hauteur de poitrine, son disque
  // flottait avec elle, en plein milieu de rien (proprietaire, 3 Sep). Le disque est une
  // flaque de lumiere pour une caisse POSEE, il n'a de sens que sur le tapis.
  caisse(crateMesh, boxView.typeEnCours, boxView.coups / COUPS, false)

  if (boxView.coups >= COUPS) {
    boxView.opening = false
    boxView.phase = 'wait'
    boxView.phaseJusqua = Date.now() + 6000
    const t = Transform.getOrNull(crateMesh)
    if (t !== null) exploser(Vector3.create(t.position.x, t.position.y, t.position.z), b.color)
    storeCrate()
    const tier = boxView.typeEnCours
    sendOrHold(() => { void room.send('openBox', { crateTier: tier }) })
  }
}

let refuseSound: Entity
/**
 * Montre la revelation pour un code deja decide, sans tirage: la sortie du fuser.
 *
 * Le fuser n'annoncait son resultat que par une ligne de texte de cinq secondes. C'est le
 * seul acte DETERMINISTE du jeu, celui qu'on paie plus cher que le hasard justement pour
 * l'obtenir, et il n'avait aucun moment. La revelation des caisses existe deja, elle est
 * centree, elle a son rayon, sa pop et son son: la reutiliser donne au fuser son evenement
 * sans une seule interface de plus (proprietaire, 3 Sep).
 */
export function revealItem(code: number): void {
  boxView.sansRoulette = true
  boxView.resultat = rarityOf(code)
  boxView.resultatMutation = mutationDe(code)
  boxView.gagneA = Date.now()
  boxView.resultatJusqua = Date.now() + 2600
  jouerReveal(boxView.resultat)
  // A fusion has no strip, so the piece has no spin to load in: it shows if it makes it.
  preparerRevealToy(code)
  timers.setTimeout(ouvrirRevealToy, revealHold(boxView.resultat))
}

export function refuseWithSound(): void { jouer(refuseSound) }

let lastPosition: Vector3 | null = null

/*
  The reveal is a LADDER, not one clip.

  Every rarity shared a single sting, which flattened the most emotional moment in the game:
  a Secret sounded exactly like a Common. The genre's answer is that the higher the pull, the
  the sound CHANGES with the step, not only its length: a wooden blip for the small pulls, a
  bell for a Rare, a riser and a lasting ring for Epic and Legendary, and for the top a riser,
  a low impact and a held chord (tools/sounds/build-reveal-tiers.py has the reasoning). Four
  clips for seven rarities, and the ear names the tier before the eye reads it.
*/
function jouerReveal(rarete: number): void {
  jouer(rarete >= 5 ? sonRevealHuge : rarete >= 3 ? sonRevealBig : rarete >= 2 ? sonRevealRare : sonReveal)
  // A mutated piece adds one layer over that sting, the same layer for all fourteen: the
  // ladder the ear reads stays the rarity's, and the shimmer says this one is not plain.
  if (boxView.resultatMutation > 0) jouer(sonMutation)
}

function jouer(e: Entity): void {
  const a = AudioSource.getMutableOrNull(e)
  if (a !== null) { a.playing = false; a.playing = true }
}

function exploser(center: Vector3, color: string): void {
  lastPosition = center
  jouer(sonBurst)
  const c = Color4.fromHexString(color + 'ff')
  for (const vieux of eclats) engine.removeEntity(vieux)
  eclats.length = 0
  for (let i = 0; i < ECLATS; i++) {
    const e = engine.addEntity()
    Transform.create(e, { position: center, scale: Vector3.create(0.16, 0.16, 0.16) })
    MeshRenderer.setBox(e)
    eclats.push(e)
    const a = (i / ECLATS) * Math.PI * 2
    const h = 0.6 + (i % 3) * 0.5
    const r = 1.6 + (i % 4) * 0.45
    const t = Transform.getMutableOrNull(e)
    if (t === null) continue
    t.position = center
    t.scale = Vector3.create(0.16, 0.16, 0.16)
    Material.setPbrMaterial(e, plasticDe(c, 1.4))
    Tween.createOrReplace(e, {
      mode: Tween.Mode.Move({
        start: center,
        end: Vector3.create(center.x + Math.cos(a) * r, center.y + h, center.z + Math.sin(a) * r)
      }),
      duration: 260,
      easingFunction: EasingFunction.EF_EASEOUTQUAD
    })
    TweenSequence.createOrReplace(e, {
      sequence: [{
        mode: Tween.Mode.Move({
          start: Vector3.create(center.x + Math.cos(a) * r, center.y + h, center.z + Math.sin(a) * r),
          end: Vector3.create(center.x + Math.cos(a) * r * 1.5, 0.2, center.z + Math.sin(a) * r * 1.5)
        }),
        duration: 520,
        easingFunction: EasingFunction.EF_EASEINQUAD
      }]
    })
  }
  timers.setTimeout(() => {
    for (const e of eclats) engine.removeEntity(e)
    eclats.length = 0
  }, 850)
}

function storeCrate(): void {
  Tween.deleteFrom(crateMesh)
  const t = Transform.getMutableOrNull(crateMesh)
  if (t !== null) { t.scale = Vector3.create(0, 0, 0); t.position = Vector3.create(0, -10, 0) }
}

/**
 * The reveal flies to the player's hand, because that is where the server puts it.
 *
 * Opening used to file the item straight onto a shelf after the reel, and the flight went
 * to the base. Since carrying became the one verb, a fresh item lands in the hand like a
 * stolen one does, and the player walks it to whichever pedestal they choose: the same
 * placement they already have for everything else, with the green marker.
 */
function sendToHand(from: Vector3, rarityId: number, mut = 0): void {
  const me = Transform.getOrNull(engine.PlayerEntity)
  if (me === null) return
  const target = Vector3.create(me.position.x, me.position.y + 1.0, me.position.z)

  const e = engine.addEntity()
  const r = rarity(rarityId)
  Transform.create(e, { position: from })
  // The thing that flies to the hand is the piece that was won, spinning as it goes; a
  // coloured cube stood in here from before the chess set existed. Secret has no file on
  // purpose (the star is a primitive), so it keeps the cube in its own colour.
  const visuel = engine.addEntity()
  const fichier = `item-${rarityId}.glb`
  const f = FIT[fichier]
  if (rarityId <= 5 && f !== undefined) {
    Transform.create(visuel, { parent: e, scale: Vector3.create(f.scale * r.size, f.scale * r.size, f.scale * r.size) })
    GltfContainer.create(visuel, { src: TOY_DIR + fichier, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  } else {
    Transform.create(visuel, { parent: e, scale: Vector3.create(r.size, r.size, r.size) })
    MeshRenderer.setBox(visuel)
    const c = Color4.fromHexString(itemColor(rarityId, mut) + 'ff')
    Material.setPbrMaterial(visuel, plasticDe(c, 1.2))
  }
  spinLoop(visuel, 1120)

  const haut = Vector3.create((from.x + target.x) / 2, Math.max(from.y, target.y) + 5, (from.z + target.z) / 2)
  Tween.createOrReplace(e, {
    mode: Tween.Mode.Move({ start: from, end: haut }),
    duration: 420,
    easingFunction: EasingFunction.EF_EASEOUTQUAD
  })
  TweenSequence.createOrReplace(e, {
    sequence: [{
      mode: Tween.Mode.Move({ start: haut, end: target }),
      duration: 520,
      easingFunction: EasingFunction.EF_EASEINQUAD
    }]
  })
  timers.setTimeout(() => engine.removeEntityWithChildren(e), 1100)
}

function myBasePosition(): Vector3 | null {
  if (monAdresse === '') return null
  for (const [ent, p] of engine.getEntitiesWith(Plot, Transform)) {
    if (p.ownerId.toLowerCase() !== monAdresse) continue
    const t = Transform.get(ent)
    return Vector3.create(t.position.x, 1.4, t.position.z)
  }
  return null
}

function maBasePleine(): boolean {
  const me = getPlayer()
  if (me === null) return false
  const a = me.userId.toLowerCase()
  for (const [, p] of engine.getEntitiesWith(Plot)) {
    if (p.ownerId.toLowerCase() !== a) continue
    return occupe(p.items) >= SLOTS_PER_FLOOR * p.floors
  }
  return false
}

/** Whether a crate can be smashed from where the player stands, for the button to say so. */
export function peutOuvrirIci(): boolean {
  const base = myBasePosition()
  if (base === null || !Transform.has(engine.PlayerEntity)) return false
  const p = Transform.get(engine.PlayerEntity).position
  return Math.sqrt((p.x - base.x) ** 2 + (p.z - base.z) ** 2) <= OPEN_RANGE
}

/**
 * Smash a crate, at the base and nowhere else.
 *
 * It used to appear two metres in front of the player wherever they happened to be, which
 * made the delivery pointless: the convoy carried the crate home, and the crate then
 * reappeared somewhere else entirely. It is now put down between the player and their own
 * base, so the thing they walked home is the thing they break open.
 */
/**
 * Le fantome de la caisse: la ou elle tombera si on ouvre maintenant.
 *
 * Ouvrir pose la caisse a deux metres devant soi, sur l'etage ou l'on se tient, et seulement
 * a portee de sa propre base. Rien ne le disait: le joueur appuyait et decouvrait ou la chose
 * atterrissait (testeur, 1 Sep). Le marqueur reprend exactement le calcul de `openCrate`, a la
 * taille et a l'inclinaison de la caisse qui sera ouverte, en vert translucide comme celui de
 * la pose d'objet, avec la ligne du couvercle pour qu'il se lise comme une caisse et pas comme
 * un cube. Il disparait des que l'ouverture commence, la vraie caisse prenant sa place.
 */
let crateGhost: Entity
let fantomeCouvercle: Entity
const CRATE_GREEN = Color4.create(0.35, 0.95, 0.45, 0.34)

function setupCrateGhost(): void {
  crateGhost = engine.addEntity()
  Transform.create(crateGhost, { position: Vector3.create(0, -50, 0), scale: Vector3.Zero() })
  MeshRenderer.setBox(crateGhost)
  Material.setPbrMaterial(crateGhost, plasticDe(CRATE_GREEN, 0.5))

  fantomeCouvercle = engine.addEntity()
  Transform.create(fantomeCouvercle, { parent: crateGhost, position: Vector3.create(0, 0.32, 0), scale: Vector3.create(1.04, 0.1, 1.04) })
  MeshRenderer.setBox(fantomeCouvercle)
  Material.setPbrMaterial(fantomeCouvercle, plasticDe(Color4.create(0.35, 0.95, 0.45, 0.6), 0.9))

  engine.addSystem(() => {
    const t = Transform.getMutableOrNull(crateGhost)
    if (t === null) return
    /*
      Le marqueur obeit au BOUTON, pas a ses propres conditions.

      Tant qu'il decidait tout seul, il pouvait s'afficher pendant qu'une pression allait faire
      autre chose: monter par l'ascenseur, voler un socle, ramasser sa piece, nourrir la
      machine. Deux marqueurs verts a l'ecran, et plus personne ne sait lequel la touche sert
      (proprietaire, 1 Sep). `nextAction()` est le seul arbitre, il publie le verb choisi, et
      ce marqueur ne se montre que quand ce verb est exactement "ouvrir une caisse".
    */
    const pret = verb.id === 'ouvrir-caisse'
    if (!pret || !Transform.has(engine.PlayerEntity)) {
      if (t.scale.x !== 0) t.scale = Vector3.Zero()
      return
    }
    const p = Transform.get(engine.PlayerEntity)
    const b = crate(Math.max(...boxView.stock))
    const f = Vector3.rotate(Vector3.create(0, 0, 1), p.rotation)
    const plat = Math.sqrt(f.x * f.x + f.z * f.z)
    const ux = plat < 0.01 ? 0 : f.x / plat
    const uz = plat < 0.01 ? 1 : f.z / plat
    t.position = Vector3.create(p.position.x + ux * 2, p.position.y + b.size / 2 + 0.02, p.position.z + uz * 2)
    t.scale = Vector3.create(b.size, b.size, b.size)
    t.rotation = Quaternion.fromEulerDegrees(0, 25, 0)
  })
}

export function openCrate(crateTier: number): void {
  if (boxView.phase !== 'idle') return
  if (!boxView.stock.includes(crateTier)) return
  if (!Transform.has(engine.PlayerEntity)) return

  const base = myBasePosition()
  if (base === null) {
    alerter('BUILD YOUR BASE FIRST', '#ff6b6b', TOAST.warning)
    return
  }
  if (!peutOuvrirIci()) {
    alerter('GO TO YOUR BASE TO OPEN IT', '#ffd166', TOAST.warning)
    return
  }
  if (maBasePleine()) {
    alerter('BASE FULL  ·  SELL OR BUY A FLOOR', '#ff6b6b', TOAST.warning)
    return
  }

  const p = Transform.get(engine.PlayerEntity)
  const b = crate(crateTier)

  boxView.phase = 'smash'
  boxView.phaseJusqua = Date.now() + SMASH_TIMEOUT_MS
  boxView.opening = true
  boxView.coups = 0
  boxView.typeEnCours = crateTier
  boxView.message = ''

  /*
    In front of the player, at the player's height.

    It used to spawn two metres from the CENTRE of the base at ground level, whichever
    storey the player was on: open a crate on the third floor and it appeared downstairs,
    out of reach. It now sits two metres ahead of where they stand, on their storey, so
    smashing it is a thing you do where you are.
  */
  const f = Vector3.rotate(Vector3.create(0, 0, 1), p.rotation)
  const plat = Math.sqrt(f.x * f.x + f.z * f.z)
  const ux = plat < 0.01 ? 0 : f.x / plat
  const uz = plat < 0.01 ? 1 : f.z / plat
  void base

  const t = Transform.getMutableOrNull(crateMesh)
  if (t !== null) {
    // On the floor of the storey the player stands on, two metres ahead, turned a little.
    t.position = Vector3.create(p.position.x + ux * 2, p.position.y + b.size / 2 + 0.02, p.position.z + uz * 2)
    t.scale = Vector3.create(b.size, b.size, b.size)
    t.rotation = Quaternion.fromEulerDegrees(0, 25, 0)
  }
  caisse(crateMesh, crateTier, 0, false)
}

export function openBestCrate(): void {
  if (boxView.stock.length === 0) return
  openCrate(Math.max(...boxView.stock))
}

/** The crate currently standing at the base, if one is being opened: the beacon's target. */
export function cratePosition(): Vector3 | null {
  if (!boxView.opening) return null
  const t = Transform.getOrNull(crateMesh)
  if (t === null || t.scale.x <= 0) return null
  return Vector3.create(t.position.x, t.position.y, t.position.z)
}
