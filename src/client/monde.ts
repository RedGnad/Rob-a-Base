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
export function clicMonde(entity: Entity): boolean {
  return theftView.hudVisible && inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN, entity)
}
