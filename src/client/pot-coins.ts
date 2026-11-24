import { engine, Transform, GltfContainer, AudioSource, Entity } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { room } from '../shared/messages'
import { PENDING_CAP_S } from '../shared/schemas'
import { theftView, pendingShown } from './theft'
import { sendOrHold } from './intent'
import { replay, volumeInitial } from './sfx'
import { currentStep } from './tutorial'

/*
  The pot, seen where it is made (founder, 19 Nov 2026).

  Testers took a long time to understand that a shelved piece earns money. The rising coin of
  `gains.ts` left each piece and vanished, the pot was a number on the central button, and
  nothing on the piece said "money is waiting here". In Don Norman's terms the AFFORDANCE was
  there (the button collects) and the SIGNIFIER was missing: "what people need, and what design
  must provide, are signifiers" ("Signifiers, not affordances", 2008). The genre puts it on the
  producer: Clash of Clans raises a gold icon over a mine that holds gold, and one tap collects
  every mine (wiki, Gold Mine); Steal a Brainrot collects at each brainrot's own plate (wiki, Cash).

  So over each piece of your base a gold coin waits and turns, the same coin as the one that rises
  out of the piece, which now lands in it. It grows in three steps as the pot fills. Pressing
  COLLECT, or walking into one of the coins, sends every coin flying to you and banks the pot.
  The founder asked for it to be juicy and to mean something. The research says how much:
  feedback "relevant in the context of the player's actions" that "provide[s] cues to help
  players understand game mechanics" (Hicks et al., DiGRA 2018), and neither none nor too much,
  both of which hurt experience and play time (Kao, cited by Hicks et al. 2024). Hence one coin
  per piece, squash and stretch on each landing (Disney's principles, the same as BUILD HERE),
  an anticipation hop before each flight, one cash sound per collect, and a soft tink at most
  every two seconds and only near the base.

  Your own base only: the pot is nobody else's business.

  One exception to "a coin shows once a rising coin lands in it": the tutorial's collect step.
  A new player shelved their first piece and was told to collect while nothing showed for a few
  seconds, the first rising coin and the first coin in the pot still on their way; a newcomer
  told to do something with nothing to do it on looks elsewhere or leaves (founder, 24 Nov
  2026). On that step the coin over a shelved piece appears at once, before the pot holds its
  first coin, which takes at most a second. A touch still waits for the pot (`pot > 0` below),
  so walking into it then collects real money. Once, until the first collect of the session.
*/

const COIN = 'assets/Models/coin.glb'
/** The coin's thickness against its diameter, the same as the rising coin's. */
const THICKNESS = 0.14
/** Where the waiting coin hangs over the top of its piece: the rising coin ends its climb here. */
export const POT_COIN_LIFT = 0.72
const SPIN_TURNS_PER_S = 0.55
const BOB_M = 0.04
const APPEAR_MS = 280
const BUMP_MS = 240
const HOP_MS = 130
const FLY_MS = 470
const STAGGER_MS = 35
const STAGGER_MAX_MS = 420
/** Past this distance a coin is not flown across the field: it pops where it is. */
const FAR_M = 35
const POP_MS = 160
const TOUCH_RADIUS_M = 1.3
/** From the chest: the coin over a tall Secret on the ground floor still counts, the one a storey up does not. */
const TOUCH_HEIGHT_M = 2.2
const TOUCH_COOLDOWN_MS = 1500
const TINK_EVERY_MS = 2000
const TINK_RANGE_M = 14

type Flight = { start: number; x: number; y: number; z: number; far: boolean }
type Waiting = {
  e: Entity
  x: number; y: number; z: number
  rarity: number
  /** A rising coin has landed in it since the last collect: it shows. */
  landed: boolean
  bornAt: number
  bumpAt: number
  phase: number
  flight: Flight | null
}

const waiting = new Map<number, Waiting>()
let lastTouch = 0
let lastFlight = 0
/** The first collect of the session happened: the collect step's early coin is over. */
let collectedOnce = false
let lastTink = 0
let tink: Entity | null = null
let lastSync = 0

/** A coin's diameter before the pot's growth: a rarer piece makes a bigger coin, as it does when it rises. */
function baseSize(rarity: number): number {
  return 0.3 + Math.max(0, Math.min(6, rarity)) * 0.03
}

/** Three steps as the pot fills towards its ceiling: it grows "a little" and never becomes a sign. */
function potStep(): number {
  const rate = theftView.income * (1 + theftView.prime)
  const cap = rate * PENDING_CAP_S
  if (cap <= 0) return 1
  const f = pendingShown() / cap
  return f < 1 / 3 ? 1 : f < 2 / 3 ? 1.2 : 1.4
}

