import { mkdir, writeFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { captureBenchmarkSource, sha256 } from './benchmark-source.mjs'
import { calibrate, compare, formatComparison } from './migration-results.mjs'

const lab = fileURLToPath(new URL('../', import.meta.url))
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const { values } = parseArgs({ options: { fixture: { type: 'string' }, smoke: { type: 'boolean' } } })
const kinds = values.fixture ? [values.fixture] : ['dense', 'hubs']
if (!kinds.every(k => ['dense', 'hubs'].includes(k))) throw new Error('Expected --fixture dense or hubs')
const cpu = cpus()[0]?.model ?? 'unknown'
if (!/Apple M3/i.test(cpu)) throw new Error(`Requires the native M3 machine, found ${cpu}`)
const root = join(lab, 'captures')
const runId = process.env.LAB_ARTIFACT_RUN || `packaged-force-timing-${new Date().toISOString().replace(/[.:]/g, '-')}`
const capture = resolve(root, runId)
if (!capture.startsWith(`${root}/`)) throw new Error('Choose a new LAB_ARTIFACT_RUN below captures/')
await mkdir(resolve(capture, '..'), { recursive: true })
await mkdir(capture)
const save = (name, object) => writeFile(join(capture, `${name}.json`), `${JSON.stringify(object, null, 2)}\n`)
const source = await captureBenchmarkSource(repo, lab, capture)
source.webgpuSha256 = await sha256(join(repo, 'experiments/graph-webgpu/dist/index.min.js'))
source.cpu = cpu
source.node = process.version
source.packageManager = process.env.npm_config_user_agent ?? null
source.arguments = process.argv.slice(2)
await save('source', source)
console.log(`Timing the two packages in ${relative(repo, capture)}`)
const server = await createServer({ root: lab, server: { host: '127.0.0.1', watch: null } })
const metrics = ['Steady frame p95', 'Click p95', 'First click', 'Slowest click']

function distribution(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  return { first: samples[0], p50: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
    p95: sorted[Math.ceil(0.95 * sorted.length) - 1], max: sorted.at(-1) }
}

async function run(url, kind, engine, name) {
  const entry = { kind, engine, name, stage: 'open', status: 'started', diagnostics: [], result: null }
  let browser
  let page
  const log = error => { if (entry.diagnostics.length < 25) entry.diagnostics.push(String(error).slice(0, 700)) }
  const snapshot = () => page.evaluate(() => window.forceTiming?.snapshot())
  const timeout = setTimeout(() => { entry.timedOut = true; browser?.close().catch(log) }, 120000)
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: false, timeout: 20000 })
    entry.browser = browser.version()
    page = await browser.newPage({ viewport: { width: 1050, height: 680 }, deviceScaleFactor: 2 })
    page.on('pageerror', log)
    page.on('console', message => { if (message.type() === 'error') log(message.text()) })
    await page.goto(url)
    await page.bringToFront()
    await page.waitForFunction(() => typeof window.openForceTiming === 'function')
    await page.evaluate(([engine, kind]) => window.openForceTiming(engine, kind), [engine, kind])
    const bounds = await page.locator('#graph canvas').boundingBox()
    if (!bounds || bounds.width !== 961 || bounds.height !== 541 || bounds.x < 0 || bounds.y < 0 ||
      bounds.x + bounds.width > 1050 || bounds.y + bounds.height > 680) throw new Error('Canvas not fully visible')
    entry.stage = 'frames'
    await page.evaluate(smoke => window.forceTiming.run(smoke ? 3 : 8, smoke ? 8 : 48), !!values.smoke)
    for (let i = 0; i < (values.smoke ? 4 : 12); i++) {
      entry.stage = `click ${i + 1}`
      const [x, y] = await page.evaluate(i => window.forceTiming.target(i), i)
      await page.mouse.move(bounds.x + x, bounds.y + y)
      await page.evaluate(() => window.forceTiming.frames(2))
      await page.mouse.click(bounds.x + x, bounds.y + y)
      await page.waitForFunction(i => window.forceTiming.snapshot().picked.length === i + 1, i, { timeout: 10000 })
    }
    entry.stage = 'quality'
    await page.evaluate(() => window.forceTiming.finish())
    entry.result = await snapshot()
    const { picked, quality, steady, refreshMs } = entry.result
    entry.result.click = distribution(picked.map(p => p.ms))
    entry.result.callback = distribution(picked.map(p => p.callbackAt - p.clickAt))
    entry.result.feedback = distribution(picked.map(p => p.feedbackAt - p.callbackAt))
    entry.result.clicksOverTwoRefreshes = picked.filter(p => p.ms > 2 * refreshMs).length
    entry.result.framesOverTwoRefreshes = steady.intervals.filter(t => t > 2 * refreshMs + 0.5).length
    const badPick = picked.find(p => !p.trusted || p.id !== p.requested || p.callbackAt < p.clickAt || p.feedbackAt < p.callbackAt)
    if (badPick) throw new Error(`Click ${badPick.sample + 1} returned ${badPick.id}, expected ${badPick.requested} (trusted ${badPick.trusted})`)
    if (!quality.freeMoved || quality.nonfinite || quality.fixedMoved || quality.flagErrors) throw new Error(`Moving graph contract failed ${JSON.stringify(quality)}`)
    entry.stage = 'complete'; entry.status = 'complete'
    console.log(`${kind} ${name}: frame ${steady.p95.toFixed(2)} ms, click ${entry.result.click.p95.toFixed(2)} ms`)
  } catch (error) {
    entry.status = 'failed'; entry.error = String(error); process.exitCode = 1
    console.log(`${kind} ${name} stopped at ${entry.stage}: ${entry.error}`)
    if (!entry.result && page && !page.isClosed()) entry.result = await snapshot().catch(() => null)
  } finally {
    clearTimeout(timeout)
    try { await save(`${kind}/${name}`, entry) } finally { await browser?.close() }
  }
  return entry
}

try {
  await server.listen(0)
  const url = `http://127.0.0.1:${server.httpServer.address().port}/packaged-force-benchmark.html`
  for (const kind of kinds) {
    await mkdir(join(capture, kind))
    if (values.smoke) {
      for (const engine of ['webgl', 'webgpu']) await run(url, kind, engine, `smoke-${engine}`)
      continue
    }
    const controls = []
    for (const name of ['control-1', 'control-2']) controls.push(await run(url, kind, 'webgl', name))
    const calibration = calibrate(controls, metrics)
    await save(`${kind}/calibration`, calibration)
    const pairs = []
    for (const [index, order] of [['webgl', 'webgpu'], ['webgpu', 'webgl']].entries()) {
      const pair = {}
      for (const engine of order) pair[engine] = await run(url, kind, engine, `pair-${index + 1}-${engine}`)
      pairs.push(pair)
    }
    const rows = compare(pairs, calibration)
    await save(`${kind}/comparison`, rows)
    console.log(formatComparison(rows))
  }
} finally { await server.close() }
