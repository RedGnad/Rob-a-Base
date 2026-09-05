import { engine, timers } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'
import { ServerBeat, SYNC_ID, BEAT_MS } from '../shared/schemas'
import { room } from '../shared/messages'
import { startPlots, plotsPrets, welcome, auRevoir, cashOfflineEarnings, pushQuests, presents as presentsAvecGrace } from './plots'
import { arrivee, depart, checkGift } from './onboarding'
import { runConvoys, sweepConvoys } from './convoy'
import { startCombat } from './combat'
import { startCarry } from './carry'
import { startGear } from './gear'
import { startEvents } from './events'
import { log, flushLog, replayLog } from './log'
import { startTheft, lockOnArrival, delivrerAlertes } from './theft'
import { startBelt } from './belt'
import { startRecords } from './records'
import { startFuser } from './fusion'
import { startRaid } from './raid'
import { startAdmin } from './admin'

/*
  The template's tap counter was deleted here on 25 Aug.

  It shipped with the SDK example and nothing in this game ever touched it: no client sent
  `tap`, so the handler never ran, the per-player entity it would have created was never
  created, and `tapAck` was answered to nobody. It was not merely inert. It held a `Storage`
  key of its own and flushed it on a five-second interval and on every departure, and server
  storage writes are capped per isolate with the excess failing silently, so a dead feature
  was spending a budget the real saves need.
*/
export function startServer(): void {
  console.log('[SERVER] start')

  const beat = engine.addEntity()
  ServerBeat.create(beat, { at: Date.now() })
  syncEntity(beat, [ServerBeat.componentId], SYNC_ID.serverBeat)
  timers.setInterval(() => {
    const b = ServerBeat.getMutableOrNull(beat)
    if (b !== null) b.at = Date.now()
  }, BEAT_MS)

  timers.setInterval(() => { flushLog() }, 1000)

  startPlots()
  startTheft()
  startCarry()
  startGear()
  startEvents()
  startBelt()
  startRecords()
  startFuser()
  startRaid()
  startAdmin()
  runConvoys()
  sweepConvoys()
  startCombat()

  const presents = new Set<string>()
  let sinceCheck = 0
  engine.addSystem((dt: number) => {
    sinceCheck += dt
    if (sinceCheck < 1) return
    sinceCheck = 0
    // Personne n'entre avant que le stockage ait fini de parler: voir `plotsPrets`.
    if (!plotsPrets()) return

    // One definition of "here" for the whole server, with its grace: see presents().
    const ici = presentsAvecGrace()

    for (const address of ici) {
      if (presents.has(address)) continue
      presents.add(address)
      void (async () => {
        await welcome(address)
        const hl = cashOfflineEarnings(address)
        if (hl !== null) void room.send('offlineEarnings', hl, { to: [address] })
        // The daily is no longer handed over on join; the player claims it from the day strip,
        // which is a red dot worth chasing (tester, 28 Aug). We only nudge that it is waiting.
        pushQuests(address)
        arrivee(address)
        lockOnArrival(address)    // grace period on arrival
        delivrerAlertes(address)  // what happened while away
        replayLog(address)
        console.log(`[SERVER] ${address} joined`)
      })()
    }

    checkGift(presents)

    for (const address of [...presents]) {
      if (ici.has(address)) continue
      presents.delete(address)
      auRevoir(address)
      depart(address)
    }
  })
}
