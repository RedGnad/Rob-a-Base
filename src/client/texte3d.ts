import { engine, Transform, MeshRenderer, Material, Entity, GltfContainer } from '@dcl/sdk/ecs'
import { Vector3, Color3, Color4 } from '@dcl/sdk/math'
import { ATLAS, ADVANCE, FONT_FILES } from './font-metrics'

/*
  The HUD's typeface, standing in the world.

  The platform's TextShape speaks three fonts and none of them is ours, so a facade sign in
  it reads like a default (owner, 1 Sep: "un texte en Arial sans reflexion UI gaming"). The
  HUD already solved this for the money counters: one small quad per letter, each showing
  its own cell of a baked Baloo atlas. This is that same trick with MeshRenderer planes
  instead of UiEntities, so a base's nameplate and the score in a player's hand are set in
  the one typeface the game owns.

  One entity per letter is the cost, which is why this dresses the dozen characters of a
  nameplate and not prose. The plane primitive wants sixteen uv values, four vertices for
  each of its two sides; the same eight serve both, so the back shows a mirrored letter
  that the sign's own backing plate hides.
*/

/**
 * Le traitement de lisibilite de TOUT texte plateforme pose dans le monde.
 *
 * Un texte en espace-monde n'a pas de plaque sous lui: il tombe sur l'herbe, sur le ciel, sur
 * une facade claire ou sur de la lave, et une seule couleur ne survit pas aux quatre. La reponse
 * de la plateforme est le contour, qui dessine le bord du glyphe lui-meme, et la documentation
 * la prefere explicitement a l'ombre pour la lisibilite.
 *
 * Ces valeurs ne sont pas choisies ici: ce sont celles qui ont deja corrige une plainte reelle,
 * `BUILD HERE` illisible sur un champ vert clair (proprietaire, 5 Sep). Elles etaient sur CE
 * texte et sur aucun autre.
 *
 * L'audit du 7 Sep a trouve, sur seize textes du monde, CINQ valeurs de contour differentes
 * (0,12 / 0,2 / 0,22 / 0,28 / 0,3) et surtout DEUX A ZERO: l'etiquette d'enchere au-dessus d'un
 * convoi, et le montant en or au-dessus d'un tas de pieces au sol. Ce sont exactement les deux
 * que le proprietaire signale comme peu visibles. Il n'y avait pas de regle, donc chaque site
 * en avait invente une, et deux n'en avaient inventee aucune.
 *
 * Une constante partagee plutot qu'une consigne: c'est la meme solution que `plastic()` pour les
 * materiaux, un traitement, un proprietaire. Un texte pose sans elle se voit en relecture.
 *
 * EXCEPTION ASSUMEE: le tableau des records garde son 0,12. C'est le seul texte du monde qui ait
 * deja une plaque sombre derriere lui, et ses lignes sont serrees: un contour epais y fermerait
 * les contre-formes des petites lettres au lieu de les detacher.
 */
export const LISIBLE_3D = {
  outlineWidth: 0.28,
  outlineColor: Color3.fromHexString('#0b1018'),
  shadowBlur: 0.5,
  shadowColor: Color3.fromHexString('#0b1018')
} as const

const CELL = 1 / ATLAS.cols
const ROW = 1 / ATLAS.rows
const TRACKING = 0.02
const BLEED = 1.5 / 1024

function uvsFace(index: number): number[] {
  const col = index % ATLAS.cols
  const row = Math.floor(index / ATLAS.cols)
  const u0 = col * CELL + BLEED
  const u1 = col * CELL + CELL - BLEED
  const v1 = 1 - row * ROW - BLEED
  const v0 = 1 - (row + 1) * ROW + BLEED
  return [u0, v0, u0, v1, u1, v1, u1, v0]
}

/**
 * A run of letters in one of the faces, or ONE picture standing in the line like a letter.
 *
 * The atlas holds fifty signs and no star, and a base's rank wants the star the interface
 * already uses for prestige rather than an "x" (owner, 5 Sep: "x5 ne veut rien dire"). A
 * picture segment is a square quad of `taille`, showing a whole `assets/ui/` file, advanced
 * like a wide letter.
 */
export type Segment3D =
  | { texte: string; role: keyof typeof FONT_FILES; taille: number }
  | { image: string; taille: number }

/** How far a picture advances the cursor, in units of its size: a little air on each side. */
const AVANCE_IMAGE = 1.08

