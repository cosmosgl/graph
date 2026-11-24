// Start both dev Storybooks and build the standalone packages before running this driver.
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { captureBenchmarkSource, sha256 } from './benchmark-source.mjs'
import { expectedLassoMeshHash, installLassoFixture, lassoForceSeed, lassoMeshSeed } from './lasso-story-fixture.mjs'

const lab = fileURLToPath(new URL('../', import.meta.url))
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const { values } = parseArgs({ options: {
  'webgl-url': { type: 'string', default: 'http://127.0.0.1:6006' },
  'webgpu-url': { type: 'string', default: 'http://127.0.0.1:6007' },
  'webgl-bundle': { type: 'string', default: join(repo, 'dist/index.min.js') },
  'webgpu-bundle': { type: 'string', default: join(repo, 'experiments/graph-webgpu/dist/index.min.js') },
  'before-bundle': { type: 'string' }, 'before-revision': { type: 'string' }, smoke: { type: 'boolean' },
} })
const captureRoot = join(lab, 'captures')
await mkdir(captureRoot, { recursive: true })
const capture = await mkdtemp(join(captureRoot, 'lasso-timing-'))
console.log(capture)
const save = (name, value) => writeFile(join(capture, name + '.json'), JSON.stringify(value, null, 2) + '\n')
const lanes = ['webgl', 'webgpu', ...(values['before-bundle'] ? ['before'] : [])]
const orders = lanes.length === 3 ? [['webgl', 'webgpu', 'before'], ['webgpu', 'before', 'webgl'], ['before', 'webgl', 'webgpu']] :
  [['webgl', 'webgpu'], ['webgpu', 'webgl']]
const viewport = { width: 680, height: 536 }
const settled = values.smoke ? 6 : 240
const samples = values.smoke ? 3 : 24
const bundles = {}
for (const lane of lanes) {
  const file = join(capture, lane + '.js')
  await copyFile(resolve(values[lane + '-bundle']), file)
  bundles[lane] = { file, sha256: await sha256(file) }
}

