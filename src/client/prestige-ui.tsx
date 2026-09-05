import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { TYPE, C, TAP, SKIN } from './theme'
import { Glyphs, glyphWidth } from './glyphs'
import { Btn, SURF } from './ui-kit'
import { theftView, doPrestige, pinItem } from './theft'
import { mesPieces } from './plots'
import { formatIncome, RARITIES, nomDuCode, rarityOf, mutationDe, itemColor } from '../shared/loot-table'
import { prestigeTier, incomeMultiplier, REBIRTH_MAX } from '../shared/schemas'
import { PRESTIGE_CASH_SHARE } from '../shared/economy'

export const prestigeView = { open: false }
export function openPrestige(): void { prestigeView.open = true }
export function closePrestige(): void { prestigeView.open = false }

/**
 * The one screen that asks before it acts, rewritten because it was describing another game.
 *
 * Three statements were wrong and all three pushed the same way, against ever pressing it.
 *
 * It promised a rarity floor. `Rare, the worst you can roll` sat under a heading that read
 * UNLOCKS, and nothing in this game floors a roll: `rollCrate` takes a crate id, reads that
 * tier's weights and rolls, with no input from prestige anywhere. Worse, the number printed
 * means the opposite of what the card claimed. `minRarity` is the ENTRY REQUIREMENT, the
 * rarity you must already own to be allowed to prestige at all. A cost was sold as a reward.
 *
 * It said the coins were reset. `tenterRebirth` does `p.coins -= exige.cost`: it charges a
 * price and leaves the change. Somebody holding ten million read that as losing ten million,
 * when the loss is two and a half.
 *
 * It said everything on the base goes. The best `guard` items are kept, one at first and two
 * from the third tier on, and floors, sentries and crates are never touched.
 *
 * The shape stays, because the shape was right: what you get, what it costs, what it takes
 * away, one control that commits. Only the content is now what the server actually does.
 */
/*
  Laid out the way the genre lays out a rebirth: one hero figure, the price under it, what
  stays and what goes as two short lines, one gold control. It was three headed sections of
  cards each carrying a sentence, then two more sentences in amber: a form to read, not a
  moment to want (owner, 3 Sep). Every figure still comes from `prestigeTier`, the function
  the server decides with.
*/
const Chip = (props: { width: number; height: number; children?: ReactEcs.JSX.Element | ReactEcs.JSX.Element[]; right?: number }) => (
  <UiEntity
    uiTransform={{
      width: props.width, height: props.height, margin: props.right !== undefined ? { right: props.right } : undefined,
      flexDirection: 'column', justifyContent: 'center', alignItems: 'center'
    }}
    uiBackground={SKIN.card}
  >
    {props.children}
  </UiEntity>
)

const KEEP = Color4.fromHexString('#8fe08fff')

