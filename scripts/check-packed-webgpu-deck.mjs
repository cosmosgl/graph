// Run against the clean app built by prepare-packed-webgpu-deck.sh.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { chromium, firefox, webkit } from 'playwright'
import { preview } from 'vite'
import { swiftShaderArgs } from './chromium-swiftshader.mjs'
import { checkPublicContracts } from './check-packed-deck-contracts.mjs'
import { checkNativeGpu, requestedGpuVendor } from './qualification-adapter.mjs'

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  browser: { type: 'string', default: 'chrome' }, swiftshader: { type: 'boolean' }, ci: { type: 'boolean' },
  points: { type: 'string', default: '2' }, 'adapter-vendor': { type: 'string' },
} })
if (positionals.length !== 1) throw new Error('Pass the standalone app directory')
const app = await realpath(positionals[0])
const pointCount = Number(values.points)
const vendor = requestedGpuVendor(values['adapter-vendor'])
assert.ok([2, 65536].includes(pointCount))
assert.ok(['chrome', 'chromium', 'firefox', 'webkit'].includes(values.browser))
assert.ok(!values.swiftshader || ['chrome', 'chromium'].includes(values.browser))
assert.ok(!values.swiftshader || !vendor, 'Use a native adapter for vendor qualification')
const launch = () => {
  if (values.browser === 'firefox') return firefox.launch({ headless: false })
  if (values.browser === 'webkit') return webkit.launch({ headless: false })
  return chromium.launch({ channel: values.browser, headless: Boolean(values.ci),
    args: values.swiftshader ? swiftShaderArgs : [],
  })
}
function checkAdapter(info) {
  assert.equal(info.type, 'webgpu')
  if (vendor) checkNativeGpu(info, 'webgpu', vendor)
  else if (values.swiftshader) assert.ok(/swiftshader/i.test(info.gpuArchitecture), 'Expected SwiftShader')
  else assert.ok(!info.fallback && info.gpuType !== 'cpu', 'Expected a hardware adapter')
}
function summarize(checkpoint) {
  const { positions, ...fields } = checkpoint
  const xy = Float32Array.from(positions)
  return { ...fields, points: xy.length / 2, positionBytes: xy.byteLength, positionsSha256: createHash('sha256').update(new Uint8Array(xy.buffer)).digest('hex') }
}
const site = join(app, 'dist')
await readFile(join(site, 'index.html'))
const report = { browser: values.browser, swiftshader: Boolean(values.swiftshader), requestedVendor: vendor, pointCount, packages: {}, cases: [], recovery: [] }
for (const name of ['graph', 'deck-layers']) {
  report.packages[name] = createHash('sha256').update(await readFile(join(app, name + '.tgz'))).digest('hex')
}

const server = await preview({ root: app, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } })
const url = server.resolvedUrls.local[0]

// Read Chrome's composited canvas. This path is independent of Deck's picking pass.
async function sample(page, coords) {
  const clip = await page.locator('canvas').boundingBox()
  assert.ok(clip, 'missing Deck canvas')
  const png = await page.screenshot({ scale: 'css', clip })
  return page.evaluate(async ({ png, coords }) => {
    const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    try {
      const ctx = new OffscreenCanvas(image.width, image.height).getContext('2d')
      ctx.drawImage(image, 0, 0)
      return coords.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data])
    } finally { image.close() }
  }, { png: png.toString('base64'), coords })
}

// Submission and compositing are independent on Firefox. Observe the first
// expected paint without asking Deck to draw another frame or changing the scene.
async function waitForPaint(page, coords, expected, label) {
  const deadline = Date.now() + 6000
  let pixels
  do {
    pixels = await sample(page, coords)
    if (isDeepStrictEqual(pixels, expected)) return pixels
    await page.evaluate(() => new Promise(requestAnimationFrame))
  } while (Date.now() < deadline)
  assert.deepEqual(pixels, expected, label)
}
const black = [0, 0, 0, 255]
const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], black]
// flipY:false, zoom 0, eye centered on (1000,1000). The midpoint is on link 0.
function locations(width, height) {
  return [[width / 2 - 60, height / 2 + 18], [width / 2 + 60, height / 2 - 22],
    [width / 2, height / 2 - 2], [8, 8]]
}
const readPicks = (page, coords) => page.evaluate(async coords => {
  const app = await window.consumer
  const hits = []
  for (const [x, y] of coords) hits.push(await app.pick(x, y))
  return hits
}, coords)

