import { caisse, demolir } from './toy'
import {
  engine, Transform, MeshCollider, TextShape, Billboard, BillboardMode, Entity,
  PointerEvents, PointerEventType, InputAction, inputSystem, ColliderLayer
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { Convoy, CONVOY_OUTBID, convoyPosition } from '../shared/schemas'
import { room } from '../shared/messages'
import { crate, formatIncome } from '../shared/loot-table'
import { alerter, myClientAddress } from './theft'
import { TOAST } from './theme'
import { cue } from './ui-kit'
import { clicMonde } from './monde'
import { LISIBLE_3D } from './texte3d'

type View = { body: Entity; label: Entity; texte: string }
const views = new Map<number, View>()
/*
  The last TWO values received per convoy, with the local time each arrived.

  One value was not enough. Reading the newest one and extrapolating forward means that every
  time a fresh value lands the crate is put BACK where the server says it was a tenth of a
  second ago, so it crawls forward and snaps back, ten times a second: a saw tooth, which is
  exactly what a jerky convoy looks like (owner, 5 Sep). Network interpolation solves this the
  same way everywhere it is written about: render slightly in the PAST and interpolate between
  two values you already have, instead of guessing ahead of one. With a render delay of one
  tick there is always a pair to sit between, and the motion cannot jump backwards.
*/
const horloges = new Map<number, { a: number; ta: number; b: number; tb: number }>()
/** How far behind the newest value the crate is drawn: one server tick, in seconds. */
const RETARD_S = 0.12

export function setupConvoy(): void {
  room.onMessage('outbidWon', (d) => {
    alerter(`YOU OUTBID ${d.fromName.toUpperCase()}`, '#8fe08f', TOAST.result)
  })
  room.onMessage('outbidLost', (d) => {
    alerter(`OUTBID BY ${d.byName.toUpperCase()}  ·  refunded`, '#ff6b6b', TOAST.warning, true)
  })
  room.onMessage('convoyArrived', (d) => {
    alerter(`${crate(d.crateTier).name.toUpperCase()} DELIVERED`, '#4dd2ff', TOAST.result)
    // Heard as well as read: a player at the far end of the field does not see the crate
    // land. Low and short, the quiet end of the scale, because it is frequent and needs no
    // answer (owner, 5 Sep: "il n'y a pas de feedback quand un crate est livre").
    cue('deliver.wav', 0.7)
  })

  engine.addSystem(() => {
    const vivants = new Set<number>()

    for (const [e, c] of engine.getEntitiesWith(Convoy)) {
      vivants.add(c.convoyId)
      let v = views.get(c.convoyId)
      const b = crate(c.crateTier)
      const color = Color4.fromHexString(b.color + 'ff')

      if (v === undefined) {
        const body = engine.addEntity()
        Transform.create(body, { position: Vector3.create(0, -5, 0), scale: Vector3.create(b.size, b.size, b.size) })
        /*
          Le convoi se clique, il ne se heurte pas.

          Sa position est REECRITE a chaque image depuis `progres`, du tapis jusqu'a la base,
          le long du couloir que tout le monde emprunte. Un solide qui se teleporte ainsi sur
          un joueur n'est pas un obstacle: le moteur doit resoudre l'interpenetration, et il
          ejecte le corps, image apres image, aussi loin qu'il faut. Un acheteur debout au
          tapis au moment ou sa caisse part se fait pousser hors du terrain (proprietaire,
          2 Sep, "ma premiere caisse m'a teleporte hors de la zone"). Le tapis avait deja la
          lecon pour ses articles mobiles (CL_POINTER seul), le convoi ne l'avait pas.
          Surencherir est un clic, donc le pointeur suffit et la physique n'apportait rien.
        */
        // Trial over (owner, 5 Sep: "beaucoup de bruit dans les deplacements"): a body that
        // is rewritten every frame shoves whoever walks the corridor. Pointer only: outbidding
        // is a tap. The belt's parked crates keep their solid, they do not move.
        MeshCollider.setBox(body, ColliderLayer.CL_POINTER)
        caisse(body, c.crateTier)
        const label = engine.addEntity()
        Transform.create(label, { position: Vector3.create(0, -5, 0), scale: Vector3.create(0.5, 0.5, 0.5) })
        Billboard.create(label, { billboardMode: BillboardMode.BM_Y })
        /*
          Cette etiquette n'avait AUCUN contour, et c'est l'une des deux du jeu dans ce cas.

          Du blanc, puis la couleur de la caisse, poses nus au-dessus d'une caisse qui traverse
          la place: sur le ciel clair ou sur la rue pale, il ne restait rien a lire. Le
          proprietaire l'a signalee nommement (7 Sep). Elle prend le traitement commun.
        */
        TextShape.create(label, { text: '', fontSize: 3, textColor: Color4.White(), ...LISIBLE_3D })
        v = { body, label, texte: '' }
        views.set(c.convoyId, v)
      }

      /*
        Position comes from the server's `progres`, which two players must agree on, or a tap
        that looks well-timed gets rejected. The server writes it ten times a second, and the
        crate is drawn one tick BEHIND that stream, between the last two values received: see
        the note on `horloges`. Interpolating between two known points is smooth by
        construction; extrapolating past one is what made the crate stutter.
      */
      const maintenant = Date.now() / 1000
      let h = horloges.get(c.convoyId)
      if (h === undefined) { h = { a: c.progres, ta: maintenant, b: c.progres, tb: maintenant }; horloges.set(c.convoyId, h) }
      else if (h.b !== c.progres) { h.a = h.b; h.ta = h.tb; h.b = c.progres; h.tb = maintenant }
      const rendu = maintenant - RETARD_S
      let k = h.b
      if (h.tb > h.ta) {
        // Between the two known values, or a short step past the newest when a write is late.
        const u = (rendu - h.ta) / (h.tb - h.ta)
        k = h.a + (h.b - h.a) * Math.max(0, Math.min(1.4, u))
      }
      k = Math.max(0, Math.min(1, k))
      const pt = convoyPosition({ x: c.departX, z: c.departZ }, { x: c.cibleX, z: c.cibleZ }, k)
      const x = pt.x
      const z = pt.z
      const tc = Transform.getMutableOrNull(v.body)
      // Carried half a metre off the ground whatever its size, the label riding above it.
      if (tc !== null) tc.position = Vector3.create(x, 0.5 + b.size / 2, z)
      const te = Transform.getMutableOrNull(v.label)
      if (te !== null) te.position = Vector3.create(x, 0.5 + b.size + 0.6, z)

      const mine = c.owner.toLowerCase() === myClientAddress()
      const price = Math.ceil(c.pricePaid * CONVOY_OUTBID)
      const voulu = mine
        ? `${b.name}\nyours - ${formatIncome(price)} to take it`
        : `${b.name}\n${c.holderName} - OUTBID ${formatIncome(price)}`
      if (voulu !== v.texte) {
        v.texte = voulu
        const ts = TextShape.getMutableOrNull(v.label)
        if (ts !== null) {
          ts.text = voulu
          ts.textColor = mine ? Color4.fromHexString('#8fe08fff') : color
        }
        PointerEvents.createOrReplace(v.body, {
          pointerEvents: [
            { eventType: PointerEventType.PET_DOWN, eventInfo: { showFeedback: false, button: InputAction.IA_POINTER, hoverText: mine ? 'Yours' : `Outbid  ${price}` } }
          ]
        })
      }

      if (clicMonde(v.body)) {
        if (mine) alerter('THIS ONE IS ALREADY YOURS', '#ffd166', TOAST.result)
        else void room.send('outbid', { convoyId: c.convoyId })
      }
    }

    for (const [id, v] of [...views]) {
      if (vivants.has(id)) continue
      demolir(v.body)
      engine.removeEntity(v.label)
      views.delete(id)
      horloges.delete(id)
    }
  })
}

/** The convoy within reach of the player, with the price it would take to outbid it. */
export const CONVOY_REACH = 3
export function convoyInReach(): { convoyId: number; price: number; mine: boolean } | null {
  const t = Transform.getOrNull(engine.PlayerEntity)
  if (t === null) return null
  const moi = myClientAddress()
  let best: { convoyId: number; price: number; mine: boolean } | null = null
  let dist = CONVOY_REACH
  for (const [, c] of engine.getEntitiesWith(Convoy)) {
    const v = views.get(c.convoyId)
    if (v === undefined) continue
    const bt = Transform.getOrNull(v.body)
    if (bt === null) continue
    const d = Math.hypot(t.position.x - bt.position.x, t.position.z - bt.position.z)
    if (d < dist) { dist = d; best = { convoyId: c.convoyId, price: Math.ceil(c.pricePaid * CONVOY_OUTBID), mine: c.owner.toLowerCase() === moi } }
  }
  return best
}
export function surencherir(convoyId: number): void { void room.send('outbid', { convoyId }) }
