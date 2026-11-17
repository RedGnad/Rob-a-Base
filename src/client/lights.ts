import { engine, Entity, Transform, LightSource } from '@dcl/sdk/ecs'
import { Color3, Vector3 } from '@dcl/sdk/math'
import { CENTER, BELT_LENGTH, BELT_HEIGHT, FLOOR_HEIGHT } from '../shared/schemas'
import { TOY } from './toy'

/*
  Four scene lights, created once at setup and never deleted.

  WHY A FIXED POOL. The scene had point lights under rare toys and guarded storeys until
  5 Sep, and they were taken out because creating then deleting a `LightSource` froze the
  desktop client (NullReferenceException in `LightSourceApplyPropertiesSystem`, `toy.ts`).
  Read in both clients' source (2 Nov), the two operations this file uses never reach that
  path: `active` false only disables the light (desktop `LightSourceApplyPropertiesSystem`,
  phone `light_source.rs` `set_light_enabled`), and a moved entity carries its light with it.
  Nothing here removes a `LightSource` or an entity that holds one. The desktop fixed the
  removal path itself in v0.184.0-alpha (#10275, 1 Oct); the pool stays, because it is safe on
  any client older than that and on the phone, where removal was never tried.

  THE BUDGET. The phone warns at 8 authored lights and refuses to load the scene at 16, active
  or not, and its graphics profile renders 0 (Very Low), 2 (Low), 4 (Medium) or 8 (High). The
  desktop renders none on Low, 6 on Medium, 10 on High. Both keep the lights nearest the
  player. Four fit every ceiling, and on a Low phone the two that render are the two nearest,
  which are the ones on screen. The game reads the same with zero lights: each one lands on
  something that already has its colour.

  WHICH FOUR. Two hang over the belt, where every session starts and every player crosses. Two
  follow the armed sentries nearest the player, its own storey first, so a guarded floor throws
  its cyan on the slab from the doorway: the defence reads before the rule does.

  BRIGHTNESS. The desktop multiplies candela by 0.0005 for Unity (`LightSourceSettings.asset`),
  so the documented "average lightbulb" of 16000 is a Unity intensity of 8. The range is always
  explicit: unset, it is the fourth root of the intensity, about 11 m, a wash over the floor
  rather than a pool under its object.
*/

const BELT_LIGHT = {
  color: Color3.create(1, 0.86, 0.62),
  intensity: 16000,
  range: 8,
  height: BELT_HEIGHT + 2.6
}
const SENTRY_LIGHT = {
  color: Color3.fromHexString(TOY.sentry),
  intensity: 16000,
  range: 5,
  // Above the cone's centre, as a share of its scale: the cone is a unit cylinder centred on its entity.
  lift: 0.3
}
const SENTRY_LIGHTS = 2
// Past this a sentry's light is off: the player cannot see its pool, and on a Medium phone it would take a slot.
const SENTRY_REACH = 30
const RANK_EVERY_S = 0.5

const armed = new Set<Entity>()
const sentryLights: Array<{ e: Entity; target: Entity | null; at: Vector3 }> = []

export function setupLights(): void {
  for (const dx of [-BELT_LENGTH / 4, BELT_LENGTH / 4]) {
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(CENTER.x + dx, BELT_LIGHT.height, CENTER.z) })
    LightSource.create(e, {
      type: LightSource.Type.Point({}),
      color: BELT_LIGHT.color,
      intensity: BELT_LIGHT.intensity,
      range: BELT_LIGHT.range,
      shadow: false
    })
  }
  for (let i = 0; i < SENTRY_LIGHTS; i++) {
    const e = engine.addEntity()
    const at = Vector3.create(CENTER.x, -10, CENTER.z)
    Transform.create(e, { position: at })
    LightSource.create(e, {
      type: LightSource.Type.Point({}),
      color: SENTRY_LIGHT.color,
      intensity: SENTRY_LIGHT.intensity,
      range: SENTRY_LIGHT.range,
      shadow: false,
      active: false
    })
    sentryLights.push({ e, target: null, at })
  }

  let wait = 0
  engine.addSystem((dt) => {
    wait -= dt
    if (wait > 0) return
    wait = RANK_EVERY_S
    rankSentries()
  })
}

/** A sentry is armed or not; the pool decides which armed ones get a light. */
export function sentryLight(sentry: Entity, isArmed: boolean): void {
  if (isArmed) armed.add(sentry)
  else armed.delete(sentry)
}

/** World position of an entity through its parent chain, with each parent's rotation and scale. */
function worldPosition(e: Entity): Vector3 | null {
  const t = Transform.getOrNull(e)
  if (t === null) return null
  let p = Vector3.clone(t.position)
  let parent = t.parent
  for (let n = 0; n < 8 && parent !== undefined && parent !== engine.RootEntity; n++) {
    const pt = Transform.getOrNull(parent)
    if (pt === null) break
    p = Vector3.add(pt.position, Vector3.rotate(Vector3.multiply(p, pt.scale), pt.rotation))
    parent = pt.parent
  }
  return p
}

function rankSentries(): void {
  const me = Transform.getOrNull(engine.PlayerEntity)
  if (me === null) return
  // The game is played by storey: a sentry on the player's own floor wins over a nearer one above.
  const myFloor = Math.round(me.position.y / FLOOR_HEIGHT)
  const ranked: Array<{ s: Entity; at: Vector3; gap: number; d: number }> = []
  for (const s of armed) {
    const t = Transform.getOrNull(s)
    if (t === null) { armed.delete(s); continue }
    const p = worldPosition(s)
    if (p === null) continue
    const d = Vector3.distance(p, me.position)
    if (d > SENTRY_REACH) continue
    const at = Vector3.create(p.x, p.y + t.scale.y * SENTRY_LIGHT.lift, p.z)
    ranked.push({ s, at, gap: Math.abs(Math.round(p.y / FLOOR_HEIGHT) - myFloor), d })
  }
  ranked.sort((a, b) => a.gap - b.gap || a.d - b.d)
  const chosen = new Map(ranked.slice(0, SENTRY_LIGHTS).map((r) => [r.s, r.at]))

  // A light keeps its sentry while that sentry stays chosen, so two close sentries never swap lights back and forth.
  const free: typeof sentryLights = []
  for (const l of sentryLights) {
    if (l.target !== null && chosen.has(l.target)) {
      place(l, l.target, chosen.get(l.target)!)
      chosen.delete(l.target)
    } else free.push(l)
  }
  for (const l of free) {
    const next = chosen.entries().next()
    if (next.done === true) { switchOff(l); continue }
    const [s, at] = next.value
    chosen.delete(s)
    place(l, s, at)
  }
}

function place(l: (typeof sentryLights)[number], target: Entity, at: Vector3): void {
  // Written only when something changed: an unchanged component costs nothing on either client.
  if (Vector3.distance(l.at, at) > 0.01) {
    Transform.getMutable(l.e).position = at
    l.at = at
  }
  if (l.target === null) LightSource.getMutable(l.e).active = true
  l.target = target
}

function switchOff(l: (typeof sentryLights)[number]): void {
  if (l.target === null) return
  LightSource.getMutable(l.e).active = false
  l.target = null
}
