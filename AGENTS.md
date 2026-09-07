# AGENTS.md

Rob a Base: a Decentraland SDK7 multiplayer tycoon game, deployed as a World (`basewar.dcl.eth`).
Authoritative multiplayer server (`@dcl/sdk@auth-server`); the same codebase runs on server and client.

## Language: English only, no exceptions
Every identifier and every comment is English: functions, variables, parameters, types, comments.
A maintainable, internationally readable codebase is English, full stop. This is a rule, not a
preference. Some legacy files still hold French names and comments; they are being removed, not a
style to match. When you touch such a file, translate what you touch.

The only strings that stay verbatim are protocol contracts, because their value is a wire or
storage contract, never a symbol name:
- synced component ids, e.g. `engine.defineComponent('basetycoon::plot', ...)`
- message names, e.g. `room.send('feedFusion', ...)`
- storage keys, e.g. `'profile'`, `'reset'`, `'base:'`
- asset paths, e.g. `'assets/Models/...'`

Rename the variable that holds such a string freely; never change the string itself.

## Writing style
Never use the em dash or en dash character. Use a comma, a colon, parentheses, or two sentences.
The plain hyphen is fine.

## Build, run, deploy
- Type check: `npx tsc --noEmit -p tsconfig.json`
- Local preview (with MCP inspection): `npx sdk-commands start --port 8100 --skip-auth-screen true --no-browser --mcp --mcp-port 8123`
- Deploy: `bash tools/deploy.sh` (opens a signature page on `localhost:8000`, 300 s window)
- After a deploy, read the four-character build stamp in the in-game `1 MENU` before judging anything: client propagation takes up to ~20 minutes.

## Server invariants that bite
- Coin amounts and prices are `Schemas.Int64`, never `Schemas.Int`: Int32 overflows past ~2.1e9 and shows negative prices.
- The isolate has a 256 MB ceiling and a 60 s async-turn limit; a startup task that exceeds either kills the server for everyone.
- Storage writes are capped: keep working state in memory, persist only at checkpoints.

## Where the knowledge lives
Skills and deeper references are under `.claude/`.
