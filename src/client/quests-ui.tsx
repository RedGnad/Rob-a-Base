import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { sendOrHold } from './intent'
import { TYPE, TAP, C, RAD, lisible, largeurTexte } from './theme'
import { Btn, Barre, SURF, pctAnime, flashDe, tic } from './ui-kit'
import { Color4 } from '@dcl/sdk/math'
import { strip, BAND, MENU_W, MENU_PAD } from './layout'
import { room } from '../shared/messages'
import { QUESTS } from '../shared/quests'
import { DAILY_REWARDS } from '../shared/schemas'
import { crate } from '../shared/loot-table'
import { closeMenu } from './menu'

/*
  The grid, such as this engine allows one.

  React-ECS is flexbox and nothing else: no CSS grid, no column template. So a grid here is
  a discipline, one set of column widths that every row of the tab uses. What was there
  instead was fixed pixels per row (510 + 119 + 187 in one, 629 + 187 in the next) inside a
  container measured in percent: the totals happened to match, the paddings did not, and the
  LOCKED button sat fifteen pixels left of the CLAIM above it (owner, 1 Sep, screenshot).
  Percentages of the same parent cannot drift, at any window width.
*/
const COL = { texte: '60%', compteur: '14%', action: '26%' } as const

export const questsView = {
  open: false,
  ids: [] as number[],
  progres: [] as number[],
  cibles: [] as number[],
  pris: [] as number[],
  log: 1,
  dayClaimed: false,
  /** Les jours de la semaine deja encaisses. Un ENSEMBLE, pas un compteur: voir le serveur. */
  joursPris: [] as number[],
  dailyDispo: false,
  prochainJour: 1
}

export function setupQuests(): void {
  room.onMessage('quests', (d) => {
    questsView.ids = [...d.ids]
    questsView.progres = [...d.progres]
    questsView.cibles = [...d.cibles]
    questsView.pris = [...d.pris]
    questsView.log = d.log
    questsView.dayClaimed = d.dayClaimed
    questsView.joursPris = [...d.joursPris]
    questsView.dailyDispo = d.dailyDispo
    questsView.prochainJour = d.prochainJour
  })
}

function claim(slot: number): void { sendOrHold(() => { void room.send('claimQuest', { slot }) }) }
function claimDaily(): void { sendOrHold(() => { void room.send('claimDaily', {}) }) }

/*
  A reward that waits calls for its press, and a press is answered (founder, 20 Nov 2026: "c'est
  tres statique, on veut du juice", by the genre's reference and not at random).

  The reference read is the write-up of Zynga's Empires & Allies (Game Developer, "Clicking and
  rewards in Empires and Allies"): a waiting reward pulses; on the click, particles and a sound,
  then the reward travels to its HUD element on a curved path, and that element "will quickly
  pulse 30% bigger over around 1/4 second". Ours, with one rule of our own tutorial added, one
  cue at a time:

  - at rest, only the FIRST claimable control moves: it breathes six percent once a second and
    its crate hops with it. Claim it and the next one takes the motion;
  - on the press, the control squashes to 90 percent, pops to 112 and settles (squash and
    stretch, as BUILD HERE does), under a white flash; the server's answer plays reward.wav;
  - the crate leaves the button, swells 30 percent and falls in a curve towards the bottom of
    the screen, where the OPEN button will hold it;
  - when the HUD is back, that button's icon swells 30 percent for a quarter of a second.

  Only sizes and positions of the interface change: nothing here is drawn by the world.
*/
const PRESS_MS = 320
const FLY_MS = 620
const BREATH_MS = 1000
const pressedAt = new Map<string, number>()
/** `day`: the streak day the press was made on. The server's answer moves `prochainJour` on while the crate is still in the air. */
let flyer: { at: number; key: string; day: number } | null = null
let dailyPressedDay = 0
let landing = 0
let landedAt = 0

function pressing(key: string): boolean { return Date.now() - (pressedAt.get(key) ?? 0) < PRESS_MS }
function press(key: string, send: () => void): void {
  const now = Date.now()
  pressedAt.set(key, now)
  flyer = { at: now, key, day: questsView.prochainJour }
  if (key === 'daily') dailyPressedDay = questsView.prochainJour
  landing = now
  landedAt = 0
  send()
}