const source = await captureBenchmarkSource(repo, lab, capture)
const browser = await chromium.launch({ channel: 'chrome', headless: false })
const runs = []
try {
  const cdp = await browser.newBrowserCDPSession()
  const devices = (await cdp.send('SystemInfo.getInfo')).gpu.devices.map(d => d.deviceString)
  assert.ok(devices.some(d => /Apple M3/.test(d)), 'Run on the native M3')
  await save('manifest', {
    source, chrome: browser.version(), devices, bundles, beforeRevision: values['before-revision'], viewport, dpr: 1,
    meshSeed: lassoMeshSeed, forceSeed: lassoForceSeed, expectedLassoMeshHash, samples, settled, orders,
    smoke: !!values.smoke, command: process.argv.slice(2),
  })

  async function run(lane, mode, block) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    const timer = setTimeout(() => page.close().catch(() => {}), 120000)
    try {
      await installLassoFixture(page)
      const scriptUrl = '/__lab_lasso_' + bundles[lane].sha256 + '.js'
      await page.route('**' + scriptUrl, route => route.fulfill({ path: bundles[lane].file, contentType: 'text/javascript' }))
      // Every story import resolves to the same standalone package, including
      // helpers that only import an enum or color converter. Loading a second
      // copy of luma through any of these helpers would invalidate the run.
      let loadedPackage = false
      await page.route(/^https?:\/\/[^/]+\/(?:experiments\/graph-webgpu\/)?src\/index\.ts(?:\?|$)/, async route => {
        if (new URL(route.request().url()).searchParams.has('raw')) return route.fallback()
        loadedPackage = true
        await route.fulfill({ contentType: 'text/javascript', body: `
          await (window.lassoPackageReady ??= new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.onload = resolve; script.onerror = () => reject(new Error('Standalone package failed to load'));
            script.src = ${JSON.stringify(scriptUrl)}; document.head.append(script);
          }));
          export const { Graph, GraphSimulation, PointShape, LinkStyle, getRgbaColor, defaultConfigValues } = window.Cosmos;` })
      })
      await page.addInitScript(({ mode, lastTick }) => {
        const bench = window.lassoTiming = { tick: 0, times: [], hidden: false }
        document.addEventListener('visibilitychange', () => { bench.hidden ||= document.hidden })
        window.prepareLassoProps = props => ({
          ...props, enableRenderLoop: mode === 'auto',
          onSimulationTick(...args) {
            ++bench.tick
            if (mode === 'auto') {
              bench.times.push(performance.now())
              if (bench.tick === lastTick) window.lassoFixture.graph.pause()
            }
            props.onSimulationTick?.(...args)
          },
        })
      }, { mode, lastTick: settled + samples })
      await page.bringToFront()
      const url = lane === 'webgl' ? values['webgl-url'] : values['webgpu-url']
      await page.goto(new URL('/iframe.html?id=examples-interaction--lasso-selection&viewMode=story', url).href, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => window.lassoFixture?.graph.isReady)
      if (mode === 'auto') {
        await page.waitForFunction(n => window.lassoTiming.tick >= n, settled + samples, { polling: 100, timeout: 100000 })
      }
      const record = await page.evaluate(measureGraph, { mode, samples, settled })
      assert.deepEqual(errors, [])
      assert.ok(loadedPackage, 'Story did not request the package facade')
      assert.equal(record.initialHash, expectedLassoMeshHash)
      assert.equal(record.seed, lassoForceSeed)
      assert.equal(record.zoom, 0.4)
      assert.deepEqual(record.center, [viewport.width / 2, viewport.height / 2])
      assert.deepEqual(record.canvas, [viewport.width, viewport.height])
      assert.equal(record.adapter.type, lane === 'webgl' ? 'webgl' : 'webgpu')
      assert.match(JSON.stringify(record.adapter), /apple/i)
      assert.notEqual(record.adapter.gpuType, 'cpu')
      if (lane !== 'webgl') assert.equal(record.adapter.fallback, false)
      assert.equal(record.hidden, false)
      if (mode !== 'auto') {
        const expectedFirstRadius = { webgl: 3265.6381, webgpu: 3265.6425, before: 2859.6797 }[lane]
        assert.ok(Math.abs(record.positions[1].radius90 - expectedFirstRadius) < 0.1, 'Unexpected first expansion')
      }
      const entry = { lane, mode, block, ...record }
      await save(`${block}-${lane}-${mode}`, entry)
      console.log(`${block} ${lane} ${mode}`)
      if (mode !== 'warmup') runs.push(entry)
    } catch (error) {
      const body = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '')
      const failure = { lane, mode, block, message: String(error), errors, body: body.slice(0, 1500) }
      await save('failure', failure)
      throw new Error(JSON.stringify(failure), { cause: error })
    } finally { clearTimeout(timer); await page.close() }
  }
  for (const lane of lanes) await run(lane, 'warmup', 0)
  for (const [i, order] of (values.smoke ? orders.slice(0, 1) : orders).entries()) {
    for (const lane of order) {
      const modes = ['split', 'combined', 'auto']
      if (lane === 'webgpu') modes.push('repulsion-off')
      if (i % 2) modes.reverse()
      for (const mode of modes) await run(lane, mode, i + 1)
      const manual = runs.filter(r => r.lane === lane && r.block === i + 1 && r.mode !== 'auto')
      assert.equal(new Set(manual.map(r => r.positions[settled].hash)).size, 1, 'All manual siblings must enter the settled window at identical positions')
    }
  }
  const rows = summarize(runs)
  await save('summary', rows)
  console.table(rows.filter(r => r.block === 'all' && r.phase === 'settled'))
} finally { await browser.close() }