function largeurDe(seg: Segment3D): number {
  if ('image' in seg) return seg.taille * AVANCE_IMAGE
  let w = 0
  for (const ch of seg.texte) {
    const idx = ATLAS.glyphs.indexOf(ch)
    if (idx < 0 && ch !== ' ') continue
    w += ((ADVANCE[ch] ?? 0.5) + TRACKING) * seg.taille
  }
  return w
}

/**
 * Lays the segments as one centred line of glyph quads under a fresh root entity, and
 * returns that root so the caller can retire the whole line with one call. `estompe`
 * greys the letters the way the plate greys an absent owner.
 */
/**
 * Ce que cette ligne mesurera, avant de la poser.
 *
 * C'est la PLAQUE qui doit s'ajuster au nom, pas le nom a la plaque (proprietaire, 7 Sep). Une
 * premiere correction reduisait la ligne pour la faire tenir, ce qui rendait un nom long plus
 * petit que celui du voisin: deux enseignes ne se lisaient plus a la meme distance, alors que
 * la seule chose qui devait varier etait la longueur du panneau. Mesurer d'abord permet de
 * tailler le panneau, et le texte garde son corps quel que soit le nom.
 */
export function largeur3D(segments: Segment3D[]): number {
  return segments
    .map((s) => ('image' in s ? s : { ...s, texte: s.texte.toUpperCase() }))
    .reduce((w, s) => w + largeurDe(s), 0)
}

export function place3DText(parent: Entity, segments: Segment3D[], estompe: boolean): Entity {
  const racine = engine.addEntity()
  Transform.create(racine, { parent })

  const propres: Segment3D[] = segments.map((s) => ('image' in s ? s : { ...s, texte: s.texte.toUpperCase() }))
  const total = propres.reduce((w, s) => w + largeurDe(s), 0)
  let curseur = -total / 2

  for (const seg of propres) {
    if ('image' in seg) {
      const quad = engine.addEntity()
      Transform.create(quad, {
        parent: racine,
        position: Vector3.create(curseur + (seg.taille * AVANCE_IMAGE) / 2, 0, 0),
        scale: Vector3.create(seg.taille, seg.taille, 1)
      })
      MeshRenderer.setPlane(quad)
      Material.setPbrMaterial(quad, {
        texture: Material.Texture.Common({ src: `assets/ui/${seg.image}` }),
        emissiveTexture: Material.Texture.Common({ src: `assets/ui/${seg.image}` }),
        albedoColor: estompe ? Color4.create(0.62, 0.66, 0.74, 1) : Color4.White(),
        emissiveColor: estompe ? Color3.create(0.62, 0.66, 0.74) : Color3.White(),
        emissiveIntensity: estompe ? 0.12 : 0.35,
        metallic: 0, roughness: 1, specularIntensity: 0,
        transparencyMode: 1, alphaTest: 0.5
      })
      curseur += seg.taille * AVANCE_IMAGE
      continue
    }
    for (const ch of seg.texte) {
      const idx = ATLAS.glyphs.indexOf(ch)
      if (idx < 0 && ch !== ' ') continue
      const adv = (ADVANCE[ch] ?? 0.5) + TRACKING
      if (idx >= 0 && ch !== ' ') {
        const quad = engine.addEntity()
        Transform.create(quad, {
          parent: racine,
          position: Vector3.create(curseur + (ADVANCE[ch] * seg.taille) / 2, 0, 0),
          scale: Vector3.create(seg.taille, seg.taille, 1)
        })
        const face = uvsFace(idx)
        MeshRenderer.setPlane(quad, [...face, ...face])
        Material.setPbrMaterial(quad, {
          texture: Material.Texture.Common({ src: `assets/ui/${FONT_FILES[seg.role]}` }),
          emissiveTexture: Material.Texture.Common({ src: `assets/ui/${FONT_FILES[seg.role]}` }),
          albedoColor: estompe ? Color4.create(0.62, 0.66, 0.74, 1) : Color4.White(),
          emissiveColor: estompe ? Color3.create(0.62, 0.66, 0.74) : Color3.White(),
          emissiveIntensity: estompe ? 0.12 : 0.35,
          metallic: 0, roughness: 1, specularIntensity: 0,
          transparencyMode: 1, alphaTest: 0.5
        })
      }
      curseur += adv * seg.taille
    }
  }
  return racine
}