/** The first control that can be claimed, top to bottom then the streak: the one that moves. */
function firstClaimable(): string | null {
  for (let i = 0; i < questsView.ids.length; i++) {
    if (questsView.progres[i] >= questsView.cibles[i] && questsView.pris[i] !== 1) return `q${i}`
  }
  if (allQuestsDone() && questsView.pris[3] !== 1) return 'q3'
  return questsView.dailyDispo ? 'daily' : null
}

/** 0 to 1 and back, once a second: the breath of the control that waits. */
function breath(): number { return 0.5 - 0.5 * Math.cos((2 * Math.PI * (Date.now() % BREATH_MS)) / BREATH_MS) }

function claimScale(key: string): number {
  const t = Date.now() - (pressedAt.get(key) ?? 0)
  if (t < 80) return 1 - 0.10 * (t / 80)
  if (t < 200) return 0.90 + 0.22 * ((t - 80) / 120)
  if (t < PRESS_MS) return 1.12 - 0.12 * ((t - 200) / 120)
  return key === firstClaimable() ? 1 + 0.06 * breath() : 1
}
function claimLift(key: string): number { return !pressing(key) && key === firstClaimable() ? 5 * breath() : 0 }
function claimFlash(key: string): number {
  const t = Date.now() - (pressedAt.get(key) ?? 0)
  return t < 220 ? 1 - t / 220 : 0
}

/** The swell of the OPEN button's icon once the HUD is back after a claim: 30 percent, a quarter of a second. */
export function claimLandingBump(): number {
  if (landing === 0) return 1
  const now = Date.now()
  // A claim made far from home lands nowhere visible: the swell is not owed twenty seconds later.
  if (now - landing > 20000) { landing = 0; return 1 }
  if (landedAt === 0) landedAt = now
  const t = now - landedAt
  if (t >= 250) { landing = 0; landedAt = 0; return 1 }
  return 1 + 0.3 * Math.sin((Math.PI * t) / 250)
}

/** The crate on its way out of the control that was claimed, drawn last so it rides over the rows. */
function Flyer(): ReactEcs.JSX.Element | null {
  if (flyer === null) return null
  const k = (Date.now() - flyer.at) / FLY_MS
  if (k >= 1) { flyer = null; return null }
  const base = 34
  const grow = k < 0.3 ? 1 + 0.3 * (k / 0.3) : 1.3 - 0.4 * ((k - 0.3) / 0.7)
  const s = Math.round(base * grow)
  const fade = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25
  const a = (1 - k) * (1 - k), b = 2 * (1 - k) * k, c = k * k
  const bottom = HAUTEUR_GOALS + 30
  if (flyer.key === 'daily') {
    const j = Math.max(0, flyer.day - 1)
    const x0 = (j * (100 - 12.4)) / 6 + 6.2
    const y0 = 3 * (ROW + ROW_GAP) + (ROW + 6) + (30 + ROW_GAP + 4) + STREAK_H / 2
    const x = a * x0 + b * (x0 + 4) + c * 92
    const y = a * y0 + b * (y0 - 110) + c * bottom
    return (
      <UiEntity uiTransform={{ width: s, height: s, positionType: 'absolute', position: { left: `${x}%`, top: Math.round(y - s / 2) }, zIndex: 5, opacity: fade }}
        uiBackground={{ texture: { src: 'assets/ui/ui-crate.png' }, textureMode: 'stretch' }} />
    )
  }
  const row = Number(flyer.key.slice(1))
  // The crate's own place inside the 187-wide plate, which sits ten units in from the right edge.
  const r0 = 146
  const y0 = row * (ROW + ROW_GAP) + (row === 3 ? 6 : 0) + ROW / 2
  const r = a * r0 + b * (r0 + 40) + c * 40
  const y = a * y0 + b * (y0 - 110) + c * bottom
  return (
    <UiEntity uiTransform={{ width: s, height: s, positionType: 'absolute', position: { right: Math.round(r - s / 2), top: Math.round(y - s / 2) }, zIndex: 5, opacity: fade }}
      uiBackground={{ texture: { src: 'assets/ui/ui-crate.png' }, textureMode: 'stretch' }} />
  )
}

export function questsToClaim(): number {
  let n = 0
  for (let i = 0; i < questsView.ids.length; i++) {
    if (questsView.progres[i] >= questsView.cibles[i] && questsView.pris[i] !== 1) n++
  }
  if (n === 0 && allQuestsDone() && questsView.pris[3] !== 1) n = 1
  if (questsView.dailyDispo) n += 1     // today's chest is waiting to be claimed
  return n
}

