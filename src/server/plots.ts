import { engine, Transform, PlayerIdentityData, AvatarBase, timers } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import { Storage } from '@dcl/sdk/server'
import {
  Plot, MAX_BASES_AFFICHEES, freeSpotNear, OBJECT_BUDGET, DECOR_COST, BASE_FIXED_COST, BASE_FIXED_COST_FAR, STOREY_COST_FAR, PLOT_MAX_ITEMS, openFloors, openSlots, rebirthCost, REBIRTH_MAX, luckCost, prestigeTier, incomeMultiplier, snapToGrid, invalidReason, SCENE_SIDE, floorPrice, MAX_FLOORS, LOCK_COOLDOWN_MS, OFFLINE_RATE, OFFLINE_CAP_MS, offlineCapProductionS, siloCost, SILO_MAX, AFK_PRODUCTION_MS, AFK_MOVE_M, PENDING_CAP_S, DAILY_REWARDS, SENTRY_TIERS, SENTRY_MAX_CHARGES, SENTRY_MIN_PRICE, crowdBonus, slotPosition, SAME_STOREY, PLOT_SPOTS, firstFreeSpot, nearestSpot, prixParCharge, shieldFor, FLOOR_HEIGHT, PLACE_RANGE, SLOTS_PER_FLOOR, GEARS, VIDE, occupe, BASE_SIDE, orientToBase, floorPrestigeRequired
} from '../shared/schemas'
import { INCOME_PER_RARITY } from './loot'
import {
  itemIncome, itemOdds, rarityOf, prixDeRevente, rarity, traitsDe, TRAITS_MAX, encoder, mutationDe, skinDebloque, SKIN_NEEDS, RARITIES, MUTATIONS, mutation
} from '../shared/loot-table'
import { log, flushLog } from './log'
import { clearJournal } from './records'
import { QUESTS, QUEST_CRATE, QUEST_BONUS_CRATE, questsFor, QuestType } from '../shared/quests'
import { hasSomethingToRecover } from './theft'
import { room } from '../shared/messages'
import { PRESTIGE_CASH_SHARE } from '../shared/economy'

const BASE_KEY = (a: string) => `base:${a}`
const PLAYER_KEY = 'profile'
const JOURNAL_KEY = 'journal'
const SAUVE_MS = 5000

/**
 * A base, including the parts of its owner that a visitor can see.
 *
 * Floors, sentries and prestige used to be read out of the owner's profile at publish time.
 * Profiles are loaded when a player joins; bases are restored for everybody. So the building
 * of anyone who was not currently connected went out with one floor, no sentries and no
 * prestige, which is to say it looked like a beginner's, and a visitor walking into a
 * three-storey base saw a hut. The visible parts are kept on the base and saved with it, and
 * refreshed from the profile whenever there is one.
 */
type Base = {
  address: string
  name: string
  items: number[]
  x: number          // player-chosen position
  z: number
  entity: ReturnType<typeof engine.addEntity>
  lastSeen: number
  floorsBought: number
  sentries: number
  sentryFloors: number[]
  sentryTier: number
  rebirths: number
  given: number
  received: number
  /** Successful thefts by this base's owner: the thieves' board reads it, present or absent. */
  vols: number
  /** The mutation skin on the building, 0 for none; kept on the base so an absent owner's stays painted. */
  skin: number
  /** Mines set inside the base: kept until stepped on, whoever is away, and regrown at every server start. */
  mines: Mine[]
}
export type Mine = { x: number; y: number; z: number }
type Profil = {
  coins: number
  items: number[]
  crates?: number[]
  itemsFound?: number
  rebirths?: number
  floorsBought?: number
  /** Silos bought: each one adds `SILO_STEP_S` seconds of production to the offline cap. */
  silos?: number
  /** When the last lock the owner PRESSED for ends: the button's recharge counts from here and from nothing else. */
  lockUsedUntil?: number
  vuA?: number
  /** Dernier signe de vie: un deplacement ou une depense. Voir `AFK_PRODUCTION_MS`. */
  agiA?: number
  /*
    La cagnotte: ce que les etageres ont produit et que le joueur n'a pas encore ramasse.

    Retiree le 7 Sep au petit matin, remise le meme jour par decision du proprietaire, qui
    voulait garder au bouton contextuel un etat de base. Voir `PENDING_CAP_S` pour ce qui a
    change avec son retour: elle est bornee comme avant, mais elle ne se remplit plus en
    silence.
  */
  pending?: number
  lastDay?: number
  streak?: number
  /*
    La semaine de coffres, comme un ENSEMBLE et non comme un compteur.

    Le bandeau etait pilote par `streak`, un seul nombre. Un nombre ne peut dire que "combien
    d'affilee", donc l'interface ne pouvait colorer qu'un PREFIXE de cases, jamais celles que
    le joueur avait reellement prises (proprietaire, 7 Sep). Et `Math.min(streak + 1, 7)`
    SATURE: au septieme jour la valeur ne redescend plus jamais, donc les sept cases restaient
    vertes pour toujours et la recompense restait figee sur la derniere.

    `semaineDebut` est le jour UTC ou la semaine courante a commence, `semainePris` la liste
    des jours 1 a 7 deja encaisses. L'ensemble dit exactement ce qui a ete pris, dans
    n'importe quel ordre, et il se vide quand la semaine tourne.
  */
  semaineDebut?: number
  semainePris?: number[]
  sentries?: number
  sentryFloors?: number[]
  sentryTier?: number
  gears?: number[]
  given?: number
  received?: number
  tuto?: number
  questDay?: number
  /*
    Les trois quetes tirees pour la journee, ECRITES au moment du tirage.

    Elles etaient recalculees a chaque lecture depuis le numero du jour. Cela suffisait tant
    que le tirage ne dependait que de la date, mais des qu'il depend AUSSI du joueur (un
    debutant recoit la quete d'apprentissage), un joueur qui cesse d'etre debutant en cours de
    journee verrait sa liste changer sous ses pieds, et `questProgress`, qui est indexe par
    place, pointerait sur les mauvaises quetes. On tire une fois, on ecrit, on s'y tient.
  */
  questIds?: number[]
  questProgress?: number[]
  questsClaimed?: number[]
  vus?: number[]
  x?: number
  z?: number
  lastMove?: number
  /**
   * Seconds already spent in the venue, and whether the one-off welcome crate was taken.
   *
   * Both used to live in a Map on the server, and the platform stops that server two
   * minutes after the venue empties. So the fifteen-minute clock restarted every time the
   * place went quiet and the crate could be claimed again on the next visit, for ever.
   * They belong to the player, so they are written with the player.
   */
  playedS?: number
  giftTaken?: boolean
  /** Combien de cadeaux de temps ont ete pris. Un drapeau ne savait en compter qu'un. */
  giftsTaken?: number
  alerts?: object[]
  /** The base skin chosen in the Index, a mutation id, 0 for none. */
  skin?: number
  /** Sound effects switched off from the menu. Absent means on. */
  sfxOff?: boolean
  /** The title card has been seen once; it never shows again for this player. */
  welcomed?: boolean
  /** The last offline sum cashed, carried in the wallet tick for a while so a late client still hears it. */
  annonceHL?: { gain: number; seconds: number; at: number; capped: boolean }
  /** Bought luck: every mutation's odds doubled until this instant. */
  luckUntil?: number
  /** Achats de chance empiles depuis la derniere expiration: c'est lui qui fait monter le prix. */
  luckAchats?: number
  /** What this player has fed the fusion machine so far, all of one rarity. */
  fusion?: number[]
}

const bases = new Map<string, Base>()
const profiles = new Map<string, Profil>()
const dirtyBases = new Set<string>()
/** Une semaine sans venir et la base sort du terrain, sans rien perdre de son contenu. */
const BASE_FRAICHEUR_MS = 7 * 24 * 60 * 60 * 1000
/*
  AN EMPTY BASE FOLDS AFTER SIX HOURS AWAY; a base with loot never folds on a clock.

  The rule under `displayCost` stands: a base with something on its shelves is a target, and a
  world without buildings is a dead world, so room is made under pressure only. An empty base
  is not a target: nothing to steal, nothing produced, no pot. It only holds a square of twenty
  metres, and the field was filling with squares held by testers who placed and left (owner,
  10 Sep: bases on one side of the field, and that side tight). So an empty base whose owner
  has been away this long leaves the field exactly as `makeRoom` retires one: memory only, the
  record stays, and the owner who returns finds it rebuilt (see `welcome`). Six hours is a
  knob: a session break keeps the base, a night away folds it.
*/
const EMPTY_FOLD_MS = 6 * 3600_000
/*
  The one-off pass the owner asked for on 10 Sep: every empty base already standing folds once,
  at the first boot carrying this mark, whatever its owner's absence. A DATE, like the reset
  mark, so it runs once and never again.
*/
const EMPTY_FOLD_MARK = '2026-09-10-fold-empty'
const EMPTY_FOLD_KEY = 'fold-empty'
const dirtyProfiles = new Set<string>()


/**
 * A name for a player, and a readable stand-in when the client has not published one.
 *
 * The fallback used to be the first eight characters of the wallet address, which is how a
 * line of the event feed came to read "3vE5GGa3 took a Rare from ...". It is not wrong, it
 * is unreadable, and it looks like a defect to anybody who does not know what an address
 * is. Four characters after the word Guest say the same thing, tell the reader it is a
 * placeholder, and stay short enough for a feed line.
 */
/*
  Names the clients declared for themselves, which win over the avatar component. That
  component reaches the server late on a fresh instance, and a name inferred from it once
  was written into the base for good: GUEST 20E0 on the owner's own sign (4 Sep).
*/
const declaredNames = new Map<string, string>()

export function declareName(address: string, raw: string): void {
  const clean = String(raw).replace(/[^\x20-\x7e]/g, '').trim().slice(0, 24)
  if (clean === '' || declaredNames.get(address) === clean) return
  declaredNames.set(address, clean)
  const b = bases.get(address)
  if (b !== undefined && b.name !== clean) { b.name = clean; dirtyBases.add(address); publish(b) }
}

function nameOf(address: string): string {
  const declared = declaredNames.get(address)
  if (declared !== undefined) return declared
  for (const [e, id] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (id.address?.toLowerCase() !== address) continue
    const n = AvatarBase.getOrNull(e)?.name
    if (n !== undefined && n !== '') return n
    break
  }
  return `Guest ${address.slice(-4)}`
}

/*
  Who is here, with a memory, because the raw component blinks.

  `PlayerIdentityData` can be absent for a tick while an avatar changes state, and every
  loop that read it directly treated one missing tick as a departure. Measured on 26 Aug: a
  tester opened a crate, the item landed in their hand, and eight seconds later the carry
  loop logged "released (you left)" with no join/leave in between. They had not moved. One
  blink of the component sent their item home while their screen still said CARRYING.

  So presence is a timestamp per address: seen now, or seen within the grace. A player is
  gone when they have been unseen for `PRESENCE_GRACE_MS`, not when a frame skipped them.
  Same logic as the earned shield reading real absence rather than a flag (invariant 123).
*/
const PRESENCE_GRACE_MS = 5_000
const vuA = new Map<string, number>()

export function presents(): Set<string> {
  const now = Date.now()
  for (const [, id] of engine.getEntitiesWith(PlayerIdentityData)) {
    const a = id.address?.toLowerCase()
    if (a) vuA.set(a, now)
  }
  const s = new Set<string>()
  for (const [a, t] of vuA) {
    if (now - t <= PRESENCE_GRACE_MS) s.add(a)
    else vuA.delete(a)
  }
  return s
}

function arrange(items: number[]): number[] {
  return [...items]
}

function publish(b: Base, ici?: Set<string>): void {
  const c = Plot.getMutableOrNull(b.entity)
  if (c === null) return
  // A loaded profile is the truth and refreshes the shopfront; otherwise the shopfront is
  // what the base remembers, which is what an absent owner's building has to be drawn from.
  const pr = profiles.get(b.address)
  if (pr !== undefined) {
    /*
      Copied here, and marked for saving here, because remembering to do it at each call site
      is the same as not doing it. Buying a floor happened to mark the base dirty; arming a
      sentry and crossing a prestige did not, so those two would have shown correctly until
      the owner logged off and then quietly reverted.
    */
    const avant = `${b.floorsBought}|${b.sentryFloors.join(',')}|${b.rebirths}|${b.given}|${b.received}|${b.skin}`
    b.floorsBought = pr.floorsBought ?? 0
    b.rebirths = pr.rebirths ?? 0
    b.given = pr.given ?? 0
    b.received = pr.received ?? 0
    b.skin = pr.skin ?? 0
    if (`${b.floorsBought}|${b.sentryFloors.join(',')}|${b.rebirths}|${b.given}|${b.received}|${b.skin}` !== avant) {
      dirtyBases.add(b.address)
    }
  }
  /*
    The name heals itself. On a server just replaced, the owner's welcome runs before the
    avatar's name has arrived, so the base was christened "Guest 20e0" and that fallback
    was saved for good (owner, 4 Sep, sign reading GUEST 20E0). The real name is read
    again every time the base is published while its owner is here, and the first time it
    resolves to something better than the fallback it replaces it, on the sign and in the
    record.
  */
  if (c.ownerPresent || (ici ?? presents()).has(b.address)) {
    const n = nameOf(b.address)
    if (n !== b.name && !n.startsWith('Guest ')) { b.name = n; dirtyBases.add(b.address) }
  }
  c.floors = openFloors(b.floorsBought)
  c.rebirths = b.rebirths
  c.ownerId = b.address
  c.ownerName = b.name
  c.items = arrange(b.items)
  c.ownerPresent = (ici ?? presents()).has(b.address)
  c.given = b.given
  c.received = b.received
  c.skin = b.skin ?? 0
  c.sentries = totalCharges(b.sentryFloors)
  c.sentryFloors = [...b.sentryFloors]
}

