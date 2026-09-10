import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { TYPE, C, TAP, SKIN, RAD, TOAST } from './theme'
import { Btn, SURF } from './ui-kit'
import { formatIncome } from '../shared/loot-table'
import { PRESTIGE_CASH_SHARE } from '../shared/economy'
import { SENTRY_TIERS, SENTRY_MAX_CHARGES, MAX_FLOORS, SILO_MAX, SILO_STEP_S, prestigeTier, prixParCharge, GEARS, prixGear, LUCK_MS } from '../shared/schemas'
import { gearView, acheterGear, buyLuckCharm, wield, togglePlacing as basculerPosePiege, canPlace, estPosable, tirerLaCape } from './gear'
import { carryView } from './carry'
import { view } from './setup'
import { maDefense } from './plots'
import { theftView, buyFloorFor, buySilo, armSentry, alerter } from './theft'
import { openPrestige } from './prestige-ui'
import { closeMenu } from './menu'

/**
 * Where the purchases live, because a button cannot hold them.
 *
 * Floors, defence and prestige used to sit on the contextual action, alongside placing a
 * base and opening a crate. They do not belong in the same family: opening a crate is caused
 * by standing next to one, while affording a floor is a condition that stays true until the
 * money is spent. So the moment a floor became affordable the button locked onto it and
 * every other action vanished behind it, which is exactly what a player reported.
 *
 * Laid out as FAMILIES rather than as a flat list, which is the second thing this screen got
 * wrong. Five rows in one column read as five unrelated products, three of which had the same
 * sentence under them. A buyer's real question is "what kind of thing is this", and the answer
 * is one of three: it makes the building bigger, it defends it, or it resets it. Each family
 * says once what it is for, and then its rows only have to say what makes them different.
 *
 * Every detail line is measured against the column it sits in, 610 px at caption size. The
 * previous sentry line was 972.
 */

export const shopView = { open: false }

/*
  Sized to the dialog, not to taste.

  The window is capped at `BAND.dialogMaxHeight`, 620, and the old flat list reached 618 of it.
  Three family headers had to come out of that same budget, so the row shrank from 76 to 64:
  the button stays TAP.height regardless, and 34 + 26 still holds a label and a caption. What
  got cut was air, not content. 3 x 38 + 5 x 72 + the window's own padding lands at 620.
*/
const RANG = TAP.rangee - 14
const TITRE_FAMILLE = 34
/** Between rows. Eight read as one block on a phone; a row needs its own air. */
const ENTRE = 18

/** What a defence tier costs this base, mirroring the server's own formula for display. */
function prixTourelle(tier: number): number {
  const t = SENTRY_TIERS[tier]
  const parObjet = view.items === 0 ? 0 : theftView.income / view.items
  return prixParCharge(parObjet, tier) * t.charges
}

/*
  A family is a word, not a sentence.

  Every header carried an explanation ("more shelves, so more earns"), every row carried
  another, and the screen became prose with buttons in it (owner, 1 Sep). The note survives
  only where it reports LIVE state the player cannot see from here, which is the armed floor.
*/
const Famille = (props: { titre: string; note?: string }) => (
  <UiEntity uiTransform={{ width: '100%', height: TITRE_FAMILLE, flexDirection: 'row', alignItems: 'center', margin: { top: 10, bottom: 6 } }}>
    {/* Fixed widths, because a Label given none resolves to nothing in this layout engine. */}
    <Label value={props.titre} fontSize={TYPE.label} color={Color4.fromHexString('#ffd166ff')}
      uiTransform={{ width: 220, height: TITRE_FAMILLE }} textAlign="middle-left" textWrap="nowrap" />
    {props.note !== undefined && (
      <Label value={props.note} fontSize={TYPE.caption} color={C.dim}
        uiTransform={{ width: 810, height: TITRE_FAMILLE }} textAlign="middle-left" textWrap="nowrap" />
    )}
  </UiEntity>
)

