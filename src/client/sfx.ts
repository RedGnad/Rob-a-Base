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

/**
 * Replay an emitter, and be heard EVERY time.
 *
 * Writing `playing = false` then `playing = true` on a mutable does not retrigger. Both writes
 * land in the same frame, so only the final state is ever serialized, and the CRDT layer drops
 * a component whose bytes match the last ones it sent: `createGetCrdtMessagesForLww` in
 * `@dcl/ecs/dist/engine/lww-element-set-component-definition.js` compares against `lastSentData`
 * and `continue`s on a match. `getMutableOrNull` only marks the entity dirty, it never clears
 * that snapshot. Measured on the version we ship: the first press emits one message, every
 * press after it emits zero. The sound then only comes back when something else happens to
 * touch the component, which is why it worked for a while and then stopped.
 *
 * `AudioSource.playSound` goes through `createOrReplace`, which deletes the snapshot, so the
 * message always leaves. The SDK states the contract itself: "Always emits a CRDT PUT, so
 * repeated calls with identical parameters reliably retrigger playback."
 *
 * The clip is read back from the emitter, so an entity keeps the sound it was built with, and
 * `playSound` carries the rest of the component over untouched, including the volume the mute
 * switch wrote. A muted scene stays muted.
 */
export function replay(e: Entity | null): void {
  if (e === null) return
  const a = AudioSource.getOrNull(e)
  if (a === null) return
  AudioSource.playSound(e, a.audioClipUrl)
}

/** The volume an emitter created NOW should carry: zero while muted, so it joins the silence. */
export function volumeInitial(voulu: number, e: Entity): number {
  if (sfxView.on) return voulu
  volumes.set(e, voulu)
  return 0
}
