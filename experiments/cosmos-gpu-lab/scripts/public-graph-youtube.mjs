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
  allowPositionals: true,
  options: {
    lasso: { type: 'boolean' }, mode: { type: 'string' }, engine: { type: 'string' }, 'release-ticks': { type: 'string' },
    'draw-tick': { type: 'string' }, 'webgpu-bundle': { type: 'string' },
  },
})
const counts = positionals.length ? positionals.map(Number) : [65536, 1000000]
const linkCounts = new Map([[65536, 432898], [1000000, 2852734]])
assert.ok(counts.every(n => linkCounts.has(n)), 'Use the 65536 or 1000000 point YouTube fixture')
const diagnosticEngine = new Map([['drained', 'webgl'], ['blocking', 'webgl'], ['profile', 'webgpu']]).get(values.mode)
assert.ok(!values.mode || diagnosticEngine || ['correctness', 'timing'].includes(values.mode), 'Unknown YouTube replay mode')
assert.ok(!values.engine || ['webgl', 'webgpu'].includes(values.engine), 'Expected --engine webgl or webgpu')
assert.ok(!diagnosticEngine || !values.engine || values.engine === diagnosticEngine, `The ${values.mode} diagnostic requires ${diagnosticEngine}`)
const cpu = cpus()[0]?.model ?? 'unknown'
assert.match(cpu, /Apple M3/i, 'Requires the native M3 machine')
const boxes = [
  [[115, 54], [846, 487]], [[421, 221], [499, 292]],
  [[92, 137], [316, 434]], [[847, 475], [665, 202]],
]
// A smooth, non-convex 256-vertex gesture. Integer CSS coordinates round-trip
// through Chromium's native input. The driver verifies the entire delivered path.
const paths = boxes.map(([[x0, y0], [x1, y1]]) => {
  const distinct = new Map()
  for (let i = 0; i < 2048; i++) {
    const angle = 2 * Math.PI * i / 2048
    const radius = 0.8 + 0.2 * Math.cos(5 * angle)
    const x = Math.round((x0 + x1 + (x1 - x0) * radius * Math.cos(angle)) / 2)
    const y = Math.round((y0 + y1 + (y1 - y0) * radius * Math.sin(angle)) / 2)
    distinct.set(`${x},${y}`, [x, y])
  }
  const outline = [...distinct.values()]
  assert.ok(outline.length >= 256, 'all requested lasso vertices must occupy distinct CSS pixels')
  return Array.from({ length: 256 }, (_, i) => outline[Math.floor(i * outline.length / 256)])
})
const releaseTicks = values['release-ticks']?.split(',').map(Number)
if (values.lasso) assert.ok(releaseTicks && ['blocking', 'correctness'].includes(values.mode),
  'The long-lasso comparison requires --release-ticks and correctness or blocking mode')
