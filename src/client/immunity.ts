import { engine, Entity, Transform, MeshRenderer, Material, AvatarAttach, AvatarAnchorPointType, AudioSource } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { room } from '../shared/messages'
import { myClientAddress } from './theft'
import { replay, volumeInitial } from './sfx'

/*
  The immunity that follows a burst of hits, shown (founder, 20 Nov 2026).

  A player hit six times in three seconds is safe for three more (server/combat.ts). Only the
  shooter was told, in a line of text; the protected player saw and heard nothing change, and
  bystanders saw rounds land on someone for no result. The genre shows this state on the body:
  a respawn shield is a bubble everyone sees (Brawl Stars keeps one for three seconds, the same
  length as ours; Supercell release notes, June 2026).

  So a bubble stands round the protected player for the three seconds, on every client: it pops
  in with a little overshoot, kicks when it stops a round, and flutters through its last second
  so nobody is surprised when it goes. A round it stops rings off it, for the shooter and for
  the one inside. The sound is the lock's knock played high until a ricochet of its own exists.

  Three bubbles, made on first use and kept: an SDK sphere costs the phone a material each, and
  three is more than a fight has shown at once. Only their scale is written while they live.
*/
const POOL = 3
/** The bubble's width in metres: a unit sphere is one metre across. */
const WIDTH = 2.3
const POP_MS = 220
const KICK_MS = 140
const FLUTTER_MS = 1000

type Bubble = { root: Entity; ball: Entity; id: string; from: number; until: number; kickAt: number }
const bubbles: Bubble[] = []
let ricochet: Entity | null = null

function make(): Bubble {
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.create(0, -50, 0) })
  const ball = engine.addEntity()
  Transform.create(ball, { parent: root, position: Vector3.create(0, 1.0, 0), scale: Vector3.Zero() })
  MeshRenderer.setSphere(ball)
  Material.setPbrMaterial(ball, {
    albedoColor: Color4.create(0.45, 0.85, 1, 0.22),
    emissiveColor: Color3.create(0.35, 0.75, 0.95), emissiveIntensity: 0.9,
    metallic: 0, roughness: 0.2, castShadows: false
  })
  return { root, ball, id: '', from: 0, until: 0, kickAt: 0 }
}

function start(id: string, ms: number): void {
  const now = Date.now()
  let b = bubbles.find((x) => x.id === id && x.until > now)
  if (b === undefined) b = bubbles.find((x) => x.until <= now)
  if (b === undefined) {
    if (bubbles.length >= POOL) return
    b = make()
    bubbles.push(b)
  }
  if (b.id !== id || !AvatarAttach.has(b.root)) {
    AvatarAttach.createOrReplace(b.root, { avatarId: id, anchorPointId: AvatarAnchorPointType.AAPT_POSITION })
  }
  b.id = id
  b.from = now
  b.until = now + ms
  b.kickAt = 0
}

/** A round was stopped: the sound of it, for whoever fired or was fired at. */
export function playRicochet(): void { replay(ricochet) }

export function setupImmunity(): void {
  ricochet = engine.addEntity()
  Transform.create(ricochet, { parent: engine.PlayerEntity, position: Vector3.create(0, 1, 0) })
  AudioSource.create(ricochet, { audioClipUrl: 'assets/sounds/knock.wav', playing: false, loop: false, volume: volumeInitial(0.55, ricochet), pitch: 1.9 })

  room.onMessage('immune', (d) => { start(d.id.toLowerCase(), d.ms) })
  room.onMessage('shotBlocked', (d) => {
    const id = d.id.toLowerCase()
    const b = bubbles.find((x) => x.id === id && x.until > Date.now())
    if (b !== undefined) b.kickAt = Date.now()
    // The shooter hears it from their own shot result (combat.ts); here, the one inside.
    if (id === myClientAddress()) playRicochet()
  })

  engine.addSystem(() => {
    if (bubbles.length === 0) return
    const now = Date.now()
    for (const b of bubbles) {
      const t = Transform.getMutableOrNull(b.ball)
      if (t === null) continue
      if (b.until <= now) {
        if (t.scale.x !== 0) t.scale = Vector3.Zero()
        continue
      }
      const age = now - b.from
      const left = b.until - now
      // In with an overshoot, out through a flutter.
      let k = 1
      if (age < POP_MS) { const u = age / POP_MS; k = u < 0.7 ? 1.15 * (u / 0.7) : 1.15 - 0.15 * ((u - 0.7) / 0.3) }
      else if (left < FLUTTER_MS) k = 0.9 + 0.1 * Math.abs(Math.sin(now / 70))
      else k = 1 + 0.02 * Math.sin(now / 260)
      const kick = now - b.kickAt
      if (kick < KICK_MS) k *= 1 + 0.12 * Math.sin((Math.PI * kick) / KICK_MS)
      const s = WIDTH * k
      t.scale = Vector3.create(s, s * 1.08, s)
    }
  })
}
