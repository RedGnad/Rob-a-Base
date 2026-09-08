import { engine } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import {
  Raid, Event, RAID_ENABLED, RAID_MINUTES, RAID_MS, RAID_POS, RAID_RADIUS,
  RAID_HP_BASE, RAID_HP_PER_PLAYER, RAID_SWIPE_MS, RAID_SWIPE_RANGE, RAID_SWIPE_SHARE, RAID_HIT_RANGE,
  RAID_SWIPE_CAP_S, RAID_RAIN_S, RAID_REWARD_CRATE, RAID_SPAWN_MARGIN, RAID_AGGRO_RANGE, RAID_SPEED, RAID_TURN, RAID_STANDOFF, RAID_THREAT_SWITCH,
  SCENE_SIDE, forceDuTir
, RAID_DEAGGRO_RANGE, RAID_BORD, BASE_SIDE, PLINTH_SIDE} from '../shared/schemas'
import { room } from '../shared/messages'
import { encoder } from '../shared/loot-table'
import { presents, positionOf, displayName, spend, coinsOf, incomePerSecond, addCrate, cratesOf, toutesLesBases, memeEspace, meilleureRarete } from './plots'
import { hitCarrier } from './carry'
import { dropAt } from './coins'
import { noter } from './records'
import { log } from './log'

/**
 * The raid: a boss on the plaza, every so often, for three minutes.
 *
 * The one shared fight the game has. Everyone in the room is invited to the same spot by the
 * same countdown; every weapon already in the game hurts it (the server resolves a shot
 * against the boss before it looks for a player); it swipes at whoever stands close, and a
 * swipe does what a bomb does, opens the hands, plus shakes a share of the purse onto the
 * floor where anybody can pick it up. Whoever dealt the most damage when it falls takes a
 * Legendary crate and a line on the board. In the reference the closest thing is the "Tung
 * Tung Attack" event, a hostile boss whose brood attacks players; the reward for the kill is
 * ours. Behind `RAID_ENABLED`, added last on the tester's call (28 Aug), time-boxed.
 */

type Entity = ReturnType<typeof engine.addEntity>
let boss: Entity | null = null
let degats = new Map<string, number>()
let prochain = 0
let debut = 0

/** The next fixed slot strictly after `apres`: the raid runs on the clock, not on uptime. */
function prochainCreneau(apres: number): number {
  const d = new Date(apres)
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), 0, 0, 0)
  for (const m of RAID_MINUTES) {
    const t = base + m * 60_000
    if (t > apres) return t
  }
  return base + 3_600_000 + RAID_MINUTES[0] * 60_000
}
let targetAddr: string | null = null
/*
  LE DELAI EST PAR JOUEUR, ET IL ETAIT GLOBAL.

  Ce que le testeur ne "sentait" pas, et que le proprietaire a diagnostique en jouant (7 Sep):
  on entrait dans le boss et IL NE SE PASSAIT RIEN, puis on perdait de l'argent cinq secondes
  plus tard sans avoir rien fait entre-temps. La cause etait un metronome unique, `dernierBalai`,
  demarre au debut du raid et partage par tout le monde: le boss tirait toutes les cinq secondes
  et frappait qui se trouvait la A CET INSTANT PRECIS. Le contact ne declenchait rien.

  Consequences observees, toutes expliquees par cette seule ligne: on pouvait entrer dans le
  boss, le frapper et ressortir sans jamais rien prendre; on pouvait aussi prendre un coup en
  arrivant, sans avoir eu le temps de faire quoi que ce soit. Le dégât n'avait aucun lien de
  cause avec l'action du joueur, et un dégât sans cause ne se lit pas comme un dégât.

  Le delai devient donc PAR JOUEUR: on entre a portee, on prend le coup TOUT DE SUITE, puis un
  toutes les cinq secondes tant qu'on reste. C'est la regle du degat de contact partout ou elle
  existe, et c'est la seule qui rende le "reste ou pars" lisible. Ressortir et revenir apres
  cinq secondes reprend un coup, ce qui est exactement ce qu'on veut dire.
*/
const dernierCoup = new Map<string, number>()
let spawnX = 0, spawnZ = 0

/**
 * Keeps the boss OUT of the plots, sliding along a wall instead of walking through it.
 *
 * It moves as two numbers on the server while the buildings are drawn on the client, so
 * nothing stopped it strolling through a wall to stand among somebody's shelves (owner,
 * 1 Sep). Its footprint is pushed out of every plot along whichever axis it has entered the
 * least, which makes it round a corner rather than stop dead against it. That also gives a
 * base the role it should have during a raid: a refuge you duck into, with the thing pacing
 * outside.
 */