if (releaseTicks) {
  const canTime = values.mode === 'timing' && values.engine === 'webgpu'
  assert.ok(positionals.length === 1 && values.engine && (canTime || ['correctness', 'profile'].includes(values.mode) || (values.lasso && values.mode === 'blocking')),
    '--release-ticks requires one point count and engine for correctness, WebGPU profile or WebGPU timing')
  assert.ok(releaseTicks.length === boxes.length && releaseTicks.every((tick, i) =>
    Number.isSafeInteger(tick) && tick >= 4 && (!i || tick > releaseTicks[i - 1])),
  'Supply four strictly increasing integer release ticks starting at 4 or later')
}
const drawTick = values['draw-tick'] === undefined ? null : Number(values['draw-tick'])
if (drawTick !== null) {
  assert.ok(values.mode === 'profile' && values.engine === 'webgpu' && releaseTicks, '--draw-tick requires a WebGPU profile with --release-ticks')
  assert.ok(Number.isSafeInteger(drawTick) && drawTick > releaseTicks.at(-1) + 5, 'Allow at least six ticks after the last release')
}
const viewport = { width: 1050, height: 680 }
const captureRoot = resolve(lab, 'captures')
await mkdir(captureRoot, { recursive: true })
const capture = await mkdtemp(resolve(captureRoot, 'public-graph-youtube-'))
console.log(`Capture: ${capture}`)
const source = await captureBenchmarkSource(root, lab, capture)
const packagedWebGPU = resolve(root, 'experiments/graph-webgpu/dist/index.min.js')
const selectedWebGPU = values['webgpu-bundle'] ? resolve(values['webgpu-bundle']) : packagedWebGPU
const result = {
  source,
  bundles: {
    webgl: source.productionSha256,
    webgpu: await sha256(selectedWebGPU),
  },
  fixtureSha256: await sha256(resolve(captureRoot, 'fixtures/youtube-million.bin')),
  cpu, node: process.version, arguments: process.argv.slice(2), boxes, ...(values.lasso ? { paths } : {}), counts, runs: [],
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
  plugins: selectedWebGPU === packagedWebGPU ? [] : [{
    name: 'replay-captured-webgpu-package',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer && source.endsWith('?url') && resolve(dirname(importer), source.slice(0, -4)) === packagedWebGPU) {
        return selectedWebGPU + '?url'
      }
    },
  }],
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
  const [from, to] = values.lasso ? [paths[index][0], paths[index].at(-1)] : boxes[index]
  if (values.lasso) assert.deepEqual(sample.path, paths[index], 'native lasso path differs from the requested vertices')
  assert.deepEqual(sample.from, from, 'pointerdown coordinates')
  assert.deepEqual(sample.to, to, 'pointerup coordinates')
  const vertices = values.lasso ? paths[index] : boxes[index]
  const xs = vertices.map(([x]) => x)
  const ys = vertices.map(([, y]) => y)
  const expected = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]]
  assert.deepEqual(sample.rect, expected)
  assert.ok(sample.trusted && sample.visible, 'native visible pointer release required')
  assert.equal(sample.zoom, 0.25)
  assert.ok(Math.abs(sample.center[0] - 480.5) < 0.01 && Math.abs(sample.center[1] - 270.5) < 0.01, 'camera moved during selection')
  assert.ok(sample.tickAtRelease >= 4 && sample.tickAtRelease > previousTick, 'graph did not advance between releases')
  if (releaseTicks) assert.equal(sample.tickAtRelease, releaseTicks[index], 'native pointerup missed its requested simulation tick')
  if (mode === 'profile') {
    assert.equal(sample.profile?.frameTickAtRelease, sample.tickAtRelease, 'queue markers came from a different frame')
    assert.ok(sample.profile.frameAgeAtReleaseMs >= 0, 'frame was submitted after release')
    assert.ok(sample.profile.drawDoneAfterReleaseMs >= sample.profile.stepDoneAfterReleaseMs, 'draw acknowledged before the step')
  }
  const { selectionReadyMs, labelReadyMs, readbackReadyMs } = sample.timings
  assert.ok([selectionReadyMs, labelReadyMs, readbackReadyMs].every(ms => Number.isFinite(ms) && ms >= 0), 'missing readback timestamps')
  assert.ok(readbackReadyMs + 0.01 >= Math.max(selectionReadyMs, labelReadyMs), 'readback phase ended before both reads settled')
  assert.deepEqual(sample.errors, [], 'one or more release stages failed')
  assert.equal(sample.ordered, true)
  assert.equal(sample.labels, 1000)
  const expectsOracle = mode !== 'timing' && mode !== 'profile'
  assert.equal(sample.verified, expectsOracle)
  if (expectsOracle) {
    assert.deepEqual([sample.missing, sample.extra, sample.wrongLabels], [0, 0, 0], 'release snapshot mismatch')
  }
  if (mode === 'profile') {
    for (const key of ['unacknowledgedFramesAtRelease', 'unacknowledgedFramesBeforeHighlight']) {
      assert.ok(Number.isInteger(sample.profile[key]) && sample.profile[key] >= 0, `missing frame count ${key}`)
    }
    for (const key of ['queueAheadAtReleaseMs', 'queueAheadBeforeHighlightMs', 'throughHighlightWritesMs', 'highlightedFrameAfterWritesMs']) {
      assert.ok(Number.isFinite(sample.profile[key]), `missing queue profile ${key}`)
    }
  }
  const stages = ['selectionReadMs', 'labelReadMs', 'highlightUpdateMs', 'labelRedrawMs', 'presentationMs', 'highlightFrameMs', 'feedbackWithHighlightMs']
  if (mode === 'drained') stages.push('drainMs')
  for (const key of stages) {
    assert.ok(Number.isFinite(sample.timings[key]) && sample.timings[key] >= 0, `missing ${key}`)
  }
}