type Vitrine = { floorsBought: number; sentries: number; sentryFloors: number[]; sentryTier: number; rebirths: number; given: number; received: number; vols: number; skin: number; mines: Mine[] }
const VITRINE_VIDE: Vitrine = { floorsBought: 0, sentries: 0, sentryFloors: [], sentryTier: 0, rebirths: 0, given: 0, received: 0, vols: 0, skin: 0, mines: [] }
/** The shopfront of a base its owner carries in hand (folded while empty): put back by `placeBase`. */
const vitrineEnMain = new Map<string, Vitrine>()

/** Charges on a storey, zero when that storey has none and when the array is short. */
export function chargesA(liste: number[] | undefined, etage: number): number {
  return liste === undefined || etage < 0 ? 0 : (liste[etage] ?? 0)
}

/**
 * A stored base blob's per-storey charges, whatever generation of blob it is.
 *
 * Blobs written before defences had storeys carry one count, `sentries`; it all sits on the
 * ground floor, which is where an undifferentiated defence effectively was.
 *
 * The charges live on the BASE record and nowhere else. They used to be copied between the
 * profile and the base, and the sentry fired from the profile, which is loaded only for
 * players who have connected to this server run. An absent owner's profile is never loaded,
 * so an absent owner's turret never fired: the one situation the whole defence exists for,
 * and the tester robbed a guarded base twice, "away 2028 min", without a shot. The base
 * record exists for every base on the field, present or absent, is what the clients draw,
 * and is what is saved, so it is the single place a charge can be spent from.
 */
export function defensesDe(brut: { sentryFloors?: number[]; sentries?: number } | null | undefined): number[] {
  if (Array.isArray(brut?.sentryFloors)) return [...brut.sentryFloors]
  const n = brut?.sentries ?? 0
  return n > 0 ? [n] : []
}

export function totalCharges(liste: number[] | undefined): number {
  return liste === undefined ? 0 : liste.reduce((a, b) => a + b, 0)
}

function createBase(
  address: string, name: string, items: number[], lastSeen: number, x: number, z: number,
  vitrine: Vitrine = VITRINE_VIDE
): Base | null {
  try {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(x, 0, z) })
  Plot.create(e, { floors: 1, rebirths: 0, index: 0, ownerId: address, ownerName: name, items: arrange(items), ownerPresent: false, lockedUntil: 0 })
  syncEntity(e, [Plot.componentId, Transform.componentId])
  const b: Base = { address, name, items: [...items], x, z, entity: e, lastSeen, ...vitrine }
  bases.set(address, b)
  publish(b)
  return b
  } catch (err) {
    log(`createBase THREW for ${address.slice(0, 8)}: ${err}`)
    return null
  }
}

/*
  La place se libere sous PRESSION, jamais au chronometre.

  Une base absente reste utile: c'est une cible de vol, et un monde vide de batiments est un
  monde mort. On ne retire donc rien tant que le budget d'objets tient. Le jour ou il ne tient
  plus, ce qui cede est la base de l'ABSENT vu il y a le plus longtemps: par construction celle
  que personne ne regarde, et jamais celle de quelqu'un qui joue.

  Rien n'est detruit. `removeBase` ne touche qu'a la memoire; l'enregistrement `base:` reste au
  stockage avec ses objets, ses etages et ses sentinelles. Le proprietaire qui revient est
  present, donc il reprend rang devant tous les absents et retrouve sa base. Le seul prix de
  l'absence est qu'une base retiree ne rapporte plus: `incomePerSecond` rend zero sans base, ce
  qui est exactement la regle voulue (proprietaire, 3 Sep, "pas d'or si base pas exposee").

  Et si TOUT le monde est present et que le budget est plein, on refuse, en le disant. Ce n'est
  plus notre limite a ce moment-la, c'est celle du telephone.
*/
function displayCost(b: Base): number {
  const etages = Math.max(1, Math.min(openFloors(b.floorsBought), MAX_FLOORS))
  return BASE_FIXED_COST_FAR + etages * STOREY_COST_FAR
}

function budgetUsed(): number {
  let n = DECOR_COST
  for (const b of bases.values()) n += displayCost(b)
  return n
}

/** Vrai si une base de plus tient, quitte a retirer celle du plus anciennement absent. */
function makeRoom(pourQui: string, cout: number): boolean {
  if (budgetUsed() + cout <= OBJECT_BUDGET) return true
  const ici = presents()
  let victime: string | null = null
  let vu = Number.POSITIVE_INFINITY
  for (const [a, b] of bases) {
    if (a === pourQui || ici.has(a)) continue
    if (b.lastSeen < vu) { vu = b.lastSeen; victime = a }
  }
  if (victime === null) return false
  const heures = Math.round((Date.now() - vu) / 3600_000)
  log(`budget plein: la base de ${nameOf(victime)} se retire (absent depuis ${heures} h) pour ${nameOf(pourQui)}`)
  removeBase(victime)
  return budgetUsed() + cout <= OBJECT_BUDGET || makeRoom(pourQui, cout)
}

function removeBase(address: string): void {
  const b = bases.get(address)
  if (!b) return
  engine.removeEntity(b.entity)
  bases.delete(address)
}

/** Folds the empty bases whose owner has been away longer than `absenceMs`; returns how many. */
function foldEmptyBases(absenceMs: number): number {
  const ici = presents()
  const now = Date.now()
  let n = 0
  for (const [a, b] of [...bases]) {
    if (ici.has(a) || occupe(b.items) > 0 || now - b.lastSeen <= absenceMs) continue
    const heures = Math.round((now - b.lastSeen) / 3600_000)
    log(`${b.name || a.slice(0, 8)}'s empty base folds (away ${heures} h): the square is free again`)
    removeBase(a)
    n += 1
  }
  return n
}

/**
 * La remise a zero du monde, executee une seule fois et jamais deux.
 *
 * Un test reprend a zero: chaque joueur repose sa base, repart sans or, sans objets, sans
 * caisses et sans prestige (proprietaire, 1 Sep). Ce n'est pas une suppression manuelle cle par
 * cle, qui demanderait une signature par operation et laisserait forcement quelque chose
 * derriere: le serveur enumere lui-meme les bases enregistrees, en tire la liste des adresses,
 * et efface les deux cotes du stockage.
 *
 * `WORLD_RESET_MARK` est une DATE, pas un booleen. Une fois le nettoyage fait, elle est
 * ecrite dans le stockage, et un demarrage suivant qui lit la meme valeur ne recommence pas.
 * Laisser la constante en place est donc sans danger; il faut la CHANGER pour provoquer une
 * nouvelle remise a zero. Un booleen oublie a `true`, lui, aurait vide le monde a chaque
 * redemarrage du serveur, c'est-a-dire plusieurs fois par jour.
 */
const WORLD_RESET_MARK = '2026-09-02-place-reservee'
const RESET_KEY = 'reset'

/**
 * Le marqueur relu, qu'il ait ete ecrit brut ou encode.
 *
 * Il etait ECRIT avec `JSON.stringify`, donc entre guillemets, et RELU tel quel puis compare
 * a la constante sans guillemets. Les deux ne pouvaient jamais etre egaux, donc la remise a
 * zero se declenchait a CHAQUE demarrage du serveur, et le serveur s'arrete deux minutes
 * apres le depart du dernier joueur: bases, objets et pieces de tout le monde disparaissaient
 * des que la place se vidait. Le commentaire au-dessus decrivait exactement le desastre que
 * la comparaison provoquait ("aurait vide le monde a chaque redemarrage"), en croyant l'avoir
 * evite (trouve le 2 Sep, en constatant qu'un profil prepare pour un test s'effacait seul).
 *
 * On tolere les deux formes, parce que le stockage de production contient deja l'ancienne.
 */
function readMarker(brut: string | null | undefined): string | null {
  if (typeof brut !== 'string' || brut.length === 0) return null
  if (brut[0] !== '"') return brut
  try {
    const v: unknown = JSON.parse(brut)
    return typeof v === 'string' ? v : brut
  } catch {
    return brut
  }
}

/*
  Les comptes que la remise a zero est en train d'effacer, tant qu'elle n'a pas fini.

  Le menage tourne en tache de fond pour ne pas tuer le demarrage, et cela ouvre une fenetre:
  un joueur qui arrive pendant que son profil existe encore le fait relire par `welcome`,
  qui lui REFABRIQUE sa base depuis les coordonnees du profil, puis la marque a sauvegarder.
  La remise a zero effacait donc ce que l'arrivee venait de ressusciter, et en pire: reecrit,
  donc definitif (proprietaire, 3 Sep, "il y a toujours ma base"). Un compte inscrit ici
  arrive VIERGE jusqu'a ce que son effacement soit passe.
*/
const beingErased = new Set<string>()

async function worldReset(): Promise<Set<string>> {
  const efface = new Set<string>()
  try {
    const fait = readMarker(await Storage.get<string>(RESET_KEY))
    if (fait === WORLD_RESET_MARK) return efface

    /*
      Le marqueur AVANT le menage, jamais apres.

      Il etait ecrit en dernier, apres une boucle de DEUX appels de stockage ATTENDUS par
      compte. Un tour asynchrone de scene est tue a soixante secondes: passe une centaine de
      comptes le menage n'avait pas fini, l'isolat mourait, le serveur redemarrait, et la
      remise a zero repartait de zero sans jamais poser son marqueur. Une boucle qui ne peut
      pas se terminer, et un monde qui recharge sans fin: 39%, 0%, 38%, 0% (proprietaire,
      3 Sep). Marqueur d'abord, le pire cas devient un menage incomplet, qui se rattrape;
      marqueur apres, le pire cas est un monde qu'on ne peut plus charger du tout.
    */
    const pose = await Storage.set(RESET_KEY, WORLD_RESET_MARK)
    log(`remise a zero ${WORLD_RESET_MARK}: marqueur pose (${pose}), lu avant "${fait ?? 'aucun'}"`)

    const res = await Storage.getValues({ prefix: 'base:' })
    for (const e of res.data) {
      const a = e.key.slice('base:'.length)
      if (a.length > 0) { efface.add(a); beingErased.add(a) }
    }
    await Storage.delete(JOURNAL_KEY)
    clearJournal()
    bases.clear()
    profiles.clear()
    dirtyBases.clear()
    dirtyProfiles.clear()
    log(`remise a zero: ${efface.size} compte(s) a effacer, en tache de fond`)

    /*
      Le menage lui-meme SORT du chemin de demarrage. Il ne retient plus l'arrivee des
      joueurs, et sa duree ne compte plus dans le tour qui peut tuer l'isolat. Les comptes
      concernes sont rendus a l'appelant, qui les ignore en restaurant: sans cela le
      chargement remonterait les bases que cette boucle est en train de supprimer.
    */
    void (async () => {
      let n = 0
      try {
        for (const a of efface) {
          await Storage.delete(BASE_KEY(a))
          await Storage.player.delete(a, PLAYER_KEY)
          beingErased.delete(a)
          n += 1
        }
      } catch (e) {
        log(`remise a zero: menage interrompu apres ${n}: ${e}`)
        beingErased.clear()
        return
      }
      beingErased.clear()
      log(`remise a zero: ${n} compte(s) effaces`)
    })()
  } catch (e) {
    log(`remise a zero impossible: ${e}`)
  }
  return efface
}

/**
 * Tant que le stockage n'a pas parle, personne n'est accueilli.
 *
 * `loadBases()` est asynchrone et `startPlots()` ne l'attend pas, alors que la boucle
 * d'arrivee tourne des la premiere seconde. Le nettoyage du monde, lui, enchaine une dizaine
 * d'appels au stockage puis vide `profiles` et `bases`: un joueur arrive entre les deux etait
 * accueilli, son profil charge, PUIS efface par le nettoyage, et comme la boucle le comptait
 * deja parmi les presents elle ne le reaccueillait jamais. Tout ce qu'il tentait repondait
 * "unknown profile" jusqu'a ce qu'il quitte le monde (proprietaire, 2 Sep, premiere base apres
 * la remise a zero).
 *
 * La course existait aussi sans nettoyage, en plus discret: welcome quelqu'un avant que les
 * bases soient relues, c'est risquer d'en creer une deuxieme sur les coordonnees de son profil.
 * Le drapeau se leve dans un `finally`, donc meme une lecture qui echoue laisse le monde
 * ouvrir, sans quoi une panne de stockage fermerait la porte a tout le monde.
 */
let pret = false
export function plotsPrets(): boolean { return pret }

