import { engine, Transform, TouchScreenControls, InputAction, AvatarLocomotionSettings, timers, inputSystem, PointerEventType, raycastSystem, RaycastQueryType, ColliderLayer } from '@dcl/sdk/ecs'
import { getPlatform, isMobile } from '@dcl/sdk/platform'
import { Vector3 } from '@dcl/sdk/math'
import { AIM_SPEED_SHARE, CARRY_STOLEN_SHARE, CARRY_OWN_SHARE, COIL_SHARE } from '../shared/schemas'

/**
 * All three gaits, because the player uses all three.
 *
 * Every slowdown in this game wrote `jogSpeed` and nothing else. The component also carries
 * `walkSpeed` and `runSpeed`, and a joystick pushed to its limit on a phone puts the avatar
 * in a RUN: the thief penalty, the aiming penalty and the weight of stolen goods have
 * therefore all been doing precisely nothing whenever the player was actually moving fast,
 * which is whenever any of it mattered. A player reported not being slowed at all while
 * carrying, and they were describing the truth.
 *
 * The three are ours now so that one multiplier reaches all of them.
 */
export const WALK_NORMAL = 4.5
export const JOG_NORMAL = 11
export const RUN_NORMAL = 15
export const THIEF_SHARE = 0.59      // the old 6.5 out of 11
export const SAUT_NORMAL = 1.15
export const THIEF_JUMP_SHARE = 0.6
const FREEZE_SHARE = 0.055
const FREEZE_JUMP = 0.2

/**
 * One place decides how fast the player moves.
 *
 * Three separate things slow the player and they overlap: the thief penalty, a sentry
 * freeze, and aiming. Each writing AvatarLocomotionSettings on its own means whichever
 * one ends last restores full speed and silently cancels the others. The state lives
 * here, and the component is written from the whole state, never from a single cause.
 *
 * Uses AvatarLocomotionSettings rather than InputModifier: the latter is documented as
 * having no effect outside the DCL 2.0 desktop client, and most of the score is mobile.
 */
const etat = { thief: false, aiming: false, carrying: 'non' as Charge, frozenUntil: 0, coil: false }

export type Charge = 'non' | 'sien' | 'vole'

function appliquer(): void {
  const frozen = etat.frozenUntil > Date.now()
  /*
    Stolen goods REPLACE the prying penalty rather than multiplying with it.
    
    The two used to stack, and the penalty expires two seconds after the item reaches the
    hands, so the thief went 6.5 while prying and 7.92 the moment they ran: an acceleration
    at the exact instant the dangerous half began. Carrying something that is not yours is
    now the single governing load, so 6.5 becomes 6.82 and the change is continuous.
  */
  const charge = etat.carrying === 'vole' ? CARRY_STOLEN_SHARE
    : etat.carrying === 'sien' ? CARRY_OWN_SHARE
    : 1
  const vol = (etat.thief && etat.carrying !== 'vole') ? THIEF_SHARE : 1
  // The coil is off while carrying: gear never helps the walk home, which is the genre's rule
  // and the only one that keeps a thief catchable.
  const coil = (etat.coil && etat.carrying === 'non') ? COIL_SHARE : 1
  const facteur = frozen
    ? FREEZE_SHARE
    : vol * charge * coil * (etat.aiming ? AIM_SPEED_SHARE : 1)
  const saut = frozen ? FREEZE_JUMP : SAUT_NORMAL * (etat.thief ? THIEF_JUMP_SHARE : 1)
  AvatarLocomotionSettings.createOrReplace(engine.PlayerEntity, {
    walkSpeed: WALK_NORMAL * facteur,
    jogSpeed: JOG_NORMAL * facteur,
    runSpeed: RUN_NORMAL * facteur,
    jumpHeight: saut,
    // A slowed thief who can still double-jump over a wall was not slowed.
    runJumpHeight: saut,
    doubleJumpHeight: saut
  })
}

export function applyFreeze(ms: number): void {
  etat.frozenUntil = Date.now() + ms
  appliquer()
  timers.setTimeout(appliquer, ms + 30)
}

/**
 * Full hands weigh, for as long as they are full.
 *
 * The prying penalty covered the theft plus two seconds and then let go, so the walk home,
 * the half of a theft that is meant to be dangerous, was run at full speed. This lasts as
 * long as the carrying does. It stacks with the prying penalty and with aiming rather than
 * replacing them: someone who tries to shoot their way out while loaded should feel it.
 */
