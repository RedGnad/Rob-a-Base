import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { TYPE, C, TAP , SKIN} from './theme'
import { Glyphs } from './glyphs'
import { Btn } from './ui-kit'
import { strip } from './layout'
import { room } from '../shared/messages'

import { STRESS_BASES } from './stress'

/*
  Shown once, to a player whose tutorial is not finished, and to nobody else. It used to open
  at every launch for everyone; the sponsor's own line on mobile onboarding is "forcing
  everyone to onboarding creates frustration" (Friendzone workshop 3, Mobile UX, 19 Aug), and
  a returning player already gets WELCOME BACK. Decided on the first profile the server sends.
  Never on a measurement build: an instrument should not have to get past a door.
*/
export const welcomeView = { open: false, decided: false }
export function closeWelcome(): void {
  welcomeView.open = false
  void room.send('welcomeSeen', { seen: true })
}
/*
  Once per player, not once per session. It used to open on every session until the
  tutorial's last step was done, so a returning tester who had played, earned and shelved
  saw the title card again (10 Sep). The genre plays its intro once; an unfinished tutorial
  resumes at its step, which the corner chip already does. The server keeps the flag with the
  profile and sends it with the wallet; a profile from before the flag sees the card once.
*/
export function decideWelcome(tutoEtape: number, tutoTotal: number, welcomed: boolean): void {
  if (welcomeView.decided) return
  welcomeView.decided = true
  welcomeView.open = STRESS_BASES <= 0 && !welcomed && tutoEtape <= tutoTotal
}

export const WelcomePanel = () => {
  if (!welcomeView.open) return <UiEntity uiTransform={{ width: 0, height: 0 }} />
  /*
    A VEIL AND A CARD, the way every other modal here is built. Second reversal, recorded.

    The first version was a card on a black wash. On a phone the renderer insets the canvas
    by the device's safe margins, so the wash stopped short of the edges and read as a second
    dark rectangle around the card (tester, 7 Sep). The answer then was to paint the panel
    skin over the whole canvas with no veil, so there would be one rectangle instead of two.

    That traded one artefact for a worse one, and it took three testers' screenshots to see it
    (9 Sep). The canvas is inset either way, so the full panel ALSO stops short of the edges;
    and the client draws its own avatar, chat, joystick and emote controls in the corners, OVER
    scene UI by design, so those icons sat on top of our "panel" and it read as broken. The
    fusion and prestige panels never drew that complaint because their veil dims the world and
    the client's icons land on the dimmed world, not on the card. Same shape here.

    The inset frame itself is a renderer property, not a panel one: a veil that must reach the
    physical edges needs its own renderer declared with `screenInset: 'none'`. That is the
    next step, for every modal at once, once it can be looked at on a phone.
  */
  return (
    <UiEntity
      uiTransform={{
        width: '100%', height: '100%', positionType: 'absolute',
        justifyContent: 'center', alignItems: 'center'
      }}
      onMouseDown={closeWelcome}
    >
      <UiEntity
        uiTransform={{
          width: strip(900).width, height: 400,
          flexDirection: 'column', padding: 24, justifyContent: 'space-between'
        }}
        uiBackground={SKIN.panel}
      >
        {/*
          A title card, not a lecture.

          This held five numbered lines teaching the loop, and the organisers' own recap
          (Show & Tell, 28 Aug) names that pattern the thing to replace: visual guidance
          instead of text-heavy tutorials. The teaching moved into the world, where each
          lesson now fires at the moment it applies: the step chip says why, the gold beacon
          says where, the central button says what to press, and the red dot pays the first
          visit to the menu. What the world cannot say is the only thing left here: the name
          of the game and the shape of the goal, one line, read in the time a splash screen
          takes. It shows every session and costs one tap, which is what the genre's own
          splashes cost.
        */}
        <UiEntity uiTransform={{ width: '100%', height: 60, justifyContent: 'center' }}>
          <Glyphs value="ROB A BASE" size={TYPE.hero} role="money" align="center" box={strip(900).width - 48} />
        </UiEntity>
        <Label
          uiTransform={{ width: '100%', height: 44 }}
          value="EARN. STEAL. DEFEND. Top the records board."
          fontSize={TYPE.body} color={C.bonus} textAlign="middle-center" />
        {/* Shorter by thirteen characters, so it holds one line on the phone's wider font
            instead of leaving "it." alone on a second one; and a box for two lines anyway. */}
        <Label
          uiTransform={{ width: '100%', height: 56 }}
          value="Your loot earns on show, and on show anyone can take it."
          fontSize={TYPE.caption} color={C.dim} textAlign="middle-center" textWrap="wrap" />
        <UiEntity uiTransform={{ width: 340, height: TAP.height, alignSelf: 'center' }}>
          <Btn label="START" width={340} primary onClick={closeWelcome} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
