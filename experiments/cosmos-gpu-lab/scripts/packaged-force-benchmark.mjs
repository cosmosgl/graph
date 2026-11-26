import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { cpus, loadavg } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { captureBenchmarkSource, sha256 } from './benchmark-source.mjs'
import { installWorkflowTrace } from './force-workflow-trace.mjs'
import { calibrate, compare, formatComparison } from './migration-results.mjs'

const lab = fileURLToPath(new URL('../', import.meta.url))
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const { values } = parseArgs({ options: {
  fixture: { type: 'string' }, points: { type: 'string', default: '8192' }, smoke: { type: 'boolean' }, layout: { type: 'boolean' },
  composed: { type: 'boolean' }, 'webgl-controls': { type: 'string' }, 'adapter-vendor': { type: 'string' },
  'matched-ticks': { type: 'boolean' }, bundles: { type: 'string' }, 'trace-engine': { type: 'string' },
} })
const matched = !!values['matched-ticks']
const useBundleCopies = matched || !!values.bundles
const traceEngine = values['trace-engine']
if (traceEngine && (!matched || !values.fixture || !['webgl', 'webgpu'].includes(traceEngine))) {
  throw new Error('Trace one --fixture with --matched-ticks and --trace-engine webgl or webgpu')
}
if (matched && values.layout) throw new Error('Choose either fixed-tick timings or the layout replay')
if (values.composed && !values.layout) throw new Error('Use --composed with --layout for the eight-force fixed-tick replay')
if (values['webgl-controls'] && (!values.layout || values.smoke)) throw new Error('Reuse controls only for a complete fixed-tick replay')
const pointCount = Number(values.points)
if (!Number.isSafeInteger(pointCount) || pointCount < 1026 || pointCount > 1000000) throw new Error('Expected 1,026–1,000,000 points')
const kinds = values.fixture ? [values.fixture] : ['dense', 'hubs']
if (!kinds.every(k => ['dense', 'hubs'].includes(k))) throw new Error('Expected --fixture dense or hubs')
const cpu = cpus()[0]?.model ?? 'unknown'
const vendor = (values['adapter-vendor'] ?? 'apple').toLowerCase()
if (!['apple', 'intel', 'amd', 'nvidia'].includes(vendor)) throw new Error('Expected --adapter-vendor apple, intel, amd or nvidia')
if (!values['adapter-vendor'] && !/Apple M3/i.test(cpu)) throw new Error(`Expected Apple M3, found ${cpu}. Set --adapter-vendor to qualify this device.`)
const root = join(lab, 'captures')
const controlsDir = values['webgl-controls'] ? resolve(root, values['webgl-controls']) : undefined
if (controlsDir && !controlsDir.startsWith(root + sep)) throw new Error('Choose a control run under captures/')
const runId = process.env.LAB_ARTIFACT_RUN || `packaged-force-timing-${new Date().toISOString().replace(/[.:]/g, '-')}`
const capture = resolve(root, runId)
if (!capture.startsWith(root + sep)) throw new Error('Choose a new LAB_ARTIFACT_RUN below captures/')
await mkdir(resolve(capture, '..'), { recursive: true })
await mkdir(capture)
const save = (name, object) => writeFile(join(capture, `${name}.json`), `${JSON.stringify(object, null, 2)}\n`)
const source = await captureBenchmarkSource(repo, lab, capture)
source.luma = {}
const pinned = {}
if (useBundleCopies) {
  const directory = values.bundles ? resolve(root, values.bundles) : null
  if (directory && !directory.startsWith(root + sep)) throw new Error('Choose a saved bundle directory under captures/')
  const defaults = { webgl: join(repo, 'dist/index.min.js'), webgpu: join(repo, 'experiments/graph-webgpu/dist/index.min.js') }
  for (const engine of ['webgl', 'webgpu']) {
    pinned[engine] = await readFile(directory ? join(directory, `${engine}.js`) : defaults[engine])
    await writeFile(join(capture, `${engine}.js`), pinned[engine])
  }
  source.productionSha256 = await sha256(join(capture, 'webgl.js'))
  source.bundlesFrom = directory ? relative(root, directory) : 'workspace distributions'
}
if (controlsDir) {
  const previous = JSON.parse(await readFile(join(controlsDir, 'source.json'), 'utf8'))
  if (source.productionSha256 !== previous.productionSha256) throw new Error('WebGL control bundle hash changed')
  if (cpu !== previous.cpu || vendor !== (previous.adapterVendor ?? 'apple')) throw new Error('WebGL controls used a different CPU or GPU vendor')
  source.webglControls = relative(root, controlsDir)
}
source.webgpuSha256 = await sha256(useBundleCopies ? join(capture, 'webgpu.js') : join(repo, 'experiments/graph-webgpu/dist/index.min.js'))
source.adapterVendor = vendor
source.cpu = cpu
source.node = process.version
source.packageManager = process.env.npm_config_user_agent ?? null
source.arguments = process.argv.slice(2)
await save('source', source)
console.log(`Timing the two packages in ${relative(repo, capture)}`)
const server = await createServer({ root: lab, server: { host: '127.0.0.1', watch: null } })
const metrics = ['Steady frame p95', 'Click p95', 'First click', 'Slowest click', 'Peak tracked memory']
if (pointCount > 8192) {
  if (!matched) metrics.push('Cold startup')
  metrics.push('Point update', 'Topology update', 'Full replacement', 'Resize')
}

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

