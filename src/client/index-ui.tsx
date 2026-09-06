import { Color4 } from '@dcl/sdk/math'
import { sendOrHold } from './intent'
import { strip } from './layout'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { TYPE, TAP, RAD, lisible } from './theme'
import { RARITIES, MUTATIONS, encoder, itemColor, progresDuSkin, skinDebloque, SKIN_NEEDS } from '../shared/loot-table'
import { room } from '../shared/messages'
import { tic } from './ui-kit'
import { noterServi } from './clics'

export const indexView = { open: false, vus: [] as number[], skin: 0 }

export function basculerIndex(): void { indexView.open = !indexView.open }

// 26, from 30: the four units a row gives back are what two rows of thumb-sized skin chips
// need under the grid, with the whole tab still inside the window's body (474) and nothing
// to scroll (owner, 6 Sep: the grid stays visible at all times).
const CASE = 26
const GAP = 3
/*
  The box is the sum of what goes in it, not a guess with a round number added.

  It was `MUTATIONS.length * (CASE + GAP) + 130` wide, where the 130 was meant to cover the
  rarity label at the start of each row. That label is 184, and the padding another 24, so
  every row ran seventy-eight pixels past its own container. The height was short by
  twenty-six for the same reason. Both are now added up from the pieces, so a new rarity or
  a new mutation resizes the panel instead of overflowing it.
*/
const LABEL_W = 184
const PAD = 12
const TITRE_H = 44
const PIED_H = 34
const PANEL_W = PAD * 2 + LABEL_W + MUTATIONS.length * (CASE + GAP)
const PANEL_H = PAD * 2 + TITRE_H + RARITIES.length * (CASE + GAP) + PIED_H

/** The grid plus its two labels, which is what the window is asked to make room for. */
/** The skin row under the grid: the buttons for the columns that are full, the count for the nearest ones. */
/**
 * A skin chip is a thumb target: 80 by 72 units is 7.6 by 6.8 mm on the reference handset
 * (0.095 mm a unit), at the floor the platform guidelines set. Fourteen of them go on two
 * rows of seven, all visible, nothing to scroll.
 */
const PUCE_L = 80
const PUCE_H = 72
const PUCE_GAP = 8
const SKINS_H = PUCE_H * 2 + PUCE_GAP
const DOTS_H = 20
export const HAUTEUR_INDEX = TITRE_H + DOTS_H + RARITIES.length * (CASE + GAP) + PIED_H + SKINS_H

