import {
  engine, Transform, SkyboxTime, PointerLock,
  PointerEvents, PointerEventType, InputAction, inputSystem
} from '@dcl/sdk/ecs'
import { isMobile } from '@dcl/sdk/platform'

import { getPlayer } from '@dcl/sdk/players'
import { Plot, ServerBeat, BEAT_DEAD_AFTER_MS, CENTER, occupe } from '../shared/schemas'
import { room } from '../shared/messages'
import { setupTouchHud, reportPlatform, applyThiefPenalty } from './locomotion'
import { setupBox } from './box'
import { setupRevealToy } from './reveal-toy'
import { setupPlots } from './plots'
import { setupTheft, setClientAddress, theftView } from './theft'
import { sendOrHold } from './intent'
import { setupBelt } from './belt'
import { setupRecords } from './records'
import { setupFuser } from './fusion'
import { setupRaid } from './raid'
import { setupStress } from './stress'
import { setupSlots } from './slots'
import { setupQuests } from './quests-ui'
import { setupTutorial } from './tutorial'
import { setupGuidage } from './guidage'
import { setupDecor } from './decor'
import { setupTravel } from './travel'
import { noteServerClock, serverClockOffset } from './clock'
import { setupVenue } from './venue'
import { setupJuiceSound } from './juice'
import { setupConvoy } from './convoy'
import { setupCombat } from './combat'
import { setupCarry } from './carry'
import { setupGear } from './gear'
import { setupEvents } from './events'
import { setupToy } from './toy'
import { setupLootUi } from './loot-ui'
import { setupPreload } from './preload'
import { setupIntent } from './intent'

export const view = {
  items: 0,
  serverAlive: false,
  lastBeatValue: 0,
  lastBeatSeenAt: 0,
  penaltyActive: false,
  /**
   * True until the very first heartbeat is seen, false ever after.
   *
   * A server that has never spoken is booting; one that spoke and went quiet has died.
   * They look identical in a boolean and read completely differently to a player: the
   * platform only runs a scene's server while someone is in it, keeps it about two minutes
   * after the last player leaves, then stops it, so the next visitor waits roughly fifteen
   * seconds for a cold start. Telling that visitor the server is OFFLINE says the game is
   * broken when it is merely starting.
   */
  serverBooting: true,
  /**
   * Client-side instant the current wait began, or 0 while the server is answering.
   *
   * The interface draws the wait as a bar rather than a sentence, and a bar needs a start.
   * It is our own clock on purpose: the server's timestamps mean nothing here, and this
   * has to be right on the very first visit, when no server has ever spoken.
   */
  waitingSince: Date.now(),
  floors: 1
}

/*
  On desktop the cursor is captured while the game is on screen: the camera follows the mouse
  without a click-and-drag, the way any third-person game does, and the capture is released
  the moment a panel needs the cursor (welcome, menu, prestige). Edge-triggered on the HUD's
  visibility, so Esc still frees the cursor and nothing fights the player for it until the
  next panel opens or closes. `isPointerLocked` is writable by a scene, verified in the SDK's
  own `31,20-pointer-lock-control` test scene. Nothing on a phone: there is no cursor, and a
  finger on the screen already looks around.
*/
/*
  Deux regimes, parce que les deux erreurs ne coutent pas la meme chose.

  Le declenchement sur FRONT valait pour la capture: verrouiller a chaque image se battrait
  avec la touche Echap, qui est la sortie normale du joueur. Mais il valait aussi pour le
  DEVERROUILLAGE, et la c'etait faux. Le client verrouille le curseur de son cote des qu'on
  clique dans le monde, sans nous prevenir; notre intention, elle, n'a pas change, alors le
  front ne se produit jamais et rien ne corrige. Le joueur se retrouve devant un panneau avec
  un curseur capture: sa premiere pression sert a rendre le curseur, la seconde seulement
  atteint le bouton. C'est exactement ce qu'il decrivait ("il faut cliquer plusieurs fois sur
  START", 2 Sep) et ce n'etait pas un doigt qui rate.

  Alors: tant qu'un panneau est ouvert on INSISTE, image apres image, parce qu'un panneau
  qu'on ne peut pas cliquer n'est pas un panneau. Des que le jeu reprend on ne verrouille
  qu'une fois, sur le front, et on laisse Echap tranquille.
*/
function setupPointerLock(): void {
  PointerLock.createOrReplace(engine.CameraEntity, { isPointerLocked: false })
  let dernier: boolean | null = null
  engine.addSystem(() => {
    const voulu = theftView.hudVisible
    const front = voulu !== dernier
    dernier = voulu
    if (voulu && !front) return
    const pl = PointerLock.getMutableOrNull(engine.CameraEntity)
    if (pl === null) return
    /*
      While a panel is open we write it EVERY frame, and we do not check first.

      The check `!== voulu` had a blind spot the size of the bug it was meant to fix: the
      client can capture the cursor without publishing it back into this component, so we read
      "already unlocked", write nothing, and the player faces a menu with a captured cursor
      where the first press only hands the cursor back. That is exactly the menu that has been
      capricious for days while the HUD chips, which are pressed with the cursor already
      captured, behave (owner, 5 Sep). A component write per frame costs nothing next to a
      panel that eats presses, and it is only while a panel is up.
    */
    if (!voulu) { pl.isPointerLocked = false; return }
    if (pl.isPointerLocked !== voulu) pl.isPointerLocked = voulu
  })
}

