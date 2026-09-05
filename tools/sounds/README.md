# Sound ledger

Every effect the scene plays, measured, with the rule that decided its shape and its volume.
Regenerate any file with the tool named beside it; measure the set again with a script like
the one that produced these numbers (duration, peak, RMS, spectral centroid, dominant
frequency, share of energy above 2 kHz, on a 160 band log spectrum).

## The rules, and where they come from

1. **The more often a cue plays, the less intrusive it must be.** Google Design, "Sound &
   Touch: Design Beyond the Screen": "the more often an interaction happens, the less
   intrusive that sound or haptic should be", and "not every button you press ... results in a
   sound", silence being the audio equivalent of white space.
2. **Frequent means short, subtle and warm.** Toptal, "Sound Advice: A Quick Guide to
   Designing UX Sounds": "the more frequently a sound occurs in a product, the more subtle,
   shorter, and warmer it needs to be"; a micro-interaction sound "should never last more than
   0.3 seconds longer than its associated animation"; "harmonically complex sounds indicate
   priority", so a cue that needs no answer stays simple; and "users can, and will, mute apps
   that have repetitively aggravating sounds".
3. **One key for the whole family.** A Sound Effect, Bjørn Jacobsen: interface cues out of
   tune with the music had players quitting a minute or two earlier in an informal test; tune
   the cues to one key, and remove any sample that stands out from its siblings.
4. **One sound per act, played once.** Ours: the act's sound plays on the server's
   confirmation and never also on the press; the press keeps the click every button has.

The key is **C major**: C, D, E, G, A across the octaves. Every tonal cue below sits on it.

## Classes

| Class | Heard | Shape it is allowed |
|---|---|---|
| press | every button, dozens a minute | under 40 ms, one partial, quiet |
| frequent | the loop's own verbs: collect, pick up, place, build, lift, crate smash, reel tick, delivery | under 0.3 s, warm (centroid under ~1.4 kHz), no tail |
| act | steal, buy, fuse, recover, lock, shots, holster | under 0.35 s, may be brighter, a single meaning each |
| event | rush and raid bell, belt announcement, robbed, reveal stings | may ring, may climb, may be complex |

## The files

Before and after the pass of 5 Sep. Volume is the multiplier in code.

| File | Class | Tool | Duration | Centroid Hz before / after | >2 kHz before / after | Volume before / after | Change |
|---|---|---|---|---|---|---|---|
| tick.wav | press | build-tick.py | 0.045 → 0.035 s | 1811 / 1202 | 30 % / 9 % | 0.55 / 0.45 | 2 kHz to C6, an octave down |
| reel.wav | frequent | build-verbs.py | 0.06 s | 589 | 0 % | 0.6 | none |
| coin.wav | frequent | build-coin.py | 0.32 → 0.25 s | 1636 / 1350 | 19 % / 13 % | 0.7 / 0.6 | E major to C major, shorter, less second harmonic |
| take.wav | frequent | build-verbs.py | 0.16 s | 747 | 0 % | 0.6 | now on the server's word only |
| put.wav, slot.wav, knock.wav | frequent | build-verbs.py | 0.16 to 0.26 s | 148 to 365 | 0 to 3 % | 0.7 to 0.85 | none, already warm |
| lift.wav | frequent | build-verbs.py | 0.17 s | 1020 / 938 | 10 % / 11 % | 0.85 / 0.7 | chirp an octave down |
| hit.wav | frequent | none (24 Aug) | 0.13 s | 312 | 3 % | 0.9 / 0.75 smash, 0.8 / 0.7 verb | quieter |
| deliver.wav | frequent | build-verbs.py | 0.24 s | 457 | 4 % | 0.7 | new: one low partial, a padded thud |
| zap.wav | act | build-gun.py | 0.11 s | 1680 / 1387 | 32 % / 27 % | 0.9 / 0.8 | whine from 3.8 kHz, not 5.2 |
| taser.wav | act | build-gun.py | 0.15 s | 1804 / 1577 | 36 % / 29 % | 0.85 | whine from 3 kHz, not 4 |
| hitmark.wav | act | build-gun.py | 0.06 s | 1613 / 1198 | 28 % / 6 % | 0.85 / 0.7 | E6 and A6 instead of 1.8 and 2.6 kHz |
| shot.wav | act | build-gun.py | 0.14 s | 432 | 6 % | 0.8 / 0.7 | loudest file (RMS -6.8 dB), quieter |
| slap.wav | act | build-gun.py | 0.09 s | 414 | 4 % | 0.85 | none |
| seal.wav | act | build-gun.py | 0.34 s | 345 | 6 % | 1.0 / 0.7 door, 0.9 / 0.7 verb | RMS -9.5 dB at full volume, quieter |
| hum.wav | act | build-verbs.py | 0.34 s | 372 | 0 % | 0.75 / 0.6 | RMS -9.2 dB, quieter |
| till.wav, back.wav | act | build-verbs.py | 0.30 s | 1075, 314 | 8 %, 0 % | 0.8 / 0.7, 0.8 / 0.75 | quieter |
| draw.wav, holster.wav | act | build-verbs.py | 0.19, 0.21 s | 1267, 476 | 14 %, 5 % | 0.75, 0.7 | new on 5 Sep |
| bell.wav | event | build-reveal-tiers.py | 0.77 s | 902 | 8 % | 0.8 rush, 0.85 raid | new: G5 to C6; both used to play reveal.wav |
| belt.wav | event | build-reveal-tiers.py | 0.37 s | 1180 | 9 % | 0.7 | now one crate in sixty, not one in nine |
| alerte-vol.wav | event | none (23 Aug) | 0.27 s | 741 | 1 % | 1.0 | none |
| reveal.wav | event | build-reveal-tiers.py | 0.24 s | 910 | 5 % | 0.85 | now the crate reveal only |
| reveal-rare / big / huge | event | build-reveal-tiers.py | 0.52 / 1.11 / 2.06 s | 1075 / 1167 / 484 | 9 / 13 / 0 % | 0.85 / 0.85 / 0.9 | none |
| mutation.wav | event | build-reveal-tiers.py | 0.97 → 0.82 s | 1481 / 1477 | 44 % | 0.75 | shimmer trimmed; the notes are high by design |
| land.wav | frequent | build-reveal-tiers.py | 0.14 s | 196 | 0 % | 0.8 | none |
| burst.wav | event | normalise-burst.py | 0.42 s | 781 | 12 % | 1.0 / 0.9 | peaked at 0.0 dBFS, now -1.5 |

Two files have no generator (`hit.wav`, `alerte-vol.wav`, and `burst.wav` only a normaliser):
they predate the tools. Replace them through a generator before changing them.