function allQuestsDone(): boolean {
  if (questsView.ids.length === 0) return false
  for (let i = 0; i < questsView.ids.length; i++) {
    if (questsView.progres[i] < questsView.cibles[i]) return false
  }
  return true
}

function QuestRow(props: { i: number; key?: string }): ReactEcs.JSX.Element {
  const i = props.i
  const q = QUESTS[questsView.ids[i]]
  const fait = questsView.progres[i] ?? 0
  const cible = questsView.cibles[i] ?? 1
  const fini = fait >= cible
  const pris = questsView.pris[i] === 1
  const pct = Math.min(100, Math.round((fait / cible) * 100))
  return (
    <UiEntity
      uiTransform={{
        width: '100%', height: ROW, flexDirection: 'row', alignItems: 'center',
        margin: { bottom: ROW_GAP }, padding: { left: 16, right: 10 }, borderRadius: RAD.card
      }}
      uiBackground={{ color: SURF.carte }}
    >
      <UiEntity uiTransform={{ width: COL.texte, height: TAP.menu, flexDirection: 'column', justifyContent: 'center' }}>
        {/*
          One line, never two. The box is 34 tall and the text wrapped inside it, so the
          longest goal ran out under its own progress bar on a handset (owner, 7 Sep). The
          four longest are shortened at the source and this can no longer wrap whatever
          arrives: a goal that does not fit its line is a goal to rewrite, not to reflow.
        */}
        <Label value={q?.texte ?? ''} fontSize={TYPE.label} textWrap="nowrap"
          color={pris ? Color4.fromHexString('#6f7a6fff') : Color4.White()}
          uiTransform={{ width: '100%', height: 34 }} textAlign="middle-left" />
        {/* The fill glides to its value and flashes white the moment it completes. */}
        <Barre largeur="96%" hauteur={20} haut={3} pct={pctAnime(`quete${i}`, pct)}
          couleur={(() => {
            const f = flashDe(`quete${i}`)
            const base = fini ? Color4.fromHexString('#8fe08fff') : Color4.fromHexString('#4dd2ffff')
            return f > 0 ? Color4.create(base.r + (1 - base.r) * f, base.g + (1 - base.g) * f, base.b + (1 - base.b) * f, 1) : base
          })()} />
      </UiEntity>
      <Label value={`${fait}/${cible}`} fontSize={TYPE.label}
        color={Color4.fromHexString('#a8b2c0ff')}
        uiTransform={{ width: COL.compteur, height: TAP.menu }} textAlign="middle-center" />
      <UiEntity uiTransform={{ width: COL.action, height: TAP.menu, justifyContent: 'flex-end', alignItems: 'center' }}>
      {pris && !pressing(`q${i}`) ? (
        <Btn label="CLAIMED" width={187} height={TAP.menu} size={TYPE.caption} skin="disabled" icon="ui-crate.png" />
      ) : fini ? (
        <Btn label="CLAIM" width={187} height={TAP.menu} size={TYPE.caption} skin="success" icon="ui-crate.png"
          scale={claimScale(`q${i}`)} iconLift={claimLift(`q${i}`)} flash={claimFlash(`q${i}`)}
          onClick={pris || pressing(`q${i}`) ? undefined : () => press(`q${i}`, () => claim(i))} />
      ) : (
        /*
          The reward, shown as a REWARD. It sat on a button plate reading "+1 CRATE" that
          did nothing until the quest finished: a control that ignores taps teaches the
          player the interface lies (owner, 1 Sep). A quiet chip with the crate icon says
          "this is what you are earning", and only CLAIM ever looks pressable.
        */
        /*
          LOCKED, in so many words. The "+1" chip with the crate was liked and then tapped: a
          reward drawn in full colour reads as something to collect, the tap did nothing, and
          that is the kind of silence that erodes trust (mobile tester, 3 Sep). The crate stays,
          dimmed, so the player still sees what they are earning; the word says why not yet.
          Same vocabulary as the set bonus below, which already says LOCKED.
        */
        <Btn label="LOCKED" width={187} height={TAP.menu} size={TYPE.caption} skin="disabled" icon="ui-crate.png" />
      )}
      </UiEntity>
    </UiEntity>
  )
}

