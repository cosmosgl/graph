import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { cpus } from 'node:os'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { build } from 'vite'
import { captureBenchmarkSource, sha256 } from './benchmark-source.mjs'

const lab = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(lab, '../..')
const { values, positionals } = parseArgs({
  allowPositionals: true, options: { mode: { type: 'string' }, engine: { type: 'string' } },
})
const counts = positionals.length ? positionals.map(Number) : [65536, 1000000]
const linkCounts = new Map([[65536, 432898], [1000000, 2852734]])
assert.ok(counts.every(n => linkCounts.has(n)), 'Use the 65536 or 1000000 point YouTube fixture')
const diagnosticModes = ['drained', 'blocking']
const diagnostic = diagnosticModes.includes(values.mode)
assert.ok(!values.mode || ['correctness', 'timing', ...diagnosticModes].includes(values.mode), 'Expected --mode correctness, timing, drained or blocking')
assert.ok(!values.engine || ['webgl', 'webgpu'].includes(values.engine), 'Expected --engine webgl or webgpu')
assert.ok(!diagnostic || values.engine !== 'webgpu', 'The drained and blocking diagnostics require WebGL')
const cpu = cpus()[0]?.model ?? 'unknown'
assert.match(cpu, /Apple M3/i, 'Requires the native M3 machine')
const boxes = [
  [[115, 54], [846, 487]], [[421, 221], [499, 292]],
  [[92, 137], [316, 434]], [[847, 475], [665, 202]],
]
const viewport = { width: 1050, height: 680 }
const captureRoot = resolve(lab, 'captures')
await mkdir(captureRoot, { recursive: true })
const capture = await mkdtemp(resolve(captureRoot, 'public-graph-youtube-'))
console.log(`Capture: ${capture}`)
const source = await captureBenchmarkSource(root, lab, capture)
const result = {
  source,
  bundles: {
    webgl: source.productionSha256,
    webgpu: await sha256(resolve(root, 'experiments/graph-webgpu/dist/index.min.js')),
  },
  fixtureSha256: await sha256(resolve(captureRoot, 'fixtures/youtube-million.bin')),
  cpu, node: process.version, arguments: process.argv.slice(2), boxes, counts, runs: [],
}
assert.equal(result.fixtureSha256, '1b4f834c6acf374905934cc4fd65ded5ef8116fd73016db5e15ee8177da0f8b5', 'unexpected SNAP YouTube fixture')
async function save() {
  const file = resolve(capture, 'result.json')
  await writeFile(file + '.tmp', JSON.stringify(result, null, 2) + '\n')
  await rename(file + '.tmp', file)
}
await save()

// Freeze and verify both standalone packages and the prepared SNAP binary before starting Chrome.
const site = resolve(capture, 'site')
await build({
  configFile: false, root: lab, base: './',
  build: { outDir: site, assetsInlineLimit: 0, rollupOptions: {
    input: resolve(lab, 'src/experiments/production-graph-api/youtube-check.ts'),
    preserveEntrySignatures: 'strict', output: { entryFileNames: 'public-youtube.js' },
  } },
})
const assets = await readdir(resolve(site, 'assets'))
const emitted = new Map(await Promise.all(assets.map(async name => [await sha256(resolve(site, 'assets', name)), name])))
for (const digest of [...Object.values(result.bundles), result.fixtureSha256]) {
  assert.ok(emitted.has(digest), `Static capture is missing the asset with checksum ${digest}`)
}
result.assets = Object.fromEntries([...emitted].map(([digest, name]) => [name, digest]))
await writeFile(resolve(site, 'index.html'), (await readFile(resolve(lab, 'migration-benchmark.html'), 'utf8'))
  .replace(/<script type="module".*?<\/script>/, ''))
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname
    const file = resolve(site, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!file.startsWith(site + '/')) { res.writeHead(403).end(); return }
    const data = await readFile(file)
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream')
    res.end(data)
  } catch { res.writeHead(404).end() }
})
await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

