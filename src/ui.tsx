import { PRODUCTION_PER_RARITY } from './shared/economy'
import { Color4 } from '@dcl/sdk/math'
import { engine } from '@dcl/sdk/ecs'
import { getPlatform, isMobile } from '@dcl/sdk/platform'
import ReactEcs, { Button, Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { InputAction, inputSystem, PointerEventType } from '@dcl/sdk/ecs'
import { TYPE, C, HUE, TAP, SKIN, RAD, btn, lisible, largeurTexte, lignesDeTexte, FORCE_MOBILE_LAYOUT } from './client/theme'
import { Glyphs, glyphWidth } from './client/glyphs'
import { FONT_FILES } from './client/font-metrics'
import { PrestigePanel, prestigeView } from './client/prestige-ui'
import { FusionPanel, fuserPanelView } from './client/fusion-ui'
import { intentEnAttente } from './client/intent'
import { strip, row, topBand, noticeBand, active, BAND, THUMB, STACK_GAP, clientEdges, decalageCentre, setReference, zoneRenderer } from './client/layout'
import { forceDuTir, GEARS, CARRY_STOLEN_SHARE, PENDING_CAP_S } from './shared/schemas'
import { Btn, CloseBtn, SoundBtn, Pouce, Barre, SURF, pctAnime, cue } from './client/ui-kit'
import { damageFlashAlpha, liveAmounts } from './client/juice'
import { BUILD } from './client/build-stamp'
import { view } from './client/setup'
import { toyImage } from './client/toy'
import { noterEvenement, signalerMenu } from './client/clics'
import { loadingView } from './client/loading'
import { setIconePrimaire, setReticuleClient, setMenuIcone, iconeArme } from './client/locomotion'
import { theftView, lockBase, recover, doPrestige, collectPending, cancelSteal, filVisible, alertesVisibles } from './client/theft'
import { gearView, placeTrap } from './client/gear'
import { nextBigText, rushChip, eventView, openRushCard, closeRushCard, rushCardVisible, rushInfo } from './client/events'
import { beltView, crateInReach, buyCrate } from './client/belt'
import { convoyInReach, surencherir } from './client/convoy'
import { fuserInReach, agirSurFuser } from './client/fusion'
import { boxView, openBestCrate, peutOuvrirIci, frapper, REEL_WIN, revealHold } from './client/box'
import { revealToyView } from './client/reveal-toy'

import { IndexContent, indexView, HAUTEUR_INDEX } from './client/index-ui'
import { ShopContent, shopView, HAUTEUR_SHOP } from './client/shop-ui'
import { QuestsContent, questsToClaim, questsView, HAUTEUR_GOALS } from './client/quests-ui'
import { TravelContent, HAUTEUR_TRAVEL } from './client/travel-ui'
import { menuView, activeTab, basculerMenu, chooseTab, closeMenu } from './client/menu'
import { verb } from './client/verb'
import { volView } from './client/locomotion'
import { tutoView, STEP_TEXTS, giftView, stepExpects, stepHintDue, stepVerb } from './client/tutorial'
import { WelcomePanel, welcomeView } from './client/welcome'
import { RARITIES, itemName, itemColor, mutation, formatIncome, formatSolde, prixDeRevente, crate } from './shared/loot-table'
import { applyUiProbe } from './client/ui-probe'

const INCOME_UI = PRODUCTION_PER_RARITY

/** Card geometry for the reel, in virtual pixels. */
/**
 * The reel is as wide as the room allows, because seeing the near misses IS the mechanic.
 *
 * A first pass gave it a fixed 1400 to have a width to centre against, and that made it
 * shorter than the screen on both sides. A reel exists so a player watches an Epic slide past
 * on its way to stopping on a Good: cut the ends off and it stops being a wheel and becomes an
 * announcement. It now takes whatever `strip` leaves between the client's own furniture, and
 * the cards came down from 210 so more of the strip fits into it.
 */
/*
  The card of the strip, in the proportion a collectible card has had since 1993: 63 by 88 mm,
  which is 0.716. Both numbers were 200 and nothing chose them (owner, 5 Sep: "les dimensions
  ont ete choisies au hasard"). A square card is the one shape that says nothing, and it wasted
  the height a standing piece needs while spending width the strip has to pan across. Portrait
  gives the toy its room, lets the eye track a row of tall objects rather than a row of tiles,
  and still shows seven cards across the phone's canvas at this gap.

  The picture inside stays SQUARE, because it is drawn with `textureMode: 'stretch'` from a
  square file: a portrait art box would squash every piece sideways.
*/
const REEL_W = 190
const REEL_H = 264
const REEL_GAP = 16
/** The result line lives inside the reel's panel, above the strip: one vertical budget for the whole reveal. */
const REEL_TITRE = 48
/** How much the winning card grows when the strip lands on it. */
const REEL_POP = 1.22

/*
  What happened to the piece, and what to do next. Only that: the yield used to open
  every line and was already on screen twice, on the reveal and on the winning card, and
  the name sat beside it while the reveal showed it huge (owner, 3 Sep). The reel's title
  row now carries the one thing nothing else says.
*/
const ETATS: Record<string, () => string> = {
  main: () => 'IN YOUR HAND  ·  put it on any pedestal',
  expose: () => 'placed on your base',
  'en-stock': () => 'kept in stock  ·  BUILD YOUR BASE to earn from it',
  plein: () => 'your base is full  ·  make room'
}
import { slotView, togglePlacing, placeHere } from './client/slots'
import { ico, ICONES_VERBES } from './client/icones'
import { carryView, placeDown, dropCarried, vendre } from './client/carry'
import { baseIci, padEnFace, agirSurPad, elevatorInReach, monterIci, lockPostInReach } from './client/plots'
import { combatView, holster } from './client/combat'

export function setupUi() {
  /*
    E is the game's action, and the only one.

    The mobile client gives four buttons a thumb can reach and names what each emits: the
    interaction button sends IA_POINTER at whatever is under the reticle, E sends
    IA_PRIMARY, F sends IA_SECONDARY, and there is a jump. Adding our own row beside them
    was noise. So the world answers the interaction button, E carries whatever the scene
    would have put on a button of its own, and F draws the weapon. One button, one meaning.
  */
  engine.addSystem(() => {
    /*
      What the central button is for, right now, drawn on the central button.

      Aiming makes it the trigger. Otherwise it takes the picture of whatever action is on
      offer, when that action has one, and falls back to the plain E for the actions whose
      price or count has to be read rather than recognised.
    */
    setIconePrimaire(combatView.aiming ? ico('fire') : (nextAction()?.icon ?? null))
    // Nor over the crate's roulette and reveal: nothing there is aimed at (owner, 5 Sep).
    setReticuleClient(!combatView.aiming && !modale() && !menuView.open && !boxView.roule && boxView.resultat < 0)
    setMenuIcone(questsToClaim() > 0)

    // The fifth control on the client's cluster, and the 1 key on a keyboard: the menu.
    if (inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN)) basculerMenu()
    // A panel up means no play underneath it: the sell key and the contextual key used to
    // reach the world through the menu (owner, 6 Sep). Same rule for the trigger, in combat.ts.
    if (modale() || menuView.open) return
    // While the weapon is out this button is the trigger, and combat.ts owns it. Without
    // this, one press would fire and open the nearest crate in the same frame.
    // Key 2 on a desktop, the chip's own binding on a phone: both arrive here, once.
    if (inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN)) vendre()
    if (combatView.aiming) return
    if (!inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) return
    const a = nextAction()
    if (a !== null) { sonDuVerbe(a.icon); a.action() }
  })

  function choose(): void {
    if (getPlatform() === null) return
    engine.removeSystem(choose)
    const phone = isMobile() || FORCE_MOBILE_LAYOUT
    /*
      'device' rather than 'interactable', deliberately.

      The interactable inset shifts the whole canvas inward to clear the client's controls,
      so '50%' stops being the middle of the screen and a centred dialog drifts to one side,
      which is what a phone showed. The documentation puts dialogs at the centre of the
      screen, so the canvas is left whole and only the hardware margins are avoided here.
      Staying clear of the client's own controls is a placement question, and it is answered
      one place, in layout.ts, where the forbidden columns are named.
    */
    const inset = 'device'
    setReference(phone ? 1600 : 1920, phone ? 720 : 1080)
    // 1600x720 is what the client substitutes on a handset for a 16:9 request; asking for
    // it directly is what makes the desktop preview measure like a phone.
    ReactEcsRenderer.setUiRenderer(uiComponent, {
      virtualWidth: phone ? 1600 : 1920, virtualHeight: phone ? 720 : 1080, screenInset: inset
    })
    // The build stamp lives in the log now: it sat under the purse in the menu, and a code
    // in a player's face is a developer's habit, not a control (owner, 5 Sep).
    console.log(`[CLIENT] interface ${phone ? '1600x720 (phone)' : '1920x1080'}, screenInset '${inset}', build ${BUILD}`)
  }
  ReactEcsRenderer.setUiRenderer(uiComponent, { virtualWidth: 1920, virtualHeight: 1080 })
  engine.addSystem(choose)
}

/**
 * One window, one row of tabs, three contents.
 *
 * The three panels each used to draw their own frame, centred, while the row that switched
 * between them sat in the bottom band at a fixed height. On a phone that height falls inside
 * the frame, so the tabs were printed across the middle of the very panel they command, and
 * each panel was free to be a different size from its neighbours.
 *
 * A tab row belongs to its window. Putting the frame here, once, means the three can only
 * ever agree on where they are and how big they are, and the controls that steer them can
 * no longer land on top of them.
 */
/**
 * A full-width row whose only job is to centre one thing of unknown width.
 *
 * Everything else in this interface is placed by computing a margin of minus half its
 * width, which works and is exact, and which quietly requires every plate to declare a
 * width it may not need. A line of text that changes with the game does not have a width to
 * declare, and padding it out to a fixed one is how a two-word hint came to take a third of
 * a phone screen. This lets the layout do the centring instead of the arithmetic.
 */
const Centre = (props: { top?: number; bottom?: number; decalage?: boolean; children?: unknown }) => {
  // `decalage` moves the row onto the middle of the SCREEN rather than the middle of the
  // rectangle the renderer hands us; see `decalageCentre` in layout.ts. Only what has to line
  // up with the glass asks for it: the reticle, and the reel.
  const dx = props.decalage === true ? decalageCentre().x : 0
  return (
    <UiEntity
      uiTransform={{
        width: '100%', positionType: 'absolute',
        position: props.top !== undefined ? { top: props.top, left: dx } : { bottom: props.bottom ?? 0, left: dx },
        justifyContent: 'center', alignItems: 'center'
      }}
    >
      {props.children}
    </UiEntity>
  )
}

const MENU_W = 1088
/** The strip at the right edge of a dialog body where the client draws its scrollbar. */
const SCROLLBAR_COVER_W = 26

/**
 * The right-hand corner, as a stack with air between its tenants.
 *
 * Three things want that corner: the tutorial step, the crate being earned, and the event
 * feed. They were each adding their own guess at an offset, and two of them landed eight
 * pixels apart, which reads as one panel that has split rather than two panels. One place
 * decides, and it leaves a real gap.
 */
const COIN_H = [64, 40, 52, 40, 40, 62]
/*
  ONE width for the whole corner column.

  Every plate up there sized itself to its own sentence, so their left edges made a staircase
  and the widest one reached a quarter of the way across the play area while the narrowest was
  half that (owner, 7 Sep, three screenshots). A column of readouts is one object: it gets one
  left edge, and that edge is a promise about how much of the screen it will ever take. 440 of
  1600 is 27 %, which fits the longest step title (`Steal from a neighbour`, 436 measured) and
  leaves the other 73 % to the game. Anything that does not fit at that width is a sentence to
  shorten, not a plate to widen.
*/
const COIN_W = 440
/**
 * La largeur d'une rangee du coin: la sienne, plafonnee, jamais celle du groupe.
 *
 * Une seule largeur pour toute la colonne etait MA decision, pas une demande, et elle repondait
 * a cote (proprietaire, 7 Sep). Ce qui avait ete signale, capture a l'appui, c'est que ces
 * plaques s'etendaient trop loin vers la GAUCHE, dans le champ de jeu, et qu'elles changeaient
 * de taille entre deux etats. Les figer toutes a la plus longue supprime bien le changement de
 * taille, mais en donnant a "RAID IN 3:41" une plaque trois fois plus large que son texte: une
 * grosse bulle a moitie vide, exactement le defaut qu'il fallait corriger.
 *
 * Une colonne calee a DROITE n'a pas besoin d'une largeur commune: ses bords droits sont deja
 * alignes, c'est la ou l'oeil se pose, et des bords gauches inegaux y sont aussi normaux que
 * dans un texte aligne a droite. Chaque rangee prend donc la largeur de ce qu'elle dit, avec
 * un plancher pour qu'une ligne de trois mots reste une plaque, et le plafond de 440 qui
 * garde les trois quarts de l'ecran au jeu.
 */
/*
  The floor was 168, set on the desktop where no row ever reached it. On a phone the raid
  countdown measures 121 units of text at caption size ("RAID IN 8:26", tester screenshot,
  9 Sep), 154 with its air, and the floor padded it to 168: sixteen units of air on the left,
  thirty on the right, the one row of the column that was not sized to its words (owner, 9 Sep).
  140 keeps a three-word line a plate and lets that row take the width it needs.
*/
const COIN_MIN = 140
function coinW(...textes: string[]): number {
  let large = 0
  for (const t of textes) large = Math.max(large, largeurTexte(t, TYPE.caption))
  // 30 d'air en tout, quinze de chaque cote: assez pour que le texte ne touche pas le
  // bord de la plaque, assez peu pour qu'une ligne courte ne flotte pas dedans.
  return Math.round(Math.max(COIN_MIN, Math.min(COIN_W, large + 30)))
}
/** The rush chip: how long it holds in the middle, then how long its flight to the corner takes. */
const RUSH_HOLD_MS = 1500
const RUSH_FLIGHT_MS = 550
/** The rush card: a picture and two lines, sized for its longest sentence at label size. */
const RUSH_CARD_W = 720
const RUSH_CARD_H = 132
/*
  How much screen the toast column may ever take, and how many plates at once.

  A third of the canvas height, measured from where the column starts, and three plates. The
  reference this interface follows keeps transient messages out of the acting area; ours grew
  into it because nothing bounded the stack (6 Sep). Anything past the third is dropped rather
  than queued: a message worth reading twice is not a toast.
*/
const TOASTS_MAX = 3
const TOASTS_BAS = 240
/*
  THE CHIP IS AS WIDE AS ITS WIDEST LINE, MEASURED AT THE SIZE THAT LINE IS DRAWN.

  Two arithmetic faults, wrong on the desktop and plain on every phone (three testers, 9 Sep):
  `coinW` measured the title at caption size while the title is drawn at body size, so the
  plate was sized for text half again narrower than the text it holds; and the width read
  `min(COIN_W, X, max(X, hint))`, which is `min(COIN_W, X)` for every value of hint, so the
  hint line never counted at all. Both came out as words running past the right edge.

  The row is now summed member by member, at each member's own size: padding, icon, gap, step
  counter, gap, title, padding. The hint takes the whole inner width and WRAPS, and the chip
  grows a line per line of hint, so a hint longer than the plate on a wide phone font is two
  lines rather than a spill. The cap stays: the corner column is a column.
*/
/*
  The chip has its own ceiling, wider than the column's, and a margin on the wrap decision.

  Checked by arithmetic against both measured phone ratios (9 Sep): at the column's 440 the
  fifth title, "Steal from a neighbour", needs 505 and would run 65 units past the plate on
  every phone; and the fourth hint landed 0.4 unit from the inner edge, which is a coin toss
  the client's own wrapping decides, and a second line it decides to draw would be cut by
  the chip's clip. So the chip may grow to 560, anchored right so it grows into the empty
  band beside the coin counter, and the wrap count is decided 24 units short of the inner
  width: a borderline hint reserves two lines, and an empty second line costs nothing.
*/
const CHIP_W_MAX = 560
const CHIP_WRAP_MARGIN = 24
const stepChipW = (): number => {
  const s = STEP_TEXTS[tutoView.etape]
  if (s === undefined) return COIN_MIN
  // Eight units of slack on the row: the estimate IS the measured phone width, so without
  // slack the longest title sits on the edge to the rounding, and rounding is a coin toss.
  const rangee = 16 + 40 + 12 + largeurTexte(`${tutoView.etape + 1}/${tutoView.total}`, TYPE.caption) + 12 + largeurTexte(s.titre, TYPE.body) + 20 + 8
  const aide = stepHintDue() && s.aide !== '' ? 16 + largeurTexte(s.aide, TYPE.caption) + 20 : 0
  return Math.ceil(Math.min(CHIP_W_MAX, Math.max(COIN_MIN, rangee, aide)))
}
/** Lines the hint takes inside the chip, 0 while it is not due. */
const stepHintLines = (): number => {
  const s = STEP_TEXTS[tutoView.etape]
  if (s === undefined || s.aide === '' || !stepHintDue()) return 0
  return lignesDeTexte(s.aide, TYPE.caption, stepChipW() - 36 - CHIP_WRAP_MARGIN)
}
/** The step chip grows a line once its hint is due, and one more per wrapped line of it. */
const stepChipH = (): number => { const n = stepHintLines(); return n === 0 ? COIN_H[0] : 100 + (n - 1) * 30 }
/** One feed row. Caption is 21, and 26 leaves the descenders somewhere to go. */
const FIL_LIGNE = 26
const COIN_GAP = STACK_GAP

function coinDroit(rang: number): number {
  const present = [
    tutoView.etape < tutoView.total,
    rushChip() !== null,
    giftView.leftS > 0,
    nextBigText() !== null,
    gearView.cloakLeftS > 0
  ]
  let y = BAND.top
  for (let i = 0; i < rang; i++) if (present[i] === true) y += (i === 0 ? stepChipH() : COIN_H[i]) + COIN_GAP
  return y
}