/**
 * What this tab needs, so the window can be exactly that tall and no taller.
 *
 * Added up rather than guessed: title, subtitle, three rows with their gaps, the
 * all-three strip, the streak heading and the streak cards.
 */
const STREAK_H = 72
/*
  A goal row, and the gap under it. The rows stood at TAP.rangee with ten of air, and with
  the streak the tab ran 94 px past the body a phone gives it, which is what drew the
  scrollbar (owner, 3 Sep). 84 still clears the 80-tall controls it holds, and the whole
  tab now lands in one body: 3 x 92 + 90 + 34 + 72 = 472 for a body of 474.
*/
const ROW = 84
// Six, not eight: the two units the streak header needed came out of these three gaps, since
// the tab had two units of slack in a 474-unit body (10 Sep).
const ROW_GAP = 6

export const HAUTEUR_GOALS = 3 * (ROW + ROW_GAP) + (ROW + 6) + (30 + ROW_GAP + 4) + STREAK_H

/*
  The chips' words at the size the chip can hold.

  Seven chips share the row at 12.4 percent each, and the row is as wide as the sheet the
  client allows: 94 units a chip on the tester's phone (sheet 800, measured 10 Sep), 130 on a
  desktop. At caption 24 the longest word, CURSED, needs 95 of them and DAY 3 with its star
  needed 96: both ran past the chip the moment the phone caption went from 21 to 24 (7b0db).
  The size is chosen against the chip: the caption, or the first of its steps down that keeps
  every word the row can show inside the chip with four units of air on each side.
*/
const CHIP_WORDS = [...DAILY_REWARDS.map((t) => crate(t).name.split(' ')[0].toUpperCase()), 'DAY 7', 'CLAIM']
function chipTextSize(): number {
  const chipW = (strip(MENU_W).width - 2 * MENU_PAD) * 0.124
  for (const size of [TYPE.caption, 22, 21, 20]) {
    if (CHIP_WORDS.every((w) => largeurTexte(w, size) <= chipW - 8)) return size
  }
  return 20
}

