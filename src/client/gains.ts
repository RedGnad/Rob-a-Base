import { engine, Entity, Transform, TextShape, Billboard, BillboardMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { formatIncome } from '../shared/loot-table'

/**
 * L'argent apparait SUR la piece qui le produit, jamais dans le HUD.
 *
 * Trois testeurs ont joue sans comprendre que leurs pieces rapportaient (6 Sep). Le revenu
 * n'existait nulle part dans le monde: un pool invisible, un bouton introuvable, et un taux
 * ecrit au-dessus du toit, identique sur la base du voisin. Rien ne reliait l'objet pose a
 * l'argent gagne.
 *
 * La regle appliquee est celle de Clash of Clans et de Hay Day, et c'est aussi celle de
 * Jonasson et Purho (GDC Europe 2012) quand ils parlent de retour sur l'objet: le signifiant
 * se met sur la chose qui produit, pas dans l'interface. Une base a six socles pulse six fois
 * plus vite qu'une base a un socle, donc la quantite se lit a la DENSITE, sans un chiffre a
 * lire. Et comme ca marche aussi sur la base d'un voisin, une base qui pulse vite annonce
 * qu'elle vaut le vol.
 *
 * Cout: un `TextShape` ne coute AUCUN materiau au telephone (mesure du 5 Sep, la meme qui a
 * mis le nom du proprietaire sur chaque base). Dix entites en tout, partagees par toutes les
 * bases visibles, garees a l'echelle zero entre deux apparitions, et l'emission est refusee
 * plutot que mise en file quand elles sont toutes prises: le budget ne peut pas deraper.
 */
const POOL = 10
const VIE_MS = 900
const MONTEE = 0.7
const OR = Color3.fromHexString('#ffd166')
const NOIR = Color3.create(0, 0, 0)

type Slot = { e: Entity; depuis: number; y0: number; vivant: boolean }
const pool: Slot[] = []
let prochain = 0

function creer(): void {
  if (pool.length > 0) return
  for (let i = 0; i < POOL; i++) {
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(0, -60, 0), scale: Vector3.Zero() })
    Billboard.create(e, { billboardMode: BillboardMode.BM_Y })
    TextShape.create(e, {
      text: '', fontSize: 3.4, textColor: Color4.fromColor3(OR),
      outlineWidth: 0.24, outlineColor: NOIR
    })
    pool.push({ e, depuis: 0, y0: 0, vivant: false })
  }
}

/**
 * Une piece vient de rapporter: le montant monte au-dessus d'elle et s'efface.
 *
 * `parent` est la racine de la base et `ou` une position LOCALE, celle du socle: le meme
 * repere que l'objet lui-meme, donc aucun calcul de monde a refaire et rien qui puisse
 * diverger de la piece qu'il annonce.
 */
export function emettreGain(parent: Entity, ou: Vector3, montant: number): void {
  if (montant <= 0) return
  creer()
  // Un tour complet du pool sans trouver de place libre veut dire que l'ecran en a deja dix:
  // une onzieme serait du bruit, pas une information. On la laisse tomber.
  let slot: Slot | null = null
  for (let i = 0; i < POOL; i++) {
    const c = pool[(prochain + i) % POOL]
    if (!c.vivant) { slot = c; prochain = (prochain + i + 1) % POOL; break }
  }
  if (slot === null) return

  const t = Transform.getMutableOrNull(slot.e)
  const ts = TextShape.getMutableOrNull(slot.e)
  if (t === null || ts === null) return
  t.parent = parent
  t.position = Vector3.create(ou.x, ou.y, ou.z)
  t.scale = Vector3.create(0.4, 0.4, 0.4)
  ts.text = `+${formatIncome(montant)}`
  ts.textColor = Color4.fromColor3(OR)
  slot.depuis = Date.now()
  slot.y0 = ou.y
  slot.vivant = true
}

/**
 * La montee et l'effacement, ecrits uniquement pour les emplacements vivants.
 *
 * Un tween aurait suffi pour monter, mais une entite n'en porte qu'un et il ne sait pas
 * faire disparaitre un texte. Ici la meme boucle fait les deux, et elle ne touche a rien
 * quand rien ne flotte, ce qui est l'etat le plus frequent.
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
      // Vite au depart puis de plus en plus lentement: la montee se lit dans le premier
      // tiers, l'effacement occupe le reste, et l'oeil n'a pas a suivre jusqu'au bout.
      t.position = Vector3.create(t.position.x, s.y0 + MONTEE * (1 - (1 - k) * (1 - k)), t.position.z)
      const ts = TextShape.getMutableOrNull(s.e)
      if (ts !== null) ts.textColor = Color4.create(OR.r, OR.g, OR.b, 1 - k * k)
    }
  })
}