// Read outside the measured browser interval. macOS reports coarse process-wide
// thermal pressure, distinct from instantaneous GPU clocks or temperature.
function powerState() {
  if (process.platform === 'darwin') {
    try {
      const value = execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
        'ObjC.import("Foundation"); const p = $.NSProcessInfo.processInfo; JSON.stringify([Number(p.thermalState), Boolean(p.isLowPowerModeEnabled)])'],
      { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] })
      const [thermal, lowPower] = JSON.parse(value)
      return { thermal: ['nominal', 'fair', 'serious', 'critical'][thermal], lowPower }
    } catch { /* System diagnostics are optional on restricted hosts. */ }
  }
}

async function run(url, kind, engine, name) {
  const entry = { kind, engine, name, pointCount, stage: 'open', status: 'started', diagnostics: [], result: null }
  if (useBundleCopies) entry.host = { started: new Date().toISOString(), loadBefore: loadavg(), powerBefore: powerState() }
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
    // Serve the exact immutable UMD bytes from this run's archive. Another build
    // can replace either workspace dist long after this browser process starts.
    if (useBundleCopies) await page.route('**/__force_package__.js', route => route.fulfill({ contentType: 'application/javascript', body: pinned[engine] }))
    await page.goto(url)
    await page.bringToFront()
    await page.waitForFunction(() => typeof window.openForceTiming === 'function')
    await page.evaluate(args => window.openForceTiming(...args), [engine, kind, pointCount, !!values.layout, !!values.composed, vendor,
      matched, useBundleCopies ? '/__force_package__.js' : undefined])
    if (!source.luma[engine]) {
      source.luma[engine] = await page.evaluate(() => window.luma.VERSION)
      await save('source', source)
    }
    if (traceEngine) await page.evaluate(installWorkflowTrace)
    const bounds = await page.locator('#graph canvas').boundingBox()
    if (!bounds || bounds.width !== 961 || bounds.height !== 541 || bounds.x < 0 || bounds.y < 0 ||
      bounds.x + bounds.width > 1050 || bounds.y + bounds.height > 680) throw new Error('Canvas not fully visible')
    if (values.layout) {
      entry.result = await snapshot()
      entry.result.checkpoints = []
      for (const tick of values.smoke ? [0, 1] : [0, 1, 4, 8, 16, 31, 32, 99, 100]) {
        entry.stage = `tick ${tick}`
        if (values.composed && tick === 1) {
          const [x, y] = entry.result.pointer.target
          await page.mouse.move(bounds.x + x - 2, bounds.y + y)
          await page.mouse.down({ button: 'right' })
          await page.mouse.move(bounds.x + x, bounds.y + y)
        }
        if (values.composed && tick === 16) await page.mouse.up({ button: 'right' })
        const { positions, ...row } = await page.evaluate(tick => window.forceTiming.checkpoint(tick), tick)
        const coordinates = Buffer.from(positions, 'base64')
        const xyFile = join(capture, kind, `${name}-${tick}.f32`)
        await writeFile(xyFile, coordinates)
        entry.result.checkpoints.push(row)
        await save(`${kind}/${name}`, entry)
        console.log(`${kind} ${name}: tick ${tick}, collision RMS ${row.quality.overlap.rmsDepth.toFixed(3)} (stride ${row.quality.overlap.stride})`)
      }
      if (values.composed && values.smoke) await page.mouse.up({ button: 'right' })
      await page.evaluate(() => window.forceTiming.finish())
      const { checkpoints } = entry.result
      entry.result = { ...await snapshot(), checkpoints }
      if (values.composed) {
        const held = Array.from({ length: values.smoke ? 1 : 8 }, (_, i) => i + 1)
        const { pointer, submittedTicks } = entry.result
        if (!pointer.trusted || pointer.pressed || String(pointer.ticks) !== String(held) || submittedTicks !== checkpoints.at(-1).step) {
          throw new Error(`Unexpected right-button or tick sequence: ${JSON.stringify({ pointer, submittedTicks })}`)
        }
        if (!values.smoke && Math.abs(pointer.alpha - 0.001) > 0.000001) throw new Error(`The 100-tick cooldown ended at alpha ${pointer.alpha}`)
      }
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
      if (traceEngine && i === 0) await page.evaluate(() => { window.forceWorkflowTrace.phase = 'first click' })
      await page.mouse.click(bounds.x + x, bounds.y + y)
      await page.waitForFunction(i => window.forceTiming.snapshot().picked.length === i + 1, i, { timeout: 10000 })
      if (traceEngine && i === 0) await page.evaluate(() => { window.forceWorkflowTrace.phase = '' })
    }
    entry.stage = 'verify layout and public data updates'
    if (traceEngine) await page.evaluate(() => { window.forceWorkflowTrace.phase = 'edits' })
    await page.evaluate(() => window.forceTiming.finish())
    entry.result = await snapshot()
    if (traceEngine) entry.trace = await page.evaluate(() => window.forceWorkflowTrace.events)
    const { picked, quality, steady, refreshMs } = entry.result
    if (matched) {
      const first = values.smoke ? 3 : 8
      const last = first + (values.smoke ? 8 : 48)
      const editTick = last + 2 * picked.length
      if (steady.ticks.some((tick, i) => tick !== first + i) || picked.some((p, i) => p.inputTick !== last + 2 * (i + 1) || p.tick !== p.inputTick) ||
          entry.result.editTick !== editTick || entry.result.submittedTicks !== editTick) throw new Error('Mismatched steady, click or edit ticks')
    }
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
    if (useBundleCopies) Object.assign(entry.host, { ended: new Date().toISOString(), loadAfter: loadavg(), powerAfter: powerState() })
    try { await save(`${kind}/${name}`, entry) } finally { await browser?.close() }
  }
  return entry
}

