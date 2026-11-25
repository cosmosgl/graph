// Profile one native Apple M3 Graph at a time; normal story and package code are untouched.
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { captureBenchmarkSource, sha256 } from './benchmark-source.mjs'
import { expectedLassoMeshHash, installLassoFixture, installLassoPackage, lassoForceSeed } from './lasso-story-fixture.mjs'
import { installPhaseProbe } from './lasso-phase-browser.mjs'

const lab = fileURLToPath(new URL('../', import.meta.url))
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const { values } = parseArgs({ options: {
  url: { type: 'string', default: 'http://127.0.0.1:6007' },
  bundle: { type: 'string', default: join(lab, '../graph-webgpu/dist/index.min.js') },
  'before-bundle': { type: 'string' }, rounds: { type: 'string', default: '3' },
  'timestamps-only': { type: 'boolean' },
} })
const rounds = Number(values.rounds)
assert.ok(Number.isSafeInteger(rounds) && rounds > 0)
const root = join(lab, 'captures')
await mkdir(root, { recursive: true })
const capture = await mkdtemp(join(root, 'lasso-first-step-'))
console.log(capture)
const bundles = []
for (const [name,path] of [['candidate', values.bundle], ['reference', values['before-bundle']]]) {
  if (!path) continue
  const file = join(capture, name + '.js')
  await copyFile(resolve(path), file)
  bundles.push({ name, file, sha256: await sha256(file) })
}
const save = (name, value) => writeFile(join(capture, name + '.json'), JSON.stringify(value, null, 2) + '\n')
const browser = await chromium.launch({ channel: 'chrome', headless: false })
try {
  const session = await browser.newBrowserCDPSession()
  const devices = (await session.send('SystemInfo.getInfo')).gpu.devices.map(d => d.deviceString)
  assert.ok(devices.some(d => /Apple M3/.test(d)))
  const source = await captureBenchmarkSource(repo, lab, capture)
  await save('manifest', { source, bundles, chrome: browser.version(), devices, args: process.argv.slice(2), rounds })
  const algorithms = {}
  const recipes = {}
  const hashes = {}
  const totals = []
  async function trial(bundle, mode, block) {
    const page = await browser.newPage({ viewport: { width: 680, height: 536 }, deviceScaleFactor: 1 })
    const errors = []
    const timeout = setTimeout(() => page.close().catch(() => {}), 90000)
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    try {
      await installLassoFixture(page)
      await installLassoPackage(page, bundle)
      const discovery = !recipes[bundle.name]
      await page.addInitScript(installPhaseProbe, { timestamps: mode === 'timestamp', prepare: mode, discovery })
      await page.goto(new URL('/iframe.html?id=examples-interaction--lasso-selection&viewMode=story', values.url).href)
      await page.waitForFunction(() => window.lassoFixture?.graph.isReady)
      const data = await page.evaluate(recipes => window.profileLassoStep(recipes), recipes[bundle.name] ?? [])
      if (discovery) recipes[bundle.name] = data.recipes
      delete data.recipes
      assert.equal(data.seed, lassoForceSeed)
      assert.equal(data.adapter.fallback, false)
      assert.equal(data.zoom, 0.4)
      assert.deepEqual(data.center, [340, 268])
      assert.equal(data.visibility, 'visible')
      assert.deepEqual(errors, [])
      for (const r of data.records) {
        assert.equal(r.mesh, expectedLassoMeshHash)
        const key = bundle.name + '-' + r.tick
        hashes[key] ??= r.positions
        assert.equal(r.positions, hashes[key], 'Instrumentation changed positions')
      }
      if (mode === 'timestamp') {
        const entries = data.records[0].passes.flatMap(p => p.entries)
        algorithms[bundle.name] = entries.includes('repulse') ? 'tree' : 'grid'
        for (const phase of (algorithms[bundle.name] === 'tree' ? ['grid', 'far'] : ['grid', 'near', 'far'])) {
          assert.ok(data.records.every(r => r.passes.some(p => p.phase === phase)), 'Missing ' + phase)
        }
      }
      if (['grid','far','near','all'].includes(mode)) {
        assert.ok(data.records[0].nativeCalls.some(c => c.prepared), 'No prepared pipeline was reused')
      }
      const record = { lane: bundle.name, mode, block, ...data }
      await save(block + '-' + bundle.name + '-' + mode, record)
      const phases = Object.fromEntries(['grid','far','near','other'].map(phase => [phase,
        data.records[0].passes.filter(p => p.phase === phase).reduce((acc,p) => acc+p.ms,0)]))
      const row = { lane: bundle.name, algorithm: algorithms[bundle.name], mode, block, ms: data.records[0].ms, submit: data.records[0].submitMs, phases, prepareMs: data.prepareMs }
      totals.push(row)
      console.log(JSON.stringify(row))
    } catch (error) {
      const body = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '')
      throw new Error(JSON.stringify({ errors, body: body.slice(0,1000), mode, lane: bundle.name, message: String(error) }), { cause: error })
    } finally { clearTimeout(timeout); await page.close() }
  }
  for (const b of bundles) await trial(b, 'timestamp', 0)
  for (let i = 0; i < rounds; i++) {
    for (const b of (i % 2 ? [...bundles].reverse() : bundles)) {
      const modes = ['plain', 'timestamp', ...new Set(recipes[b.name].map(r => r.phase)), 'all']
      const eligible = values['timestamps-only'] ? ['timestamp','plain'] : modes
      const start = i % eligible.length
      for (const mode of [...eligible.slice(start),...eligible.slice(0,start)]) await trial(b, mode, i+1)
    }
  }
  await save('summary', totals)
} finally { await browser.close() }
