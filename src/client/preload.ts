import { engine, AssetLoad } from '@dcl/sdk/ecs'
import { CRATES } from '../shared/loot-table'
import { EVENT_THEMES } from '../shared/schemas'

/*
  The models the world shows within the first minute, asked for at once.

  The client fetches a model the first time an entity names it. Bases, belt crates and toys
  arrive after the room has synced, so each of them popped in on first sight, one download
  at a time (owner, 4 Sep: "the world loads slowly"). The renderer accepts a list of assets
  to fetch ahead (`AssetLoad`, checked in the SDK's own test scene 88,-12), so this names
  everything a first visit is certain to need: the storeys and their glass, the default
  accent and climb, every crate tier on the belt, every toy rarity. The bytes are the same
  ones the visit would download anyway; they now arrive while the loading screen is still
  up instead of one by one while the player is already walking.

  Decor is not listed: its entities exist from the first frame and are requested on their
  own. Skins are not listed either: a skinned base is rare and its glass arrives on sight.

  LE CRITERE QUE CETTE LISTE AVAIT MANQUE, et qui a coute un sol blanc en pleine partie: ce
  qu'il faut precharger n'est pas "ce qui est gros", c'est CE QU'AUCUNE ENTITE NE NOMME AVANT
  UN EVENEMENT D'EXECUTION. Le decor n'en a pas besoin, ses entites existent des la premiere
  image et demandent leurs fichiers toutes seules. Les tapis de rush, si: personne ne prononce
  `mat-rush-12.png` tant qu'un Cyber Rush n'a pas commence, donc le client ne commence a le
  telecharger qu'a cet instant-la, au milieu du jeu.

  Ce que ca donnait, dans l'ordre observe (proprietaire, 7 Sep, capture a l'appui): la
  notification arrive et le materiau est echange dans la meme image, le client continue de
  dessiner l'ancienne texture pendant plusieurs secondes, puis il la lache et affiche
  l'ALBEDO NU, qui vaut `Color4.White()` parce que c'est l'image qui porte la couleur depuis le
  5 Sep. Une place entierement blanche, ni le sol au repos ni le sol d'evenement.

  Dix fichiers, 180 Ko au total contre un paquet de 26 Mo, soit sept dixiemes de pour cent.
  Ils arrivent desormais sous l'ecran de chargement, donc le tapis est en cache avant le
  premier rush et l'echange est instantane.
*/
const FIRST_MINUTE: string[] = [
  'assets/Models/storey-ground.glb', 'assets/Models/storey-upper.glb', 'assets/Models/glass.glb',
  'assets/Models/accent-0.glb', 'assets/Models/climb-0.glb',
  ...CRATES.map((_, i) => `assets/toy/crate-${i}.glb`),
  ...[0, 1, 2, 3, 4, 5].map((r) => `assets/toy/item-${r}.glb`),
  // The muzzle flash sprite: the first shot must not draw a blank quad while it loads.
  'assets/ui/flash.png',
  // The padlock on the owner's lock post, both states: it stands in the first base a player sees, their own.
  'assets/toy/lock-open.glb', 'assets/toy/lock-shut.glb',
  // Les tapis de rush: derives de la table des themes plutot qu'ecrits a la main, pour qu'un
  // onzieme rush ajoute demain ne puisse pas etre oublie ici.
  ...EVENT_THEMES.map((t) => `assets/textures/mat-rush-${t.theme}.png`)
]

export function setupPreload(): void {
  AssetLoad.getOrCreateMutable(engine.addEntity(), { assets: FIRST_MINUTE })
}
