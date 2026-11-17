# V0, page 1: from arrival to the first purchase

Status: approved by the founder on 17 Nov 2026 (block 0, design, page 1). Not built.
Other pages to come: the lexicon (every word the player reads), then the mechanics (shooting economy, shield,
outbid, known bugs).

## Context

- Private playtest with members of the Decentraland Foundation, 17 Nov 2026, 17:02 to 18:33 UTC, on the live build
  of 11 Sep 2026 (`42f4df0`, entity `bafkreidcyfv63b56j5u6i2hpa3zfqmlhbkncegso4wgo2aunjo32umona4`). Server log read
  the same day with `scene-insights` (execution `aa37a81c-4a91-4309-bd6f-cbf6b2de5999`, 4,743 lines).
- What the founder heard: the game was well liked; most new players could not complete the first loop on their own;
  COLLECT is one of the main criticisms; testers took a long time to understand that a shelved item earns coins; the
  word "pot" was read as the fuser; the moving crates on the belt draw the eye first, so new players walk to the
  belt, try to buy with no money, and do not build their base.
- What the log measured, for the 7 players who arrived without a base (times from arrival):
  - base placed at 0:21, 0:31, 0:59, 1:30, 3:00, 5:28, and never for one player (no action at all);
  - crate opened then item shelved within 8 to 25 s, except one player who held the item for 4:09;
  - first belt purchase at 3:54, 12:50, 13:12, 18:17, 23:32, 33:28: median about 15 min;
  - 5 of 6 had picked up more coins from the ground (dropped by shots) than their first purchase cost; first shots
    as early as 0:39. COLLECT is not logged, so its use cannot be measured.
- What the live code does (read on 17 Nov 2026):
  - the spawn camera targets (96, 2.2, 96), the centre of the belt (`scene.json`, `CENTER`), and the arrival move
    also looks at the centre (`client/travel.ts`);
  - the move to a free square on arrival is skipped once the player has walked 3 m, or 20 s after the wallet;
  - on a refused square the button offers BUILD BASE, whose press switches the automatic ghost off, and the next
    frame lights it again: nothing happens. BUILD BASE and PLACE HERE carry the same hammer;
  - production goes to the pot (`pending`), a belt purchase spends the balance only (`spend`), and the refusal says
    "you need N more coins" while the pot may hold them. COLLECT is the last verb of `choisirAction`, so it is never
    offered at the belt;
  - the tutorial has no COLLECT step (place, open, shelve, buy, steal);
  - no action label is drawn when the action has an icon (`hint()` in `ui.tsx`), so the amount decided on
    7 Sep 2026 for the COLLECT button never reached the screen;
  - a new account owns one Good Box. With that one item, the first Basic Box (2,018) takes about 46 s for a Rare
    (1 roll in 5), 4.8 min for an Uncommon (1 in 2), 34 min for a Common (1 in 5), before mutations.

## Goals

- Every player without a base places it within 30 s of taking control.
- The first belt purchase comes within the first minutes. The official grid asks for a loop completed between 1 and
  3 min (`core-loop-and-ftue.md`); with this page, about 5 min for half of new players and under 1 min for a fifth
  (see the trade-offs).
- Every step of the first loop is measurable in the server log.

## Non-goals (other pages)

- The shooting economy: new players found coins on the ground before COLLECT, and one new account took 35 M from
  another player in 46 min, buying an Epic Box with it.
- The words: pot, waiting and banked for one thing; box and crate; piece, item and toy; "Shelve" in the step and
  PUT IT DOWN on the button.
- The shield, the outbid limit, the desktop SELL chip, the desktop camera after aiming.

## Constraints set by the founder

- The central button always does something. A greyed button at rest is refused (17 Nov 2026).
- Collecting by walking into one's own base is refused: it is as easy to miss as the button, and longer
  (17 Nov 2026).
- Onboarding signs, text or images are allowed if done well, and only when nothing better works (17 Nov 2026).
- The pot and COLLECT stay (7 Sep 2026).
- The start is no richer than one improved crate (2 Sep 2026).

## The design

1. **Arrival on a free square, facing it.** A player without a base starts on a legal square (founder's request,
   17 Nov 2026), the camera turned to that square and the gold beacon on it. The first moving thing in the frame is
   the beacon, not the belt ("the eye goes to movement before text", `core-loop-and-ftue.md`).
2. **The hammer always builds.** On a refused square, the press places the base on the nearest free square, the one
   the beacon already shows (`freeSpotNear`, used by the server today when two players claim the same square). No
   press is ever dead.
3. **COLLECT is a tutorial step, and the button shows the pot.** Steps: place, open, shelve, collect, buy, steal.
   From the first shelved item, the pot amount is drawn on the central button and grows every second, so the item
   visibly earns and the press has a reason. The press sends the coins to the balance with the coin sound. The step
   completes on the first collect. Reason: the two steps that already pulse (open, shelve) were done in 8 to 25 s;
   COLLECT never had that treatment. Visibility of system status, Nielsen's heuristic 1.
4. **A refused purchase collects first.** When the balance is short and the pot covers the price, the BUY press
   collects and buys at once. "The best designs carefully prevent problems from occurring in the first place"
   (Nielsen's heuristic 5). COLLECT keeps its role; the dead end at the belt disappears.
5. **A floor on the welcome box.** The welcome Good Box never rolls a Common ("a floor on bad rolls",
   `core-loop-and-ftue.md`). The worst case falls from about 34 min to about 5 min; the Rare Box given at 6 min of
   play stays.
6. **Measure.** One server log line per tutorial step reached and per collect (with its amount), so the next
   playtest gives the whole funnel.

Step texts and the words on the button come from the lexicon page.

## Trade-offs and alternatives considered

- Income straight to the balance, no pot: done on 7 Sep 2026, undone the same day so the button had a state at rest.
  The founder keeps the pot.
- Collect on entering one's base: refused (see constraints).
- A greyed button at rest: refused (see constraints).
- A richer start, so that every new player buys within 3 min. The reference game's first belt purchase is nearly free
  (Noobini, 25 $, earning 1 $/s, paid back in 25 s; its wiki read on 30 Aug 2026, price confirmed by player guides),
  which uses the belt's pull instead of fighting it. Not chosen: two Uncommons at the start were judged too rich on
  2 Sep 2026. Consequence kept in view: half of new players reach their first purchase around 5 min.

## Done when

- Built on `visual-pass` and seen working in the Explorer for each of the six points.
- At the next playtest, read from the server log: every base placed within 30 s, the median time to the first
  purchase, and the share of players reaching each tutorial step.