/**
 * The occupied pedestals of your base, in world coordinates at the top of their piece, keyed by
 * slot. Called by plots.ts a few times a second; slots that are gone lose their coin.
 */
export function syncPotSlots(slots: Array<{ key: number; x: number; y: number; z: number; rarity: number }>): void {
  lastSync = Date.now()
  const seen = new Set<number>()
  for (const s of slots) {
    seen.add(s.key)
    let w = waiting.get(s.key)
    if (w === undefined) {
      const e = engine.addEntity()
      Transform.create(e, { position: Vector3.create(s.x, s.y + POT_COIN_LIFT, s.z), scale: Vector3.Zero() })
      GltfContainer.create(e, { src: COIN, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
      w = { e, x: s.x, y: s.y + POT_COIN_LIFT, z: s.z, rarity: s.rarity, landed: false, bornAt: 0, bumpAt: 0, phase: Math.random() * Math.PI * 2, flight: null }
      waiting.set(s.key, w)
    }
    w.x = s.x; w.y = s.y + POT_COIN_LIFT; w.z = s.z; w.rarity = s.rarity
  }
  for (const [key, w] of waiting) {
    if (seen.has(key)) continue
    engine.removeEntity(w.e)
    waiting.delete(key)
  }
}

/** How many coins wait over your pieces: one model each, billed by the level-of-detail budget. */
export function potCoinCount(): number { return waiting.size }

/** Where the rising coin of this slot must stop: the waiting coin's height. */
export function potCoinHeight(key: number): number | null {
  return waiting.get(key)?.y ?? null
}

/** A rising coin reached the waiting one: it appears, or it takes the knock. */
export function potCoinLanded(key: number): void {
  const w = waiting.get(key)
  if (w === undefined || w.flight !== null) return
  const now = Date.now()
  if (!w.landed) { w.landed = true; w.bornAt = now } else w.bumpAt = now
  const me = Transform.getOrNull(engine.PlayerEntity)
  if (me === null || tink === null || now - lastTink < TINK_EVERY_MS) return
  if (Math.hypot(me.position.x - w.x, me.position.z - w.z) > TINK_RANGE_M) return
  lastTink = now
  Transform.getMutable(tink).position = Vector3.create(w.x, w.y, w.z)
  replay(tink)
}

/** Every waiting coin takes off for the player, nearest first. */
function flyAll(now: number): void {
  const me = Transform.getOrNull(engine.PlayerEntity)
  if (me === null) return
  const list = [...waiting.values()].filter((w) => w.landed && w.flight === null)
  list.sort((a, b) => Math.hypot(a.x - me.position.x, a.z - me.position.z) - Math.hypot(b.x - me.position.x, b.z - me.position.z))
  list.forEach((w, rank) => {
    const far = Math.hypot(w.x - me.position.x, w.z - me.position.z) > FAR_M
    w.flight = { start: now + Math.min(STAGGER_MAX_MS, rank * STAGGER_MS), x: w.x, y: w.y, z: w.z, far }
    w.landed = false
  })
  if (list.length > 0) lastFlight = now
}

function spin(now: number, turnsPerS: number, phase: number): Quaternion {
  // Standing on its edge (90 on X) and turning about the WORLD vertical, like the rising coin.
  return Quaternion.multiply(
    Quaternion.fromEulerDegrees(0, ((now / 1000) * turnsPerS * 360 + (phase * 180) / Math.PI) % 360, 0),
    Quaternion.fromEulerDegrees(90, 0, 0)
  )
}

/** Overshoot then settle: the coin arrives a touch too big and comes back, as anything alive does. */
function easeOutBack(k: number): number {
  const c = 1.70158
  const u = k - 1
  return 1 + (c + 1) * u * u * u + c * u * u
}

export function setupPotCoins(): void {
  tink = engine.addEntity()
  Transform.create(tink, { position: Vector3.create(0, -50, 0) })
  AudioSource.create(tink, { audioClipUrl: 'assets/sounds/coin.wav', playing: false, loop: false, volume: volumeInitial(0.12, tink), pitch: 1.6 })

  // The server banked the pot (button, touch, or a purchase that collected first): the coins go.
  room.onMessage('collected', () => {
    collectedOnce = true
    const now = Date.now()
    if (now - lastFlight > 1000) flyAll(now)
  })

  engine.addSystem(() => {
    if (waiting.size === 0) return
    const now = Date.now()
    // No word from your base for two seconds (moved, folded, prestige): its coins go with it.
    if (now - lastSync > 2000) { syncPotSlots([]); return }
    const me = Transform.getOrNull(engine.PlayerEntity)
    const pot = pendingShown()
    const step = potStep()
    const earlyCoin = !collectedOnce && currentStep() === 'collect'
    let touched = false
    for (const [key, w] of waiting) {
      const t = Transform.getMutable(w.e)
      if (w.flight !== null) {
        const f = w.flight
        const age = now - f.start
        if (age < 0) {
          // Waiting its turn: still the coin at rest.
          t.position = Vector3.create(w.x, f.y, w.z)
          continue
        }
        const size = baseSize(w.rarity) * step
        if (f.far || me === null) {
          // A pop on the spot: a little swell, then gone.
          const k = Math.min(1, age / POP_MS)
          const s = size * (k < 0.4 ? 1 + 0.3 * (k / 0.4) : 1.3 * (1 - (k - 0.4) / 0.6))
          t.scale = Vector3.create(s, s * THICKNESS, s)
          if (k >= 1) { t.scale = Vector3.Zero(); w.flight = null }
          continue
        }
        if (age < HOP_MS) {
          // Anticipation: a hop and a stretch, so the eye is on the coin before it leaves.
          const k = age / HOP_MS
          t.position = Vector3.create(f.x, f.y + 0.18 * Math.sin((k * Math.PI) / 2), f.z)
          t.scale = Vector3.create(size * 0.9, size * THICKNESS, size * 1.2)
          t.rotation = spin(now, SPIN_TURNS_PER_S * 2, w.phase)
          continue
        }
        const k = Math.min(1, (age - HOP_MS) / FLY_MS)
        const e = k * k
        // An arc that ends in the player's chest, read every frame so it follows a moving player.
        const tx = me.position.x, ty = me.position.y + 1.1, tz = me.position.z
        const sx = f.x, sy = f.y + 0.18, sz = f.z
        const cx = (sx + tx) / 2, cy = Math.max(sy, ty) + 1.2, cz = (sz + tz) / 2
        const a = (1 - e) * (1 - e), b = 2 * (1 - e) * e, c = e * e
        t.position = Vector3.create(a * sx + b * cx + c * tx, a * sy + b * cy + c * ty, a * sz + b * cz + c * tz)
        const shrink = e < 0.6 ? 1 : 1 - 0.7 * ((e - 0.6) / 0.4)
        t.scale = Vector3.create(size * shrink, size * shrink * THICKNESS, size * shrink)
        t.rotation = spin(now, SPIN_TURNS_PER_S * 3, w.phase)
        if (k >= 1) { t.scale = Vector3.Zero(); t.position = Vector3.create(w.x, w.y, w.z); w.flight = null }
        continue
      }
      // The collect step: the coin lands now rather than with the first rising coin (header).
      if (earlyCoin && !w.landed) potCoinLanded(key)
      const shown = pot > 0 || earlyCoin
      if (!w.landed || !shown) {
        w.landed = w.landed && shown
        if (t.scale.x !== 0) t.scale = Vector3.Zero()
        continue
      }
      // At rest: appear with an overshoot, take the knock of each landing, bob and turn.
      let s = baseSize(w.rarity) * step
      const born = now - w.bornAt
      if (born < APPEAR_MS) s *= Math.max(0, easeOutBack(born / APPEAR_MS))
      let squash = 1
      const knock = now - w.bumpAt
      if (knock < BUMP_MS) squash = 1 - 0.25 * Math.sin((knock / BUMP_MS) * Math.PI)
      t.scale = Vector3.create(s * (2 - squash), s * THICKNESS, s * squash)
      t.position = Vector3.create(w.x, w.y + BOB_M * Math.sin(now / 200 + w.phase), w.z)
      t.rotation = spin(now, SPIN_TURNS_PER_S, w.phase)
      if (me !== null && Math.hypot(me.position.x - w.x, me.position.z - w.z) < TOUCH_RADIUS_M &&
          Math.abs(w.y - (me.position.y + 1.1)) < TOUCH_HEIGHT_M) touched = true
    }
    // Walking into a coin collects, like the button: the coins leave at once, the server banks.
    if (touched && pot > 0 && now - lastTouch > TOUCH_COOLDOWN_MS) {
      lastTouch = now
      flyAll(now)
      sendOrHold(() => { void room.send('collectTouch', {}) })
    }
  })
}
