import { engine, inputSystem, InputAction, PointerEventType, UiTransform } from '@dcl/sdk/ecs'

/**
 * TEMPORARY. Counts what the scene receives against what the buttons serve.
 *
 * Menu buttons miss a press now and then, most often right after the menu opens or a tab
 * changes, and nothing so far has produced a cause, only hypotheses (memo 512). Reading the
 * SDK settles how a press travels: the client sends a pointer result per entity, and each
 * frame the scene serves the entity's LAST "down" only if its timestamp is newer than the
 * highest one seen the frame before. So a press can be lost in exactly two places: the client
 * never sends it (its own hit test, the cursor lock), or the scene receives it and filters it.
 *
 * This tells the two apart on screen. `recus` counts every "down" the scene sees on any
 * entity, with the entity it hit; `servis` counts every button handler that ran. A press
 * with no change in `recus` never reached the scene; a press that moves `recus` and not
 * `servis` was received and dropped, and `dernier` says where it landed.
 */
export const clicsView = { recus: 0, servis: 0, dernier: '' }

export function noterServi(): void {
  clicsView.servis += 1
}

export function setupClics(): void {
  engine.addSystem(() => {
    const cmd = inputSystem.getInputCommand(InputAction.IA_POINTER, PointerEventType.PET_DOWN)
    if (cmd === null) return
    clicsView.recus += 1
    const id = cmd.hit?.entityId
    if (id === undefined) { clicsView.dernier = 'none'; return }
    clicsView.dernier = `${UiTransform.has(id as never) ? 'ui' : 'w'}${id & 0xffff}`
  })
}