function horsDesBases(nx: number, nz: number): { x: number; z: number } {
  /*
    It has to stay out of the BUILDING, not off the doorstep.

    Measured against the walls plus its own radius, and nothing more: the slab overhangs the
    walls by eight tenths of a metre and stands twelve centimetres proud, which is a step, not
    an obstacle, so keeping the boss off it only bought a wider no-go ring and a narrower street
    to chase through (tester, 1 Sep). Hugging the walls is also how it should read: the thing
    pacing right outside the glass while you shelter behind it.
  */
  const demi = BASE_SIDE / 2 + RAID_RADIUS + 0.2
  for (const b of toutesLesBases()) {
    const dx = nx - b.x, dz = nz - b.z
    if (Math.abs(dx) >= demi || Math.abs(dz) >= demi) continue
    if (demi - Math.abs(dx) < demi - Math.abs(dz)) nx = b.x + (dx < 0 ? -demi : demi)
    else nz = b.z + (dz < 0 ? -demi : demi)
  }
  return { x: nx, z: nz }
}
let faceX = 0, faceZ = 1
let dernierTick = 0
let seed = 12345
/** A pseudo-random in [0,1): the sandbox bans Math.random, so a small LCG seeded from the raid's start. */
function rnd(): number { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }

/** Le palier de caisse gagne au boss, un cran au-dessus du meilleur objet du joueur. */
function crateDuButin(meilleure: number): number {
  if (meilleure <= 0) return 1       // rien, ou du Common -> Good Crate
  if (meilleure === 1) return 2      // Uncommon -> Rare Crate
  if (meilleure === 2) return 3      // Rare -> Epic Crate
  if (meilleure === 3) return RAID_REWARD_CRATE   // Epic -> Legendary Crate
  return 8                           // Legendary et au-dela -> Mythic Crate
}

function meneur(): { address: string; name: string } | null {
  let top: string | null = null
  let best = 0
  for (const [k, v] of degats) if (v > best) { best = v; top = k }
  return top === null ? null : { address: top, name: displayName(top) }
}

/**
 * A shot or a blow from `from` AIMED at `vise` hits the boss when the boss's disc lies on the
 * forward ray, within `RAID_HIT_RANGE` of the player, in the ground plane. The ray is used,
 * not the segment: a taser's aim point is only 2.5 m out, so a segment ending there never
 * reached a boss orbiting at 4 m, and melee weapons dealt no damage at all (tester, 28 Aug).
 * The boss is one big target everyone piles onto, so any weapon aimed at it lands, up to the
 * raid range. Damage is still the shot's force at the real distance. Returns true on a hit.
 */
export function raidHit(a: string, from: Vector3, vise: { x: number; z: number }, mult = 1): boolean {
  if (boss === null) return false
  const r = Raid.getOrNull(boss)
  if (r === null || !r.active) return false
  if (!memeEspace(from.x, from.z, r.x, r.z)) return false
  const ax = from.x, az = from.z
  let dx = vise.x - ax, dz = vise.z - az
  const l = Math.hypot(dx, dz)
  if (l < 0.0001) return false
  dx /= l; dz /= l                                  // unit forward, so the ray is not capped by the aim point
  const bossDist = Math.hypot(r.x - ax, r.z - az)
  if (bossDist > RAID_HIT_RANGE) return false
  const t = Math.max(0, (r.x - ax) * dx + (r.z - az) * dz)  // distance along the ray to the boss's foot
  const px = ax + t * dx, pz = az + t * dz
  if (Math.hypot(r.x - px, r.z - pz) > RAID_RADIUS) return false
  // Le corps a corps frappe plus fort ici aussi, et c'est la ou il se paie: le balai du
  // boss porte a quatre metres, donc frapper a deux metres cinquante, c'est rester dedans.
  const degat = Math.max(0.2, forceDuTir(bossDist)) * mult
  const m = Raid.getMutableOrNull(boss)
  if (m === null) return false
  m.hp = Math.max(0, m.hp - degat)
  m.lastHitName = displayName(a)
  m.hitAtMs = Date.now()
  degats.set(a, (degats.get(a) ?? 0) + degat)
  m.topName = meneur()?.name ?? ''
  // Threat: whoever has hurt it most is who it hunts, once they are clearly ahead.
  if (targetAddr !== a) {
    const mine = degats.get(a) ?? 0
    const theirs = targetAddr === null ? 0 : (degats.get(targetAddr) ?? 0)
    if (mine > theirs * RAID_THREAT_SWITCH) {
      targetAddr = a
      log(`the raid boss turns on ${displayName(a)}, top threat`)
    }
  }
  if (m.hp <= 0) finir(true)
  return true
}

