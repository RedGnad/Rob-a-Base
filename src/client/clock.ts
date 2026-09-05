/**
 * The server's clock, as seen from here.
 *
 * Every date the server writes into a synced component (a lock's end, a rush's end, a raid's
 * end) is a reading of the SERVER's clock, and every comparison the client makes against
 * `Date.now()` is a reading of this machine's. The two are not the same clock. The gap is
 * invisible on a countdown, and decisive on a boundary: the server writes "the shield is
 * down as of now" with its own now, and a client whose clock runs a few seconds behind reads
 * a date still in the future, draws the shield, and rings the seal for a lock nobody set
 * (owner, 5 Sep, twice: the seal on arrival, then a shield on a base with nobody around).
 *
 * The heartbeat carries the server's `Date.now()` every two seconds, so the gap can be
 * measured: each beat that changes gives one sample, server time minus local time at the
 * frame it was seen. A sample is only ever LATE (the network adds delay, never removes it),
 * so the largest sample over a recent window is the closest to the truth, and a window keeps
 * the estimate honest if a server is replaced by one with a different clock.
 */
const FENETRE = 12

const echantillons: number[] = []
let decalage = 0

/** Called once per heartbeat CHANGE with the server's stamp: nothing else should feed it. */
export function noteServerClock(serverAt: number): void {
  echantillons.push(serverAt - Date.now())
  if (echantillons.length > FENETRE) echantillons.shift()
  let m = -Infinity
  for (const s of echantillons) if (s > m) m = s
  decalage = m
}

/** What the server's clock reads now, to within a network delay. */
export function serverNow(): number {
  return Date.now() + decalage
}

/** The measured gap, for the log. */
export function serverClockOffset(): number {
  return decalage
}
