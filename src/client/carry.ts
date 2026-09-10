import {
  engine, Transform, MeshRenderer, Material, AvatarAttach, AvatarAnchorPointType,
  Entity, Billboard, BillboardMode, TextShape, inputSystem, InputAction, PointerEventType ,
  Tween, TweenSequence, TweenLoop, EasingFunction} from '@dcl/sdk/ecs'
import { sendOrHold } from './intent'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { Carried } from '../shared/schemas'
import { itemColor, rarity, rarityOf, mutationDe, traitsDe, nomDuCode, tailleAffichee } from '../shared/loot-table'
import { room } from '../shared/messages'
import { myClientAddress, alerter } from './theft'
import { setCarrying } from './locomotion'
import { placeTarget } from './plots'
import { refuseWithSound } from './box'
import { verb } from './verb'
import { rarityShape, handShape, clearShape, demonter, remonter, plasticDe, PEDESTAL_THICKNESS } from './toy'
import { TOAST } from './theme'
import { LISIBLE_3D } from './texte3d'

/**
 * What everyone sees while somebody is holding something.
 *
 * The state itself lives on the server; this only draws it. It matters that it is drawn on
 * every screen and not just the carrier's: a thief walking home with a trophy in their fist,
 * in front of the person they took it from, is the clearest thing this game has to show, and
 * it is worth nothing if only the thief can see it.
 *
 * `AvatarAttach` takes an `avatarId`, so the item rides the right player's hand on every
 * client. The bone is animated, which would be a defect for something you aim with and is
 * exactly right for something you are carrying: it swings as they run.
 */

export const carryView = { code: -1, name: '', vole: false }
/** The thief's column of light, in metres: above the tallest tower, under the boss's sixty. */
const COLONNE_H = 50

const vues = new Map<number, { corps: Entity; etiquette: Entity; anneau: Entity | null; colonne: Entity | null }>()

/*
  The marker that says where it will land, before it lands.

  The same shape the base placement uses, for the same reason: a choice you make by walking is
  only a choice if you can see what you are choosing. It sits on the pedestal the item would
  take, so putting something down stops being a guess and the arranging of a building becomes
  something you do on purpose. Hidden by scaling to zero rather than by removing the entity,
  because it is one box and it changes several times a second.
*/
const VERT = Color4.create(0.35, 0.95, 0.45, 0.42)
let marqueur: Entity
let targetIndex = -1
/*
  Le fantome est LA PIECE, pas un cube.

  Un cube vert disait "quelque chose ira la"; il ne disait pas quoi, ni quelle taille ca fera
  sur l'etagere, ce qui est precisement ce qu'on choisit en rangeant sa base (proprietaire,
  2 Sep). Il porte donc le meme modele, a la meme echelle et a la meme hauteur que la piece
  aura une fois posee: c'est le calcul de `plots.ts`, repris a l'identique. La teinte reste le
  vert translucide de tous les marqueurs du jeu, parce que c'est lui qui dit "ici, oui" et
  qu'une piece a sa vraie couleur se lirait comme une piece deja posee.
*/
const MAT_FANTOME = plasticDe(VERT, 0.7)
const JEU = 0.02
let vuCode = -1

/** La taille qu'aura la piece sur son socle. La formule vit dans `loot-table.ts`, une seule fois. */
const tailleDe = tailleAffichee

