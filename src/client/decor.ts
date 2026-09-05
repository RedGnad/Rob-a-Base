import { GltfNodeModifiers, TextureWrapMode, engine, Transform, GltfContainer, MeshRenderer, MeshCollider, Material, PBMaterial_PbrMaterial, ColliderLayer, Entity } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector2, Vector3, Quaternion } from '@dcl/sdk/math'
import { CENTER, SCENE_SIDE, EDGE_MARGIN, FUSION_POS } from '../shared/schemas'
import { TOY, plastic } from './toy'

/**
 * The world's dressing: a toybox rim, a treeline, bushes, balloons.
 *
 * The venue is a play mat on a table, and the table now has its edge: a cream rim wall with
 * a yellow lip, the box the toys came in. That is the hard boundary the tester asked for,
 * and it costs four colliders. Everything else is dressing and can be walked through:
 * the treeline lives in the EDGE_MARGIN band where no base can ever be built, the bushes in
 * the belt lane's clearance where building is equally forbidden, so decor and player bases
 * can never contest the same ground.
 *
 * The budget is the point (the show-and-tell showed the other way: heavy worlds, lost and
 * lagging testers). Three GLBs repeated: one 4 m faceted tree (1015 tri, its sway clip
 * looping), two 70-tri bushes, three party balloons and one balloon spiral as the landmark.
 * About fifty thousand triangles all told, no lights, no alpha we control, and no collider
 * beyond the rim: the phone pays almost nothing for a world that finally has edges.
 *
 * Every position comes from one seeded LCG, so the wood is the same wood for everyone and
 * on every visit, without shipping a single coordinate.
 */
let graine = 987654321
function alea(): number { graine = (graine * 1103515245 + 12345) & 0x7fffffff; return graine / 0x7fffffff }


/*
  The balloon mystery, solved by the tester's own eye: "one of the balloons was a 9". The
  pack is NUMBER balloons, and a flat digit orbited around shows its mirror: that was the
  whole "turns against the camera". So the rich textured balloons come back, restricted to
  the shapes that cannot mirror: the star, the flower, the sphere, and the spiral landmark.
  A digit stays out: a 9 floating over a plaza is a question nobody should be asking.
*/
/*
  The fancy trio, by the owner's third and final word: the spiky star, the flower, the
  bright sphere. Not realism: SHAPES and vivid colour are the point ("des ballons fancy
  avec des couleurs vives et des formes differentes"). The classic latex teardrops bored
  him however well they were shaded, and the star's oddball camera read is a price he
  accepts. This preference is settled; do not relitigate it through another swap.
*/
const BALLONS = ['assets/Models/balloon004.glb', 'assets/Models/balloon005.glb', 'assets/Models/balloon006.glb']
const SPIRALE = 'assets/Models/balloon-group01.glb'

/** A decorative GLB: no physics, no pointer, nothing for the phone to test against. */
/**
 * La matiere du sol public, definie UNE fois pour la bande centrale et pour le trait de la place.
 *
 * Les deux sont le meme domaine: ce qui n'appartient a personne. Ils portaient deux couleurs
 * et deux matieres, et le trait jurait avec la bande (proprietaire, 2 Sep). Ecrire la matiere
 * ici et la donner aux deux est la seule facon qu'elles ne divergent plus jamais; la meme
 * `src` de texture veut aussi dire une seule texture chargee pour les deux.
 *
 * `tx` et `tz` comptent en TUILES: la rue les calcule depuis sa taille, l'anneau porte deja
 * ses tuiles dans ses UV (une tous les quatre metres) et demande donc 1 sur 1.
 */
function streetMaterial(tx: number, tz: number): PBMaterial_PbrMaterial {
  return {
    ...plastic(TOY.street), roughness: 0.95,
    texture: Material.Texture.Common({
      src: 'assets/textures/mat-wall.png',
      wrapMode: TextureWrapMode.TWM_REPEAT,
      tiling: Vector2.create(tx, tz)
    })
  }
}

