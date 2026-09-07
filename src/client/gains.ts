import { engine, Entity, Transform, MeshRenderer, Material } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

/**
 * Chaque piece posee lache SA piece de monnaie, sur elle, a son propre rythme.
 *
 * Trois testeurs ont joue sans comprendre que leurs pieces rapportaient (6 Sep). Le revenu
 * n'existait nulle part dans le monde: un pool invisible, un bouton introuvable, et un taux
 * ecrit au-dessus du toit, identique sur la base du voisin. Rien ne reliait l'objet pose a
 * l'argent gagne.
 *
 * La forme vient du genre, pas d'une invention: le tycoon fait tomber une piece PHYSIQUE par
 * producteur, a intervalle fixe, et c'est le langage visuel de la categorie. La regle de fond
 * est celle de Clash of Clans et de Hay Day, et celle de Jonasson et Purho (GDC Europe 2012)
 * sur le retour porte par l'objet: le signifiant se met sur la chose qui produit, jamais dans
 * l'interface.
 *
 * C'est une VRAIE piece, pas une image de piece. Une premiere version affichait le sprite dore
 * du HUD sur un panneau face camera; le proprietaire l'a vu tout de suite (7 Sep: "c'est une
 * icone 2D de piece pas une piece 3D"). Le jeu a deja une piece en volume, celle qui tombe au
 * sol quand on se fait tirer dessus: un cylindre couche sur le dos qui tourne autour de la
 * verticale. Celle-ci est la meme, en plus petit, pour que le monde n'ait qu'un seul objet
 * "argent". Elle tourne d'elle-meme, ce qui la fait lire par sa tranche puis par sa face, et
 * c'est ce qui distingue une piece d'un jeton.
 *
 * Cout: huit entites partagees par toute la scene, un seul materiau, garees sous le sol entre
 * deux apparitions. La rotation et la montee sont ecrites par la boucle ci-dessous, donc aucune
 * de ces entites ne porte de tween.
 */
const POOL = 8
const VIE_MS = 950
const MONTEE = 0.5
const TOURS = 1.35
const EPAISSEUR = 0.14
const OR = Color3.fromHexString('#ffcf4d')

/*
  Aucune piece n'est la copie d'une autre, et c'est une regle, pas un ornement.

  Six socles emettaient des clones parfaitement identiques a intervalle parfaitement regulier:
  meme taille, meme hauteur, meme duree, meme rotation. Meme decalees les unes des autres, elles
  lisaient comme une machine (proprietaire, 7 Sep: "on veut un effet organique"). Le defaut a un
  nom en son et en effets de jeu, le MACHINE-GUN EFFECT: un meme actif repete a cadence reguliere
  cesse d'etre lu comme un evenement et devient un mecanisme. Jonasson et Purho ne procedent
  jamais autrement dans leur demonstration, ils tirent au hasard la taille, la vitesse et l'angle
  de chaque particule.

  Chaque piece tire donc les siens: sa montee, sa duree, son nombre de tours et un leger ecart
  lateral pour qu'elles ne s'elevent pas toutes sur la meme verticale. Les bornes sont serrees,
  un quart de variation au plus: assez pour qu'aucune paire ne soit identique, trop peu pour
  qu'une piece paraisse anormale.
*/
const VARIE = 0.25
function autour(v: number): number { return v * (1 - VARIE + Math.random() * 2 * VARIE) }

type Slot = {
  e: Entity; depuis: number; y0: number; taille: number; vivant: boolean
  montee: number; vie: number; tours: number
}
const pool: Slot[] = []
let prochain = 0

function creer(): void {
  if (pool.length > 0) return
  for (let i = 0; i < POOL; i++) {
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(0, -60, 0), scale: Vector3.Zero() })
    MeshRenderer.setCylinder(e, 1, 1)
    Material.setPbrMaterial(e, {
      albedoColor: Color4.fromColor3(OR),
      emissiveColor: OR,
      emissiveIntensity: 0.9,
      metallic: 0.9, roughness: 0.25, castShadows: false
    })
    pool.push({ e, depuis: 0, y0: 0, taille: 0.2, vivant: false, montee: MONTEE, vie: VIE_MS, tours: TOURS })
  }
}