async function loadBases(): Promise<void> {
  const efface = await worldReset()
  try {
    const res = await Storage.getValues({ prefix: 'base:' })
    let restoreBudget = DECOR_COST
    const loaded = res.data
      .map(({ key, value }) => baseDepuisBlob(key, value))
      // One unreadable record skips itself, it does not take the whole street down with it.
      .filter((l): l is BaseBlob => l !== null)
      .filter((l) => typeof l.x === 'number' && typeof l.z === 'number')
      // Les comptes que la remise a zero est en train d'effacer ne remontent pas.
      .filter((l) => !efface.has(l.address))
      /*
        La rue montre les joueurs qui jouent, pas l'archive de tous les passages.

        Tant que les bases etaient posees ou leur proprietaire les avait posees, elles etaient
        eparpillees sur cent quatre-vingt-douze metres et personne ne croisait les anciennes.
        Depuis qu'elles tiennent sur seize emplacements au milieu de la carte, TOUTES sont
        visibles d'un coup, et un monde qui montrait trois bases s'est mis a en aligner seize,
        dont des comptes invites d'un seul passage: le testeur y a vu des bots (1 Sep). Ce
        n'etait pas des bots, c'etaient de vrais visiteurs, mais l'effet est le meme et il est
        pire: la rue raconte une frequentation qui n'existe pas.

        Une base absente depuis plus d'une semaine reste enregistree, avec ses objets, ses
        etages et son prestige; elle n'occupe simplement plus le terrain, et se releve au
        retour de son proprietaire.
      */
      .filter((l) => Date.now() - l.lastSeen < BASE_FRAICHEUR_MS)
      // The standing rule of EMPTY_FOLD_MS applies at boot too, or every restart (each deploy,
      // each cold start after two idle minutes) would raise the empty bases for a minute.
      .filter((l) => !(occupe(l.items) === 0 && Date.now() - l.lastSeen > EMPTY_FOLD_MS))
      .sort((a, b) => b.lastSeen - a.lastSeen)
      /*
        On restaure tant que le BUDGET suit, pas jusqu'a un nombre fixe.

        Le plafond etait un compte, `MAX_BASES_AFFICHEES`, calcule sur une base moyenne de trois
        etages. Vingt-quatre tours de quatre etages passaient donc la porte et depassaient le
        budget de cinquante objets, sans que rien ne le voie (proprietaire, 3 Sep, "et si il y a
        20 bases de 4 etages ?"). On additionne maintenant le cout reel de chacune, de la plus
        recemment vue a la plus ancienne, et on s'arrete quand la somme est atteinte: une carte
        de petites bases en accueille davantage qu'une carte de tours, ce qui est exactement la
        realite de ce que le telephone dessine.
      */
      .filter((l) => {
        const etages = Math.max(1, Math.min(openFloors(l.vitrine?.floorsBought ?? 0), MAX_FLOORS))
        const cout = BASE_FIXED_COST_FAR + etages * STOREY_COST_FAR
        if (restoreBudget + cout > OBJECT_BUDGET) return false
        restoreBudget += cout
        return true
      })
    /*
      The shopfront travels with the base, so a building whose owner is away still stands.

      Each one is re-checked against the bases already standing, and moved to the nearest legal
      square when its stored spot is no longer one. The list is sorted most-recently-seen first,
      so when two old neighbours overlap it is the one nobody has visited in longest that gives
      ground. A base that still satisfies the rule does not move by a centimetre.
    */
    /*
      Une base posee ne bouge plus jamais toute seule.

      Il y avait ici une migration qui ramenait chaque base sur l'emplacement fixe le plus
      proche. Elle etait juste sur le papier et desastreuse en pratique: elle a deplace en une
      fois toutes les bases d'un monde en production, ecrase les anciennes coordonnees dans le
      stockage, et laisse des joueurs devant un batiment qui n'etait plus la ou ils l'avaient
      laisse (1 Sep). Le contenu etait intact, ce qui ne console personne.

      La regle qui remplace: le serveur restaure ce qui est enregistre, exactement. Les
      emplacements fixes ne servent qu'a poser les bases NEUVES, la ou personne n'a rien a
      perdre. Une position ecrite par un joueur est un fait, pas une suggestion.
    */
    for (const l of loaded) {
      createBase(l.address, l.name, l.items, l.lastSeen, l.x, l.z, l.vitrine ?? VITRINE_VIDE)
    }
    log(`${loaded.length} of ${res.pagination.total} bases restored`)
    // The one-off pass over what just came back (see EMPTY_FOLD_MARK); the standing rule runs every minute.
    const marque = readMarker(await Storage.get<string>(EMPTY_FOLD_KEY))
    if (marque !== EMPTY_FOLD_MARK) {
      const n = foldEmptyBases(0)
      const pose = await Storage.set(EMPTY_FOLD_KEY, EMPTY_FOLD_MARK)
      log(`fold-empty ${EMPTY_FOLD_MARK}: ${n} empty bases folded, marker set (${pose}), read before "${marque ?? 'none'}"`)
    }
    // Each defended base's charges per storey, as restored: the one line that says whether a
    // storey's defence survived a restart or was already gone in the record (owner, 4 Sep).
    for (const l of loaded) {
      const f = l.vitrine?.sentryFloors ?? []
      if (f.some((n) => n > 0)) log(`restored ${l.name || l.address.slice(0, 8)}: floorsBought=${l.vitrine?.floorsBought ?? 0} sentryFloors=[${f.join(',')}]`)
    }

    /*
      Bases saved before the shopfront existed are filled in from their owner's profile, once.

      Moving those fields onto the base only helped what was saved after the move: everything
      already in storage came back with no floors bought, so a three-storey building whose
      owner happened to be offline still came up as a hut. The profile still holds the truth,
      so it is read here for exactly the bases that never wrote one, and the next save cycle
      makes the read unnecessary for ever.
    */
    const aRattraper = loaded.filter((l) => l.vitrine === null)
    for (const l of aRattraper) {
      try {
        const raw = await Storage.player.get<string>(l.address, PLAYER_KEY)
        if (!raw) continue
        const prof = JSON.parse(raw) as Partial<Profil>
        const b = bases.get(l.address)
        if (b === undefined) continue
        b.floorsBought = prof.floorsBought ?? 0
        b.rebirths = prof.rebirths ?? 0
        b.given = prof.given ?? 0
        b.received = prof.received ?? 0
        dirtyBases.add(l.address)
        publish(b)
      } catch (e) {
        log(`could not backfill the shopfront of ${l.address.slice(0, 8)}: ${e}`)
      }
    }
    if (aRattraper.length > 0) log(`shopfront backfilled for ${aRattraper.length} older base(s)`)
  } catch (e) {
    log(`ERROR could not read bases: ${e}`)
  }
}

/** Everything about a base that has to survive it, written in one place so nothing is dropped. */
type BaseBlob = { address: string; name: string; items: number[]; lastSeen: number; x: number; z: number; vitrine: Vitrine | null }

/** A stored `base:` record read back, or null when it cannot be parsed. */
function baseDepuisBlob(key: string, value: unknown): BaseBlob | null {
  try {
    const v = typeof value === 'string' ? JSON.parse(value) : (value as any)
    if (v === null || typeof v !== 'object') return null
    return {
      address: key.slice('base:'.length), name: v.name ?? '', items: Array.isArray(v.items) ? v.items : [],
      lastSeen: v.lastSeen ?? 0, x: v.x, z: v.z,
      // Left null on purpose when the blob predates these fields: null means "never written",
      // which is what tells the migration in the restore to go and find them.
      vitrine: v.floorsBought === undefined ? null : {
        floorsBought: v.floorsBought, sentries: v.sentries ?? 0,
        sentryFloors: defensesDe(v), sentryTier: v.sentryTier ?? 0, vols: v.vols ?? 0,
        rebirths: v.rebirths ?? 0, given: v.given ?? 0, received: v.received ?? 0, skin: v.skin ?? 0, mines: Array.isArray(v.mines) ? v.mines : []
      }
    }
  } catch (e) {
    log(`ERROR unreadable base record ${key}: ${e}`)
    return null
  }
}

async function lireBase(address: string): Promise<BaseBlob | null> {
  const raw = await Storage.get<string>(BASE_KEY(address))
  return raw ? baseDepuisBlob(BASE_KEY(address), raw) : null
}

function vitrineDe(b: Base): Vitrine {
  return {
    floorsBought: b.floorsBought, sentries: b.sentries, sentryFloors: b.sentryFloors, sentryTier: b.sentryTier,
    rebirths: b.rebirths, given: b.given, received: b.received, vols: b.vols, skin: b.skin ?? 0, mines: b.mines
  }
}

function blobDeBase(b: Base): string {
  return JSON.stringify({
    name: b.name, items: b.items, lastSeen: b.lastSeen, x: b.x, z: b.z,
    floorsBought: b.floorsBought, sentries: b.sentries, sentryFloors: b.sentryFloors, sentryTier: b.sentryTier, rebirths: b.rebirths,
    given: b.given, received: b.received, vols: b.vols, skin: b.skin ?? 0, mines: b.mines
  })
}

async function save(): Promise<void> {
  for (const a of [...dirtyBases]) {
    dirtyBases.delete(a)
    const b = bases.get(a)
    if (!b) continue
    const ok = await Storage.set(BASE_KEY(a), blobDeBase(b))
    if (!ok) { log(`ERROR base save failed ${a}`); dirtyBases.add(a) }
  }
  for (const a of [...dirtyProfiles]) {
    dirtyProfiles.delete(a)
    const p = profiles.get(a)
    if (!p) continue
    const ok = await Storage.player.set(a, PLAYER_KEY, JSON.stringify(p))
    if (!ok) { log(`ERROR profile save failed ${a}`); dirtyProfiles.add(a) }
  }
}

export async function welcome(address: string): Promise<void> {
  const raw = await Storage.player.get<string>(address, PLAYER_KEY)
  // Un compte que la remise a zero est en train d'effacer arrive neuf, jamais avec son
  // ancien profil: sinon l'arrivee refabrique la base que le menage vient de supprimer.
  const enEffacement = beingErased.has(address)
  if (enEffacement) {
    beingErased.delete(address)
    log(`${nameOf(address)} arrive pendant la remise a zero: profil ignore, compte neuf`)
    await Storage.player.delete(address, PLAYER_KEY)
    await Storage.delete(BASE_KEY(address))
  }
  const stocke: Profil | null = (!enEffacement && raw) ? JSON.parse(raw) : null
  const items = stocke?.items ?? []
  // Spread the stored profile, then override only the exceptions. A whitelist of fields
  // silently drops everything added to the type later, and the failure is invisible.
  const profile: Profil = {
    ...(stocke ?? {}),
    coins: stocke?.coins ?? 0,
    items: [...items],
    // One Basic crate in a brand-new pocket. The tutorial's second step is "Open your
    // crate", and until now a fresh account owned none: the step named a thing that did
    // not exist (tester, 30 Aug). The reference solves the first minute with a near-free
    // buy off its conveyor; ours is a crate already in hand, which the second step opens.
    crates: stocke?.crates ?? [1],
    itemsFound: stocke?.itemsFound ?? items.length,
    floorsBought: stocke?.floorsBought ?? 0,
    rebirths: stocke?.rebirths ?? 0,
    alerts: stocke?.alerts ?? []
  }
  // Arriver, c'est agir: la production part tout de suite, la regle anti-AFK compte depuis ici.
  profile.agiA = Date.now()
  profiles.set(address, profile)
  dirtyProfiles.add(address)

  const name = nameOf(address)
  if (!bases.has(address)) {
    const blob = await lireBase(address)
    /*
      What comes back with the owner: the shopfront always, the building only when it holds
      something.

      A base that left the field while EMPTY (folded, see EMPTY_FOLD_MS) comes back in its
      owner's hand, not on its old square: they place it again, where the arrival set them
      down, which is the emptiest eighth of the field (owner, 10 Sep: "on ne la renvoie pas
      plutot dans sa main ?"). Nothing is lost by it: the shelves were bare, and the shopfront
      (floors bought, sentries, mines, the prestige count) is kept aside here and put back on
      the new square by `placeBase`. A base with loot on it only ever left under budget
      pressure, and it comes back where it stood, as before.
    */
    if (blob?.vitrine) vitrineEnMain.set(address, blob.vitrine)
    const vide = blob !== null ? occupe(blob.items) === 0 : occupe(items) === 0
    if (profile.x !== undefined && profile.z !== undefined && vide) {
      log(`${name}'s empty base comes back in their hand: placed again where they choose`)
      profile.x = undefined
      profile.z = undefined
      dirtyProfiles.add(address)
    }
  }
  // Celui qui arrive est PRESENT: il passe devant tous les absents et retrouve sa base.
  if (!bases.has(address) && profile.x !== undefined && profile.z !== undefined) {
    makeRoom(address, BASE_FIXED_COST_FAR + STOREY_COST_FAR)
  }
  if (!bases.has(address) && profile.x !== undefined && profile.z !== undefined) {
    // Their previous spot when recorded, a free one only when there is none: nobody who had
    // chosen is ever moved. The stored BASE record is the truth for what stands there: its
    // items are the shelves as thefts and gifts left them during the absence, and it carries
    // the defence (sentry charges, mines, thief count). Rebuilding from the profile brought
    // stolen items back and wiped every paid charge (audit, 4 Sep).
    const blob = await lireBase(address)
    /*
      The square is asked for again before the base stands on it.

      A base that left the field (folded while empty, or retired under budget pressure) kept
      its square in the record, not on the ground, and a newcomer may have built there since.
      Two buildings in one square is the worst outcome there is (the melting walls, 1 Sep), so
      the stored spot is re-checked and, when it is no longer legal, the base goes to the
      nearest free square; the profile follows the base a few lines down. A spot still legal
      does not move by a centimetre.
    */
    let x = profile.x
    let z = profile.z
    let deplacee = false
    if (invalidReason(x, z, SCENE_SIDE, basePoints(address)) !== null) {
      const proche = freeSpotNear(x, z, SCENE_SIDE, basePoints(address))
      if (proche !== null) { x = proche.x; z = proche.z; deplacee = true }
    }
    const b = createBase(address, name, blob?.items ?? items, Date.now(), x, z, blob?.vitrine ?? VITRINE_VIDE)
    if (b !== null) {
      dirtyBases.add(address)
      log(`base de ${name} reposee en ${x},${z}${deplacee ? ` (the recorded ${profile.x},${profile.z} was taken)` : ''}${blob ? '' : ' (no stored record, from the profile)'}`)
    }
  }
  const existing = bases.get(address)
  if (existing) {
    /*
      One exception to "the profile follows the base": a prestige the base never saw.

      A prestige rewrites the profile (fewer items, one more rebirth) and the base's record
      in the same tick, but the two are two storage writes, five seconds apart at worst and
      capped on failure. A server replaced between them (a deploy, 4 Sep) came back with the
      profile at prestige 2 and the base's record still holding every item, so the owner
      found their shelves full again. The rebirth count is in both records, so a base that
      is BEHIND its owner's profile is one that missed a prestige, and it takes the
      profile's shelves: the ones the prestige left.
    */
    if ((profile.rebirths ?? 0) > (existing.rebirths ?? 0)) {
      log(`${name}: base record at prestige ${existing.rebirths}, profile at ${profile.rebirths}: the base takes the profile's shelves`)
      existing.items = [...profile.items]
      existing.rebirths = profile.rebirths ?? 0
      dirtyBases.add(address)
      publish(existing)
    }
    /*
      Le profil suit la base, jamais l'inverse.

      Une base restauree depuis le journal peut avoir ete posee sur un emplacement different
      de celui que le profil du joueur a memorise. Sans cette ligne les deux se contredisent:
      le batiment est ici, le profil dit la-bas, et a la prochaine reconnexion c'est la version
      du profil qui gagne et la base repart ailleurs. Le batiment qui existe est la verite.
    */
    if (profile.x !== existing.x || profile.z !== existing.z) {
      profile.x = existing.x
      profile.z = existing.z
      dirtyProfiles.add(address)
    }
    /*
      The base wins on items, not the stored profile.

      While the owner was away their shelves may have been robbed, or something may have been
      left on them. Overwriting from the profile read out of storage would undo all of it the
      moment they walked back in, which is the one thing a player would never forgive.
    */
    existing.name = name
    profile.items = [...existing.items]
    existing.lastSeen = Date.now()
    dirtyBases.add(address)
    publish(existing)
    log(`${name} found their base at ${existing.x},${existing.z}`)
    return
  }

  if (!bases.has(address)) log(`${name} arrive sans base posee`)
}

