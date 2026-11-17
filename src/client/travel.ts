import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { Plot, CENTER, BASE_SIDE, FLOOR_HEIGHT, SCENE_SIDE, orientToBase, invalidReason, freeSpotNear, snapToGrid } from '../shared/schemas'
import { moveTo } from './deplacer'
import { poseView } from './pose'
import { loadingView } from './loading'
import { myClientAddress, theftView } from './theft'
import { basesConnues, basesConnuesRecues } from './slots'
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
  arriveHome()
}

/**
 * You appear at home, once, on joining.
 *
 * That is what the reference does: each plot holds its own `Spawn` part and the server
 * teleports its owner there (`Plot:TeleportOwnerToSpawn`, decompiled code read on 1 Sep), and
 * its wiki says it in one line, "You spawn at your base". The reason is the game's: the base is
 * what produces, what gets robbed, and the only place a crate opens. Arriving anywhere else
 * starts every session with a walk.
 *
 * A player with no base yet is set down on a free square, facing it, so their first frame is
 * the place they are about to build on (design page 1, point 1, 17 Nov 2026).
 *
 * Once only. An owner is taken home within twenty seconds of the wallet and never after
 * walking; a player with no base is always set down, unless they have already walked onto a
 * legal square themselves.
 */
/*
  A newcomer is set down in the emptiest eighth of the field.

  One spawn on the north edge of the plaza, and a nudge to the nearest legal square when it
  was taken: every newcomer built against the last one, and the field filled from the north by
  accretion while three sides stayed empty (owner, 10 Sep, after a wave of testers). The ghost
  sits at the player's feet, so where arrivals land is where bases go. The field is cut into
  eight wedges around the centre; the wedge holding the fewest bases wins, the player's own on
  a tie, and the arrival is the nearest legal square to that wedge's anchor on a ring just
  outside the plaza: the spawn is 26 m north of the centre, the anchors sit on an ellipse of
  38 by 30, clear of the reserved 27 by 22. An empty field changes nothing: the player's own
  wedge wins the tie and a legal spawn square is kept as it is.
*/
const ARRIVAL_A = 38
const ARRIVAL_B = 30
const WEDGES = 8
function wedgeOf(x: number, z: number): number {
  const a = Math.atan2(z - CENTER.z, x - CENTER.x)
  return Math.floor(((a + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI / WEDGES)) % WEDGES
}
function arrivalTarget(p: { x: number; z: number }, autres: Array<{ x: number; z: number }>): { x: number; z: number } {
  const counts = new Array<number>(WEDGES).fill(0)
  for (const b of autres) counts[wedgeOf(b.x, b.z)] += 1
  const mine = wedgeOf(p.x, p.z)
  let best = mine
  for (let w = 0; w < WEDGES; w++) if (counts[w] < counts[best]) best = w
  if (best === mine) return { x: p.x, z: p.z }
  const angle = (best + 0.5) * (2 * Math.PI / WEDGES)
  return { x: CENTER.x + ARRIVAL_A * Math.cos(angle), z: CENTER.z + ARRIVAL_B * Math.sin(angle) }
}

/*
  Where the camera looks when a newcomer is set down on their square: across it, away from the
  belt. The square is where they stand, so "facing it" means the avatar on the green marker
  with the beacon over it and the open field beyond, and the belt behind the camera: the first
  moving thing in the frame is the beacon, not the crates (design page 1, point 1, "the eye
  goes to movement before text", core-loop-and-ftue.md).
*/
const ARRIVAL_LOOK_M = 10
function lookAcross(square: { x: number; z: number }): Vector3 {
  const dx = square.x - CENTER.x
  const dz = square.z - CENTER.z
  const d = Math.hypot(dx, dz)
  // A square at the very centre cannot be legal, but a direction is owed all the same: north.
  const ux = d < 0.01 ? 0 : dx / d
  const uz = d < 0.01 ? 1 : dz / d
  return Vector3.create(square.x + ux * ARRIVAL_LOOK_M, 1, square.z + uz * ARRIVAL_LOOK_M)
}

function arriveHome(): void {
  let wait = 0
  let settled = false
  let start: Vector3 | null = null
  /*
    The loading picture stays up until this is settled (ui.tsx, `loadingShown`): the one move
    of the arrival happens under it, and the player opens their eyes already where they stand,
    never watching themselves jump (owner, 10 Sep).
  */
  const settle = (): void => { settled = true; loadingView.placed = true }
  engine.addSystem((dt: number) => {
    if (settled) return
    /*
      Placing your base is not coming home.

      A PLACED base arrives from the server by the same path as a RESTORED one, so this system,
      which waits for a base to appear, took one for the other and teleported to their door the
      player who had just chosen their spot (owner, 2 Sep, "j'ai pose ma base et j'ai eu MOVED
      tout de suite"). They already stand exactly where they wanted.
    */
    if (poseView.pending) { settle(); return }
    /*
      How far the player has walked from where they appeared. A jump of thirty metres or more
      is the client placing the avatar, not a walk: it resets the mark instead of counting.
    */
    let walked = false
    if (Transform.has(engine.PlayerEntity)) {
      const p = Transform.get(engine.PlayerEntity).position
      if (start === null) start = Vector3.create(p.x, p.y, p.z)
      else {
        const d = Vector3.distance(p, start)
        if (d >= 30) start = Vector3.create(p.x, p.y, p.z)
        else if (d > 3) walked = true
      }
    }
    if (!theftView.walletRecu) return

    if (theftView.basePosee) {
      /*
        An owner is taken home once, and only in the first twenty seconds after the wallet:
        the base arrives a moment after it, so it is waited for, but somebody who has begun to
        play (three metres walked) is never teleported.
      */
      if (walked) { settle(); return }
      wait += dt
      if (wait > 20) { settle(); return }
      const home = maBase()
      if (home === null) return
      settle()
      moveTo('apparition', home, Vector3.create(CENTER.x, 1.6, CENTER.z))
      return
    }

    /*
      Every player without a base is set down on a free square, facing it (design page 1,
      point 1, founder's request of 17 Nov 2026).

      This move used to be skipped once the player had walked three metres, or twenty seconds
      after the wallet, and on the live playtest some newcomers started in the belt corridor:
      the moving crates drew them to the belt, they tried to buy with nothing, and did not
      build. Neither skip applies to a player with no base any more. The one exception is a
      player who has walked onto a legal square by themselves: they already stand where the
      rule wants them, and moving them would only undo their own choice.

      It waits for where the OTHER bases stand, which travels on its own message (every 2.5 s),
      not with the wallet: settling before it would read an empty field and call an occupied
      square free (regression review, 11 Sep).
    */
    if (!Transform.has(engine.PlayerEntity)) return
    if (!basesConnuesRecues()) return
    const p = Transform.get(engine.PlayerEntity).position
    const others = basesConnues()
    const onLegalSquare = invalidReason(snapToGrid(p.x), snapToGrid(p.z), SCENE_SIDE, others) === null
    if (walked && onLegalSquare) { settle(); return }
    const target = arrivalTarget(p, others)
    const free = freeSpotNear(target.x, target.z, SCENE_SIDE, others)
    settle()
    if (free === null) return
    const stayed = target.x === p.x && target.z === p.z
    moveTo(stayed ? 'arrival on a free square' : 'arrival in the emptiest wedge', Vector3.create(free.x, 0, free.z), lookAcross(free))
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
  if (p === null) { alerter('YOU HAVE NO BASE YET', '#ffd166', TOAST.result); return }
  cue('lift.wav', 0.55)
  moveTo('retour-base', p, Vector3.create(p.x, FLOOR_HEIGHT, p.z - 4))
}

/*
  To the door of somebody else's base: the revenge button's journey (away.tsx).

  The same landing as going home, in front of the door, and the camera on the building: the
  player arrives facing the shelves they came for. GO HOME and TO BELT already move the
  player in one tap, so this is the game's own way of travelling, not a new power.
*/
export function goToBaseOf(ownerId: string, name: string): void {
  const id = ownerId.toLowerCase()
  for (const [e, p] of engine.getEntitiesWith(Plot)) {
    if (p.ownerId.toLowerCase() !== id) continue
    const t = Transform.getOrNull(e)
    if (t === null) break
    const o = orientToBase(t.position.z, 0, BASE_SIDE / 2 + 1.5)
    cue('lift.wav', 0.55)
    moveTo('revenge', Vector3.create(t.position.x + o.dx, 0, t.position.z + o.dz),
      Vector3.create(t.position.x, FLOOR_HEIGHT, t.position.z))
    return
  }
  alerter(`${name.toUpperCase()} HAS NO BASE STANDING`, '#ffd166', TOAST.result)
}

export function goToBelt(): void {
  const p = Vector3.create(CENTER.x, 0, CENTER.z - 4.5)
  cue('lift.wav', 0.55)
  moveTo('tapis', p, Vector3.create(CENTER.x, 2.5, CENTER.z))
}
