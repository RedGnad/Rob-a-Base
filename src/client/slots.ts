import { TOY, plasticDe } from './toy'
import {
  engine, Transform, MeshRenderer, Material, TextShape, Billboard, BillboardMode, Entity,
  PointerEvents, PointerEventType, InputAction, inputSystem
} from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { BASE_SIDE, SCENE_SIDE, snapToGrid, invalidReason } from '../shared/schemas'
import { room } from '../shared/messages'
import { Plot } from '../shared/schemas'
import { myClientAddress, theftView } from './theft'
import { welcomeView } from './welcome'
import { sendOrHold } from './intent'
import { poseView } from './pose'



export const slotView = { active: false, valid: false, reason: '', auto: false }

let fantome: Entity
let label: Entity
let autres: Array<{ x: number; z: number }> = []
/** Vrai quand le marqueur s'est allume tout seul, faux quand le joueur l'a demande. */
let auto = false

export function togglePlacing(): void {
  slotView.active = !slotView.active
  auto = false
  slotView.auto = false
  if (!slotView.active) {
    const t = Transform.getMutableOrNull(fantome)
    if (t !== null) t.scale = Vector3.create(0, 0, 0)
    const e = Transform.getMutableOrNull(label)
    if (e !== null) e.scale = Vector3.create(0, 0, 0)
  }
}

function myBasePoint(): { x: number; z: number } | null {
  const moi = myClientAddress()
  if (moi === '') return null
  for (const [e, p] of engine.getEntitiesWith(Plot)) {
    if (p.ownerId.toLowerCase() !== moi) continue
    const t = Transform.getOrNull(e)
    return t === null ? null : { x: t.position.x, z: t.position.z }
  }
  return null
}

export function setupSlots(): void {
  fantome = engine.addEntity()
  Transform.create(fantome, { position: Vector3.create(0, 0.08, 0), scale: Vector3.create(0, 0, 0) })
  MeshRenderer.setBox(fantome)

  label = engine.addEntity()
  Transform.create(label, { position: Vector3.create(0, 2.2, 0), scale: Vector3.create(0, 0, 0) })
  Billboard.create(label, { billboardMode: BillboardMode.BM_Y })
  /*
    The line a player reads while standing on grass, so it carries its own contrast.

    It was white text at size 3 with nothing behind it, over a bright green field, and the
    owner could not read it while placing a base (5 Sep). A world-space label has no plate to
    sit on, so the platform's own answer is the outline: `outlineWidth` with a dark
    `outlineColor` draws the glyph's own edge, which holds on grass, on lava and on the sky
    alike. The size goes up with it, because this is the one sentence in the game a player
    reads before they own anything.
  */
  TextShape.create(label, {
    text: '', fontSize: 4.2, textColor: Color4.White(),
    outlineWidth: 0.28, outlineColor: Color3.fromHexString('#0b1018'),
    shadowBlur: 0.5, shadowColor: Color3.fromHexString('#0b1018')
  })

  room.onMessage('basePositions', (d) => {
    autres = d.xs.map((x, i) => ({ x, z: d.zs[i] ?? 0 }))
  })

  /*
    Un joueur qui n'a pas encore de base voit tout de suite ou elle irait.

    Le marqueur etait une bascule: il fallait deviner qu'une premiere pression le faisait
    apparaitre, puis une seconde le posait. Or a l'arrivee le bouton dit deja POSER TA BASE et
    l'etape 1 du tutoriel aussi: le contexte est sans ambiguite, le marqueur n'a aucune raison
    d'attendre qu'on le demande (proprietaire, 1 Sep). Il s'allume donc de lui-meme tant qu'on
    n'a pas de base, et redevient une bascule ensuite, pour la deplacer.
  */
  engine.addSystem(() => {
    /*
      Le marqueur qui s'allume tout seul ne dit que OUI, jamais NON.

      Un joueur qui arrive apparait sur le couloir du tapis, qui est justement une bande ou l'on
      ne peut pas construire: la premiere image du jeu etait donc un grand rectangle ROUGE avec
      son motif ecrit deux fois (proprietaire, 2 Sep). Un refus qu'on n'a pas demande n'apprend
      rien, il encombre. Quand il s'allume de lui-meme il ne se montre donc que sur un
      emplacement valide, et c'est son APPARITION qui dit "ici, oui".

      La bascule manuelle, elle, garde le rouge et sa raison: la, le joueur cherche
      deliberement une place et a besoin de savoir pourquoi celle-ci est refusee.
    */
    /*
      And it waits for the server. `basePosee` is false until the wallet answers, so on a fresh
      start the marker lit for a frame or two, with its BUILD HERE over it, in front of a player
      who owns a three-storey base: the first thing the game showed was a lie about itself
      (owner, 5 Sep). `walletRecu` is the difference between "you have no base" and "nobody has
      said yet".
    */
    if (theftView.walletRecu && !welcomeView.open && !theftView.basePosee && !slotView.active && !poseView.pending) {
      slotView.active = true
      auto = true
      slotView.auto = true
    }
    /*
      And it goes OUT by itself. It lit while the wallet had not spoken yet (a fresh
      connection, a server just replaced) and nothing ever turned it off once the wallet
      said "you have a base": the owner stood in front of their own three-storey building
      reading BUILD HERE and a PLACE HERE button (owner, 4 Sep). What lit on a guess is
      put out by the fact.
    */
    if (auto && theftView.basePosee) {
      auto = false
      slotView.auto = false
      slotView.active = false
      const t = Transform.getMutableOrNull(fantome)
      if (t !== null) t.scale = Vector3.Zero()
      const e = Transform.getMutableOrNull(label)
      if (e !== null) e.scale = Vector3.Zero()
      return
    }
    if (!slotView.active) return
    if (!Transform.has(engine.PlayerEntity)) return
    const p = Transform.get(engine.PlayerEntity).position
    const x = snapToGrid(p.x)
    const z = snapToGrid(p.z)

    const moi = myBasePoint()
    const obstacles = moi === null
      ? autres
      : autres.filter((a) => Math.abs(a.x - moi.x) > 0.01 || Math.abs(a.z - moi.z) > 0.01)
    const reason = invalidReason(x, z, SCENE_SIDE, obstacles)
    slotView.valid = reason === null
    slotView.reason = reason ?? ''

    const muet = auto && !slotView.valid
    const t = Transform.getMutableOrNull(fantome)
    if (t !== null) {
      t.position = Vector3.create(x, 0.08, z)
      t.scale = muet ? Vector3.Zero() : Vector3.create(BASE_SIDE, 0.16, BASE_SIDE)
    }
    const c = Color4.fromHexString((slotView.valid ? TOY.markerOk : TOY.markerBad) + 'ff')
    Material.setPbrMaterial(fantome, plasticDe(c, 0.7))

    const te = Transform.getMutableOrNull(label)
    if (te !== null) {
      te.position = Vector3.create(x, 2.4, z)
      te.scale = muet ? Vector3.Zero() : Vector3.create(0.7, 0.7, 0.7)
    }
    const ts = TextShape.getMutableOrNull(label)
    if (ts !== null) {
      ts.text = slotView.valid ? 'BUILD HERE' : slotView.reason
      ts.textColor = c
    }
  })
}

export function placeHere(): void {
  if (!Transform.has(engine.PlayerEntity)) return
  const p = Transform.get(engine.PlayerEntity).position
  const x = snapToGrid(p.x), z = snapToGrid(p.z)
  poseView.pending = true
  sendOrHold(() => { void room.send('claimSlot', { x, z }) })
  togglePlacing()
}