function pose(src: string, x: number, y: number, z: number, sc: number, ry: number, ombre = true): Entity {
  const e = engine.addEntity()
  Transform.create(e, {
    position: Vector3.create(x, y, z),
    scale: Vector3.create(sc, sc, sc),
    rotation: Quaternion.fromEulerDegrees(0, ry, 0)
  })
  GltfContainer.create(e, { src, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  /*
    Seul ce qui flotte HAUT perd son ombre.

    Les bouquets sont a hauteur d'homme, autour des fixtures de la place: leur ombre les y
    pose, et le proprietaire la veut. C'est la spirale a vingt-sept metres au-dessus du
    panneau central qui projetait un semis de taches sur un sol qu'elle ne touche pas (2 Sep).
    Un chemin vide dans `GltfNodeModifiers` s'applique a tous les noeuds du fichier.
  */
  if (!ombre) GltfNodeModifiers.createOrReplace(e, { modifiers: [{ path: '', castShadows: false }] })
  return e
}

/*
  La bande du point d'apparition vit maintenant dans `tools/model/build-vegetation.py`.

  C'est lui qui place arbres et buissons, donc c'est lui qui doit savoir ou ne rien poser. La
  garder ici en plus aurait fait deux definitions de la meme regle, et la premiere fois que le
  point d'apparition bouge, une des deux serait restee en arriere. C'est deja arrive (1 Sep).
*/



/** The carpet's width, taken from the reference's own render: about a third of a base. */
const LARGEUR_RUE = 6

export function setupDecor(): void {
  /*
    Le pourtour en UN objet, avec un profil.

    C'etaient quatre cubes etires en creme et quatre dalles jaunes posees dessus: huit objets
    rendus et deux materiaux pour la plus longue ligne visible du jeu, celle qui est a
    l'horizon de chaque capture, et elle lisait comme le flanc d'un carton. `build-wall.py`
    cuit tout le pourtour en un seul maillage a un materiau: socle deborde, corps legerement
    fuyant, couronnement a larmier avec sa levre jaune, un contrefort tous les douze metres du
    cote interieur, et une tour a chaque angle avec sa lanterne. 1 824 triangles, la ou il
    nous reste 73 pour cent de marge, contre sept objets rendus et un materiau economises sur
    les deux compteurs qui sont tendus.

    Le modele porte sa propre collision, physique ET pointeur, comme les boites: la camera de
    troisieme personne doit s'arreter dessus, pas passer au travers.
  */
  const enceinte = engine.addEntity()
  Transform.create(enceinte, { position: Vector3.create(0, 0, 0) })
  GltfContainer.create(enceinte, {
    src: 'assets/Models/wall.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })

  /*
    Toute la vegetation en DEUX objets, et son placement vit desormais dans l'outil.

    Quarante-quatre arbres et quarante-trois buissons faisaient quatre-vingt-sept objets
    rendus, plus d'un tiers du decor, pour de l'ornement sans collider (mesure du 2 Sep). Ils
    ne bougent jamais les uns par rapport aux autres: `tools/model/build-vegetation.py` les
    fond en deux modeles a un materiau chacun, exactement comme les etages. Le placement, qui
    etait ici et tirait sur le meme generateur que les ballons, est parti avec: le repliquer
    dans l'outil ET dans le client aurait garanti la derive.
  */
  pose('assets/Models/vegetation-arbres.glb', 0, 0, 0, 1, 0)
  pose('assets/Models/vegetation-buissons.glb', 0, 0, 0, 1, 0)

  // Balloons: three bouquets around the plaza's fixtures, knee-high to head-high, and the
  // spiral high over the centre, the landmark you can see from any base's top floor.
  /*
    Les bouquets vivent DANS la place, a cent vingt degres l'un de l'autre.

    Ils etaient poses librement, et l'un d'eux se tenait a 2,12 m de l'axe du fuser: comme ils
    se posent sur un anneau de 1,7 m, le plus proche tombait a 0,42 m de l'axe, DANS un tambour
    qui fait 0,9 de rayon. Il masquait la machine et se mettait entre le joueur et sa cible.
    Deux autres debordaient de la place, sur du terrain constructible: le jour ou quelqu'un y
    pose sa base, les ballons se retrouvent dans son salon (proprietaire, 2 Sep).

    Donc ils tiennent sur une ellipse interieure, 13 sur 8,5, ou le bord d'un bouquet (1,7 m
    d'anneau plus 1,3 m de ballon) reste dans la place, ou chacun est a plus de neuf metres du
    fuser et du poste de raid, et a plus de quatre du tapis. Verifie par le calcul, pas a l'oeil.
  */
  const bouquets: Array<[number, number]> = [30, 150, 270].map((deg) => {
    const a = (deg * Math.PI) / 180
    return [CENTER.x + 13 * Math.cos(a), CENTER.z + 8.5 * Math.sin(a)] as [number, number]
  })
  for (const [bx, bz] of bouquets) {
    // A ring, not a dice roll: these shapes run up to two metres wide and a random jitter
    // of +/-1.1 m stacked them into each other (owner, 1 Sep). Three points 120 degrees
    // apart on a 1.7 m radius sit 2.9 m apart at worst, clear by construction, and the
    // staggered heights keep them from ever reading as a row from any side.
    const phase = alea() * 360
    for (let k = 0; k < 3; k++) {
      const a = ((phase + k * 120) * Math.PI) / 180
      pose(BALLONS[k % BALLONS.length], bx + Math.cos(a) * 1.7, 1.2 + k * 0.7 + alea() * 0.3, bz + Math.sin(a) * 1.7, 0.9 + alea() * 0.4, alea() * 360)
    }
  }
  pose(SPIRALE, CENTER.x, 27, CENTER.z, 1, 0, false)

  /*
    The street: one flat strip down the middle of the field, from wall to wall.

    Two rows of buildings do not read as a street on their own; what makes a street is the
    ground between them being a different ground. The reference does exactly this and nothing
    more: a bright carpet laid flat on plain grass, no kerb, no fence, no border, and it is the
    only thing separating public ground from private (its own in-game renders, read 1 Sep). It
    also matches what actually happens here now: a bought crate travels down this strip to its
    owner's door, in reach of anyone who wants to outbid it, so the strip is not decoration,
    it is the route.

    One entity, one material, no new texture, and no collider: it is a painted line, not a
    kerb, and players cross it constantly.
  */
  const rue = engine.addEntity()
  Transform.create(rue, {
    position: Vector3.create(CENTER.x, 0.03, CENTER.z),
    scale: Vector3.create(SCENE_SIDE, 0.06, LARGEUR_RUE)
  })
  MeshRenderer.setBox(rue)
  Material.setPbrMaterial(rue, streetMaterial(SCENE_SIDE / 4, LARGEUR_RUE / 4))

  /*
    Le trait au sol qui EST la regle qu'on ne peut pas construire ici.

    Une zone reservee qu'on ne voit pas est une zone ou le joueur se fait refuser sans
    comprendre. Un TRAIT, pas un disque: le disque plein cachait l'herbe du centre, et ce
    qu'on veut dire est "la limite est ici", pas "ce sol est autre". L'herbe reste donc
    visible dedans, et la place se lit comme une piste, ce qu'elle est.

    Un anneau n'est ni une primitive du moteur ni une texture a trous (l'alpha est cher sur
    un GPU de telephone, on l'evite partout ailleurs ici): c'est de la geometrie, un ruban
    de 1,5 m d'epaisseur constante, 256 triangles, un objet rendu, un materiau, aucune
    transparence. Genere par `tools/model/build-plaza-ring.py`, aux demi-axes de `PLAZA_A`
    et `PLAZA_B`: si ces deux nombres changent, le fichier se regenere, sinon le trait ment.

    Pose a huit centimetres, juste au-dessus de la rue qui monte a six, et sans collisionneur:
    c'est de la peinture, pas une bordure, et on la traverse en permanence.
  */
  const anneau = engine.addEntity()
  Transform.create(anneau, { position: Vector3.create(CENTER.x, 0.08, CENTER.z) })
  GltfContainer.create(anneau, { src: 'assets/toy/plaza-ring.glb', visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  GltfNodeModifiers.createOrReplace(anneau, {
    modifiers: [{
      path: '',
      castShadows: false,
      material: { material: { $case: 'pbr', pbr: streetMaterial(1, 1) } }
    }]
  })

  console.log('[CLIENT] decor: rim, treeline, bushes, balloons, street, plaza placed')
}