function observeErrors(page) {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' || /GPUValidationError|validation error|invalid command buffer/i.test(message.text())) {
      errors.push(message.text())
      console.error(message.text())
    }
  })
  return errors
}

async function checkStandalone(browser) {
  const fromApp = createRequire(join(app, 'package.json'))
  const manifest = fromApp('@cosmos.gl/graph/package.json')
  const cdnFile = fromApp.resolve('@cosmos.gl/graph/' + manifest.jsdelivr)
  assert.equal(manifest.jsdelivr, 'dist/index.min.js')
  assert.equal(fromApp.resolve('@cosmos.gl/graph'), fromApp.resolve('@cosmos.gl/graph/dist/index.js'))
  assert.deepEqual(await readFile(cdnFile), await readFile(join(site, 'standalone/index.min.js')))
  const page = await browser.newPage({ viewport: { width: 600, height: 400 }, deviceScaleFactor: 1 })
  const errors = observeErrors(page)
  const scripts = []
  page.on('request', request => {
    if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname)
  })
  try {
    await page.goto(url + 'standalone/')
    await page.waitForFunction(() => document.querySelector('#hit')?.value === 'Ready')
    const { adapter, positions } = await page.evaluate(async () => {
      const graph = await window.standaloneGraph
      return { adapter: graph.simulation.device.info, positions: Array.from(await graph.getPointPositionsAsync()) }
    })
    checkAdapter(adapter)
    assert.deepEqual(positions, [192, 256, 320, 256])
    const coords = [[64, 80], [192, 80], [128, 80], [8, 8]]
    const pixels = await waitForPaint(page, coords, colors, 'standalone Graph paint')
    const picks = ['Point 0', 'Point 1', 'Link 0', 'Background']
    for (const [i, [x, y]] of coords.entries()) {
      await page.locator('#graph canvas').click({ position: { x, y } })
      await page.waitForFunction(hit => document.querySelector('#hit').value === hit, picks[i])
    }
    await page.evaluate(async () => (await window.standaloneGraph).destroy())
    assert.equal(await page.locator('#graph canvas').count(), 0)
    assert.deepEqual(scripts, ['/standalone/index.min.js'])
    assert.deepEqual(errors, [])
    return { entry: manifest.jsdelivr, adapter, pixels, picks, positions }
  } finally { await page.close() }
}

function expectedPicks(owner) {
  return [['point', 0, 'left'], ['point', 1, 'right'], ['link', 0, 'edge']]
    .map(([kind, index, record]) => ({
      kind, index, layer: 'cosmos', record: owner === 'layer' ? record : null, originalRecord: owner === 'layer',
    })).concat(null)
}

function sessionLocations(session, width, height) {
  const [x0, y0, x1, y1] = session.positions
  const { target, zoom } = session.view
  const scale = 2 ** zoom
  return [[x0, y0], [x1, y1], [(x0 + x1) / 2, (y0 + y1) / 2]]
    .map(([x, y]) => [Math.round(width / 2 + (x - target[0]) * scale), Math.round(height / 2 - (y - target[1]) * scale)])
    .concat([[8, 8]])
}

