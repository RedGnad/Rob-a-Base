import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { TYPE, C, TAP, SKIN } from './theme'
import { Glyphs, glyphWidth } from './glyphs'
import { Btn, SURF } from './ui-kit'
import { theftView, doPrestige } from './theft'
import { toyImage } from './toy'
import { formatIncome, RARITIES, nomDuCode, rarityOf, mutationDe, itemOdds } from '../shared/loot-table'
import { prestigeTier, incomeMultiplier, REBIRTH_MAX } from '../shared/schemas'
import { PRESTIGE_CASH_SHARE } from '../shared/economy'
import { chooseTab } from './menu'

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
/** The grid: two cards a row, one measure of air everywhere. */
const CARTE = 430
const CARTE_H = 104
const AIR = 18
const Carte = (props: { children?: ReactEcs.JSX.Element | ReactEcs.JSX.Element[]; right?: number; row?: boolean }) => (
  <UiEntity
    uiTransform={{
      width: CARTE, height: CARTE_H, margin: props.right !== undefined ? { right: props.right } : undefined,
      flexDirection: props.row === true ? 'row' : 'column', justifyContent: 'center', alignItems: 'center',
      padding: props.row === true ? { left: 16, right: 16 } : undefined
    }}
    uiBackground={SKIN.card}
  >
    {props.children}
  </UiEntity>
)

const KEEP = Color4.fromHexString('#8fe08fff')