const MENU_PAD = 18
const MENU_ENTETE = TAP.height + 14

/*
  UN MUR PLEIN ECRAN DERRIERE LA FENETRE, SUR ORDINATEUR SEULEMENT.

  Ce que dit la trace (`debug:ui`, lue le 7 Sep). Sur le bureau, on trouve des series d'appuis
  qui n'atteignent personne: `entity=-1`, porteur 0, aucun porteur d'interface, aucun
  gestionnaire. Build 1925, cinq appuis en 3,5 s juste apres un CLAIM (15217, 16266, 17081,
  18172, 18750). Build 2b97, cinq appuis en 5 s juste apres TRAVEL. Ce ne sont pas des doubles:
  ils sont espaces d'une seconde a une seconde et demie. Le client ne teste meme pas la
  fenetre: l'appui part au MONDE.

  La cause etait deja ecrite trois lignes plus bas, et le diagnostic date du 2 Sep: un appui
  qui passe a cote d'un bouton va au monde, le client reprend le curseur, notre systeme le
  relache une image plus tard, et cet appui-la a servi a recuperer le curseur au lieu d'agir.
  La fenetre a ete rendue etanche a ce moment-la. Ce qui ne l'a jamais ete, c'est TOUT CE QUI
  L'ENTOURE, laisse libre pour qu'un glissement puisse encore tourner la camera sur telephone.

  Ce compromis ne paie rien sur un ordinateur: avec un menu ouvert on ne fait pas pivoter la
  camera a la souris, on clique. Le mur n'existe donc que la, et le telephone garde son ecran
  libre exactement comme avant. Il porte un voile leger plutot que d'etre transparent, pour
  deux raisons qui vont dans le meme sens: une surface reellement invisible n'est pas garantie
  d'etre testee au pointeur, et un panneau modal se detache de son fond dans a peu pres toutes
  les interfaces publiees.
*/
const MenuSheet = () => {
  if (phone() || modale() || !menuView.open) return null
  return (
    <UiEntity
      uiTransform={{
        width: '100%', height: '100%', positionType: 'absolute',
        position: { top: 0, left: 0 }, pointerFilter: 'block'
      }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.22) }} />
  )
}

const MenuWindow = () => {
  if (modale() || !menuView.open) return null

  /*
    The height is computed, and the scrolling area is given a number rather than a wish.
    
    The body used to be `flexGrow: 1` inside a fixed-height window, on the assumption that
    it would take the space left over and no more. That is CSS reasoning. The engine lays
    out with Yoga, where `flexShrink` defaults to zero rather than one, so a child whose
    content is taller than the room available does not shrink to fit: it keeps its size and
    runs out through the bottom of the frame. On a desktop it happened to scroll; on a phone
    it simply spilled past the panel, which is what a photograph of the running game showed.
    
    So each tab declares what it needs, the window takes that or the ceiling, whichever is
    smaller, and the body is handed the exact remainder in pixels. A tab that fits makes a
    short window instead of a tall one with a hole in it, which is the other half of the
    complaint: a card for three objectives should not take over the screen.
  */
  /*
    The header, divided out of the width this window really has rather than the one it wanted.
    Five gaps: one after the purse and one after each of the first three tabs, plus the one
    before CLOSE, which is what the fourth tab's own margin provides.
  */
  const dedans = strip(MENU_W).width - MENU_PAD * 2
  const ecart = Math.round(dedans * 0.018)
  /*
    Fifteen percent, from nineteen. Measured, not guessed: at nineteen a tab was 143 wide and
    the word TRAVEL needs 136 of them, which leaves three and a half units of air on each side
    and reads as a word jammed into its plate (owner, 7 Sep). The purse never needs that room:
    the longest sum this game can show is six characters. Four units of the width move from the
    purse to the tabs, and every tab gains ten.
  */
  const bourse = Math.round(dedans * 0.15)
  // CLOSE is utility, not a destination: it took as much of the bar as a whole tab and
  // read as a fifth one. Half the width and a single letter give the four real tabs the
  // room, which is the hierarchy lesson applied to our own header.
  const fermer = Math.round(dedans * 0.075)
  // The sound switch, the same width as CLOSE: two utilities at the end of the bar, one gap
  // more between them.
  const son = fermer
  const onglet = Math.floor((dedans - bourse - fermer - son - ecart * 6) / 4)

  const besoin = questsView.open ? HAUTEUR_GOALS
    : indexView.open ? HAUTEUR_INDEX
    : shopView.open ? HAUTEUR_SHOP
    : HAUTEUR_TRAVEL
  /*
    One window, whatever the tab. It used to shrink to each tab's declared height, so
    switching from GOALS to TRAVEL made the frame jump (owner, 3 Sep): a window that
    changes size under the tabs reads as four windows. The body is the same on a phone and
    on a desktop, in the units everything here is authored in.
  */
  const h = BAND.dialogMaxHeight
  const corps = h - MENU_PAD * 2 - MENU_ENTETE
  // Whether this tab runs past its body. Only then does the body scroll: the client draws
  // its scrollbar whenever a box is allowed to scroll, even with nothing to scroll to.
  const deborde = besoin > corps + 4

  return (
    /*
      No sheet across the screen while the menu is up: a press beside the window must still
      turn the camera on a phone, and a sheet would take that drag. What must NOT answer is
      the world, and the world is refused at its five click checks (client/monde.ts) and at
      the keys in the system above (owner, 6 Sep).
    */
    <UiEntity
      uiTransform={{
        width: strip(MENU_W).width, height: h, positionType: 'absolute',
        position: { top: '50%', left: '50%' },
        margin: { left: strip(MENU_W).margin.left, top: -h / 2 },
        flexDirection: 'column', padding: MENU_PAD,
        /*
          The window swallows every press that lands on it, button or not.

          A plate carries no handler, so a press beside a button went through it to the
          world, where the client grabs the cursor back; our own system frees it a frame
          later, so that press was spent recapturing the cursor and the player pressed twice
          (owner, 2 Sep on START, 5 Sep in the shop, after the first fix). A panel is a wall.
        */
        pointerFilter: 'block'
      }}
      /*
        The window wears the same plate as everything inside it.

        It was a flat near-black rectangle with square corners: the ONE surface in the game
        that did not use the generated skins. Over the records board, which is also nearly
        black, the two merged and the tab row looked like it was floating outside its own
        panel (owner, 1 Sep). The navy plate brings the outline, the rounded corners and the
        top gloss every card and button already has, so the window reads as a window.
      */
      uiBackground={SKIN.panel}
    >
      <UiEntity
        uiTransform={{
          width: '100%', height: TAP.height, flexDirection: 'row',
          alignItems: 'center', margin: { bottom: 14 }
        }}
      >
        {/*
          Every width here is a share of the window that actually got drawn.

          They were fixed pixel sizes adding up to 1034, checked against the 1052 a full-width
          window gives. But `strip` trims that window on a narrow phone, and a row of fixed
          children in a flex line does not shrink to fit: it overflows. A photograph of the
          real thing showed the four tabs touching each other and CLOSE hanging off the right
          edge of its own panel. Shares of the measured width cannot do that at any size, and
          the glyphs still get their box in pixels, which is the one thing they need.
        */}
        <UiEntity uiTransform={{ width: bourse, height: TAP.height, justifyContent: 'center' }}>
          <Glyphs value={formatIncome(theftView.coins)} size={TYPE.body}
            role="money" align="left" box={bourse} top={(TAP.height - TYPE.body) / 2} />
        </UiEntity>
        {(['goals', 'shop', 'index', 'travel'] as const).map((o) => (
          <Btn key={o} width={onglet} right={ecart} primary={activeTab() === o}
            onClick={() => { noterEvenement(`tab-${o}`); chooseTab(o) }}
            badge={o === 'goals' && questsToClaim() > 0}
            label={o.toUpperCase()} />
        ))}
        <SoundBtn size={son} right={ecart} />
        <CloseBtn size={fermer} onClick={closeMenu} />
      </UiEntity>

      {/*
        The body scrolls natively, and the client's scrollbar is covered.

        A first answer replaced scrolling with pages of our own; the owner preferred the
        native drag on a phone and was right (3 Sep). The bar itself is not ours to style
        or hide in this SDK (no such property in 7.26.1), but it is drawn inside the
        body's box at its right edge, and a plate of ours laid over that strip, later in the
        tree, sits on top of it. What tells the player there is more is the fade along the
        bottom edge, the affordance the platforms use once a bar is gone.
      */}
      <UiEntity uiTransform={{ width: '100%', height: corps }}>
        <UiEntity
          uiTransform={{
            width: '100%', height: corps, overflow: deborde ? 'scroll' : 'hidden', flexDirection: 'column',
            positionType: 'absolute', position: { top: 0, left: 0 }
          }}
        >
          <QuestsContent />
          <ShopContent />
          <IndexContent />
          <TravelContent />
        </UiEntity>
        {deborde && (
          <UiEntity
            uiTransform={{
              /*
                Drawn over the client's scrollbar, and TRANSPARENT to the thumb.

                It used to block pointer events, and it sits twenty-six pixels wide against the
                right edge of the scrolling body while a row's action button ends ten pixels
                from that same edge: the right sixteen pixels of every BUY, SET and WIELD in
                the menu were dead, so a press that landed there did nothing at all, no sound,
                no plate pushed in (owner, 5 Sep: "j'appuie clairement et parfois rien"). A
                cover hides a scrollbar; it has no reason to eat the press underneath it.
              */
              width: SCROLLBAR_COVER_W, height: corps, positionType: 'absolute',
              position: { top: 0, right: 0 }, pointerFilter: 'none'
            }}
            uiBackground={{ color: Color4.fromHexString('#1b3054ff') }} />
        )}
        {deborde && (
          <UiEntity
            uiTransform={{
              width: '100%', height: 56, positionType: 'absolute', position: { bottom: 0, left: 0 }
            }}
            uiBackground={{
              texture: { src: 'assets/ui/fade-right.png' }, textureMode: 'stretch',
              // The strip is dark at u = 1. Corners go bottom-left, top-left, top-right,
              // bottom-right (docs.decentraland.org, ui_background), so the dark end lands
              // on the bottom edge and the fade rises from it.
              uvs: [1, 0, 0, 0, 0, 1, 1, 1]
            }} />
        )}
      </UiEntity>
    </UiEntity>
  )
}

/**
 * The controls, for a machine that has no touch cluster to lend us.
 *
 * Everything of ours moved onto the client's own buttons, which was right for a phone and
 * left the desktop with nothing: the pictures we write go into TouchScreenControls, which
 * that client does not draw. The moment COLLECT started carrying an icon instead of a
 * sentence, a desktop player was shown no way to bank their takings at all.
 *
 * So the desktop gets the same three controls, in the same corner, drawn by us: the menu,
 * the weapon, and whatever the game currently offers. They carry their key as well as their
 * name, and they are bound to the same actions, so they can be clicked or typed.
 */
/**
 * Selling, as a control: contextual, secondary, with friction.
 *
 * Three versions came before this one. A plate in the middle of the screen with a large SELL
 * whenever you carried your own item, which a tester read as an incitement to sell, and the
 * game wants shelves filled. A row in the shop, which was a room too far for an act done
 * once per crate. A bin by the door, a place, which was still a walk. The mobile HUD
 * guidance this project reads settles it: show a control only when it applies (contextual
 * minimalism), keep primary actions in the thumb zone and put secondary or destructive ones
 * beside them in a lesser style, and give an irreversible act friction rather than distance.
 * So: a small secondary control, priced, present only while your own item is in your hands,
 * at the edge of the screen rather than its centre. It asked a question first; the tester cut
 * that as friction, so one press sells. Key 2 on a desktop. On a phone it is a scene button, because the
 * client's own stack has no free slot without folding the others behind a "+".
 */
const SellChip = (props: { right?: number }) => {
  // Not while the crate's roulette still runs: the item lands in the hand with the roll's result,
  // and a price under a piece not yet revealed spoils the reveal (owner, 5 Sep).
  if (carryView.code < 0 || carryView.vole || boxView.roule || boxView.resultat >= 0) return null
  const prix = formatIncome(prixDeRevente(carryView.code))
  const mot = phone() ? `SELL  +${prix}` : `2  SELL  +${prix}`
  /*
    Sized to its words, and no taller than a thumb needs.

    It was a fixed 250 by 96 slab riding above the pad, which on a handset is a banner across
    the right of the screen that met the corner column coming down (owner, 6 Sep, screenshot).
    It now takes the width its own sentence needs and the platform's minimum touch height,
    80 units, 7.6 mm on the reference handset, exactly Material's floor. The desktop keeps the
    full row height: there is room there and the key hint rides with it.
  */
  const taille = phone() ? TYPE.caption : TYPE.body
  const large = Math.round(largeurTexte(mot, taille) * 1.12) + 44
  return (
    <Btn label={mot} size={taille}
      width={phone() ? large : 290} height={phone() ? TAP.menu : undefined}
      right={props.right} bind={[InputAction.IA_ACTION_4]} />
  )
}

/**
 * Every image the interface will ever show, requested at start.
 *
 * The client fetches a UI texture the first time an element shows it. In production that
 * fetch goes to the content server, and the first crate reel of a session was drawn before
 * its cards' icons, fondus and backgrounds had arrived: a strip of nothing, then a normal one
 * the second time. Two pixels off the canvas, one per image, is what it costs to have them
 * all resident before the first moment that needs them.
 */
/*
  Every UI texture the scene will ever show, fetched at start in a 2 px box off-screen. The
  mobile team's own words (workshop #3): the first time a UI texture appears you get a white
  flash, and nothing while loading "doesn't read as long, it reads as broken". The button
  icons were missing from this list; the first draw of the gun or the menu badge flashed.
*/
/*
  The living counter's state: what is drawn chases what is true, and each arrival is kept
  long enough to float up and disappear. Module state, read by pure render functions.
*/
let compteurVu = -1
/** Quand le compteur a ete rafraichi pour la derniere fois: le rattrapage se mesure en temps. */
let compteurA = 0
let gainA = 0
/*
  Le solde ne bouge que sur des EVENEMENTS, donc chaque hausse merite son nombre flottant.

  La production va dans la cagnotte et non dans le solde, si bien que ce compteur ne monte que
  sur un encaissement, une vente, un vol, un ramassage ou une reclamation hors ligne. La
  soustraction du filet, qui existait le temps ou le revenu tombait en continu, n'a donc plus
  d'objet: elle est retiree plutot que gardee au cas ou, un calcul qui ne corrige plus rien
  finissant toujours par corriger quelque chose par erreur.
*/
function compteurAffiche(): number {
  const vrai = theftView.coins
  /*
    Le saut sec est reserve a ce qui n'est PAS un gain.

    La regle testait l'ecart en valeur absolue: au-dela de la moitie du solde, ou de mille, le
    compteur se recalait d'un coup, sans animation et sans "+X". Elle traitait donc les grosses
    HAUSSES comme des resynchronisations, et c'est exactement ce que le proprietaire voyait
    (7 Sep, "des fois on la voit bien des fois non"): encaisser trois mille sur un solde de cinq
    mille depasse le seuil et ne montrait rien, alors que treize millions sur deux cent
    quarante-huit milliards passe dessous et s'animait. Plus le joueur est pauvre, plus ses
    gains sont relativement gros, donc plus l'animation lui etait refusee: l'inverse de ce
    qu'il faut.

    Une vraie resynchronisation, c'est le premier montant recu, ou une BAISSE brutale, qui est
    un prestige. Une hausse, quelle que soit sa taille, est un gain et se joue: l'interpolation
    converge en une trentaine d'images quel que soit l'ecart, donc rien ne rampe.
  */
  if (compteurVu < 0 || compteurVu - vrai > Math.max(1000, vrai * 0.5)) { compteurVu = vrai; return vrai }
  // Toute hausse relance le coup de pouce. Le MONTANT du gain n'est plus retenu: il n'avait
  // qu'un lecteur, le petit "+X", et il est parti avec lui.
  if (vrai > compteurVu) gainA = Date.now()
  /*
    Le rattrapage se compte en SECONDES, pas en images.

    Il retirait une fraction fixe de l'ecart a chaque image. La bosse et le son, eux, sont sur
    une horloge: sur une machine qui tombe a quinze images par seconde, le compteur mettait
    quatre fois plus longtemps a rejoindre sa valeur pendant que les deux autres ne bougeaient
    pas. Le proprietaire a signale un manque de reactivite puis a doute de sa machine (7 Sep);
    il avait raison les deux fois, la lenteur etait reelle ET elle venait de la machine, parce
    que l'animation etait indexee sur elle.

    La forme exponentielle est gardee, elle est juste rapportee au temps: `1 - exp(-dt / tau)`
    donne le meme mouvement a toutes les cadences. Tau vaut cent millisecondes, ce qui reproduit
    le reglage d'origine a soixante images par seconde, sans le trahir ailleurs.
  */
  const maintenant = Date.now()
  const dt = compteurA === 0 ? 16 : Math.min(200, maintenant - compteurA)
  compteurA = maintenant
  compteurVu = compteurVu + (vrai - compteurVu) * (1 - Math.exp(-dt / 100))
  if (Math.abs(vrai - compteurVu) < Math.max(2, vrai * 0.0002)) compteurVu = vrai
  return Math.round(compteurVu)
}
/*
  Le seul reste de l'arrivee d'argent: le gros nombre qui enfle un instant.

  Un petit "+X" montait a cote de lui, et il disait une troisieme fois ce que le compteur qui
  grimpe et le son de piece disaient deja (proprietaire, 7 Sep). Trois canaux pour un evenement,
  c'est un de trop: on le lit une fois et on cesse de le voir, et il occupait un coin d'ecran
  au-dessus du nombre le plus regarde du jeu.

  Ce qui reste est le coup de pouce sur le nombre lui-meme: le retour est porte par la chose
  qui change, ce qui est la regle que ce depot suit partout ailleurs.

  Sa duree et son amplitude sont celles d'origine. Elles avaient ete reglees, et le
  proprietaire est revenu sur son impression de manque de reactivite en la mettant sur le
  compte de sa machine (7 Sep): changer des valeurs reglees sur un symptome non confirme est
  precisement la derive qu'on evite. Ce qui a ete corrige a la place est le vrai defaut que ce
  doute a fait trouver, juste en dessous.
*/
function poussee(): number { return Math.max(0, 1 - (Date.now() - gainA) / 260) }

