import { timers } from '@dcl/sdk/ecs'
import { Storage } from '@dcl/sdk/server'
import { room } from '../shared/messages'
import { nomDuCode } from '../shared/loot-table'
import { addItem, addCrate, displayName, plotsPrets, hasProfile, marquerTousVus } from './plots'
import { log } from './log'

/**
 * The owner's hand in the game, through the game's own rules.
 *
 * Giving somebody a piece by editing the stored profile is not safe: this server keeps its
 * state in memory and writes it back at its own checkpoints, so an edit made underneath it is
 * overwritten or, worse, merged half way, and the base's record is a packed format that a hand
 * edit can corrupt. So the hand goes through the server instead. One scene storage key,
 * written by the wallet that owns the world (the storage CLI signs the write like a deploy),
 * read here every ten seconds, applied by the same functions the game uses for a delivery or
 * a reveal, then deleted and logged. `addItem` respects the free pedestals and the floors
 * bought, `addCrate` the crate ceiling; nothing here bypasses either.
 *
 *   key    admin:give
 *   value  { "to": "0x...", "items": [411, 103], "crates": [7] }
 *
 * `items` are piece codes (rarity times a hundred plus mutation, see loot-table.ts), applied
 * in the order given and stopping at the first that does not fit, so a wish list can be given
 * in order of preference. The order waits, unapplied, until the player's profile is loaded,
 * which is the case whenever they are in the venue.
 */
const KEY = 'admin:give'
const POLL_MS = 10_000

/** `index: "all"` marks every piece as seen in the player's Index, for a showcase profile. */
type Ordre = { to?: string; items?: number[]; crates?: number[]; index?: string }

export function startAdmin(): void {
  timers.setInterval(() => { void appliquer() }, POLL_MS)
}

async function appliquer(): Promise<void> {
  if (!plotsPrets()) return
  const brut: unknown = await Storage.get(KEY)
  if (brut === undefined || brut === null || brut === '') return
  // The storage hands back a string when the CLI wrote one, an object when the web UI did.
  let ordre: Ordre
  try {
    ordre = (typeof brut === 'string' ? JSON.parse(brut) : brut) as Ordre
  } catch {
    log(`admin:give is not JSON, dropped: ${String(brut).slice(0, 80)}`)
    await Storage.delete(KEY)
    return
  }
  if (typeof ordre !== 'object' || ordre === null) { log('admin:give is not an object, dropped'); await Storage.delete(KEY); return }
  const a = (ordre.to ?? '').toLowerCase()
  if (a === '') { log('admin:give has no recipient, dropped'); await Storage.delete(KEY); return }
  if (!hasProfile(a)) { log(`admin:give for ${a} waits: profile not loaded`); return }

  const poses: string[] = []
  const refuses: string[] = []
  for (const code of ordre.items ?? []) {
    if (!Number.isInteger(code) || code < 0) continue
    const r = addItem(a, code)
    if (r === 'plein') { refuses.push(nomDuCode(code)); continue }
    poses.push(nomDuCode(code))
  }
  const caisses: number[] = []
  for (const tier of ordre.crates ?? []) {
    if (!Number.isInteger(tier) || tier < 0) continue
    addCrate(a, tier)
    caisses.push(tier)
  }
  const vus = ordre.index === 'all' ? marquerTousVus(a) : 0
  await Storage.delete(KEY)
  log(`admin:give to ${displayName(a)}: placed [${poses.join(', ')}]${refuses.length ? `, no room for [${refuses.join(', ')}]` : ''}${caisses.length ? `, crates [${caisses.join(', ')}]` : ''}${vus > 0 ? `, index ${vus} seen` : ''}`)
  if (poses.length > 0 || caisses.length > 0 || vus > 0) {
    const parts = [...poses, ...caisses.map((t) => `crate ${t}`)]
    if (vus > 0) parts.push(`index ${vus}/${vus}`)
    void room.send('actionRejected', { action: 'gift', reason: `GIFT  ·  ${parts.join(', ')}`, antiCheat: false }, { to: [a] })
  }
}