export function auRevoir(address: string): void {
  if (profiles.has(address)) dirtyProfiles.add(address)
  const b = bases.get(address)
  if (!b) return
  b.lastSeen = Date.now()
  dirtyBases.add(address)
  publish(b)
  log(`${b.name} left; base stays visible and raidable`)
}

export function coinsOf(address: string): number { return Math.floor(profiles.get(address)?.coins ?? 0) }
/** Whether this player's profile is in memory, which it is whenever they are in the venue. */
export function hasProfile(address: string): boolean { return profiles.has(address) }

/** Time already spent here, across every visit and every server this scene has had. */
export function playedTime(address: string): number { return profiles.get(address)?.playedS ?? 0 }
export function addPlayedTime(address: string, seconds: number): void {
  const p = profiles.get(address)
  if (p === undefined) return
  p.playedS = (p.playedS ?? 0) + seconds
  dirtyProfiles.add(address)
}
/*
  Un escalier, pas une marche.

  Il y avait UN cadeau, a dix minutes, et un booleen pour dire qu'il etait pris. Dix minutes
  tombe hors de la fenetre ou tout se joue: la guidance du domaine met le noyau du jeu dans la
  premiere minute et le declic avant quatre-vingt-dix secondes. Il en faut donc plusieurs,
  echelonnes, et un booleen ne sait pas compter jusqu'a deux. L'ancien drapeau est lu une
  derniere fois pour les profils qui l'ont: qui avait deja pris le cadeau des dix minutes a
  droit aux deux, il ne les redemandera pas.
*/
export function giftsTaken(address: string): number {
  const p = profiles.get(address)
  if (p === undefined) return 0
  return p.giftsTaken ?? (p.giftTaken === true ? 99 : 0)
}
export function markGiftTaken(address: string): void {
  const p = profiles.get(address)
  if (p === undefined) return
  p.giftsTaken = (p.giftsTaken ?? 0) + 1
  dirtyProfiles.add(address)
}

/**
 * Le meilleur objet que ce joueur possede, en rarete. -1 s'il n'a rien.
 *
 * Sert au butin du boss: la recompense suit la progression au lieu de sauter par-dessus.
 */
export function meilleureRarete(address: string): number {
  const b = bases.get(address)
  const p = profiles.get(address)
  let best = -1
  for (const code of b?.items ?? []) if (code !== VIDE) best = Math.max(best, rarityOf(code))
  for (const code of p?.items ?? []) if (code !== VIDE) best = Math.max(best, rarityOf(code))
  return best
}

export type BaseView = { address: string; name: string; items: number[]; entity: ReturnType<typeof engine.addEntity> }

/**
 * Which buildings the player is standing at, measured flat on purpose.
 *
 * This was a straight-line distance to the base entity, which sits on the ground. A player on
 * the third floor is directly above that point and twelve metres from it, so their own
 * building stopped being a candidate the moment they climbed the stairs. Height is the job of
 * the per-item reach; this one only asks which address the player is inside.
 */
export function nearbyBases(p: Vector3, range: number, sauf: string): BaseView[] {
  const out: BaseView[] = []
  for (const b of bases.values()) {
    if (b.address === sauf) continue
    const t = Transform.getOrNull(b.entity)
    if (t === null) continue
    const dx = p.x - t.position.x, dz = p.z - t.position.z
    if (Math.sqrt(dx * dx + dz * dz) > range) continue
    out.push({ address: b.address, name: b.name, items: b.items, entity: b.entity })
  }
  return out
}

/**
 * Can this player put a hand on that item, as the building would have it?
 *
 * The scene already answers this: slabs and walls carry a pointer collider, so a click aimed
 * through a ceiling never reaches the item behind it. This says the same thing in a place a
 * modified client cannot edit, which is the only reason it exists. Same storey, and no
 * further than the reach a pointer event has by default.
 *
 * It lives here, next to `positionObjet`, because the two are one question asked in two
 * halves: where does that plinth stand, and can this player touch it. It used to sit in the
 * theft module, so only theft asked it, and lifting an item off your OWN base was checked
 * for nothing at all.
 */
export function inReach(joueur: Vector3, objet: Vector3, rayon: number): boolean {
  if (Math.abs(joueur.y - objet.y) > SAME_STOREY) return false
  return Vector3.distance(joueur, objet) <= rayon
}

/** Where a given slot of a given base actually stands, which is what a thief has to reach. */
export function positionObjet(address: string, slot: number): Vector3 | null {
  const b = bases.get(address)
  if (b === undefined) return null
  const t = Transform.getOrNull(b.entity)
  if (t === null) return null
  const d = slotPosition(slot)
  const o = orientToBase(t.position.z, d.dx, d.dz)
  return Vector3.create(t.position.x + o.dx, t.position.y + d.dy, t.position.z + o.dz)
}

export function lockOf(address: string): number {
  const b = bases.get(address)
  if (!b) return 0
  return Plot.getOrNull(b.entity)?.lockedUntil ?? 0
}

export function setLock(address: string, until: number): boolean {
  const b = bases.get(address)
  if (!b) return false
  const c = Plot.getMutableOrNull(b.entity)
  if (c === null) return false
  c.lockedUntil = until
  dirtyBases.add(address)
  return true
}

/*
  Only the lock the owner PRESSED recharges. Every lock (the thirty seconds on arrival, a
  sentry's sixty, the shield an absence earns) used to write the same end date the button
  read its recharge from, so the button was unavailable for a hundred and fifty seconds
  after any of them: three minutes after every arrival, and every server replacement is an
  arrival, so through a day of deploys the owner "waited the countdown out, it re-armed,
  and never once got to press it" (owner, 4 Sep). The reference's recharge is the button's
  own. The grace on arrival still seals the door; it just no longer spends the button.
*/
export function noteLockUse(address: string, until: number): void {
  const p = profiles.get(address)
  if (p) { p.lockUsedUntil = until; dirtyProfiles.add(address) }
}

export function lockCooldown(address: string): number {
  const p = profiles.get(address)
  if (!p || p.lockUsedUntil === undefined) return 0
  const ready = p.lockUsedUntil + LOCK_COOLDOWN_MS
  return Math.max(0, ready - Date.now())
}

export function removeItem(address: string, index: number): number | null {
  const b = bases.get(address)
  if (!b || index < 0 || index >= b.items.length) return null
  const r = b.items[index]
  if (r === VIDE) return null
  // Leave a hole where it stood, so nothing above it shifts down a pedestal; trim the tail.
  b.items[index] = VIDE
  while (b.items.length > 0 && b.items[b.items.length - 1] === VIDE) b.items.pop()
  const prof = profiles.get(address)
  if (prof) { prof.items = [...b.items]; dirtyProfiles.add(address) }
  dirtyBases.add(address)
  publish(b)
  return r
}

export type RangementResultat = 'expose' | 'en-stock' | 'plein'

export function etatPrevisible(address: string): RangementResultat {
  const prof = profiles.get(address)
  if (!prof) return 'plein'
  if (occupe(prof.items) >= openSlots(prof.floorsBought ?? 0)) return 'plein'
  return bases.has(address) ? 'expose' : 'en-stock'
}

/**
 * Put something on a base's shelves. The base is the truth; the profile mirrors it.
 *
 * This used to begin `if (!prof) return 'plein'`, and a profile only exists for a player who
 * is connected. Its twin `removeItem` works off the base and mirrors afterwards, so the pair
 * was asymmetric in the worst possible way: an absent player's base could be robbed and could
 * receive nothing back. A thief who ran out of time returned their loot to a base that
 * refused it, and since the caller read the result wrongly (see below) the item simply ceased
 * to exist. Written the same way round as its twin now.
 *
 * Capacity comes from whoever knows it: the profile when the owner is here, the base's own
 * shopfront when they are not.
 */
/*
  `ou` is the position on the shelf, and it is the only strategic choice a base offers.

  `slotPosition(k)` computes the storey as `floor(k / SLOTS_PER_FLOOR)`, and a thief has to
  stand on the same storey and within reach to touch anything. So the INDEX of an item decides
  how hard it is to steal, and until now nothing chose it: every arrival was appended, so the
  shelf filled bottom up and the ground floor, the one a thief reaches without climbing, always
  held whatever you happened to own first.

  Inserting rather than appending is what turns that into a decision. Put the junk on the
  ground floor as bait and walk the Legendary up three flights, and the building starts saying
  something about how you play. It stays a DENSE array on purpose: an index that means a
  position in a queue needs no holes, and holes would have meant touching capacity, income,
  persistence and the client's rendering in twenty-five places for a choice that is really
  about order. Beyond the end it clamps, so aiming at a storey your shelf does not reach yet
  simply puts the thing on top.
*/
export function addItem(address: string, rarity: number, ou?: number): RangementResultat {
  const prof = profiles.get(address)
  const b = bases.get(address)

  // The index counts what a thing IS, rarity and mutation; a trait is what happened to it.
  const vu = rarity % 1000
  if (prof !== undefined && !(prof.vus ?? []).includes(vu)) {
    prof.vus = [...(prof.vus ?? []), vu]
    dirtyProfiles.add(address)
  }

  if (b !== undefined) {
    const places = openSlots(prof?.floorsBought ?? b.floorsBought)
    if (occupe(b.items) >= places) return 'plein'
    /*
      The shelf has holes now, and an index means a pedestal.

      Dense insertion could only ever put a thing at the end of what you owned, so with four
      items the third storey was unreachable however far you climbed: the server clamped the
      wish back to slot four and the building said no without saying why. A tester read it as
      a bug, and it was one. A hole is a real place, so you can put your one trophy on the top
      floor and leave the ground floor bare, which is the whole point of choosing.

      No target: the first hole, then the end. A target past the end: the shelf grows to reach
      it, holes in between. A target that is taken: the nearest free pedestal after it.
    */
    const suite = [...b.items]
    let at = ou === undefined ? suite.indexOf(VIDE) : Math.max(0, Math.min(Math.floor(ou), places - 1))
    if (at < 0) at = suite.length
    while (suite.length <= at) suite.push(VIDE)
    if (suite[at] !== VIDE) {
      /*
        Un objet reste sur l'etage ou son proprietaire se tient.

        La recherche du socle suivant balayait la suite entiere: un etage plein et l'objet
        montait ou descendait d'un etage tout seul, ce que rien a l'ecran n'annoncait et que le
        joueur ne pouvait ni prevoir ni annuler (proprietaire, 1 Sep). Quand un socle precis est
        demande, la recherche reste donc DANS SON ETAGE, et un etage plein est un refus, pas un
        deplacement. Sans cible (une recolte, un don automatique) l'ancien comportement tient:
        le premier trou libre, ou la fin.
      */
      const sameFloor = ou !== undefined
      const bas = sameFloor ? Math.floor(at / SLOTS_PER_FLOOR) * SLOTS_PER_FLOOR : 0
      const haut = sameFloor ? Math.min(bas + SLOTS_PER_FLOOR, places) : places
      let k = -1
      for (let i = bas; i < haut; i++) {
        if (i >= suite.length || suite[i] === VIDE) { k = i; break }
      }
      if (k < 0) return 'plein'
      at = k
      while (suite.length <= at) suite.push(VIDE)
    }
    suite[at] = rarity
    b.items = suite
    dirtyBases.add(address)
    if (prof !== undefined) { prof.items = [...b.items]; dirtyProfiles.add(address) }
    publish(b)
    return 'expose'
  }

  // No building yet: it can only wait in their stock, and only if we know who they are.
  if (prof === undefined) return 'plein'
  if (occupe(prof.items) >= openSlots(prof.floorsBought ?? 0)) return 'plein'
  prof.items.push(rarity)
  dirtyProfiles.add(address)
  return 'en-stock'
}

function todayKey(): number {
  const d = new Date()
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
}

