/*
  Holds the interface in its worst case, for a review of the phone layout from a desktop.

  The two longest real toasts, the corner column at its fullest (a two-line tutorial hint,
  the rush chip or the raid countdown, the free-box timer, the cloak countdown), and the SELL
  button beside the pad. The systems keep writing the real views every frame; this runs after
  them, at the top of the HUD render, and overwrites what it needs. See UI_PROBE in theme.ts.
*/
import { UI_PROBE } from './theme'
import { alerter, alerterEnFile, pushToFeed, theftView, hiddenClock, myClientAddress } from './theft'
import { awayView, revengeView } from './away'
import { TOAST } from './theme'
import { chooseTab, closeMenu } from './menu'
import { welcomeView } from './welcome'
import { questsView } from './quests-ui'
import { giftView, tutoView, STEP_TEXTS } from './tutorial'
import { raidView } from './raid'
import { gearView } from './gear'
import { carryView } from './carry'
import { boxView } from './box'
import { eventView } from './events'
import { crateBurst, stealBurst, fuseBurst, zapBurst, startRushAir } from './vfx'
import { revealItem } from './box'
import { engine, Entity, Transform, MeshRenderer } from '@dcl/sdk/ecs'
import { sentryLight } from './lights'
import { FLOOR_HEIGHT, EVENT_THEMES } from '../shared/schemas'
import { caisse } from './toy'
import { crate, rarity } from '../shared/loot-table'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

const HOLD_MS = 3_600_000
/** What the timeline is doing right now, drawn big on the HUD so a capture explains itself. */
export function probeStatus(): string { return status }
let status = ''
let seeded = false
let t0 = 0
let phase = -1
const fired = new Set<string>()
const once = (key: string, f: () => void): void => { if (!fired.has(key)) { fired.add(key); f() } }
const plates = (now: number): string =>
  theftView.alertes.map((a) => `${a.t.slice(0, 18)} ${Math.round((a.until - now) / 1000)}s keep=${a.keep}`).join(' | ') || '(none)'

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
    if (p === 0 && t >= 1) pushToFeed('Cyrus Nightwing picked a Legendary')
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
  if (p === 1) {
    // The two clocks and the stack at three points behind the menu: the measurement that
    // says whether a frozen plate is still there and why the `dt` freeze lost it.
    for (const at of [9, 16, 23]) if (t >= at) once(k(`clock${at}`), () => {
      const c = hiddenClock()
      console.log(`[PROBE] t=${at} hud=${theftView.hudVisible} hidden dt=${c.dtMs}ms wall=${c.wallMs}ms plates: ` + plates(now))
    })
  }
  if (p === 2) once(k('close'), () => {
    closeMenu()
    console.log('[PROBE] plates at close: ' + plates(now))
  })
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
  // The welcome card would sit over the sheet for a player the server has not seen close it.
  welcomeView.open = false
  // The goals tab with today's chest waiting on day 3: the chip the owner asked about (10 Sep).
  if (tab === 'goals') {
    questsView.dailyDispo = true
    questsView.prochainJour = 3
    questsView.log = 2
    if (questsView.joursPris.length !== 2) questsView.joursPris = [1, 2]
  }
}

/*
  The away report as a night's return shows it: the longest name the board has shown, a theft
  with its revenge open, a sentry, a trap, and a gift past the three rows. The revenge points
  at the player's own base, the one base a solo preview always has, so the button's journey
  can be pressed and watched. The two theft toasts wait behind the report, as they would.
*/
function awayProbe(): void {
  const me = myClientAddress()
  if (seeded || me === '') return
  seeded = true
  const now = Date.now()
  revengeView.list = [{ id: me, name: 'Cyrus Nightwing', until: now + 7.9 * 3_600_000 }]
  awayView.lines = [
    { kind: 3, name: 'Mira', id: '', code: 203 },
    { kind: 2, name: 'Cyrus Nightwing', id: '', code: -1 },
    { kind: 4, name: 'Mira', id: 'mira', code: 302 },
    { kind: 1, name: 'Cyrus Nightwing', id: '', code: -1 },
    { kind: 0, name: 'Cyrus Nightwing', id: me, code: 411 }
  ]
  awayView.gain = 128_400
  awayView.capped = true
  awayView.open = true
  alerter('STOLEN BY CYRUS NIGHTWING  ·  sealed 8h', '#ff4dd2', HOLD_MS)
  alerterEnFile('REVENGE OPEN ON CYRUS NIGHTWING  ·  8h', '#ff6b6b', HOLD_MS)
}

