import { engine, Material, Entity, AudioSource, Transform, Tween, TextureWrapMode, TextureMovementType, PBMaterial_PbrMaterial } from '@dcl/sdk/ecs'
import { Vector2, Vector3, Color3, Color4 } from '@dcl/sdk/math'
import { replay } from './sfx'
import { isMobile } from '@dcl/sdk/platform'
import { Event, EVENT_THEMES, SCENE_SIDE } from '../shared/schemas'
import { mutation, CRATES, nomDuCode } from '../shared/loot-table'
import { room } from '../shared/messages'
import { raidView } from './raid'
import { alerterEnFile } from './theft'
import { plastic, TOY } from './toy'
import { TOAST } from './theme'

/**
 * What an event looks like, which is the part that makes it one.
 *
 * The genre's own column for this is titled "Environmental Changes", and every example in it
 * is the WORLD changing rather than a panel appearing. Ours changes the FLOOR, and only the
 * floor: the theme's mat and its colour, under the player's feet, where the event is played.
 *
 * L'heure du ciel a ete essayee et retiree (proprietaire, 7 Sep: "l'effet n'a pas ete
 * apprecie"). Elle avait aussi un defaut que son retrait a mis au jour: la fin d'un rush ne
 * rendait pas l'heure de depart. Le demarrage posait midi, la remise a zero posait 10h30, donc
 * la place restait definitivement plus matinale apres le premier rush de la session. Le ciel
 * est desormais pose une fois dans `setup.ts` et plus rien n'y touche.
 *
 * The HUD line follows the documented conveyance for timers: announced once in the player's
 * main gaze, then living at the top with the remaining time, in the theme's colour, with the
 * theme's name as its icon.
 */
/** `sinceMs`: when the running rush began on this clock; the corner chip flies in from it. */
export const eventView = { theme: -1, name: '', color: '#ffffff', leftS: 0, grand: false, nextGrandS: 0, sinceMs: 0 }

const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/**
 * The band's one line: the raid boss, or nothing.

 * The running rush used to sit here too, for its whole span: a plate in the top centre for
 * three to five minutes, wider than its words and with the words off their middle (mobile
 * tester's screenshot, 3 Sep). The conveyance this file follows says a timer, once
 * announced in the player's gaze, moves to a PERMANENT location; and the rest of this HUD
 * says where permanent things go: the corner column, with the free-crate clock and the
 * countdown to the next grand rush, at caption size. The centre stays for the raid, which
 * is a fight with a health figure and a direction, not a clock.
 */
export function raidLine(): { text: string; color: string } | null {
  if (!raidView.active) return null
  // The distance is what turns the line into a direction: the beam says which way, this says
  // how far, and together they answer "where is it" without a minimap.
  const loin = raidView.distance > 0 ? `  ·  ${raidView.distance} m` : ''
  const top = raidView.topName !== '' ? `  ·  ${raidView.topName}` : ''
  return { text: `RAID BOSS  ${mmss(raidView.leftS)}${loin}${top}`, color: '#ff6b6b' }
}

/**
 * The rush now running, for the corner column: a crate in the rush's colour, the multiplier
 * its drops carry, and the time left. The name is gone from the chip: "GOLD RUSH" made a
 * tester ask what a gold rush was (4 Sep), while a crate glowing gold next to "x1.25" says
 * what the belt is dropping without a word. `mult` is what the crate icon is tinted with.
 */
export function rushChip(): { text: string; color: string; mult: number } | null {
  if (eventView.theme < 0) return null
  const m = mutation(eventView.theme)
  return { text: `${eventView.grand ? 'GRAND  ' : ''}x${m.mult}   ${mmss(eventView.leftS)}`, color: eventView.color, mult: m.mult }
}

/*
  The rush card: what a rush IS, in one picture and two short lines, shown on demand.

  The genre's event pattern: an icon on the HUD, and the explanation behind a tap on it,
  never pushed as running text (a tester asked "what is a gold rush?" while the sentence
  toast was on screen, 4 Sep). It shows itself once per session, at the first rush, for
  four seconds; after that only a tap on the chip brings it back. It replaces the sentence
  toast entirely: the chip flying in from the centre, the floor flowing in the colour, the
  bell and the beacon on the belt are the announcement.
*/
export const rushCard = { open: false, until: 0 }
let rushCardSeen = false

