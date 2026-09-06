import { CRATE_PRICE, PRODUCTION_PER_RARITY, RESELL_SECONDS } from './economy'
/*
  Sizes measured against the distance a judge looks from, not chosen to look nice up close.

  A tester's screenshot from the plaza edge, twelve metres from the nearest base and thirty
  from the rest: every item was a dot. At a 60 degree field of view on a 1186 px screen, a
  0.38 m Common is 33 px at 12 m and 13 px at 30 m; even a 0.90 m Secret is 31 px at 30 m.
  The whole genre rests on what you have accumulated being SEEN by the others in the room,
  and it was not visible from where they stand. Pedestals are 3.06 m apart on a floor 4 m
  high, so an item can be 2.4 m wide before neighbours touch: there was room for six times
  the size. Two and a half times puts a Common at 1 m (85 px at 12 m, 34 at 30) and a Secret
  at 2.2 m (75 px at 30 m), which is the size a mobile HUD guideline calls a readable target.
  `glow` rises with it so the top of the ladder reads as lit, not just large.
*/
export const RARITIES = [
  // Common steps DOWN to a deeper slate, which is what lets Secret be white.
  { id: 0, name: 'Common',    color: '#78818e', size: 1.00, glow: 0.00, tours: 0 },
  { id: 1, name: 'Uncommon',  color: '#4ec04e', size: 1.15, glow: 0.35, tours: 0 },
  { id: 2, name: 'Rare',      color: '#3d8ef0', size: 1.30, glow: 0.80, tours: 20 },
  { id: 3, name: 'Epic',      color: '#a855f7', size: 1.50, glow: 1.30, tours: 35 },
  { id: 4, name: 'Legendary', color: '#f5a524', size: 1.70, glow: 2.00, tours: 55 },
  { id: 5, name: 'Mythic',    color: '#ff4d6d', size: 1.95, glow: 2.80, tours: 80 },
  /*
    White, at full luminance, because that is what a Secret IS in the world.

    It shipped at #e8e8f0 against Common's #9aa3ad: two pale greys at the ends of one
    ladder, indistinguishable on a card. Turquoise separated them but broke the thing the
    owner recognised in the object itself (1 Sep). The separation is made where it should
    have been made from the start, at the OTHER end: Common drops to a deeper slate, so the
    two ends now sit at half and full luminance, and Secret keeps the blazing white its
    glow of 4 and its own light were always painting.
  */
  { id: 6, name: 'Secret',    color: '#ffffff', size: 2.20, glow: 4.00, tours: 120 }
] as const

export function rarity(id: number) {
  return RARITIES[id] ?? RARITIES[0]
}

/*
  The palette was audited as a whole, not colour by colour (1 Sep).

  Phantom is the rarest thing the game can roll, one part in a thousand and a multiplier of
  twelve, and it was painted plain grey: the best mutation looked like the dullest (owner).
  Measuring the set found that was not one mistake but a cluster: Yin Yang, Divine, Diamond,
  Phantom and the Common and Secret rarities were seven pairs of near-identical pale
  neutrals, and the interface brightens dark colours for legibility, which pushed them
  closer still. Distances were computed in Lab, on the values AS DISPLAYED, and the trio
  below is the set that maximises the smallest gap in the whole palette: the closest pair
  went from 12.2 to 20.8. Phantom takes a spectral mint nothing else uses, Divine a warm
  gold-cream, Yin Yang a neutral placed between Common and Secret rather than on top of them.
*/
/*
  The tail was one in a thousand and had no crate and no rush: seven mutations a player never
  met in a session (owner, 5 Sep, on the palette base: "je n'ai JAMAIS vu rainbow, ying yang,
  cyber, divine, phantom, galaxy"). Lifted to one in a few hundred, each with its rush day; the
  crate prices follow the expected multiplier (1.49 -> 1.63), so the ladder keeps its shape.
*/
export const MUTATIONS = [
  { id: 0,  name: '',            mult: 1,    color: '',        poids: 1000 },
  { id: 1,  name: 'Gold',        mult: 1.25, color: '#ffd700', poids: 220 },
  { id: 2,  name: 'Diamond',     mult: 1.5,  color: '#b9f2ff', poids: 120 },
  { id: 3,  name: 'Blood',       mult: 2,    color: '#6e0b14', poids: 70 },
  { id: 4,  name: 'Candy',       mult: 4,    color: '#ff9ecd', poids: 34 },
  { id: 5,  name: 'Lava',        mult: 6,    color: '#ff5722', poids: 20 },
  { id: 6,  name: 'Galaxy',      mult: 7,    color: '#5b2c8d', poids: 22 },
  { id: 7,  name: 'Yin Yang',    mult: 7.5,  color: '#b6b6be', poids: 17 },
  { id: 8,  name: 'Radioactive', mult: 8.5,  color: '#7fff00', poids: 13 },
  { id: 9,  name: 'Cursed',      mult: 9,    color: '#3b0a45', poids: 10 },
  { id: 10, name: 'Divine',      mult: 10,   color: '#ffe9a8', poids: 7 },
  { id: 11, name: 'Rainbow',     mult: 10,   color: '#ff00ff', poids: 5 },
  { id: 12, name: 'Cyber',       mult: 11,   color: '#00e5ff', poids: 3.5 },
  { id: 13, name: 'Phantom',     mult: 12,   color: '#86ffd0', poids: 2 }
] as const

