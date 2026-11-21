import { engine, Entity, Transform, GltfContainer, AvatarAttach, AvatarAnchorPointType, AudioSource } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
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

  So a shield stands round the protected player for the three seconds, on every client: it pops
  in with a little overshoot, kicks when it stops a round, and flutters through its last second
  so nobody is surprised when it goes. A round it stops rings off it, for the shooter and for
  the one inside. The sound is the lock's knock played high until a ricochet of its own exists.

  It is the force field's own look fitted to one body (tools/model/build-shield.py,
  shield-avatar.glb): a sphere read as a bubble, too big, and the head came out of its top
  (founder, 20 Nov 2026). A banded cylinder close round the avatar, feet to above the head,
  reads as the game's one sign for "you cannot touch this". A shared file, so one material for
  all of them; three made on first use and kept, more than a fight has shown at once.
*/
const POOL = 3
/** The bubble's width in metres: a unit sphere is one metre across. */
const WIDTH = 1.3
/**
  Feet to above the head. Set from captures, not from a tape measure: at 2.35 the top sat at the
  neck of a standard avatar seen from the front (the attached root draws smaller than its numbers).
*/
const HEIGHT = 2.95
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
  // Feet at the anchor, which is the avatar's position on the ground.
  Transform.create(ball, { parent: root, position: Vector3.Zero(), scale: Vector3.Zero() })
  GltfContainer.create(ball, { src: 'assets/Models/shield-avatar.glb', visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
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
      // Up from the feet with an overshoot; round the body, a breath, a kick per stopped round,
      // and a flutter through the last second.
      let up = 1
      let round = 1
      if (age < POP_MS) { const u = age / POP_MS; up = u < 0.7 ? 1.08 * (u / 0.7) : 1.08 - 0.08 * ((u - 0.7) / 0.3); round = up }
      else if (left < FLUTTER_MS) round = 0.9 + 0.1 * Math.abs(Math.sin(now / 70))
      else round = 1 + 0.02 * Math.sin(now / 260)
      const kick = now - b.kickAt
      if (kick < KICK_MS) round *= 1 + 0.12 * Math.sin((Math.PI * kick) / KICK_MS)
      t.scale = Vector3.create(WIDTH * round, HEIGHT * up, WIDTH * round)
    }
  })
}