export function setCarrying(charge: Charge): void {
  if (etat.carrying === charge) return
  etat.carrying = charge
  appliquer()
}

export function applyThiefPenalty(active: boolean): void {
  etat.thief = active
  appliquer()
  console.log(`[CLIENT] thief penalty ${active ? 'ON' : 'off'}`)
}

/** Aiming halves the jog. Stacks with the thief penalty instead of replacing it. */
export function setCoil(active: boolean): void {
  if (etat.coil === active) return
  etat.coil = active
  appliquer()
}

export function setAiming(active: boolean): void {
  if (etat.aiming === active) return
  etat.aiming = active
  appliquer()
}

/**
 * The glide icon shows when the next press would open the glider, and stays until the feet
 * touch the ground, like the client's own button.
 *
 * We draw our own jump disc, so it inherits none of the client's state, and the scene gets
 * no "grounded" flag. The first version guessed from height alone and blinked at random
 * (owner, 4 Sep). The second counted presses since a landing, and read a landing as a height
 * that stopped changing for 0.16 s. But the client freezes the character 0.2 s IN THE AIR at
 * the double jump (`AIR_JUMP_DELAY` in player.gd, `JumpState.AirJumpDelay` on the desktop),
 * which that rule took for a landing: the counter reset and the icon fell back to the jump
 * while the player was still up (owner, 11 Sep). The glider's own fall is capped at 1 m/s and
 * its 0.5 s opening sat near the same threshold.
 *
 * So the ground is now MEASURED the way the client measures it, a ray straight down from the
 * feet on the physics layer, which by contract never hits avatars (raycasting docs). On top
 * of it, the client's rule, read in joypad.gd (`_update_jump_icon`) and player.gd
 * (`get_jump_action`): on the floor, jump; in the air with the air jump still available, jump;
 * in the air past the air jump, glider as soon as it can open, more than 1 m above the ground
 * and 0.5 s after the last press; once shown, kept through the glider's closing until the feet
 * touch down.
 *
 * The ledge case differs per client, and the disc follows the client it runs on. On the
 * phone, player.gd says it in its own words, "we let a stepped-off-a-ledge player open glide
 * without first double-jumping": the air jump needs `jump_count >= 1`, a walk off a ledge
 * leaves it at 0, so the first press opens the glider and the icon shows it. On the desktop,
 * ApplyJump.cs does the opposite, "falling down is considered as having jumped once": once
 * the coyote window is over, the count is raised to 1, the press is an air jump, and only
 * then can the glider open. Should the ray never answer, the disc keeps the jump icon.
 */
export const volView = { descend: false }
/** Feet closer than this to the ground are on it: the controller rests 9 cm above a flat floor. */
const SOL_M = 0.3
/** The glider can open above this height: `GLIDE_MIN_GROUND_DISTANCE` in player.gd. */
const PLANEUR_M = 1.0
/** No glider before this long since the last press: `JUMP_TO_GLIDE_INTERVAL` in player.gd. */
const PLANEUR_DELAI_MS = 500
/** A press this recent does not count as landed, the feet may not have left the floor yet. */
const DECOLLAGE_MS = 300
/** Past this long in the air without a press, the desktop counts the fall as one jump (coyote window). */
const COYOTE_MS = 150
const SAUTS_AERIENS = 1
let distanceSol = 0
let sauts = 0
let dernierSaut = 0
let enLAirDepuis = 0

function followFall(): void {
  const sonde = engine.addEntity()
  Transform.create(sonde, { parent: engine.PlayerEntity, position: Vector3.create(0, 0.05, 0) })
  raycastSystem.registerGlobalDirectionRaycast({
    entity: sonde,
    opts: { queryType: RaycastQueryType.RQT_HIT_FIRST, direction: Vector3.Down(), maxDistance: 30, continuous: true, collisionMask: ColliderLayer.CL_PHYSICS }
  }, (r) => {
    const hit = r.hits[0]
    distanceSol = hit === undefined ? 30 : hit.length
  })
  engine.addSystem(() => {
    const now = Date.now()
    if (inputSystem.isTriggered(InputAction.IA_JUMP, PointerEventType.PET_DOWN)) {
      sauts += 1
      dernierSaut = now
    }
    if (distanceSol <= SOL_M) {
      if (now - dernierSaut > DECOLLAGE_MS) sauts = 0
      enLAirDepuis = 0
      volView.descend = false
      return
    }
    if (enLAirDepuis === 0) enLAirDepuis = now
    if (!isMobile() && sauts === 0 && now - enLAirDepuis > COYOTE_MS) sauts = 1
    if (volView.descend) return
    const sautAerienDisponible = sauts >= 1 && sauts <= SAUTS_AERIENS
    if (!sautAerienDisponible && distanceSol > PLANEUR_M && now - dernierSaut >= PLANEUR_DELAI_MS) volView.descend = true
  })
}

