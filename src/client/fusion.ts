import { engine, Transform, MeshRenderer, MeshCollider, Material, PointerEvents, PointerEventType, InputAction, inputSystem, TextShape, Billboard, BillboardMode, Entity, ColliderLayer, Tween, EasingFunction } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { Fusion, FUSION_POS, FUSION_NEEDS } from '../shared/schemas'
import { room } from '../shared/messages'
import { RARITIES, rarityOf, mutationDe, itemName, itemColor } from '../shared/loot-table'
import { plasticDe, plastic, vif, TOY } from './toy'
import { carryView } from './carry'
import { alerter, pushToFeed } from './theft'
import { revealItem } from './box'
import { openFuser } from './fusion-ui'
import { TOAST } from './theme'
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
const AMPOULE = 16000

function couleur(rarete: number, mut = 0): Color4 {
  return vif(itemColor(Math.max(0, Math.min(rarete, RARITIES.length - 1)), mut))
}

export function setupFuser(): void {
  const racine = engine.addEntity()
  Transform.create(racine, { position: Vector3.create(FUSION_POS.x, 0, FUSION_POS.z) })

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
      { eventType: PointerEventType.PET_DOWN, eventInfo: { button: InputAction.IA_POINTER, hoverText: `Fuser  ·  ${FUSION_NEEDS} of a kind become one better` } }
    ]
  })

  const dome = engine.addEntity()
  Transform.create(dome, { parent: racine, position: Vector3.create(0, 2.35, 0), scale: Vector3.create(1.3, 1.3, 1.3) })
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

  const titre = engine.addEntity()
  Transform.create(titre, { parent: racine, position: Vector3.create(0, 3.5, 0), scale: Vector3.create(0.5, 0.5, 0.5) })
  Billboard.create(titre, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(titre, { text: 'FUSER', fontSize: 5, textColor: Color4.fromHexString(TOY.beltRail + 'ff'), outlineWidth: 0.22, outlineColor: NOIR })
  const ligne = engine.addEntity()
  Transform.create(ligne, { parent: racine, position: Vector3.create(0, 3.1, 0), scale: Vector3.create(0.5, 0.5, 0.5) })
  Billboard.create(ligne, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(ligne, { text: `${FUSION_NEEDS} of a kind become one better  ·  tap it to fuse from your base`, fontSize: 2.4, textColor: Color4.White(), outlineWidth: 0.22, outlineColor: NOIR })

  room.onMessage('fusionState', (d) => {
    fuserView.codes = [...d.codes]
    if (d.made >= 0) {
      // La meme revelation que pour une caisse: c'est deja le moment "vous avez obtenu
      // quelque chose", et le fuser n'en avait aucun. Le texte reste, plus court.
      revealItem(d.made)
      alerter(`FUSED  ·  a ${itemName(rarityOf(d.made), mutationDe(d.made)).toUpperCase()} is in your hand`, '#4dd2ff', TOAST.result)
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
  const DOME = Vector3.create(1.3, 1.3, 1.3)
  let vuFusion = 0
  let fusionLocal = -1e9
  engine.addSystem(() => {
    // A toy in hand feeds the machine; empty hands open the panel that fuses from the shelves.
    if (clicMonde(tambour)) {
      if (carryView.code < 0) openFuser()
      else void room.send('feedFusion', {})
    }

    let f: { byName: string; rarity: number; count: number; lastName: string; lastCode: number; atMs: number } | null = null
    for (const [, v] of engine.getEntitiesWith(Fusion)) { f = v; break }
    const now = Date.now()
    // Same rule as the boss flash: the stamp is the SERVER's clock, so the client watches it
    // CHANGE and runs the window on its own clock. Subtracting two clocks either never opens
    // the window or never closes it, depending which way the skew runs (owner, 5 Sep).
    if (f !== null && f.atMs !== vuFusion) { vuFusion = f.atMs; if (f.atMs > 0) fusionLocal = now }
    const brille = f !== null && f.lastCode >= 0 && now - fusionLocal < DOME_BRILLE_MS
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
      Material.setPbrMaterial(dome, plastic(TOY.wallCream))
    }
    const t = TextShape.getMutableOrNull(ligne)
    if (t !== null) {
      t.text = brille && f !== null
        ? `${f.lastName} made a ${itemName(rarityOf(f.lastCode), mutationDe(f.lastCode))}`
        : mienne > 0
          ? `yours: ${mienne}/${FUSION_NEEDS} ${RARITIES[rareteMienne]?.name ?? ''}`
          : `${FUSION_NEEDS} of a kind become one better  ·  tap it to fuse from your base`
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
