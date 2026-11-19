import { engine, GltfContainer, MeshRenderer, Material, TextShape, Transform, VisibilityComponent, ParticleSystem, Entity } from '@dcl/sdk/ecs'
import { onStart, onUpdate } from '@dcl/sdk'
import { main } from '../../src/index'
import { Plot, CENTER } from '../../src/shared/schemas'
import * as fs from 'fs'

function shown(e: Entity): boolean {
  let cur: Entity | undefined = e
  for (let i = 0; i < 20 && cur !== undefined; i++) {
    if (VisibilityComponent.getOrNull(cur)?.visible === false) return false
    const t = Transform.getOrNull(cur)
    if (t === null) return true
    if (t.scale.x === 0 || t.scale.y === 0 || t.scale.z === 0) return false
    const p = t.parent as unknown as number | undefined
    if (p === undefined || p === 0) return true
    cur = p as unknown as Entity
  }
  return true
}
const glbInfo: Record<string, { mats: number; draws: number }> = JSON.parse(fs.readFileSync(process.env.GLB_INFO as string, 'utf8'))
async function run(): Promise<void> {
  main()
  await onStart()
  const n = Number(process.env.BASES ?? 0)
  const nameLen = Number(process.env.NAMELEN ?? 10)
  Transform.createOrReplace(engine.PlayerEntity, { position: { x: CENTER.x, y: 0, z: CENTER.z + 20 } })
  for (let i = 0; i < n; i++) {
    const e = engine.addEntity()
    const col = i % 6, row = Math.floor(i / 6)
    const x = 22 + col * 29, z = 22 + row * 36
    Transform.create(e, { position: { x, y: 0, z } })
    const items: number[] = []
    for (let k = 0; k < 18; k++) items.push(k < 12 ? ((k % 7) * 100) : -1)
    const name = ('PLAYER' + i + 'ABCDEFGHIJKLMNOP').slice(0, nameLen)
    Plot.create(e, { floors: 3, rebirths: i % 3, index: i, ownerId: '0x' + (1000 + i), ownerName: name, items, ownerPresent: i % 2 === 0,
      given: 0, received: 0, skin: 0, sentries: 0, sentryFloors: [1, 0, 0], lockedUntil: 0, fieldUntil: 0 } as any)
  }
  const ticks = Number(process.env.TICKS ?? 300)
  for (let i = 0; i < ticks; i++) await onUpdate(1 / 30)
  let glbMats = 0, glbDraws = 0, glbHiddenMats = 0
  const seen = new Set<string>(), seenShown = new Set<string>()
  for (const [e, g] of engine.getEntitiesWith(GltfContainer)) {
    const info = glbInfo[g.src] ?? { mats: 1, draws: 1 }
    if (!seen.has(g.src)) { seen.add(g.src); glbHiddenMats += info.mats }
    if (shown(e)) { glbDraws += info.draws; if (!seenShown.has(g.src)) { seenShown.add(g.src); glbMats += info.mats } }
  }
  let primMatShown = 0, primMatAll = 0, primDraws = 0, planesShown = 0
  for (const [e, m] of engine.getEntitiesWith(MeshRenderer)) {
    const s = shown(e)
    if (Material.has(e)) { primMatAll++; if (s) primMatShown++ }
    if (s) { primDraws++; if (m.mesh?.$case === 'plane') planesShown++ }
  }
  let textShown = 0; for (const [e] of engine.getEntitiesWith(TextShape)) if (shown(e)) textShown++
  let ps = 0; for (const [] of engine.getEntitiesWith(ParticleSystem)) ps++
  let signsShown = 0, glyphModels = 0, padsShown = 0
  for (const [e, g] of engine.getEntitiesWith(GltfContainer)) { if (shown(e) && g.src.startsWith('assets/glyphs/')) { glyphModels++; if (g.src.endsWith('sign.glb')) signsShown++ } if (shown(e) && /\/pad-[^/]*\.glb$/.test(g.src)) padsShown++ }
  console.log('RESULT ' + JSON.stringify({ bases: n, nameLen,
    materials_shownOnly: glbMats + primMatShown, materials_allLoaded: glbHiddenMats + primMatAll,
    draws_shown: glbDraws + primDraws + textShown, planesShown, signsShown, glyphModels, padsShown, glbFiles: seen.size, particles: ps }))
}
run().catch((e) => { console.error('HARNESS ERROR', e) })