/*
  Quarante-cinq minutes de jeu, tout cumule, definit le debutant.

  Le signal est deja au profil, il ne recule jamais, et il s'eteint tout seul. Les autres
  candidats mentaient: l'etape du tutoriel ne se termine jamais pour qui joue seul, puisque sa
  derniere marche est un cadeau sur la base d'un autre; et compter les objets trouves confond
  celui qui debute avec celui qui joue mal.
*/
const DEBUTANT_S = 45 * 60

function estDebutant(p: Profil): boolean {
  return (p.playedS ?? 0) < DEBUTANT_S
}

/** The three quests drawn for the day, refreshed when the calendar day has turned over. */
function idsDuJour(p: Profil): number[] {
  return p.questIds ?? questsFor(p.questDay ?? 0, false)
}

function questState(address: string): Profil | null {
  const p = profiles.get(address)
  if (!p) return null
  const k = todayKey()
  if (p.questDay !== k || p.questIds === undefined || p.questIds.length !== 3) {
    p.questDay = k
    p.questIds = questsFor(k, estDebutant(p))
    p.questProgress = [0, 0, 0]
    p.questsClaimed = [0, 0, 0, 0]   // 4th flag is the all-three bonus
    dirtyProfiles.add(address)
  }
  return p
}

export function advanceQuest(address: string, type: QuestType, n = 1): void {
  const p = questState(address)
  if (!p || n <= 0) return
  const ids = idsDuJour(p)
  const prog = [...(p.questProgress ?? [0, 0, 0])]
  let touche = false
  for (let i = 0; i < ids.length; i++) {
    const q = QUESTS[ids[i]]
    if (q.type !== type) continue
    if (prog[i] >= q.cible) continue
    prog[i] = Math.min(prog[i] + n, q.cible)
    touche = true
  }
  if (!touche) return
  p.questProgress = prog
  dirtyProfiles.add(address)
}

export type QuestState = {
  ids: number[]; progres: number[]; cibles: number[]; pris: number[]
  log: number; streak: number; dayClaimed: boolean
  dailyDispo: boolean
  prochainJour: number
  joursPris: number[]
}

/*
  Le numero de jour UTC, et pourquoi ce n'est pas la cle AAAAMMJJ deja utilisee ailleurs.

  Une semaine se compte en SOUSTRAYANT deux jours. 20260901 et 20260831 different de 70 dans
  la cle calendaire alors qu'ils se suivent: elle sert a savoir "est-ce le meme jour", jamais
  "combien de jours entre les deux". Le quotient du temps par vingt-quatre heures, lui, est
  lineaire par construction.
*/
function jourUTC(): number { return Math.floor(Date.now() / 86400_000) }
const SEMAINE = 7

/**
 * La semaine courante, ouverte si besoin, et ce qui y a deja ete pris.
 *
 * Une semaine dure sept jours a partir de son premier encaissement. Passe ce delai la suivante
 * commence, les sept coffres a nouveau disponibles.
 */
function semaine(p: Profil): { debut: number; pris: number[] } {
  const j = jourUTC()
  const debut = p.semaineDebut
  if (debut === undefined || j >= debut + SEMAINE) {
    p.semaineDebut = j
    p.semainePris = []
    return { debut: j, pris: [] }
  }
  return { debut, pris: p.semainePris ?? [] }
}

/** The day number a claim would land on now: the next in the streak, or day 1 after a gap. */
export function prochainJourDaily(address: string): number {
  const p = profiles.get(address)
  if (!p) return 1
  const { pris } = semaine(p)
  // Le plus petit coffre encore ouvert. Manquer un jour ne le perd donc pas: on le prend plus
  // tard dans la meme semaine, ce qui est ce qu'un joueur PRESENT merite (proprietaire, 7 Sep).
  for (let j = 1; j <= SEMAINE; j++) if (!pris.includes(j)) return j
  return SEMAINE
}
/** Les jours de la semaine courante deja encaisses, pour que l'interface colore CEUX-LA. */
export function joursPrisDaily(address: string): number[] {
  const p = profiles.get(address)
  if (!p) return []
  return [...semaine(p).pris]
}
export function dailyDisponible(address: string): boolean {
  const p = profiles.get(address)
  if (p === undefined) return false
  // Un coffre par jour, et seulement s'il en reste dans la semaine.
  return p.lastDay !== todayKey() && semaine(p).pris.length < SEMAINE
}

export function questStateOf(address: string): QuestState | null {
  const p = questState(address)
  if (!p) return null
  const ids = idsDuJour(p)
  const dispo = p.lastDay !== todayKey()
  return {
    ids,
    progres: [...(p.questProgress ?? [0, 0, 0])],
    cibles: ids.map((i) => QUESTS[i].cible),
    pris: [...(p.questsClaimed ?? [0, 0, 0, 0])],
    log: p.streak ?? 1,
    streak: p.streak ?? 1,
    dayClaimed: p.lastDay === todayKey(),
    dailyDispo: dispo && semaine(p).pris.length < SEMAINE,
    prochainJour: prochainJourDaily(address),
    joursPris: joursPrisDaily(address)
  }
}

export function claimQuestReward(address: string, slot: number): { crate: number } | { error: string } {
  const p = questState(address)
  if (!p) return { error: 'unknown profile' }
  const pris = [...(p.questsClaimed ?? [0, 0, 0, 0])]
  if (slot < 0 || slot > 3) return { error: 'no such quest' }
  if (pris[slot] === 1) return { error: 'already claimed' }

  const ids = idsDuJour(p)
  const prog = p.questProgress ?? [0, 0, 0]

  if (slot === 3) {
    for (let i = 0; i < ids.length; i++) if (prog[i] < QUESTS[ids[i]].cible) return { error: 'finish all three first' }
  } else if (prog[slot] < QUESTS[ids[slot]].cible) {
    return { error: 'not finished yet' }
  }

  const crate = slot === 3 ? QUEST_BONUS_CRATE : QUEST_CRATE
  pris[slot] = 1
  p.questsClaimed = pris
  p.crates = [...(p.crates ?? []), crate]
  dirtyProfiles.add(address)
  log(`${nameOf(address)} claimed quest ${slot}: crate ${crate}`)
  return { crate }
}

export function pushQuests(address: string): void {
  const q = questStateOf(address)
  if (q === null) return
  void room.send('quests', {
    ids: q.ids, progres: q.progres, cibles: q.cibles, pris: q.pris,
    log: q.log, dayClaimed: q.dayClaimed, dailyDispo: q.dailyDispo, prochainJour: q.prochainJour,
    joursPris: q.joursPris
  }, { to: [address] })
}

export function displayName(address: string): string {
  return bases.get(address)?.name ?? nameOf(address)
}

/** Alerts kept for an absent player: enough to tell the story, not enough to grow a profile without end. */
const ALERTS_MAX = 50

export function storeAlert(victim: string, alert: object): void {
  const prof = profiles.get(victim)
  if (prof) {
    prof.alerts = [...(prof.alerts ?? []), alert].slice(-ALERTS_MAX)
    dirtyProfiles.add(victim)
    return
  }
  void (async () => {
    const raw = await Storage.player.get<string>(victim, PLAYER_KEY)
    const p = raw ? JSON.parse(raw) : { coins: 0, items: [] }
    p.alerts = [...(p.alerts ?? []), alert].slice(-ALERTS_MAX)
    const ok = await Storage.player.set(victim, PLAYER_KEY, JSON.stringify(p))
    if (!ok) log(`ERROR deferred alert lost for ${victim.slice(0, 8)}`)
  })()
}

export function takeAlerts(address: string): object[] {
  const prof = profiles.get(address)
  if (!prof) return []
  const a = prof.alerts ?? []
  prof.alerts = []
  if (a.length > 0) dirtyProfiles.add(address)
  return a
}
/**
 * Book a gift, which is now the only thing the old `giftItem` still did that mattered.
 *
 * Giving used to be a whole function: pick a slot, name a receiver, move the item between two
 * arrays. Carrying replaced all of that, and the replacement moved the item correctly while
 * quietly dropping the two counters the shopfront reads. Every base has advertised `0 given`
 * and `0 received` since. This is that bookkeeping, and nothing else.
 */
export function recordGift(giver: string, receiver: string): void {
  const pd = profiles.get(giver)
  const pr = profiles.get(receiver)
  if (pd) { pd.given = (pd.given ?? 0) + 1; dirtyProfiles.add(giver) }
  if (pr) { pr.received = (pr.received ?? 0) + 1; dirtyProfiles.add(receiver) }
  const bd = bases.get(giver)
  const br = bases.get(receiver)
  if (bd) publish(bd)
  if (br) publish(br)
}

/**
 * What a tier costs this player, in what their own base earns.
 *
 * Priced in seconds of income rather than in coins, so a defence never becomes trivial to a
 * rich base nor unreachable to a new one. The per-charge rate falls as the tier rises, which
 * is what makes buying the bigger one a decision instead of a multiplication.
 */
/*
  How long the owner has ACTUALLY been away, and zero while they are here.

  `lastSeen` is stamped on departure, so a player who quits in the middle of being robbed has
  an absence of nearly nothing by the time the theft lands. That is deliberate: every offline
  protection system in every shared world has the same documented exploit, logging off mid-raid
  to trigger the shield, and reading real elapsed absence rather than a present/absent flag is
  what closes it.
*/
export function absenceDe(address: string): number {
  if (presents().has(address)) return 0
  const b = bases.get(address)
  if (b === undefined) return 0
  return Math.max(0, Date.now() - b.lastSeen)
}

/** What one item on this base produces, which is what a charge is priced against. */
export function incomePerItem(address: string): number {
  const n = occupe(bases.get(address)?.items ?? [])
  return n === 0 ? 0 : incomePerSecond(address) / n
}

export function sentryPrice(address: string, tier = 0): number {
  const t = SENTRY_TIERS[Math.max(0, Math.min(tier, SENTRY_TIERS.length - 1))]
  return Math.max(SENTRY_MIN_PRICE, prixParCharge(incomePerItem(address), tier) * t.charges)
}

/**
 * Which storey of their OWN base a player is standing on, or -1 if they are not in it.
 *
 * Arming happens where you stand, the same rule as putting an item on a shelf, so a defence is
 * something you walk to rather than something you tick in a list. It also means the shop cannot
 * arm anything from across the plaza, which is the point: choosing the floor IS the purchase.
 */
export function homeFloor(address: string): number {
  const b = bases.get(address)
  if (b === undefined) return -1
  const t = Transform.getOrNull(b.entity)
  const p = positionOf(address)
  if (t === null || p === null) return -1
  const dx = p.x - t.position.x, dz = p.z - t.position.z
  if (Math.sqrt(dx * dx + dz * dz) > PLACE_RANGE) return -1
  const e = Math.max(0, Math.round(p.y / FLOOR_HEIGHT))
  return e >= openFloors(b.floorsBought) ? -1 : e
}

export function buySentryFor(address: string, tier = 0): { ok: boolean; reason?: string; charges?: number; cost?: number; floor?: number } {
  const p = profiles.get(address)
  if (!p) return { ok: false, reason: 'unknown profile' }
  const b = bases.get(address)
  if (b === undefined) return { ok: false, reason: 'place your base first' }
  const etage = homeFloor(address)
  if (etage < 0) return { ok: false, reason: 'stand inside your base, on the floor you want to defend' }

  const t = SENTRY_TIERS[Math.max(0, Math.min(tier, SENTRY_TIERS.length - 1))]
  const liste = [...b.sentryFloors]
  while (liste.length <= etage) liste.push(0)
  const avant = liste[etage]
  if (avant >= SENTRY_MAX_CHARGES) return { ok: false, reason: `floor ${etage + 1} is already fully defended` }
  const cost = sentryPrice(address, tier)
  if (p.coins < cost) return { ok: false, reason: `you need ${Math.ceil(cost - p.coins)} more coins` }
  p.coins -= cost
  dirtyProfiles.add(address)
  // Charges add up rather than replace, so a second purchase is never a downgrade. The tier
  // follows the same rule: what fires is the best thing you ever armed, so buying a GUARD
  // after a BATTERY tops up the charges without quietly weakening what they do.
  liste[etage] = Math.min(SENTRY_MAX_CHARGES, avant + t.charges)
  b.sentryFloors = liste
  b.sentries = totalCharges(liste)
  b.sentryTier = Math.max(b.sentryTier, SENTRY_TIERS.indexOf(t))
  dirtyBases.add(address)
  publish(b)
  log(`${displayName(address)} armed a ${t.name} on floor ${etage + 1} (${cost}, ${avant} -> ${liste[etage]} charges there)`)
  return { ok: true, charges: liste[etage], cost, floor: etage }
}

/** Spends one charge and answers WHICH tier fired, or -1 if there was nothing to fire. Owner present or not. */
export function useSentryCharge(address: string, etage: number): number {
  const b = bases.get(address)
  if (b === undefined) return -1
  const liste = [...b.sentryFloors]
  if (chargesA(liste, etage) <= 0) return -1
  liste[etage] -= 1
  b.sentryFloors = liste
  b.sentries = totalCharges(liste)
  dirtyBases.add(address)
  publish(b)
  return b.sentryTier
}

/** Charges left on that storey, which is what the owner and the thief both need to read. */
export function sentriesOnFloor(address: string, etage: number): number {
  return chargesA(bases.get(address)?.sentryFloors, etage)
}

export function sentriesOf(address: string): number { return bases.get(address)?.sentries ?? 0 }

/*
  Pockets: how many of each gear a player holds, indexed by gear id.

  A flat count per id rather than a list of instances, because a gear has no identity of its
  own: two traps are two traps. Kept on the profile so a pocket survives the server, and read
  back at every wallet tick so the shop and the action button never disagree with it.
*/
export function gearsOf(address: string): number[] {
  const p = profiles.get(address)
  const out = new Array<number>(GEARS.length).fill(0)
  for (let i = 0; i < GEARS.length; i++) out[i] = p?.gears?.[i] ?? 0
  return out
}

