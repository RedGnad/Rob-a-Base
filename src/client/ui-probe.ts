/*
  Holds the interface in its worst case, for a review of the phone layout from a desktop.

  The two longest real toasts, the corner column at its fullest (a two-line tutorial hint,
  the rush chip or the raid countdown, the free-box timer, the cloak countdown), and the SELL
  button beside the pad. The systems keep writing the real views every frame; this runs after
  them, at the top of the HUD render, and overwrites what it needs. See UI_PROBE in theme.ts.
*/
import { UI_PROBE } from './theme'
import { alerter, pushToFeed } from './theft'
import { TOAST } from './theme'
import { chooseTab, closeMenu } from './menu'
import { welcomeView } from './welcome'
import { giftView, tutoView, STEP_TEXTS } from './tutorial'
import { raidView } from './raid'
import { gearView } from './gear'
import { carryView } from './carry'
import { boxView } from './box'
import { eventView } from './events'

const HOLD_MS = 3_600_000
/** What the timeline is doing right now, drawn big on the HUD so a capture explains itself. */
export function probeStatus(): string { return status }
let status = ''
let seeded = false
let t0 = 0
let phase = -1
const fired = new Set<string>()
const once = (key: string, f: () => void): void => { if (!fired.has(key)) { fired.add(key); f() } }

/*
  The timeline: five checks in forty seconds, each announced in the scene log so a script can
  take its screenshot at the right moment. Phase 0: a short column and one feed line (it must
  show, one line, sized to its words). Phase 1: the shop opens, then a durable toast and a
  refusal are raised behind it. Phase 2: the shop closes: the durable toast must slide in, the
  refusal must not. Phase 3: the column at its fullest with the cloak on: a feed line must NOT
  show, and the cyan frame must sit under the pad and the column. Phase 4: the raid countdown
  in place of the rush chip.
*/
function timeline(): void {
  const now = Date.now()
  if (t0 === 0) t0 = now
  // Cyclic, 42 s a turn, so every phase comes round again for a screenshot taken late.
  const cycle = Math.floor((now - t0) / 60_000)
  const t = ((now - t0) / 1000) % 60
  const p = t < 6 ? 0 : t < 24 ? 1 : t < 32 ? 2 : t < 42 ? 3 : t < 52 ? 4 : 5
  if (p !== phase) { phase = p; console.log(`[PROBE] phase ${p} cycle ${cycle} at ${t.toFixed(1)} s`) }
  status = `PROBE p${p} c${cycle} t=${t.toFixed(0)}`
  const k = (key: string): string => `${cycle}:${key}`
  giftView.leftS = 320
  giftView.totalS = 900
  carryView.code = 0
  carryView.vole = false
  boxView.roule = false
  boxView.resultat = -1
  raidView.active = false
  if (p <= 2) {
    tutoView.etape = tutoView.total
    eventView.theme = -1
    gearView.cloakLeftS = 0
    raidView.nextS = 506
    if (p === 0 && t >= 1) pushToFeed('Cyrus Nightwing picked up a Legendary')
  }
  if (p === 1) {
    // The three tabs in turn, for the owner's eye on their text alignment (10 Sep).
    once(k('shop'), () => chooseTab('shop'))
    if (t >= 12) once(k('index'), () => chooseTab('index'))
    if (t >= 18) once(k('goals'), () => chooseTab('goals'))
    if (t >= 8) once(k('toasts'), () => {
      alerter('STOLEN BY CYRUS NIGHTWING  ·  sealed 8h', '#ff4dd2', TOAST.event)
      alerter('NOT ENOUGH COINS  ·  12.5K MORE', '#ffd166', TOAST.result)
    })
  }
  if (p === 2) once(k('close'), () => closeMenu())
  if (p >= 3) {
    const step = STEP_TEXTS.findIndex((s) => s.titre === 'Buy a box')
    tutoView.etape = step >= 0 ? step : 0
    tutoView.since = now - 60_000
    // The cloak only in phase 3, so phases 3 and 4 differ by the frame and two chips.
    gearView.cloakLeftS = p === 3 ? 45 : 0
    if (p === 3) {
      eventView.theme = 0
      eventView.grand = true
      eventView.leftS = 83
      eventView.color = '#4dd2ff'
      raidView.nextS = 0
      if (t >= 33) once(k('feed3'), () => pushToFeed('Cyrus Nightwing stole a Legendary'))
    } else {
      eventView.theme = -1
      raidView.nextS = 506
    }
  }
  // Phase 5: the welcome card, as a first visit sees it.
  welcomeView.open = p === 5
}

/* The three menu tabs in turn, eight seconds each, nothing else: for a look at their text. */
function menuCycle(): void {
  const now = Date.now()
  if (t0 === 0) t0 = now
  const cycle = Math.floor((now - t0) / 24_000)
  const t = ((now - t0) / 1000) % 24
  const tab = t < 8 ? 'shop' : t < 16 ? 'index' : 'goals'
  status = `PROBE ${tab} c${cycle} t=${t.toFixed(0)}`
  fired.has(`${cycle}:${tab}`) || (fired.add(`${cycle}:${tab}`), chooseTab(tab))
}

export function applyUiProbe(): void {
  if (UI_PROBE === '') return
  if (UI_PROBE === 'timeline') { timeline(); return }
  if (UI_PROBE === 'menu') { menuCycle(); return }
  if (!seeded) {
    seeded = true
    // Real lines with the longest name the board has shown; the stack keeps two, never more.
    alerter('SENTRY STOPPED CYRUS NIGHTWING  ·  2 left', '#4dd2ff', HOLD_MS)
    alerter('STOLEN BY CYRUS NIGHTWING  ·  sealed 8h', '#ff4dd2', HOLD_MS)
  }
  pushToFeed('Cyrus Nightwing picked up a Legendary')
  // The longest hint, and old enough for the hint to be due: two lines on a phone.
  const step = STEP_TEXTS.findIndex((s) => s.titre === 'Buy a box')
  tutoView.etape = step >= 0 ? step : 0
  tutoView.since = Date.now() - 60_000
  if (UI_PROBE === 'rush') {
    eventView.theme = 0
    eventView.grand = true
    eventView.leftS = 83
    eventView.color = '#4dd2ff'
  } else {
    eventView.theme = -1
    raidView.active = false
    raidView.nextS = 506
  }
  giftView.leftS = 320
  giftView.totalS = 900
  gearView.cloakLeftS = 45
  carryView.code = 0
  carryView.vole = false
  boxView.roule = false
  boxView.resultat = -1
}
