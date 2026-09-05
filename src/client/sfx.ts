import { engine, AudioSource, Entity } from '@dcl/sdk/ecs'

/**
 * One switch for every sound effect the scene makes.
 *
 * The literature is unanimous on the failure this guards against: "users can, and will, mute
 * apps that have repetitively aggravating sounds" (Toptal, UX sounds guide), and a game that
 * cannot be muted from inside is muted from outside, along with everything else. The owner
 * asked for the switch in the menu (5 Sep), and it has to be ONE switch, because sounds are
 * played from a dozen places: the cue helper, the juice emitters, the belt bell, the rush
 * bell, the seal, the holster, the reveal.
 *
 * Two mechanisms, because emitters exist before and after the switch is thrown:
 *
 *   - `sfxView.on` is read by the helpers that play on demand (`cue`, `tic`), so a sound
 *     asked for while muted is simply not started;
 *   - `setSfx` walks every AudioSource in the engine and writes its volume to zero, keeping
 *     the value it had, so the emitters created at setup, which set `playing` directly, go
 *     quiet without a change at each of their twelve call sites. Unmuting writes them back.
 *
 * The choice is the player's, so it travels with the profile: the client sends `setPrefs`,
 * the server stores it, and the `index` message brings it back on every visit.
 */
export const sfxView = { on: true }

const volumes = new Map<Entity, number>()

export function setSfx(on: boolean): void {
  if (sfxView.on === on) return
  sfxView.on = on
  for (const [e] of engine.getEntitiesWith(AudioSource)) {
    const a = AudioSource.getMutableOrNull(e)
    if (a === null) continue
    if (!on) {
      volumes.set(e, a.volume ?? 1)
      a.volume = 0
      a.playing = false
    } else {
      const v = volumes.get(e)
      if (v !== undefined) a.volume = v
    }
  }
  if (on) volumes.clear()
}

/** The volume an emitter created NOW should carry: zero while muted, so it joins the silence. */
export function volumeInitial(voulu: number, e: Entity): number {
  if (sfxView.on) return voulu
  volumes.set(e, voulu)
  return 0
}
