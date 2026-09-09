import { engine, Transform, MeshRenderer, MeshCollider, Material, PointerEvents, PointerEventType, InputAction, inputSystem, Entity, ColliderLayer, Tween, TweenSequence, TweenLoop, EasingFunction } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { Fusion, FUSION_POS, FUSION_NEEDS, FUSION_ECHELLE, FUSION_RANGE } from '../shared/schemas'
import { room } from '../shared/messages'
import { RARITIES, rarityOf, mutationDe, itemName, itemColor } from '../shared/loot-table'
import { plasticDe, plastic, vif, TOY } from './toy'
import { carryView } from './carry'
import { pushToFeed } from './theft'
import { revealItem } from './box'
import { openFuser, closeFuser, fuserPanelView } from './fusion-ui'
import { clicMonde } from './monde'

/**
 * The fusion machine, client side: a drum on a plinth beside the records board, three
 * sockets on its face and a dome on top.
 *
 * What it shows is decided by two sources. The sockets are YOURS: they light with what you
 * have fed so far, read from the per-player state the server sends. The dome is EVERYONE'S:
 * it takes the colour of the last thing that came out of the machine, for a while, so a
 * player crossing the plaza sees that somebody just made a Rare, which is the point of
 * putting the machine where people walk.
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

export function setupFuser(): void {
  const racine = engine.addEntity()
  Transform.create(racine, {
    position: Vector3.create(FUSION_POS.x, 0, FUSION_POS.z),
    // Un tiers plus grande: tout est enfant de cette racine, donc le socle, le tambour, son
    // collisionneur et les etiquettes suivent d'un seul nombre.
    scale: Vector3.create(FUSION_ECHELLE, FUSION_ECHELLE, FUSION_ECHELLE)
  })

  const socle = engine.addEntity()
  Transform.create(socle, { parent: racine, position: Vector3.create(0, 0.15, 0), scale: Vector3.create(2.6, 0.3, 2.6) })
  MeshRenderer.setBox(socle)
  MeshCollider.setBox(socle)
  Material.setPbrMaterial(socle, plastic(TOY.plinth))

  const tambour = engine.addEntity()
  Transform.create(tambour, { parent: racine, position: Vector3.create(0, 1.1, 0), scale: Vector3.create(1.8, 1.6, 1.8) })
  MeshRenderer.setCylinder(tambour, 0.5, 0.5)
  // Solid as well as clickable: the drum stands still on its plinth, so a body there costs
  // nothing and stops a player walking through the machine (owner, 4 Sep).
  MeshCollider.setCylinder(tambour, 0.5, 0.5, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)
  Material.setPbrMaterial(tambour, plastic(TOY.belt))
  PointerEvents.create(tambour, {
    pointerEvents: [
      { eventType: PointerEventType.PET_DOWN, eventInfo: { showFeedback: false, button: InputAction.IA_POINTER, hoverText: `Fuse  ·  ${FUSION_NEEDS} of a kind become one better` } }
    ]
  })

  /*
    La boule LEVITE, et c'est le canal qui manquait.

    Elle est deja rouge, donc la couleur travaille. Ce qui manquait est le MOUVEMENT, et ce
    n'est pas une preference: la peripherie de la retine voit mal les details et mal les
    couleurs, mais elle est tres sensible au deplacement. Un objet rouge immobile au bord du
    champ de vision est donc faible, le meme objet qui bouge est fort. C'est la raison precise
    pour laquelle les testeurs pouvaient passer a cote sans le voir.

    Le flottement est porte par un PARENT et non par le dome: une entite ne porte qu'un seul
    tween, et le dome garde le sien, la secousse elastique de la fusion. Composer par le
    parentage est la meme solution que pour la piece qui tombe en tournant.
  */
  /*
    Elle flotte AU-DESSUS du tambour, ce qui n'etait pas le cas.

    Au bas de sa vague elle etait a 2,35 pour un rayon de 0,65: son equateur passait sous le
    sommet du tambour, qui est a 1,90. Elle n'y levitait pas, elle y etait POSEE, et une boule
    posee sur un tambour n'a pas de raison d'attirer l'oeil. Le repos monte a 2,70, ce qui
    ouvre vingt centimetres de vide sous elle, et c'est le vide qui dit "elle flotte", pas le
    mouvement. Les deux etiquettes montent d'autant: au sommet de la vague le dome atteignait
    deja 3,37 alors que la ligne d'explication est a 3,10, donc la boule mangeait le milieu de
    sa propre phrase.
  */
  const flotteur = engine.addEntity()
  Transform.create(flotteur, { parent: racine, position: Vector3.create(0, 2.70, 0) })
  Tween.create(flotteur, {
    mode: Tween.Mode.Move({ start: Vector3.create(0, 2.70, 0), end: Vector3.create(0, 3.08, 0) }),
    duration: 2100,
    easingFunction: EasingFunction.EF_EASESINE
  })
  // Une sequence VIDE en va-et-vient fait boucler le tween de base: c'est la forme documentee
  // pour un mouvement qui respire, et elle ne coute pas une seconde entite.
  TweenSequence.create(flotteur, { sequence: [], loop: TweenLoop.TL_YOYO })

  const dome = engine.addEntity()
  Transform.create(dome, { parent: flotteur, position: Vector3.Zero(), scale: Vector3.create(1.3, 1.3, 1.3) })
  MeshRenderer.setSphere(dome)
  Material.setPbrMaterial(dome, plastic(TOY.wallCream))
  const lampe = engine.addEntity()
  Transform.create(lampe, { parent: dome })

  const prises: Entity[] = []
  for (let i = 0; i < FUSION_NEEDS; i++) {
    const p = engine.addEntity()
    Transform.create(p, { parent: racine, position: Vector3.create((i - 1) * 0.5, 1.15, -0.92), scale: Vector3.create(0.3, 0.3, 0.3) })
    MeshRenderer.setSphere(p)
    Material.setPbrMaterial(p, plastic(TOY.beltRing))
    prises.push(p)
  }

  /*
    PLUS AUCUN TEXTE AU-DESSUS DE LA MACHINE.

    Il y en avait deux: l'enseigne FUSE et la phrase qui explique la regle. La phrase, personne
    ne la lit: c'est une consigne posee en l'air au-dessus d'un objet, la forme meme du bruit
    visuel. Et l'enseigne partait avec, sur le meme argument: la machine est deja signifiee par
    le jeu lui-meme, un tambour rouge avec une boule qui levite et respire au milieu de la
    place, plus le verbe FUSE sur le bouton contextuel des qu'on s'en approche (proprietaire,
    7 Sep). Un repere qui se voit n'a pas besoin de se nommer.

    Ce que ca rend: quatre plans de glyphe et leurs quatre materiaux, plus deux `TextShape` et
    leurs deux draws. Petit, mais le compteur de materiaux est le seul qui approche son plafond
    (366 sur 400 au champ plein, mesure du 7 Sep), et une primitive y compte pour un.
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
    pushToFeed(`${d.byName} fused a ${itemName(d.rarity, d.mutation)}`)
  })

  let dessine = ''
  /*
    Le dome ENCAISSE le coup, au lieu de s'allumer doucement.

    Il brillait quarante-cinq secondes apres une fusion, ce qui raconte "il s'est passe quelque
    chose ici recemment", pas "ca vient d'arriver". Le fuser est le seul acte deterministe du
    jeu, celui qu'on paie plus cher que le hasard pour l'obtenir, et il n'avait aucun instant.
    Une secousse elastique d'une demi-seconde sur une entite qui existe deja, declenchee sur le
    changement de `atMs`, donne l'impact sans un objet ni une interface de plus.
  */
  let lastPulse = 0
  let pulseVu = -1
  const DOME = Vector3.create(1.3, 1.3, 1.3)
  let vuFusion = 0
  let fusionLocal = -1e9
  engine.addSystem(() => {
    // A toy in hand feeds the machine; empty hands open the panel that fuses from the shelves.
    if (clicMonde(tambour)) {
      if (carryView.code < 0) openFuser()
      else void room.send('feedFusion', {})
    }

    /*
      THE WINDOW FOLLOWS THE MACHINE, and closes when the player leaves it.

      Nothing was closing it, so a player could open the panel, walk home, and press FUSE from
      their own base (owner, 9 Sep). The economy was never exposed: the server measures the
      distance itself before it fuses anything (`pres`, src/server/fusion.ts, refused with "walk
      up to the fuser"). What was exposed is the interface, which offered a control that could
      only be refused, and a panel that belongs to a machine has no business standing in front
      of a base.

      The range is the SERVER's constant, not a second copy of it: a window that closes on one
      number while the fusion is granted on another would disagree with itself at the edge.
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
    // Same rule as the boss flash: the stamp is the SERVER's clock, so the client watches it
    // CHANGE and runs the window on its own clock. Subtracting two clocks either never opens
    // the window or never closes it, depending which way the skew runs (owner, 5 Sep).
    if (f !== null && f.atMs !== vuFusion) { vuFusion = f.atMs; if (f.atMs > 0) fusionLocal = now }
    const brille = f !== null && f.lastCode >= 0 && now - fusionLocal < DOME_BRILLE_MS
    // La respiration tourne hors de la cle: elle change tout le temps, la cle ne change presque
    // jamais. Elle se tait pendant qu'une fusion tient le dome, qui a sa couleur a lui.
    if (brille) pulseVu = -1
    else {
      const onde = 0.5 - 0.5 * Math.cos(((now % PULSE_MS) / PULSE_MS) * Math.PI * 2)
      const pas = Math.round(onde * PULSE_PAS)
      if (pas !== pulseVu) { pulseVu = pas; Material.setPbrMaterial(dome, domeRepos(pas / PULSE_PAS)) }
    }
    const mienne = fuserView.codes.length
    const rareteMienne = mienne > 0 ? rarityOf(fuserView.codes[0]) : -1
    // One string for everything drawn, rewritten only when it changes: a material or a light
    // written every frame is a network update every frame.
    if (f !== null && f.atMs > lastPulse && f.lastCode >= 0) {
      lastPulse = f.atMs
      // Une seule secousse, sans sequence: elle part large et revient a sa taille.
      Tween.createOrReplace(dome, {
        mode: Tween.Mode.Scale({ start: Vector3.create(DOME.x * 1.55, DOME.y * 1.55, DOME.z * 1.55), end: DOME }),
        duration: 520,
        easingFunction: EasingFunction.EF_EASEOUTELASTIC
      })
    }

    const cle = `${mienne}|${rareteMienne}|${brille ? f!.lastCode : -1}|${f?.count ?? 0}|${f?.rarity ?? -1}|${f?.byName ?? ''}`
    if (cle === dessine) return
    dessine = cle

    for (let i = 0; i < prises.length; i++) {
      const plein = i < mienne
      Material.setPbrMaterial(prises[i], plein ? plasticDe(couleur(rareteMienne), 1.4) : plastic(TOY.beltRing))
    }
    if (brille && f !== null) {
      const c = couleur(rarityOf(f.lastCode), mutationDe(f.lastCode))
      /*
        NO LightSource here, and none anywhere else in this scene.

        This lamp was created when the dome lit and deleted when it went out, and that pair
        crashes the desktop client: `LightSourceApplyPropertiesSystem` dereferences a Unity
        Light that the deletion already destroyed, throws a NullReferenceException and the
        scene STOPS. Read in the client's own log at 14:31:41.503, the exact second the owner
        fused three Legendaries and the game froze on him (5 Sep). The component is also
        absent from the mobile client before its v1.13.0, so it was buying a crash to light
        something a phone never saw. The emissive dome carries the whole effect.
      */
      Material.setPbrMaterial(dome, plasticDe(Color4.create(c.r, c.g, c.b, 1), 1.6))
    } else {
      // Rien a ecrire ici: la respiration reprend la main a l'image suivante et pose le repos.
      pulseVu = -1
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