export function openRushCard(auto: boolean): void {
  rushCard.open = true
  rushCard.until = Date.now() + (auto ? 4000 : 7000)
}
export function closeRushCard(): void { rushCard.open = false }
export function rushCardVisible(): boolean {
  if (!rushCard.open) return false
  if (eventView.theme < 0 || Date.now() > rushCard.until) { rushCard.open = false; return false }
  return true
}

/** The crate the running rush handed this player, named on the card; cleared with the rush. */
const rushGift = { caisse: '', theme: -1 }

/** What the card says: the rush's name and colour, what its crates carry, the time left, and the gift if one came. */
export function rushInfo(): { name: string; color: string; toy: string; mult: number; leftS: number; grand: boolean; gift: string } | null {
  if (eventView.theme < 0) return null
  const m = mutation(eventView.theme)
  const gift = rushGift.theme === eventView.theme && rushGift.caisse !== '' ? `a ${rushGift.caisse} for being here` : ''
  return { name: eventView.name, color: eventView.color, toy: m.name.toUpperCase(), mult: m.mult, leftS: eventView.leftS, grand: eventView.grand, gift }
}

/** Seconds since the running rush began, or -1. The beacon and the flight read it. */
export function rushAgeS(): number {
  return eventView.theme < 0 ? -1 : (Date.now() - eventView.sinceMs) / 1000
}

/**
 * The countdown to the grand rush, for a small chip in the corner. It can stand for an hour,
 * and an hour in the middle of the screen is furniture (tester, 27 Aug): it goes where the
 * other standing facts go, under the money, at caption size.
 */
export function nextBigText(): { text: string; color: string } | null {
  /*
    LE BOSS EN COURS TIENT CETTE MEME PLACE, et il tenait le centre de l'ecran.

    Sa ligne vivante, temps restant, distance et meneur, occupait un bloc de 52 px dans la
    bande du haut, ce qui poussait toute la colonne de toasts de 52 px vers le bas, soit sept
    pour cent de la hauteur d'un telephone, pendant les trois minutes ou il y a le plus de
    choses a dire. Le fichier defendait ce choix ("The centre stays for the raid"), et il avait
    raison quand le boss sortait DEUX fois par heure. Il en sort QUATRE depuis le 8 Sep, et
    l'argument que ce meme fichier oppose au grand rush lui revient dessus: "an hour in the
    middle of the screen is furniture". Un evenement qui revient au quart d'heure n'est plus un
    moment, c'est du mobilier (proprietaire, 8 Sep).

    Et le boss n'a pas besoin de cette place: il est un objet visible sur la place, il porte sa
    propre barre de vie en 3D, une cloche sonne, et une annonce convoque ceux qui sont loin.

    Le compte a rebours AVANT et l'etat PENDANT partagent donc une seule puce, ce qui laisse un
    seul emplacement a apprendre au lieu de deux.
  */
  const live = raidLine()
  if (live !== null) return live
  if (eventView.theme >= 0) return null
  const grand = eventView.nextGrandS > 0 && eventView.nextGrandS <= 3600 ? eventView.nextGrandS : 0
  const raid = raidView.nextS > 0 && raidView.nextS <= 600 ? raidView.nextS : 0
  // The sooner of the two standing facts; the raid within ten minutes, the grand rush within the hour.
  if (raid > 0 && (grand === 0 || raid <= grand)) return { text: `RAID IN ${mmss(raid)}`, color: '#ffd166' }
  if (grand > 0) return { text: `GRAND RUSH IN ${mmss(grand)}`, color: '#ffd166' }
  return null
}

/**
 * What each rush looks like: its mat and its hour of the day.
 *
 * The first version was one cracked-crust texture at full contrast, tinted to saturation and
 * repeated twenty-four times across the plaza: it tiled like a bathroom, and a tester saw a
 * GOLD event with a floor of lava, because glowing cracks read as lava in any colour. The
 * venue is a play mat, so an event is the mat changing: a mid-tone from the palette carries
 * the colour, and a soft pattern with a fifth of contrast breathes underneath at sixteen
 * metres a cell.
 */