export const IndexContent = () => {
  if (!indexView.open) return null
  const vus = new Set(indexView.vus)
  const total = RARITIES.length * MUTATIONS.length

  return (
    <UiEntity uiTransform={{ width: '100%', height: HAUTEUR_INDEX, flexDirection: 'column' }}>
      <Label
        uiTransform={{ width: '100%', height: TITRE_H }}
        value={`COLLECTION  ${vus.size} / ${total}`}
        fontSize={TYPE.body}
        color={Color4.fromHexString('#ffd166ff')} />

      {/*
        A colour over every column that HAS one, and nothing over the one that does not.

        The first column is "no mutation", whose colour is the empty string, and it came out
        as a black bar at the head of the grid. Worse, a full row of dots read as if it were
        about the rarities: the owner took the leftmost for Common and the rightmost for
        Secret twice (1 Sep). Leaving the first column bare says what it is, and the coloured
        dots then unmistakably belong to the mutations that own them.
      */}
      <UiEntity uiTransform={{ width: '100%', height: DOTS_H, flexDirection: 'row', alignItems: 'center' }}>
        <UiEntity uiTransform={{ width: LABEL_W, height: DOTS_H }} />
        {MUTATIONS.map((m) => (
          <UiEntity key={`h${m.id}`}
            uiTransform={{ width: CASE, height: 10, margin: { right: GAP }, borderRadius: 5 }}
            uiBackground={m.id === 0 ? undefined : { color: Color4.fromHexString(lisible(m.color) + 'ff') }} />
        ))}
      </UiEntity>
      {RARITIES.map((r) => (
        <UiEntity key={r.id} uiTransform={{ height: CASE + GAP, flexDirection: 'row', alignItems: 'center' }}>
          <Label
            value={r.name}
            fontSize={TYPE.caption}
            color={Color4.fromHexString(lisible(r.color) + 'ff')}
            uiTransform={{ width: LABEL_W, height: CASE }} />
          {MUTATIONS.map((m) => {
            const trouve = vus.has(encoder(r.id, m.id))
            return (
              <UiEntity
                key={m.id}
                uiTransform={{ width: CASE, height: CASE, margin: { right: GAP } }}
                uiBackground={{
                  color: trouve
                    ? Color4.fromHexString(lisible(itemColor(r.id, m.id)) + 'ff')
                    : Color4.create(1, 1, 1, 0.06)
                }} />
            )
          })}
        </UiEntity>
      ))}

      <Label
        uiTransform={{ width: '100%', height: PIED_H }}
        value={`BASE SKIN  ·  ${indexView.skin > 0 ? MUTATIONS[indexView.skin].name.toUpperCase() : 'NONE'}      ·      ${SKIN_NEEDS} of ${RARITIES.length} in a column unlocks that skin`}
        fontSize={TYPE.caption}
        color={Color4.fromHexString('#7d8798ff')} />
      {/*
        One family of chips, unlocked and locked alike, because two different species on one
        line read as clutter (owner, 1 Sep: a mystery DIAMOND SKIN button beside bare text).
        Every chip is a plate: BASE SKIN leads the row as its label, an unlocked chip is
        pressable and says ON when worn, a locked one wears the greyed plate with its x/7.
        The worn skin flips LOCALLY before the server answers: the old round trip was the
        "several taps to change state" the owner reported.
      */}
      {/*
        Colour chips, not word plates. Fourteen plates of 220 in a row of a thousand were
        crushed to fifty each and their words ran behind their neighbours the moment the
        collection was full (owner, 6 Sep). The grid above already names each mutation by a
        colour chip at the head of its column; the skin row speaks the same language: one chip
        per mutation in its own colour, the worn one ringed in white, a locked one in grey
        with its count, and the worn skin's name written once, in the row's label. Fourteen
        chips of 48 fit any width the window can have.
      */}
      <UiEntity uiTransform={{ width: '100%', height: SKINS_H, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
        {MUTATIONS.filter((m) => m.id > 0).map((m) => {
          const ouvert = skinDebloque(indexView.vus, m.id)
          const porte = indexView.skin === m.id
          return (
            <UiEntity key={`s${m.id}`}
              uiTransform={{
                width: PUCE_L, height: PUCE_H, margin: { right: PUCE_GAP, bottom: PUCE_GAP }, borderRadius: 14,
                borderWidth: porte ? 5 : 0, borderColor: Color4.White(),
                justifyContent: 'center', alignItems: 'center', pointerFilter: 'block'
              }}
              uiBackground={{ color: ouvert ? Color4.fromHexString(m.color + 'ff') : Color4.create(0.22, 0.25, 0.32, 1) }}
              onMouseDown={ouvert ? () => {
                noterServi(`skin-${m.id}`)
                tic()
                const cible = porte ? 0 : m.id
                indexView.skin = cible
                sendOrHold(() => { void room.send('setSkin', { mutation: cible }) })
              } : undefined}
            >
              {!ouvert && (
                <Label value={`${progresDuSkin(indexView.vus, m.id)}/${RARITIES.length}`} fontSize={TYPE.caption}
                  color={Color4.fromHexString('#7d8798ff')} uiTransform={{ width: PUCE_L, height: PUCE_H }}
                  textAlign="middle-center" textWrap="nowrap" />
              )}
            </UiEntity>
          )
        })}
      </UiEntity>
    </UiEntity>
  )
}