export function QuestsContent(): ReactEcs.JSX.Element | null {
  const chipSize = chipTextSize()
  if (!questsView.open) return null
  const allDone = allQuestsDone()
  return (
    <UiEntity uiTransform={{ width: '100%', height: HAUTEUR_GOALS, flexDirection: 'column' }}>


    <UiEntity uiTransform={{ width: '100%', flexDirection: 'column' }}>
      {questsView.ids.map((_, i) => <QuestRow key={`quete${i}`} i={i} />)}

    <UiEntity
        uiTransform={{ width: '100%', height: ROW, flexDirection: 'row', alignItems: 'center', margin: { top: 6 }, padding: { left: 16, right: 10 }, borderRadius: RAD.card }}
        uiBackground={{ color: SURF.carte }}
      >
        {/* Same three columns as a quest row: the text spans the first two, the action
            sits in the third, so the buttons of every row in this tab share one edge. */}
        <Label value="ALL THREE  ·  bonus rare box" fontSize={TYPE.label}
          color={allDone ? Color4.fromHexString('#ffd166ff') : Color4.fromHexString('#7d879bff')}
          uiTransform={{ width: '74%', height: 60 }} textAlign="middle-left" />
        <UiEntity uiTransform={{ width: COL.action, height: TAP.menu, justifyContent: 'flex-end', alignItems: 'center' }}>
          {questsView.pris[3] === 1 && !pressing('q3') ? (
            <Btn label="CLAIMED" width={187} height={TAP.menu} size={TYPE.caption} skin="disabled" icon="ui-crate.png" />
          ) : (
            <Btn label={allDone ? 'CLAIM' : 'LOCKED'} width={187} height={TAP.menu} size={TYPE.caption} icon="ui-crate.png"
              skin={allDone ? 'success' : 'disabled'}
              scale={allDone ? claimScale('q3') : 1} iconLift={allDone ? claimLift('q3') : 0} flash={claimFlash('q3')}
              onClick={allDone && questsView.pris[3] !== 1 && !pressing('q3') ? () => press('q3', () => claim(3)) : undefined} />
          )}
        </UiEntity>
    </UiEntity>

    <Label value="LOGIN STREAK" fontSize={TYPE.label} color={Color4.fromHexString('#4dd2ffff')}
        uiTransform={{ width: '100%', height: 30, margin: { top: ROW_GAP, bottom: 4 } }} textAlign="middle-left" />
      {/*
        Seven chips sized as a share of the width, so the row can never wrap.

        They were fixed at 104 wide and allowed to wrap when the panel narrowed, which broke
        the one thing the window relies on: this tab declares how tall it is, and the
        declaration assumed a single row. On the phone the seventh chip wrapped onto a second
        row that fell outside the declared height, so it could not be scrolled to and simply
        did not exist. A width in percent keeps all seven on one line at any panel width, and
        the height stays the number that was promised.

        12.4 rather than 13.2: seven of them leave 13 percent for six gaps, which on the
        narrowed window a phone actually gets is a visible space rather than the hairline the
        old figure produced.
      */}
      <UiEntity
        uiTransform={{ width: '100%', height: STREAK_H, flexDirection: 'row', justifyContent: 'space-between' }}
      >
        {DAILY_REWARDS.map((t, j) => {
          const dayN = j + 1
          /*
            Vert si CE coffre a ete pris, et rien d'autre.

            La condition lisait un compteur, donc elle ne pouvait colorer qu'un prefixe: tous
            les jours en-dessous de la serie, qu'ils aient ete encaisses ou non (proprietaire,
            7 Sep, "ca rend vert toutes les cases"). Le serveur envoie desormais la LISTE de ce
            qui a ete pris, et une liste dit ce qu'un nombre ne pouvait pas dire.
          */
          const passe = questsView.joursPris.includes(dayN)
          // The day to claim is the next in the streak, offered only when today's chest is waiting.
          const aReclamer = questsView.dailyDispo && dayN === questsView.prochainJour
          const actuel = dayN === questsView.log && !aReclamer
          return (
            <UiEntity key={`jour${dayN}`}
              uiTransform={{
                width: '12.4%', height: STREAK_H,
                flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
                borderRadius: RAD.card,
                borderWidth: aReclamer ? (firstClaimable() === 'daily' ? 3 + Math.round(3 * breath()) : 3) : actuel ? 2 : 0,
                borderColor: Color4.fromHexString((aReclamer ? '#a8e86e' : '#ffd166') + 'ff')
              }}
              uiBackground={{ color: aReclamer ? Color4.create(0.10, 0.28, 0.08, 0.95) : passe ? Color4.create(0.14, 0.30, 0.14, 0.9) : SURF.puce }}
              // Every action needs a reaction: this card is the only tappable surface that
              // is not a Btn, so it borrows the same click the buttons make.
              onMouseDown={aReclamer && !pressing('daily') ? (() => { tic(); press('daily', claimDaily) }) : undefined}
            >
              {dayN === dailyPressedDay && claimFlash('daily') > 0 && (
                <UiEntity uiTransform={{ width: '100%', height: STREAK_H, positionType: 'absolute', position: { top: 0, left: 0 }, borderRadius: RAD.card }}
                  uiBackground={{ color: Color4.create(1, 1, 1, 0.75 * claimFlash('daily')) }} />
              )}
              {/* No star beside the day: the green rim, the fill and the word CLAIM already say
                  it, and the star was the character that pushed the line past the chip. */}
              <Label value={`DAY ${dayN}`} fontSize={chipSize}
                color={aReclamer ? Color4.fromHexString('#c8f0a0ff') : passe ? Color4.fromHexString('#8fe08fff') : Color4.fromHexString('#a8b2c0ff')}
                uiTransform={{ width: '100%', height: 28 }} textAlign="middle-center" />
              {/* One word: "Basic Crate" wrapped into a third line the card never budgeted,
                  which is the clipped text the photographs showed. Every reward here IS a
                  crate; the card only has to say which. */}
              <Label value={aReclamer ? 'CLAIM' : crate(t).name.split(' ')[0].toUpperCase()} textWrap="nowrap"
                fontSize={aReclamer && firstClaimable() === 'daily' ? chipSize * (1 + 0.06 * breath()) : chipSize}
                color={aReclamer ? Color4.fromHexString('#ffd166ff') : Color4.fromHexString(lisible(crate(t).color) + 'ff')}
                uiTransform={{ width: '100%', height: 28 }} textAlign="middle-center" />
            </UiEntity>
          )
        })}
    </UiEntity>

    </UiEntity>
      <Flyer />
    </UiEntity>
  )
}