try {
  await server.listen(0)
  const url = `http://127.0.0.1:${server.httpServer.address().port}/packaged-force-benchmark.html`
  async function runControls(kind) {
    const controls = []
    for (const name of ['control-1', 'control-2']) controls.push(await run(url, kind, 'webgl', name))
    const calibration = calibrate(controls, metrics)
    await save(`${kind}/calibration`, calibration)
    return { controls, calibration }
  }
  const calibrations = new Map()
  for (const kind of kinds) {
    await mkdir(join(capture, kind))
    if (matched && !values.smoke && !traceEngine) calibrations.set(kind, await runControls(kind))
  }
  for (const kind of kinds) {
    if (traceEngine) {
      await run(url, kind, traceEngine, `trace-${traceEngine}`)
      continue
    }
    if (values.smoke) {
      for (const engine of ['webgl', 'webgpu']) await run(url, kind, engine, `smoke-${engine}`)
      continue
    }
    if (values.layout) {
      const lanes = []
      for (const name of ['reference', 'repeat']) {
        const reference = controlsDir ? JSON.parse(await readFile(join(controlsDir, kind, `${name}.json`), 'utf8')) : await run(url, kind, 'webgl', name)
        if (controlsDir && (reference.status !== 'complete' || reference.engine !== 'webgl' || reference.pointCount !== pointCount)) {
          throw new Error(`Invalid stored ${kind} ${name} control`)
        }
        lanes.push(reference)
      }
      const candidate = await run(url, kind, 'webgpu', 'candidate')
      lanes.push(candidate)
      if (controlsDir && candidate.status === 'complete') {
        const original = JSON.parse(await readFile(join(controlsDir, kind, 'candidate.json'), 'utf8'))
        if (!isDeepStrictEqual(original.result?.adapter, candidate.result.adapter)) throw new Error('Saved layout used a different WebGPU adapter')
      }
      const rows = []
      for (const [i, reference] of (lanes[0].result?.checkpoints ?? []).entries()) {
        const file = name => join(name === 'candidate' ? capture : controlsDir ?? capture, kind, `${name}-${reference.step}.f32`)
        for (const lane of lanes.slice(1)) {
          const probe = lane.result?.checkpoints?.[i]
          if (!probe || reference.step !== probe.step) continue
          if (lane.result.input !== lanes[0].result.input || lane.browser !== lanes[0].browser) throw new Error('Layout comparison used different inputs, settings or browser versions')
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
    const { controls, calibration } = calibrations.get(kind) ?? await runControls(kind)
    const pairs = []
    for (const [index, order] of [['webgl', 'webgpu'], ['webgpu', 'webgl']].entries()) {
      const pair = {}
      for (const engine of order) pair[engine] = await run(url, kind, engine, `pair-${index + 1}-${engine}`)
      pairs.push(pair)
    }
    if (matched) {
      const lanes = [...controls, ...pairs.flatMap(pair => [pair.webgl, pair.webgpu])].filter(lane => lane.status === 'complete')
      if (new Set(lanes.map(lane => lane.result.input)).size > 1 || new Set(lanes.map(lane => lane.browser)).size > 1) {
        throw new Error('The matched controls and paired trials used different inputs or browsers')
      }
    }
    const rows = compare(pairs, calibration)
    await save(`${kind}/comparison`, rows)
    console.log(formatComparison(rows))
  }
} finally { await server.close() }
