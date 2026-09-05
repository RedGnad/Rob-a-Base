import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { TYPE, C, TAP, SKIN } from './theme'
import { Glyphs, glyphWidth } from './glyphs'
import { Btn, SURF } from './ui-kit'
import { theftView, doPrestige } from './theft'
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
/** Big enough that two digits sit inside the star's waist, which is 0.60 of its width. */
const BADGE = 76

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
  // The badge's own figure, and the piece the server spares. Both are read, never chosen.
  const niveau = theftView.prestige + 1
  const chiffre = niveau >= 10 ? 32 : 42
  const sauve = theftView.spared
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
        {/* The row is the badge's height, or a 76 pixel star sits in a 64 pixel line. */}
        <UiEntity uiTransform={{ width: '100%', height: BADGE, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', margin: { bottom: 8 } }}>
          {/*
            The star carries the level, placed on the star's own ink rather than on its box.

            Two attempts put a platform Label in the badge and both sat wrong, because both
            centred against the wrong thing: the star's ink runs from y 22 to y 218 of a 256
            box, so its optical centre is at 0.469 of the height, not 0.5, and a caption at
            badge size is unreadable wherever you put it (owner, 4 and 5 Sep). Removing the
            number was worse: an empty badge (owner, 5 Sep, third report).

            So it is drawn in the game's own face, big, and both centres are measured off the
            files rather than guessed. A digit's ink occupies 0.215 to 0.738 of its cell, so
            its middle is 0.4765 of the glyph size below the text box top, and the star's is
            0.469 of the badge height: the difference between those two is the offset below.
            The star's waist is 0.60 of its width, which two digits at 32 fit and one at 42
            fills. The heading beside it no longer repeats the figure.
          */}
          <UiEntity uiTransform={{ width: BADGE, height: BADGE, margin: { right: 14 } }}
            uiBackground={{ texture: { src: 'assets/ui/ui-prestige.png' }, textureMode: 'stretch' }}>
            <Glyphs value={String(niveau)} size={chiffre} role="ink" align="center" box={BADGE}
              top={Math.round(0.469 * BADGE - 0.4765 * chiffre)} />
          </UiEntity>
          <UiEntity uiTransform={{ width: glyphWidth('PRESTIGE', TYPE.title), height: TYPE.title + 8 }}>
            <Glyphs value="PRESTIGE" size={TYPE.title} role="bonus" />
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
          What prestige spares, stated, never chosen.

          Two interfaces were built to let a player protect one piece, a KEEP button and a
          strip of every piece owned. The owner rejected both, the second in the terms that
          settle it: slow, confusing, and far too small to read on a phone, and better to have
          no choice at all than a screenful of tiny targets (5 Sep). Mobile guidance says the
          same, minimise options and show only what is needed now.

          So the server keeps the rarest MUTATION on the shelves, from the jaws and from the
          cull alike, and this line says which one. It appears only when there is one to
          spare, and never when that piece is the toy being eaten, which happens when it is
          the only piece that can pay the rung.
        */}
        {sauve >= 0 && sauve !== theftView.prestigeEats && (
          <UiEntity uiTransform={{ width: 752, height: 84, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', margin: { bottom: 12 } }}>
            <UiEntity
              uiTransform={{ width: 440, height: 84, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}
              uiBackground={SKIN.card}
            >
              <UiEntity uiTransform={{ width: 52, height: 52, margin: { right: 12 } }}
                uiBackground={{
                  texture: { src: `assets/ui/toy-${rarityOf(sauve)}.png` }, textureMode: 'stretch',
                  color: Color4.fromHexString(itemColor(rarityOf(sauve), mutationDe(sauve)) + 'ff')
                }} />
              <UiEntity uiTransform={{ width: 340, height: 76, flexDirection: 'column', justifyContent: 'center' }}>
                <Label value={nomDuCode(sauve).toUpperCase()} fontSize={TYPE.label} color={KEEP}
                  uiTransform={{ width: '100%', height: 38 }} textAlign="middle-left" textWrap="nowrap" />
                <Label value="IS SAFE, YOUR RAREST" fontSize={TYPE.caption} color={C.dim}
                  uiTransform={{ width: '100%', height: 26 }} textAlign="middle-left" textWrap="nowrap" />
              </UiEntity>
            </UiEntity>
          </UiEntity>
        )}

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