async function verifyRecovery(owner) {
  // A fresh Chrome process/profile per loss keeps the two GPU process crashes independent.
  const browser = await launch()
  try {
    const page = await browser.newPage({ viewport: { width: 820, height: 640 }, deviceScaleFactor: 2 })
    page.setDefaultTimeout(30000)
    const errors = observeErrors(page)
    await page.goto(url + '?owner=' + owner + '&points=' + pointCount)
    await page.bringToFront()
    await page.waitForFunction(() => window.consumer !== undefined)
    const previousAdapter = await page.evaluate(async () => (await window.consumer).adapter)
    checkAdapter(previousAdapter)
    const { checkpoint: before, checkpointMs, nextTickAlpha } = await page.evaluate(async () => {
      window.preLossConsumer = window.consumer
      const app = await window.consumer
      await app.setSize(480, 288)
      return app.checkpointMovingSession()
    })
    assert.equal(before.running, true)
    assert.ok(before.alpha > 0 && before.alpha < 0.45)
    assert.deepEqual(before.selected, [0])
    assert.deepEqual(before.pins, [0])
    assert.deepEqual(before.view, { target: [1012, 995, 0], zoom: 0.25 })
    assert.deepEqual(before.positions.slice(0, 2), [940, 982])
    assert.equal(before.positions.length, 2 * pointCount)
    assert.notDeepEqual(before.positions.slice(2, 4), [1082, 1034])
    assert.equal(before.spring, 0.05)
    const checkpointCoords = sessionLocations(before, before.width, before.height)
    const expectedColors = [colors[0], [255, 255, 0, 255], colors[2], black]
    await page.exposeFunction('readRestoredCanvas', () => waitForPaint(page, checkpointCoords, expectedColors, owner + ' restored paint'))
    await page.evaluate(coords => {
      window.inspectRestoredFrame = async pick => {
        const pixels = await window.readRestoredCanvas()
        const picks = []
        for (const [x, y] of coords) picks.push(await pick(x, y))
        window.firstRestoredDraw = { coords, pixels, picks }
      }
    }, checkpointCoords)
    const crashProcess = values.browser === 'chrome'
    if (crashProcess) {
      const cdp = await browser.newBrowserCDPSession()
      await cdp.send('Browser.crashGpuProcess')
    } else {
      await page.evaluate(async () => (await window.consumer).simulateDeviceLoss())
    }
    await page.waitForFunction(() => window.consumer !== window.preLossConsumer)
    const { recovery, adapter, firstRestoredDraw } = await page.evaluate(async () => {
      const { recovery, adapter } = await window.consumer
      return { recovery, adapter, firstRestoredDraw: window.firstRestoredDraw }
    })
    assert.equal(recovery.reason, crashProcess ? 'unknown' : 'destroyed')
    assert.equal(recovery.distinctDevice, true)
    assert.equal(recovery.previousGraphReleased, true)
    checkAdapter(adapter)
    assert.deepEqual(recovery.restored, { ...before, running: false })
    assert.deepEqual(firstRestoredDraw.pixels, expectedColors, owner + ' first restored paint')
    assert.deepEqual(firstRestoredDraw.picks, expectedPicks(owner), owner + ' first restored picks')
    // Compare the actual first resumed tick with the uninterrupted device at the same checkpoint.
    const firstTickAlpha = await page.evaluate(async () => {
      const { recovery } = await window.consumer
      const deadline = performance.now() + 10000
      while (recovery.firstTickAlpha === undefined) {
        if (performance.now() > deadline) throw Error('Recovered session did not advance')
        await new Promise(requestAnimationFrame)
      }
      return recovery.firstTickAlpha
    })
    assert.equal(firstTickAlpha, nextTickAlpha)
    // Freeze the live layout so both sizes sample and pick the same points.
    const live = await page.evaluate(async () => (await window.consumer).pauseAndInspect())
    assert.equal(live.running, true)
    assert.ok(live.alpha > 0 && live.alpha < before.alpha)
    assert.deepEqual(live.positions.slice(0, 2), before.positions.slice(0, 2))
    assert.notDeepEqual(live.positions.slice(2, 4), before.positions.slice(2, 4))
    const draws = []
    for (const [width, height] of [[480, 288], [512, 320]]) {
      if (width !== 480) await page.evaluate(async ([w, h]) => (await window.consumer).setSize(w, h), [width, height])
      const coords = sessionLocations(live, width, height)
      const pixels = await waitForPaint(page, coords, expectedColors, owner + ' restored selection, points and link')
      const picks = await readPicks(page, coords)
      assert.deepEqual(picks, expectedPicks(owner))
      draws.push({ width, height, coords, pixels, picks })
    }
    const removed = await page.evaluate(async () => (await window.consumer).remove())
    const supplied = owner === 'app'
    assert.deepEqual(removed, { graphReady: supplied, hasBuffer: supplied, pointAfterEdit: supplied ? [1090, 1040] : null })
    const borrowedDeviceReadback = await page.evaluate(async () => (await window.consumer).finish())
    assert.deepEqual(borrowedDeviceReadback, [17, 33, 65, 129])
    assert.deepEqual(errors, [], owner + ' browser errors during recovery')
    return { owner, previousAdapter, adapter, loss: crashProcess ? 'GPU process crash' : 'device.destroy',
      before: summarize(before), ...recovery, restored: summarize(recovery.restored), checkpointMs,
      firstRestoredDraw, nextTickAlpha, firstTickAlpha, live: summarize(live), draws, removed, borrowedDeviceReadback }
  } finally {
    await browser.close()
  }
}

