/*
  Counts what the client draws, without the Explorer (founder, 19 Nov 2026: opening the Explorer
  for every check loads the machine).

  The client code is bundled for Node with every `~system/*` module stubbed, run for ten seconds of
  ticks, and read back: models per file, SDK primitives with their own material, texts, particle
  emitters. Fake bases can be added (BASES=n, NAMELEN=k) to see how many the level-of-detail budget
  promotes to full detail. Materials follow the phone's rule (one per primitive carrying a Material,
  one per material of a model file however many copies stand); draws count one per shown primitive
  or text and one per mesh primitive of each shown model. It sees no server, so belt crates,
  convoys and a live raid boss are absent.

  Usage: node tools/budget/build.js            (decor only)
         BASES=25 node tools/budget/build.js   (with 25 fake bases of 3 storeys and 12 pieces)
*/
const path = require('path')
const os = require('os')
const fs = require('fs')
const { execFileSync } = require('child_process')
const ROOT = path.join(__dirname, '..', '..')
const OUT = path.join(os.tmpdir(), 'rab-budget-out.js')
const GLB_INFO = path.join(os.tmpdir(), 'rab-budget-glb.json')

function indexGlbs() {
  const out = {}
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.glb')) {
    const b = fs.readFileSync(p); const L = b.readUInt32LE(12); const js = JSON.parse(b.subarray(20, 20 + L).toString())
    const prims = (js.meshes || []).map((m) => m.primitives.length)
    let draws = 0; for (const n of js.nodes || []) if (n.mesh !== undefined) draws += prims[n.mesh]
    out[path.relative(ROOT, p)] = { mats: (js.materials || []).length, draws }
  } } }
  walk(path.join(ROOT, 'assets'))
  fs.writeFileSync(GLB_INFO, JSON.stringify(out))
}
function runAll() {
  indexGlbs()
  const res = execFileSync('node', [OUT], { env: { ...process.env, GLB_INFO }, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })
  const line = res.split('\n').find((l) => l.startsWith('RESULT '))
  console.log(line ? JSON.stringify(JSON.parse(line.slice(7)), null, 2) : 'no result')
}
const esbuild = require(path.join(ROOT, 'node_modules/esbuild'))
const stub = `
const deep = () => new Proxy(function(){}, {
  get: (_, k) => k === 'then' ? undefined : (k === Symbol.toPrimitive ? () => '' : deep()),
  apply: () => deep()
})
const special = {
  crdtGetState: async () => ({ hasEntities: false, data: [] }),
  crdtSendToRenderer: async () => ({ data: [] }),
  sendBatch: async () => ({ events: [] }),
  subscribe: async () => ({}),
  getRealm: async () => ({ realmInfo: { baseUrl: 'http://localhost', realmName: 'LocalPreview', isPreview: true, networkId: 0, commsAdapter: '' } }),
  getUserData: async () => ({ data: { userId: '0xabc', displayName: 'probe', publicKey: '0xabc', hasConnectedWeb3: true, version: 1 } }),
  getPlayerData: async () => ({ data: null }),
  getExplorerInformation: async () => ({ agent: 'probe', platform: 'desktop', configurations: {} }),
  getSceneInformation: async () => ({ urn: 'x', content: [], metadataJson: '{}', baseUrl: '' }),
  readFile: async () => ({ content: new Uint8Array(), hash: '' }),
}
const names = ['crdtGetState','crdtSendToRenderer','getExplorerInformation','getRealm','getUserData','isServer','movePlayerTo','readFile','sendAsync','sendBatch','sendBinary','signedFetch','stopEmote','subscribe','triggerSceneEmote']
special.isServer = async () => ({ isServer: false })
special.sendBinary = async () => ({ data: [] })
special.signedFetch = async () => ({ ok: false, status: 0, body: '{}', headers: {} })
for (const n of names) module.exports[n] = special[n] ?? (async () => ({}))
`
esbuild.build({
  entryPoints: [path.join(__dirname, 'harness.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: OUT,
  logLevel: 'error', target: 'node18', nodePaths: [path.join(ROOT, 'node_modules')], tsconfig: path.join(ROOT, 'tsconfig.json'),
  plugins: [{ name: 'system', setup(b) {
    b.onResolve({ filter: /^~system\// }, (a) => ({ path: a.path, namespace: 'sys' }))
    b.onResolve({ filter: /^~sdk\// }, (a) => ({ path: a.path, namespace: 'sdk' }))
    b.onLoad({ filter: /.*/, namespace: 'sdk' }, () => ({ contents: 'module.exports = { compositeFromLoader: {} }', loader: 'js' }))
    b.onLoad({ filter: /.*/, namespace: 'sys' }, () => ({ contents: stub, loader: 'js' }))
  } }]
}).then(() => runAll()).catch((e) => { console.error(e.message); process.exit(1) })