/*
  One look per rush theme: which of the three ground mats the venue wears and its tint. The
  three mats are greyscale weaves, so a theme only picks the closest weave and brings its own
  colour. Every theme in EVENT_THEMES needs a line here: the seven added on 5 Sep fell back to
  the Lava look, a Galaxy rush on a lava mat (owner, 5 Sep).
*/
/*
  One floor per rush, painted as a ground: `assets/textures/mat-rush-<theme>.png`, a colour
  tile of its own drawn by `tools/world/build-rush-mats.py`, which says in its header what a
  ground is allowed to do. Three shared weaves under a tint gave a Lava rush a brown mat with
  faint smears (owner, 5 Sep: "il faut que chaque sol soit propre dans son design et discret
  ou petant selon ce que dit la litterature"). The image carries the colour now, so the
  albedo is white; `lueur` is how much of the same image is fed back as emissive, so the
  cracks, the stars, the grid and the flecks light up and the plates do not.
*/
/*
  `maille` is metres per repeat of the mat, `vitesse` its drift in repeats per second; both
  default to the venue's stride. The rainbow is the one mat whose motif is a full hue cycle,
  and a full cycle every eight metres is bands of sixty centimetres: at any distance that is
  moire, not a rainbow (owner, 6 Sep: "trop serre, du bruit"). Four times the repeat gives
  bands of nearly three metres, and the drift slows in step so the floor moves at the same
  metres per second as the others.
*/
const LOOK: Record<number, { lueur: number; maille?: number; vitesse?: number }> = {
  1: { lueur: 0.0 },     // golden hour
  5: { lueur: 0.55 },    // dusk, red horizon: the cracks glow
  9: { lueur: 0.2 },     // night: faint veins
  6: { lueur: 0.45 },     // deep night: the stars
  7: { lueur: 0.0 },     // dawn, half and half
  8: { lueur: 0.35 },    // late evening: the flecks
  10: { lueur: 0.0 },    // sunrise light
  11: { lueur: 0.0, maille: 32, vitesse: 0.00375 },  // clear morning: a slow, wide sweep
  12: { lueur: 0.5 },    // neon hour: the grid
  13: { lueur: 0.0 }     // blue hour before dawn
}
let sol: Entity | null = null
let solCouleur = ''
let dernierTheme = -1
let cloche: Entity | null = null

export function setEventFloor(entity: Entity, base: string): void { sol = entity; solCouleur = base }

/**
 * The floor at rest: a matte play mat. Defined once, for the venue that builds it and the event
 * that hands it back.
 *
 * It names a texture on purpose. A material written without a texture field does not clear
 * the one the client is drawing: after the first Gold rush the floor went back to green and
 * kept its cracks. Naming one is what makes the swap happen, and the one named is the quiet
 * checker: a flat floor gave the eye nothing that moves, so running read as standing still
 * (tester, 28 Aug). Same recipe as the event mats, a fraction of their contrast.
 */
export function groundMaterial(hex: string): PBMaterial_PbrMaterial {
  return {
    ...plastic(hex), roughness: 0.9,
    texture: Material.Texture.Common({
      src: 'assets/textures/mat-grass.png',
      wrapMode: TextureWrapMode.TWM_REPEAT,
      tiling: Vector2.create(SCENE_SIDE / MAILLE_HERBE, SCENE_SIDE / MAILLE_HERBE)
    })
  }
}

/*
  The floor does not change colour, it starts to flow.

  A tint is a change the eye adapts to in seconds; motion is not. During an event the floor
  takes a cracked-crust texture that slides slowly, tinted by the theme (the albedo colour
  multiplies the image), so one grey image is molten gold in Gold Hour and lava in Lava Hour.
  The tint is the mutation's own hue pushed to full brightness: the first version used dark
  tints meant for a flat floor, and under the dusk sky the whole venue read as black with
  faint veins. Eight-metre cells across the venue. Both states write both facts, material and
  tween, so an event that ended leaves neither behind.
*/
/**
 * Metres per repeat of a rush mat. Eight: the motifs are drawn for that stride (two metre
 * grid cells on the Cyber floor, plates of a metre or two on the Lava one), and at sixteen the
 * same tile read as smears too large to be anything.
 */
const MAILLE_SOL = 8
/*
  The venue lives in permanent late morning, like the genre it belongs to: the references
  play in fixed daylight because night desaturates a colourful game into grey (the tester
  judged the grass "too muted" at night, 31 Aug, and he was right about the cause). The
  world config pins the same hour for production; this component covers the local preview
  and gives the rushes something to RESTORE, where they used to hand the sky back to the
  global clock and whatever hour it happened to be.
*/
/** The resting checker: two 2 m tiles per repeat, the genre's stride-sized grain. */
const MAILLE_HERBE = 4