export function mutation(id: number) {
  return MUTATIONS[Math.max(0, Math.min(id, MUTATIONS.length - 1))]
}

export function itemName(rarityId: number, mut: number): string {
  const m = mutation(mut)
  return m.name === '' ? rarity(rarityId).name : `${m.name} ${rarity(rarityId).name}`
}

/**
 * Two families of crate, and they bet on different things.
 *
 * TIER crates shift the RARITY roll: Basic through Epic.
 * THEMED crates keep their tier's rarity odds but load the MUTATION roll instead. A Lava
 * Crate is no likelier to yield a Legendary; it is far likelier to yield a Lava, which
 * multiplies income by 6.
 *
 * `theme` is a mutation id, or -1 for none. `weight` is how hard that mutation's odds are
 * pushed. Prices are DERIVED from the resulting expected multiplier against a plain roll
 * (x1.492), not chosen:
 *
 *   Gold   x12  -> 67% Gold, expectation x1.34  = 0.90x  -> cheaper than its tier
 *   Lava   x60  -> 45% Lava, expectation x3.47  = 2.32x
 *   Cursed x180 -> 42% Cursed, expectation x4.61 = 3.09x
 *
 * Gold LOWERS the expectation, because a x1.25 mutation crowds out the rare ones. That is
 * the point: it is the reliable, cheap product, not a weaker version of the others.
 *
 * Every container is a Crate. The genre does not agree on one word, and games in it ship
 * cases, crates and boxes alike, but none of them uses two words for the same object. The
 * tier names reusing rarity words is deliberate and is what the genre does: a Rare Crate
 * lands on Rare 55% of the time, so the name is a fair description of the odds.
 */