const Rang = (props: {
  key?: string
  titre: string
  detail: string
  icone?: string
  bouton: string
  prix: number
  possible: boolean
  onClick: () => void
  /**
   * Why the row cannot act right now, said on the tap. A blue BUY that swallowed the tap
   * taught the player the shop was broken (tester, 4 Sep): a control that does nothing
   * must say why, and a lock must not dress as a button at all.
   */
  refus?: string
}) => (
  <UiEntity
    uiTransform={{
      width: '100%', height: RANG + 14, flexDirection: 'row', alignItems: 'center',
      margin: { bottom: ENTRE - 6 }, padding: { left: 16, right: 10 }, borderRadius: RAD.card
    }}
    uiBackground={{ color: SURF.carte }}
  >
    {/*
      What is dimmed is the button, and nothing else.

      Both the name and the price used to fade when a player could not afford the row, which
      on a fresh account greys out the entire shop: every figure the same colour as every
      caption, and no way to tell a price from a sentence. A price is information you need
      precisely when you cannot pay it, because it is what you are saving towards. The state
      belongs on the control, which is the part that actually stops working.
    */}
    {/* The picture carries what a sentence used to: a player scanning a shop reads shapes. */}
    {props.icone !== undefined && (
      <UiEntity uiTransform={{ width: 52, height: 52, margin: { right: 12 } }}
        uiBackground={{ texture: { src: `assets/ui/${props.icone}` }, textureMode: 'stretch' }} />
    )}
    <UiEntity uiTransform={{ width: '48%', height: RANG, flexDirection: 'column', justifyContent: 'center' }}>
      <Label value={props.titre} fontSize={TYPE.label} color={C.name}
        uiTransform={{ width: '100%', height: 34 }} textAlign="middle-left" textWrap="nowrap" />
      <Label value={props.detail} fontSize={TYPE.caption} color={C.dim}
        uiTransform={{ width: '100%', height: 26 }} textAlign="middle-left" textWrap="nowrap" />
    </UiEntity>
    <Label value={props.prix > 0 ? formatIncome(props.prix) : ''} fontSize={TYPE.label}
      color={C.money}
      uiTransform={{ width: '18%', height: RANG }} textAlign="middle-center" textWrap="nowrap" />
    <UiEntity uiTransform={{ width: '24%', height: TAP.menu, justifyContent: 'flex-end', alignItems: 'center' }}>
      {/* A lock must not dress as a button: LOCKED and OWNED take the quiet chip. */}
      <Btn label={props.bouton} width={200} height={TAP.menu} primary={props.possible}
        skin={props.bouton === 'LOCKED' || props.bouton === 'OWNED' ? 'disabled' : undefined}
        onClick={() => {
          if (props.possible) props.onClick()
          else if (props.refus !== undefined && props.bouton !== 'LOCKED' && props.bouton !== 'OWNED') alerter(props.refus.toUpperCase(), '#ffd166', TOAST.result)
        }} />
    </UiEntity>
  </UiEntity>
)

/*
  What each tool does, in four words.

  The `verb` in the shared table is the long form, written when this row had a whole line to
  itself; on a card beside an icon it is one sentence too many. The short form lives here
  because it is a display decision, not a rule of the game.
*/
const COURT: Record<number, string> = {
  0: 'freezes a thief, 7 s',
  1: '+50% run speed',
  2: 'melee, x2.5 force',
  3: 'invisible, 20 s',
  4: 'everyone nearby drops loot',
  5: 'melee, freezes 3 s',
  6: 'see through cloaks',
  7: 'hidden mine, freezes 3 s'
}

/** The gear rows in the order the ladder opens them, which is the order a player meets them. */
const ECHELLE = [...GEARS].sort((a, b) => a.prestige - b.prestige || a.id - b.id)

