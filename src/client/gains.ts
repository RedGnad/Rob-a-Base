import { engine, Entity, Transform, MeshRenderer, Material, Billboard, BillboardMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'

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
 * Une premiere version faisait tourner UN emetteur le long de l'etagere pour economiser des
 * entites. C'etait un rythme invente pour un budget, pas pour un joueur, et le proprietaire
 * l'a refuse a raison (7 Sep). Ici chaque socle a son minuteur, decale des autres pour qu'ils
 * ne partent pas ensemble: c'est la seule chose qu'on impose au rythme.
 *
 * Ce qui tient le cout n'est donc pas le rythme mais la PORTEE, et elle est drastique
 * (`emissionsDeBase` dans plots.ts): sa propre base uniquement, a portee, et seulement les
 * socles de l'etage ou l'on se trouve. Six objets au plus a l'ecran, donc huit emplacements
 * suffisent et le neuvieme est refuse plutot que mis en file.
 *
 * L'image est la pile doree de l'ancien bouton COLLECT, deja dans le depot: le jeu n'a qu'un
 * seul mot visuel pour l'argent, et c'est celui-la.
 */
const POOL = 8
const VIE_MS = 950
const MONTEE = 0.65
const SPRITE = 'assets/ui/act-collect.png'

type Slot = { e: Entity; depuis: number; y0: number; taille: number; vivant: boolean }
const pool: Slot[] = []
let prochain = 0

function creer(): void {
  if (pool.length > 0) return
  for (let i = 0; i < POOL; i++) {
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(0, -60, 0), scale: Vector3.Zero() })
    MeshRenderer.setPlane(e)
    // Face toujours la camera: une piece vue par la tranche n'est plus une piece.
    Billboard.create(e, { billboardMode: BillboardMode.BM_ALL })
    Material.setPbrMaterial(e, {
      texture: Material.Texture.Common({ src: SPRITE }),
      emissiveTexture: Material.Texture.Common({ src: SPRITE }),
      albedoColor: Color4.White(),
      emissiveColor: Color3.create(1, 0.85, 0.5),
      emissiveIntensity: 1.4,
      metallic: 0, roughness: 1, specularIntensity: 0,
      // Decoupe franche plutot que fondu: un fondu demanderait de reecrire le materiau a
      // chaque image, ce qui coute bien plus qu'il ne rend sur huit objets. La disparition
      // se joue a l'echelle, juste en dessous.
      transparencyMode: 1, alphaTest: 0.5, castShadows: false
    })
    pool.push({ e, depuis: 0, y0: 0, taille: 0.2, vivant: false })
  }
}

/**
 * Une piece vient de rapporter: une piece de monnaie monte au-dessus d'elle et s'efface.
 *
 * `ou` est une position MONDE, et `rarete` decide de la taille: le joueur lit la valeur a la
 * grosseur de la piece, sans un chiffre a lire. Six nombres flottants au-dessus d'une etagere
 * seraient a dechiffrer un par un, la ou une piece se reconnait d'un coup et supporte de se
 * repeter, ce qui est exactement ce qu'on lui demande.
 */
export function emettreGain(ou: Vector3, rarete: number): void {
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
  const taille = 0.18 + Math.max(0, Math.min(6, rarete)) * 0.03
  t.position = Vector3.create(ou.x, ou.y, ou.z)
  t.scale = Vector3.create(taille, taille, taille)
  slot.depuis = Date.now()
  slot.y0 = ou.y
  slot.taille = taille
  slot.vivant = true
}

/**
 * La montee et la disparition, ecrites uniquement pour les emplacements vivants.
 *
 * Rien n'est touche quand rien ne flotte, ce qui est l'etat le plus frequent: hors d'une
 * base, la boucle ne fait que huit tests de booleen.
 */
export function setupGains(): void {
  engine.addSystem(() => {
    const now = Date.now()
    for (const s of pool) {
      if (!s.vivant) continue
      const k = (now - s.depuis) / VIE_MS
      const t = Transform.getMutableOrNull(s.e)
      if (k >= 1 || t === null) {
        s.vivant = false
        if (t !== null) { t.scale = Vector3.Zero(); t.position = Vector3.create(0, -60, 0) }
        continue
      }
      // Vite au depart puis de plus en plus lentement, et la piece se retire sur le dernier
      // tiers: elle est lue dans le premier, elle s'en va pendant le reste.
      t.position = Vector3.create(t.position.x, s.y0 + MONTEE * (1 - (1 - k) * (1 - k)), t.position.z)
      const p = k < 0.62 ? 1 : 1 - (k - 0.62) / 0.38
      const c = s.taille * p
      t.scale = Vector3.create(c, c, c)
    }
  })
}
