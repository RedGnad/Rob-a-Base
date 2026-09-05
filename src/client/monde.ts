import { Entity, inputSystem, InputAction, PointerEventType } from '@dcl/sdk/ecs'
import { theftView } from './theft'

/**
 * A press on a thing in the world, and only while the world is what the player is looking at.
 *
 * Five things answer a pointer press directly: a crate on the belt, a crate in the smash, a
 * convoy, the fuser, a lift. Each read the press for itself, so with the menu open a press
 * beside the window bought a crate or rode a lift through it (owner, 6 Sep). The rule is the
 * one the keys already follow: a panel up means nothing underneath answers. Not a sheet over
 * the whole screen, which would also take the camera drag on a phone; the five checks share
 * this one gate instead.
 */
/** How long the HUD must have been back before the world answers a press, in milliseconds. */
const GRACE_MS = 150

/**
 * Whether the world is what the player is acting on right now.
 *
 * True only once the HUD has been back for a moment: the press that closes a panel is read
 * by the pointer system in the same frame the panel goes, so without the grace the CLOSE
 * button fired the drawn weapon (owner, 6 Sep).
 */
export function mondeOuvert(): boolean {
  return theftView.hudVisible && Date.now() - theftView.hudDepuis > GRACE_MS
}

export function clicMonde(entity: Entity): boolean {
  return mondeOuvert() && inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN, entity)
}
