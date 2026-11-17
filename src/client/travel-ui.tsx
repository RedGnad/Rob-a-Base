import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Btn } from './ui-kit'
import { travelView, rentrer, goToBelt } from './travel'
import { theftView } from './theft'
import { slotView, togglePlacing } from './slots'
import { closeMenu } from './menu'
import { openRevenges, takeRevenge } from './away'

/**
 * Getting around, as a panel rather than a row of buttons under the thumb.
 *
 * These four controls used to live in a strip across the bottom of the screen, expanding
 * as they were needed: TRAVEL, then GO HOME, TO BELT and MOVE beside it. Laid end to end
 * they came to roughly eight hundred and sixty pixels inside a container of seven hundred
 * and sixty, so the last of them hung off its own frame. The deeper problem is that they
 * were on screen during play at all: a player travels a handful of times in a session and
 * shoots continuously, and the two were competing for the same corner.
 *
 * So travel moved behind the menu, where a rare action belongs, and the room it freed at
 * the bottom went back to the game. Each entry is a full-width row with its own line of
 * explanation, which is what the space allows once four controls stop fighting for it.
 */

const LARGEUR = 720
const RANG = 96
const ENTRE = 20

/*
  Three destinations and no captions. Each button carried a line under it ("back to your
  own base", "where the crates come past") that said again what the button already said,
  and a WHERE TO heading that said again what the TRAVEL tab already said; the three
  buttons also sat against the left edge of a body twice their width (owner, 3 Sep). What
  is left is centred in the body, both ways.
*/
const Rang = (props: { label: string; primary?: boolean; skin?: 'danger'; onClick: () => void }) => (
  <UiEntity uiTransform={{ width: LARGEUR, height: RANG, margin: { bottom: ENTRE } }}>
    <Btn label={props.label} width={LARGEUR} primary={props.primary} skin={props.skin} onClick={props.onClick} />
  </UiEntity>
)

/** Four rows, the most it can ever be: the three destinations and one revenge. */
export const HAUTEUR_TRAVEL = 4 * (RANG + ENTRE)

export const TravelContent = () => {
  if (!travelView.open) return null
  /*
    The latest thief you may still rob back, as a destination. One row, not a list: the tab
    holds four and a player rarely owes more than one visit at a time; the away report shows
    the rest. The time left is on the away report and the toast, so the row stays a place.
  */
  const revenges = openRevenges()
  const revenge = revenges.length > 0 ? revenges.reduce((a, b) => (b.until > a.until ? b : a)) : undefined
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
      <Rang label="GO HOME" primary={travelView.peutRentrer}
        onClick={() => { rentrer(); closeMenu() }} />
      <Rang label="TO BELT"
        onClick={() => { goToBelt(); closeMenu() }} />
      {theftView.basePosee && (
        <Rang label={slotView.active ? 'CANCEL MOVE' : 'MOVE MY BASE'} primary={slotView.active}
          onClick={() => { togglePlacing(); closeMenu() }} />
      )}
      {revenge !== undefined && (
        <Rang label={`REVENGE ON ${revenge.name.toUpperCase()}`} skin="danger"
          onClick={() => { takeRevenge(revenge.id); closeMenu() }} />
      )}
    </UiEntity>
  )
}