function ouvrir(now: number, finMs?: number): void {
  if (boss === null) return
  const m = Raid.getMutableOrNull(boss)
  if (m === null) return
  const ici = presents().size
  degats = new Map()
  debut = now
  dernierCoup.clear()
  m.active = true
  m.hpMax = RAID_HP_BASE + RAID_HP_PER_PLAYER * Math.max(1, ici)
  m.hp = m.hpMax
  m.untilMs = finMs ?? now + RAID_MS
  seed = (now & 0x7fffffff) ^ 0x5f3759df
  spawnX = RAID_SPAWN_MARGIN + rnd() * (SCENE_SIDE - 2 * RAID_SPAWN_MARGIN)
  spawnZ = RAID_SPAWN_MARGIN + rnd() * (SCENE_SIDE - 2 * RAID_SPAWN_MARGIN)
  // It must not appear inside a plot either.
  const depart = horsDesBases(spawnX, spawnZ)
  spawnX = depart.x; spawnZ = depart.z
  m.x = spawnX
  m.z = spawnZ
  faceX = 0; faceZ = 1
  m.faceX = faceX; m.faceZ = faceZ
  dernierTick = now
  m.topName = ''
  m.lastHitName = ''
  m.hitAtMs = 0
  m.swipeAtMs = 0
  log(`raid: the boss is up, ${m.hpMax} hp for ${ici} present`)
}

function finir(vaincu: boolean): void {
  if (boss === null) return
  const m = Raid.getMutableOrNull(boss)
  if (m === null || !m.active) return
  const now = Date.now()
  m.active = false
  m.hp = 0
  prochain = prochainCreneau(now)
  m.nextMs = prochain
  if (vaincu) {
    /*
      The corpse rains coins, and the rain is for the crowd.

      The crate goes to whoever dealt the most; that is the trophy. The coins on the floor
      are the party: one drop per damage dealer, scaled to THEIR income (`RAID_RAIN_S` of it,
      so it matters to the rich and to the new alike), scattered in a ring around where the
      boss fell, and anyone may scoop anyone's pile. Same drop machinery as the swipe, so the
      client already knows how to draw and grab them.

      `RAID_RAIN_S` is the swipe's cap, deliberately the same constant: see the note on it in
      `schemas.ts`. Winning covers exactly one swipe taken, which is what stops the fight from
      being a net loss for everyone who is not the top dealer.
    */
    let k = 0
    for (const [addr] of degats) {
      const pluie = Math.floor(incomePerSecond(addr) * RAID_RAIN_S + 500)
      const a2 = (k / Math.max(1, degats.size)) * Math.PI * 2 + rnd()
      /*
        Dropped by NOBODY, so the six second lock does not apply to a reward.

        `dropAt` refuses the pile to the player it fell from for six seconds, which is right
        for a hit (a victim would scoop their own loss straight back) and wrong here: the rain
        is the party's prize, and the players who earned it were the ones locked out of it
        while anybody else could scoop it at once (owner, 5 Sep: "elles ne sont pas tout de
        suite ramassables"). An empty owner matches nobody, so every pile is open the instant
        it lands, to everyone.
      */
      dropAt('', pluie, { x: m.x + Math.cos(a2) * 3, y: 0, z: m.z + Math.sin(a2) * 3 })
      k += 1
    }
    const top = meneur()
    if (top !== null) {
      /*
        Un cran au-dessus de ce qu'il possede, jamais le sommet.

        C'etait la caisse Legendary pour tout le monde, dont le rendement attendu calcule sur
        ses propres tables vaut 14 908/s. Le premier achat que le tutoriel demande en coute
        2 018: un seul boss valait donc environ sept mille quatre cents fois la premiere
        marche de la progression, et un joueur de cinq minutes se retrouvait a quinze mille a
        la seconde (proprietaire, 2 Sep). La regle du genre pour un boss de monde est que le
        butin suit la progression: le debutant en Commons gagne une Good, celui qui tient des
        Legendary gagne une Mythic. Le boss reste un grand moment a tous les stades, et il
        cesse d'etre un raccourci par-dessus toute la courbe.
      */
      /*
        La caisse ANNONCEE est celle qui est DONNEE, et elle ne l'etait pas.

        `addCrate` recevait `crateDuButin(...)`, echelonne sur la progression du gagnant, mais le
        message partait avec `RAID_REWARD_CRATE` en dur, c'est-a-dire la Legendary. Un debutant
        recevait donc une Good Crate dans son inventaire et lisait "LEGENDARY CRATE in your boxes"
        sur son ecran. Le calcul du 2 Sep qui a cree l'echelonnement etait bon; seule la phrase
        est restee sur l'ancienne valeur, et elle mentait au joueur sur ce qu'il venait de gagner
        (trouve le 8 Sep en verifiant si un boss plus frequent gonflait les Legendary).
      */
      const butin = crateDuButin(meilleureRarete(top.address))
      addCrate(top.address, butin)
      void room.send('inventory', { crates: cratesOf(top.address) }, { to: [top.address] })
      void room.send('raidWon', { crate: butin }, { to: [top.address] })
      // Le code n'est PAS lu pour ce genre d'entree: le journal dit qui a tue le boss, pas ce
      // qu'il a gagne (voir `records.ts`), parce que le butin depend du palier du gagnant.
      noter('raid', top.name, '', encoder(4, 0))
      void room.send('raidOver', { winner: top.name, slain: true })
      log(`raid: slain, ${top.name} takes the crate; ${degats.size} dealers rained on`)
      return
    }
  }
  void room.send('raidOver', { winner: '', slain: false })
  log('raid: the boss left')
}

