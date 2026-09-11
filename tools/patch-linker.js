// Re-applies the hand patch the deploy signing page needs, every time node_modules changes.
//
// The linker's `/auth/*` proxy (node_modules/@dcl/sdk-commands/dist/linker-dapp/routes.js)
// spreads a fetch `Headers` object into the outgoing request. On Node 22 that spread yields
// Symbol keys and undici's Request rejects them ("init.headers is a symbol"): the browser
// shows "Proxy error" and no signature can be made. The fix iterates the headers and drops the
// hop-by-hop ones. It lived only in node_modules, redone by hand after every `npm install`
// (memo, 1 Sep) until the audit of 11 Sep: `npm ci`, a fresh clone or another machine lost it
// and found out inside the 300 s signing window. Now `postinstall` and `tools/deploy.sh` run
// this script; it is idempotent and says which state it found.
//
// Usage: node tools/patch-linker.js [--strict]   (--strict: an unknown file layout is an error)
const fs = require('fs')
const path = require('path')

const strict = process.argv.includes('--strict')
const file = path.join(__dirname, '..', 'node_modules', '@dcl', 'sdk-commands', 'dist', 'linker-dapp', 'routes.js')
const upstream = '...ctx.request.headers,'
const patched = "...Object.fromEntries([...ctx.request.headers].filter(([k]) => !['host', 'connection', 'content-length'].includes(String(k).toLowerCase()))),"

function fail(message) {
  console.error(`patch-linker: ${message}`)
  process.exit(strict ? 1 : 0)
}

if (!fs.existsSync(file)) fail(`${file} not found (sdk-commands layout changed?)`)
const source = fs.readFileSync(file, 'utf8')
if (source.includes(patched)) {
  console.log('patch-linker: already patched')
  process.exit(0)
}
if (!source.includes(upstream)) fail('neither the upstream nor the patched header spread was found: check the linker version')
fs.writeFileSync(file, source.replace(upstream, patched))
console.log('patch-linker: applied')