/*
  The verbs that MOVE, and the two poses each plays. There is exactly one.

  The mallet strikes, and that beat is what says "press this to build". Collect was given the
  same treatment, a coin dropping onto the pile, and it was wrong on its own terms: collecting
  is the state the player is in most of the time, so a button that moves whenever there is
  nothing special to say is noise, not a cue (owner, 5 Sep). Movement is a signal and a signal
  spends itself. It also cost the still picture: grouping the three poses made the scale come
  from the union, which shrank the resting pile by a tenth.
*/
/*
  What each verb sounds like.

  The pad clicks on every press, which says "registered"; this says WHAT. Six new cues from
  `tools/sounds/build-verbs.py` and four the game already had, mapped by the verb the button
  is carrying at that moment. A verb with no entry keeps the click alone, which is the honest
  default rather than a wrong sound.
*/
const SON_DU_VERBE: Record<string, [string, number]> = {
  build: ['knock.wav', 0.85],
  place: ['slot.wav', 0.8],
  give: ['put.wav', 0.8],
  drop: ['put.wav', 0.7],
  // COLLECT and PICK UP are not here on purpose. Both are answered by the server with the
  // amount, and the amount's own sound (the coin for collecting, the soft take for a pile),
  // so a sound on the press was the same act heard twice a tenth of a second apart (owner,
  // 5 Sep, both verbs). The press keeps the click every button has.
  steal: ['zap.wav', 0.8],
  buy: ['till.wav', 0.7],
  outbid: ['till.wav', 0.7],
  fuse: ['hum.wav', 0.6],
  recover: ['back.wav', 0.75],
  lock: ['seal.wav', 0.7],
  crate: ['hit.wav', 0.7]
}
function sonDuVerbe(icone: string | undefined): void {
  if (icone === undefined) return
  for (const v of Object.keys(SON_DU_VERBE)) {
    if (icone === ico(v as 'build')) { const [f, vol] = SON_DU_VERBE[v]; cue(f, vol); return }
  }
}

/**
 * The hammer moves only when a strike would land.
 *
 * It swung whenever the build verb was up, including on a spot where nothing can be built,
 * which is where every new player starts (the belt corridor). A cue that says "press this"
 * over an act that will be refused teaches the wrong thing (owner, 6 Sep). For the build
 * verbs the swing and the pulse wait for the ghost to be green; every other verb keeps its cue.
 */
function peutConstruireIci(a: { id: string } | null): boolean {
  if (a === null) return false
  if (a.id !== 'construire-base' && a.id !== 'poser-base') return true
  return slotView.active && slotView.valid
}

/* Les verbes qui SE BALANCENT sur le bouton: le maillet nu pour batir, le maillet sur une
   boite pour l'ouvrir. Chacun a ses trois images (`-raised`, `-mid`, et la frappe au repos). */
const POSES = ['build', 'smash'] as const
function posesDe(icone: string | undefined): [string, string] | undefined {
  const nom = POSES.find((v) => icone === ico(v))
  return nom === undefined ? undefined : [`${ico(nom)}-raised`, `${ico(nom)}-mid`]
}

const PRECHAUFFE = [
  'panel', 'card', 'inset', 'primary', 'secondary', 'danger', 'fade-left', 'fade-right',
  'toy-0', 'toy-1', 'toy-2', 'toy-3', 'toy-4', 'toy-5', 'toy-6', 'toy-mystery',
  // Les trois boutons satellites, puis les quatorze verbes du bouton contextuel dans la
  // famille active, quelle qu'elle soit: voir `client/icones.ts`.
  ...ICONES_VERBES, ...POSES.flatMap((v) => [`${ico(v)}-raised`, `${ico(v)}-mid`]),
  // The interface icon family and the reveal's ray fan. A texture named for the first time
  // while a panel is drawing arrives a beat late, and the player sees an empty square where
  // the crate should be (owner, 1 Sep). Anything the interface can show has to be listed
  // here the moment it is created, which is the whole job of this list.
  'ui-crate', 'ui-floor', 'ui-shield', 'ui-prestige', 'ui-luck', 'ui-close', 'ui-sound', 'ui-mute', 'vignette',
  'ui-gear-0', 'ui-gear-1', 'ui-gear-2', 'ui-gear-3', 'ui-gear-4', 'ui-gear-5', 'ui-gear-6', 'ui-gear-7',
  'burst'
]
/*
  Every interface texture referenced from the first frame: the icons, the five atlases and the
  eight plates. A texture downloads the first time something on screen names it, and on a cold
  cache the money was drawn before its atlas arrived (tester, 28 Aug). Two pixels each, off
  screen, so the downloads ride the loading screen. The shadow atlas is absent on purpose:
  nothing references it any more.
*/
const PRECHAUFFE_FICHIERS: string[] = [
  ...PRECHAUFFE.map((n) => `${n}.png`),
  ...(['money', 'bonus', 'name', 'danger', 'ink'] as const).map((r) => FONT_FILES[r]),
  ...Object.values(SKIN).map((sk) => sk.texture.src.replace('assets/ui/', ''))
]
/*
  Every file STACKED at the same two pixels, and those two pixels ON the screen.

  The preheat did not preheat. Its box was two pixels wide with `overflow: 'hidden'`, and its
  children were laid out in a row: the first square sat inside, and the forty after it were
  laid past the right edge and clipped away. Add that the box itself was at -8, -8, off the
  canvas entirely, and there was nothing left for a renderer to decide to upload. Hence a HUD
  whose buttons were empty discs until the first press pulled each glyph in one at a time
  (owner, 5 Sep, at startup).

  Now every child is absolute at the same corner, so all of them are inside the box, and the
  box is at 0, 0 inside the canvas at three percent opacity: two pixels nobody will ever see,
  which the renderer has no reason to skip.
*/
const Prechauffe = () => (
  <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: 2, height: 2, opacity: 0.03 }}>
    {PRECHAUFFE_FICHIERS.map((n) => (
      <UiEntity key={n}
        uiTransform={{ width: 2, height: 2, positionType: 'absolute', position: { left: 0, top: 0 } }}
        uiBackground={{ texture: { src: `assets/ui/${n}` }, textureMode: 'stretch' }} />
    ))}
  </UiEntity>
)

/**
 * The phone's own two controls, beside the client's three.
 *
 * The client's small buttons are the client's size, and the tester could not hit F or the
 * menu on a real handset (28 Aug). These two are ours: taller than the desktop row, in the
 * game's skin, bound to the same actions, with the pip the native menu button could never
 * carry. The central action stays native, it is already the biggest thing on the screen.
 */
const PadControls = () => {
  if (!hud()) return null
  const a = nextAction()
  /*
    L'arc du client, reproduit a partir de sa propre geometrie.

    Le HUD de Decentraland ne range pas ses commandes en ligne: `joypad_arc.gd` place les
    satellites sur un arc polaire autour du gros bouton ancre dans le coin, le PREMIER tangent
    au bord du bas, le DERNIER tangent au bord droit, les autres repartis entre les deux. Ses
    valeurs: bouton central 156, satellite 80, orbite 167, ce qui redonne exactement les
    decalages codes en dur dans sa scene. On garde ces proportions a notre echelle, et la
    capture d'un vrai telephone (proprietaire, 1 Sep) montre bien cette forme: main en bas a
    gauche, puis E, puis F, puis le "+" droit au-dessus.

    Ce qu'on change sciemment: chez eux le gros bouton est le SAUT, chez nous c'est le verb
    contextuel, parce que c'est lui qu'on presse toutes les dix secondes. Le saut prend la
    premiere place de l'arc, celle du bas, la plus proche du pouce au repos.

    The same pad on a desktop. It was a row of three pills with key letters, and the two
    screens read as two games (owner, 4 Sep: "our mobile HUD is right, make the desktop
    match it"). Same discs, same arc, same icons; drawn one and a half times larger because
    the desktop canvas is 1080 high against the phone's 720, and each disc carries the key
    that does the same thing, on a small plate, since a mouse hand reads keys.
  */
  const k = phone() ? 1 : DESKTOP_PAD_SCALE
  const pad = arcPour(k)
  /*
    On a desktop the shot also goes out on the left mouse button (see `gachette` in combat.ts),
    so the disc has to answer to that too or the player firing with the mouse sees a button that
    never moves. Only while aiming, and only off a phone: `IA_POINTER` is the tap everywhere
    else, and it would light the disc on every press in the interface.
  */
  const tirDesktop = combatView.aiming && !phone()
    ? [InputAction.IA_PRIMARY, InputAction.IA_POINTER]
    : undefined
  // One switch for the five key plates (SPACE, F, 1, E, E): they were hidden for the video
  // shoot of 6 Sep and put back the same night. Desktop only; a phone never shows them.
  const TOUCHES_VISIBLES = true
  const touche = (t: string): string | undefined => (phone() || !TOUCHES_VISIBLES ? undefined : t)
  return (
    <UiEntity
      uiTransform={{
        width: pad.boite, height: pad.boite, positionType: 'absolute',
        /*
          Where the client puts its own pad, not where the client says its pad is. The
          interactable area it reports reserves the whole native control strip, and adding
          our margin to that pushed the arc a full button left of where the thumb rests.
          The native controls are hidden here, so the strip is ours to stand in.
        */
        position: phone() ? { bottom: THUMB.bottom, right: THUMB.right } : { bottom: DESKTOP_PAD_BOTTOM, right: DESKTOP_PAD_RIGHT }
      }}
    >
      {/*
        Beside the arc on a phone, above it on a desktop.

        Above the arc it shared the right edge with the corner column, which grows DOWN from
        the top (tutorial chip, rush, free box, raid, cloak: up to 376 units) while the pad
        stack grows UP (50 + 308 + 12 + 80 = 450). The two do not fit in a 720-high canvas,
        and on a tester's screen the free-box timer sat on the SELL button (9 Sep, measured:
        timer plate down to 259 units from the top, SELL plate from 259). The desktop canvas
        is 1080 high and the same sum leaves room, so nothing moves there.

        On a phone the chip stands LEFT of the pad's box, its bottom on the top satellite's
        bottom (196 up): its top is 394 units from the top of a 720 canvas, 18 clear of the
        column at its fullest, 37 on the tester's taller canvas; 95 units separate its right
        edge from the holster disc, and the sale stays out of the firing thumb's path.
      */}
      <UiEntity uiTransform={{
        positionType: 'absolute', flexDirection: 'row',
        position: phone() ? { bottom: pad.arc[2].bas, right: pad.boite + 12 } : { bottom: pad.boite + 12, right: 0 }
      }}>
        <SellChip />
      </UiEntity>

      <Pouce icone={volView.descend ? 'icon-glide' : 'icon-jump'} taille={pad.petit}
        bas={pad.arc[0].bas} droite={pad.arc[0].droite} actions={[InputAction.IA_JUMP]} touche={touche('SPACE')} />
      {/*
        Two different controls on one disc. Weapon away: the disc EMITS the secondary action,
        and combat draws on it, gated on the world being open. Weapon out: the disc calls the
        holster DIRECTLY and emits nothing, so putting the weapon away depends on no gate and
        on no input reaching the scene (players stuck aiming, playtest of 6 Sep). The F plate
        lights it in both states.
      */}
      <Pouce icone={combatView.aiming ? 'icon-holster' : iconeArme(combatView.arme)} taille={pad.petit}
        bas={pad.arc[1].bas} droite={pad.arc[1].droite}
        primaire={combatView.aiming}
        actions={combatView.aiming ? undefined : [InputAction.IA_SECONDARY]}
        onClick={combatView.aiming ? holster : undefined}
        presseePar={[InputAction.IA_SECONDARY]} touche={touche('F')} />
      {/*
        One pip, on the rim. The alert glyph carried a second, smaller dot inside the
        icon, and two red dots on one button read as a mistake (mobile tester, 3 Sep).
      */}
      <Pouce icone="icon-menu" taille={pad.petit}
        bas={pad.arc[2].bas} droite={pad.arc[2].droite}
        badge={questsToClaim() > 0} onClick={basculerMenu} touche={touche('1')}
        presseePar={[InputAction.IA_ACTION_3]} />
      {/*
        The central disc is always there. It used to be drawn only while a verb was
        available, so a player standing in the middle of the map saw a pad with a hole in
        it and asked where the button went (mobile tester's screenshot, 3 Sep). With nothing
        to do here it stays, dimmed and inert, showing the verb the current step waits for:
        what the thumb will press once the beacon is reached.
      */}
      {a !== null ? (
        <Pouce icone={combatView.aiming ? ico('fire') : (a.icon ?? ico('place'))} taille={pad.gros}
          bas={0} droite={0} primaire actions={[InputAction.IA_PRIMARY]}
          presseePar={tirDesktop}
          frames={!combatView.aiming && peutConstruireIci(a) ? posesDe(a.icon) : undefined}
          pulse={!combatView.aiming && stepExpects(a.id) && peutConstruireIci(a)}
          periodMs={cadenceDe(a.id)} touche={touche('E')} />
      ) : (
        <Pouce icone={combatView.aiming ? ico('fire') : ico(stepVerb())} taille={pad.gros}
          bas={0} droite={0} primaire disabled={!combatView.aiming}
          actions={combatView.aiming ? [InputAction.IA_PRIMARY] : undefined}
          presseePar={tirDesktop} touche={touche('E')} />
      )}
    </UiEntity>
  )
}

/*
  The pad's numbers live in layout.ts as THUMB, measured on the client's own pad. The arc
  below only decides where the three satellites go on that orbit.
*/
// 800 was noise on the board (owner, 3 Sep); a beat and a fifth is the first value that was not.
const SWING_MS = 1200
/*
  SMASH bat plus vite que BUILD, et ce n'est pas une preference.

  Les deux verbes ne demandent pas le meme geste. Batir est un acte UNIQUE: le balancement y
  est une invitation, il peut prendre son temps et 1200 ms a ete regle pour ne pas faire du
  bruit sur le plateau. Casser une boite demande TROIS coups d'affilee, donc le bouton doit
  donner le tempo de ce qu'on attend du pouce; a la cadence de BUILD il traine derriere le
  joueur au lieu de l'entrainer (proprietaire, 7 Sep). Le mouvement lui-meme ne change pas, il
  occupe toujours les 300 dernieres millisecondes de la periode: c'est le REPOS entre deux
  frappes qui raccourcit.
*/
const SWING_SMASH_MS = 750
function cadenceDe(id: string | undefined): number { return id === 'smash' ? SWING_SMASH_MS : SWING_MS }

/** The desktop canvas is 1080 high against the phone's 720: the same pad, drawn at that ratio. */
const DESKTOP_PAD_SCALE = 1.5
// For the video shoot of 6 Sep the desktop pad briefly sat at the phone's proportion
// (`THUMB.right * DESKTOP_PAD_SCALE`, 170 and 75); it is back in its corner. The phone's
// own anchor lives in layout.ts and was never touched.
const DESKTOP_PAD_BOTTOM = 40
const DESKTOP_PAD_RIGHT = 40

/** Les trois places de l'arc, du bord du bas au bord droit, comme `joypad_arc.gd` les calcule, a l'echelle `k`. */
function arcPour(k: number): { gros: number; petit: number; arc: Array<{ droite: number; bas: number }>; boite: number } {
  const gros = Math.round(THUMB.big * k)
  const petit = Math.round(THUMB.small * k)
  const orbite = THUMB.orbit * k
  const pr = gros / 2
  const sr = petit / 2
  const bord = pr - sr
  const portee = Math.sqrt(Math.max(orbite * orbite - bord * bord, 0))
  const debut = Math.atan2(bord, -portee)
  let fin = Math.atan2(-portee, bord)
  if (fin < debut) fin += Math.PI * 2
  const pas = (fin - debut) / 2
  const arc: Array<{ droite: number; bas: number }> = []
  for (let i = 0; i < 3; i++) {
    const t = debut + pas * i
    arc.push({
      droite: Math.round(pr - orbite * Math.cos(t) - sr),
      bas: Math.round(pr - orbite * Math.sin(t) - sr)
    })
  }
  const boite = gros + Math.max(...arc.map((p) => Math.max(p.droite, p.bas)))
  return { gros, petit, arc, boite }
}

/** A handset, or the desktop preview asked to measure like one. */
function phone(): boolean { return isMobile() || FORCE_MOBILE_LAYOUT }

/*
  The top-right column sits against the edge on a phone. That corner is empty there (the
  client's four icons are top LEFT on a handset, see COIN_HAUT_DROIT), and a column held
  96 px in from the edge read as misplaced next to the flush native controls (mobile
  tester, 3 Sep). The desktop keeps the margin for the client's two corner icons.
*/
/**
 * Ce que la colonne de droite laisse au bord, demande au CLIENT plutot que decide ici.
 *
 * La valeur etait ecrite a la main, 96 sur desktop et 20 sur telephone, tirees d'une
 * photographie. Or le client PUBLIE ce qu'il se reserve, dans `interactableArea` de
 * `UiCanvasInformation`, et `clientEdges()` le lit deja pour d'autres calculs. Une constante
 * ne peut pas suivre un HUD qui change avec l'etat du client, alors que cette valeur, si.
 *
 * Le plancher reste, pour deux raisons: un client qui ne publie rien renvoie zero, et une
 * plaque collee au pixel du bord se lit mal meme quand rien ne la gene.
 */