function assertAdapter(device, engine) {
  assert.equal(device.type, engine)
  assert.notEqual(device.gpuType, 'cpu')
  if (engine === 'webgl') assert.match(device.renderer ?? '', /Apple M3/i)
  else {
    assert.match(JSON.stringify(device), /apple/i)
    assert.equal(device.fallback, false)
  }
}

function checkSample(sample, index, mode, previousTick) {
  assert.equal(sample.index, index, 'stale or missing release')
  const [from, to] = boxes[index]
  assert.deepEqual(sample.from, from, 'pointerdown coordinates')
  assert.deepEqual(sample.to, to, 'pointerup coordinates')
  const expected = [[Math.min(from[0], to[0]), Math.min(from[1], to[1])], [Math.max(from[0], to[0]), Math.max(from[1], to[1])]]
  assert.deepEqual(sample.rect, expected)
  assert.ok(sample.trusted && sample.visible, 'native visible pointer release required')
  assert.equal(sample.zoom, 0.25)
  assert.ok(Math.abs(sample.center[0] - 480.5) < 0.01 && Math.abs(sample.center[1] - 270.5) < 0.01, 'camera moved during selection')
  assert.ok(sample.tickAtRelease >= 4 && sample.tickAtRelease > previousTick, 'graph did not advance between releases')
  const { selectionReadyMs, labelReadyMs, readbackReadyMs } = sample.timings
  assert.ok([selectionReadyMs, labelReadyMs, readbackReadyMs].every(ms => Number.isFinite(ms) && ms >= 0), 'missing readback timestamps')
  assert.ok(readbackReadyMs + 0.01 >= Math.max(selectionReadyMs, labelReadyMs), 'readback phase ended before both reads settled')
  assert.deepEqual(sample.errors, [], 'one or more release stages failed')
  assert.equal(sample.ordered, true)
  assert.equal(sample.labels, 1000)
  assert.equal(sample.verified, mode !== 'timing')
  if (mode !== 'timing') {
    assert.deepEqual([sample.missing, sample.extra, sample.wrongLabels], [0, 0, 0], 'release snapshot mismatch')
  }
  const stages = ['selectionReadMs', 'labelReadMs', 'highlightUpdateMs', 'labelRedrawMs', 'presentationMs', 'highlightFrameMs', 'feedbackWithHighlightMs']
  if (mode === 'drained') stages.push('drainMs')
  for (const key of stages) {
    assert.ok(Number.isFinite(sample.timings[key]) && sample.timings[key] >= 0, `missing ${key}`)
  }
}