export const CRATES = [
  { id: 0, name: 'Basic Box',  tier: 0, theme: -1, weight: 0,   price: CRATE_PRICE[0],                     color: '#9aa3ad', size: 0.83 },
  { id: 1, name: 'Good Box',   tier: 1, theme: -1, weight: 0,   price: CRATE_PRICE[1],                     color: '#4ec04e', size: 0.93 },
  { id: 2, name: 'Rare Box',   tier: 2, theme: -1, weight: 0,   price: CRATE_PRICE[2],                     color: '#3d8ef0', size: 1.05 },
  { id: 3, name: 'Epic Box',   tier: 3, theme: -1, weight: 0,   price: CRATE_PRICE[3],                     color: '#a855f7', size: 1.20 },
  /*
    A themed crate's price is its tier's price times the ratio of the expected mutation
    multiplier under its push to the plain roll's (1.63 with today's weights): the price
    follows the odds. The push of every crate added on 5 Sep is set so it lands its own
    mutation as often as the Cursed does, 54 % of openings (1800 / the mutation's weight);
    the three older pushes stay, their factors recomputed on the 5 Sep weights.
  */
  { id: 4, name: 'Gold Box',   tier: 1, theme: 1,  weight: 12,  price: Math.round(CRATE_PRICE[1] * 0.86),  color: '#ffd700', size: 0.99 },
  { id: 5, name: 'Lava Box',   tier: 2, theme: 5,  weight: 60,  price: Math.round(CRATE_PRICE[2] * 2.16),  color: '#ff5722', size: 1.11, image: 'crate-5.png' },
  { id: 6, name: 'Cursed Box', tier: 3, theme: 9,  weight: 180, price: Math.round(CRATE_PRICE[3] * 3.43),  color: '#3b0a45', size: 1.29, image: 'crate-6.png' },
  // The two rungs above Epic: what a rich player crosses the plaza for. Rare on the belt, announced.
  { id: 7, name: 'Legendary Box', tier: 4, theme: -1, weight: 0, price: CRATE_PRICE[4],                 color: '#f5a524', size: 1.34 },
  { id: 8, name: 'Mythic Box',    tier: 5, theme: -1, weight: 0, price: CRATE_PRICE[5],                 color: '#ff4d6d', size: 1.40 },
  /*
    One themed crate per mutation, so the belt SHOWS the whole ladder: what a player never sees
    does not exist for them (Zendle and Cairns 2018 on loot boxes, the near-miss literature,
    the coloured rarity ladders of the genre). Epic tier and the Cursed's push, prices scaled
    by the mutation's multiplier, rarer on the belt the higher the multiplier (owner, 5 Sep).
  */
  { id: 9,  name: 'Galaxy Box',       tier: 3, theme: 6,  weight: 82, price: Math.round(CRATE_PRICE[3] * 2.77), color: '#5b2c8d', size: 1.27, image: 'crate-9.png' },
  { id: 10, name: 'Yin Yang Box',     tier: 3, theme: 7,  weight: 106, price: Math.round(CRATE_PRICE[3] * 2.93), color: '#b6b6be', size: 1.28, image: 'crate-10.png' },
  { id: 11, name: 'Radioactive Box',  tier: 3, theme: 8,  weight: 138, price: Math.round(CRATE_PRICE[3] * 3.26), color: '#7fff00', size: 1.29, image: 'crate-11.png' },
  { id: 12, name: 'Divine Box',       tier: 3, theme: 10, weight: 257, price: Math.round(CRATE_PRICE[3] * 3.76), color: '#ffe9a8', size: 1.30, image: 'crate-12.png' },
  { id: 13, name: 'Rainbow Box',      tier: 3, theme: 11, weight: 360, price: Math.round(CRATE_PRICE[3] * 3.76), color: '#ff00ff', size: 1.31, image: 'crate-13.png' },
  { id: 14, name: 'Cyber Box',        tier: 3, theme: 12, weight: 514, price: Math.round(CRATE_PRICE[3] * 4.09), color: '#00e5ff', size: 1.32, image: 'crate-14.png' },
  { id: 15, name: 'Phantom Box',      tier: 3, theme: 13, weight: 900, price: Math.round(CRATE_PRICE[3] * 4.42), color: '#86ffd0', size: 1.33, image: 'crate-15.png' }
] as const
/*
  `size` is the crate's edge in metres, and it grew by half on 27 Aug: a 0.55 m cube on the
  belt was thirty-nine pixels from the plaza edge, the same size problem the items had, and
  the belt is the one place every player looks at. 1.29 m still clears the 2.6 m belt and the
  pit, and the crate stands on the belt rather than floating in it.
*/

export function itemColor(rarityId: number, mut: number): string {
  const m = mutation(mut)
  return m.color === '' ? rarity(rarityId).color : m.color
}

export function crate(id: number) {
  return CRATES[Math.max(0, Math.min(id, CRATES.length - 1))]
}

/*
  One integer per item: TRAITS x 1000 + RARITY x 100 + MUTATION.

  The reference's rule for what an event leaves on an item, read from its wiki: a mutation is
  one and multiplies, traits are many and ADD, each worth five times the base value, so
  `(value x mutation) + trait + trait`; "a Default with two traits = 11x". Ours count them in
  the thousands digit, up to `TRAITS_MAX`, and every reader below goes through these helpers:
  nothing else in the game does arithmetic on a code.
*/
export const TRAIT_BONUS = 5
export const TRAITS_MAX = 3
export function encoder(rarity: number, mut: number, traits = 0): number {
  return traits * 1000 + rarity * 100 + mut
}
export function rarityOf(code: number): number { return Math.floor(code / 100) % 10 }
export function mutationDe(code: number): number { return code % 100 }
export function traitsDe(code: number): number { return code < 0 ? 0 : Math.floor(code / 1000) }

/**
 * How tall a piece stands on its pedestal: its rarity, its mutation and its traits.
 *
 * Written here rather than in each of the three files that needed it, because a piece has ONE
 * size and three copies of a formula drift. A Secret is more than twice a Common, which is the
 * whole point of a showcase: what somebody owns is legible from the street.
 */
export function tailleAffichee(code: number): number {
  const r = RARITIES[rarityOf(code)]
  const mult = mutationDe(code) > 0 ? 1.12 : 1
  return (r?.size ?? 1) * mult * (1 + 0.05 * traitsDe(code))
}