export function addGear(address: string, gear: number): void {
  const p = profiles.get(address)
  if (!p) return
  const g = gearsOf(address)
  g[gear] += 1
  p.gears = g
  dirtyProfiles.add(address)
}

export function removeGear(address: string, gear: number): boolean {
  const p = profiles.get(address)
  if (!p) return false
  const g = gearsOf(address)
  if (g[gear] <= 0) return false
  g[gear] -= 1
  p.gears = g
  dirtyProfiles.add(address)
  return true
}

/*
  A rush touches what is placed: one random toy on the shelves of everyone present gains a
  trait, the reference's "off road" event. Traits stack to `TRAITS_MAX` and never go away,
  which is what makes a base that shows up for rushes worth stealing from.
*/
export function marquerTrait(address: string): number | null {
  const p = profiles.get(address)
  const b = bases.get(address)
  if (!p || !b) return null
  const candidats: number[] = []
  for (let i = 0; i < b.items.length; i++) {
    const c = b.items[i]
    if (c !== VIDE && traitsDe(c) < TRAITS_MAX) candidats.push(i)
  }
  if (candidats.length === 0) return null
  const i = candidats[Math.floor(Math.random() * candidats.length)]
  const neuf = encoder(rarityOf(b.items[i]), mutationDe(b.items[i]), traitsDe(b.items[i]) + 1)
  b.items[i] = neuf
  p.items = [...b.items]
  dirtyBases.add(address)
  dirtyProfiles.add(address)
  publish(b)
  return neuf
}

/*
  Mines live on the BASE record, like sentry charges (invariant 207), for the same reason: the
  one situation a mine is sold for is an owner who is away for days, and a placed entity dies
  with the server two minutes after the venue empties. The record is saved with the base and
  the gear module regrows the entities from it at every start, until somebody steps on one.
  Inside the owner's own footprint only: a mine that never expires on the plaza would be a
  permanent trap for everyone, which is griefing, not defence.
*/
export function minesDe(address: string): Mine[] { return [...(bases.get(address)?.mines ?? [])] }
export function placeMine(address: string, m: Mine): boolean {
  const b = bases.get(address)
  if (!b) return false
  if (Math.abs(m.x - b.x) > BASE_SIDE / 2 || Math.abs(m.z - b.z) > BASE_SIDE / 2) return false
  b.mines = [...b.mines, m]
  dirtyBases.add(address)
  return true
}
export function retirerMine(address: string, at: { x: number; z: number }): void {
  const b = bases.get(address)
  if (!b) return
  let k = -1, best = 0.5
  for (let i = 0; i < b.mines.length; i++) {
    const d = Math.abs(b.mines[i].x - at.x) + Math.abs(b.mines[i].z - at.z)
    if (d < best) { best = d; k = i }
  }
  if (k < 0) return
  b.mines = b.mines.filter((_, i) => i !== k)
  dirtyBases.add(address)
}

/** The Index's button: a skin is a mutation whose column is filled to `SKIN_NEEDS`, or none. */
/**
 * Every rarity and mutation marked as seen in the Index, for the owner's showcase profile:
 * ninety-eight codes, rarity times a hundred plus mutation. Through the admin channel only.
 */
export function marquerTousVus(address: string): number {
  const p = profiles.get(address)
  if (!p) return 0
  const tous: number[] = []
  for (let r = 0; r < RARITIES.length; r++) for (let m = 0; m < MUTATIONS.length; m++) tous.push(r * 100 + m)
  p.vus = tous
  dirtyProfiles.add(address)
  return tous.length
}

/** Sound effects on or off, the player's own choice, kept with the profile. */
export function setSfxOff(address: string, off: boolean): void {
  const p = profiles.get(address)
  if (!p || (p.sfxOff === true) === off) return
  p.sfxOff = off
  dirtyProfiles.add(address)
}

/** The title card was seen: a returning player is never welcomed twice (tester, 10 Sep). */
export function setWelcomed(address: string): void {
  const p = profiles.get(address)
  if (!p || p.welcomed === true) return
  p.welcomed = true
  dirtyProfiles.add(address)
}

export function choisirSkin(address: string, mut: number): { ok: boolean; reason?: string } {
  const p = profiles.get(address)
  if (!p) return { ok: false, reason: 'unknown profile' }
  if (mut !== 0 && !skinDebloque(p.vus ?? [], mut)) {
    return { ok: false, reason: `collect ${SKIN_NEEDS} of ${RARITIES.length} ${mutation(mut).name} toys first` }
  }
  p.skin = mut
  dirtyProfiles.add(address)
  const b = bases.get(address)
  if (b) { b.skin = mut; dirtyBases.add(address); publish(b) }
  return { ok: true }
}

export function luckUntilOf(address: string): number { return profiles.get(address)?.luckUntil ?? 0 }
export function luckBuysOf(address: string): number {
  const p = profiles.get(address)
  if (p === undefined) return 0
  // Le charme a expire: la pile retombe, le prochain achat repart au prix de base.
  if ((p.luckUntil ?? 0) <= Date.now()) return 0
  return p.luckAchats ?? 0
}
export function noteLuckBuy(address: string): void {
  const p = profiles.get(address)
  if (p === undefined) return
  p.luckAchats = luckBuysOf(address) + 1
  dirtyProfiles.add(address)
}
export function setLuckUntil(address: string, until: number): void {
  const p = profiles.get(address)
  if (!p) return
  p.luckUntil = until
  dirtyProfiles.add(address)
}
export function fusionOf(address: string): number[] { return [...(profiles.get(address)?.fusion ?? [])] }
export function setFusion(address: string, codes: number[]): void {
  const p = profiles.get(address)
  if (!p) return
  p.fusion = codes
  dirtyProfiles.add(address)
}

export function baseDe(address: string): Base | undefined { return bases.get(address) }

/** Every base on the field, present owners and absent ones alike: what the records board ranks. */
export function toutesLesBases(): Base[] { return [...bases.values()] }

/** One more successful theft on the thief's own record. Nobody without a base is ranked. */
export function compterVol(address: string): void {
  const b = bases.get(address)
  if (b === undefined) return
  b.vols += 1
  dirtyBases.add(address)
}
/*
  What prestige actually does, because three screens said otherwise.

  It does NOT wipe the coins: it charges a price and leaves the remainder. It does NOT clear
  the base: it keeps the best `guard` items. Floors, sentries and crates are untouched. The
  panel described a far more destructive act than this, which is the wrong way to be wrong
  about the one decision that drives the whole late game.
*/
/*
  What prestige eats: the LOWEST rarity that meets the requirement, and among those the least
  valuable. It was the least valuable by income alone, which a tester paid for on 27 Aug: a
  Legendary with a mutation and a trait out-earned his plain Mythic, so the Mythic was the
  "cheapest" and went. A player reads rarity first; a Mythic must never leave while a
  Legendary would do. The same function feeds the wallet, so the screen names the exact toy
  before the button is pressed.
*/
/*
  The rarest MUTATION a player owns is spared, and nobody has to say so.

  Prestige eats the least valuable piece meeting the rung's rarity and then keeps only the
  `guard` best by income, so a piece loved for what it IS rather than for what it earns (a
  first Rainbow, a Phantom Common) left twice over: eaten, or culled. Two interfaces were
  tried to let the player protect one, a KEEP button and a strip of every piece; both failed
  on the same ground, and the owner's own conclusion settles it: a choice that costs a screen
  full of small targets is worse than no choice at all (5 Sep). The mobile guidance this
  project follows says the same thing in one line, minimise options and show only what is
  needed now.

  So the rule is automatic and stated on the panel: the RAREST piece on the shelves is spared,
  both from the jaws and from the cull. It yields only when it is the only piece that can pay
  the rung, because a prestige that cannot be paid is worse than a piece lost.

  Rarest means what it says, `itemOdds`: the odds of rolling that rung TIMES the odds of
  rolling that mutation. It was the mutation's multiplier alone, and that ranked a Divine Epic
  above a Cursed Secret, which is wrong by a factor of three (owner, 5 Sep). A plain piece is
  never spared: everything else being equal it is the commonest thing a shelf can hold.
*/
function rarest(pleins: readonly number[]): number {
  let best = -1
  for (const c of pleins) {
    if (mutationDe(c) === 0) continue
    if (best < 0 || itemOdds(c) > itemOdds(best)) best = c
  }
  return best
}

function candidatsAuPrestige(pleins: number[], minRarity: number, spared = -1): number[] {
  return pleins
    .filter((c) => rarityOf(c) >= minRarity && c !== spared)
    .sort((x, y) => rarityOf(x) - rarityOf(y) || itemIncome(x, INCOME_PER_RARITY) - itemIncome(y, INCOME_PER_RARITY))
}
/** The piece prestige spares, or -1: the rarest mutation on the shelves. */
export function sparedPieceOf(address: string): number {
  const p = profiles.get(address)
  return p ? rarest(p.items.filter((x) => x !== VIDE)) : -1
}

export function objetConsommePar(address: string): number {
  const p = profiles.get(address)
  if (!p) return -1
  const prestige = p.rebirths ?? 0
  if (prestige >= REBIRTH_MAX) return -1
  const pleins = p.items.filter((x) => x !== VIDE)
  const spared = rarest(pleins)
  const c = candidatsAuPrestige(pleins, prestigeTier(prestige).minRarity, spared)
  const brut = c.length > 0 ? c : candidatsAuPrestige(pleins, prestigeTier(prestige).minRarity)
  return brut.length === 0 ? -1 : brut[0]
}

export function tenterRebirth(address: string): { ok: boolean; reason?: string; prestige?: number; multiplier?: number } {
  const p = profiles.get(address)
  if (!p) return { ok: false, reason: 'unknown profile' }
  const prestige = p.rebirths ?? 0
  if (prestige >= REBIRTH_MAX) return { ok: false, reason: 'max prestige reached' }
  const exige = prestigeTier(prestige)
  if (p.coins < exige.cost) return { ok: false, reason: `you need ${Math.ceil(exige.cost - p.coins)} more coins` }

  const pleins = p.items.filter((c) => c !== VIDE)
  /*
    The rung's price in kind. The reference's rebirth "requires cash AND specific brainrots,
    which are consumed"; ours names a rarity rather than a species, and CONSUMES the least
    valuable item that meets it. Until 27 Aug the item was only checked, so prestige cost a
    player nothing they could see leave, and the rarity gate was a formality.
  */
  const spared = rarest(pleins)
  const prefere = candidatsAuPrestige(pleins, exige.minRarity, spared)
  const candidats = prefere.length > 0 ? prefere : candidatsAuPrestige(pleins, exige.minRarity)
  if (candidats.length === 0) {
    return { ok: false, reason: `you need a ${rarity(exige.minRarity).name} or better on your shelves: prestige consumes it` }
  }

  // The purse resets to the reference's bonus: prestige is a restart, not a purchase.
  p.coins = Math.round(exige.cost * PRESTIGE_CASH_SHARE)
  const consomme = candidats[0]
  const reste = [...pleins]
  reste.splice(reste.indexOf(consomme), 1)
  const tries = reste.sort((a, b) => itemIncome(b, INCOME_PER_RARITY) - itemIncome(a, INCOME_PER_RARITY))
  // The spared piece survives the cull too, and takes the first of the kept places.
  const gardes = tries.slice(0, exige.guard)
  if (spared >= 0 && reste.includes(spared) && !gardes.includes(spared)) {
    gardes.pop()
    gardes.unshift(spared)
  }
  p.items = gardes
  p.rebirths = prestige + 1
  dirtyProfiles.add(address)
  const b = bases.get(address)
  if (b) { b.items = [...p.items]; dirtyBases.add(address); publish(b) }
  // Written now, not at the next five-second tick: a prestige is the one change a server
  // replaced a moment later must not lose half of (4 Sep, items resurrected at prestige 2).
  void save()
  const et = openFloors(p.floorsBought ?? 0)
  log(`${b?.name ?? address.slice(0, 8)} reached prestige ${p.rebirths}: -${exige.cost} coins, consumed a ${rarity(rarityOf(consomme)).name}, kept ${exige.guard} item(s), income x${exige.multiplier}, ${et} floors`)
  return { ok: true, prestige: p.rebirths, multiplier: incomeMultiplier(p.rebirths) }
}

/**
 * Un mur arrete une balle, dans les deux sens.
 *
 * Deux points sont dans le meme espace quand ils sont dans la MEME base, ou tous les deux
 * dehors. Sinon il y a une paroi entre eux et rien ne passe: ni un tir sur le boss depuis son
 * salon (le boss ne peut pas entrer, donc c'etait un stand de tir), ni un tir sur un joueur
 * abrite, ni l'inverse. Personne n'a besoin qu'on le lui explique, c'est pour ca que le refus
 * est muet: on ne dit pas a quelqu'un que son mur est un mur (testeur, 1 Sep).
 *
 * Mesure sur les MURS et non sur la dalle: le socle deborde de huit dixiemes de metre et se
 * marche, donc qui se tient sur le rebord est dehors.
 */
/**
 * Is this player standing inside their OWN base while it is shielded?
 *
 * The shield used to seal the shelves and nothing else: it was read in exactly one place, the
 * steal path, and no weapon ever asked about it. So a thief who walked into a sealed base
 * could not take an item off a shelf but could still empty the owner's hands and pockets with
 * a gun, standing next to them (owner, 7 Sep). Two rules that contradict each other on the
 * same square: the base is closed, and the person in it is not.
 *
 * The walls already answer for anyone outside (`memeEspace`), so this only ever fires on
 * someone who came in. Inside a shield, they are here as a visitor, not as a hunter.
 *
 * Both halves are required, and neither alone would do: a shield with the owner elsewhere
 * protects nothing a body needs, and an owner at home without a shield is fair game, which is
 * the whole point of the wall coming down when they arrive (`lockOnArrival`).
 */
