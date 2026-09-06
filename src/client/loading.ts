import { engine, GltfContainer, GltfContainerLoadingState, LoadingState } from '@dcl/sdk/ecs'

/**
 * Whether the world's heavy models are in, so the interface can hold a loading screen up
 * until they are.
 *
 * The client's own loading screen drops at the scene's first frame, and the first frame is
 * not the game: the treeline is six megabytes and arrives last, the walls and bushes after
 * the ground, so a player's first seconds are a bare field filling in around them, and the
 * mobile testers called the start the one moment that felt broken (6 Sep). The owner asked
 * for a screen of our own that only goes when the scene is really there.
 *
 * "Really there" is measured, not guessed: the load state the client writes on every model
 * entity (`GltfContainerLoadingState`, the same component toy.ts already reads for the
 * pieces). The watched files are the ones that shape the field. And a ceiling, because a
 * screen that could hold for ever on one stuck file would be worse than no screen: past
 * `TIMEOUT_MS` the game shows whatever it has.
 */
export const loadingView = {
  assetsReady: false,
  since: Date.now(),
  /** Watched models seen and finished, for the screen's counter. */
  watched: 0,
  done: 0
}

/** The models without which the field is not a field. Paths as `decor.ts` names them. */
const WATCHED = [
  'assets/Models/vegetation-arbres.glb',
  'assets/Models/vegetation-buissons.glb',
  'assets/Models/wall.glb'
]
const TIMEOUT_MS = 25_000

/** A state past LOADING: finished, or failed in a way that will not change by waiting. */
function termine(state: LoadingState): boolean {
  return state !== LoadingState.LOADING && state !== LoadingState.UNKNOWN
}

export function setupLoading(): void {
  loadingView.since = Date.now()
  engine.addSystem(() => {
    if (loadingView.assetsReady) return
    let vus = 0
    let finis = 0
    for (const [e, g] of engine.getEntitiesWith(GltfContainer)) {
      if (!WATCHED.includes(g.src)) continue
      vus += 1
      const st = GltfContainerLoadingState.getOrNull(e)
      if (st !== null && termine(st.currentState)) finis += 1
    }
    loadingView.watched = vus
    loadingView.done = finis
    const tousLa = vus >= WATCHED.length && finis >= vus
    if (tousLa || Date.now() - loadingView.since > TIMEOUT_MS) {
      loadingView.assetsReady = true
      console.log(`[CLIENT] loading: ${finis}/${vus} models in after ${Math.round((Date.now() - loadingView.since) / 100) / 10}s${tousLa ? '' : ' (timeout)'}`)
    }
  })
}
