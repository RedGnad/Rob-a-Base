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