export const PrestigePanel = () => {
  if (!prestigeView.open) return <UiEntity uiTransform={{ width: 0, height: 0 }} />

  const palier = prestigeTier(theftView.prestige)
  const max = theftView.prestige >= REBIRTH_MAX
  const cout = theftView.nextPrestige
  const exige = RARITIES[palier.minRarity]
  const maintenant = incomeMultiplier(theftView.prestige)

  const assezDeCoins = cout > 0 && theftView.coins >= cout
  const aLObjet = theftView.bestRarity >= palier.minRarity
  const pret = !max && assezDeCoins && aLObjet

  // The button names what is missing: a control that offers what the server will refuse
  // is a defect this project has already written down once.
  const manque = max ? 'MAX PRESTIGE'
    : !assezDeCoins ? 'NEED MORE COINS'
    : `NEED ${(exige?.name ?? '').toUpperCase()}`
  const mange = theftView.prestigeEats >= 0
    ? nomDuCode(theftView.prestigeEats).toUpperCase()
    : `${(exige?.name ?? '').toUpperCase()} OR BETTER`

  return (
    <UiEntity
      uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center', pointerFilter: 'block' }}
      uiBackground={{ color: SURF.voile }}
    >
      <UiEntity
        uiTransform={{ width: 940, height: 600, flexDirection: 'column', alignItems: 'center', padding: 22 }}
        uiBackground={SKIN.panel}
      >
        {/*
          The badge and the word, as ONE centred group. The glyph text draws itself at the
          left of whatever box holds it, so beside a centred row it sat in the corner while
          the star sat in the middle (owner, 4 Sep): the box is now exactly the text's width,
          and the star carries the level it is about to reach, so one star never reads as
          "prestige one" on the screen for prestige two.
        */}
        <UiEntity uiTransform={{ width: '100%', height: 64, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', margin: { bottom: 8 } }}>
          {/*
            The star carries no number any more.

            It wore one, small and dark, and it was never legible: measured on the file, the
            star's ink sits between y 22 and 217 of a 256 box, so its visual centre is ABOVE
            the box centre while the label was nudged three pixels BELOW it, and a caption on
            a sixty pixel badge is too small to read at any position (owner, 4 and 5 Sep,
            twice). The number is also said, in full, two centimetres to the right: PRESTIGE 5
            in title glyphs. A badge and a heading saying the same number is the duplication
            this interface removes everywhere else, so the badge keeps the meaning and the
            heading keeps the number.
          */}
          <UiEntity uiTransform={{ width: 60, height: 60, margin: { right: 14 } }}
            uiBackground={{ texture: { src: 'assets/ui/ui-prestige.png' }, textureMode: 'stretch' }} />
          <UiEntity uiTransform={{ width: glyphWidth(`PRESTIGE ${theftView.prestige + 1}`, TYPE.title), height: TYPE.title + 8 }}>
            <Glyphs value={`PRESTIGE ${theftView.prestige + 1}`} size={TYPE.title} role="bonus" />
          </UiEntity>
        </UiEntity>

        {/* The hero: the multiplier you have, and the one you would have. */}
        <UiEntity uiTransform={{ width: '100%', height: 140, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', margin: { bottom: 6 } }}>
          <Chip width={220} height={124} right={TAP.gap}>
            <Label value={`x${maintenant}`} fontSize={TYPE.title} color={C.dim}
              uiTransform={{ width: '100%', height: 64 }} textAlign="middle-center" textWrap="nowrap" />
            <Label value="NOW" fontSize={TYPE.caption} color={C.dim}
              uiTransform={{ width: '100%', height: 30 }} textAlign="middle-center" />
          </Chip>
          <Chip width={300} height={140}>
            <Label value={`x${palier.multiplier}`} fontSize={TYPE.hero} color={C.money}
              uiTransform={{ width: '100%', height: 84 }} textAlign="middle-center" textWrap="nowrap" />
            <Label value="AFTER" fontSize={TYPE.caption} color={C.bonus}
              uiTransform={{ width: '100%', height: 30 }} textAlign="middle-center" />
          </Chip>
        </UiEntity>
        <Label value="ON EVERYTHING YOU EARN, FOR GOOD" fontSize={TYPE.caption} color={C.dim}
          uiTransform={{ width: '100%', height: 30, margin: { bottom: 12 } }} textAlign="middle-center" />

        {/* The price: coins, and one item eaten. Red where the player falls short. */}
        <UiEntity uiTransform={{ width: '100%', height: 96, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', margin: { bottom: 12 } }}>
          <Chip width={300} height={96} right={TAP.gap}>
            <Label value={formatIncome(cout)} fontSize={TYPE.title} color={assezDeCoins ? C.money : C.danger}
              uiTransform={{ width: '100%', height: 54 }} textAlign="middle-center" textWrap="nowrap" />
            <Label value="COINS" fontSize={TYPE.caption} color={C.dim}
              uiTransform={{ width: '100%', height: 28 }} textAlign="middle-center" />
          </Chip>
          <UiEntity
            uiTransform={{ width: 440, height: 96, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}
            uiBackground={SKIN.card}
          >
            <UiEntity uiTransform={{ width: 60, height: 60, margin: { right: 12 } }}
              uiBackground={{ texture: { src: `assets/ui/toy-${palier.minRarity}.png` }, textureMode: 'stretch' }} />
            {/* 340 wide: the caption is 23 capitals, and 250 cut it at SHEL (owner, 4 Sep). */}
            <UiEntity uiTransform={{ width: 340, height: 84, flexDirection: 'column', justifyContent: 'center' }}>
              <Label value={mange} fontSize={TYPE.label} color={aLObjet ? C.money : C.danger}
                uiTransform={{ width: '100%', height: 40 }} textAlign="middle-left" textWrap="nowrap" />
              <Label value="IS EATEN" fontSize={TYPE.caption} color={C.dim}
                uiTransform={{ width: '100%', height: 28 }} textAlign="middle-left" textWrap="nowrap" />
            </UiEntity>
          </UiEntity>
        </UiEntity>

        {/*
          Your shelves, and one tap to save one of them.

          The first try put a KEEP button on the line that names the eaten toy, and it failed
          on its own terms: the word did not say what would change, and a player with a full
          base could not see WHICH pieces were at stake, let alone pick a favourite (owner,
          5 Sep). A row of the pieces themselves answers both at a glance: the one prestige is
          about to eat wears a red ring, the one you saved wears a gold one, and a tap moves
          the gold ring. Nothing is written that the rings do not already say.
        */}
        <UiEntity uiTransform={{ width: 660, height: 30, margin: { bottom: 4 } }}>
          <Label value={theftView.pinned >= 0 ? 'TAP A PIECE TO SAVE IT  ·  GOLD IS SAFE' : 'TAP A PIECE TO SAVE IT FROM PRESTIGE'}
            fontSize={TYPE.caption} color={C.dim}
            uiTransform={{ width: '100%', height: 30 }} textAlign="middle-center" textWrap="nowrap" />
        </UiEntity>
        <UiEntity uiTransform={{
          width: 660, height: 116, flexDirection: 'row', flexWrap: 'wrap',
          justifyContent: 'center', alignItems: 'center', margin: { bottom: 10 }
        }}>
          {mesPieces().slice(0, 24).map((code: number, i: number) => {
            const garde = theftView.pinned === code
            const mangee = theftView.prestigeEats === code && !garde
            const teinte = Color4.fromHexString(itemColor(rarityOf(code), mutationDe(code)) + 'ff')
            return (
              <UiEntity key={i}
                uiTransform={{
                  width: 52, height: 52, margin: { right: 4, bottom: 4 },
                  justifyContent: 'center', alignItems: 'center', pointerFilter: 'block',
                  borderWidth: garde || mangee ? 3 : 0, borderRadius: 12,
                  borderColor: garde ? C.money : C.danger
                }}
                uiBackground={{ ...SKIN.inset, color: teinte }}
                onMouseDown={() => pinItem(code)}
              >
                <UiEntity uiTransform={{ width: 40, height: 40 }}
                  uiBackground={{ texture: { src: `assets/ui/toy-${rarityOf(code)}.png` }, textureMode: 'stretch' }} />
              </UiEntity>
            )
          })}
        </UiEntity>

        {/* What stays and what goes, one line each, no sentence. */}
        <UiEntity uiTransform={{ width: 660, height: 62, flexDirection: 'column', margin: { bottom: 14 } }}>
          <UiEntity uiTransform={{ width: '100%', height: 30, flexDirection: 'row', alignItems: 'center' }}>
            <Label value="KEEP" fontSize={TYPE.caption} color={KEEP}
              uiTransform={{ width: 70, height: 30 }} textAlign="middle-left" />
            <Label value={`best ${palier.guard === 1 ? 'item' : palier.guard + ' items'}  ·  floors  ·  sentries  ·  crates  ·  gear`} fontSize={TYPE.caption} color={C.name}
              uiTransform={{ width: 590, height: 30 }} textAlign="middle-left" textWrap="nowrap" />
          </UiEntity>
          <UiEntity uiTransform={{ width: '100%', height: 30, flexDirection: 'row', alignItems: 'center' }}>
            <Label value="LOSE" fontSize={TYPE.caption} color={C.danger}
              uiTransform={{ width: 70, height: 30 }} textAlign="middle-left" />
            <Label value={`every other item  ·  coins above ${formatIncome(cout * PRESTIGE_CASH_SHARE)}`} fontSize={TYPE.caption} color={C.name}
              uiTransform={{ width: 590, height: 30 }} textAlign="middle-left" textWrap="nowrap" />
          </UiEntity>
        </UiEntity>

        <UiEntity uiTransform={{ width: 660, height: TAP.height, flexDirection: 'row', justifyContent: 'center' }}>
          <Btn label={pret ? 'PRESTIGE' : manque} width={400} primary={pret}
            right={TAP.gap} onClick={() => { if (pret) { doPrestige(); closePrestige() } }} />
          <Btn label="BACK" width={200} onClick={closePrestige} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
