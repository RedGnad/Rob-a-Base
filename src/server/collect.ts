import { room } from '../shared/messages'
import { log } from './log'
import { collectPending, coinsOf, pendingOf, displayName } from './plots'
import { stepDone } from './onboarding'

/*
  Banking the pot, in one place, whatever asked for it.

  Three things follow every collect and none may be forgotten by a caller: the player hears
  and sees the amount (`collected`, the coin and the floating number), the tutorial's collect
  step completes, and the server log records the amount (design page 1, points 3 and 6).
  `why` says what caused it, for the log only.
*/
export function bankPot(address: string, why: string): number {
  const gain = collectPending(address)
  if (gain <= 0) return 0
  void room.send('collected', { gain }, { to: [address] })
  log(`${displayName(address)} collected ${gain} (${why})`)
  stepDone(address, 'collect')
  return gain
}

/*
  A purchase the balance cannot pay for, but balance and pot together can, collects first.

  Production goes to the pot and a purchase spends the balance only, so a new player at the
  belt was told "you need N more coins" while the pot held them, and COLLECT, the last verb
  of the button, is never offered at the belt (playtest of 17 Nov 2026). The press now banks
  the pot and buys in one go: the dead end disappears and COLLECT keeps its role elsewhere
  (design page 1, point 4; Nielsen's heuristic 5, error prevention).

  Answers whether the balance now covers the price. Nothing is collected when even the pot
  would not be enough: the purchase is refused as before and the pot stays where it is.
*/
export function bankToCover(address: string, price: number, why: string): boolean {
  if (coinsOf(address) >= price) return true
  if (coinsOf(address) + pendingOf(address) < price) return false
  bankPot(address, why)
  return coinsOf(address) >= price
}

/** What a refused purchase still lacks, counting the pot: the number the refusal says. */
export function shortOf(address: string, price: number): number {
  return Math.max(1, price - coinsOf(address) - pendingOf(address))
}