/**
 * And how tall it lies on the ground, waiting to be picked up.
 *
 * It was a flat 0.5 m for everything. Measured against the pedestal sizes: that is half a
 * Common and less than a QUARTER of a Secret, so the rarest piece in the game was the most
 * invisible thing on the floor, and nothing about a dropped piece said which one it was
 * (owner, 7 Sep: "elle est minuscule"). Smaller than a shelf is the right signal, it reads as
 * "loose, come and take it"; a fixed number is not how you say it. Three quarters keeps an
 * Uncommon at 0.86 and puts a Secret at 1.65, both plainly below their own pedestal.
 */
export function tailleAuSol(code: number): number { return tailleAffichee(code) * 0.75 }

/**
 * How far the piece's own model hangs below the entity that carries it, at a given size.
 *
 * A mounted model is placed at -0.49 in the stand-in's local space, which is where its BASE
 * sits (see `FIT` in client/toy.ts). The server drops loot at a flat y of 0.5 and the client
 * drew it there, so a half-metre piece floated a quarter of a metre off the grass: detached
 * from the ground, which is most of what made it read as a token rather than as a piece
 * somebody dropped (owner, 7 Sep). Adding this to the drop's floor puts it back on the floor
 * at any size, and it has to be a function of the size now that the size varies.
 */
export function assiseAuSol(code: number): number { return tailleAuSol(code) * 0.49 }
/**
 * The average mutation multiplier a roll with these weights will produce.
 *
 * The fusion price needs the value of the piece it is about to hand over, and that value is
 * decided by a roll. Reading the same weights the roll uses means the price follows the odds
 * rather than assuming the plain case, which matters most when the inputs push the odds up.
 */
export function expectedMutationMult(weights: readonly number[]): number {
  let total = 0
  let sum = 0
  for (let i = 0; i < weights.length && i < MUTATIONS.length; i++) {
    total += weights[i]
    sum += weights[i] * MUTATIONS[i].mult
  }
  return total > 0 ? sum / total : 1
}

/**
 * How rare a piece REALLY is: one in how many rolls, from the two tables that roll it.
 *
 * "Rarest" was read as "highest mutation multiplier", and that is not what rare means: the
 * panel offered to spare a Divine Epic while a Cursed Secret stood on the same shelves, which
 * is backwards by a factor of three (owner, 5 Sep). A piece is TWO independent draws, the
 * rung and the mutation, so its rarity is the product of the two probabilities and nothing
 * else. Both are read from the tables above rather than typed, so a rebalance moves this with
 * it: the rung's marginal probability is the mean of the six crate rows, each normalised,
 * which is what the rung is worth when every crate is bought by somebody; the mutation's is
 * its weight over the sum. A Cursed Secret comes out at one in 3,395 against one in 1,317 for
 * a Divine Epic, and a Phantom Common, which no multiplier would ever have protected, at one
 * in 5,020.
 */
export function itemOdds(code: number): number {
  let pr = 0
  for (const row of CRATE_WEIGHTS) {
    const total = row.reduce((a, b) => a + b, 0)
    pr += (row[Math.min(rarityOf(code), row.length - 1)] ?? 0) / total / CRATE_WEIGHTS.length
  }
  const totalMut = MUTATIONS.reduce((a, m) => a + m.poids, 0)
  const pm = (MUTATIONS[mutationDe(code)]?.poids ?? 0) / totalMut
  const p = pr * pm
  return p > 0 ? 1 / p : 0
}

export function itemIncome(code: number, incomeTable: readonly number[]): number {
  const base = incomeTable[rarityOf(code)] ?? 1
  return base * mutation(mutationDe(code)).mult + base * TRAIT_BONUS * traitsDe(code)
}
/** The item's full name from its code, traits included: "Lava Rare +2". */
export function nomDuCode(code: number): string {
  const n = traitsDe(code)
  const nom = itemName(rarityOf(code), mutationDe(code))
  return n > 0 ? `${nom} +${n}` : nom
}

/** What selling an item pays. The server credits exactly this; the shop shows exactly this. */
export function prixDeRevente(code: number): number {
  return Math.round(itemIncome(code, PRODUCTION_PER_RARITY) * RESELL_SECONDS)
}

/**
 * Every crate can reach EVERY rarity, top included.
 *
 * The previous table capped each crate two tiers above its own, which left rarity 6
 * unreachable from any crate: a seventh of the index was dead content, and a beginner
 * never even learned the top tiers existed.
 *
 * The reference runs ONE shared table for the whole server (wiki `Red Carpet`, weights
 * "extracted from the game files"): everyone sees Legendary and Secret go by, they simply
 * cannot afford them. Aggregated over its 80 items: Common 44.9%, Rare 24.6%, Epic 10.8%,
 * Legendary 0.99%, and the top tier at 0.011%. So the tail is thin but NEVER zero.
 *
 * Here a crate tier shifts the distribution instead of truncating it. Each row still peaks
 * on its own tier, and the tail keeps a one-in-ten-thousand chance at the top.
 */