export function setupEvents(): void {
  /*
    The rush's gift is told on the CARD, not in a toast. The toast repeated the rush's name
    beside the chip and the card that already announce it: two announcements of one event
    (owner, 4 Sep, "the old lava toast still shows"). The crate itself is in the pocket and
    the crate count on the button says so; the card's last line names the gift while the
    rush runs. A trait gained is a fact about ONE toy, rare, and keeps a short toast of its
    own, without the rush's name in it.
  */
  room.onMessage('rushGift', (d) => {
    rushGift.caisse = CRATES[d.crateTier]?.name ?? 'crate'
    rushGift.theme = eventView.theme
    if (d.code >= 0) alerterEnFile(`YOUR ${nomDuCode(d.code).toUpperCase()} GAINED A TRAIT`, '#ffd166', TOAST.result)
  })

  // A sound with the announcement: the HUD guidelines want timers to have an audio cue, and a
  // player looking at their base cannot see the belt line change colour.
  cloche = engine.addEntity()
  Transform.create(cloche, { parent: engine.PlayerEntity, position: Vector3.create(0, 1, 0) })
  // A bell of its own: this played the common crate's two wooden notes, so a rush starting
  // sounded like somebody opening a Basic Crate (ledger, 5 Sep).
  AudioSource.create(cloche, { audioClipUrl: 'assets/sounds/bell.wav', playing: false, loop: false, volume: 0.8 })

  engine.addSystem(() => {
    const now = Date.now()
    let theme = -1, until = 0, grand = false, prochainGrand = 0
    for (const [, e] of engine.getEntitiesWith(Event)) { theme = e.theme; until = e.untilMs; grand = e.grand; prochainGrand = e.nextGrandMs }
    const actif = theme >= 0 && until > now
    eventView.grand = actif && grand
    eventView.nextGrandS = prochainGrand > now ? Math.ceil((prochainGrand - now) / 1000) : 0
    const t = actif ? EVENT_THEMES.find((x) => x.theme === theme) : undefined

    eventView.theme = actif ? theme : -1
    eventView.name = t?.name ?? ''
    eventView.color = actif ? mutation(theme).color : '#ffffff'
    eventView.leftS = actif ? Math.max(0, Math.ceil((until - now) / 1000)) : 0

    if (eventView.theme === dernierTheme) return
    dernierTheme = eventView.theme
    if (actif) eventView.sinceMs = now

    if (actif && t !== undefined) {
      // The first rush of the session explains itself once; the rest is the chip and the world.
      if (!rushCardSeen) { rushCardSeen = true; openRushCard(true) }
      replay(cloche)
      const look = LOOK[theme] ?? LOOK[5]
      /*
        Le CIEL ne bouge plus, jamais.

        Chaque theme portait son heure du jour, et un rush plongeait la place au crepuscule ou
        a l'aube. L'effet n'a pas ete apprecie (proprietaire, 7 Sep) et le retirer coute deux
        lignes: l'heure est posee une fois pour toutes au demarrage (`setup.ts`, midi), et un
        evenement ne la touche plus. Ce qui change pendant un rush reste le TAPIS, qui est sous
        les pieds et non au-dessus de la tete: c'est la ou l'evenement se joue, et c'est assez.
      */
      if (sol !== null) {
        const mat = Material.Texture.Common({
          src: `assets/textures/mat-rush-${LOOK[theme] === undefined ? 5 : theme}.png`,
          wrapMode: TextureWrapMode.TWM_REPEAT,
          tiling: Vector2.create(SCENE_SIDE / (look.maille ?? MAILLE_SOL), SCENE_SIDE / (look.maille ?? MAILLE_SOL))
        })
        Material.setPbrMaterial(sol, {
          texture: mat,
          albedoColor: Color4.White(),
          emissiveTexture: look.lueur > 0 ? mat : undefined,
          emissiveColor: look.lueur > 0 ? Color3.create(look.lueur, look.lueur, look.lueur) : undefined,
          emissiveIntensity: look.lueur > 0 ? 1 : undefined,
          metallic: 0,
          roughness: 0.95
        })
        // Not on the handset: its texture tweens overwrite the material's tiling with (1, 1)
        // (godot-explorer tween.rs, 30 Aug), which would stretch one mat cell over the venue.
        // The phone keeps a still mat at the right scale; the flow is a desktop flourish.
        if (!isMobile()) Tween.setTextureMoveContinuous(sol, Vector2.create(1, 0.6), look.vitesse ?? 0.015, TextureMovementType.TMT_OFFSET)
      }
    } else {
      if (sol !== null && solCouleur !== '') {
        Material.setPbrMaterial(sol, groundMaterial(solCouleur))
        Tween.deleteFrom(sol)
      }
    }
  })
}