export function setupTouchHud(): void {
  followFall()
  /*
    Les boutons du client s'effacent, nous dessinons les notres.

    Sa configuration par bouton n'expose que `hide` et `icon`: aucune position, aucun ordre.
    La documentation officielle donne la seule porte de sortie, mot pour mot: *hide any button
    (including jump) [...] or replace the native controls entirely with custom UI*. Comme la
    disposition compte, on prend cette porte. Le manche de deplacement et le reticule restent
    au client, ils sont deja a leur place et nous n'avons rien de mieux a proposer.
  */
  TouchScreenControls.setMainAction(InputAction.IA_PRIMARY)
  TouchScreenControls.showAll()

  /*
    Five buttons, which is exactly as many as the client will show without folding any away.

    The eight touch controls are one priority stack, JUMP, the interaction button, E, F,
    then 1 to 4, and the slots on screen are fixed. Visible buttons fill those slots from
    the top of the stack down, and the rule that matters is the count: five or fewer and
    every one is drawn directly, a sixth and the client hands the last slot to a "+" that
    hides the rest behind a second tap.

    The numbered buttons are not badly placed, then. They occupy the same good slots as any
    other, and they only became awkward because we were showing too many things at once.
    Four are needed for the game: jump, the interaction button, E for the contextual action,
    F to draw. That leaves one, and one is what we take, for the menu, which is what removes
    a bar of our own from the bottom of the screen. The other three stay hidden rather than
    being pushed behind a "+".

    The glyph on it is ours. A control that reads "1" says nothing; the client lets a scene
    replace the picture with an image it ships, so the button says menu without a caption.
  */
  /*
    On garde les boutons natifs, on n'en cache qu'un.

    Le commentaire precedent racontait qu'on avait remplace le menu et la visee par des boutons
    dessines par la scene, parce qu'un testeur les trouvait trop petits. Ce n'est pas ce que le
    jeu montrait: en jeu le seul bouton en trop etait la main du pointeur, et nos deux plaques
    rectangulaires ne lisaient pas comme des commandes de pouce (proprietaire, 1 Sep). Le pave
    tactile du client est ce que le joueur connait deja de Decentraland, il est place pour le
    pouce, et son bouton de saut se change tout seul en parapente apres un double saut, ce
    qu'aucun bouton a nous ne saura faire.

    Restent caches: la main du pointeur, qui n'a plus rien a designer depuis que chaque clic a
    son equivalent contextuel, et les trois actions numerotees inutilisees, qui ne serviraient
    qu'a pousser le cinquieme bouton derriere un "+".
  */
  for (const a of [InputAction.IA_JUMP, InputAction.IA_POINTER, InputAction.IA_PRIMARY, InputAction.IA_SECONDARY, InputAction.IA_ACTION_3, InputAction.IA_ACTION_4, InputAction.IA_ACTION_5, InputAction.IA_ACTION_6]) CACHES.add(a)
  TouchScreenControls.hide([...CACHES])
  console.log('[CLIENT] touch HUD: boutons du client caches, la scene dessine saut, arme, menu et action; manche et reticule restent au client')
}

/**
 * Put one of our images on a client button, or take ours back off it.
 *
 * Passing null drops our entry entirely, which restores the button's built-in glyph: there
 * is no "no icon" value to write, only an entry that is or is not there.
 *
 * Answers whether it actually wrote, because the component does not exist until something
 * creates it and every caller here remembers what it asked for. A caller that records the
 * request before the write lands would never ask again, and the button would keep the wrong
 * picture for ever. Today nothing reaches this before `setupTouchHud`, so it never fires;
 * the callers are written so that reordering them cannot make it fire silently.
 */
