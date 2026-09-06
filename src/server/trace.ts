import { timers } from '@dcl/sdk/ecs'
import { Storage } from '@dcl/sdk/server'
import { room } from '../shared/messages'
import { log } from './log'

/**
 * TEMPORARY. Keeps the interface trace the clients send, so a session can be read AFTER it
 * happened instead of over somebody's shoulder.
 *
 * The counters used to be drawn in the menu header. That is not something to leave on screen
 * while the owner films with testers (6 Sep), and a playtest with several people cannot be
 * watched live anyway. So every client posts its lines here and they land in scene storage,
 * under one key, ready to read with the storage page or the CLI:
 *
 *     npx sdk-commands storage scene get debug:ui --dir /path/to/friendzone
 *
 * That command signs, and its signature expires sixty seconds after the linker opens. The
 * page at decentraland.org/storage, Scene tab, shows the same key with no timer, which is the
 * easier route after a session (see memo 519 on the expired-signature trap).
 *
 * One line per received press: see `src/client/clics.ts` for the columns. What answers the
 * owner's question is the pair (a press with `served=0` means the scene had it and dropped
 * it; NO line at the reported moment means the client never sent it at all).
 */

/** The trace is a ring: the last lines are the ones worth having, and storage is not a log server. */
const MAX_LIGNES = 600
/*
  And a ring PER PLAYER inside it. The first mobile session (6 Sep, 580 lines in twenty
  minutes) pushed the owner's whole desktop session out of the ring, leaving one line and a
  header, so the desktop question the trace was built for could not be read at all. No one
  player may hold more than this many of the lines.
*/
const MAX_PAR_JOUEUR = 200
/** Storage writes are capped per isolate, so the ring is persisted on a timer, never per message. */
const SAUVE_MS = 30_000
export const CLE_TRACE = 'debug:ui'

let anneau: string[] = []
let sale = false

export function startTrace(): void {
  room.onMessage('uiTrace', (d, ctx) => {
    const a = ctx?.from?.toLowerCase()
    if (!a || typeof d?.lines !== 'string' || d.lines.length === 0) return
    const qui = a.slice(0, 8)
    const tete = `${qui} ${d.phone === true ? 'phone' : 'desk'} ${d.build ?? '????'} R${d.recus ?? 0} S${d.servis ?? 0}`
    for (const ligne of d.lines.split('\n')) {
      if (ligne.length > 0) anneau.push(`${tete}|${ligne}`)
    }
    // This player's oldest lines go first, then the ring's oldest, whoever they belong to.
    const miennes = anneau.filter((l) => l.startsWith(qui + ' ')).length
    if (miennes > MAX_PAR_JOUEUR) {
      let aJeter = miennes - MAX_PAR_JOUEUR
      anneau = anneau.filter((l) => {
        if (aJeter > 0 && l.startsWith(qui + ' ')) { aJeter -= 1; return false }
        return true
      })
    }
    if (anneau.length > MAX_LIGNES) anneau = anneau.slice(-MAX_LIGNES)
    sale = true
  })

  timers.setInterval(() => {
    if (!sale) return
    sale = false
    const contenu = anneau.join('\n')
    void (async () => {
      // `Storage.set` resolves to false when a write is dropped rather than throwing, so a
      // trace that silently stopped saving would look exactly like a session with no presses.
      const ok = await Storage.set(CLE_TRACE, contenu)
      if (!ok) log(`trace: ecriture de ${CLE_TRACE} refusee (${contenu.length} octets)`)
    })()
  }, SAUVE_MS)

  void (async () => {
    const raw = await Storage.get<string>(CLE_TRACE)
    if (typeof raw === 'string' && raw.length > 0) {
      anneau = raw.split('\n').slice(-MAX_LIGNES)
      log(`trace: ${anneau.length} lignes reprises de ${CLE_TRACE}`)
    }
  })()
}
