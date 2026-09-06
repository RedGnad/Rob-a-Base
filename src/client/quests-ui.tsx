import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { sendOrHold } from './intent'
import { TYPE, TAP, C, RAD, lisible } from './theme'
import { Btn, Barre, SURF, pctAnime, flashDe, tic } from './ui-kit'
import { Color4 } from '@dcl/sdk/math'
import { strip, BAND } from './layout'
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
    questsView.dailyDispo = d.dailyDispo
    questsView.prochainJour = d.prochainJour
  })
}

function claim(slot: number): void { sendOrHold(() => { void room.send('claimQuest', { slot }) }) }
function claimDaily(): void { sendOrHold(() => { void room.send('claimDaily', {}) }) }

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

function QuestRow(props: { i: number }): ReactEcs.JSX.Element {
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
        <Label value={q?.texte ?? ''} fontSize={TYPE.label}
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
      {pris ? (
        <Btn label="CLAIMED" width={187} height={TAP.menu} size={TYPE.caption} skin="disabled" icon="ui-crate.png" />
      ) : fini ? (
        <Btn label="CLAIM" width={187} height={TAP.menu} size={TYPE.caption} skin="success" icon="ui-crate.png" onClick={() => claim(i)} />
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
const ROW_GAP = 8

export const HAUTEUR_GOALS = 3 * (ROW + ROW_GAP) + (ROW + 6) + (26 + ROW_GAP) + STREAK_H

export function QuestsContent(): ReactEcs.JSX.Element | null {
  if (!questsView.open) return null
  const allDone = allQuestsDone()
  return (
    <UiEntity uiTransform={{ width: '100%', height: HAUTEUR_GOALS, flexDirection: 'column' }}>


    <UiEntity uiTransform={{ width: '100%', flexDirection: 'column' }}>
      {questsView.ids.map((_, i) => <QuestRow i={i} />)}

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
          {questsView.pris[3] === 1 ? (
            <Btn label="CLAIMED" width={187} height={TAP.menu} size={TYPE.caption} skin="disabled" icon="ui-crate.png" />
          ) : (
            <Btn label={allDone ? 'CLAIM' : 'LOCKED'} width={187} height={TAP.menu} size={TYPE.caption} icon="ui-crate.png"
              skin={allDone ? 'success' : 'disabled'}
              onClick={allDone ? () => claim(3) : undefined} />
          )}
        </UiEntity>
    </UiEntity>

    <Label value="LOGIN STREAK" fontSize={TYPE.label} color={Color4.fromHexString('#4dd2ffff')}
        uiTransform={{ width: '100%', height: 26, margin: { top: ROW_GAP } }} textAlign="middle-left" />
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
          const passe = dayN < questsView.log || (dayN === questsView.log && questsView.dayClaimed)
          // The day to claim is the next in the streak, offered only when today's chest is waiting.
          const aReclamer = questsView.dailyDispo && dayN === questsView.prochainJour
          const actuel = dayN === questsView.log && !aReclamer
          return (
            <UiEntity
              uiTransform={{
                width: '12.4%', height: STREAK_H,
                flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
                borderRadius: RAD.card,
                borderWidth: aReclamer ? 3 : actuel ? 2 : 0,
                borderColor: Color4.fromHexString((aReclamer ? '#a8e86e' : '#ffd166') + 'ff')
              }}
              uiBackground={{ color: aReclamer ? Color4.create(0.10, 0.28, 0.08, 0.95) : passe ? Color4.create(0.14, 0.30, 0.14, 0.9) : SURF.puce }}
              // Every action needs a reaction: this card is the only tappable surface that
              // is not a Btn, so it borrows the same click the buttons make.
              onMouseDown={aReclamer ? (() => { tic(); claimDaily() }) : undefined}
            >
              <Label value={aReclamer ? `DAY ${dayN}  ✦` : `DAY ${dayN}`} fontSize={TYPE.caption}
                color={aReclamer ? Color4.fromHexString('#c8f0a0ff') : passe ? Color4.fromHexString('#8fe08fff') : Color4.fromHexString('#a8b2c0ff')}
                uiTransform={{ width: '100%', height: 28 }} textAlign="middle-center" />
              {/* One word: "Basic Crate" wrapped into a third line the card never budgeted,
                  which is the clipped text the photographs showed. Every reward here IS a
                  crate; the card only has to say which. */}
              <Label value={aReclamer ? 'CLAIM' : crate(t).name.split(' ')[0].toUpperCase()} fontSize={TYPE.caption} textWrap="nowrap"
                color={aReclamer ? Color4.fromHexString('#ffd166ff') : Color4.fromHexString(lisible(crate(t).color) + 'ff')}
                uiTransform={{ width: '100%', height: 28 }} textAlign="middle-center" />
            </UiEntity>
          )
        })}
    </UiEntity>

    </UiEntity>
    </UiEntity>
  )
}