async function replay(count, mode, engine, trial) {
  const name = `${count}-${mode}-${trial}-${engine}`
  const run = { count, mode, engine, trial, stage: 'launch', samples: [], errors: [] }
  result.runs.push(run)
  await save()
  console.log('Starting', name)
  let browser
  let timedOut = false
  let deadline
  // A lost device or wedged renderer must not keep the other sessions from running.
  function watchdog(stage, ms) {
    clearTimeout(deadline)
    run.stage = stage
    deadline = setTimeout(() => {
      timedOut = true
      run.errors.push(`${stage} exceeded ${ms / 1000}s`)
      browser?.close().catch(() => {})
    }, ms)
  }
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: false, timeout: 30000 })
    run.browser = browser.version()
    watchdog('initialize', 180000)
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 })
    page.on('pageerror', err => run.errors.push(err.message))
    await page.goto(origin)
    await page.bringToFront()
    const metadata = await page.evaluate(async ({ count, mode, engine }) => {
      const { openYoutubeCheck } = await import('/public-youtube.js')
      document.querySelector('#stage').textContent = `${engine} Graph · ${count.toLocaleString()} points`
      window.publicYoutube = await openYoutubeCheck(count, engine, mode)
      const session = window.publicYoutube
      return { device: session.info, links: session.links, input: session.input, dpr: devicePixelRatio }
    }, { count, mode, engine })
    Object.assign(run, metadata)
    assertAdapter(run.device, engine)
    assert.equal(run.links, linkCounts.get(count))
    assert.equal(run.dpr, 2)
    for (const key of ['positions', 'links', 'weights', 'pins', 'tracked']) assert.match(run.input[key], /^[a-f0-9]{64}$/)
    const earlier = result.runs.find(item => item !== run && item.count === count && item.input)
    if (earlier) assert.deepEqual(run.input, earlier.input, 'both packages must receive identical arrays')
    const bounds = await page.locator('#surface').boundingBox()
    assert.ok(bounds && bounds.width === 961 && bounds.height === 541 && bounds.x >= 0 && bounds.y >= 0 &&
      bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height, 'graph surface must be fully visible')
    let previousTick = 3
    for (const [index, [from, to]] of boxes.entries()) {
      const entry = { index, from, to }
      run.samples.push(entry)
      watchdog(`drag ${index + 1}`, 90000)
      try {
        await page.waitForFunction(tick => window.publicYoutube.tick > tick, previousTick, { timeout: 60000 })
        await page.mouse.move(bounds.x + from[0], bounds.y + from[1])
        await page.mouse.down()
        await page.mouse.move(bounds.x + to[0], bounds.y + to[1], { steps: 4 })
        await page.mouse.up()
        const sample = await page.evaluate(index => window.publicYoutube.result(index), index)
        assert.ok(sample, 'pointerup produced no release sample')
        Object.assign(entry, sample)
        if (mode !== 'timing') {
          entry.selectionVerified = sample.missing === null || sample.extra === null ? null :
            sample.ordered && sample.missing === 0 && sample.extra === 0
          entry.labelsVerified = sample.wrongLabels === null ? null : sample.labels === 1000 && sample.wrongLabels === 0
        }
        const lastReleaseTick = previousTick
        previousTick = Math.max(previousTick, sample.tickAtRelease)
        checkSample(sample, index, mode, lastReleaseTick)
      } catch (err) {
        entry.failure = String(err)
        run.errors.push(`drag ${index + 1}: ${err}`)
      }
      await save()
      console.log(name, `drag ${index + 1}`, JSON.stringify({
        selected: entry.selected, labels: entry.labels, timings: entry.timings, errors: entry.errors, failure: entry.failure,
      }))
      if (timedOut || page.isClosed() || !browser.isConnected()) throw new Error('Replay browser unavailable for remaining drags')
    }
    watchdog('capture', 30000)
    if (!run.samples.some(sample => sample.selected > 0)) run.errors.push('no nonempty selection returned')
    await page.locator('#surface').screenshot({ path: resolve(capture, name + '.png'), timeout: 20000 })
    run.screenshot = name + '.png'
    await page.evaluate(() => window.publicYoutube.destroy())
    run.stage = 'complete'
  } catch (error) {
    run.errors.push(`${run.stage}: ${error}`)
    console.error(name, run.stage, String(error))
  } finally {
    clearTimeout(deadline)
    await browser?.close()
    await save()
  }
}
try {
  for (const count of counts) {
    const schedule = diagnostic ? [[values.mode, 1, ['webgl']]] : [
      ['correctness', 1, ['webgl', 'webgpu']],
      ['timing', 1, ['webgl', 'webgpu']],
      ['timing', 2, ['webgpu', 'webgl']],
    ]
    for (const [mode, trial, order] of schedule) {
      if (values.mode && values.mode !== mode) continue
      for (const engine of order) {
        if (!values.engine || engine === values.engine) await replay(count, mode, engine, trial)
      }
    }
  }
} finally { await new Promise(resolve => server.close(resolve)); await save() }
console.log('Saved', relative(root, resolve(capture, 'result.json')))
if (result.runs.some(run => run.errors.length)) process.exitCode = 1