async function measureGraph({ mode, samples, settled }) {
  const { graph, initial } = window.lassoFixture
  const bench = window.lassoTiming
  if (graph.constructor !== window.Cosmos.Graph) throw new Error('Story did not instantiate the archived package')
  const digest = async xy => {
    const bytes = new Uint8Array(xy.buffer, xy.byteOffset, xy.byteLength)
    const hash = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('')
  }
  const device = graph.simulation.device
  const canvas = document.querySelector('#storybook-root canvas')
  const stats = {
    initialHash: await digest(initial), adapter: device.info, zoom: graph.getZoomLevel(), seed: graph.config.randomSeed,
    center: graph.spaceToScreenPosition([2048, 2048]), canvas: [canvas.width, canvas.height], rows: [], positions: {}, hidden: false,
  }
  if (initial.length !== 45000) throw new Error('Unexpected graph size')
  const rows = stats.rows
  async function snapshot(tick) {
    const xy = await graph.getPointPositionsAsync()
    if (xy.length !== initial.length || !xy.every(Number.isFinite)) throw new Error('Invalid layout')
    const n = xy.length / 2
    let x = 0, y = 0
    for (let i = 0; i < xy.length; i += 2) { x += xy[i]; y += xy[i + 1] }
    const radii = new Float64Array(n)
    for (let i = 0; i < n; i++) radii[i] = Math.hypot(xy[2 * i] - x/n, xy[2 * i + 1] - y/n)
    stats.positions[tick] = { hash: await digest(xy), radius90: radii.sort()[Math.floor(0.9*n)] }
  }
  const phaseOf = tick => tick === 1 ? 'first' : tick > settled ? 'settled' : 'expansion'
  if (mode === 'auto') {
    for (let tick = 2; tick <= bench.tick; tick++) {
      if (tick <= samples + 1 || tick > settled) {
        rows.push({ tick, phase: phaseOf(tick), metric: 'tickInterval', ms: bench.times[tick - 1] - bench.times[tick - 2] })
      }
    }
    await snapshot(bench.tick)
  } else {
    if (bench.tick !== 0) throw new Error('Manual scheduling started after tick zero')
    graph.pause()
    // WebGL's luma fence promise polls a timer. Use a posted task to observe
    // its native fence promptly. WebGPU has its own queue-completion promise.
    const gl = device.info.type === 'webgl' ? device.gl : undefined
    const channel = new MessageChannel()
    let task
    channel.port1.onmessage = () => task()
    const complete = gl ? () => new Promise((resolve, reject) => {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
      if (!sync) { reject(new Error('WebGL fence allocation failed')); return }
      gl.flush()
      const poll = () => {
        const status = gl.clientWaitSync(sync, 0, 0)
        if (status === gl.TIMEOUT_EXPIRED) { task = poll; channel.port2.postMessage(0); return }
        gl.deleteSync(sync)
        if (status === gl.WAIT_FAILED) reject(new Error('WebGL fence wait failed'))
        else resolve()
      }
      poll()
    }) : () => device.handle.queue.onSubmittedWorkDone()
    const record = async (tick, phase, metric, action) => {
      const start = performance.now()
      action()
      const submitted = performance.now()
      await complete()
      rows.push({ tick, phase, metric, submitMs: submitted - start, ms: performance.now() - start })
    }
    try {
      graph.renderOneFrame() // Initial paint and camera synchronization with simulation paused.
      await complete()
      for (let i = 0; i < 12; i++) await record(0, 'idle', 'emptyFence', () => {})
      if (mode === 'combined') graph.unpause()
      const lastTick = mode === 'warmup' ? 5 : settled + samples
      for (let tick = 1; tick <= lastTick; tick++) {
        const measured = mode !== 'warmup' && (tick <= samples + 1 || tick > settled)
        if (measured) {
          const phase = phaseOf(tick)
          if (mode === 'combined') {
            await record(tick, phase, 'stepAndDraw', () => graph.renderOneFrame())
          } else {
            await record(tick, phase, 'step', () => graph.step())
            await record(tick, phase, 'draw', () => graph.renderOneFrame())
          }
        } else {
          graph.step()
          // Bound the queue and finish the untimed prefix before the snapshots.
          if (tick % 8 === 0 || tick === settled || tick === lastTick) await complete()
        }
        if (bench.tick !== tick) throw new Error(`Expected tick ${tick}, observed ${bench.tick}`)
        if (tick === 1 || tick === settled) {
          await snapshot(tick)
          if (tick === settled && mode === 'repulsion-off') graph.setConfigPartial({ simulationRepulsion: 0 })
          await complete()
        }
      }
    } finally { channel.port1.close(); channel.port2.close() }
  }
  stats.hidden = bench.hidden || document.hidden
  return stats
}

function summarize(runs) {
  const groups = new Map()
  for (const run of runs) {
    for (const row of run.rows) {
      for (const block of [run.block, 'all']) {
        const key = JSON.stringify([run.lane, run.mode, block, row.phase, row.metric])
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(row)
      }
    }
  }
  return Array.from(groups, ([key, rows]) => {
    const [lane, mode, block, phase, metric] = JSON.parse(key)
    const distribution = field => {
      const values = rows.map(s => s[field]).sort((a, b) => a - b)
      return [
        (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2,
        values[Math.ceil(0.95 * values.length) - 1],
      ]
    }
    const [p50, p95] = distribution('ms')
    const [submitP50, submitP95] = rows[0].submitMs === undefined ? [null, null] : distribution('submitMs')
    return { lane, mode, block, phase, metric, n: rows.length, p50, p95, submitP50, submitP95 }
  })
}