const MARGE_BORD_MIN = 18
/*
  ON A PHONE THE COLUMN IGNORES THE CLIENT'S RIGHT BAND, exactly as the pad already does.

  What `interactableArea.right` reports on a handset is the strip the client keeps for its
  own action pad. That pad is hidden here (locomotion.ts, `TouchScreenControls.hide`) and ours
  stands in its place, which is why the pad's own anchor deliberately never adds this value
  (see the comment on its `position`). The column kept adding it, so on every tester's phone
  its right edge landed on the pad's right edge, a full pad width in from the corner, and the
  band above the pad stood empty (three testers, 9 Sep). Nothing of the client's lives in the
  top-right corner of a handset: its four icons are top LEFT there. The 3 Sep rule above
  stands, flush to the canvas edge, and the desktop keeps the client's value for the two icons
  it does draw in that corner.
*/
function rightCornerMargin(): number {
  if (phone()) return MARGE_BORD_MIN
  return Math.max(MARGE_BORD_MIN, Math.round(clientEdges().right))
}

const PANNEAU = C.plate
const BTN_H = TAP.height
const BTN_GAP = TAP.gap

/**
 * Announcement backdrop, tinted by the crate. A fixed dark brown made every tier look the
 * same; a wash of the crate's own colour lets the eye read the tier before the words.
 */
function announceBackdrop(): Color4 {
  const c = Color4.fromHexString(beltView.annonceColor + 'ff')
  return Color4.create(c.r * 0.22, c.g * 0.22, c.b * 0.22, 0.9)
}

/**
 * The one thing worth tapping right now, or nothing at all.
 *
 * It used to hand back a label with a `ready` flag, so a state the player cannot act on
 * still arrived as a button: "OPEN AT YOUR BASE", "WAIT 10s". A control that does nothing
 * when pressed is worse than an absent one, and the reference games put those states in
 * the world or in a line of text instead. What cannot be tapped now goes to `hint`.
 */
function nextAction(): { id: string; label: string; action: () => void; icon?: string } | null {
  const choix = choisirAction()
  verb.id = choix?.id ?? ''
  return choix
}

function choisirAction(): { id: string; label: string; action: () => void; icon?: string } | null {
  /*
    Almost everything here carries a picture, and the two exceptions are on purpose.

    The rule was written when COLLECT got its coins and then applied to nothing else, which
    left seven of eight actions still announcing themselves on a plate above the controls. A
    plate is furniture; a button that already exists is free. So building, recovering and
    opening take their own shapes, and only the carrying verbs keep words, because PUT IT
    DOWN, GIVE IT and DROP differ by where you are standing rather than by what you are doing,
    and three variations on an arrow at the size of a thumb would blur exactly the distinction
    that matters. They are also the shortest-lived state in the game, which is the one moment
    a word is worth its room.
  */
  if (slotView.active) {
    if (slotView.valid) return { id: 'poser-base', label: 'PLACE HERE', icon: ico('build'), action: placeHere }
    /*
      Marqueur demande a la main et endroit refuse: le bouton reste vide, le rectangle rouge et
      son motif disent deja tout. Marqueur allume tout seul et endroit refuse: on ne bloque
      rien, la suite de la liste decide, sinon un joueur qui apparait sur le couloir du tapis
      se retrouverait sans aucun bouton pour sa toute premiere seconde de jeu (2 Sep).
    */
    if (!slotView.auto) return null
  }
  // A crate on the floor in front of you is smashed with the same button as everything else,
  // not only by clicking the crate itself: on a phone the click is a hunt, the button is a thumb.
  // And while that crate is in flight, result, reel or landing, the button offers nothing at
  // all: a fourth press in a rhythm used to open a second crate under the first one's reel.
  /*
    Le maillet SUR une boite, et pas la meme image que batir.

    Premier defaut (6 Sep): le disque portait `ico('crate')` avant la pression et apres, donc
    sur telephone, ou il ne dessine aucun libelle, appuyer sur OPEN ne changeait rien du tout.
    Un testeur a cru avoir POSE quelque chose et s'est eloigne; la caisse est repartie dans son
    stock et il a recommence. Le maillet a corrige ca.

    Deuxieme defaut, celui-ci (7 Sep): le maillet nu est deja BUILD. Deux verbes, une seule
    image, c'est l'interface qui ne dit rien. L'outil reste le meme parce que c'est le meme
    outil, et jeter ce que le joueur a deja appris serait absurde; ce qui change entre les deux
    verbes est l'OBJET, donc c'est l'objet que le dessin ajoute. C'est aussi ainsi que le genre
    dessine "ouvre ca": le contenant plus ce qui le frappe, jamais l'outil seul.
  */
  if (boxView.phase === 'smash') return { id: 'smash', label: 'SMASH', icon: ico('smash'), action: frapper }
  if (boxView.phase !== 'idle') return null
  /*
    At the lock post with the lock ready, the thumb takes it, so a phone never has to aim a
    tap at the post. Ahead of the carrying verbs: the post's reach is a two-metre corner, and
    a player who ran there with full hands during a raid came to seal the door, not to shelve.
    It sat INSIDE the full-hands branch by mistake, so it only ever showed while carrying
    (owner, 4 Sep: "the button does not become the activation when I am at the post").
  */
  if (lockPostInReach()) return { id: 'verrouiller', label: 'LOCK BASE', icon: ico('lock'), action: lockBase }
  /*
    Hands first, because full hands are the loudest fact about your situation.

    Where you are standing is what the verb turns out to be. Inside your own building it is
    putting something on a shelf; inside somebody else's it is a gift, which used to be a
    click on a plinth that no player ever found; anywhere else it is letting go, and it goes
    back where it came from.

    All three carry a picture, which they did not at first: they were left as words on the
    grounds that three arrows would blur, and that dropping an item by mistake is expensive.
    The worry was right and the conclusion wrong. What separates them is the DIRECTION plus
    whether anything waits underneath, two independent differences rather than one, and a
    picture on the button beats a plate on the screen every time.
  */
  if (carryView.code >= 0) {
    // A toy in hand at the fuser feeds the machine; that beats putting it on a shelf.
    if (fuserInReach()) return { id: 'fuser-nourrir', label: 'FEED THE FUSER', icon: ico('fuse'), action: agirSurFuser }
    // An elevator in reach beats putting the thing down: a loaded player could never ride it,
    // and stepping one pace away to put something down costs nothing (mobile tester, 3 Sep).
    if (elevatorInReach()) return { id: 'monter', label: 'GO UP', icon: ico('up'), action: monterIci }
    const ou = baseIci()
    if (ou === null) return { id: 'lacher', label: 'DROP', icon: ico('drop'), action: dropCarried }
    return ou.mienne
      ? { id: 'poser-objet', label: 'PUT IT DOWN', icon: ico('place'), action: () => placeDown(ou.ownerId) }
      : { id: 'poser-objet', label: 'GIVE IT', icon: ico('give'), action: () => placeDown(ou.ownerId) }
  }
  if (theftView.canRecover) return { id: 'recuperer', label: 'RECOVER', icon: ico('recover'), action: recover }
  /*
    Setting a trap is a two-tap act, like placing the base: the first shows where, the second
    commits. It sits below the carry verbs because the genre forbids gear while carrying, and
    above building because a pocket with a trap in it is a state the player created on purpose
    a moment ago, which is exactly what this button is for.
  */
  if (gearView.placing >= 0) return { id: 'poser-piege', label: `SET ${GEARS[gearView.placing].name} HERE`, icon: ico('build'), action: placeTrap }
  if (!theftView.basePosee) return { id: 'construire-base', label: 'BUILD BASE', icon: ico('build'), action: togglePlacing }
  /*
    What the place offers, so the phone needs no interaction button at all.

    Every one of these was a click on a thing in the world, which on a handset is a hunt for
    a small pointer button and then a small target. The genre's mobile answer is the
    proximity prompt: stand at the thing and one button does it. So standing at the belt
    offers the nearest crate, by name and price; beside a convoy, the outbid; at the fuser,
    the fuser; near your own elevator, the climb; facing a shelf, the toy on it. The desktop
    keeps its clicks as well. Ordered by how deliberate the standing is: a belt or a convoy
    you walked to, an elevator you spam, a shelf you happen to face.
  */
  const caisse = crateInReach()
  if (caisse !== null) {
    return { id: 'acheter-caisse', label: `BUY ${crate(caisse.crateTier).name.toUpperCase()}  ${formatIncome(caisse.price)}`, icon: ico('buy'), action: () => buyCrate(caisse.articleId) }
  }
  const convoi = convoyInReach()
  if (convoi !== null && !convoi.mine) return { id: 'surencherir', label: `OUTBID  ${formatIncome(convoi.price)}`, icon: ico('outbid'), action: () => surencherir(convoi.convoyId) }
  if (fuserInReach()) return { id: 'fuser', label: 'FUSER', icon: ico('fuse'), action: agirSurFuser }
  if (elevatorInReach()) return { id: 'monter', label: 'GO UP', icon: ico('up'), action: monterIci }
  const pad = padEnFace()
  if (pad !== null && !pad.mine) return { id: 'voler', label: `STEAL ${pad.nom}`, icon: ico('steal'), action: () => agirSurPad(pad) }
  /*
    Se planter devant son propre socle passe avant l'offre d'ouvrir une caisse.

    L'ordre etait l'inverse, et une caisse en stock est un etat PERMANENT: des qu'on en avait
    une, le bouton disait OPEN partout dans sa base et "PICK UP" ne pouvait plus jamais sortir
    (proprietaire, 1 Sep). Se tenir face a un socle precis est un acte delibere, il gagne.
  */
  if (pad !== null && pad.mine) return { id: 'ramasser', label: `PICK UP ${pad.nom}`, icon: ico('pickup'), action: () => agirSurPad(pad) }
  if (boxView.stock.length > 0 && peutOuvrirIci()) {
    return { id: 'ouvrir-caisse', label: `OPEN ${boxView.stock.length}`, icon: ico('crate'), action: openBestCrate }
  }
  /*
    No purchase past this point, and that is the whole rule.

    A floor, a defence tier and a prestige used to be offered here. They are not the same
    kind of thing as the actions above: opening a crate is caused by standing next to one and
    stops being available the moment it is done, while being able to afford a floor is a
    condition that stays true until the money is spent. So the button locked onto the
    purchase and everything else vanished behind it for as long as the player could pay.
    The contextual action carries what the place and the last few seconds caused; the three
    purchases live in the shop tab, which is a room you go to.
  */
  /*
    Encaisser, et c'est l'etat de base du bouton.

    Ce verbe a ete retire le 7 Sep puis remis le meme jour, par decision du proprietaire apres
    que je lui aie expose les trois defauts mesures qu'il ramene. Ce qui l'avait fait retirer:
    aucun testeur ne le trouvait, le plafond de dix minutes arretait la production en silence,
    et l'incitation etait inversee (un tir prend dans le SOLDE, jamais dans la cagnotte, donc
    ne pas encaisser etait le geste sur). Ce qui l'a fait revenir: sans lui, le bouton le plus
    atteignable du telephone n'a plus rien a offrir la majorite du temps, et un bouton
    desactive muet est un defaut plus visible qu'une incitation mal orientee.

    Il reste EN DERNIER dans la chaine, ce qui est sa place: la cagnotte est presque toujours
    pleine de quelque chose, donc plus haut il cacherait tous les autres verbes derriere lui.

    Deux choses changent avec son retour, et elles repondent au defaut qui l'avait condamne.
    Le bouton porte le MONTANT, donc il ne dit plus seulement "encaisse", il dit combien: un
    signifiant chiffre a la place d'un verbe nu. Et la cagnotte est lisible en permanence sous
    le compteur, donc elle cesse d'etre un nombre que seul le serveur connaissait.
  */
  if (theftView.pending >= 1) {
    return {
      id: 'encaisser',
      label: `COLLECT ${formatIncome(theftView.pending)}`,
      icon: ico('collect'),
      action: collectPending
    }
  }
  return null
}

/** What the player is waiting on, in one line, never as a control. */
/**
 * A dialog owns the screen.
 *
 * The heads-up display used to keep drawing under the welcome panel, so the title was
 * crossed by the tutorial line and START sat next to BUILD BASE and DRAW. The condition
 * existed on some blocks and not others, added one at a time. It lives here now, and
 * every block reads the same function.
 */
/**
 * The wait, as a bar rather than a sentence.
 *
 * The scene's server only runs while somebody is inside it, so the first visitor to an
 * empty venue waits on a cold start, documented at about fifteen seconds. A word for that
 * wait is not enough: a line of static text is exactly what a broken game also shows, and
 * the player cannot tell the two apart. Something that visibly advances can only mean work
 * is happening, and where the duration is roughly known a bar beats a spinner, because it
 * answers "how much longer" instead of only "is it alive".
 *
 * It fills fast and then slows, and it stops short of the end. The curve is honest about
 * what we know: the fifteen seconds is a documented figure, not a measurement of our own
 * server, so a bar that marched to the end on a timer would be inventing a certainty we do
 * not have, and would sit full and lying whenever the wait ran long. This one reaches
 * about seven eighths at fifteen seconds and never quite arrives. The last part of the
 * journey belongs to the heartbeat: the bar disappears because the server answered, which
 * is the only thing that was ever worth reporting.
 */
/** True once the wait has outrun the fifteen seconds the platform documents for a cold start. */
function attenteLongue(): boolean {
  return view.waitingSince !== 0 && Date.now() - view.waitingSince > 25_000
}

const WaitBar = () => {
  const attente = view.waitingSince === 0 ? 0 : Date.now() - view.waitingSince
  const part = 0.9 * (1 - Math.exp(-attente / 5000))
  return (
    <Barre pct={Math.round(part * 100)} hauteur={6} couleur={C.bonus} />
  )
}

/** A panel that takes the whole screen: nothing of the game draws behind it, not even tabs. */
function modale(): boolean {
  return welcomeView.open || prestigeView.open || fuserPanelView.open
}

/**
 * Whether the running game's own display is allowed on screen.
 *
 * This is the distinction the interface was missing, and it is why an opened menu came out
 * looking like a collision: `modale()` knew about the welcome screen and the prestige
 * dialog, and nothing else. The objectives window is neither, so the money counter, the
 * tutorial step and the crowd bonus kept drawing straight over it, and the tab row landed
 * across the middle of its own panel.
 *
 * A window is open or it is not. When one is, the game's readouts have nothing to say that
 * cannot wait, and they go away. Only the window and the controls that steer it remain.
 */
function hud(): boolean {
  return !modale() && !menuView.open
}

/**
 * The one line above the controls, or nothing at all.
 *
 * Kept short on purpose: it is read out of the corner of the eye, and a sentence read that
 * way is a sentence not read. What the weapon button means is no longer in here, because it
 * is drawn on the weapon button.
 */
function barre(): string {
  if (combatView.aiming) {
    /*
      The reticle names the target at the crosshair and the weapon button wears the sight, so
      a line down here saying "FIRE on X" said it a third time (tester, 28 Aug: noise). The
      first-timer's nudge ("aim at someone") went the same way: the drawn gun and the sight
      already say it (owner, 5 Sep).
    */
    return ''
  }
  if (intentEnAttente()) return 'queued, the game is still starting up'
  /*
    Below here it is captioning the client's own buttons, which only a phone has. A desktop
    draws its own controls with their names on them, so a plate repeating those names is
    furniture. And on a phone, an action that put a picture on the button has already said
    itself.
  */
  if (!phone()) return ''
  const a = nextAction()
  if (a === null || a.icon !== undefined) return ''
  return `E   ${a.label}`
}

/**
 * The one ambient line, and the test every candidate for it has to pass.
 *
 * Two questions decide whether something belongs here. Is it time-critical, meaning it
 * changes on its own and the player loses something by not seeing it? And is it unavailable
 * anywhere else? A line that fails either is furniture, because permanent screen on a phone
 * is paid for out of the game.
 *
 * Two were removed on those grounds. "next floor at X" and "prestige at X" are prices that do
 * not move and now sit in the shop tab, where the player goes precisely to compare them.
 * A third, "place your base first", was a whole plate of its own saying what the tutorial says
 * in the top right corner and what the action button says under their thumb, with an icon, at
 * that very moment: the same instruction three times over, which is worse than not saying it.
 */
/**
 * La cagnotte est-elle a son plafond, c'est a dire la production arretee.
 *
 * Le plafond est un multiple du TAUX, donc il monte avec la base: on le recalcule ici plutot
 * que de faire voyager un second nombre que le client n'aurait aucun moyen de verifier. La
 * marge de un pour cent absorbe le decalage entre la derniere poussee du serveur et l'image
 * en cours, sinon le mot FULL clignoterait a chaque seconde entiere.
 */
function cagnottePleine(): boolean {
  const plafond = theftView.income * PENDING_CAP_S
  return plafond > 0 && theftView.pending >= plafond * 0.99
}

function hint(): string {
  if (slotView.active && !slotView.valid) return slotView.reason
  // Une production arretee est la chose la plus actionnable qui soit, et l'ancienne version
  // ne la disait nulle part: c'est ce silence qui l'a fait retirer, pas la borne elle-meme.
  if (cagnottePleine()) return 'your pot is full, collect it'
  // Actionable: it says go home, and the crates are not doing anything until you do.
  if (boxView.stock.length > 0 && !peutOuvrirIci()) {
    return `${boxView.stock.length} box${boxView.stock.length > 1 ? 'es' : ''} waiting at your base`
  }
  // Time-critical, and said from the owner's side: what they own here is a protection, and
  // "base locked" describes the mechanism while reading like a fault on your own screen.
  if (theftView.lockSec > 0) return `your base is shielded for ${theftView.lockSec}s`
  if (theftView.rechargeSec > 0) return `shield ready in ${theftView.rechargeSec}s`
  return ''
}