export function setupCarry(): void {
  marqueur = engine.addEntity()
  Transform.create(marqueur, { position: Vector3.create(0, -50, 0), scale: Vector3.Zero() })
  MeshRenderer.setBox(marqueur)
  Material.setPbrMaterial(marqueur, MAT_FANTOME)

  engine.addSystem(() => {
    const t = Transform.getMutableOrNull(marqueur)
    if (t === null) return
    /*
      Meme regle que le marqueur de caisse: il obeit au verb, pas a l'inventaire.

      Les mains pleines ne suffisent pas. Devant la machine a fusion le bouton dit NOURRIR,
      dehors il dit LACHER, et dans ces deux cas montrer un socle vise serait mentir sur ce que
      la touche va faire.
    */
    const cible = verb.id === 'poser-objet' ? placeTarget() : null
    const code = carryView.code
    if (cible === null || code < 0) {
      targetIndex = -1
      if (t.scale.x !== 0) t.scale = Vector3.Zero()
      return
    }
    targetIndex = cible.index
    /*
      Le modele ne se remonte qu'au CHANGEMENT de piece: `remonter` recharge un GLTF et
      `rarityShape` reecrit les materiaux, deux choses qui n'ont rien a faire dans une
      image ou rien n'a change. La teinte differee est prevue: le module suit les modeles en
      cours de chargement et applique le dernier materiau demande a leur arrivee.
    */
    if (code !== vuCode) {
      vuCode = code
      remonter(marqueur, `item-${rarityOf(code)}.glb`)
      rarityShape(marqueur, rarityOf(code), MAT_FANTOME)
    }
    // Exactement ou elle se posera: le dessus de la dalle, un jeu d'air, le socle, puis la
    // piece debout sur son centre. Le meme empilement que `plots.ts`.
    const taille = tailleDe(code)
    t.position = Vector3.create(cible.pos.x, cible.pos.y + JEU + PEDESTAL_THICKNESS + taille / 2, cible.pos.z)
    t.scale = Vector3.create(taille, taille, taille)
  })

  room.onMessage('carryResult', (d) => {
    if (d.ok) return
    // Only the failures need saying: a success is already visible in the player's own hand.
    alerter(d.reason.toUpperCase(), '#ffd166', TOAST.result)
  })

  engine.addSystem(() => {
    const moi = myClientAddress()
    let porteMoi = -1
    let volee = false
    const vivants = new Set<number>()

    for (const [e, c] of engine.getEntitiesWith(Carried)) {
      const id = e as unknown as number
      vivants.add(id)
      if (c.holder.toLowerCase() === moi) { porteMoi = c.code; volee = c.origin.toLowerCase() !== moi }

      if (!vues.has(id)) {
        const r = rarityOf(c.code)
        const teinte = Color4.fromHexString(itemColor(r, mutationDe(c.code)) + 'ff')

        const corps = engine.addEntity()
        // A toy in a hand reads at about a fifth of a metre; a third looked like a suitcase.
        Transform.create(corps, { position: Vector3.create(0, 0.12, 0.16), scale: Vector3.create(0.2, 0.2, 0.2) })
        const mat = plasticDe(teinte, 1.1)
        /*
          La piece doit etre MONTEE, sinon la main est vide.

          `rarityShape` ne dessine plus de silhouette pour les raretes zero a cinq: depuis que
          le jeu d'echecs existe, ces paliers ont un vrai modele et l'ancienne silhouette ne
          faisait que clignoter avant son arrivee. Le socle, lui, monte ce modele; la main ne le
          montait pas, alors elle ne dessinait plus rien du tout, pour toutes les raretes sauf
          le Secret qui garde son etoile. On ne voyait plus qu'on tenait quelque chose
          (proprietaire, 2 Sep, apres une fusion). C'est le meme geste qu'au socle et qu'au
          fantome de pose: monter, puis teindre.
        */
        handShape(corps, r, mat)
        AvatarAttach.create(corps, {
          avatarId: c.holder,
          anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND
        })

        /*
          Named above the head, so a witness knows what is being walked off with.

          Two entities, because the label had two masters of its rotation. `AvatarAttach`
          writes the entity's whole transform from the avatar's name tag anchor, which turns
          with the character, and `Billboard` writes the rotation to face the camera; on one
          entity they overwrite each other by turns, so the name read the right way, then
          mirrored, then somewhere between the two, and flickered while the carrier turned
          (owner, 6 Sep). The anchor now rides an invisible holder, and the text is its
          child: the holder gives it the place, the billboard alone gives it the facing.
        */
        const porteEtiquette = engine.addEntity()
        Transform.create(porteEtiquette, { position: Vector3.Zero() })
        AvatarAttach.create(porteEtiquette, {
          avatarId: c.holder,
          anchorPointId: AvatarAnchorPointType.AAPT_NAME_TAG
        })
        const etiquette = engine.addEntity()
        Transform.create(etiquette, { parent: porteEtiquette, position: Vector3.create(0, 0.4, 0), scale: Vector3.create(0.34, 0.34, 0.34) })
        Billboard.create(etiquette, { billboardMode: BillboardMode.BM_Y })
        TextShape.create(etiquette, {
          text: nomDuCode(c.code),
          fontSize: 3, textColor: teinte, ...LISIBLE_3D
        })

        /*
          The burden, drawn on the ground under the thief.

          Carrying stolen goods costs more than half the carrier's speed, and until now the
          only sign of it was that they were slow, which reads as nothing at all: a witness
          cannot tell a burdened thief from a player who happens to be walking (owner,
          1 Sep). The genre marks its states on the character, so this is a ring at the
          feet, in the theft red, breathing so it cannot be mistaken for scenery, attached
          to the avatar's own position so every client draws it for every thief without a
          message of its own. Only for goods that are NOT the carrier's: taking your own
          toy off your own shelf is tidying, and costs a fifth of the speed, not a half.
        */
        let anneau: Entity | null = null
        if (c.origin.toLowerCase() !== c.holder.toLowerCase()) {
          anneau = engine.addEntity()
          Transform.create(anneau, { position: Vector3.create(0, 0.06, 0), scale: Vector3.create(1.5, 0.03, 1.5) })
          MeshRenderer.setCylinder(anneau, 0.5, 0.5)
          Material.setPbrMaterial(anneau, plasticDe(Color4.fromHexString('#ff5252ff'), 2.2))
          Tween.setScale(anneau, Vector3.create(1.5, 0.03, 1.5), Vector3.create(2.05, 0.03, 2.05), 720, EasingFunction.EF_EASESINE)
          TweenSequence.createOrReplace(anneau, { sequence: [], loop: TweenLoop.TL_YOYO })
          AvatarAttach.create(anneau, { avatarId: c.holder, anchorPointId: AvatarAnchorPointType.AAPT_POSITION })
        }

        /*
          A column of light on the thief, read from anywhere on the field.

          The ring at the feet says "thief" to whoever is already looking; nobody else knew a
          theft was under way until the toast, and by then the carrier was out of sight
          (owner, 10 Sep: the raid boss has its beam, a thief running home deserves the same).
          The genre's answer is a beam you run towards, so this is the boss's column with the
          differences that keep the two apart at a glance: in the carried item's own colour
          rather than the raid red, thinner, and fifty metres where the boss stands sixty,
          both above the tallest tower (thirty-four). Like the ring, only for goods that are
          NOT the carrier's, and never on oneself: a beam through the player's own camera is a
          wall, and the burden is already in their hand. Holder plus child, as the label: the
          anchor writes the holder's transform, the child keeps its own height and scale.
        */
        let colonne: Entity | null = null
        if (c.origin.toLowerCase() !== c.holder.toLowerCase() && c.holder.toLowerCase() !== moi) {
          colonne = engine.addEntity()
          Transform.create(colonne, { position: Vector3.Zero() })
          AvatarAttach.create(colonne, { avatarId: c.holder, anchorPointId: AvatarAnchorPointType.AAPT_POSITION })
          const faisceau = engine.addEntity()
          Transform.create(faisceau, { parent: colonne, position: Vector3.create(0, COLONNE_H / 2, 0), scale: Vector3.create(0.7, COLONNE_H, 0.7) })
          MeshRenderer.setCylinder(faisceau, 0.5, 0.5)
          Material.setPbrMaterial(faisceau, {
            albedoColor: Color4.create(teinte.r, teinte.g, teinte.b, 0.35),
            emissiveColor: Color3.create(teinte.r, teinte.g, teinte.b),
            emissiveIntensity: 1.6,
            alphaTest: 0,
            transparencyMode: 2,
            roughness: 1
          })
        }

        // The holder is what is kept: removing it with its children takes the text along.
        vues.set(id, { corps, etiquette: porteEtiquette, anneau, colonne })
      }
    }

    for (const [id, v] of [...vues]) {
      if (vivants.has(id)) continue
      demonter(v.corps)
      clearShape(v.corps)
      engine.removeEntity(v.corps)
      engine.removeEntityWithChildren(v.etiquette)
      if (v.anneau !== null) engine.removeEntity(v.anneau)
      if (v.colonne !== null) engine.removeEntityWithChildren(v.colonne)
      vues.delete(id)
    }

    if (porteMoi !== carryView.code || volee !== carryView.vole) {
      carryView.code = porteMoi
      carryView.vole = volee
      if (porteMoi < 0 && vuCode >= 0) { vuCode = -1; demonter(marqueur); clearShape(marqueur) }
      setCarrying(porteMoi < 0 ? 'non' : volee ? 'vole' : 'sien')
      carryView.name = porteMoi < 0 ? '' : nomDuCode(porteMoi)
    }
  })
}