/** The image a crate's material reads: its own when it wears a tile, the shared atlas otherwise. */
export function crateImage(id: number): string {
  const c = CRATES[id] as { image?: string } | undefined
  return c?.image ?? 'crate-atlas.png'
}

export const CRATE_WEIGHTS = [
  [55, 22,   6,   1.2,  0.20, 0.030, 0.004],  // Basic, peaks on Common
  [22, 55,  22,   6,    1.20, 0.200, 0.030],  // Good,  peaks on Uncommon
  [ 6, 22,  55,  22,    6.00, 1.200, 0.200],  // Rare,  peaks on Rare
  [ 1,  6,  22,  55,   22.00, 6.000, 1.200],  // Epic,  peaks on Epic
  [ 0.2, 1.2, 6,  22,   55.00, 22.00, 6.000],  // Legendary, peaks on Legendary
  [ 0.03, 0.2, 1.2, 6,  22.00, 55.00, 22.00],  // Mythic, peaks on Mythic
]

/**
 * What a crate is worth, said in the unit the player already reads everywhere: income per second.
 *
 * A crate on the belt showed its name and its price and nothing else, so the one question a
 * buyer has, "is this better than the other one", had no answer on screen. Gold against Good
 * is the case that made this necessary: nearly the same price, and a player cannot tell from
 * two names that one trades ceiling for reliability. Computed from the tables rather than
 * typed, because a typed figure is a lie waiting for the next rebalance. Same arithmetic as
 * `rollCrate` and `rollMutation`, folded into an expectation.
 */
export function rendementAttendu(crateId: number): number {
  const c = crate(crateId)
  const poids = CRATE_WEIGHTS[Math.max(0, Math.min(c.tier, CRATE_WEIGHTS.length - 1))]
  const totalR = poids.reduce((a, b) => a + b, 0)
  let rarete = 0
  for (let i = 0; i < poids.length; i++) rarete += (poids[i] / totalR) * PRODUCTION_PER_RARITY[i]
  const pm = MUTATIONS.map((m) => (c.theme === m.id ? m.poids * c.weight : m.poids))
  const totalM = pm.reduce((a, b) => a + b, 0)
  let mult = 0
  for (let i = 0; i < pm.length; i++) mult += (pm[i] / totalM) * MUTATIONS[i].mult
  return rarete * mult
}

/** How often a themed crate lands its theme, or 0 for a plain one. Shown next to the yield. */
export function chanceDuTheme(crateId: number): number {
  const c = crate(crateId)
  if (c.theme < 0) return 0
  const pm = MUTATIONS.map((m) => (c.theme === m.id ? m.poids * c.weight : m.poids))
  const totalM = pm.reduce((a, b) => a + b, 0)
  return pm[MUTATIONS.findIndex((m) => m.id === c.theme)] / totalM
}

/** The one line a crate carries wherever it is shown: yield, and the theme odds if it has one. */
export function crateSummary(crateId: number): string {
  const c = crate(crateId)
  const base = `~${formatIncome(rendementAttendu(crateId))}/s`
  return c.theme < 0 ? base : `${base}  ${Math.round(chanceDuTheme(crateId) * 100)}% ${mutation(c.theme).name}`
}

export function formatIncome(v: number): string {
  if (v < 10) return v.toFixed(2).replace(/\.?0+$/, '')
  if (v < 1000) return Math.round(v).toString()
  if (v < 1e6) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  if (v < 1e9) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (v < 1e12) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'
  return (v / 1e12).toFixed(1).replace(/\.0$/, '') + 'T'
}

/*
  Collection pays in skins. The reference: "obtaining at least 75% of all obtainable Brainrots
  of a single Mutation will unlock a unique variant, or skin, for your base", picked in the
  settings, with the Index showing the progress. Ours counts a mutation's RARITIES, seven, so
  six of them, and the Index carries the buttons.
*/
export const SKIN_NEEDS = Math.ceil(RARITIES.length * 0.75)
export function progresDuSkin(vus: readonly number[], mut: number): number {
  let n = 0
  for (const r of RARITIES) if (vus.includes(encoder(r.id, mut))) n += 1
  return n
}
export function skinDebloque(vus: readonly number[], mut: number): boolean {
  return mut > 0 && mut < MUTATIONS.length && progresDuSkin(vus, mut) >= SKIN_NEEDS
}