/**
 * The reticle, on screen only while the player is aiming. It is drawn from the same cone
 * the server rules with, so it is allowed to claim a lock: red and named means the shot
 * lands, and the player learns the weapon's reach by watching it rather than by reading it.
 */
function Crosshair() {
  const locked = combatView.targetName !== ''
  const cold = combatView.cooldown > 0
  // Our fifty percent is the middle of the safe area, not the middle of the glass, and the
  // shot goes to the middle of the glass. This is the difference.
  const c = decalageCentre()

  /*
    The reticle says how much this shot is worth, and nothing new appears on screen to say it.

    A hit weakens with the square of the distance, which is the rule the whole chase now turns
    on, and a rule the player has to feel rather than be told. The place they are already
    looking while they aim is the sight itself, and a sight that opens up as the shot gets
    weaker is the one convention every shooter has taught them. So the four arms spread as the
    target gets further, and the colour drains with them: tight and red means this shot takes
    their loot, wide and pale means they are walking away with it.

    Nothing is added. The reticle was already on screen, and it was already saying nothing
    about the only thing it needed to say.
  */
  const force = locked ? forceDuTir(combatView.targetDist) : 1
  /*
    The kick and the marker, the two heartbeats every mobile shooter gives its sight. The
    arms jump outward for 120 ms after each round leaves; four gold points flash on the
    diagonals for 160 ms when a round LANDS. Both read from timestamps the combat layer
    stamps, so the reticle stays a pure function of state.
  */
  const now = Date.now()
  const kick = Math.max(0, 1 - (now - combatView.lastShotAt) / 120)
  const touche = now - combatView.lastHitAt < 160
  const gap = Math.round(8 + (1 - force) * 22 + kick * 7)
  const len = 12
  const th = 2
  const col = cold
    ? Color4.create(1, 1, 1, 0.22)
    : locked
      ? Color4.create(1, 0.36 + (1 - force) * 0.5, 0.36 + (1 - force) * 0.5, 0.35 + force * 0.65)
      : Color4.create(1, 1, 1, 0.7)

  const bar = (left: number, top: number, w: number, h: number, key: string) => (
    <UiEntity key={key}
      uiTransform={{
        width: w, height: h, positionType: 'absolute',
        position: { top: '50%', left: '50%' }, margin: { left: left + c.x, top: top + c.y }
      }}
      uiBackground={{ color: col }} />
  )

  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute' }}>
      {touche && [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([dx, dy], i) => (
        <UiEntity key={'hm' + i}
          uiTransform={{
            width: 7, height: 7, positionType: 'absolute',
            position: { left: `${50 + dx * 2.2}%`, top: `${50 + dy * 3.4}%` }
          }}
          uiBackground={{ color: Color4.fromHexString('#ffd166ff') }} />
      ))}
      {bar(-th / 2, -(gap + len), th, len, 'up')}
      {bar(-th / 2, gap, th, len, 'down')}
      {bar(-(gap + len), -th / 2, len, th, 'left')}
      {bar(gap, -th / 2, len, th, 'right')}
      {/*
        No name and no range under the reticle.

        The lock is already said by the reticle itself, which turns red and tightens with the
        shot's strength, and the target wears their own nameplate in the world. A third copy
        printed over the middle of the screen was words where the picture had already spoken
        (owner, 6 Sep). `combatView.targetName` stays: it is what tells the reticle it is locked.
      */}
    </UiEntity>
  )
}

/**
 * The reel: a strip of cards that decelerates onto the one you won.
 *
 * What the genre's openings share, from CS:GO's case to a mobile chest, is the delay: the
 * reveal is a drumroll, the outcome is decided before it starts, and every second of the
 * slowdown is the product. So the strip is wide (as much of the screen as the client leaves,
 * up to eight cards), the cards carry the toy itself rather than a name and a box, the run
 * grows with the rarity, a tick marks every card crossing the line, and the landing is a
 * flash in the winner's colour with the winning card popping while the rest go dim. The result
 * line sits inside the same panel, so the whole moment fits above the controls on a phone.
 *
 * Width is deliberately NOT `strip()`: that helper keeps clear of the client's furniture for
 * the full height of the screen, and this panel sits in a band (250 to 506 from the bottom)
 * where neither the joystick nor the action buttons are. Eighty pixels of margin, and a cap.
 */
function easeOutBack(t: number): number {
  const c1 = 1.70158, c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/**
 * The reveal, centre stage. The reel below is the drumroll; THIS is the product, the way
 * the genre's lootboxes and idle games spend their whole screen on the moment: the room
 * dims, the won piece bursts huge over a fan of rays, name and yield under it, and the
 * whole thing melts away on the same clock as the panel. It blocks nothing: no handler,
 * so taps fall through to the game.
 */
/*
  The reveal, built on what the juice literature actually measures: Jonasson and Purho's
  "Juice it or lose it" (GDC 2012) and Nijman's "The Art of Screenshake" (2013) both put
  ANTICIPATION before the payoff (a beat where the winning card burns alone, then the hero
  pops), ESCALATION with the stakes (a Mythic hits harder than a Common: bigger glyph, wider
  burst, a full-screen flash from Epic up), and LAYERED ARRIVALS (glyph, then name, then the
  income line, each with its own overshoot) over one flat card of information. This client
  draws no particles and no bloom, so the juice is timing, scale, colour and the sounds that
  already climb with rarity (owner, 5 Sep: "notre etape la plus juicy, et je la trouve fade").
*/
/*
  L'ACTE DE LA CAISSE: une seule ligne de temps, du tambour au trophee.

  C'etaient deux composants qui se chevauchaient, chacun avec sa propre horloge: la bande
  redimensionnait sa carte gagnante (donc toute la rangee se replacait a l'arrivee, ce qui
  lisait comme des cartes en retard), un eclair plein ecran passait pour un bug, et la carte
  gagnante etait videe de son texte pendant que le heros arrivait, ce qui laissait une plaque
  noire vide (proprietaire, 5 Sep). Un moment ne se fabrique pas a deux horloges.

  La litterature dit trois choses de ce moment. Jonasson et Purho (GDC 2012) et Nijman (2013):
  anticipation, puis paiement, et l'escalade avec l'enjeu. Le design mobile de la plateforme
  (docs, UI best practices): ce qui demande a etre lu se joue au CENTRE, et rien ne doit
  bouger sous le doigt. Le genre lui-meme (les tambours de caisses): la bande DECELERE sur la
  carte, un tic par carte, la carte s'illumine, puis la bande s'efface et laisse la place.

  Donc, une horloge unique (`gagneA`, l'instant ou la bande s'arrete) et quatre temps:
    pendant le tour   la bande defile, decelere en quartique, un tic par carte, fond assombri
    a l'arret        la carte gagnante prend un liseré de sa couleur et un pop, sur place
    apres la montee  la bande se dissout (200 ms) pendant que le heros grandit derriere
    le heros         eclat, glyphe, puis le nom, puis le rendement, chacun avec son rebond

  Aucune carte ne change de taille dans la bande: le pop du gagnant est une COPIE posee par
  dessus, donc la rangee ne se replace jamais. Aucun eclair: un eclat radial derriere le
  glyphe, qui est ce que le joueur regarde.
*/
const REEL_FADE_MS = 200
const REVEAL_CLOSE_MS = 260

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v }

/** One card of the strip, at a fixed size: the strip never reflows. */
const CarteReel = (props: { key?: number; rarete: number; x: number; haut: number; opacite: number; mutId?: number; taille?: number; devoile?: boolean }) => {
  const rar = RARITIES[props.rarete] ?? RARITIES[0]
  const mut = mutation(props.mutId ?? 0)
  const brut = Color4.fromHexString(rar.color + 'ff')
  const mute = (props.mutId ?? 0) > 0 && mut.mult > 1
  const k = (props.taille ?? REEL_W) / REEL_W
  return (
    <UiEntity
      uiTransform={{
        width: REEL_W * k, height: REEL_H * k, positionType: 'absolute',
        position: { left: props.x, top: props.haut },
        /*
          The piece is CENTRED IN ITS OWN AIR, and the two lines under it are one block.

          The piece sat 8 from the top and 12 from the pill, so it read as pushed up (owner,
          5 Sep). Equalising all four gaps at 9 fixed the arithmetic and not the complaint: it
          brought the pill UP instead of bringing the piece DOWN. Here the piece gets 12 above
          and 12 below, which is what the eye was asking for, and the pill and the yield close
          up to 6 because they belong together: proximity is what says "these two describe the
          picture" rather than "these are three separate rows". 12 + 172 + 12 + 26 + 6 + 30 + 6
          is 264 exactly, so nothing is left to a stretch rule.
        */
        flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'center',
        padding: { top: 12 * k, bottom: 6 * k, left: 8 * k, right: 8 * k },
        opacity: props.opacite
      }}
      uiBackground={{ ...SKIN.card, color: Color4.create(0.55 + 0.45 * brut.r, 0.55 + 0.45 * brut.g, 0.55 + 0.45 * brut.b, 1) }}
    >
      {/*
        The rung is a BLOCK OF ITS OWN COLOUR, and the word only confirms it.

        Two things were wrong with the line it replaces. It was a platform Label at `caption`,
        21 units, the size theme.ts itself calls the floor under which text stops being
        readable. And it carried the identification on its own, in a colour, on a plate that
        is nearly the same dark navy for every rung: measured on `card.png` tinted by each
        rarity, the two closest plates are 9 units apart in RGB, so the strip read as seven
        identical cards (owner, 5 Sep, comparing the two mock-ups). Multiplying harder does not
        help, a tint can only darken: at any weight the plates stay within 18 units of each
        other.

        So the colour moves to a chip of the FULL rarity, which is the only way to get a real
        block of colour on a dark plate, and the word shrinks: "personne ne lit ca, tout le
        monde veut reconnaitre la couleur et la rarete en un clin d'oeil" (owner, 5 Sep).
        Dark ink on the chip, measured on all seven rungs: 4.41 to 17.43 to one, above the 3:1
        the guidelines set for text this size and weight, where white would fall to 1.2 on the
        Legendary and the Secret.

        A PILL, not a header band, and at the FOOT of the card. Full width across the top it
        sat over the plate's own gloss, the highlight `card.png` carries from y 4 to y 40 of
        its 128, which the nine-slice draws at the top of every card: a solid block laid over
        a shine reads as a sticker, not as part of the object (owner, 5 Sep). It also took a
        fifth of the face from the piece, which is the thing being won.

        So the top of the card is left to the plate's own material, the piece opens the card
        at 172, and the two small facts sit under it: the rung's colour, then what it earns.

        Vertically: capitals occupy 0.211 to 0.742 of their cell, so their middle sits at
        0.4766 of the glyph size below the text box, which is what centres them in the chip.
      */}
      {/*
        Every rung shows the piece itself, rendered from the model it will be on the shelf.
        The Secret is the one the game never shows before you own it, so the strip draws the
        old star for it and the winner's card, which only appears once it IS yours, draws the
        planet (owner, 5 Sep).

        And the winner's card shows the piece it really won, mutation and all: `toy-<r>-<m>`
        is rendered from `item-<r>-<m>.glb` itself, so a Gold Secret is hammered gold and a
        Cursed Secret carries its runes. The spinning strip is rarity alone, because that is
        all the strip is choosing.
      */}
      <UiEntity uiTransform={{ width: 172 * k, height: 172 * k }}
        uiBackground={{
          texture: { src: `assets/ui/${toyImage(props.rarete, props.mutId, props.devoile === true)}.png` },
          textureMode: 'stretch'
        }} />
      <UiEntity
        uiTransform={{
          width: (glyphWidth(rar.name, 20) + 22) * k, height: 26 * k, borderRadius: 13 * k,
          margin: { top: 12 * k }, justifyContent: 'center', alignItems: 'center'
        }}
        uiBackground={{ color: brut }}
      >
        <Glyphs value={rar.name} size={20 * k} role="ink" align="center" box={(glyphWidth(rar.name, 20) + 22) * k}
          top={Math.round((26 * k) / 2 - 0.4766 * 20 * k)} />
      </UiEntity>
      <Label
        value={mute ? `${mut.name.toUpperCase()}  x${mut.mult}` : `+${formatIncome(INCOME_UI[props.rarete] ?? 1)}/s`}
        fontSize={24} textWrap="nowrap"
        color={mute ? Color4.fromHexString(lisible(mut.color) + 'ff') : C.money}
        uiTransform={{ width: '100%', height: 30 * k, margin: { top: 6 * k } }} textAlign="middle-center" />
    </UiEntity>
  )
}