export function pickUp(slot: number): void { void room.send('pickUp', { slot }) }
/**
 * Poser, ou dire au son qu'il n'y a pas de place, jamais rien entre les deux.
 *
 * `targetIndex` est le socle libre le plus proche SUR L'ETAGE OU L'ON SE TIENT: un etage plein
 * ne renvoie rien, et le marqueur vert a deja disparu. Une pression dans cet etat ne doit ni
 * partir au serveur pour se faire refuser, ni afficher une plaque "FLOOR FULL" qu'il faudrait
 * relire a chaque fois. Un son suffit: on l'entend une fois, on a compris, et l'ecran reste
 * libre (proprietaire, 1 Sep).
 */
export function placeDown(ownerId: string): void {
  if (targetIndex < 0) {
    /*
      Un son ET un mot, une seconde et demie.

      Le 1er Sep on avait tranche pour le son seul: "on l'entend une fois, on a comprit, et
      l'ecran reste libre". A l'usage ce n'etait pas vrai, parce que le son ne dit pas POURQUOI
      rien ne se passe, et la meme pression refusee peut vouloir dire etage plein, hors de
      portee, ou mauvais etage. Le proprietaire redemande un mot le 3 Sep, tres bref: c'est un
      toast d'une seconde et demie, la plus courte duree du jeu, et pas la plaque qu'on avait
      refusee alors.
    */
    refuseWithSound()
    alerter('FLOOR FULL  ·  GO UP OR MAKE ROOM', '#ffd166', TOAST.result)
    return
  }
  sendOrHold(() => { void room.send('placeDown', { ownerId, slot: targetIndex }) })
}
export function dropCarried(): void { void room.send('dropCarried', {}) }
export function sellCarried(): void { sendOrHold(() => { void room.send('sellCarried', {}) }) }

/**
 * One press sells. The question that used to sit between the press and the sale was cut by
 * the tester as friction; the control is only ever on screen with your own item in hand.
 */
export function vendre(): void {
  if (carryView.code < 0 || carryView.vole) return
  sellCarried()
}

