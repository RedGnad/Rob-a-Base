import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { Plot, CENTER, BASE_SIDE, FLOOR_HEIGHT, SCENE_SIDE, orientToBase, invalidReason, freeSpotNear, snapToGrid } from '../shared/schemas'
import { moveTo } from './deplacer'
import { poseView } from './pose'
import { myClientAddress, theftView } from './theft'
import { basesConnues } from './slots'
import { alerter } from './theft'
import { TOAST } from './theme'
import { cue } from './ui-kit'

function maBase(): Vector3 | null {
  const moi = myClientAddress()
  if (moi === '') return null
  for (const [e, p] of engine.getEntitiesWith(Plot)) {
    if (p.ownerId.toLowerCase() !== moi) continue
    const t = Transform.getOrNull(e)
    if (t === null) return null
    // In front of the DOOR, which faces the belt: a base north of the belt is turned round,
    // so the door is on the -z side there. `orientToBase` puts the landing on the right side.
    const o = orientToBase(t.position.z, 0, BASE_SIDE / 2 + 1.5)
    return Vector3.create(t.position.x + o.dx, 0, t.position.z + o.dz)
  }
  return null
}

export const travelView = {
  peutRentrer: false,
  open: false
}

export function setupTravel(): void {
  engine.addSystem(() => { travelView.peutRentrer = maBase() !== null })
  setupGardeFou()
  apparaitreChezSoi()
}

/**
 * On apparait chez soi, une fois, a la connexion.
 *
 * C'est ce que fait la reference: chaque parcelle contient sa propre part `Spawn`, le serveur
 * y teleporte son proprietaire (`Plot:TeleportOwnerToSpawn`, code decompile lu le 1 Sep), et
 * son wiki le dit en une ligne, "You spawn at your base". La raison tient au jeu: la base est
 * ce qui produit, ce qui se fait voler, et le seul endroit ou l'on ouvre une caisse. Arriver
 * ailleurs commence chaque session par une marche.
 *
 * Un joueur qui n'a pas encore de base garde le point d'apparition de la scene: il n'a pas de
 * chez-soi ou l'send, et c'est la que le marqueur de pose l'attend.
 *
 * Une seule fois, et seulement dans les vingt premieres secondes: la base arrive du serveur
 * quelques instants apres l'entree, alors on l'attend, mais on ne teleporte jamais quelqu'un
 * qui a commence a jouer.
 */
function apparaitreChezSoi(): void {
  let attente = 0
  let fait = false
  engine.addSystem((dt: number) => {
    if (fait) return
    /*
      Poser sa base n'est pas arriver chez soi.

      Une base POSEE arrive du serveur par le meme chemin qu'une base RESTAUREE, alors ce
      systeme, qui attend vingt secondes qu'une base apparaisse, prenait l'une pour l'autre et
      teleportait a sa porte le joueur qui venait juste de choisir sa place (proprietaire,
      2 Sep, "j'ai pose ma base et j'ai eu MOVED tout de suite"). Il se tient deja exactement
      ou il a voulu.
    */
    if (poseView.pending) { fait = true; return }
    attente += dt
    if (attente > 20) { fait = true; return }
    const chez = maBase()
    if (chez === null) {
      /*
        A newcomer is set down somewhere they can actually build.

        The scene's spawn point is a good spot by construction: it sits 24 m clear of the belt
        and outside the plaza's reserved ellipse (checked against `invalidReason`, 6 Sep). What
        it cannot know is where the OTHER bases are, and the field fills up: a player arriving
        next to a neighbour's wall met a red ghost and an inert hammer as their first frame,
        with no way to read why. So on a first arrival, once the server has said this player
        owns nothing, an occupied spawn is nudged to the nearest legal square. Only then, only
        once, and never for somebody who already has a base to go home to.
      */
      if (!theftView.walletRecu || theftView.basePosee) return
      if (!Transform.has(engine.PlayerEntity)) return
      const p = Transform.get(engine.PlayerEntity).position
      if (invalidReason(snapToGrid(p.x), snapToGrid(p.z), SCENE_SIDE, basesConnues()) === null) return
      const libre = freeSpotNear(p.x, p.z, SCENE_SIDE, basesConnues())
      if (libre === null) return
      fait = true
      moveTo('arrivee sur une place libre', Vector3.create(libre.x, 0, libre.z), Vector3.create(CENTER.x, 1.6, CENTER.z))
      return
    }
    fait = true
    moveTo('apparition', chez, Vector3.create(CENTER.x, 1.6, CENTER.z))
  })
}

/**
 * Nobody is ever outside the map, whatever put them there.
 *
 * Moving a base once threw the owner off the terrain (5 Sep, once out of many): a building
 * appears exactly where a player stands, and if a wall lands on them the client's character
 * controller resolves the overlap by pushing, which at that size can be a long way. We cannot
 * stop the push from a scene, and we do not need to: being outside the parcels is never a
 * legitimate place to be, so a watchdog brings the player back to their own base, or to the
 * plaza, and says so rather than teleporting silently.
 *
 * Half a second between checks, one comparison each: it cannot cost anything, and it closes
 * every cause at once rather than the one we happened to reproduce.
 */
function setupGardeFou(): void {
  let acc = 0
  engine.addSystem((dt: number) => {
    acc += dt
    if (acc < 0.5) return
    acc = 0
    const t = Transform.getOrNull(engine.PlayerEntity)
    if (t === null) return
    const p = t.position
    const dehors = p.x < 1 || p.x > SCENE_SIDE - 1 || p.z < 1 || p.z > SCENE_SIDE - 1 || p.y > 80 || p.y < -5
    if (!dehors) return
    const chez = maBase()
    const cible = chez ?? Vector3.create(CENTER.x, 0, CENTER.z - 4.5)
    alerter('BROUGHT YOU BACK IN', '#ffd166', TOAST.warning)
    moveTo('garde-fou', chez === null ? cible : Vector3.create(cible.x, FLOOR_HEIGHT, cible.z - 4),
      Vector3.create(cible.x, 2, cible.z))
  })
}

/*
  Un deplacement s'entend, parce qu'il n'a pas de geste.

  Toutes les autres actions du jeu ont un corps qui les execute: on marche, on frappe, on
  ramasse. Un voyage remplace l'ecran d'un coup, sans transition, et c'est le seul endroit ou
  le joueur peut douter d'avoir appuye. Le son emprunte a l'ascenseur, moins fort: le jeu s'en
  sert deja pour dire "on te deplace", et lui inventer un clip separe aurait ajoute un actif
  pour dire la meme chose.
*/
export function rentrer(): void {
  const p = maBase()
  if (p === null) { alerter('YOU HAVE NO BASE YET', '#ffd166', TOAST.warning); return }
  cue('lift.wav', 0.55)
  moveTo('retour-base', p, Vector3.create(p.x, FLOOR_HEIGHT, p.z - 4))
}

export function goToBelt(): void {
  const p = Vector3.create(CENTER.x, 0, CENTER.z - 4.5)
  cue('lift.wav', 0.55)
  moveTo('tapis', p, Vector3.create(CENTER.x, 2.5, CENTER.z))
}
