import { Color4 } from '@dcl/sdk/math'
import { sendOrHold } from './intent'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { engine } from '@dcl/sdk/ecs'
import { TYPE, C, TAP, SKIN, lisible, TOAST } from './theme'
import { Glyphs } from './glyphs'
import { Btn , SURF} from './ui-kit'
import { Plot, FUSION_NEEDS, VIDE, poidsDesMutations, LUCK_MULT, incomeMultiplier } from '../shared/schemas'
import { RARITIES, MUTATIONS, rarityOf, mutationDe, traitsDe, itemIncome, nomDuCode, formatIncome, expectedMutationMult } from '../shared/loot-table'
import { fusionCost } from '../shared/economy'
import { PRODUCTION_PER_RARITY } from '../shared/economy'
import { room } from '../shared/messages'
import { myClientAddress, theftView, alerter } from './theft'
import { eventView } from './events'
import { fuserView } from './fusion'

/**
 * The fuser's panel: fuse straight from your shelves.
 *
 * The machine asked for three toys and a player can carry one, so feeding it meant three
 * walks across the plaza, and the tester read the machine as unclear (27 Aug). Feeding by
 * hand stays, for whoever is already carrying something; with empty hands the drum opens
 * this panel instead, which counts what you own of each rarity, shelves plus what the
 * machine already holds for you, and fuses three of them from where they stand. The result
 * still lands in your hand, so the new toy is carried home like any other.
 */
export const fuserPanelView = { open: false }
export function openFuser(): void { fuserPanelView.open = true }
export function closeFuser(): void { fuserPanelView.open = false }

const RANG = 84

/** The player's toys: what the machine already holds for them first, then the shelves. */
function miens(): { hopper: number[]; etagere: number[] } {
  const moi = myClientAddress()
  let etagere: number[] = []
  for (const [, p] of engine.getEntitiesWith(Plot)) {
    if (p.ownerId.toLowerCase() !== moi) continue
    etagere = p.items.filter((c) => c !== VIDE)
    break
  }
  return { hopper: [...fuserView.codes], etagere }
}

/**
 * Exactly what the server would take for rarity `r`: the hopper's, then the shelf's cheapest.
 * Named on the row, because a fusion that eats a Lava Rare +2 among three Rares must say so
 * before the button, not after (the prestige learned this on 27 Aug).
 */
function choix(m: { hopper: number[]; etagere: number[] }, r: number): number[] {
  const dedans = m.hopper.filter((c) => rarityOf(c) === r)
  const sur = m.etagere.filter((c) => rarityOf(c) === r)
    .sort((x, y) => itemIncome(x, PRODUCTION_PER_RARITY) - itemIncome(y, PRODUCTION_PER_RARITY))
  return [...dedans, ...sur].slice(0, FUSION_NEEDS)
}

/**
 * A toy named for a row that already says its rarity: the mutation, or "plain", and its
 * traits. "takes: Blood Uncommon, Gold Uncommon +1, Common" repeated the row's own word
 * three times and ran under the button (owner, 4 Sep); "Blood · Gold +1 · plain" fits.
 */
function nomCourt(code: number): string {
  const n = traitsDe(code)
  const mu = mutationDe(code)
  const nom = mu > 0 ? (MUTATIONS[mu]?.name ?? 'plain') : 'plain'
  return n > 0 ? `${nom} +${n}` : nom
}

/** The chance each fed mutation passes on, from the same weights the server rolls with. */
function chances(pris: number[]): string {
  const pousses = pris.map(mutationDe).filter((m) => m > 0)
  if (pousses.length === 0) return 'no mutation'
  const poids = poidsDesMutations(0, eventView.theme, theftView.luckSec > 0 ? LUCK_MULT : 1, pousses)
  const total = poids.reduce((a, b) => a + b, 0)
  return [...new Set(pousses)]
    .map((m) => `${MUTATIONS[m]?.name ?? ''} ${Math.round((poids[m] / total) * 100)}%`)
    .join(', ')
}