async function captureFrozenCanvas(page, file) {
  // Snap the crop to an integral origin. Chrome's enclosing screenshot rect otherwise includes
  // up to an extra CSS pixel above/below a canvas positioned after a fractional-height header.
  await page.addStyleTag({ content: `
    #surface { position: fixed !important; top: 0 !important; left: 0 !important; z-index: 10000 }
    #surface > :not(#graph), #graph > :not(canvas) { visibility: hidden !important }
  ` })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const png = await page.locator('#graph canvas').screenshot({ path: file })
  // Hash decoded RGBA so encoder/compression changes do not change the color comparison.
  const image = await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const { width, height } = bitmap
    const ctx = new OffscreenCanvas(width, height).getContext('2d')
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const rgba = ctx.getImageData(0, 0, width, height).data
    const pixels = new Uint32Array(rgba.buffer)
    let differentFromCorner = 0
    const colors = new Set()
    for (const color of pixels) {
      if (color !== pixels[0]) differentFromCorner++
      if (colors.size < 256) colors.add(color)
    }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', rgba.buffer))
    const rgbaSha256 = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
    return { width, height, differentFromCorner, distinctColorsUpTo256: colors.size, rgbaSha256 }
  }, png.toString('base64'))
  return { ...image, pngSha256: await sha256(file) }
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
    const metadata = await page.evaluate(async ({ count, mode, engine, lassoTicks }) => {
      const { openYoutubeCheck } = await import('/public-youtube.js')
      document.querySelector('#stage').textContent = `${engine} Graph · ${count.toLocaleString()} points`
      window.publicYoutube = await openYoutubeCheck(count, engine, mode, lassoTicks)
      const session = window.publicYoutube
      return { device: session.info, links: session.links, input: session.input, dpr: devicePixelRatio }
    }, { count, mode, engine, lassoTicks: values.lasso ? releaseTicks : undefined })
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
    for (const [index, box] of boxes.entries()) {
      const path = values.lasso ? paths[index] : undefined
      const [from, to] = path ? [path[0], path.at(-1)] : box
      const entry = { index, from, to }
      if (releaseTicks) entry.targetTick = releaseTicks[index]
      run.samples.push(entry)
      watchdog(`drag ${index + 1}`, 90000)
      try {
        // For a tick-matched replay perform pointerdown and all moves early; the wait is before pointerup.
        if (!releaseTicks) await page.waitForFunction(tick => window.publicYoutube.tick > tick, previousTick, { timeout: 60000 })
        await page.mouse.move(bounds.x + from[0], bounds.y + from[1])
        await page.mouse.down()
        if (path) {
          for (const [x, y] of path.slice(1)) await page.mouse.move(bounds.x + x, bounds.y + y)
        } else await page.mouse.move(bounds.x + to[0], bounds.y + to[1], { steps: 4 })
        if (releaseTicks) {
          entry.tickAfterMove = await page.evaluate(() => window.publicYoutube.tick)
          await page.waitForFunction(tick => window.publicYoutube.tick >= tick, releaseTicks[index], { polling: 5, timeout: 60000 })
        }
        await page.mouse.up()
        const sample = await page.evaluate(index => window.publicYoutube.result(index), index)
        assert.ok(sample, 'pointerup produced no release sample')
        Object.assign(entry, sample)
        if (mode !== 'timing' && mode !== 'profile') {
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
    if (drawTick !== null) {
      watchdog('frozen draw comparison', 90000)
      run.frozenDraw = await page.evaluate(tick => window.publicYoutube.frozenDraw(tick), drawTick)
      assert.equal(run.frozenDraw.tick, drawTick)
      assert.equal(run.frozenDraw.coordinates, count * 2)
      assert.equal(run.frozenDraw.highlights.count, run.samples.at(-1).selected, 'frozen highlight count differs from final release')
      const filename = `${name}-tick-${drawTick}-canvas.png`
      run.frozenDraw.image = { filename, ...await captureFrozenCanvas(page, resolve(capture, filename)) }
      const image = run.frozenDraw.image
      assert.deepEqual([image.width, image.height], [1922, 1082], 'frozen graph canvas has an unexpected crop')
      assert.ok(image.differentFromCorner > 1000 && image.distinctColorsUpTo256 > 2, 'frozen graph canvas looks empty')
      assert.equal(await page.evaluate(() => window.publicYoutube.tick), drawTick, 'layout moved while capturing canvas')
    } else if (mode === 'profile') {
      watchdog('isolated simulation and drawing', 90000)
      const controls = await page.evaluate(async () => ({
        isolatedFromTick: window.publicYoutube.tick,
        isolatedCosts: await window.publicYoutube.isolatedCosts(),
      }))
      Object.assign(run, controls)
    }
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
    const schedule = diagnosticEngine ? [[values.mode, 1, [diagnosticEngine]]] : [
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