function CrateReveal(): ReactEcs.JSX.Element {
  const now = Date.now()
  const rarete = Math.max(0, boxView.resultat)
  const tourne = boxView.roule
  const t = tourne ? -1 : now - boxView.gagneA          // ms since the strip stopped
  const hold = revealHold(rarete)
  const sortie = tourne ? 1 : clamp01((boxView.resultatJusqua - now) / REVEAL_CLOSE_MS)
  const gagneHex = itemColor(boxView.resultat, boxView.resultatMutation)
  const gagne = Color4.fromHexString(gagneHex + 'ff')
  const mut = mutation(boxView.resultatMutation)

  // The strip: present while it turns, dissolving once the hero takes over.
  /*
    The strip HANDS OVER to the piece, it is not cut.

    The winning card has its own pop and it is the best moment the strip has; it was fading out
    over 200 ms from the same instant the 3D piece started growing, so for a fraction of a
    second neither was really there and the eye read a cut (owner, 5 Sep). The card now holds
    while the piece grows and fades over the following 260, which is a cross fade: something is
    always on screen.
  */
  const REEL_HOLD_MS = 180
  const bandeVisible = !boxView.sansRoulette && (tourne || t < hold + REEL_HOLD_MS + REEL_FADE_MS)
  const bandeOpacite = tourne ? 1 : clamp01(1 - (t - hold - REEL_HOLD_MS) / REEL_FADE_MS) * sortie
  const large = Math.min(active.w - 80, 1700)
  const bande = REEL_H + 12
  const pop = tourne ? 0 : easeOutBack(clamp01(t / 160))

  // The hero: after the hold, the glyph, then the name, then the income.
  const heroVisible = !tourne && t >= hold
  const h = t - hold
  /*
    The backdrop is a NIGHT, not a tint.

    It was 34 % black while the strip ran, which on a bright field is a grey haze: the world
    stayed perfectly readable behind the one moment that is supposed to own the screen
    (owner, 7 Sep, screenshot). This is not a `Juice it or lose it` question, and I should not
    pretend it is: that talk is about squash, particles, shake and sound ON the object. The
    rule at work here is staging, the same one the 3D reveal already follows with its own
    veil at 78 %. The strip now sits on 66 %, and the hero deepens to 80 %.
  */
  const fond = tourne ? 0.66 : Math.min(0.80, 0.66 + 0.14 * clamp01(h / 180))
  const heroPop = easeOutBack(clamp01(h / 320))
  const nomPop = easeOutBack(clamp01((h - 120) / 260))
  const lignePop = easeOutBack(clamp01((h - 260) / 260))
  const echelle = Math.min(1.5, 1 + 0.10 * rarete)
  const icone = 290 * heroPop * echelle
  const rayon = (520 + 140 * heroPop) * echelle
  const eclat = Math.max(0, 1 - h / 900)
  /*
    The real toy is out there, so the veil gets a window and the picture stands down. The
    window is the hero box, a touch wider, and it only exists while the piece is really
    visible: a model still loading, or a camera whose front is outside the parcels, keeps
    the card and nobody sees a hole with nothing in it.
  */
  const objet3D = heroVisible && revealToyView.visible
  /*
    A darker room when the piece is real. The veil tops out at 0.62 for a drawn glyph, which
    is enough behind a picture and not behind a window: with the world showing through, the
    reveal read as bright and busy (owner, 5 Sep). At 0.86 the rest of the screen is nearly
    gone, which is what a reveal is for, and the piece has its own dark plate behind it.
  */
  const cote = Math.max(icone, 380)
  const hublot = { cote, gauche: (active.w - cote) / 2, haut: (active.h - cote) / 2 - 40 }

  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 } }}>
      {/*
        Le fond s'assombrit pendant le tour et se ferme sur le heros: jamais un eclair.

        Et quand la vraie piece est devant la camera, ce voile-ci ne se dessine PAS: c'est le
        plan noir de `reveal-toy` qui fait la nuit, parce qu'il est parente a la camera et donc
        centre sur la vue quel que soit l'ecran. Un rectangle d'interface, lui, vit sur une
        toile au rapport fixe: sur un ecran d'un autre rapport son centre n'est pas celui de
        l'ecran, et aucune mesure ne fait coincider les deux (proprietaire, 5 Sep: "ca doit pas
        etre en fonction des ecrans"). Une seule chose assombrit a la fois.
      */}
      {!objet3D && (
        <UiEntity
          uiTransform={{
            width: '150%', height: '150%', positionType: 'absolute', position: { left: '-25%', top: '-25%' }
          }}
          uiBackground={{ color: Color4.create(0, 0, 0, fond * sortie) }} />
      )}

      {/*
        Centred on the GLASS, not on our canvas.

        `Centre` centres inside the rectangle the renderer gives us, which on a phone is the
        screen minus the notch: the reel came out a full card right of centre on the tester's
        handset, and sitting on `bottom: 250` it was also a tenth of the height above the
        middle (owner, 7 Sep, screenshot). The vertical placement is now the middle of the
        canvas, and `decalageCentre()` carries the strip back onto the middle of the glass,
        the same correction the reticle has used since the 5th.
      */}
      {bandeVisible && (
        <Centre top={Math.round(active.h / 2 - (REEL_H + 12) / 2 + decalageCentre().y)} decalage>
          {/*
            TWO boxes, and only the inner one clips.

            The strip has to be cut at the sides: a card must appear from beyond the edge and
            leave through the other. The winning card, on the other hand, GROWS by 22 percent
            when it is chosen, and it grew inside that same cut box: at 264 tall in a band of
            276, a card at 322 lost 23 pixels off the top and as many off the bottom for as
            long as the pop lasted (owner, 5 Sep: "elle est coupee en haut et en bas"). So the
            cut is now on an inner box holding the row alone, and the winner's copy is a
            sibling OUTSIDE it: it can overrun the band in every direction, which is exactly
            what a pop is for.
          */}
          <UiEntity uiTransform={{ width: large, height: bande, opacity: bandeOpacite }}>
            <UiEntity uiTransform={{
              width: large, height: bande, overflow: 'hidden',
              positionType: 'absolute', position: { left: 0, top: 0 }
            }}>
            {boxView.reel.map((r, i) => {
              const x = large / 2 - REEL_W / 2 + (i - boxView.progres) * (REEL_W + REEL_GAP)
              /*
                Born three cards early, buried three cards late.

                A card used to come into existence at the very edge of the view, so its first
                frame on screen was also the frame the renderer discovered it: at full speed
                they seemed to arrive late (owner, 5 Sep). Three card widths of margin costs
                six more elements and gives every card a tenth of a second of existence before
                anybody can see it.
              */
              const MARGE = 3 * (REEL_W + REEL_GAP)
              if (x < -MARGE || x > large + MARGE) return null
              return <CarteReel key={i} rarete={r} x={x} haut={(bande - REEL_H) / 2} opacite={!tourne && i !== REEL_WIN ? 0.42 : 1} />
            }).filter((c) => c !== null)}

            {/* Les deux bords fondent dans le panneau: les cartes viennent de plus loin. */}
            <UiEntity
              uiTransform={{ width: 140, height: bande, positionType: 'absolute', position: { left: 0, top: 0 } }}
              uiBackground={{ texture: { src: 'assets/ui/fade-left.png' }, textureMode: 'stretch' }} />
            <UiEntity
              uiTransform={{ width: 140, height: bande, positionType: 'absolute', position: { right: 0, top: 0 } }}
              uiBackground={{ texture: { src: 'assets/ui/fade-right.png' }, textureMode: 'stretch' }} />
            </UiEntity>

            {tourne ? (
              <UiEntity
                uiTransform={{ width: 5, height: bande, positionType: 'absolute', position: { left: large / 2 - 2.5, top: 0 } }}
                uiBackground={{ color: C.name }} />
            ) : (
              /* La carte gagnante, en COPIE par dessus: la rangee ne bouge pas d'un pixel.
                 Le cadre ET la carte grandissent ensemble; le cadre grandissait seul, et la
                 bande de plaque nue qui s'ouvrait sur deux cotes etait la "fenetre vide" vue
                 a chaque revelation (proprietaire, 5 Sep). */
              <UiEntity
                uiTransform={{
                  width: REEL_W * (1 + 0.22 * pop) + 16, height: REEL_H * (1 + 0.22 * pop) + 16,
                  positionType: 'absolute',
                  position: { left: large / 2 - (REEL_W * (1 + 0.22 * pop) + 16) / 2, top: (bande - REEL_H * (1 + 0.22 * pop) - 16) / 2 }
                }}
                uiBackground={{ ...SKIN.card, color: gagne }}
              >
                <CarteReel rarete={rarete} x={8} haut={8} opacite={1} devoile mutId={boxView.resultatMutation} taille={REEL_W * (1 + 0.22 * pop)} />
              </UiEntity>
            )}
          </UiEntity>
        </Centre>
      )}

      {heroVisible && (
        <UiEntity
          uiTransform={{
            width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 },
            flexDirection: 'column', justifyContent: 'center', alignItems: 'center', opacity: sortie
          }}>
          <UiEntity uiTransform={{ width: icone, height: icone }}>
            {/* A mutated piece keeps a second, slower ring behind the first: the shimmer in
                the sound has something to be seen doing (owner, 5 Sep). */}
            {boxView.resultatMutation > 0 && h < 1400 && (
              <UiEntity
                uiTransform={{
                  width: rayon * (1 + 0.35 * clamp01(h / 1200)), height: rayon * (1 + 0.35 * clamp01(h / 1200)),
                  positionType: 'absolute',
                  position: {
                    left: (icone - rayon * (1 + 0.35 * clamp01(h / 1200))) / 2,
                    top: (icone - rayon * (1 + 0.35 * clamp01(h / 1200))) / 2
                  },
                  opacity: 0.45 * Math.max(0, 1 - h / 1400)
                }}
                uiBackground={{ texture: { src: 'assets/ui/burst.png' }, textureMode: 'stretch', color: Color4.fromHexString(mutation(boxView.resultatMutation).color + 'ff') }} />
            )}
            {eclat > 0 && (
              <UiEntity
                uiTransform={{
                  width: rayon, height: rayon, positionType: 'absolute',
                  position: { left: (icone - rayon) / 2, top: (icone - rayon) / 2 }, opacity: eclat * 0.9
                }}
                uiBackground={{ texture: { src: 'assets/ui/burst.png' }, textureMode: 'stretch', color: gagne }} />
            )}
            {!objet3D && (
              <UiEntity
                uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 } }}
                uiBackground={{
                  texture: { src: `assets/ui/${toyImage(rarete, boxView.resultatMutation, true)}.png` },
                  textureMode: 'stretch'
                }} />
            )}
          </UiEntity>
          <UiEntity uiTransform={{ height: 52, margin: { top: 6 }, opacity: clamp01(nomPop) }}>
            <Label value={`${itemName(boxView.resultat, boxView.resultatMutation)}${boxView.resultatTraits > 0 ? ' +' + boxView.resultatTraits : ''}`.toUpperCase()}
              fontSize={Math.round(TYPE.title * (0.82 + 0.18 * clamp01(nomPop)))} textWrap="nowrap" textAlign="middle-center"
              color={Color4.fromHexString(lisible(gagneHex) + 'ff')}
              uiTransform={{ height: 52 }} />
          </UiEntity>
          <UiEntity uiTransform={{ height: 40, opacity: clamp01(lignePop) }}>
            <Label
              value={mut.mult > 1
                ? `${mut.name.toUpperCase()}  x${mut.mult}  \u00b7  +${formatIncome((INCOME_UI[rarete] ?? 1) * mut.mult)}/s`
                : `+${formatIncome(INCOME_UI[rarete] ?? 1)}/s`}
              fontSize={TYPE.body} textWrap="nowrap" textAlign="middle-center" color={C.money}
              uiTransform={{ height: 40 }} />
          </UiEntity>
        </UiEntity>
      )}
    </UiEntity>
  )
}