let browser
try {
  browser = await launch()
  report.version = browser.version()
  report.standalone = await checkStandalone(browser)
  if (values.browser === 'chrome') {
    const cdp = await browser.newBrowserCDPSession()
    report.gpus = (await cdp.send('SystemInfo.getInfo')).gpu.devices.map(d => d.deviceString)
  }
  const cases = [1, 2].flatMap(deviceScaleFactor => ['layer', 'app'].map(owner => ({ owner, deviceScaleFactor })))
  for (const { owner, deviceScaleFactor } of cases) {
    const page = await browser.newPage({ viewport: { width: 820, height: 640 }, deviceScaleFactor })
    page.setDefaultTimeout(25000)
    const errors = observeErrors(page)
    await page.goto(url + '?owner=' + owner + '&points=' + pointCount)
    await page.bringToFront()
    await page.waitForFunction(() => window.consumer !== undefined)
    const info = await page.evaluate(async () => (await window.consumer).adapter)
    checkAdapter(info)
    const result = { owner, deviceScaleFactor, adapter: info, draws: [] }
    for (const [width, height] of [[320, 192], [512, 320]]) {
      // Observe the first frame a visitor sees before any resize or forced redraw.
      if (width === 512) await page.evaluate(async ([w, h]) => (await window.consumer).setSize(w, h), [width, height])
      const coords = locations(width, height)
      const expectedColors = [...colors]
      if (width === 512) {
        coords.push(locations(320, 192)[0])
        expectedColors.push(black)
      }
      const pixels = await waitForPaint(page, coords, expectedColors, `${owner} draw at ${width}×${height}, display DPR ${deviceScaleFactor}`)
      const picks = await readPicks(page, coords)
      const expected = expectedPicks(owner)
      while (expected.length < coords.length) expected.push(null)
      assert.deepEqual(picks, expected, owner + ' picks at ' + width + '×' + height)
      result.draws.push({ width, height, coords, pixels, picks })
    }
    const removed = await page.evaluate(async () => (await window.consumer).remove())
    const supplied = owner === 'app'
    assert.deepEqual(removed, { graphReady: supplied, hasBuffer: supplied, pointAfterEdit: supplied ? [1090, 1040] : null })
    const coords = locations(512, 320)
    await waitForPaint(page, coords, coords.map(() => black), owner + ' draw after removal')
    assert.deepEqual(await readPicks(page, coords), coords.map(() => null), owner + ' picks after removal')
    const borrowedDeviceReadback = await page.evaluate(async () => (await window.consumer).finish())
    assert.deepEqual(borrowedDeviceReadback, [17, 33, 65, 129])
    await page.evaluate(() => new Promise(requestAnimationFrame))
    assert.deepEqual(errors, [], owner + ' browser errors')
    report.cases.push({ ...result, removed, borrowedDeviceReadback })
    await page.close()
    console.error(`${owner} passed drawing, picking, resize and teardown at display DPR ${deviceScaleFactor}`)
  }
  if (values.ci) report.contracts = await checkPublicContracts(browser, url, checkAdapter, observeErrors)
  await browser.close()
  if (!values.ci) {
    for (const owner of ['layer', 'app']) {
      report.recovery.push(await verifyRecovery(owner))
      console.error(owner + ' restored the live session on ' + values.browser)
    }
  }
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