export function shelteredAtHome(address: string): boolean {
  if (lockOf(address) <= Date.now()) return false
  const b = bases.get(address)
  if (b === undefined) return false
  const p = positionOf(address)
  if (p === null) return false
  const demi = BASE_SIDE / 2
  return Math.abs(p.x - b.x) < demi && Math.abs(p.z - b.z) < demi
}

export function memeEspace(x1: number, z1: number, x2: number, z2: number): boolean {
  const demi = BASE_SIDE / 2
  const dedans = (x: number, z: number): string | null => {
    for (const b of bases.values()) {
      if (Math.abs(x - b.x) < demi && Math.abs(z - b.z) < demi) return b.address
    }
    return null
  }
  return dedans(x1, z1) === dedans(x2, z2)
}

export function prestigeOf(address: string): number { return profiles.get(address)?.rebirths ?? 0 }
export function basePoints(sauf?: string): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = []
  for (const b of bases.values()) if (b.address !== sauf) out.push({ x: b.x, z: b.z })
  return out
}

/*
  Whether somebody's hands are on this base right now, asked of whoever knows.

  `theft.ts` owns the attempts in progress and imports this file, so this file cannot import
  it back. It registers its answer here instead, the same shape as the move hook in
  `client/deplacer.ts`. Default: nobody is stealing, so a server that never registered it
  behaves exactly as before.
*/
let volEnCours: (address: string) => boolean = () => false
export function declarerVolEnCours(fn: (address: string) => boolean): void { volEnCours = fn }

export function placeBase(address: string, xb: number, zb: number): { ok: boolean; reason?: string } {
  const p = profiles.get(address)
  if (!p) return { ok: false, reason: 'unknown profile' }

  /*
    A base cannot be moved out from under a thief.

    A theft is a timed attempt: the server checks every half second that the thief is still
    within reach of the ITEM, and moving the base takes the item with it, so pressing MOVE MY
    BASE cancelled any theft in progress, instantly, for free, from anywhere on the map. That
    is a perfect counter with no risk, and it empties the one moment this game is built around:
    the thief is supposed to be exposed while the clock runs, and the owner's answer is to come
    back and shoot them, or to let the sentry do it (measured and reported 6 Sep, entry 523).
    Only the owner of the base being robbed is stopped, and only while the attempt lasts.
  */
  if (volEnCours(address)) return { ok: false, reason: 'someone has their hands on your shelves' }

  /*
    Le joueur choisit ou il pose sa base, et peut la deplacer quand il veut.

    On avait bascule sur seize emplacements fixes: le testeur a couru dans toute la carte sans
    jamais voir de marqueur au sol, parce qu'il n'apparaissait qu'a sept metres d'un des seize
    points, et il a fini par poser sa base a un endroit qu'il n'avait pas choisi (1 Sep). Une
    contrainte qu'on ne voit pas est une contrainte qui punit. La regle qui reste est celle qui
    se lit a l'ecran: n'importe ou, sauf sur le tapis, sauf au bord, et sauf dans les murs du
    voisin.
  */
  /*
    Un refus n'est pas une reponse: on pose au plus pres.

    Le marqueur au sol montre deja rouge ou vert, donc un refus n'arrive que dans les cas que
    le joueur ne pouvait pas voir: deux joueurs qui posent au meme endroit a la meme seconde,
    ou un client qui a une demi-seconde de retard sur l'etat du terrain. Lui renvoyer "cannot
    build there" le laisse chercher sans savoir quoi corriger. `freeSpotNear` balaie en anneaux
    depuis le point voulu et rend le premier carre legal: il pose donc a quelques metres de son
    choix, ce qui est ce qu'il aurait fait lui-meme, et on le lui dit.
  */
  let x = snapToGrid(xb)
  let z = snapToGrid(zb)
  let deplace = false
  const mauvais = invalidReason(x, z, SCENE_SIDE, basePoints(address))
  if (mauvais !== null) {
    const proche = freeSpotNear(x, z, SCENE_SIDE, basePoints(address))
    if (proche === null) return { ok: false, reason: mauvais }
    x = proche.x
    z = proche.z
    deplace = true
  }

  const previous = bases.get(address)
  // Placed where it already stands: nothing to rebuild, nothing to resend.
  if (previous !== undefined && previous.x === x && previous.z === z) return { ok: true }
  // Moving your own base costs nothing extra: room is asked for only at the first placement.
  if (previous === undefined && !makeRoom(address, BASE_FIXED_COST_FAR + STOREY_COST_FAR)) {
    return { ok: false, reason: 'the field is full right now, try again in a moment' }
  }
  if (previous) removeBase(address)

  const items = [...p.items]
  // Moving a base moves its defence with it: the charges were paid for the building, not the spot.
  // A base placed again after a fold gets its shopfront back (see `welcome`), a first base an empty one.
  const b = createBase(address, nameOf(address), items, Date.now(), x, z, previous ? vitrineDe(previous) : (vitrineEnMain.get(address) ?? VITRINE_VIDE))
  vitrineEnMain.delete(address)
  if (b === null) return { ok: false, reason: 'cannot build there' }
  p.x = x
  p.z = z
  dirtyBases.add(address)
  dirtyProfiles.add(address)
  log(`${b.name} placed a base at ${x},${z}${previous ? ` (deplacee from ${previous.x},${previous.z})` : ''}${deplace ? ' (repli sur le plus proche libre)' : ''}`)
  return { ok: true, reason: deplace ? 'that spot was taken, your base went to the nearest free one' : undefined }
}

/*
  Five hundred, which nobody reaches, because the alternative fails in silence.

  The stack had no ceiling and the whole of it is sent in the `inventory` message every
  second and a half. The transport drops a message over about thirteen kilobytes without
  telling anyone, so a hoard large enough would not degrade the crate screen, it would
  switch it off. Five hundred entries is roughly two and a half kilobytes, and it is far
  past anything a player who opens their crates will ever hold.
*/
export const MAX_CRATES = 500

export function addCrate(address: string, crateTier: number): void {
  const p = profiles.get(address)
  if (!p) return
  const pile = p.crates ?? []
  if (pile.length >= MAX_CRATES) {
    log(`${displayName(address)} is at the ${MAX_CRATES} crate ceiling, one was not added`)
    return
  }
  p.crates = [...pile, crateTier]
  dirtyProfiles.add(address)
}

export function removeCrate(address: string, crateTier: number): boolean {
  const p = profiles.get(address)
  if (!p) return false
  const b = [...(p.crates ?? [])]
  const i = b.indexOf(crateTier)
  if (i < 0) return false
  b.splice(i, 1)
  p.crates = b
  dirtyProfiles.add(address)
  return true
}

export function cratesOf(address: string): number[] {
  return [...(profiles.get(address)?.crates ?? [])]
}

export function spend(address: string, montant: number): boolean {
  const p = profiles.get(address)
  if (!p) return false
  if (!Number.isFinite(montant) || montant < 0) return false
  if (montant > 0 && p.coins < montant) return false
  p.coins -= montant
  // Depenser, c'est jouer: le joueur plante devant le tapis qui n'achete que des boites
  // ne doit pas etre pris pour un absent (voir `AFK_PRODUCTION_MS`).
  p.agiA = Date.now()
  dirtyProfiles.add(address)
  return true
}

/**
 * What one item is worth if sold: thirty seconds of what it produces, and no prestige.
 *
 * The multiplier used to be in here, and crate prices are fixed constants, so the two curves
 * eventually crossed. Resale is `income x 30 x multiplier` while a crate costs
 * `income x payback`, which makes buy-open-sell worth `30 x multiplier / payback`: profitable
 * from prestige 2 on a Basic crate, prestige 4 on a Good, and growing without limit after
 * that. At prestige 30 a crate bought for 2,018 sold back for 31,276 on average, six times a
 * minute off the belt.
 *
 * It never beat SHELVING, since selling is thirty seconds of what a shelf pays for ever. What
 * it was is RISK-FREE, in a game whose whole tension is that displayed wealth can be taken.
 * The multiplier meant to reward putting your loot on show was also rewarding never showing
 * anything. Without it the ratio is 0.5 down to 0.06 whatever the prestige, so buying to sell
 * is always a loss, and selling keeps the job it should have had: clearing a slot for better.
 */
export function valeurRevente(_address: string, code: number): number {
  return prixDeRevente(code)
}

export function crediterVente(address: string, code: number): number {
  const p = profiles.get(address)
  if (!p) return 0
  const gain = valeurRevente(address, code)
  p.coins += gain
  dirtyProfiles.add(address)
  return gain
}

export function buyFloorFor(address: string): { ok: boolean; reason?: string; floors?: number; cost?: number } {
  const p = profiles.get(address)
  if (!p) return { ok: false, reason: 'no profile' }
  const actuels = 1 + (p.floorsBought ?? 0)
  if (actuels >= MAX_FLOORS) return { ok: false, reason: 'max floors reached' }
  const cost = floorPrice(actuels + 1)
  const palier = floorPrestigeRequired(actuels + 1)
  if ((p.rebirths ?? 0) < palier) return { ok: false, reason: `floor ${actuels + 1} opens at prestige ${palier}` }
  if (p.coins < cost) return { ok: false, reason: `need ${Math.ceil(cost - p.coins)} more coins` }

  /*
    Un etage de plus coute au budget comme une base de plus, en plus petit.

    La liberation sous pression ne se declenchait qu'a la POSE d'une base, donc le monde
    pouvait grossir par le haut sans que rien ne le borne: quarante bases deja posees, chacune
    qui monte d'un etage, et on franchit le plafond du telephone sans qu'un seul joueur ne soit
    arrive (proprietaire, 3 Sep). Le budget est desormais la seule porte, et elle s'applique a
    toutes les facons de faire grandir le monde, pas seulement a la premiere.

    On fait de la place avant de facturer: si un absent peut ceder, il cede; si tout le monde
    est present et que le budget est plein, l'etage est refuse et l'or n'est pas pris.
  */
  if (!makeRoom(address, STOREY_COST_FAR)) {
    return { ok: false, reason: 'the field is full right now, try again in a moment' }
  }

  p.coins -= cost
  p.floorsBought = (p.floorsBought ?? 0) + 1
  dirtyProfiles.add(address)
  const b = bases.get(address)
  if (b) { dirtyBases.add(address); publish(b) }
  const et = openFloors(p.floorsBought)
  log(`${b?.name ?? address.slice(0, 8)} achete l'floor ${et} pour ${cost}`)
  return { ok: true, floors: et, cost }
}

export function nextFloorPrice(address: string): number {
  const p = profiles.get(address)
  if (!p) return 0
  const actuels = 1 + (p.floorsBought ?? 0)
  return actuels >= MAX_FLOORS ? 0 : floorPrice(actuels + 1)
}

export function cashOfflineEarnings(address: string): { gain: number; seconds: number; capped: boolean } | null {
  const p = profiles.get(address)
  if (!p || p.vuA === undefined) return null
  const elapsed = Math.min(Date.now() - p.vuA, OFFLINE_CAP_MS)
  if (elapsed < 30_000) return null          // under half a minute: nothing to announce

  let perSecond = 0
  for (const code of p.items) if (code !== VIDE) perSecond += itemIncome(code, INCOME_PER_RARITY)
  perSecond *= incomeMultiplier(p.rebirths ?? 0) * OFFLINE_RATE
  if (perSecond <= 0) return null

  const raw = perSecond * (elapsed / 1000)
  // `perSecond` already carries the offline rate; dividing it out gives the full production
  // the cap is expressed in, so the cap reads as "N seconds of what this base makes online".
  const cap = (perSecond / OFFLINE_RATE) * offlineCapProductionS(p.silos ?? 0)
  /*
    LA CAGNOTTE LAISSEE DERRIERE SOI PART AVEC LA SOMME HORS LIGNE, ET NE SE RECOLTE PLUS.

    Ce qu'on mesurait avant ce correctif: deux poches, deux regles, servies dans la meme seconde.
    La somme hors ligne allait DIRECTEMENT au solde (`p.coins += gain`), pendant que la cagnotte
    de la session precedente restait intacte, generalement a son plafond, avec le bouton
    contextuel sur COLLECT. Le joueur lisait donc "WELCOME BACK, +X gagnes" et voyait au meme
    instant une cagnotte pleine a ramasser: rien a l'ecran ne disait que les deux n'ont aucun
    rapport, donc le X paraissait etre ce qu'il fallait aller chercher (proprietaire, 7 Sep).

    Pourquoi fondre plutot que d'automatiser la recolte en general. Les deux mecaniques ont des
    roles distincts dans le genre et la litterature les separe exprès: le gain HORS LIGNE
    recompense le RETOUR, il est donc verse a taux reduit et sans geste, sinon la recompense de
    revenir est conditionnee a comprendre une mecanique. La cagnotte a taper recompense la
    PRESENCE, c'est la boucle de recolte (Clash of Clans, Hay Day, les pads de tycoon), et elle
    doit rester manuelle: c'est meme l'etat de base du bouton contextuel, retabli hier.

    Or la cagnotte trouvee a l'arrivee ne sert NI l'un NI l'autre role: elle a ete produite dans
    une session passee, le joueur n'a rien neglige qu'il aurait pu faire, et la periode est deja
    couverte par la poche hors ligne. C'est un residu, pas une regle. Fondue ici, elle laisse une
    seule phrase que le joueur peut enoncer: quand tu es absent la base met de cote pour toi,
    quand tu es la tu ramasses.

    Le seuil est celui de l'annonce, trente secondes: en dessous c'est une reconnexion et non un
    retour, et la cagnotte reste ou elle est, ce qui est le bon comportement.
  */
  const reste = Math.floor(p.pending ?? 0)
  const gain = Math.floor(Math.min(raw, cap)) + reste
  if (gain <= 0) return null
  p.pending = 0
  p.coins += gain
  p.vuA = Date.now()
  p.annonceHL = { gain, seconds: Math.floor(elapsed / 1000), at: Date.now(), capped: raw > cap }
  dirtyProfiles.add(address)
  log(`${nameOf(address)} cashed ${gain} on return (${Math.round(elapsed / 60000)} min at ${Math.round(OFFLINE_RATE * 100)}%, incl. ${reste} left in the pot)`)
  return { gain, seconds: Math.floor(elapsed / 1000), capped: raw > cap }
}