export function startClient(): void {
  console.log('[CLIENT] start')
  room.onMessage('serverLog', (d) => console.log(`[SERVER] ${d.line}`))
  setupIntent()
  setupTouchHud()
  if (!isMobile()) setupPointerLock()
  reportPlatform()
  applyThiefPenalty(false)

  SkyboxTime.createOrReplace(engine.RootEntity, { fixedTime: 43200 })

  setupJuiceSound()
  setupVenue()
  setupBox()
  setupRevealToy()
  setupPlots()
  setupStress()
  setupTheft()
  setupCarry()
  setupGear()
  setupEvents()
  setupToy()
  setupLootUi()
  setupPreload()
  setupBelt()
  setupRecords()
  setupFuser()
  setupRaid()
  setupSlots()
  setupConvoy()
  setupCombat()
  setupQuests()
  setupTutorial()
  setupGuidage()
  setupDecor()
  setupTravel()

  let myAddress = ''
  let nameSaid = false
  engine.addSystem(() => {
    if (myAddress === '') {
      const me = getPlayer()
      if (me === null) return
      myAddress = me.userId.toLowerCase()
      setClientAddress(myAddress)
      console.log(`[CLIENT] mon adresse: ${myAddress}`)
    }
    /*
      The client tells the server its own name. The server read it off the avatar
      component, which on a server just replaced arrives after the player's welcome, so a
      base was christened "Guest 20e0" and the raid line called its top attacker that
      (owner, 4 Sep). The client always knows its name; it says it once, as soon as the
      platform hands it over, and the server takes that over anything it inferred.
    */
    if (!nameSaid) {
      const me = getPlayer()
      if (me !== null && me.name !== undefined && me.name !== '') {
        nameSaid = true
        sendOrHold(() => { void room.send('hello', { name: me.name }) })
      }
    }
    for (const [, p] of engine.getEntitiesWith(Plot)) {
      if (p.ownerId.toLowerCase() !== myAddress) continue
      if (occupe(p.items) !== view.items || p.floors !== view.floors) {
        view.items = occupe(p.items)
        view.floors = p.floors
        console.log(`[CLIENT] my base: ${view.items} items, ${view.floors} floor(s)`)
      }
      return
    }
  })

  let changements = 0
  engine.addSystem(() => {
    let value = 0
    for (const [, b] of engine.getEntitiesWith(ServerBeat)) value = b.at > value ? b.at : value
    const now = Date.now()
    if (value !== 0 && value !== view.lastBeatValue) {
      view.lastBeatValue = value
      changements += 1
      if (changements >= 2) view.lastBeatSeenAt = now
      // The beat is also the only reading of the server's clock this client gets: see clock.ts.
      noteServerClock(value)
      if (changements === 2) console.log(`[CLIENT] server clock offset ${serverClockOffset()} ms`)
    }
    view.serverBooting = view.lastBeatSeenAt === 0
    const alive = view.lastBeatSeenAt !== 0 && now - view.lastBeatSeenAt < BEAT_DEAD_AFTER_MS
    if (alive) view.waitingSince = 0
    else if (view.waitingSince === 0) view.waitingSince = now
    if (alive !== view.serverAlive) {
      console.log(`[CLIENT] server ${alive ? 'ALIVE' : 'SILENT'} (last beat ${view.lastBeatSeenAt === 0 ? 'jamais' : (now - view.lastBeatSeenAt) + ' ms'})`)
    }
    view.serverAlive = alive
  })
}

