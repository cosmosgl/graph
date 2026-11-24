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
const report = { packages: {}, cases: [] }
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
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error' || /GPUValidationError|validation error|invalid command buffer/i.test(message.text())) {
        errors.push(message.text())
        console.error(message.text())
      }
    })
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
      const expected = [['point', 0, 'left'], ['point', 1, 'right'], ['link', 0, 'edge']]
        .map(([kind, index, record]) => ({
          kind, index, layer: 'cosmos', record: owner === 'layer' ? record : null, originalRecord: owner === 'layer',
        }))
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
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