const CACHES = new Set<InputAction>()

function setIcon(action: InputAction, nom: string | null): boolean {
  // A button the scene draws itself has no native picture to carry.
  if (CACHES.has(action)) return true
  const ctrl = TouchScreenControls.getMutableOrNull(engine.RootEntity)
  if (ctrl === null) return false
  const autres = ctrl.touchInputs.filter((t) => t.inputAction !== action)
  ctrl.touchInputs = nom === null
    ? autres
    : [
        ...autres,
        {
          inputAction: action,
          hide: false,
          icon: { tex: { $case: 'texture', texture: { src: `assets/ui/${nom}.png` } } }
        }
      ]
  return true
}

let menuAlerte: boolean | null = null

/**
 * The menu button wears a pip when something behind it is waiting.
 *
 * On a phone the menu lives on one of the client's own buttons, which cannot carry a badge of
 * ours. Swapping the picture is the only way to say "there is something in here", and it is
 * the oldest signal in interface design for exactly that reason: nobody has to read it.
 */
export function setMenuIcone(alerte: boolean): void {
  if (menuAlerte === alerte) return
  if (setIcon(InputAction.IA_ACTION_3, alerte ? 'icon-menu-alert' : 'icon-menu')) menuAlerte = alerte
}

let iconePrimaire: string | null = null

/**
 * The picture on the central button, decided in one place.
 *
 * That button is whatever the game currently offers: the trigger while the weapon is out,
 * banking the takings the rest of the time. Two different parts of the scene wanting to
 * write to it is how a button ends up showing the wrong thing after a state it did not know
 * about, so only the interface decides, once a frame, and everything else reads.
 *
 * Passing null puts the built-in "E" back, which is the right answer for the actions that
 * carry a price or a count and are better said in words.
 */
let reticuleClient: boolean | null = null

/**
 * Whether the client draws its own crosshair.
 *
 * Two reasons to take it away. A window is open, and a sight over a menu means nothing. Or
 * the weapon is out, and the scene draws its own sight, which says more: it turns red and
 * names whoever is under it. Two crosshairs on screen at once is also how a small offset
 * between them becomes visible, and there is one to be had, because the scene's coordinates
 * are inset from the device's safe margins while the client's are not.
 */
export function setReticuleClient(visible: boolean): void {
  if (reticuleClient === visible) return
  reticuleClient = visible
  if (visible) TouchScreenControls.showCrosshair()
  else TouchScreenControls.hideCrosshair()
}

export function setIconePrimaire(nom: string | null): void {
  if (iconePrimaire === nom) return
  if (setIcon(InputAction.IA_PRIMARY, nom)) iconePrimaire = nom
}

let armeSortie: boolean | null = null

/**
 * What F means right now, said on F.
 *
 * The scene used to print "F to draw" on a bar across the bottom of the screen, which is
 * furniture spent on a caption for a button that was already there. A control can carry its
 * own meaning: the weapon itself when it is holstered, the holster once it is out. And the
 * picture is the weapon the player actually holds, drawn from that very model or from the
 * boxes the scene assembles it out of (tools/ui/build-weapon-icons.py): a paddle for the
 * slap, a prod for the taser, the pistol otherwise (owner, 5 Sep). Nothing on screen, and
 * the answer is under the thumb that needs it.
 *
 * Guarded on the value because this is called from the aiming toggle: rewriting the
 * component with an identical value every time would put a network update on every change
 * of mind.
 */
export function iconeArme(arme: 'shoot' | 'slap' | 'taser'): string {
  return arme === 'slap' ? 'icon-slap' : arme === 'taser' ? 'icon-taser' : 'icon-gun'
}
let armeIcone: string | null = null
export function setArmeIcone(sortie: boolean, arme: 'shoot' | 'slap' | 'taser' = 'shoot'): void {
  const nom = sortie ? 'icon-holster' : iconeArme(arme)
  if (armeSortie === sortie && armeIcone === nom) return
  if (setIcon(InputAction.IA_SECONDARY, nom)) { armeSortie = sortie; armeIcone = nom }
}

export function reportPlatform(): void {
  function once(): void {
    if (getPlatform() === null) return
    engine.removeSystem(once)
    console.log(`[CLIENT] platform = ${getPlatform()} (mobile: ${isMobile()})`)
  }
  engine.addSystem(once)
}
