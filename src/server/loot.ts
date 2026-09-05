
const POIDS = [60, 25, 10, 4, 1]
const TOTAL = POIDS.reduce((a, b) => a + b, 0)

export { PRODUCTION_PER_RARITY as INCOME_PER_RARITY } from '../shared/economy'


export function rollCrate(crateId: number): number {
  // Index by TIER, never by crate id: a themed crate keeps its tier's rarity odds, and
  // its id sits past the end of this table.
  const tier = crate(crateId).tier
  const poids = CRATE_WEIGHTS[Math.max(0, Math.min(tier, CRATE_WEIGHTS.length - 1))]
  const total = poids.reduce((a, b) => a + b, 0)
  let n = Math.random() * total
  for (let i = 0; i < poids.length; i++) {
    n -= poids[i]
    if (n <= 0) return i
  }
  return 0
}

/**
 * How often each crate shows up on the belt. Themed crates are rarer than their tier:
 * they are the reason to keep watching, and seeing one is meant to feel like an event.
 * Order matches CRATES: Basic, Good, Rare, Epic, Gold, Lava, Cursed.
 */
// The two top crates: one Legendary every ~200 spawns (a quarter hour), one Mythic every ~800 (an hour).
const POIDS_APPARITION = [50, 24, 10, 3, 8, 4, 1, 0.5, 0.12, 0.8, 0.6, 0.45, 0.3, 0.2, 0.12, 0.06]  // ... Galaxy to Phantom, rarer as the multiplier climbs

/**
 * Which crates are worth interrupting the screen for, read off the table above.
 *
 * The rule used to be `crateTier >= 2`, comparing a position in the CRATES array to the
 * number two. The array runs Basic, Good, Rare, Epic, Gold, Lava, Cursed, so that announced
 * five of the seven, which by these weights is Rare 10, Epic 3, Gold 8, Lava 4 and Cursed 1:
 * twenty-six percent, better than one crate in four, each with a banner across the screen.
 * An event that happens every fourth time is not an event, it is a background.
 *
 * Worse, it announced the Gold Crate, which sits fourth in the array but is a tier-one crate
 * priced at nine tenths of a plain Good Crate. The loudest signal in the game was pointing at
 * the cheapest thing on the belt.
 *
 * So the question is asked of the data instead: rare means rare.
 *
 * Four or less was the first answer, and by these weights it still announced eleven of every
 * hundred crates: Epic, Lava, Cursed and the seven themed ones together, one banner and one
 * bell every forty-five seconds at thirteen spawns a minute, and the Epic alone every two and
 * a half minutes (owner, 5 Sep: "c'est un evenement qui arrive trop souvent"). The sound
 * literature's rule for a repeated cue is that the more often it fires the less intrusive it
 * must be, and a bell across the screen cannot be made less intrusive: it can only be made
 * rare. Half a point or less leaves Legendary, Mythic and the five rarest themes: 1.7 percent,
 * one crate in sixty, a bell about every four and a half minutes. The Epic and the Lava still
 * glow on the belt for as long as they roll; they simply no longer interrupt.
 */
const ANNONCE_MAX_POIDS = 0.5

export function meriteAnnonce(crateId: number): boolean {
  const poids = POIDS_APPARITION[crateId]
  return poids !== undefined && poids <= ANNONCE_MAX_POIDS
}

export function rollCrateTier(): number {
  const total = POIDS_APPARITION.reduce((a, b) => a + b, 0)
  let n = Math.random() * total
  for (let i = 0; i < POIDS_APPARITION.length; i++) {
    n -= POIDS_APPARITION[i]
    if (n <= 0) return i
  }
  return 0
}

import { crate, MUTATIONS, CRATE_WEIGHTS } from '../shared/loot-table'
import { poidsDesMutations } from '../shared/schemas'

/**
 * A themed crate multiplies its own mutation's weight; every other weight is untouched,
 * so the tail stays reachable and a Lava Crate can still yield a Phantom.
 */
/** The mutation an event is pushing right now, or -1. Set by events.ts, read here. */
export let eventTheme = -1
export function setEventTheme(theme: number): void { eventTheme = theme }

/**
 * `luck` multiplies every mutation's weight but the plain one: 2 doubles the odds of any mutation.
 * `pousses` are mutation ids fed to the fuser: each adds `FUSION_PUSH` to that mutation's weight.
 */
export function rollMutation(crateId = 0, luck = 1, pousses: number[] = []): number {
  // The crate's own theme and the venue's event both push; a Lava crate during Lava Hour
  // stacks, which is the moment the belt is worth crossing the room for. One function for
  // the weights, shared with the fuser's panel, so what is printed is what is rolled.
  const poids = poidsDesMutations(crateId, eventTheme, luck, pousses)
  const total = poids.reduce((a, b) => a + b, 0)
  let n = Math.random() * total
  for (let i = 0; i < MUTATIONS.length; i++) {
    n -= poids[i]
    if (n <= 0) return MUTATIONS[i].id
  }
  return 0
}
