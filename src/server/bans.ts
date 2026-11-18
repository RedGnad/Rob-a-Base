/*
  A base closed to ONE player, not to everybody (founder, 18 Nov 2026).

  The shield used to close the whole base after any theft, so a raid by several players stopped
  at the first piece. Now the player who just robbed a base, or the intruder its trap just
  caught, is the one kept out of it, for as long as the shield rule gives (`shieldFor`: a minute
  when the owner is there, up to eight hours when they have been away for long). Everybody else
  may still try. What keeps an absent owner from being emptied is the cap on losses per absence
  (`recordAwayLoss` in plots.ts), not this.

  A module that imports nothing from the server, so theft.ts and gear.ts can both use it without a cycle. Kept in
  memory: a server restart forgets who was kept out, and the cap per absence, which is stored
  with the base, still holds.
*/
const bans = new Map<string, number>()

export function banFromBase(player: string, owner: string, until: number): void {
  const key = `${player}|${owner}`
  bans.set(key, Math.max(bans.get(key) ?? 0, until))
}

/** When this base opens again to this player, or 0 when it is open now. */
export function bannedUntil(player: string, owner: string): number {
  const key = `${player}|${owner}`
  const until = bans.get(key) ?? 0
  if (until <= Date.now()) { bans.delete(key); return 0 }
  return until
}

/** Every base closed to this player right now, with the time left: what their client draws (theft.ts). */
export function bansOf(player: string): Array<{ owner: string; leftMs: number }> {
  const now = Date.now()
  const out: Array<{ owner: string; leftMs: number }> = []
  for (const [key, until] of bans) {
    const [p, owner] = key.split('|')
    if (p === player && until > now) out.push({ owner, leftMs: until - now })
  }
  return out
}

export { shortDuration } from '../shared/duration'