export function startRaid(): void {
  for (const [e] of engine.getEntitiesWith(Raid)) {
    if ((e & 0xffff) < 512) continue
    engine.removeEntity(e)
  }
  boss = engine.addEntity()
  prochain = prochainCreneau(Date.now())
  Raid.create(boss, {
    active: false, hp: 0, hpMax: 0, untilMs: 0, nextMs: prochain,
    x: RAID_POS.x, z: RAID_POS.z, topName: '', lastHitName: '', hitAtMs: 0, swipeAtMs: 0, faceX: 0, faceZ: 1
  })
  syncEntity(boss, [Raid.componentId])
  if (!RAID_ENABLED) { log('raid: disabled'); return }

  let acc = 0
  engine.addSystem((dt) => {
    acc += dt
    if (acc < 0.5) return
    acc = 0
    if (boss === null) return
    const now = Date.now()
    const lu = Raid.getOrNull(boss)
    if (lu === null) return

    if (!lu.active) {
      if (now < prochain) return
      const finFenetre = prochain + RAID_MS
      const passe = (): void => { prochain = prochainCreneau(now); if (boss !== null) { const m = Raid.getMutableOrNull(boss); if (m !== null) m.nextMs = prochain } }
      // The window has run out with nobody there: move on to the next slot.
      if (now >= finFenetre) { passe(); return }
      // Still inside the window: a player arriving now gets the boss for the time that is left,
      // not a skipped slot (tester, 28 Aug). No player yet, keep waiting this window out.
      if (presents().size === 0) return
      // Not on top of a rush, nor on the doorstep of the grand one: one countdown at a time.
      for (const [, ev] of engine.getEntitiesWith(Event)) {
        if (ev.theme >= 0 || ev.nextGrandMs - now < RAID_MS + 60_000) { passe(); return }
      }
      ouvrir(now, finFenetre)
      return
    }

    if (now >= lu.untilMs) { finir(false); return }

    const m = Raid.getMutableOrNull(boss)
    if (m === null) return
    const ds = Math.min(1, (now - dernierTick) / 1000)
    dernierTick = now

    /*
      Aggro that STICKS to a player, and lets go only when that player has escaped.

      It kept re-choosing the nearest player every tick and was leashed to its spawn, so it
      abandoned a chase because of where it stood rather than where its prey was. Now it
      holds the one it picked until that player leaves, disconnects, or opens the drop
      distance; only then does it look for somebody else within its notice radius. With
      nobody in reach it walks home, which is the only use the spawn point still has.
    */
    let vise = targetAddr === null ? null : positionOf(targetAddr)
    if (vise !== null && Math.hypot(vise.x - m.x, vise.z - m.z) > RAID_DEAGGRO_RANGE) vise = null
    if (vise === null) {
      targetAddr = null
      let best = RAID_AGGRO_RANGE
      for (const addr of presents()) {
        const p = positionOf(addr)
        if (p === null) continue
        const d = Math.hypot(p.x - m.x, p.z - m.z)
        if (d < best) { best = d; targetAddr = addr; vise = p }
      }
      if (targetAddr !== null && vise !== null) log(`the raid boss locks onto ${displayName(targetAddr)}`)
    }
    const vers = vise !== null ? { x: vise.x, z: vise.z } : { x: spawnX, z: spawnZ }
    let vx = vers.x - m.x, vz = vers.z - m.z
    const vl = Math.hypot(vx, vz)
    if (vl > 0.05) {
      vx /= vl; vz /= vl
      // Face the target/heading, turning at a bounded rate so it reads as a body, not a snap.
      const desire = Math.atan2(vx, vz)
      let cur = Math.atan2(faceX, faceZ)
      let diff = desire - cur
      while (diff > Math.PI) diff -= 2 * Math.PI
      while (diff < -Math.PI) diff += 2 * Math.PI
      cur += Math.max(-RAID_TURN * ds, Math.min(RAID_TURN * ds, diff))
      faceX = Math.sin(cur); faceZ = Math.cos(cur)
      m.faceX = faceX; m.faceZ = faceZ
      /*
        It stops a body's length short instead of walking into its prey.

        It used to steer at the player's exact position, so it ended up standing in the same
        spot: in first person the player was suddenly inside it and could not read what was
        happening (owner, 3 Sep). It swipes at four metres, so holding at RAID_STANDOFF keeps
        every swipe in range while leaving the boss visible in front of whoever it hunts.
        The guard applies only to a chase; going home to its spawn still goes all the way.
      */
      const garde = vise !== null ? RAID_STANDOFF : 0
      const reste = vl - garde
      if (reste > 0.05) {
        // It walks to the ends of the map after its target; the map and the plots stop it.
        const pas = Math.min(RAID_SPEED * ds, reste)
        const libre = horsDesBases(m.x + vx * pas, m.z + vz * pas)
        m.x = Math.max(RAID_BORD, Math.min(SCENE_SIDE - RAID_BORD, libre.x))
        m.z = Math.max(RAID_BORD, Math.min(SCENE_SIDE - RAID_BORD, libre.z))
      }
    }

    /*
      L'ONDE DE CHOC NE PART QUE SI QUELQU'UN EST TOUCHE.

      Elle partait sur le metronome, donc toutes les cinq secondes, meme la place vide. Le client
      la dessine a chaque changement de `swipeAtMs` (`client/raid.ts`), donc le joueur voyait le
      boss balayer dans le vide en boucle et apprenait qu'elle ne voulait rien dire. Une annonce
      qui se declenche sans consequence detruit la valeur de l'annonce qui en a une.
    */
    let frappe = false
    for (const addr of presents()) {
      const p = positionOf(addr)
      if (p === null) continue
      if (Math.hypot(p.x - m.x, p.z - m.z) > RAID_SWIPE_RANGE || Math.abs(p.y - 0) > 3) continue
      /*
        UN MUR ARRETE AUSSI UNE GRIFFE, et il n'arretait qu'une balle.

        `memeEspace` etait branche sur les TIRS, dans les deux sens, mais jamais sur le corps a
        corps du boss: la boucle ne testait que la distance et la hauteur. Colle a l'interieur de
        son mur, avec le boss colle a l'exterieur, un joueur se prenait le coup a travers la paroi
        (proprietaire, 8 Sep, en jouant). Deux metres separaient les deux corps, la portee en vaut
        quatre, et rien ne regardait la cloison entre eux.

        Ce n'est pas un detail d'equilibrage, ca contredit une intention ecrite trois cents lignes
        plus haut, dans `horsDesBases`: le boss est tenu HORS des bases pour donner a la base "the
        role it should have during a raid: a refuge you duck into, with the thing pacing outside".
        Un refuge qui ne protege pas est pire qu'aucun refuge, parce qu'on y court.
      */
      if (!memeEspace(p.x, p.z, m.x, m.z)) continue
      if (now - (dernierCoup.get(addr) ?? 0) < RAID_SWIPE_MS) continue
      dernierCoup.set(addr, now)
      frappe = true
      // Full force: whatever they carried is on the floor, like a bomb.
      hitCarrier(addr, 5)
      const perte = Math.floor(Math.min(coinsOf(addr) * RAID_SWIPE_SHARE, incomePerSecond(addr) * RAID_SWIPE_CAP_S + 500))
      if (perte > 0 && spend(addr, perte)) {
        dropAt(addr, perte, { x: p.x, y: p.y, z: p.z })
        void room.send('raidSwipe', { lost: perte }, { to: [addr] })
        log(`raid: swiped ${displayName(addr)} for ${perte}`)
      } else {
        void room.send('raidSwipe', { lost: 0 }, { to: [addr] })
      }
    }
    if (frappe) m.swipeAtMs = now
  })

  log('raid ready')
}
