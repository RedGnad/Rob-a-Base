import { engine, Transform, MeshRenderer, Material, Entity } from '@dcl/sdk/ecs'
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
export function place3DText(parent: Entity, segments: Segment3D[], estompe: boolean, largeurMax = 0): Entity {
  const racine = engine.addEntity()

  const propres: Segment3D[] = segments.map((s) => ('image' in s ? s : { ...s, texte: s.texte.toUpperCase() }))
  const total = propres.reduce((w, s) => w + largeurDe(s), 0)
  /*
    La ligne se REDUIT pour tenir dans sa plaque, au lieu d'en sortir.

    La largeur d'un nom est libre et celle d'une plaque est fixe: sans contrainte, un nom long
    suivi de son etoile de prestige poussait le badge hors du panneau (proprietaire, 7 Sep,
    "NEO FROSTBORN" et son x2 dans le vide). Couper plus court aurait mutile des noms qui
    tiennent tres bien; la mise a l'echelle garde la ligne entiere et lisible, et elle ne
    s'applique qu'au cas ou elle deborde, donc les noms courts ne retrecissent jamais.
  */
  const k = largeurMax > 0 && total > largeurMax ? largeurMax / total : 1
  Transform.create(racine, { parent, scale: Vector3.create(k, k, 1) })
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
