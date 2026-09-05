import { Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'

/**
 * Le seul endroit d'ou le jeu deplace un joueur, et le seul qui l'ecrive.
 *
 * Ce n'est pas une regle de plus sur le joueur: il va ou il veut, y compris hors du terrain.
 * C'est un point d'observation. Cinq endroits appelaient `movePlayerTo` directement, chacun
 * calculant sa cible a partir d'une position lue ailleurs, et un deplacement inattendu ne
 * laissait aucune trace: le 28 Aug un socle lu a la place de sa racine (coordonnees locales,
 * donc zero) envoyait au coin de la carte, et il a fallu relire tout le client pour le voir.
 * Chaque deplacement dit maintenant QUI l'a demande et OU, dans le journal du client.
 *
 * Seules les valeurs non finies sont refusees, et rien d'autre. Une marge sur le bord du
 * terrain paraissait prudente et etait fausse: `EDGE_MARGIN` vaut 9, une base posee au plus
 * pres du bord a sa porte a un demi-metre du mur, et ce retour chez soi legitime se serait
 * fait refuser sans un mot. Une garde qui bloque le jeu reel coute plus que ce qu'elle protege.
 */
function fini(n: number): boolean { return typeof n === 'number' && isFinite(n) }

/*
  The move is logged with its caller's name and NOT announced on screen. For three days a
  toast said "MOVED BY: <caller>" at every move, which found one wrong caller in that time and
  then kept reading as an alarm for things that are not alarms: being set down outside a base
  that just moved is the game keeping its own rule, and a rule kept should just be, not ring
  (owner, 5 Sep: "c'est un evenement qui doit pas sonner d'alerte, juste etre la").
*/
export function moveTo(quoi: string, cible: Vector3, camera: Vector3): boolean {
  const ou = `${cible.x.toFixed(1)}, ${cible.y.toFixed(1)}, ${cible.z.toFixed(1)}`
  if (!fini(cible.x) || !fini(cible.y) || !fini(cible.z)) {
    console.log(`[CLIENT] deplacement REFUSE (${quoi}), cible non finie: ${ou}`)
    return false
  }
  console.log(`[CLIENT] deplacement (${quoi}) vers ${ou}`)
  void movePlayerTo({ newRelativePosition: cible, cameraTarget: camera })
  return true
}