function mmss(s: number): string { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

/** Four family headers, the fixed rows, the gear ladder and the charm. The window scrolls past the dialog cap. */
export const HAUTEUR_SHOP = 4 * (TITRE_FAMILLE + 16) + (7 + GEARS.length) * (RANG + 14 + ENTRE - 6)

export const ShopContent = () => {
  if (!shopView.open) return null
  const argent = theftView.coins
  const etage = theftView.floorPrice
  const silo = theftView.siloPrice
  const palierPrestige = theftView.nextPrestige
  const prestige = prestigeTier(theftView.prestige)
  const ici = maDefense()

  return (
    <UiEntity uiTransform={{ width: '100%', height: HAUTEUR_SHOP, flexDirection: 'column' }}>

      {/*
        Prestige first. It was the fifth and last family, below a scroll, so a player who
        never reached the bottom did not know the game had a long-term goal (owner, 4 Sep).
        The reference keeps its rebirth in plain sight; idle games give it its own tab. Here
        it opens the shop, with the distance to its price on the line, so the goal is read
        every time the shop is.
      */}
      <Famille titre="PRESTIGE" />
      <Rang
        titre={`PRESTIGE ${theftView.prestige + 1}`}
        icone="ui-prestige.png"
        detail={argent >= palierPrestige
          ? `x${prestige.multiplier} forever  ·  ready`
          : `x${prestige.multiplier} forever  ·  ${formatIncome(argent)} / ${formatIncome(palierPrestige)}`}
        bouton="OPEN" prix={palierPrestige}
        possible={palierPrestige > 0}
        onClick={() => { closeMenu(); openPrestige() }} />

      <Famille titre="BUILD" />
      <Rang
        titre={etage > 0 ? '+1 FLOOR' : 'FLOORS MAXED'}
        icone="ui-floor.png"
        detail={etage <= 0 ? `${MAX_FLOORS} floors is the cap`
          : theftView.prestige < theftView.floorNeedsPrestige ? `needs prestige ${theftView.floorNeedsPrestige}`
          : 'six more slots'}
        bouton={etage > 0 && theftView.prestige < theftView.floorNeedsPrestige ? 'LOCKED' : 'BUY'} prix={etage}
        possible={etage > 0 && argent >= etage && theftView.prestige >= theftView.floorNeedsPrestige}
        refus={`need ${formatIncome(etage)} coins`}
        onClick={() => { buyFloorFor(); closeMenu() }} />

      {/*
        The offline cap, sold one silo at a time.

        A cap nobody can lift is only a smaller number; the genre sells the lift, and that is
        what makes "you were away" a goal instead of a disappointment (see `SILO_BASE_PRICE`).
        The row says the cap in minutes of production, the unit the player already reads on
        the income line, so the purchase can be compared to a floor without arithmetic.
      */}
      <Rang
        titre={silo > 0 ? `+1 SILO  (${theftView.silos}/${SILO_MAX})` : `SILOS MAXED  (${SILO_MAX}/${SILO_MAX})`}
        icone="ui-silo.png"
        detail={`banks ${Math.round(theftView.offlineCapS / 60)} min away${silo > 0 ? `, then ${Math.round((theftView.offlineCapS + SILO_STEP_S) / 60)}` : ''}`}
        bouton="BUY" prix={silo}
        possible={silo > 0 && argent >= silo}
        refus={`need ${formatIncome(silo)} coins`}
        onClick={() => { buySilo(); closeMenu() }} />

      {/*
        The floor being armed is named ONCE, in the family line, instead of once per row.

        The purchase depends on where the player's feet are, and a button whose effect depends
        on something off-screen is the defect this project keeps finding. But saying "on FLOOR
        3" three times in three rows is what pushed each of them to nine hundred pixels. The
        family says where; the rows say what.
      */}
      <Famille
        titre="DEFEND"
        note={ici === null ? 'stand on the floor to defend' : `floor ${ici.etage + 1}  ·  ${ici.charges} charges`} />
      {SENTRY_TIERS.map((t, i) => {
        const prix = prixTourelle(i)
        const plein = ici !== null && ici.charges >= SENTRY_MAX_CHARGES
        return (
          <Rang key={t.name}
            titre={t.name}
            icone="ui-shield.png"
            detail={t.tithe > 0
              ? `${t.charges} charges  ·  takes ${Math.round(t.tithe * 100)}%`
              : `${t.charges} charges`}
            bouton="ARM" prix={prix}
            possible={ici !== null && !plein && theftView.basePosee && argent >= prix}
            refus={!theftView.basePosee ? 'build your base first' : ici === null ? 'stand on the floor to defend' : plein ? 'this floor holds all the charges it can' : `need ${formatIncome(prix)} coins`}
            onClick={() => { armSentry(i); closeMenu() }} />
        )
      })}

      {/*
        Gear: the family prestige unlocks. Locked rows stay visible, dimmed, with the prestige
        they need on the line, which is the genre's own reveal rule: show the next rung, not
        the whole ladder. The pocket count is on the row, and the SET button hands the act to
        the E button at the player's feet rather than doing it from here.
      */}
      <Famille titre="GEAR" />
      {ECHELLE.map((g) => {
        const prix = prixGear(g.id)
        const debloque = theftView.prestige >= g.prestige
        const held = gearView.held[g.id] ?? 0
        const posable = estPosable(g.id)
        // Worn gear is bought once and then simply held: the row says so instead of offering it again.
        const porte = !posable && held > 0
        const peutPoserCe = canPlace(g.id)
        // The two weapons (slap id 2, taser id 5) are WIELDED from here: tap to hold, tap again for the gun.
        const armeDeG = g.id === 2 ? 'slap' as const : g.id === 5 ? 'taser' as const : null
        const estArme = armeDeG !== null && held > 0
        /*
          The cloak (id 3) is USED from its own row, the way the two weapons are wielded from
          theirs. It was on the draw key, which already draws, so nobody could guess it (owner,
          5 Sep). The contextual button was not an option: it names ONE act at a time and
          everything below it in the chain would have lost its turn. The row that sold it is
          where a pocket item belongs, and it says what it does and whether it is ready.
        */
        const estCape = g.id === 3 && held > 0
        const tenue = estArme && gearView.armeChoisie === armeDeG
        return (
          <Rang key={g.name}
            titre={estCape ? `${g.name}  \u00b7  ${gearView.cloaked ? 'INVISIBLE' : 'READY'}` : estArme ? `${g.name}  ·  ${tenue ? 'WIELDING' : 'OWNED'}` : porte ? `${g.name}  ·  WORN` : held > 0 ? `${g.name}  x${held}` : g.name}
            icone={`ui-gear-${g.id}.png`}
            detail={debloque ? (COURT[g.id] ?? g.verb) : `needs prestige ${g.prestige}`}
            bouton={!debloque ? 'LOCKED' : estCape ? 'GO INVISIBLE' : estArme ? (tenue ? 'HOLD GUN' : 'WIELD') : porte ? 'OWNED' : peutPoserCe ? 'SET' : 'BUY'}
            prix={estCape || estArme || porte || peutPoserCe ? 0 : prix}
            possible={debloque && (estCape ? !gearView.cloaked && carryView.code < 0 : estArme || (!porte && (posable && held > 0 ? peutPoserCe : argent >= prix)))}
            refus={estCape ? (gearView.cloaked ? 'already invisible' : 'not while carrying something') : posable && held > 0 && !peutPoserCe ? 'stand where it can be set' : `need ${formatIncome(prix)} coins`}
            onClick={() => {
              if (estCape) { tirerLaCape(); closeMenu() }
              else if (estArme) { wield(tenue ? 'shoot' : (armeDeG as 'slap' | 'taser')); closeMenu() }
              else if (peutPoserCe) { basculerPosePiege(g.id); closeMenu() }
              else if (!porte) acheterGear(g.id)
            }} />
        )
      })}
      {/* Luck is the one thing here that is bought by the quarter hour, so its row shows the clock. */}
      <Rang key="luck"
        titre={theftView.luckSec > 0 ? `LUCKY CHARM  ·  ${mmss(theftView.luckSec)} LEFT` : 'LUCKY CHARM'}
        icone="ui-luck.png"
        detail={`x2 mutations, ${Math.round(LUCK_MS / 60000)} min`}
        bouton="BUY" prix={theftView.luckPrice}
        possible={theftView.luckPrice > 0 && argent >= theftView.luckPrice}
        refus={`need ${formatIncome(theftView.luckPrice)} coins`}
        onClick={() => buyLuckCharm()} />
    </UiEntity>
  )
}
