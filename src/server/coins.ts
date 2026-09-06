import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import { DroppedCoins, LOOT_LIFETIME_MS } from '../shared/schemas'

/**
 * Coins on the ground, which two different parts of the game now need to make.
 *
 * This lived inside combat.ts, where it was written for gunfire. A sentry firing on a thief
 * wants exactly the same thing, and combat.ts already imports theft.ts, so calling it from
 * there would have closed a cycle between the two. Scattering coins is a server capability
 * rather than a detail of shooting, so it moved out to sit where both can reach it.
 *
 * Merging matters: a piece landing near an existing one FROM THE SAME VICTIM tops it up
 * instead of adding an entity. Sustained fire feeds the scatter it already made, so the pile
 * grows where you are shooting rather than carpeting the plaza.
 */
const EPARPILLEMENT = 1.4
const FUSION = 1.6

export function dropAt(from: string, amount: number, at: { x: number; y: number; z: number }): void {
  const morceaux = amount >= 3 ? (amount >= 30 ? 3 : 2) : 1
  const part = Math.floor(amount / morceaux)
  const now = Date.now()

  for (let i = 0; i < morceaux; i++) {
    // The last piece carries the remainder, so nothing is lost to rounding.
    const valeur = i === morceaux - 1 ? amount - part * (morceaux - 1) : part
    /*
      Thrown, not arranged.

      The angle was `i / morceaux` of a full turn plus a little jitter, so two pieces always
      landed opposite each other and three always made a triangle: a player reads that as
      something PLACED, not as something dropped (tester, 7 Sep). A full random bearing and a
      wider spread of radius is what makes a scatter read as a scatter, and the first piece
      no longer lands exactly on the victim's feet either.
    */
    const angle = Math.random() * Math.PI * 2
    const rayon = EPARPILLEMENT * (0.25 + Math.random() * 1.15)
    const x = at.x + Math.cos(angle) * rayon
    const z = at.z + Math.sin(angle) * rayon

    let fusionne = false
    for (const [e, c] of engine.getEntitiesWith(DroppedCoins)) {
      if (c.droppedBy !== from) continue
      const t = Transform.getOrNull(e)
      if (t === null) continue
      if (Math.sqrt((t.position.x - x) ** 2 + (t.position.z - z) ** 2) > FUSION) continue
      const m = DroppedCoins.getMutableOrNull(e)
      if (m === null) continue
      m.amount += valeur
      m.untilMs = now + LOOT_LIFETIME_MS
      fusionne = true
      break
    }
    if (fusionne) continue

    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(x, 0.6, z) })
    DroppedCoins.create(e, { amount: valeur, droppedBy: from, untilMs: now + LOOT_LIFETIME_MS })
    syncEntity(e, [DroppedCoins.componentId, Transform.componentId])
  }
}