/**
 * Une piece vient de rapporter: une piece de monnaie monte au-dessus d'elle et s'efface.
 *
 * `ou` est le point du MONDE d'ou elle part, et `rarete` decide de sa taille: le joueur lit la
 * valeur a la grosseur de la piece, sans un chiffre a lire. Six nombres flottants au-dessus
 * d'une etagere seraient a dechiffrer un par un, la ou une piece se reconnait d'un coup et
 * supporte de se repeter, ce qui est exactement ce qu'on lui demande.
 */
export function emettreGain(ou: Vector3, rarete: number, grossir = 1): void {
  creer()
  let slot: Slot | null = null
  for (let i = 0; i < POOL; i++) {
    const c = pool[(prochain + i) % POOL]
    if (!c.vivant) { slot = c; prochain = (prochain + i + 1) % POOL; break }
  }
  // Huit deja en l'air veut dire que l'etagere entiere vient de payer: une neuvieme
  // n'ajouterait aucune information. On la laisse tomber plutot que de la mettre en file.
  if (slot === null) return

  const t = Transform.getMutableOrNull(slot.e)
  if (t === null) return
  // Un quart plus petite qu'au premier essai (proprietaire, 7 Sep): elle doit se remarquer
  // au-dessus de sa piece, pas la concurrencer. 12 cm pour un Common, 23 pour un Secret.
  const taille = (0.12 + Math.max(0, Math.min(6, rarete)) * 0.019) * grossir
  t.position = Vector3.create(ou.x, ou.y, ou.z)
  t.scale = Vector3.create(taille, taille * EPAISSEUR, taille)
  t.rotation = Quaternion.fromEulerDegrees(90, 0, 0)
  slot.depuis = Date.now()
  slot.y0 = ou.y
  slot.taille = taille
  slot.montee = autour(MONTEE)
  slot.vie = autour(VIE_MS)
  slot.tours = autour(TOURS)
  slot.vivant = true
  // Un ecart lateral, tire lui aussi: sans lui, six pieces montent sur six verticales exactes
  // et l'oeil retrouve la grille des socles au lieu de voir de la monnaie.
  t.position = Vector3.create(ou.x + (Math.random() - 0.5) * 0.14, ou.y, ou.z + (Math.random() - 0.5) * 0.14)
}

/**
 * La montee, la rotation et la disparition, ecrites uniquement pour les emplacements vivants.
 *
 * Rien n'est touche quand rien ne flotte, ce qui est l'etat le plus frequent: hors d'une base,
 * la boucle ne fait que huit tests de booleen.
 */
export function setupGains(): void {
  engine.addSystem(() => {
    const now = Date.now()
    for (const s of pool) {
      if (!s.vivant) continue
      const k = (now - s.depuis) / s.vie
      const t = Transform.getMutableOrNull(s.e)
      if (k >= 1 || t === null) {
        s.vivant = false
        if (t !== null) { t.scale = Vector3.Zero(); t.position = Vector3.create(0, -60, 0) }
        continue
      }
      // Vite au depart puis de plus en plus lentement, et la piece se retire sur le dernier
      // tiers: elle est lue dans le premier, elle s'en va pendant le reste.
      t.position = Vector3.create(t.position.x, s.y0 + s.montee * (1 - (1 - k) * (1 - k)), t.position.z)
      // Couchee sur le dos (90 sur X) et tournee autour de la verticale du MONDE, l'ordre des
      // deux comptant: l'inverse la ferait rouler comme une roue au lieu de tourner sur place.
      t.rotation = Quaternion.multiply(
        Quaternion.fromEulerDegrees(0, k * 360 * s.tours, 0),
        Quaternion.fromEulerDegrees(90, 0, 0)
      )
      const p = k < 0.62 ? 1 : 1 - (k - 0.62) / 0.38
      const c = s.taille * p
      t.scale = Vector3.create(c, c * EPAISSEUR, c)
    }
  })
}