/*
  The facade sign, in shared model files (founder, 19 Nov 2026).

  `place3DText` draws each letter as an SDK plane with its own material, and the phone counts one
  material per such plane, never shared: a twelve-letter name cost thirteen. The level-of-detail
  budget could therefore only afford the sign on the nearest bases, and the others stood without
  one. `tools/model/build-glyphs.py` writes one model per letter, the same quad cut from the same
  atlas cell, and a model file is counted once however many copies stand. The sign can then stand
  on every base at every distance, and never appears on the way in.

  Same layout as `place3DText`, letter for letter. Only the faces the sign uses exist as files:
  every glyph in the name face, the digits in the money face, the prestige star. Anything else
  falls back to the plane, so a new use shows up as a material in the budget, not as a hole.
*/
const GLYPH_DIR = 'assets/glyphs/'
const GLYPH_IMAGE: Record<string, string> = { 'ui-prestige.png': 'prestige' }

function glyphFile(role: keyof typeof FONT_FILES, ch: string, estompe: boolean): string | null {
  const idx = ATLAS.glyphs.indexOf(ch)
  if (idx < 0 || ch === ' ') return null
  if (role !== 'name' && !(role === 'money' && ch >= '0' && ch <= '9')) return null
  return `${GLYPH_DIR}${role}${estompe ? '-dim' : ''}-${String(idx).padStart(2, '0')}.glb`
}

/** The model files a sign with these segments loads: what the budget bills once for the whole field. */
export function glyphFiles3D(segments: Segment3D[], estompe: boolean): string[] {
  const out: string[] = []
  for (const seg of segments) {
    if ('image' in seg) {
      const base = GLYPH_IMAGE[seg.image]
      if (base !== undefined) out.push(`${GLYPH_DIR}${base}${estompe ? '-dim' : ''}.glb`)
      continue
    }
    for (const ch of seg.texte.toUpperCase()) {
      const f = glyphFile(seg.role, ch, estompe)
      if (f !== null) out.push(f)
    }
  }
  return out
}

/** How many models the sign draws: one per letter or picture, the spaces excluded. */
export function glyphCount3D(segments: Segment3D[]): number {
  let n = 0
  for (const seg of segments) {
    if ('image' in seg) { n++; continue }
    for (const ch of seg.texte.toUpperCase()) if (ch !== ' ' && ATLAS.glyphs.indexOf(ch) >= 0) n++
  }
  return n
}

export function place3DTextShared(parent: Entity, segments: Segment3D[], estompe: boolean): Entity {
  const racine = engine.addEntity()
  Transform.create(racine, { parent })
  const propres: Segment3D[] = segments.map((s) => ('image' in s ? s : { ...s, texte: s.texte.toUpperCase() }))
  const total = propres.reduce((w, s) => w + largeurDe(s), 0)
  let curseur = -total / 2
  const poser = (src: string, x: number, taille: number): void => {
    const e = engine.addEntity()
    Transform.create(e, { parent: racine, position: Vector3.create(x, 0, 0), scale: Vector3.create(taille, taille, 1) })
    GltfContainer.create(e, { src, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  }
  for (const seg of propres) {
    if ('image' in seg) {
      const base = GLYPH_IMAGE[seg.image]
      if (base === undefined) {
        // Not a shared picture: the plane, through the general path.
        const one = place3DText(racine, [seg], estompe)
        const t = Transform.getMutable(one)
        t.position = Vector3.create(curseur + (seg.taille * AVANCE_IMAGE) / 2, 0, 0)
      } else {
        poser(`${GLYPH_DIR}${base}${estompe ? '-dim' : ''}.glb`, curseur + (seg.taille * AVANCE_IMAGE) / 2, seg.taille)
      }
      curseur += seg.taille * AVANCE_IMAGE
      continue
    }
    for (const ch of seg.texte) {
      const idx = ATLAS.glyphs.indexOf(ch)
      if (idx < 0 && ch !== ' ') continue
      const adv = (ADVANCE[ch] ?? 0.5) + TRACKING
      if (idx >= 0 && ch !== ' ') {
        const x = curseur + (ADVANCE[ch] * seg.taille) / 2
        const f = glyphFile(seg.role, ch, estompe)
        if (f !== null) poser(f, x, seg.taille)
        else {
          const one = place3DText(racine, [{ texte: ch, role: seg.role, taille: seg.taille }], estompe)
          Transform.getMutable(one).position = Vector3.create(x, 0, 0)
        }
      }
      curseur += adv * seg.taille
    }
  }
  return racine
}
