// Run against the clean app built by prepare-packed-webgpu-deck.sh.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { preview } from 'vite'

if (!process.argv[2]) throw new Error('Pass the standalone app directory')
const app = await realpath(process.argv[2])
const site = join(app, 'dist')
await readFile(join(site, 'index.html'))
const report = { packages: {}, cases: [], recovery: [] }
for (const name of ['graph', 'deck-layers']) {
  report.packages[name] = createHash('sha256').update(await readFile(join(app, name + '.tgz'))).digest('hex')
}

const server = await preview({ root: app, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } })
const url = server.resolvedUrls.local[0]

// Read Chrome's composited canvas. This path is independent of Deck's picking pass.
async function sample(page, coords) {
  const png = await page.locator('canvas').screenshot({ scale: 'css' })
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
  const browser = await chromium.launch({ channel: 'chrome', headless: false })
  try {
    const page = await browser.newPage({ viewport: { width: 820, height: 640 }, deviceScaleFactor: 2 })
    page.setDefaultTimeout(30000)
    const errors = observeErrors(page)
    await page.goto(url + '?owner=' + owner)
    await page.waitForFunction(() => window.consumer !== undefined)
    const previousAdapter = await page.evaluate(async () => (await window.consumer).adapter)
    assert.equal(previousAdapter.fallback, false)
    const { checkpoint: before, nextTickAlpha } = await page.evaluate(async () => {
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
    assert.notDeepEqual(before.positions.slice(2), [1082, 1034])
    assert.equal(before.spring, 0.05)
    const checkpointCoords = sessionLocations(before, before.width, before.height)
    const expectedColors = [colors[0], [255, 255, 0, 255], colors[2], black]
    await page.exposeFunction('readRestoredCanvas', () => sample(page, checkpointCoords))
    await page.evaluate(coords => {
      window.inspectRestoredFrame = async pick => {
        const pixels = await window.readRestoredCanvas()
        const picks = []
        for (const [x, y] of coords) picks.push(await pick(x, y))
        window.firstRestoredDraw = { coords, pixels, picks }
      }
    }, checkpointCoords)
    const cdp = await browser.newBrowserCDPSession()
    await cdp.send('Browser.crashGpuProcess')
    await page.waitForFunction(() => window.consumer !== window.preLossConsumer)
    const { recovery, adapter, firstRestoredDraw } = await page.evaluate(async () => {
      const { recovery, adapter } = await window.consumer
      return { recovery, adapter, firstRestoredDraw: window.firstRestoredDraw }
    })
    assert.equal(recovery.reason, 'unknown')
    assert.equal(recovery.distinctDevice, true)
    assert.equal(recovery.previousGraphReleased, true)
    assert.equal(adapter.type, 'webgpu')
    assert.equal(adapter.fallback, false)
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
    assert.notDeepEqual(live.positions.slice(2), before.positions.slice(2))
    const draws = []
    for (const [width, height] of [[480, 288], [512, 320]]) {
      if (width !== 480) await page.evaluate(async ([w, h]) => (await window.consumer).setSize(w, h), [width, height])
      const coords = sessionLocations(live, width, height)
      const pixels = await sample(page, coords)
      assert.deepEqual(pixels, expectedColors, owner + ' restored selection, points and link')
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
    return { owner, previousAdapter, adapter, before, ...recovery, firstRestoredDraw, nextTickAlpha, firstTickAlpha, live, draws, removed, borrowedDeviceReadback }
  } finally {
    await browser.close()
  }
}

let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: false })
  report.chrome = browser.version()
  const cdp = await browser.newBrowserCDPSession()
  report.gpus = (await cdp.send('SystemInfo.getInfo')).gpu.devices.map(d => d.deviceString)
  const cases = [1, 2].flatMap(deviceScaleFactor => ['layer', 'app'].map(owner => ({ owner, deviceScaleFactor })))
  for (const { owner, deviceScaleFactor } of cases) {
    const page = await browser.newPage({ viewport: { width: 820, height: 640 }, deviceScaleFactor })
    page.setDefaultTimeout(25000)
    const errors = observeErrors(page)
    await page.goto(url + '?owner=' + owner)
    await page.waitForFunction(() => window.consumer !== undefined)
    const info = await page.evaluate(async () => (await window.consumer).adapter)
    assert.equal(info.type, 'webgpu')
    assert.equal(info.fallback, false, 'Expected a native WebGPU adapter')
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
      const pixels = await sample(page, coords)
      assert.deepEqual(pixels, expectedColors, `${owner} draw at ${width}×${height}, display DPR ${deviceScaleFactor}`)
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
    assert.deepEqual(await sample(page, coords), coords.map(() => black), owner + ' draw after removal')
    assert.deepEqual(await readPicks(page, coords), coords.map(() => null), owner + ' picks after removal')
    const borrowedDeviceReadback = await page.evaluate(async () => (await window.consumer).finish())
    assert.deepEqual(borrowedDeviceReadback, [17, 33, 65, 129])
    await page.evaluate(() => new Promise(requestAnimationFrame))
    assert.deepEqual(errors, [], owner + ' browser errors')
    report.cases.push({ ...result, removed, borrowedDeviceReadback })
    await page.close()
    console.error(`${owner} passed drawing, picking, resize and teardown at display DPR ${deviceScaleFactor}`)
  }
  await browser.close()
  for (const owner of ['layer', 'app']) {
    report.recovery.push(await verifyRecovery(owner))
    console.error(owner + ' restored the live session after Chrome GPU process loss')
  }
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
