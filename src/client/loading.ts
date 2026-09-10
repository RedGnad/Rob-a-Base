import { engine, GltfContainer, GltfContainerLoadingState, LoadingState } from '@dcl/sdk/ecs'
import { TREE_CLUSTERS } from './vegetation-clusters'

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
 * pieces). The watched files are every model the world lays down at startup, see `WATCHED`
 * below. And a ceiling, because a screen that could hold for ever on one stuck file would be
 * worse than no screen: past `TIMEOUT_MS` the game shows whatever it has.
 */
export const loadingView = {
  assetsReady: false,
  /** The arrival is settled (set down, taken home, or left alone): see travel.ts. */
  placed: false,
  since: Date.now(),
  /** Watched models seen and finished, for the screen's counter. */
  watched: 0,
  done: 0
}

/*
  TOUT LE DECOR, et c'etait le terrain seulement.

  La liste tenait trois fichiers, la ligne d'arbres, les buissons et le mur, sur l'idee des
  "modeles sans lesquels le champ n'est pas un champ". Elle laissait donc apparaitre APRES la
  chute de l'ecran l'anneau de la place, le tapis roulant et les ballons, c'est-a-dire des
  objets fixes que le joueur regarde en arrivant (proprietaire, 8 Sep: "une fois le monde
  arrive je vois encore des elements charger pendant une seconde").

  L'elargissement ne coute rien, et c'est mesure: les six fichiers ajoutes pesent 310 Ko a eux
  tous, contre 5,8 Mo pour la seule ligne d'arbres qui etait deja attendue. Ils seront prets
  bien avant elle, donc l'ecran ne tient pas une seconde de plus qu'avant.

  CE QUI N'EST PAS ICI, ET NE PEUT PAS L'ETRE: les bases et les objets sur leurs etageres.
  Ils n'existent pas quand cet ecran demarre, ils sont crees quand les entites `Plot` du
  serveur arrivent. On ne peut pas surveiller le chargement d'un fichier dont l'entite n'a pas
  encore ete creee, et attendre le serveur ferait de la borne de 25 s le cas normal sur un
  demarrage a froid.

  REGLE POUR LA SUITE: tout modele pose une fois pour toutes au demarrage appartient a cette
  liste. Un modele cree en cours de partie n'y appartient jamais. La difference n'est pas le
  poids, c'est de savoir si l'entite existe deja quand l'ecran compte.
*/
const WATCHED = [
  // decor.ts: the trees, one file per occupied cell since 10 Sep (entry 564), taken from the
  // list the tool writes so the two cannot diverge. The old single-file name stayed here for
  // a day after the split: no entity ever carried it, the count stalled at 8 of 9, and every
  // load on every platform held the screen to the 25 s ceiling (owner, 11 Sep: "very long").
  ...TREE_CLUSTERS,
  // decor.ts: the bushes, the wall, the plaza ring, the balloon spiral and its three balloons.
  'assets/Models/vegetation-buissons.glb',
  'assets/Models/wall.glb',
  'assets/toy/plaza-ring.glb',
  'assets/Models/balloon-group01.glb',
  'assets/Models/balloon004.glb',
  'assets/Models/balloon005.glb',
  'assets/Models/balloon006.glb',
  // belt.ts: le chassis du tapis, pose au demarrage lui aussi.
  'assets/Models/belt.glb'
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
    /*
      ON COMPTE DES FICHIERS, ET ON COMPTAIT DES ENTITES.

      L'ancienne condition demandait `entites vues >= WATCHED.length`, ce qui ne tenait que par
      coincidence: la ligne d'arbres, les buissons et la spirale ne posent qu'UNE entite chacun,
      et le total ne depassait le nombre de fichiers attendus que grace aux ballons et aux
      segments de mur. Retirer un bouquet de ballons aurait fait tenir l'ecran jusqu'a la borne
      de 25 s, en silence, sans qu'aucun fichier manque vraiment.

      La question posee est "chaque fichier attendu est-il present et fini", alors on la pose
      telle quelle: un ensemble de sources vues, un ensemble de sources dont au moins une entite
      n'a pas fini. Le compte d'entites par fichier cesse d'etre une hypothese.
    */
    const vus = new Set<string>()
    const incomplets = new Set<string>()
    for (const [e, g] of engine.getEntitiesWith(GltfContainer)) {
      if (!WATCHED.includes(g.src)) continue
      vus.add(g.src)
      const st = GltfContainerLoadingState.getOrNull(e)
      if (st === null || !termine(st.currentState)) incomplets.add(g.src)
    }
    const finis = vus.size - incomplets.size
    loadingView.watched = WATCHED.length
    loadingView.done = finis
    const tousLa = vus.size >= WATCHED.length && incomplets.size === 0
    if (tousLa || Date.now() - loadingView.since > TIMEOUT_MS) {
      loadingView.assetsReady = true
      console.log(`[CLIENT] loading: ${finis}/${WATCHED.length} files in after ${Math.round((Date.now() - loadingView.since) / 100) / 10}s${tousLa ? '' : ' (timeout)'}`)
    }
  })
}
