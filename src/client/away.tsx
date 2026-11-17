import { engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { room } from '../shared/messages'
import { rarity, rarityOf, nomDuCode, formatIncome } from '../shared/loot-table'
import { TYPE, C, TAP, SKIN, lisible } from './theme'
import { Glyphs, glyphWidth } from './glyphs'
import { Btn, cue } from './ui-kit'
import { strip } from './layout'
import { takeOfflineAnnounce, lastOfflineAnnounce, unqueue } from './theft'
import { goToBaseOf } from './travel'
import { welcomeView } from './welcome'
import { view } from './setup'

/*
  REVENGE, made visible, and the return told on one screen.

  The server has always let a robbed player through their thief's shield for REVENGE_MS
  (`meDoitUneRevanche`, server/theft.ts), and no screen ever said so: the robbed player read
  "STOLEN BY X" and nothing about the open door. A right the player does not know about does
  no work, and this one is the reason the design gives to come back ("they now owe you a
  visit"). The genre's answer is a log with a button: Clash of Clans keeps every raid in the
  defence log with Revenge on it for twelve hours (Supercell release notes).

  Three places carry it: the away report below, a row in the travel tab, and the action
  button, which says REVENGE instead of STEAL in front of a thief's shelf.
*/

/** The thieves this player may still rob through any shield, each with when that ends. */
export const revengeView = { list: [] as Array<{ id: string; name: string; until: number }> }

export function openRevenges(): Array<{ id: string; name: string; until: number }> {
  const now = Date.now()
  return revengeView.list.filter((r) => r.until > now)
}

export function revengeOn(ownerId: string): boolean {
  const id = ownerId.toLowerCase()
  return openRevenges().some((r) => r.id === id)
}

/** "7h", or "45m" in the last hour. */
export function revengeLeft(until: number): string {
  const s = Math.max(0, (until - Date.now()) / 1000)
  return s >= 3600 ? `${Math.floor(s / 3600)}h` : `${Math.max(1, Math.ceil(s / 60))}m`
}

export function takeRevenge(id: string): void {
  const r = openRevenges().find((x) => x.id === id)
  if (r === undefined) return
  awayView.open = false
  goToBaseOf(r.id, r.name)
}

/* What happened while away. `kind`: 0 theft, 1 sentry, 2 trap, 3 gift, 4 a theft that was their revenge (see `awayReport`). */
type AwayLine = { kind: number; name: string; id: string; code: number }
export const awayView = { open: false, gain: 0, capped: false, lines: [] as AwayLine[] }
export function closeAway(): void { awayView.open = false }

export function setupAway(): void {
  // Tell each server, once it answers, that this client is listening (server/theft.ts,
  // `accueillir`). Not through `sendOrHold`: it keeps one intent and a tap would replace this.
  let alive = false
  engine.addSystem(() => {
    if (view.serverAlive === alive) return
    alive = view.serverAlive
    if (alive) void room.send('awayReady', {})
  })

  room.onMessage('revenges', (d) => {
    const now = Date.now()
    revengeView.list = d.ids.map((id, i) => ({ id: id.toLowerCase(), name: d.names[i] ?? '', until: now + (d.leftSec[i] ?? 0) * 1000 }))
  })

  room.onMessage('awayReport', (d) => {
    awayView.lines = d.kinds.map((kind, i) => ({ kind, name: d.names[i] ?? '', id: (d.ids[i] ?? '').toLowerCase(), code: d.codes[i] ?? -1 }))
    if (awayView.lines.length === 0) return
    // The sum may have come first, as a toast in the queue: it moves onto this screen.
    const o = lastOfflineAnnounce()
    if (o.at > 0 && Date.now() - o.at < 180_000) { awayView.gain = o.gain; awayView.capped = o.capped }
    unqueue('WELCOME BACK')
    unqueue('SILO FULL')
    awayView.open = true
    // The siren each replayed theft used to ring, rung once for the whole report.
    if (awayView.lines.some((l) => l.kind === 0 || l.kind === 4)) cue('alerte-vol.wav', 0.8)
  })

  // Or it comes second, while this screen is up: it is said here and not as a toast.
  takeOfflineAnnounce((gain, capped) => {
    if (!awayView.open) return false
    awayView.gain = gain
    awayView.capped = capped
    return true
  })
}

const W = 900
const ROWS = 3
const ROW_GAP = 10
const BUTTON_W = 300

function lineText(l: AwayLine): string {
  if (l.kind === 1) return `Your sentry stopped ${l.name}`
  if (l.kind === 2) return `Your trap caught ${l.name}`
  if (l.kind === 3) return `${l.name} left you a ${nomDuCode(l.code)}`
  if (l.kind === 4) return `${l.name} took your ${nomDuCode(l.code)}: their revenge`
  return `${l.name} took your ${nomDuCode(l.code)}`
}

function lineColor(l: AwayLine): Color4 {
  if (l.kind === 1 || l.kind === 2) return Color4.fromHexString(lisible('#4dd2ff') + 'ff')
  return Color4.fromHexString(lisible(rarity(rarityOf(l.code)).color) + 'ff')
}

export const AwayPanel = () => {
  // The title card goes first: a player who has not seen it has nothing to come back to yet.
  if (!awayView.open || welcomeView.open) return <UiEntity uiTransform={{ width: 0, height: 0 }} />
  const width = strip(W).width
  // Newest first, three rows: a night's log is read for what matters most recently.
  const rows = [...awayView.lines].reverse().slice(0, ROWS)
  const more = awayView.lines.length - rows.length
  const title = 'WHILE YOU WERE AWAY'
  return (
    <UiEntity
      uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center', pointerFilter: 'block' }}
    >
      <UiEntity
        uiTransform={{ width, flexDirection: 'column', alignItems: 'center', padding: 24 }}
        uiBackground={SKIN.panel}
      >
        <UiEntity uiTransform={{ width: glyphWidth(title, TYPE.title), height: TYPE.title + 8, margin: { bottom: 12 } }}>
          <Glyphs value={title} size={TYPE.title} role="bonus" />
        </UiEntity>

        {awayView.gain > 0 && (
          <Label uiTransform={{ width: '100%', height: 44 }}
            value={`+${formatIncome(awayView.gain)} banked by your shelves`}
            fontSize={TYPE.body} color={C.money} textAlign="middle-center" />
        )}
        {awayView.gain > 0 && awayView.capped && (
          <Label uiTransform={{ width: '100%', height: 32 }}
            value="Your silo was full: build another to bank longer"
            fontSize={TYPE.caption} color={C.dim} textAlign="middle-center" />
        )}

        {rows.map((l, i) => {
          const revenge = l.kind === 0 && l.id !== '' ? openRevenges().find((r) => r.id === l.id) : undefined
          return (
            <UiEntity key={`away${i}`}
              uiTransform={{
                width: '100%', height: TAP.height, margin: { top: ROW_GAP },
                flexDirection: 'row', alignItems: 'center', padding: { left: 18, right: 18 }
              }}
              uiBackground={SKIN.card}
            >
              <Label uiTransform={{ width: revenge !== undefined ? width - 48 - 36 - BUTTON_W - 12 : width - 48 - 36, height: TAP.height }}
                value={lineText(l)} fontSize={TYPE.label} color={lineColor(l)}
                textAlign="middle-left" textWrap="wrap" />
              {revenge !== undefined && (
                <UiEntity uiTransform={{ width: BUTTON_W, height: TAP.height - 12, margin: { left: 12 } }}>
                  <Btn label={`REVENGE  ${revengeLeft(revenge.until)}`} width={BUTTON_W} height={TAP.height - 12}
                    skin="danger" onClick={() => takeRevenge(revenge.id)} />
                </UiEntity>
              )}
            </UiEntity>
          )
        })}
        {more > 0 && (
          <Label uiTransform={{ width: '100%', height: 32, margin: { top: 6 } }}
            value={`and ${more} more`} fontSize={TYPE.caption} color={C.dim} textAlign="middle-center" />
        )}

        <UiEntity uiTransform={{ width: 340, height: TAP.height, margin: { top: 18 } }}>
          <Btn label="CONTINUE" width={340} primary onClick={closeAway} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