/*
  The particle moments, one every four seconds, on the wall clock so a capture can be timed to
  a step (step n fires when the epoch in ms reaches a multiple of 4000): the crate ladder from
  Basic to Mythic, the ten themed crates, a theft for each rarity in front of the player, a
  fusion for each rarity at the machine, a sentry hit, then a real Legendary Gold reveal
  through the fuser's path. Each step is logged.
*/
const VFX_STEP_MS = 4000
const VFX_CRATES = [0, 1, 2, 3, 7, 8, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15]
let vfxStep = -1
function vfxProbe(): void {
  const total = VFX_CRATES.length + 7 + 5 + 2
  const step = Math.floor(Date.now() / VFX_STEP_MS) % total
  if (step === vfxStep) return
  vfxStep = step
  const me = Transform.getOrNull(engine.PlayerEntity)
  if (me === null) return
  const ahead = (d: number, up: number): Vector3 => {
    const f = Vector3.rotate(Vector3.create(0, 0, d), me.rotation)
    return Vector3.create(me.position.x + f.x, me.position.y + up, me.position.z + f.z)
  }
  let k = step
  if (k < VFX_CRATES.length) {
    crateBurst(VFX_CRATES[k], ahead(2.6, 1.1))
    console.log(`[PROBE] vfx ${step}: crate ${crate(VFX_CRATES[k]).name}`)
    return
  }
  k -= VFX_CRATES.length
  if (k < 7) {
    stealBurst(k, rarity(k).color, ahead(2.2, 1.2))
    console.log(`[PROBE] vfx ${step}: steal ${rarity(k).name}`)
    return
  }
  k -= 7
  if (k < 5) {
    fuseBurst(k + 2, rarity(k + 2).color)
    console.log(`[PROBE] vfx ${step}: fuse ${rarity(k + 2).name}`)
    return
  }
  k -= 5
  if (k === 0) { zapBurst(ahead(2.2, 1.1)); console.log(`[PROBE] vfx ${step}: zap`) }
  if (k === 1) { revealItem(401); console.log(`[PROBE] vfx ${step}: reveal`) }
}

/*
  The reveal ladder: a plain piece of each rarity, Common to Secret, one every four seconds on the
  wall clock (step n is rarity n), so the seven reveals can be heard and captured side by side.
*/
let revealStep = -1
function revealProbe(): void {
  const step = Math.floor(Date.now() / VFX_STEP_MS) % 7
  if (step === revealStep) return
  revealStep = step
  revealItem(step * 100)
  console.log(`[PROBE] reveal ${step}: ${rarity(step).name}`)
}

/*
  The air of each rush in turn, twenty seconds each, on the wall clock like the bursts. Only
  the particles: the floor and the chip stay as they are, so a capture shows what this adds.
*/
const AIR_STEP_MS = 20000
let airStep = -1
function airProbe(): void {
  const step = Math.floor(Date.now() / AIR_STEP_MS) % EVENT_THEMES.length
  if (step === airStep) return
  airStep = step
  startRushAir(EVENT_THEMES[step].theme)
  console.log(`[PROBE] air ${step}: ${EVENT_THEMES[step].name}`)
}

/*
  Every crate on the plaza, seen from its latch side: the tier ladder in the back row, cheapest
  on the left, and the ten themed crates in front.
*/
let cratesLaid = false
function cratesProbe(): void {
  if (cratesLaid) return
  cratesLaid = true
  const rows = [[0, 1, 2, 3, 7, 8], [4, 5, 6, 9, 10, 11, 12, 13, 14, 15]]
  rows.forEach((ids, r) => ids.forEach((id, i) => {
    const size = crate(id).size
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(106 - i * 2.4, 0.6 + size / 2, 104 + r * 3), scale: Vector3.create(size, size, size) })
    caisse(e, id)
  }))
}

/*
  The sentry light pool without a second player: three cones in a base root turned half a turn,
  the way a north base faces the belt. Two stand on one storey beside the player and one a storey
  up, so the pool should light the two on the player's storey. After six seconds the nearer one
  is disarmed and its light should move to the cone upstairs.
*/
let lightCones: Entity[] = []
let lightStep = -1
function lightsProbe(): void {
  const t = Math.floor(Date.now() / 6000)
  if (lightCones.length === 0) {
    lightStep = t
    const root = engine.addEntity()
    Transform.create(root, { position: Vector3.create(110, 0, 100), rotation: Quaternion.fromEulerDegrees(0, 180, 0) })
    lightCones = [Vector3.create(2, 0.5, 0), Vector3.create(-3, 0.5, 2), Vector3.create(2, 0.5 + FLOOR_HEIGHT, 0)].map((at) => {
      const e = engine.addEntity()
      Transform.create(e, { parent: root, position: at })
      MeshRenderer.setCylinder(e, 0.15, 0.3)
      sentryLight(e, true)
      return e
    })
    console.log('[PROBE] lights: cones at world (108,0.5,100) (113,0.5,98) (108,' + (0.5 + FLOOR_HEIGHT) + ',100)')
    return
  }
  if (t > lightStep && lightCones[0] !== undefined) {
    lightStep = Infinity
    sentryLight(lightCones[0], false)
    console.log('[PROBE] lights: first cone disarmed')
  }
}

export function applyUiProbe(): void {
  if (UI_PROBE === '') return
  if (UI_PROBE === 'lights') { lightsProbe(); return }
  if (UI_PROBE === 'crates') { cratesProbe(); return }
  if (UI_PROBE === 'vfx') { vfxProbe(); return }
  if (UI_PROBE === 'reveal') { revealProbe(); return }
  if (UI_PROBE === 'air') { airProbe(); return }
  if (UI_PROBE === 'away') { awayProbe(); return }
  if (UI_PROBE === 'timeline') { timeline(); return }
  if (UI_PROBE === 'menu') { menuCycle(); return }
  if (!seeded) {
    seeded = true
    // Real lines with the longest name the board has shown; the stack keeps two, never more.
    alerter('SENTRY STOPPED CYRUS NIGHTWING  ·  2 left', '#4dd2ff', HOLD_MS)
    alerter('STOLEN BY CYRUS NIGHTWING  ·  sealed 8h', '#ff4dd2', HOLD_MS)
  }
  pushToFeed('Cyrus Nightwing picked a Legendary')
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