const uiComponent = () => {
  applyUiProbe()
  // The alert clock reads this: an alert behind a screen keeps for when the screen goes.
  // And the world reads `hudDepuis`: the press that closed a panel is still in flight in the
  // frame the HUD comes back, so a round went off on CLOSE (owner, 6 Sep). See monde.ts.
  const visible = hud()
  if (visible && !theftView.hudVisible) theftView.hudDepuis = Date.now()
  theftView.hudVisible = visible
  // The trace needs to know whether a press landed inside an open panel (see client/clics.ts).
  signalerMenu(menuView.open)
  /*
    The top band, resolved once per frame, in priority order.

    The money is permanent and leads. A crate on the belt is a moment.

    DEUX BLOCS, ET C'EN ETAIT TROIS. La ligne du boss vivait ici et pesait 52 px, ce qui poussait
    la colonne de toasts d'autant vers le bas pendant les trois minutes ou l'ecran a le plus de
    choses a dire. Elle est partie dans la colonne du coin le 8 Sep, avec le compte a rebours qui
    l'annonce, parce qu'un boss qui sort quatre fois par heure est un fait permanent et pas un
    moment (voir `nextBigText` dans `events.ts`).

    Consequence qui vaut d'etre notee: la bande demandait 118 + 52 + 52 plus deux ecarts de 16,
    soit 250 pour 262 disponibles, et le troisieme bloc etait celui qu'on abandonnait quand une
    plaque grandissait. A deux blocs elle demande 186. L'annonce du tapis, RARE (1,7 % des
    caisses, une toutes les quatre minutes et demie) et qui ne repasse jamais, ne peut donc plus
    etre refusee par un compte a rebours qu'on retrouve seconde apres seconde.
  */
  const topBlocks: Array<[string, boolean, number]> = [
    ['money', true, TYPE.hero + 6 + 34 + 6],
    // Aussi haute que la plaque dessinee dedans: une bande plus courte que sa plaque mangeait
    // l'ecart en dessous, et les toasts arrivaient colles a une ligne de boss (5 Sep).
    ['belt', beltView.annonce !== '', 52]
  ]
  const band = topBand(topBlocks)
  /*
    Where the band ends right now: the toasts hang just under it, so they never cover the
    counter or a running announcement and never sit in the play area either. Most of the
    time only the counter is up and they land at fifteen percent of the screen.
  */
  const bandBottom = topBlocks.reduce<number>((y, [name, present, h]) => present && band[name] >= 0 ? Math.max(y, band[name] + h) : y, BAND.top)
  /*
    The air under the band is TWICE the air inside it, and that is the point.

    Everything hanging here (a toast, the rush card, the chip on its way to the corner) used a
    hardcoded 12, while the plates inside the band are spaced by `STACK_GAP`, 16. So the one
    seam that separates two different GROUPS was the tightest seam on the screen, and a toast
    landing under the raid banner read as glued to it (owner, 6 Sep). The band's own height was
    fixed on 5 Sep, which is a different bug: the plate used to overflow a band shorter than
    itself. This is the gap, not the overflow.

    Proximity is what says "these belong together": members of a group sit closer to each other
    than the group sits to its neighbour. One `STACK_GAP` between two plates of the band, two
    between the band and whatever hangs below it.
  */
  const SOUS_LA_BANDE = STACK_GAP * 2
  /*
    What the game is waiting for, stacked above the controls, most urgent first.
  */
  const notice = noticeBand([
    ['stealing', theftView.stealing, 76],
    ['carrying', carryView.code >= 0 && carryView.vole, 64],
  ])
  return (
  <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute' }}>

    {/*
      The damage flash sits FIRST, so it renders under every other layer: it tints the world
      behind the interface without ever tinting the buttons or a panel the player is reading.
      Not gated on hud(): being shot while a window is open still has to register.
    */}
    {/*
      A red VIGNETTE, not a red pane over the game.

      A tester took a raid boss's swipe and did not notice he had been hit (owner, 7 Sep). The
      flash was a flat wash of the whole screen at 45 % for 420 ms with a squared falloff, so it
      was near its peak for barely a tenth of a second and it dimmed the very thing the player
      was looking at, which makes it easy to read as a lighting change rather than as damage.
      Every shooter answers this the same way and for the same reason: the damage goes on the
      EDGES, where peripheral vision is most sensitive to change and where it hides nothing.
      The texture is the one the cloak already uses, so this costs no new asset.
    */}
    {damageFlashAlpha() > 0 && (
      <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 } }}
        uiBackground={{
          texture: { src: 'assets/ui/vignette.png' }, textureMode: 'stretch',
          color: Color4.create(1, 0.12, 0.12, damageFlashAlpha())
        }} />
    )}

    {/*
      The quantity channel, above the centre so it never covers the avatar or the crosshair.
      Rises and fades in just over a second, the window the references give for a number that
      has to be read without being studied. Stacked by rank when several land at once.
    */}
    {/*
      Keyed on a counter, never on a rank and never on a clock. Ranks shift when the oldest
      expires, which made the next number inherit a stale element (mobile tester, 3 Sep); the
      instant of birth then looked unique and is not, since several of these are created inside
      one frame and share a millisecond (owner, 9 Sep). See the measurement in `juice.ts`.
    */}
    {liveAmounts().map((f) => (
      <UiEntity key={`amt${f.id}`}
        uiTransform={{
          positionType: 'absolute', width: strip(760).width, height: 64,
          position: { top: `${34 - f.t * 7 + f.rank * 6}%`, left: '50%' },
          margin: strip(760).margin
        }}>
        {/*
          La meme police image que le compteur, et pour la meme raison.

          Ce nombre annonce exactement ce que le gros total vient de gagner ou de perdre; ecrit
          dans la police du systeme il ressemblait a un message d'interface a cote d'un chiffre
          de jeu, deux voix pour un seul fait (proprietaire, 7 Sep). Les glyphes portent leur
          propre ombre, donc il tient aussi sur un ciel clair, ce qu'une etiquette plate ne
          faisait pas.

          Le fondu ne peut pas passer par la couleur, les glyphes etant des images: il passe par
          `opacity`, qui se propage aux enfants, et la disparition est donc la meme courbe
          qu'avant. Le role dit la couleur, `bonus` pour un gain et `danger` pour une perte.
        */}
        <UiEntity uiTransform={{
          width: '100%', height: 64, opacity: 1 - f.t * f.t,
          justifyContent: 'center', alignItems: 'center'
        }}>
          {/*
            OR pour un gain, et sur la MEME verticale que le compteur.

            Deux defauts, une cause: ce nombre etait cale a gauche et peint dans la teinte
            d'avertissement. Le calage vient de `Glyphs`, qui se pose en absolu a `left: 0`, ce
            qui rend le `justifyContent` du parent sans effet: la boite de 760 s'accrochait donc
            au bord de l'ecran au lieu du milieu. Le parent porte maintenant la recette que le
            compteur utilise depuis toujours, `left: '50%'` avec la demi-largeur en marge
            negative, et les deux nombres sont sur le meme axe.

            La couleur: `bonus` vaut #ff8a3d, et ce fichier ecrit lui-meme que l'orange est la
            teinte d'AVERTISSEMENT. Un gain d'argent portait donc la couleur d'une alerte. Ce
            nombre est le delta du compteur en or: il prend l'or. La perte garde le rouge, parce
            qu'une perte n'est pas le meme evenement, et la taille les separe deja.
          */}
          <Glyphs
            value={`${f.loss ? '-' : '+'}${formatSolde(f.amount)}`}
            size={f.loss ? TYPE.hero : TYPE.title}
            role={f.loss ? 'danger' : 'money'}
            align="center" box={strip(760).width} />
        </UiEntity>
      </UiEntity>
    ))}

    <Prechauffe />
    
    <PadControls />
    <WelcomePanel />
    <PrestigePanel />
    <FusionPanel />
    <MenuSheet />
    <MenuWindow />

    {/* Not over the crate act: nothing is aimed at during it (owner, 5 Sep). */}
    {combatView.aiming && hud() && !slotView.active && !boxView.roule && boxView.resultat < 0 && <Crosshair />}


    {/*
      The current step, in the top right corner.

      It was centred at the top, directly under the money, which put a running objective in
      the middle of the screen: the one place eye-tracking work on game interfaces says to
      keep clear, because it is where the player is looking. An objective tracker is read in
      the periphery and is conventionally in that corner.

      The corner is genuinely free here, which is not what this scene assumed. A photograph
      of the mobile client shows its four buttons in a row at the top LEFT with nothing at
      the top right; the desktop client has two small icons there, and the margin clears them.
      It is also no longer part of the stacked top band, since it now occupies a corner
      nothing else competes for.
    */}
    {/*
      The step chip: the verb's own icon, the title at reading size, and the count kept
      small. It was a caption and a label in a corner, which testers did not read (owner,
      3 Sep). The icon is the one the contextual button will show, so what the corner says
      and what the thumb presses are the same picture. The help sentence joins after twelve
      seconds on the same step, and only then.
    */}
    {hud() && tutoView.etape < tutoView.total && (
      <UiEntity
        uiTransform={{
          width: stepChipW(),
          height: stepChipH(), positionType: 'absolute', padding: { left: 16, right: 20 },
          position: { top: coinDroit(0), right: rightCornerMargin() },
          flexDirection: 'column', justifyContent: 'center', overflow: 'hidden'
        }}
        uiBackground={SKIN.panel}
      >
        <UiEntity uiTransform={{ height: 48, flexDirection: 'row', alignItems: 'center' }}>
          <UiEntity uiTransform={{ width: 40, height: 40, margin: { right: 12 } }}
            uiBackground={{ texture: { src: `assets/ui/icon-${STEP_TEXTS[tutoView.etape]?.verb ?? 'build'}.png` }, textureMode: 'stretch' }} />
          {/* Every label owns its box: text intrinsic sizing is engine-dependent, and a
              label without a width is sized from its glyphs on one client and to nothing on
              another (build-ui, upstream rule). A box that is measured cannot spill. */}
          <Label
            value={`${tutoView.etape + 1}/${tutoView.total}`}
            fontSize={TYPE.caption} color={C.dim}
            uiTransform={{ width: largeurTexte(`${tutoView.etape + 1}/${tutoView.total}`, TYPE.caption), height: 32, margin: { right: 12 } }} textWrap="nowrap" />
          <Label
            value={STEP_TEXTS[tutoView.etape]?.titre ?? ''}
            fontSize={TYPE.body} color={C.bonus}
            uiTransform={{ width: largeurTexte(STEP_TEXTS[tutoView.etape]?.titre ?? '', TYPE.body), height: 40 }} textWrap="nowrap" />
        </UiEntity>
        {stepHintLines() > 0 && (
          <Label
            value={STEP_TEXTS[tutoView.etape]?.aide ?? ''}
            fontSize={TYPE.caption} color={C.name}
            uiTransform={{ width: '100%', height: 30 * stepHintLines() }} textWrap="wrap" />
        )}
      </UiEntity>
    )}


    {/* The rush running now: a standing fact for minutes, so it lives with the other standing facts. */}
    {/*
      Announced in the player's gaze, then it FLIES to its permanent place: the chip is born
      under the counter, in the middle, holds there a second and a half, then slides to its
      slot in the corner over half a second. That is the second half of the timer conveyance
      this HUD cites, done as motion rather than as two unrelated things appearing. Only a
      translation: the interface has no scale transform, so the chip keeps its size.
    */}
    {hud() && rushChip() !== null && (() => {
      const texte = rushChip()?.text ?? ''
      /*
        La largeur est DECLAREE, et elle ne l'etait pas.

        `w` etait calculee ici puis servait uniquement a centrer le depart du vol; la pastille,
        elle, n'avait aucune largeur et se dimensionnait sur son contenu. Les deux nombres ne
        coincidaient donc pas, ce qui faisait partir le vol decentre et, quand un halo a ete
        pose derriere en se fiant a `w`, deborder tout l'ecart d'un seul cote (ancre a droite).
        Une largeur calculee et jamais appliquee est une largeur fausse.

        Elle est calculee comme celles de la colonne, meme plancher `COIN_MIN`, plus la place
        de l'icone et de ses marges: dans une colonne de plaques alignees, celle-ci ne peut pas
        etre la seule a mesurer autre chose.
      */
      const w = Math.max(COIN_MIN, Math.round(largeurTexte(texte, TYPE.caption) + 28 + 10 + 32))
      const age = Date.now() - eventView.sinceMs
      const p = Math.max(0, Math.min(1, (age - RUSH_HOLD_MS) / RUSH_FLIGHT_MS))
      const e = 1 - Math.pow(1 - p, 3)
      const fromTop = bandBottom + SOUS_LA_BANDE, fromRight = active.w / 2 - w / 2
      const top = Math.round(fromTop + (coinDroit(1) - fromTop) * e)
      const right = Math.round(fromRight + (rightCornerMargin() - fromRight) * e)
      /*
        LE HALO QUI RESPIRAIT EST RETIRE, ET LE SIGNIFIANT PASSE PAR LE BORD.

        Le probleme reste vrai: c'est la seule plaque du coin qui prenne un appui, elle ouvre la
        carte de l'evenement, et rien ne le disait. Norman nomme exactement ce defaut, un
        signifiant manquant sur une affordance reelle. Ce sont les trois reponses successives
        qui etaient fausses.

        1. LE MOUVEMENT REPONDAIT A LA MAUVAISE QUESTION. Une lueur qui pulse dit "il se passe
        quelque chose ici"; elle ne dit pas "ceci s'appuie". Dans un HUD, un compteur qui
        clignote veut meme conventionnellement dire une ALERTE, un minuteur qui expire ou une
        ressource au plafond. Le mouvement est un canal d'ATTENTION, la question posee etait
        une question d'IDENTITE.

        2. UN HALO N'EST PAS FAISABLE. L'interface de la plateforme n'a ni flou, ni degrade, ni
        ombre portee: une couleur de fond avec un rayon de coin est une DALLE PLATE. Ce que le
        proprietaire a vu, "un carre solide abrupt", est exactement ce que l'API peut produire.

        3. ET LA PLAQUE DE BOUTON AURAIT COUTE LA LISIBILITE, mesure a l'appui. `SKIN.secondary`
        est un bleu moyen (63, 134, 214). Le texte et l'icone de cette pastille portent la
        couleur du rush, qui est ce qui dit LEQUEL tourne. Le cyan du Cyber Rush mesure 8,55
        contre la plaque navy et 2,44 contre la plaque bleue: sous le plancher de 3 pour 1 que
        ce depot s'impose pour un graphique ou un grand texte. Signifier le bouton par sa plaque
        aurait divise par trois et demi la lisibilite de l'information que la pastille porte.

        CE QUI RESTE, ET C'EST LE SIGNIFIANT LE PLUS DIRECT DE TOUS: une surface BORNEE qui se
        lit comme un objet distinct. Un liseré dans le bleu des controles, sur la plaque sombre
        qu'on garde. Il mesure 3,5 contre elle, donc il se voit; il ne touche ni le fond ni le
        texte, donc les 8,55 du rush restent intacts; et il ne coute aucun actif.
      */
      return [
      <UiEntity key="rush-chip"
        uiTransform={{
          width: w, height: COIN_H[1], positionType: 'absolute',
          position: { top, right },
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
          borderWidth: 3, borderColor: Color4.fromHexString('#3f86d6ff'), borderRadius: RAD.card,
          pointerFilter: 'block'
        }}
        uiBackground={SKIN.panel}
        onMouseDown={() => openRushCard(false)}
      >
        <UiEntity uiTransform={{ width: 28, height: 28, margin: { right: 10 } }}
          uiBackground={{ texture: { src: 'assets/ui/ui-crate.png' }, textureMode: 'stretch', color: Color4.fromHexString(lisible(rushChip()?.color ?? '#ffffff') + 'ff') }} />
        <Label value={texte} fontSize={TYPE.caption}
          color={Color4.fromHexString(lisible(rushChip()?.color ?? '#ffffff') + 'ff')}
          uiTransform={{ height: COIN_H[1] }} textAlign="middle-center" textWrap="nowrap" />
      </UiEntity>
      ]
    })()}

    {/*
      The counter, with nothing behind it.

      It sat on an opaque plate five hundred and twenty wide and a hundred tall, which on a
      phone is a real piece of the playing field spent on a background for six characters.
      On a screen this size the rule is to obstruct as little as possible, so the plate is
      gone and the letters carry their own contrast: the typeface draws a dark copy of itself
      behind, which costs one element per character and no screen at all. Freed of the plate
      the number can also be bigger, which is what a counter read from the corner of the eye
      needs anyway.

      And with the plate gone the width stopped being a surface and became a measuring frame:
      it obstructs nothing, so it costs nothing to be wide enough for the line underneath.
      Five hundred and sixty was inherited from the plate it replaced, and it was the reason
      the subtitle could not say what the multiplier was for. Measured against the atlas, the
      busiest line this can hold is 597 px; the frame is 760.
    */}
    {hud() && (
    <UiEntity
      uiTransform={{
        /*
          Six more than the two lines need: the wait bar draws below them while the server
          is silent, and a column sized to the text alone let it overflow onto the glyphs.
          The photograph read RECONNEC G, with the T, I and N under an orange line.
        */
        width: strip(760).width, height: TYPE.hero + 6 + 34 + 6, positionType: 'absolute',
        position: { top: band.money, left: '50%' }, margin: strip(760).margin,
        flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'center'
      }}
    >
      {/*
        The one number that carries the whole game, at hero size and in the money colour.
        The pool waiting to be banked is named here as well as on the button, because a
        purchase the player can afford takes the button's place and would otherwise take the
        only mention of the pool with it.
      */}
      {/*
        The money is set in the game's own face, which the platform does not carry: one
        quad per digit, each showing its cell of an atlas. Glyphs place themselves, so they
        need a box of their own in the column or the line under them is walked over.
      */}
      {/*
        A live counter, not a teleprompter. The displayed value chases the real one (fast
        lerp, snapped when close), the digits swell for a beat when money arrives, and the
        gain itself floats up beside them and vanishes: the standard grammar of every 2026
        mobile earner, built from the pieces already on screen.
      */}
      <UiEntity uiTransform={{ width: '100%', height: TYPE.hero + 6 }}>
        <Glyphs
          value={formatSolde(compteurAffiche())}
          size={Math.round(TYPE.hero * (1 + poussee() * 0.09))} role="money" align="center" box={strip(760).width} />
      </UiEntity>
      {/*
        The line under it, in the same face for the same reason: no plate, so it has to
        carry its own contrast rather than borrow one.
      */}
      <UiEntity uiTransform={{ width: '100%', height: 34 }}>
        <Glyphs
          size={TYPE.label} align="center" box={strip(760).width}
          role={
            (!view.serverAlive || !theftView.basePosee || theftView.income === 0)
              ? 'bonus'
              : 'money'
          }
          value={
            !view.serverAlive
              /*
                A wait that outlives its own estimate has to say so.

                The bar approaches nine tenths and stops, on purpose, because the fifteen
                seconds it is drawn against is a documented figure and not a measurement of
                our server. That honesty becomes silence if the wait runs long: the player
                watches a bar that has not moved in half a minute and concludes it is stuck.
                Past twenty-five seconds the line stops repeating itself and admits the delay,
                which is the only thing left that is true.
              */
              ? (view.serverBooting
                  ? (attenteLongue() ? 'STILL STARTING, THIS ONE IS SLOW'
                    : intentEnAttente() ? 'STARTING UP, ACTION QUEUED' : 'STARTING UP')
                  : (intentEnAttente() ? 'RECONNECTING, ACTION QUEUED' : 'RECONNECTING'))
            : !theftView.basePosee ? 'PLACE YOUR BASE'
            : theftView.income === 0 ? 'OPEN A BOX TO EARN'
            /*
                The rate, then the two things that multiply it, then the pool to be collected.

                The prestige multiplier used to sit on the BALANCE, glued to the coin total
                with no word beside it: `1.2M  x4`. It multiplies neither the balance nor
                anything else the player owns, it multiplies what comes in, and what comes in
                was on the line below. So the one number it acts on and the multiplier itself
                were on two different lines, in the wrong order, and the multiplier had no
                noun. Here it sits next to the rate it produced, in the same shape as the
                crowd bonus, which is the same kind of thing and was already written this way.
                `+340/S` already includes both, so the line reads as an explanation of the
                rate rather than a sum to be done.
              */
              : `+${formatIncome(theftView.income)}/S`
              /*
                Le multiplicateur de prestige quitte cette ligne (proprietaire, 7 Sep).

                Ce n'est pas une information dont le joueur a besoin TOUT DE SUITE: elle ne
                change qu'a un prestige, c'est-a-dire quelques fois par partie, et elle est
                deja lisible dans le panneau qui la vend. La ligne du taux, elle, est relue en
                permanence et porte deja le revenu, le bonus de foule et la cagnotte. Une ligne
                de HUD se paie en largeur et en temps de lecture: ce qui n'y change presque
                jamais n'a pas a y occuper de place.
              */
              + (theftView.prime > 0 ? `   +${Math.round(theftView.prime * 100)}% CROWD` : '')
              /*
                La cagnotte est un MORCEAU DE CETTE LIGNE, pas une etiquette posee dessous.

                Je l'avais ajoutee comme un element voisin dans un bloc qui n'empile pas ses
                enfants: les deux textes se sont donc superposes et plus rien n'etait lisible
                (proprietaire, 7 Sep, capture a l'appui). Cette ligne a deja sa facon de dire
                plusieurs choses, le multiplicateur et le bonus de foule s'y ajoutent en toutes
                lettres; la cagnotte s'y ajoute pareil, meme police et meme ligne par
                construction plutot que par reglage.

                Et le format est celui du SOLDE, pas celui des prix: `formatIncome` change de
                regle selon la taille (deux decimales sous dix, aucune sous mille, une au-dela),
                donc la cagnotte semblait tantot precise tantot grossiere en montant.
              */
              + (theftView.pending >= 1
                  ? `   ${formatSolde(theftView.pending)} WAITING${cagnottePleine() ? ', FULL' : ''}`
                  : '')
          } />
      </UiEntity>
      {!view.serverAlive && <WaitBar />}
    </UiEntity>
    )}

    {/*
      The crate being earned by simply being here, and how much of it is left.

      Nothing said this was coming: the game took fifteen minutes of somebody's attention and
      turned it into a surprise, when the same fifteen minutes shown as a filling bar is an
      anticipation the whole time. That is not decoration and it is not clutter, it is the
      product of the wait, and the research on progress indicators says plainly why it works:
      an unfinished bar reads as something to be finished, every time it is glanced at.

      Which is also a correction to how the rest of this screen was pruned. Two tests were
      used all evening, is it time-critical and is it available elsewhere, and both only ask
      whether an element WASTES the screen. Neither asks whether it EARNS it by showing
      progress towards something wanted. This one fails the first two and passes the third.
    */}
    {/* The next grand rush, as a chip: a standing fact, not an announcement. */}
    {/*
      Invisible: the screen wears it.

      The chip in the corner is read once and forgotten, and being invisible changes how the
      whole venue treats you: it has to be felt while you play (owner, 5 Sep). So a cyan
      vignette frames the screen, transparent where you are looking, breathing slowly while
      the cloak holds and beating twice as fast over its last three seconds, which is the
      genre's own way of saying a state is about to drop. The chip stays for the number.
    */}
    {hud() && gearView.cloakLeftS > 0 && (
      <UiEntity
        uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 } }}
        uiBackground={{
          texture: { src: 'assets/ui/vignette.png' }, textureMode: 'stretch',
          color: Color4.create(0.30, 0.82, 1.0,
            (gearView.cloakLeftS <= 3 ? 0.34 : 0.24) +
            (gearView.cloakLeftS <= 3 ? 0.20 : 0.08) * (0.5 + 0.5 * Math.sin(Date.now() / (gearView.cloakLeftS <= 3 ? 180 : 520))))
        }} />
    )}

    {/* Invisible, and for how much longer: a state with a clock says both, in the column
        where every other clock in this game is read (owner, 5 Sep: "on ne sait pas
        visuellement combien de temps ca dure"). */}
    {hud() && gearView.cloakLeftS > 0 && (
      <UiEntity
        uiTransform={{
          width: coinW(`INVISIBLE  ${gearView.cloakLeftS}s`), height: 40, positionType: 'absolute',
          position: { top: coinDroit(4), right: rightCornerMargin() },
          justifyContent: 'center', alignItems: 'center'
        }}
        uiBackground={SKIN.panel}
      >
        <Label value={`INVISIBLE  ${gearView.cloakLeftS}s`} fontSize={TYPE.caption} textWrap="nowrap"
          color={Color4.fromHexString('#4dd2ffff')} uiTransform={{ height: 40 }} textAlign="middle-left" />
      </UiEntity>
    )}

    {hud() && nextBigText() !== null && (
      <UiEntity
        uiTransform={{
          width: coinW(nextBigText()?.text ?? ''), height: 40, positionType: 'absolute', padding: { left: 16, right: 16 },
          position: { top: coinDroit(3), right: rightCornerMargin() },
          flexDirection: 'row', alignItems: 'center'
        }}
        uiBackground={SKIN.panel}
      >
        {/*
          Le texte est cale a GAUCHE, comme toute rangee d'une colonne.

          La colonne porte une largeur unique, 440, pour que ses bords gauches ne fassent pas
          un escalier. Centre dedans, un texte court comme "RAID IN 00:30" flotte au milieu
          d'une plaque trois fois plus large que lui et lit comme une grosse bulle, alors que
          c'est une rangee (proprietaire, 7 Sep). Cale a gauche, la meme plaque lit comme une
          ligne d'un panneau, ce qu'elle est: la largeur unique cesse d'etre un cadre autour
          du texte pour redevenir une colonne.
        */}
        <Label value={nextBigText()?.text ?? ''} fontSize={TYPE.caption}
          color={Color4.fromHexString(lisible(nextBigText()?.color ?? '#ffd166') + 'ff')}
          uiTransform={{ height: 40 }} textAlign="middle-left" textWrap="nowrap" />
      </UiEntity>
    )}

    {hud() && giftView.leftS > 0 && (
      <UiEntity
        uiTransform={{
          width: coinW(`FREE BOX IN ${Math.floor(giftView.leftS / 60)}:${String(giftView.leftS % 60).padStart(2, '0')}`),
          height: 52, positionType: 'absolute',
          position: { top: coinDroit(2), right: rightCornerMargin() },
          flexDirection: 'column', padding: { left: 14, right: 14, top: 6 }
        }}
        uiBackground={SKIN.panel}
      >
        <Label
          value={`FREE BOX IN ${Math.floor(giftView.leftS / 60)}:${String(giftView.leftS % 60).padStart(2, '0')}`}
          fontSize={TYPE.caption} color={C.bonus}
          uiTransform={{ width: '100%', height: 26 }} textAlign="middle-left" textWrap="nowrap" />
        <Barre hauteur={8} couleur={C.bonus}
          pct={(1 - giftView.leftS / Math.max(1, giftView.totalS)) * 100} />
      </UiEntity>
    )}

    {/*
      The event feed lives in a corner, not across the middle of the play area.

      It was centred at the top, which is where the player is looking, for a stream of things
      that happened to other people somewhere else: the definition of what belongs in the
      periphery. It stacks under the tutorial step in the same right-hand corner, and takes
      that corner over once the tutorial is done with it.
    */}
    {hud() && filVisible().length > 0 && (
      <UiEntity
        uiTransform={{
          /*
            A row per line, a plate the size of the rows, and a left edge to read down.

            Each line was a Label with a width and NO HEIGHT, inside a column. Everywhere else
            in this interface a Label carries an explicit height, because text does not give
            this layout engine a size to lay out with: three lines all resolved to nothing and
            were painted at the same y, which is the illegible stack in the photograph. The
            plate was a fixed sixty-two whatever it held, so one line sat in a box built for
            three, and centring lines of different lengths turned a list into a shape.
          */
          width: COIN_W, height: 16 + filVisible().length * FIL_LIGNE, positionType: 'absolute',
          position: { top: coinDroit(5), right: rightCornerMargin() },
          padding: 8, flexDirection: 'column', alignItems: 'flex-start'
        }}
        uiBackground={{ color: SURF.voile }}
      >
        {filVisible().map((l, i) => (
          <Label key={i} uiTransform={{ width: '100%', height: FIL_LIGNE }} textWrap="nowrap"
            textAlign="middle-left"
            value={l} fontSize={TYPE.caption} color={Color4.fromHexString('#b8c2d0ff')} />
        ))}
      </UiEntity>
    )}

    {/*
      A crate worth crossing the room for. One in about thirteen now, rather than one in
      four, so it is allowed to be loud; it is not allowed to be wider than its sentence.
    */}
    {hud() && beltView.annonce !== '' && band.belt >= 0 && (
      <Centre top={band.belt}>
        <UiEntity
          uiTransform={{
            width: Math.min(strip(860).width, largeurTexte(beltView.annonce, TYPE.label) + 64),
            height: 52, justifyContent: 'center', alignItems: 'center'
          }}
          uiBackground={SKIN.panel}
        >
          <Label value={beltView.annonce} fontSize={TYPE.label}
            color={C.bonus} textWrap="nowrap" />
        </UiEntity>
      </Centre>
    )}

    {/*
      The reel.

      A strip of candidate cards runs along the bottom and decelerates onto one, with a
      white line marking the centre. It replaces a spinning list of rarity names, which
      told the player the result without ever showing them what they nearly had: the whole
      point of the form is the cards that go past. Only the cards actually on screen are
      drawn, out of the thirty-four in the strip.
    */}
    {hud() && (boxView.roule || boxView.resultat >= 0) && CrateReveal()}




    {/*
      No plate for the smash. The crate carries it.

      "SMASH THE CRATE 0/3" was a plate in the middle of the screen, the place this interface
      spends its whole effort keeping clear, and it did not help the one tester who needed it
      (owner, 6 Sep). What replaces it is the thing the player is already looking at: a mallet
      on the button, swinging, and a crate that visibly shrinks, turns and throws debris on
      every blow. Teaching by action rather than by a caption is the rule the genre's own
      onboarding guidance states, and it is the rule this file already follows everywhere else.
    */}
    {hud() && theftView.stealing && (
      <UiEntity
        uiTransform={{
          width: strip(620).width, height: 76, positionType: 'absolute',
          position: { bottom: notice.stealing, left: '50%' }, margin: strip(620).margin,
          flexDirection: 'column', padding: 10
        }}
        uiBackground={SKIN.danger}
      >
        <Label
          value={`TAKING FROM ${theftView.stealTarget.toUpperCase()}  ·  ${(theftView.stealLeftMs / 1000).toFixed(1)}s`}
          fontSize={TYPE.label} color={Color4.fromHexString('#ff9b9bff')}
          uiTransform={{ width: '100%', height: 24 }} textAlign="middle-center" />
        <Barre hauteur={12} haut={4}
          pct={100 - (theftView.stealLeftMs / theftView.stealTotalMs) * 100}
          couleur={Color4.fromHexString('#ffd7d7ff')} />
        <Label value="stay close - walking away cancels it" fontSize={TYPE.caption}
          color={Color4.fromHexString('#c9a0a0ff')}
          uiTransform={{ width: '100%', height: 18 }} textAlign="middle-center" />
      </UiEntity>
    )}

    {/*
      Hauling stolen goods, and what it costs.

      More than half the carrier's speed goes into the load, and the only sign of it was
      being slow, which reads as nothing (owner, 1 Sep). The ring under the thief says it to
      everyone else; this says it to the thief, as a number, in the danger plate the theft
      panel already uses. It names the way out too: a state a player cannot end is a
      punishment, and one they can is a chase.
    */}
    {hud() && carryView.code >= 0 && carryView.vole && notice.carrying >= 0 && (
      <UiEntity
        uiTransform={{
          width: strip(560).width, height: 64, positionType: 'absolute',
          position: { bottom: notice.carrying, left: '50%' }, margin: strip(560).margin,
          justifyContent: 'center', alignItems: 'center'
        }}
        uiBackground={SKIN.danger}
      >
        <Label
          // The item is already in the thief's hand and named over their head; the line
          // carries what neither of those says, which is the cost and the way out.
          value={`STOLEN  ·  -${Math.round((1 - CARRY_STOLEN_SHARE) * 100)}% SPEED  ·  GET IT HOME`}
          fontSize={TYPE.label} color={Color4.fromHexString('#ffdcdcff')} textWrap="nowrap"
          uiTransform={{ width: '100%', height: 40 }} textAlign="middle-center" />
      </UiEntity>
    )}

    {/*
      The box grows with its text. It was seventy pixels for a title-size line, and several
      alerts carry two (a sentry, a rush gift); the second line ran past the panel and the
      third, when there was one, was simply not on screen. One line of height per line of
      text, and wide enough that a sum and a name fit on the first.
    */}
    {/*
      The toast stack: two at most, newest first, each sliding down into place and fading
      out at the end of its life, with its severity as a left accent bar. The colours were
      already the hierarchy (gold gain, red danger, grey info); the anatomy and the motion
      are what make it read as a system rather than a message that teleports.
    */}
    {/*
      The rush card, under the band, where a toast would sit; the toasts step down while it
      is up. Closed by a tap on it, or by its own clock.
    */}
    {hud() && rushCardVisible() && rushInfo() !== null && (() => {
      const r = rushInfo()
      if (r === null) return null
      const teinte = Color4.fromHexString(lisible(r.color) + 'ff')
      return (
        <UiEntity
          uiTransform={{
            width: RUSH_CARD_W, height: RUSH_CARD_H, positionType: 'absolute',
            position: { top: bandBottom + SOUS_LA_BANDE, left: '50%' }, margin: { left: -RUSH_CARD_W / 2 },
            padding: { left: 20, right: 20 }, flexDirection: 'row', alignItems: 'center', pointerFilter: 'block'
          }}
          uiBackground={SKIN.panel}
          onMouseDown={closeRushCard}
        >
          <UiEntity uiTransform={{ width: 84, height: 84, margin: { right: 18 } }}
            uiBackground={{ texture: { src: 'assets/ui/ui-crate.png' }, textureMode: 'stretch', color: teinte }} />
          <UiEntity uiTransform={{ width: RUSH_CARD_W - 40 - 102, height: RUSH_CARD_H - 20, flexDirection: 'column', justifyContent: 'center' }}>
            <Label value={`${r.grand ? 'GRAND ' : ''}${r.name}`} fontSize={TYPE.label} color={teinte}
              uiTransform={{ width: '100%', height: 34 }} textAlign="middle-left" textWrap="nowrap" />
            <Label value={`belt boxes drop ${r.toy} toys  ·  x${r.mult} income`} fontSize={TYPE.label} color={C.name}
              uiTransform={{ width: '100%', height: 34 }} textAlign="middle-left" textWrap="nowrap" />
            <Label value={`${Math.floor(r.leftS / 60)}:${String(r.leftS % 60).padStart(2, '0')} left  ·  at the belt${r.grand ? '  ·  belt at double speed' : ''}${r.gift !== '' ? `  ·  ${r.gift}` : ''}`}
              fontSize={TYPE.caption} color={C.dim}
              uiTransform={{ width: '100%', height: 28 }} textAlign="middle-left" textWrap="nowrap" />
          </UiEntity>
        </UiEntity>
      )
    })()}

    {/*
      The toasts hang under the top band, and they leave the middle alone.

      Two things put them across the player's view. They are centred on the canvas, and they
      are as tall as their words: three of them during a firefight reached the middle of the
      screen and stood between the shooter and the target (testers, 6 Sep). The combat lines
      are gone from this channel entirely (see `direResultat` in combat.ts), and what is left
      is capped: at most `TOASTS_MAX` on screen, the newest kept, and the column stops at
      `TOASTS_BAS` so it can never grow into the play area whatever arrives.
    */}
    {alertesVisibles().length > 0 && hud() && (
      <UiEntity
        uiTransform={{
          width: '100%', height: TOASTS_BAS, overflow: 'hidden',
          positionType: 'absolute', position: { top: bandBottom + SOUS_LA_BANDE + (rushCardVisible() ? RUSH_CARD_H + STACK_GAP : 0), left: 0 },
          flexDirection: 'column', alignItems: 'center'
        }}
      >
        {alertesVisibles().slice(-TOASTS_MAX).map((a) => {
          const now = Date.now()
          const entree = Math.min(1, (now - a.ne) / 160)
          const sortie = Math.min(1, Math.max(0, (a.until - now) / 250))
          /*
            Sized to its words, never to the screen. The plate used to be 820 wide, half a
            phone, whatever it said; a four-word refusal wore the same slab as a boss
            announcement. Capped under half the canvas so a long line wraps instead.
          */
          /*
            The estimate is an estimate: the client reports no text metrics, and WELCOME BACK
            still ran past its plate on 7b7a (owner, 4 Sep). So the plate takes twelve percent
            over the estimate and wraps explicitly, and the line count is taken on the same
            widened figure: a plate a little roomy beats a word outside it.
          */
          const maxW = Math.round(active.w * 0.46)
          const estime = Math.round(largeurTexte(a.t, TYPE.body) * 1.12)
          const w = Math.min(maxW, estime + 64)
          const lignes = Math.max(1, Math.ceil(estime / (w - 44)))
          const h = 52 + (lignes - 1) * Math.round(TYPE.body * 1.35)
          return (
            <UiEntity key={`toast${a.id}`}
              uiTransform={{
                width: w, height: h,
                margin: { top: Math.round(-(1 - entree) * 14), bottom: STACK_GAP },
                justifyContent: 'center', alignItems: 'center'
              }}
              uiBackground={SKIN.panel}
            >
              <Label uiTransform={{ width: w - 44, height: h - 12 }} value={a.t} fontSize={TYPE.body} textAlign="middle-center" textWrap="wrap"
                color={(() => { const c = Color4.fromHexString(lisible(a.c) + 'ff'); return Color4.create(c.r, c.g, c.b, sortie * entree) })()} />
            </UiEntity>
          )
        })}
      </UiEntity>
    )}

    {/*
      The bottom bar, and only what can be pressed.

      Every control is at TAP.height with TAP.gap between them, and every label at
      TYPE.body, so a thumb can hit them and an eye can read them on a phone. What the
      player is merely waiting for sits above as one dim line, never as a dead button.
    */}
    {/*
      A plate, not a whisper.

      This was caption-sized dim grey text on the world, and a player asked out loud how he was
      supposed to know how many boxes were waiting at his base: the line telling him had been
      on his screen the whole time (owner, 7 Sep). It is the one channel that says what the
      player is WAITING for, so it gets the plate every other statement in this interface has,
      body size, and the amber that means "there is something for you here".
    */}
    {/*
        Plus bas et plus affirme, en deux passes.

        Cette ligne dit la seule chose que le joueur peut faire et ne fait pas: des boites
        l'attendent chez lui. Elle etait une legende grise perdue au-dessus des commandes, et
        apres une premiere correction elle restait "encore un peu trop peu discrete" et trop
        haut (proprietaire, 6 puis 7 Sep). Elle descend contre la rangee de commandes, la ou
        le pouce regarde deja, et prend le corps d'un titre plutot que celui d'une legende.
        Un liseré dans sa propre couleur la separe du fond sans lui donner l'air d'un bouton:
        elle informe, elle ne se presse pas.

        Au VRAI bas: `BAND.bottom` est le plancher de la mise en page, celui d'ou les rangees
        de commandes montent. Un nombre ajoute par-dessus serait un reglage a l'oeil, juste sur
        un format et faux sur le suivant; ce plancher, lui, est deja celui de tout le reste.
    */}
    {hint() !== '' && !combatView.aiming && hud() && (
      <Centre bottom={BAND.bottom}>
        <UiEntity
          uiTransform={{
            height: 60, padding: { left: 26, right: 26 },
            justifyContent: 'center', alignItems: 'center',
            borderWidth: 2, borderColor: C.bonus, borderRadius: RAD.card
          }}
          uiBackground={SKIN.panel}
        >
          <Label value={hint()} fontSize={TYPE.label} color={C.bonus} textWrap="nowrap" />
        </UiEntity>
      </Centre>
    )}

    {/*
      What E does right now, and nothing else.

      This was a fixed plate six hundred and twenty wide holding two captions, "E BUILD
      BASE" and "F to draw", parked above the client's buttons. Two things were wrong with
      it. Half of it captioned a control that can carry its own meaning, and now does: F
      wears a pistol, struck through once the weapon is out. And a plate with a fixed width
      is a block of furniture whatever it has to say, which is how a single short word came
      to occupy a third of the screen.

      What is left hugs its text and appears only when there is something to say. Eye
      tracking on game interfaces is blunt about this: players hold their gaze on the action
      and read the rest in peripheral vision, so anything permanent near the middle is paid
      for out of the part of the screen they are actually using.
    */}
    {hud() && !slotView.active && barre() !== '' && (
      <Centre bottom={row(0)}>
        <UiEntity
          uiTransform={{
            height: 52, padding: { left: 26, right: 26 },
            justifyContent: 'center', alignItems: 'center'
          }}
          uiBackground={SKIN.panel}
        >
          <Label value={barre()} fontSize={TYPE.label}
            color={combatView.aiming ? C.danger : C.name} textWrap="nowrap" />
        </UiEntity>
      </Centre>
    )}

    <LoadingScreen />
  </UiEntity>
  )
}

