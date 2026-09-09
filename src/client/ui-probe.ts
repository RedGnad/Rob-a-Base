/*
  Holds the interface in its worst case, for a review of the phone layout from a desktop.

  Three toasts of three lengths, the corner column at its fullest (a two-line tutorial hint,
  the rush chip or the raid countdown, the free-box timer, the cloak countdown), and the SELL
  button beside the pad. The systems keep writing the real views every frame; this runs after
  them, at the top of the HUD render, and overwrites what it needs. See UI_PROBE in theme.ts.
*/
import { UI_PROBE } from './theme'
import { alerter } from './theft'
import { giftView, tutoView, STEP_TEXTS } from './tutorial'
import { raidView } from './raid'
import { gearView } from './gear'
import { carryView } from './carry'
import { boxView } from './box'
import { eventView } from './events'

const HOLD_MS = 3_600_000
let seeded = false

export function applyUiProbe(): void {
  if (UI_PROBE === '') return
  if (!seeded) {
    seeded = true
    alerter('WELCOME BACK', '#ffd166', HOLD_MS)
    alerter('Neo Frostborn stole a Rainbow Epic from your base', '#ff6b6b', HOLD_MS)
    alerter('The RAINBOW RUSH is on: every box on the belt pays three times its price for ninety seconds', '#4dd2ff', HOLD_MS)
  }
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
