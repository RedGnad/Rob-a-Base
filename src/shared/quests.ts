
export type QuestType =
  | 'ouvrir'      // open any crate
  | 'ouvrirRare'  // ouvrir une crate de type 1 ou mieux
  | 'acheter'     // buy a crate from the belt
  | 'collectPending'   // encaisser sa pending
  | 'vendre'      // sell un item
  | 'poser'       // place an item on your base
  | 'bank'     // total de pieces encaissees dans la journee
  | 'gift'      // items left on another player's base
  | 'outbid'    // convoys rachetes a un autre joueur en cours de route

export type Quest = { type: QuestType; cible: number; texte: string }

export const QUESTS: readonly Quest[] = [
  { type: 'ouvrir',     cible: 4,    texte: 'Open 4 boxes' },
  { type: 'acheter',    cible: 3,    texte: 'Buy 3 boxes from the belt' },
  { type: 'collectPending',  cible: 5,    texte: 'Collect your income 5 times' },
  { type: 'vendre',     cible: 3,    texte: 'Sell 3 items' },
  { type: 'poser',      cible: 6,    texte: 'Shelve 6 items at home' },
  { type: 'bank',    cible: 2000, texte: 'Bank 2,000 coins' },
  { type: 'ouvrirRare', cible: 2,    texte: 'Open 2 uncommon boxes' },
  { type: 'gift',     cible: 1,    texte: 'Gift an item to a neighbour' },
  { type: 'outbid',   cible: 1,    texte: 'Outbid a box in transit' }
]

export const QUEST_CRATE = 1
export const QUEST_BONUS_CRATE = 2

export function questsOfDay(dayKey: number): number[] {
  const k = ((dayKey % QUESTS.length) + QUESTS.length) % QUESTS.length
  return [k, (k + 2) % QUESTS.length, (k + 4) % QUESTS.length]
}

/**
 * La quete qui apprend la boucle du jeu: la base produit, et il faut venir encaisser.
 *
 * C'est la seule des neuf qui enseigne quelque chose plutot que de mesurer. Elle ne tombait
 * que trois jours sur neuf (les jours 0, 2 et 7 du cycle), donc six nouveaux joueurs sur neuf
 * n'avaient devant eux que des quetes qui supposent la boucle deja comprise.
 */
export const BEGINNER_QUEST = 2

/**
 * Les trois quetes d'UN joueur pour la journee: la rotation du jour, sauf pour un debutant.
 *
 * Un debutant recoit toujours la quete d'apprentissage en premiere place, a la place de la
 * premiere du jour. Les deux autres restent celles de tout le monde, pour qu'il decouvre la
 * rotation en meme temps qu'il apprend la boucle.
 */
export function questsFor(dayKey: number, debutant: boolean): number[] {
  const ids = questsOfDay(dayKey)
  if (!debutant || ids.includes(BEGINNER_QUEST)) return ids
  return [BEGINNER_QUEST, ids[1], ids[2]]
}