/**
 * The game's own loading screen, held up until the field is really there.
 *
 * Drawn LAST so it covers every other layer, and it swallows every press. It stays while
 * any of three things is still missing: the heavy models (`loading.ts` reads the client's
 * own load states), the wallet (the first message that says who this player is) and a live
 * server heartbeat. Each has its own ceiling elsewhere, and this screen adds one of its own,
 * so nothing can hold a player on a picture for good. The picture is the world's thumbnail,
 * the one thing every player has already seen before arriving.
 */
const LOADING_CEILING_MS = 30_000
const LoadingScreen = () => {
  const pret = loadingView.assetsReady && theftView.walletRecu && view.serverAlive
  if (pret || Date.now() - loadingView.since > LOADING_CEILING_MS) return null
  /*
    La photo COUVRE l'ecran, elle n'est pas une carte posee sur un fond navy.

    Elle etait dessinee a 52 % de la hauteur, soit 561 par 374 dans 1600 par 720: un cinquieme
    de la surface, le reste vide (proprietaire, 7 Sep). Un ecran de chargement est la premiere
    image du jeu et la seule qui ait l'ecran pour elle. Elle est donc dimensionnee comme
    n'importe quelle image plein cadre: garder son rapport, prendre la dimension qui ne laisse
    aucun vide, rogner l'autre.

    La mesure se fait contre la zone que le RENDERER remplit, pas contre le canevas: il est
    pose sur la zone sure de l'appareil, donc un element en 100 % occupe ce rectangle-la et
    non la dalle. Calculee contre `active`, la couverture visait plus grand que ce qu'elle
    remplissait et l'image sortait decalee et coupee de travers. Et la dimension qui commande
    n'est pas toujours la largeur: on compare les deux rapports plutot que de supposer.
  */
  const RATIO = 1440 / 960
  const z = zoneRenderer()
  const iw = z.w / z.h > RATIO ? z.w : Math.round(z.h * RATIO)
  const ih = z.w / z.h > RATIO ? Math.round(z.w / RATIO) : z.h
  const haut = Math.round((z.h - ih) / 2)
  const gauche = Math.round((z.w - iw) / 2)
  return (
    <UiEntity
      uiTransform={{
        width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 },
        overflow: 'hidden', pointerFilter: 'block',
        justifyContent: 'center', alignItems: 'center'
      }}
      uiBackground={{ color: Color4.fromHexString('#0f1524ff') }}
    >
      <UiEntity uiTransform={{ width: iw, height: ih, positionType: 'absolute', position: { top: haut, left: gauche } }}
        uiBackground={{ texture: { src: 'images/base-war-thumbnail.png' }, textureMode: 'stretch' }} />
      <Spinner />
    </UiEntity>
  )
}

/**
 * Un anneau de points qui tourne, sans rien faire tourner.
 *
 * L'interface de Decentraland ne sait pas faire pivoter un element, donc une roue au sens
 * propre est hors de portee: c'est deja pour cette raison que l'ecran de chargement affichait
 * trois points qui respiraient. Un anneau resout le meme probleme autrement, et c'est la forme
 * que tout le monde reconnait: les points sont fixes sur un cercle et c'est la LUMIERE qui en
 * fait le tour. L'oeil lit une rotation la ou rien ne tourne.
 *
 * La bande sombre, la phrase et les trois points ont ete retires avec (proprietaire, 7 Sep):
 * l'ecran ne dit plus ce qu'il charge, il dit seulement qu'il travaille, ce qui est la seule
 * chose que le joueur ait a en savoir. La photo redevient donc l'image, entiere.
 *
 * Chaque point porte un liseré sombre plutot qu'un voile derriere l'anneau: le fond est une
 * photo claire, un or pur s'y perdrait, et c'est deja la solution que le jeu emploie pour tout
 * son texte en volume.
 */
const SPIN_D = 104
const SPIN_POINT = 15
const SPIN_N = 10
const SPIN_MS = 1100
const Spinner = () => {
  const t = (Date.now() % SPIN_MS) / SPIN_MS
  const R = (SPIN_D - SPIN_POINT) / 2
  return (
    <UiEntity uiTransform={{ width: SPIN_D, height: SPIN_D }}>
      {Array.from({ length: SPIN_N }, (_, i) => {
        const a = (i / SPIN_N) * Math.PI * 2 - Math.PI / 2
        // La distance ARRIERE a la tete lumineuse, entre 0 et 1: la comete eclaire le point
        // qu'elle vient d'atteindre et laisse une trainee courte derriere elle.
        const d = (t - i / SPIN_N + 1) % 1
        const feu = Math.max(0, 1 - d * 2.4)
        return (
          <UiEntity key={`sp${i}`}
            uiTransform={{
              width: SPIN_POINT, height: SPIN_POINT, positionType: 'absolute',
              position: {
                left: Math.round(SPIN_D / 2 + R * Math.cos(a) - SPIN_POINT / 2),
                top: Math.round(SPIN_D / 2 + R * Math.sin(a) - SPIN_POINT / 2)
              },
              borderRadius: SPIN_POINT / 2, borderWidth: 2,
              borderColor: Color4.create(0.04, 0.06, 0.11, 1),
              opacity: 0.18 + 0.82 * feu * feu
            }}
            uiBackground={{ color: Color4.fromHexString('#ffd166ff') }} />
        )
      })}
    </UiEntity>
  )
}