export const FusionPanel = () => {
  if (!fuserPanelView.open) return <UiEntity uiTransform={{ width: 0, height: 0 }} />
  const m = miens()
  const fusibles = RARITIES.slice(0, RARITIES.length - 1)
  return (
    <UiEntity
      uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center', pointerFilter: 'block' }}
      uiBackground={{ color: SURF.voile }}
    >
      <UiEntity
        uiTransform={{ width: 940, height: 150 + fusibles.length * RANG + TAP.height + 40 + (m.hopper.length > 0 ? TAP.height + 8 : 0), flexDirection: 'column', alignItems: 'center', padding: 22 }}
        uiBackground={SKIN.panel}
      >
        <UiEntity uiTransform={{ width: '100%', height: 56 }}>
          <Glyphs value="FUSER" size={TYPE.title} role="bonus" />
        </UiEntity>
        <Label
          value={`${FUSION_NEEDS} toys of one rarity fuse into one of the next, cheapest first`}
          fontSize={TYPE.caption} color={C.dim}
          uiTransform={{ width: '100%', height: 30 }} textAlign="middle-center" textWrap="nowrap" />
        <Label
          value="a fed mutation may pass on  ·  traits are lost"
          fontSize={TYPE.caption} color={C.dim}
          uiTransform={{ width: '100%', height: 30 }} textAlign="middle-center" textWrap="nowrap" />
        {/* What the machine already holds for this player, and the way back out of it. */}
        {m.hopper.length > 0 && (
          <UiEntity uiTransform={{ width: '100%', height: TAP.height + 8, flexDirection: 'row', alignItems: 'center' }}>
            <Label value={`in the fuser for you: ${m.hopper.map(nomDuCode).join(', ')}`} fontSize={TYPE.caption}
              color={Color4.fromHexString('#ffd166ff')} uiTransform={{ width: 600, height: TAP.height, overflow: 'hidden' }} textAlign="middle-left" textWrap="nowrap" />
            <UiEntity uiTransform={{ width: 280, height: TAP.menu, justifyContent: 'flex-end' }}>
              <Btn label="TAKE BACK" width={260} height={TAP.menu} onClick={() => { sendOrHold(() => { void room.send('takeBackFusion', {}) }); closeFuser() }} />
            </UiEntity>
          </UiEntity>
        )}
        {fusibles.map((r) => {
          const total = m.hopper.filter((c) => rarityOf(c) === r.id).length + m.etagere.filter((c) => rarityOf(c) === r.id).length
          /*
            The price is computed here, not fetched: the formula is shared, so the button
            tells the truth without a round trip and without another field in the messages.
            It needs the same three inputs the server uses, the pieces going in, the odds on
            the piece coming out, and the owner's prestige, because a price read off the
            rarity alone is wrong by the whole multiplier stack.
          */
          const pris = choix(m, r.id)
          const pousses = pris.map(mutationDe).filter((mu) => mu > 0)
          const poidsSortie = poidsDesMutations(0, -1, theftView.luckSec > 0 ? LUCK_MULT : 1, pousses)
          let revenuEntrees = 0
          for (const c of pris) revenuEntrees += itemIncome(c, PRODUCTION_PER_RARITY)
          const prix = fusionCost(r.id, revenuEntrees, expectedMutationMult(poidsSortie), incomeMultiplier(theftView.prestige))
          const paye = theftView.coins >= prix
          const assez = total >= FUSION_NEEDS
          return (
            <UiEntity key={r.id} uiTransform={{ width: '100%', height: RANG, flexDirection: 'row', alignItems: 'center' }}>
              {/* The text column clips: nothing it holds may ever run under the button beside it. */}
              <UiEntity uiTransform={{ width: 500, height: RANG, flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' }}>
                <Label value={`${total}  ${r.name}${total === 1 ? '' : 's'}`} fontSize={TYPE.body}
                  color={Color4.fromHexString(lisible(r.color) + 'ff')}
                  uiTransform={{ width: '100%', height: 40 }} textAlign="middle-left" textWrap="nowrap" />
                <Label value={pris.length > 0 ? `${pris.map(nomCourt).join(' · ')}   ·   ${chances(pris)}` : 'none on your shelves'} fontSize={TYPE.caption}
                  color={C.dim} uiTransform={{ width: '100%', height: 30 }} textAlign="middle-left" textWrap="nowrap" />
              </UiEntity>
              <UiEntity uiTransform={{ width: 380, height: TAP.menu, justifyContent: 'flex-end' }}>
                <Btn label={!assez ? `${FUSION_NEEDS} NEEDED` : `FUSE  ${formatIncome(prix)}`}
                  width={360} height={TAP.menu} primary={assez && paye}
                  onClick={() => {
                    // A press that cannot act says why: a silent button is pressed again (owner, 4 Sep).
                    if (!assez) { alerter(`${FUSION_NEEDS} ${r.name.toUpperCase()}S NEEDED, YOU HAVE ${total}`, '#ffd166', TOAST.warning); return }
                    if (!paye) { alerter(`NOT ENOUGH COINS  ·  ${formatIncome(Math.ceil(prix - theftView.coins))} MORE`, '#ffd166', TOAST.warning); return }
                    sendOrHold(() => { void room.send('fuseFromBase', { rarity: r.id }) })
                    closeFuser()
                  }} />
              </UiEntity>
            </UiEntity>
          )
        })}
        <UiEntity uiTransform={{ width: '100%', height: TAP.height, flexDirection: 'row', justifyContent: 'center', margin: { top: 12 } }}>
          <Btn label="BACK" width={220} onClick={closeFuser} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
