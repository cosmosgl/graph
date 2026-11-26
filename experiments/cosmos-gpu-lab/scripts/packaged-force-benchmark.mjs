import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
const { values } = parseArgs({ options: {
  fixture: { type: 'string' }, points: { type: 'string', default: '8192' }, smoke: { type: 'boolean' }, layout: { type: 'boolean' },
} })
const pointCount = Number(values.points)
if (!Number.isSafeInteger(pointCount) || pointCount < 1026 || pointCount > 1000000) throw new Error('Expected 1,026–1,000,000 points')
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
const metrics = ['Steady frame p95', 'Click p95', 'First click', 'Slowest click', 'Peak tracked memory']
if (pointCount > 8192) metrics.push('Cold startup', 'Point update', 'Topology update', 'Full replacement', 'Resize')

async function comparePositions(referencePath, coordinates, radius) {
  const earlier = await readFile(referencePath)
  if (earlier.length !== coordinates.length) throw new Error('Point counts differ')
  const reference = new Float32Array(earlier.buffer, earlier.byteOffset, earlier.length / 4)
  const xy = new Float32Array(coordinates.buffer, coordinates.byteOffset, coordinates.length / 4)
  let sum = 0
  for (let i = 0; i < xy.length; i++) {
    if (i === 2 || i === 3) continue // the fixture's absent slot
    sum += (xy[i] - reference[i]) ** 2
  }
  return Math.sqrt(sum / (xy.length / 2 - 1)) / radius
}

function distribution(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  return { first: samples[0], p50: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
    p95: sorted[Math.ceil(0.95 * sorted.length) - 1], max: sorted.at(-1) }
}

async function run(url, kind, engine, name) {
  const entry = { kind, engine, name, pointCount, stage: 'open', status: 'started', diagnostics: [], result: null }
  let browser
  let page
  const log = error => { if (entry.diagnostics.length < 25) entry.diagnostics.push(String(error).slice(0, 700)) }
  const snapshot = () => page.evaluate(() => window.forceTiming?.snapshot())
  const timeout = setTimeout(() => { entry.timedOut = true; browser?.close().catch(log) }, values.layout && !values.smoke ? 240000 : 120000)
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: false, timeout: 20000 })
    entry.browser = browser.version()
    page = await browser.newPage({ viewport: { width: 1050, height: 680 }, deviceScaleFactor: 2 })
    page.on('pageerror', log)
    page.on('console', message => { if (message.type() === 'error') log(message.text()) })
    await page.goto(url)
    await page.bringToFront()
    await page.waitForFunction(() => typeof window.openForceTiming === 'function')
    await page.evaluate(args => window.openForceTiming(...args), [engine, kind, pointCount, !!values.layout])
    const bounds = await page.locator('#graph canvas').boundingBox()
    if (!bounds || bounds.width !== 961 || bounds.height !== 541 || bounds.x < 0 || bounds.y < 0 ||
      bounds.x + bounds.width > 1050 || bounds.y + bounds.height > 680) throw new Error('Canvas not fully visible')
    if (values.layout) {
      entry.result = await snapshot()
      entry.result.checkpoints = []
      for (const tick of values.smoke ? [0, 1] : [0, 1, 4, 8, 16, 31, 32, 99, 100]) {
        entry.stage = `tick ${tick}`
        const { positions, ...row } = await page.evaluate(tick => window.forceTiming.checkpoint(tick), tick)
        const coordinates = Buffer.from(positions, 'base64')
        const xyFile = join(capture, kind, `${name}-${tick}.f32`)
        await writeFile(xyFile, coordinates)
        entry.result.checkpoints.push(row)
        await save(`${kind}/${name}`, entry)
        console.log(`${kind} ${name}: tick ${tick}, collision RMS ${row.quality.overlap.rmsDepth.toFixed(3)} (stride ${row.quality.overlap.stride})`)
      }
      await page.evaluate(() => window.forceTiming.finish())
      const { checkpoints } = entry.result
      entry.result = { ...await snapshot(), checkpoints }
      entry.stage = 'complete'; entry.status = 'complete'
      return entry
    }
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
    entry.stage = 'verify layout and public data updates'
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
    if (values.layout) {
      const lanes = []
      for (const [engine, name] of [['webgl', 'reference'], ['webgl', 'repeat'], ['webgpu', 'candidate']]) {
        lanes.push(await run(url, kind, engine, name))
      }
      const rows = []
      for (const [i, reference] of (lanes[0].result?.checkpoints ?? []).entries()) {
        const file = name => join(capture, kind, `${name}-${reference.step}.f32`)
        for (const lane of lanes.slice(1)) {
          const probe = lane.result?.checkpoints?.[i]
          if (!probe || reference.step !== probe.step) continue
          if (lane.result.input !== lanes[0].result.input) throw new Error('Layout comparison used different public buffers or settings')
          const rmsFraction = await comparePositions(file('reference'), await readFile(file(lane.name)), reference.motion.radius)
          const radiusFraction = Math.abs(probe.motion.radius - reference.motion.radius) / reference.motion.radius
          const retentionLoss = Math.max(...reference.quality.communities.map((group, index) => group.retainedFraction - probe.quality.communities[index].retainedFraction))
          const within = rmsFraction < 0.05 && radiusFraction < 0.05 && retentionLoss <= 0.01
          rows.push({ tick: probe.step, lane: lane.name, rmsFraction, radiusFraction, retentionLoss, within })
          if (!within) process.exitCode = 1
        }
      }
      const motion = lanes.map(lane => {
        const rows = lane.result?.checkpoints ?? []
        const first = rows.find(row => row.step === 1)?.motion.rmsDelta
        const last = rows.find(row => row.step === 100)?.motion.rmsDelta
        const cooled = first > 0 && last < first
        if (!cooled) process.exitCode = 1
        return { name: lane.name, first, last, cooled }
      })
      await save(`${kind}/layout-comparison`, { rows, motion, complete: lanes.every(lane => lane.status === 'complete') })
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
