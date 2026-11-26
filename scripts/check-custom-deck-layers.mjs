import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

// Run against the two Vite Storybook dev previews so each loads its own real Deck and Cosmos packages.
const { positionals, values } = parseArgs({ allowPositionals: true, options: { 'story-only': { type: 'boolean' } } })
const [webgl = 'http://127.0.0.1:6006', webgpu = 'http://127.0.0.1:6007'] = positionals
const checkModule = '/@fs' + fileURLToPath(new URL('../integrations/deck-layers/src/stories/custom-deck-layers-check.ts', import.meta.url))
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu'] })

async function readFixturePixels(page, sites) {
  const image = await page.locator('#custom-deck-check canvas').screenshot()
  return page.evaluate(async ({ png, sites }) => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: 'image/png' }))
    const ctx = new OffscreenCanvas(image.width, image.height).getContext('2d')
    ctx.drawImage(image, 0, 0)
    image.close()
    return sites.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3))
  }, { png: image.toString('base64'), sites })
}

const results = []
try {
  for (const [engine, origin] of [['webgl', webgl], ['webgpu', webgpu]]) {
    const page = await browser.newPage({ viewport: { width: 720, height: 480 }, deviceScaleFactor: 1 })
    const errors = []
    await page.addInitScript(() => {
      const requestDevice = window.GPUAdapter?.prototype.requestDevice
      window.customDevices = []
      if (requestDevice) GPUAdapter.prototype.requestDevice = async function (...args) {
        const device = await requestDevice.apply(this, args)
        const record = { vendor: this.info.vendor, fallback: this.info.isFallbackAdapter, destroyed: false }
        window.customDevices.push(record)
        device.lost.then(reason => { record.destroyed = reason.reason === 'destroyed' })
        return device
      }
    })
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }))
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error' || /GPUValidationError|error while parsing WGSL/i.test(m.text())) errors.push(m.text()) })
    try {
      // The actual story must initialize its 10,000 moving points using the same custom programs.
      await page.goto(`${origin}/iframe.html?id=examples-integrations--custom-deck-layers&viewMode=story`)
      await page.locator('.status').filter({ hasText: /10,000 points.*custom deck layers/ }).waitFor()
      await page.getByText('Pause', { exact: true }).click()
      await page.locator('.status').filter({ hasText: 'paused' }).waitFor()
      // The original story uses Math.random. Pick an actually painted pixel in each preview.
      const canvas = page.locator('#storybook-root canvas').first()
      const sample = await page.evaluate(async png => {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: 'image/png' }))
        const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')
        ctx.drawImage(bitmap, 0, 0)
        const { width, height } = bitmap
        bitmap.close()
        const rgba = ctx.getImageData(0, 0, width, height).data
        let painted = 0
        let site
        for (let y = 50; y < height - 50; y++) {
          for (let x = 60; x < width - 60; x++) {
            const i = 4 * (y * width + x)
            const [r, g, b] = rgba.subarray(i, i + 3)
            if (Math.max(r, g, b) - Math.min(r, g, b) > 80) {
              painted++
              const distance = Math.hypot(x - width / 2, y - height / 2)
              if (!site || distance < site.distance) site = { x, y, distance }
            }
          }
        }
        return { painted, site }
      }, (await canvas.screenshot()).toString('base64'))
      assert.ok(sample.painted > 20 && sample.site, `${engine} real-story painted point/link pixels`)
      const box = await canvas.boundingBox()
      await page.mouse.move(box.x + sample.site.x, box.y + sample.site.y)
      const hovered = page.locator('.hover').filter({ hasText: /^(point|link) \d+$/ })
      await hovered.waitFor()
      const story = { paintedPixels: sample.painted, hover: await hovered.textContent() }
      if (engine === 'webgpu') {
        const devices = await page.evaluate(() => window.customDevices)
        assert.equal(devices.length, 1)
        assert.equal(devices[0].fallback, false)
        story.vendor = devices[0].vendor
      }
      await page.getByText('Reheat', { exact: true }).click()
      await page.locator('.status').filter({ hasText: 'running' }).waitFor()
      if (values['story-only']) {
        assert.deepEqual(errors, [])
        results.push({ engine, story })
        continue
      }
      // Keep a real loopback document for Vite's local module and HMR requests.
      await page.goto(`${origin}/index.json`)
      const adapter = await page.evaluate(async path => {
        document.body.replaceChildren()
        const { mountCustomDeckCheck } = await import(path)
        window.check = await mountCustomDeckCheck()
        return window.check.adapter
      }, checkModule)
      assert.equal(adapter.type, engine)
      assert.notEqual(adapter.gpuType, 'cpu')
      const frames = []
      for (const moved of [false, true]) {
        const data = await page.evaluate(async move => {
          if (move) window.check.step()
          return window.check.read()
        }, moved)
        const pixels = await readFixturePixels(page, data.sites)
        const red = [255, 0, 0]
        const green = [0, 255, 0]
        const blue = [0, 0, 255]
        const black = [0, 0, 0]
        assert.deepEqual(pixels, [red, green, blue, moved ? black : green, black], `${engine} ${moved ? 'after step' : 'initial'} drawing`)
        assert.deepEqual(data.picks, [['points', 0], ['points', 1], ['links', 1], moved ? null : ['points', 1], null], `${engine} custom picks`)
        assert.deepEqual(data.xy.slice(0, 2), [952, 1000])
        frames.push({ ...data, pixels })
      }
      assert.ok(frames[1].xy[2] < 1048 && frames[1].xy[3] < 1050 && frames[1].xy[3] > 1000)
      const sites = frames[1].sites
      const fixtureCanvas = await page.locator('#custom-deck-check canvas').boundingBox()
      for (const [index, expected] of [[1, [[255, 255, 0], [0, 0, 255]]], [2, [[0, 255, 0], [255, 255, 0]]]]) {
        const [x, y] = sites[index]
        await page.mouse.move(fixtureCanvas.x + x, fixtureCanvas.y + y)
        let colors
        const deadline = Date.now() + 3000
        do {
          colors = await readFixturePixels(page, [sites[1], sites[2]])
        } while (JSON.stringify(colors) !== JSON.stringify(expected) && Date.now() < deadline)
        assert.deepEqual(colors, expected, `${engine} auto-highlight on ${index === 1 ? 'point' : 'link'} 1`)
      }
      await page.evaluate(() => window.check.destroy())
      if (engine === 'webgpu') {
        await page.waitForFunction(() => window.customDevices.length === 1 && window.customDevices[0].destroyed)
        const [device] = await page.evaluate(() => window.customDevices)
        assert.equal(device.fallback, false)
        adapter.fallback = device.fallback
        adapter.destroyed = device.destroyed
      }
      assert.deepEqual(errors, [])
      results.push({ engine, adapter, story, frames, pointAndLinkAutoHighlight: true })
    } catch (error) {
      console.error(engine, errors.slice(0, 8), await page.locator('body').innerText().catch(() => ''))
      throw error
    } finally {
      await page.close()
    }
  }
  if (!values['story-only']) assert.deepEqual(results[0].frames, results[1].frames, 'WebGL and WebGPU probes and coordinates')
  console.log(JSON.stringify(results, null, 2))
} finally { await browser.close() }
