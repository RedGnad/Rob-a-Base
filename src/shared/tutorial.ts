/*
  The tutorial's steps, in order, shared by the server and the client.

  The server stores a player's progress as an index into this list and the client draws the
  step at that index, so the two lists were two copies that had to agree by hand: they did
  not (the server's third step was named "Collect your coins" while the client's was "Shelve
  your piece"). One list here, and both sides name a step by its id, never by its number.

  The collect step sits between shelve and buy (design page 1, approved 17 Nov 2026): the
  first loop is place, open, shelve, collect, buy, steal.
*/
export const TUTORIAL_STEPS = ['place', 'open', 'shelve', 'collect', 'buy', 'steal'] as const
export type TutorialStep = typeof TUTORIAL_STEPS[number]

export function stepIndex(step: TutorialStep): number {
  return TUTORIAL_STEPS.indexOf(step)
}

/** The step at this index, or null once the tutorial is finished. */
export function stepAt(index: number): TutorialStep | null {
  return TUTORIAL_STEPS[index] ?? null
}

/*
  Stored progress is tagged with the version of this list it was counted against. Version 1
  had five steps, without collect: a stored index of 3 or more meant buy, steal or done, and
  moves up by one under version 2.
*/
export const TUTORIAL_VERSION = 2

/*
  The first box off the belt costs 800 (founder, 20 Nov 2026).

  Until the Buy step is done, a Basic Box is 800 for that player and its list price (2,018) for
  everyone else. With the worst first roll a new account can get, an Uncommon at 7 a second, the
  first purchase comes after about two minutes instead of nearly five. The price is the player's
  own: their client writes it on the crates of the belt, the server charges it.

  ONE box: the first purchase uses it up, whatever step the player is on, and every box after
  it is at its list price (founder, the same day). `firstBox` is the account's flag, kept on
  the server and sent with the tutorial step. An outbid is still computed on the list price
  (server/convoy.ts), or a newcomer's first box would be the cheapest thing on the street to
  take from them.
*/
export const FIRST_BOX_PRICE = 800
/** The Basic Box, by its id in the crate table. */
export const FIRST_BOX_CRATE = 0
export function beltPriceFor(crateId: number, listPrice: number, tutorialStep: number, firstBox: boolean): number {
  if (!firstBox || crateId !== FIRST_BOX_CRATE || tutorialStep > stepIndex('buy')) return listPrice
  return Math.min(listPrice, FIRST_BOX_PRICE)
}
