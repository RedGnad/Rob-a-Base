import { engine, Transform, AudioSource, Entity } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

/*
  Damage flash: a brief red pulse over the world when the player is hit.

  Convention, not invention. A coloured full-screen flash on damage dates back to DOOM and is
  still the baseline signal for "you were hurt"; Battlefield later turned the same idea into a
  progressive vignette. The reference guidance is explicit on two points: the flash is BRIEF,
  and the player must always clearly see they took a hit. It peaks immediately and clears in
  under half a second: the first pass at 0.32 over 280 ms was measured in game as present but
  not memorable (owner, 3 Sep), so it was raised on both axes while staying short enough that
  it never hides the game.

  Why this exists at all: until now the scene had no damage channel except a line of text. The
  literature treats juice as a stack (flash, shake, floating text, sound, particles), and a
  sentence carrying an event, a quantity and an attribution at once is the slowest way to say
  any of them.

  Free on the object budget: one UI layer, no mesh, no material, no texture, no collider.
*/

const PEAK = 0.45
const DURATION_MS = 420

let hitAt = -1

/** Call the moment the player takes a hit. */
export function flashDamage(): void {
  hitAt = Date.now()
}


/**
 * Current alpha of the red veil, 0 when there is nothing to draw.
 *
 * Squared falloff rather than linear: the hit should LAND and then release, not fade evenly.
 */
export function damageFlashAlpha(): number {
  if (hitAt < 0) return 0
  const age = Date.now() - hitAt
  if (age < 0 || age > DURATION_MS) return 0
  const left = 1 - age / DURATION_MS
  return PEAK * left * left
}

/*
  Floating numbers: the quantity channel.

  A screen flash says "you were hit"; it cannot say "you lost 1.2K". The reference guidance
  splits those deliberately, and treats floating numbers as the way to turn an invisible
  calculation into feedback the player feels: for the one taking the loss, red, larger than
  normal, rising, gone in a second or two. That is precisely the half a sentence in a toast
  reads slowest.

  Kept as UI, not 3D text: no mesh, no material, nothing on the object budget.
*/
const FLOAT_MS = 1300
const FLOAT_MAX = 4

type FloatingAmount = { amount: number; loss: boolean; born: number }
const floating: FloatingAmount[] = []

/** Show a gained or lost amount rising over the middle of the screen. */
export function floatAmount(amount: number, loss: boolean): void {
  if (amount <= 0) return
  floating.push({ amount, loss, born: Date.now() })
  if (floating.length > FLOAT_MAX) floating.shift()
}

/**
 * The amounts still on screen, each with its progress from 0 to 1.
 *
 * Expiry happens here rather than on a system: the interface reads this once a frame anyway,
 * and a list nobody is drawing does not need a clock of its own.
 */
export function liveAmounts(): Array<{ amount: number; loss: boolean; t: number; rank: number; born: number }> {
  const now = Date.now()
  while (floating.length > 0 && now - floating[0].born > FLOAT_MS) floating.shift()
  return floating.map((f, i) => ({ amount: f.amount, loss: f.loss, t: (now - f.born) / FLOAT_MS, rank: i, born: f.born }))
}


/*
  The sound channel, shared.

  Juice is a stack, and the references list sound alongside flash and floating text rather
  than after them. Taking a hit and cashing in were both silent: the only impact sound in the
  game plays when YOU fire, never when you are hit. These reuse the clips already shipped, so
  nothing is added to the download.

  Emitters hang off the player, created once at setup: an AudioSource needs an entity, and one
  per cue is cheaper than one per event. The cash cue is a purpose-built coin arpeggio rather
  than the crate-smash clip it first borrowed: a payout and a burst are different events, and
  reusing one for the other is heard immediately (owner, 3 Sep).
*/
let hurtCue: Entity | null = null
let cashCue: Entity | null = null

export function setupJuiceSound(): void {
  const emitter = (clip: string, volume: number): Entity => {
    const e = engine.addEntity()
    Transform.create(e, { parent: engine.PlayerEntity, position: Vector3.create(0, 1, 0) })
    AudioSource.create(e, { audioClipUrl: clip, playing: false, loop: false, volume })
    return e
  }
  hurtCue = emitter('assets/sounds/hit.wav', 0.9)
  cashCue = emitter('assets/sounds/coin.wav', 0.6)
}

function play(e: Entity | null): void {
  if (e === null) return
  const a = AudioSource.getMutableOrNull(e)
  if (a !== null) { a.playing = false; a.playing = true }
}

/** Something took money or goods off you. */
export function playHurt(): void { play(hurtCue) }
/** Money landed in your pocket. */
export function playCash(): void { play(cashCue) }