/*
  Thousands, grouped by hand.

  `toLocaleString` is the obvious call and it is not one to make here: the scene runs in a
  QuickJS sandbox with no guarantee of an Intl table behind it, so the separator it returns is
  whatever that build happens to carry, which on a phone could be nothing at all. Four lines
  that cannot be wrong beat one line that might be.
*/
function milliers(n: number): string {
  const s = String(Math.round(n))
  let out = ''
  for (let i = 0; i < s.length; i++) out += (i > 0 && (s.length - i) % 3 === 0 ? ',' : '') + s[i]
  return out
}
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
        uiTransform={{ width: CARTE * 2 + AIR + 44, height: 604, flexDirection: 'column', alignItems: 'center', padding: 22 }}
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

        {/*
          Four cards on one grid, and air between them.

          The panel had grown a card per idea, each sized to the idea rather than to the grid:
          a 220 chip beside a 300 one, a 300 beside a 440, two rows that did not line up and no
          gap worth the name, under two lines of prose. It read as a form (owner, 5 Sep). Now
          every card is the same object, `CARTE` wide and `CARTE_H` tall, two to a row, with the
          same air above, below and between; only the TYPE says which one matters, gold and
          large for the multiplier you are buying. The last card runs the full width because
          what it says is one sentence, not a figure.
        */}
        <UiEntity uiTransform={{ width: '100%', height: CARTE_H, flexDirection: 'row', justifyContent: 'center', margin: { bottom: AIR } }}>
          <Carte right={AIR}>
            <Label value={`x${maintenant}`} fontSize={TYPE.title} color={C.dim}
              uiTransform={{ width: '100%', height: 58 }} textAlign="middle-center" textWrap="nowrap" />
            <Label value="NOW" fontSize={TYPE.caption} color={C.dim}
              uiTransform={{ width: '100%', height: 28 }} textAlign="middle-center" />
          </Carte>
          <Carte>
            {/*
              Title size, not hero: a seventy-two point figure in a sixty-two tall box ran
              over the caption under it on the phone (tester's screenshot, 6 Sep). The two
              multipliers now share one size and one box, and gold alone says which matters.
            */}
            <Label value={`x${palier.multiplier}`} fontSize={TYPE.title} color={C.money}
              uiTransform={{ width: '100%', height: 58 }} textAlign="middle-center" textWrap="nowrap" />
            <Label value="AFTER, ON EVERYTHING YOU EARN" fontSize={TYPE.caption} color={C.bonus}
              uiTransform={{ width: '100%', height: 28 }} textAlign="middle-center" textWrap="nowrap" />
          </Carte>
        </UiEntity>

        {/* What it costs: coins on the left, the toy it eats on the right. */}
        <UiEntity uiTransform={{ width: '100%', height: CARTE_H, flexDirection: 'row', justifyContent: 'center', margin: { bottom: AIR } }}>
          <Carte right={AIR}>
            <Label value={formatIncome(cout)} fontSize={TYPE.title} color={assezDeCoins ? C.money : C.danger}
              uiTransform={{ width: '100%', height: 58 }} textAlign="middle-center" textWrap="nowrap" />
            <Label value="COINS" fontSize={TYPE.caption} color={C.dim}
              uiTransform={{ width: '100%', height: 28 }} textAlign="middle-center" />
          </Carte>
          <Carte row>
            <UiEntity uiTransform={{ width: 56, height: 56, margin: { right: 14 } }}
              uiBackground={{ texture: { src: `assets/ui/toy-${palier.minRarity}.png` }, textureMode: 'stretch' }} />
            <UiEntity uiTransform={{ width: CARTE - 90, height: 72, flexDirection: 'column', justifyContent: 'center' }}>
              <Label value={mange} fontSize={TYPE.label} color={aLObjet ? C.money : C.danger}
                uiTransform={{ width: '100%', height: 38 }} textAlign="middle-left" textWrap="nowrap" />
              <Label value="IS EATEN" fontSize={TYPE.caption} color={C.dim}
                uiTransform={{ width: '100%', height: 26 }} textAlign="middle-left" textWrap="nowrap" />
            </UiEntity>
          </Carte>
        </UiEntity>

        {/*
          What prestige spares, and the odds that make it the rarest.

          Rarest is not the biggest multiplier: it is the product of the two draws that made
          the piece, the rung and the mutation, which `itemOdds` reads straight from the loot
          tables. Saying the number out loud is also the only proof the player gets that the
          panel picked the right one (owner, 5 Sep: a Divine Epic offered while a Cursed Secret
          stood on the shelves, and the Cursed Secret is three times rarer).
        */}
        {sauve >= 0 && sauve !== theftView.prestigeEats && (
          <UiEntity
            uiTransform={{
              width: CARTE * 2 + AIR, height: 82, flexDirection: 'row', alignItems: 'center',
              padding: { left: 18, right: 18 }, margin: { bottom: AIR }
            }}
            uiBackground={SKIN.card}
          >
            {/*
              The piece itself, not a silhouette painted over.

              This drew `toy-<rarity>.png` multiplied by the item's colour, and the two worst
              cases were exactly the ones this line exists to show: a Secret is rendered white,
              so multiplying it by the Cursed violet left a flat violet blob with no surface at
              all (owner, 5 Sep: "on dirait une couleur unie"). There is now a picture per
              rarity AND mutation, rendered from `item-<r>-<m>.glb` with its own baked surface,
              so nothing has to be tinted afterwards.
            */}
            <UiEntity uiTransform={{ width: 52, height: 52, margin: { right: 14 } }}
              uiBackground={{
                texture: { src: `assets/ui/${toyImage(rarityOf(sauve), mutationDe(sauve), true)}.png` },
                textureMode: 'stretch'
              }} />
            <Label value={nomDuCode(sauve).toUpperCase()} fontSize={TYPE.label} color={KEEP}
              uiTransform={{ height: 40, margin: { right: 16 } }} textAlign="middle-left" textWrap="nowrap" />
            <Label value={`IS SAFE  ·  YOUR RAREST, 1 IN ${milliers(itemOdds(sauve))}`}
              fontSize={TYPE.caption} color={C.dim}
              uiTransform={{ height: 30 }} textAlign="middle-left" textWrap="nowrap" />
          </UiEntity>
        )}

        {/* What stays and what goes, one line each, no sentence. */}
        <UiEntity uiTransform={{ width: CARTE * 2 + AIR, height: 58, flexDirection: 'column', margin: { bottom: AIR } }}>
          <UiEntity uiTransform={{ width: '100%', height: 28, flexDirection: 'row', alignItems: 'center' }}>
            <Label value="KEEP" fontSize={TYPE.caption} color={KEEP}
              uiTransform={{ width: 70, height: 28 }} textAlign="middle-left" />
            <Label value={`best ${palier.guard === 1 ? 'item' : palier.guard + ' items'}  ·  floors  ·  sentries  ·  boxes  ·  gear`} fontSize={TYPE.caption} color={C.name}
              uiTransform={{ width: CARTE * 2 + AIR - 70, height: 28 }} textAlign="middle-left" textWrap="nowrap" />
          </UiEntity>
          <UiEntity uiTransform={{ width: '100%', height: 28, flexDirection: 'row', alignItems: 'center' }}>
            <Label value="LOSE" fontSize={TYPE.caption} color={C.danger}
              uiTransform={{ width: 70, height: 28 }} textAlign="middle-left" />
            <Label value={`every other item  ·  coins above ${formatIncome(cout * PRESTIGE_CASH_SHARE)}`} fontSize={TYPE.caption} color={C.name}
              uiTransform={{ width: CARTE * 2 + AIR - 70, height: 28 }} textAlign="middle-left" textWrap="nowrap" />
          </UiEntity>
        </UiEntity>

        <UiEntity uiTransform={{ width: CARTE * 2 + AIR, height: TAP.height, flexDirection: 'row', justifyContent: 'center' }}>
          <Btn label={pret ? 'PRESTIGE' : manque} width={400} primary={pret}
            right={TAP.gap} onClick={() => { if (pret) { doPrestige(); closePrestige() } }} />
          {/*
            BACK goes back to the shop, not to the world.

            The shop closes the whole menu before it opens this panel (shop-ui.tsx), so a plain
            close here dropped the player on the plaza: they came from the shop and expected the
            shop (owner, 9 Sep). The confirmed PRESTIGE keeps closing everything, because the base
            it just reset is the thing to look at.
          */}
          <Btn label="BACK" width={200} onClick={() => { closePrestige(); chooseTab('shop') }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