/**
 * Buys one silo, which raises the offline cap by an hour of production.
 *
 * The genre's own lever: the cap exists to be lifted, and lifting it is what turns "you are
 * capped" into a goal (see the note above `SILO_BASE_PRICE`). Nothing about the world grows
 * here, so unlike a floor this takes no object budget and can never be refused for room.
 */
export function buySiloFor(address: string): { ok: boolean; reason?: string; silos?: number; cost?: number; capS?: number } {
  const p = profiles.get(address)
  if (!p) return { ok: false, reason: 'no profile' }
  const owned = p.silos ?? 0
  if (owned >= SILO_MAX) return { ok: false, reason: 'all silos built' }
  const cost = siloCost(owned + 1)
  if (p.coins < cost) return { ok: false, reason: `need ${Math.ceil(cost - p.coins)} more coins` }
  p.coins -= cost
  p.silos = owned + 1
  dirtyProfiles.add(address)
  const capS = offlineCapProductionS(p.silos)
  log(`${nameOf(address)} builds silo ${p.silos} for ${cost}, offline cap ${capS}s of production`)
  return { ok: true, silos: p.silos, cost, capS }
}

export function nextSiloPrice(address: string): number {
  const p = profiles.get(address)
  if (!p) return 0
  return siloCost((p.silos ?? 0) + 1)
}

/**
 * Encaisser la cagnotte. Rend ce qu'elle valait, ou zero.
 *
 * Le seul chemin qui la vide, et le seul endroit ou son montant rejoint le solde.
 */
export function collectPending(address: string): number {
  const p = profiles.get(address)
  if (!p) return 0
  const r = Math.floor(p.pending ?? 0)
  if (r <= 0) return 0
  p.coins += r
  p.pending = 0
  dirtyProfiles.add(address)
  return r
}

/**
 * Le joueur vient de faire quelque chose. Voir `AFK_PRODUCTION_MS`.
 *
 * Appele depuis `spend` (tout achat passe par la) et depuis le tick de revenu quand la
 * position a bouge. Deux points d'appel, aucun handler de message a modifier: la regle est
 * une propriete du profil, pas une preoccupation de chaque action.
 */
export function signalerActivite(address: string): void {
  const p = profiles.get(address)
  if (p !== undefined) p.agiA = Date.now()
}

/** Positions du tick courant, et celles du tick precedent: voir la regle anti-AFK. */
const positions = new Map<string, { x: number; z: number }>()
const derniereXZ = new Map<string, { x: number; z: number }>()

/** Server-verified player position. Never trust a client-reported one. */
export function positionOf(address: string): Vector3 | null {
  for (const [e, id] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (id.address?.toLowerCase() !== address) continue
    const t = Transform.getOrNull(e)
    return t ? Vector3.create(t.position.x, t.position.y, t.position.z) : null
  }
  return null
}

export function incomePerSecond(address: string): number {
  const p = profiles.get(address)
  const b = bases.get(address)
  if (!p || !b) return 0
  let gain = 0
  for (const code of b.items) if (code !== VIDE) gain += itemIncome(code, INCOME_PER_RARITY)
  return gain * incomeMultiplier(p.rebirths ?? 0)
}

export function crediter(address: string, montant: number): void {
  const p = profiles.get(address)
  if (!p || montant <= 0) return
  p.coins += montant
  dirtyProfiles.add(address)
}

export function etapeTuto(address: string): number {
  const p = profiles.get(address)
  if (!p) return 0
  if (p.tuto !== undefined) return p.tuto
  let e = 0
  if (bases.has(address)) e = 1
  if (occupe(p.items) > 0 || (p.itemsFound ?? 0) > 0) e = 2
  if (p.coins > 0) e = 3
  p.tuto = e
  dirtyProfiles.add(address)
  return e
}

export function avancerTuto(address: string): void {
  const p = profiles.get(address)
  if (!p) return
  p.tuto = (p.tuto ?? 0) + 1
  dirtyProfiles.add(address)
}

/** Ce que la cagnotte contient a cet instant, arrondi a la piece. */
export function pendingOf(address: string): number {
  return Math.floor(profiles.get(address)?.pending ?? 0)
}

export function reclamerQuotidienne(address: string): { log: number; crate: number } | null {
  const p = profiles.get(address)
  if (!p) return null
  const d = new Date()
  const dayKey = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
  if (p.lastDay === dayKey) return null      // deja pris aujourd'hui

  /*
    On prend le plus petit coffre encore ouvert de la semaine, pas "le suivant d'une serie".

    L'ancienne regle avancait un compteur borne par `Math.min(streak + 1, 7)`, qui SATURE:
    arrive a sept il n'en bougeait plus, la recompense restait la derniere et le bandeau
    affichait sept cases vertes pour toujours. Et une journee manquee remettait tout a un,
    ce qui punissait un joueur present qui avait seulement oublie d'ouvrir le menu.
  */
  const sem = semaine(p)
  if (sem.pris.length >= SEMAINE) return null
  let jour = SEMAINE
  for (let j = 1; j <= SEMAINE; j++) if (!sem.pris.includes(j)) { jour = j; break }
  p.semainePris = [...sem.pris, jour]
  // `streak` reste ecrit: c'est ce que la semaine a rendu jusqu'ici, et d'autres lectures s'en
  // servent encore. Il n'est plus ce qui DECIDE de quoi que ce soit.
  p.streak = p.semainePris.length
  p.lastDay = dayKey

  const crate = DAILY_REWARDS[jour - 1] ?? 0
  p.crates = [...(p.crates ?? []), crate]
  dirtyProfiles.add(address)
  log(`${nameOf(address)} claimed day ${jour} of the week: crate ${crate}`)
  return { log: jour, crate }
}

export function startPlots(): void {
  void (async () => { try { await loadBases() } finally { pret = true } })()

  let acc = 0
  engine.addSystem((dt: number) => {
    acc += dt
    if (acc < 1) return
    const seconds = acc
    acc = 0
    const ici = presents()
    // Une seule passe sur les avatars, partagee par tous les profils: la chercher par joueur
    // rendait la boucle quadratique pour une donnee que le moteur donne d'un coup.
    positions.clear()
    for (const [e, id] of engine.getEntitiesWith(PlayerIdentityData)) {
      const a = id.address?.toLowerCase()
      const t = Transform.getOrNull(e)
      if (a !== undefined && t !== null) positions.set(a, { x: t.position.x, z: t.position.z })
    }
    for (const [address, profile] of profiles) {
      if (!ici.has(address)) continue

      const base = bases.get(address)
      if (!base) continue

      let gain = 0
      for (const code of base.items) if (code !== VIDE) gain += itemIncome(code, INCOME_PER_RARITY)
      if (gain === 0) continue
      /*
        Bouger, c'est jouer. Le serveur lit deja la position de tout le monde pour d'autres
        systemes; la comparer a celle d'il y a une seconde suffit a distinguer un joueur d'un
        avatar plante. Un achat compte aussi (`spend` appelle `signalerActivite`), pour le
        cas du joueur immobile devant le tapis.
      */
      const p3 = positions.get(address)
      const avant = derniereXZ.get(address)
      if (p3 !== undefined) {
        if (avant === undefined || Math.abs(p3.x - avant.x) + Math.abs(p3.z - avant.z) > AFK_MOVE_M) {
          profile.agiA = Date.now()
        }
        derniereXZ.set(address, { x: p3.x, z: p3.z })
      }
      if (Date.now() - (profile.agiA ?? 0) > AFK_PRODUCTION_MS) continue

      const perSecond = gain * incomeMultiplier(profile.rebirths ?? 0) * (1 + crowdBonus(ici.size))
      /*
        La production va dans la CAGNOTTE, pas dans le solde.

        Le report de la fraction reste, et il n'etait pas la avant: une base a 0,4 par seconde
        ne rapportait rien du tout tant qu'on tronquait chaque seconde. La cagnotte est donc
        un nombre reel, et c'est l'encaissement qui arrondit.
      */
      const cagnotte = profile.pending ?? 0
      profile.pending = Math.min(cagnotte + perSecond * seconds, perSecond * PENDING_CAP_S)
      const entier = Math.floor(profile.pending) - Math.floor(cagnotte)
      // La quete du jour dit noir sur blanc d'ou vient l'argent, ce qu'aucun testeur n'avait
      // compris. Pas de `pushQuests` ici: une poussee par seconde et par joueur serait du
      // trafic pour rien, la prochaine poussee naturelle portera le compte.
      if (entier > 0) advanceQuest(address, 'gagner', entier)
      profile.vuA = Date.now()
      // Not dirtied here: this ran every second for every present player, so every profile was
      // written every five seconds for nothing. Collect, departure and the checkpoint below persist it.
    }
  })

  timers.setInterval(() => { flushLog() }, 1000)
  timers.setInterval(() => {
    const ici = presents()
    for (const [address, p] of profiles) {
      if (!ici.has(address)) continue
      const prestige = p.rebirths ?? 0
      const next = prestige >= REBIRTH_MAX ? null : prestigeTier(prestige)
      const b = bases.get(address)
      let income = 0
      if (b) for (const code of b.items) if (code !== VIDE) income += itemIncome(code, INCOME_PER_RARITY)
      income = income * incomeMultiplier(prestige)
      const lock = b ? (Plot.getOrNull(b.entity)?.lockedUntil ?? 0) : 0
      void room.send('wallet', {
        income,
        basePosee: b !== undefined,
        lockSec: Math.max(0, Math.ceil((lock - Date.now()) / 1000)),
        floorPrice: nextFloorPrice(address),
        silos: p.silos ?? 0,
        siloPrice: nextSiloPrice(address),
        offlineCapS: offlineCapProductionS(p.silos ?? 0),
        pending: pendingOf(address),
        rechargeSec: Math.ceil(lockCooldown(address) / 1000),
        canRecover: hasSomethingToRecover(address),
        coins: Math.floor(Number.isFinite(p.coins) ? p.coins : 0),
        luckSec: Math.max(0, Math.ceil(((p.luckUntil ?? 0) - Date.now()) / 1000)),
        /*
          The offline sum rides the wallet tick for three minutes rather than one message at
          the join: the server sees the avatar the moment the client joins the room, and a
          message sent then can land before the scene's handlers exist (tester, 27 Aug, twice:
          "still no welcome back"). A fact repeated every tick until acknowledged by time
          cannot be missed; the client shows it once, keyed on `offlineAt`.
        */
        offlineGain: p.annonceHL !== undefined && Date.now() - p.annonceHL.at < 180_000 ? p.annonceHL.gain : 0,
        offlineSec: p.annonceHL !== undefined && Date.now() - p.annonceHL.at < 180_000 ? p.annonceHL.seconds : 0,
        offlineAt: p.annonceHL !== undefined && Date.now() - p.annonceHL.at < 180_000 ? p.annonceHL.at : 0,
        offlineCapped: p.annonceHL?.capped === true,
        luckPrice: luckCost(prestige, luckBuysOf(address)),
        nextPrestige: next ? next.cost : 0,
        prestigeEats: objetConsommePar(address),
        spared: sparedPieceOf(address),
        floorNeedsPrestige: floorPrestigeRequired(1 + (p.floorsBought ?? 0) + 1),
        prestige,
        minRarity: next ? next.minRarity : 0,
        // Sent so the button can know what the server already knows: prestige needs an item
        // of a given rarity, and a button that offers what will be refused is a broken button.
        bestRarity: occupe(p.items) === 0 ? -1 : Math.max(...p.items.filter((c) => c !== VIDE).map(rarityOf)),
        multiplier: incomeMultiplier(prestige),
        tutoEtape: etapeTuto(address),
        welcomed: p.welcomed === true,
        sentries: p.sentries ?? 0,
        sentryPrice: sentryPrice(address),
        presents: ici.size,
        prime: crowdBonus(ici.size)
      }, { to: [address] })
      void room.send('inventory', { crates: [...(p.crates ?? [])] }, { to: [address] })
      void room.send('gearHeld', { counts: gearsOf(address) }, { to: [address] })
      void room.send('index', { vus: [...(p.vus ?? [])], skin: p.skin ?? 0, sfxOff: p.sfxOff === true }, { to: [address] })
      void room.send('fusionState', { codes: [...(p.fusion ?? [])], made: -1 }, { to: [address] })
      pushQuests(address)
    }
  }, 1500)

  timers.setInterval(() => { void save() }, SAUVE_MS)
  // Checkpoint for the pending pool and last-seen stamp of everyone present: a minute of
  // income is the most a server death can cost, against a write per player every five seconds.
  timers.setInterval(() => {
    for (const a of presents()) if (profiles.has(a)) dirtyProfiles.add(a)
    foldEmptyBases(EMPTY_FOLD_MS)
  }, 60_000)
  timers.setInterval(() => {
    const ici = presents()
    for (const b of bases.values()) publish(b, ici)
  }, 3000)
}
