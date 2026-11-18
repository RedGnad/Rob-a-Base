/*
  A base closed to ONE player, not to everybody (founder, 18 Nov 2026).

  The shield used to close the whole base after any theft, so a raid by several players stopped
  at the first piece. Now the player who just robbed a base, or the intruder its trap just
  caught, is the one kept out of it, for as long as the shield rule gives (`shieldFor`: a minute
  when the owner is there, up to eight hours when they have been away for long). Everybody else
  may still try. What keeps an absent owner from being emptied is the cap on losses per absence
  (`recordAwayLoss` in plots.ts), not this.

  A module with no imports, so theft.ts and gear.ts can both use it without a cycle. Kept in
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

/** "45s", "12m", "7h 59m": a duration as short as a refusal line wants it. */
export function shortDuration(ms: number): string {
  const s = Math.max(1, Math.ceil(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.ceil(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
