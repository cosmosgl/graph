import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

const { values } = parseArgs({ options: {
  webgl: { type: 'string', default: 'http://127.0.0.1:6006' },
  webgpu: { type: 'string', default: 'http://127.0.0.1:6007' },
  assets: { type: 'string' }, report: { type: 'string' }, 'adapter-vendor': { type: 'string' },
} })

async function storyIndex(base) {
  const response = await fetch(new URL('index.json', base))
  assert.ok(response.ok, `Storybook index returned ${response.status} at ${base}`)
  const { entries } = await response.json()
  return Object.values(entries).map(({ id, type }) => ({ id, type })).sort((a, b) => a.id.localeCompare(b.id))
}

// An offline run can serve the shared stories' real downloaded fixtures from a directory.
const fixtures = []
if (values.assets) {
  const assets = [
    ['cities.csv', 'text/csv'],
    ['ne_110m_admin_0_countries.geojson', 'application/json'],
    ['performances.json', 'application/json'],
  ]
  for (const [name, contentType] of assets) {
    const path = join(values.assets, name)
    const sha256 = createHash('sha256').update(await readFile(path)).digest('hex')
    fixtures.push({ name, path, contentType, sha256 })
  }
}

async function paintedPixels(page, canvas) {
  // Hide HTML labels and controls so a blank GPU canvas cannot pass on their pixels.
  const png = await canvas.screenshot({
    style: 'body * { visibility: hidden !important } [data-cosmos-test-context] { visibility: visible !important }',
  })
  return page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const scratch = new OffscreenCanvas(image.width, image.height)
    const ctx = scratch.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(image, 0, 0)
    image.close()
    const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height)
    const colors = new Map()
    let mostCommon = 0
    for (const color of new Uint32Array(data.buffer)) {
      const count = (colors.get(color) ?? 0) + 1
      colors.set(color, count)
      mostCommon = Math.max(count, mostCommon)
    }
    return { colors: colors.size, nonBackground: data.length / 4 - mostCommon }
  }, png.toString('base64'))
}

async function checkStory(browser, base, id, engine) {
  const page = await browser.newPage({ viewport: { width: 840, height: 580 }, deviceScaleFactor: 1 })
  page.setDefaultTimeout(20_000)
  const errors = []
  const result = { id, engine, errors, canvases: [] }
  try {
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error' || /GPUValidationError|invalid command buffer/i.test(message.text())) errors.push(message.text())
    })
    for (const fixture of fixtures) {
      await page.route(`**/${fixture.name}`, route => route.fulfill({ path: fixture.path, contentType: fixture.contentType }))
    }
    await page.addInitScript(() => {
      const devices = { WebGL: new Set(), WebGPU: new Set() }
      window.cosmosStoryDevices = devices
      const getContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        const result = getContext.call(this, type, ...args)
        if (result && (type === 'webgl2' || type === 'webgpu')) this.dataset.cosmosTestContext = type
        if (result && type === 'webgl2') {
          const ext = result.getExtension('WEBGL_debug_renderer_info')
          devices.WebGL.add(ext ? result.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown')
        }
        return result
      }
      if (typeof GPUCanvasContext !== 'undefined') {
        const configure = GPUCanvasContext.prototype.configure
        GPUCanvasContext.prototype.configure = function (options) {
          configure.call(this, options)
          const info = options.device.adapterInfo
          devices.WebGPU.add(info?.isFallbackAdapter ? 'software' : info?.vendor || 'unknown')
        }
      }
    })
    await page.goto(new URL(`iframe.html?id=${id}&viewMode=story`, base).href, { waitUntil: 'domcontentloaded' })
    const badge = page.locator('#cosmos-preview-build')
    assert.equal(await badge.getAttribute('data-engine'), engine)
    result.badge = await badge.innerText()
    const root = page.locator('#storybook-root')
    if (id.endsWith('--repulsion-benchmark')) {
      await root.getByText(/^Done\. 12 warmup \+ 40 measured steps/).waitFor({ timeout: 180_000 })
      const rows = (await root.locator('pre').innerText()).split('\n').slice(2)
      result.benchmark = rows.map(row => {
        const match = /^\s*(\d+)\s+([\d.]+)ms\s+(\d+)\s*$/.exec(row)
        assert.ok(match && Number(match[2]) > 0 && Number(match[3]) > 0, row)
        return Number(match[1])
      })
      assert.deepEqual(result.benchmark, [2000, 5000, 20000, 50000, 100000, 200000])
    } else {
      const targets = root.locator(`canvas[data-cosmos-test-context="${engine === 'WebGPU' ? 'webgpu' : 'webgl2'}"]:visible`)
      await targets.first().waitFor()
      for (const canvas of await targets.all()) {
        let paint
        const deadline = Date.now() + 15_000
        do { paint = await paintedPixels(page, canvas) } while (Date.now() < deadline && (paint.colors < 3 || paint.nonBackground < 4))
        assert.ok(paint.colors >= 3 && paint.nonBackground >= 4, 'Empty GPU canvas')
        result.canvases.push(paint)
      }
    }
    result.adapters = await page.evaluate(engine => [...window.cosmosStoryDevices[engine]], engine)
    assert.ok(result.adapters.length > 0, 'The story did not initialize the expected device')
    if (values['adapter-vendor']) {
      for (const adapter of result.adapters) {
        assert.ok(adapter.toLowerCase().includes(values['adapter-vendor'].toLowerCase()), `Unexpected adapter: ${adapter}`)
      }
    }
    assert.deepEqual(errors, [])
  } catch (error) { result.failure = error.message }
  finally { await page.close() }
  return result
}

const [reference, candidate] = await Promise.all([storyIndex(values.webgl), storyIndex(values.webgpu)])
assert.deepEqual(candidate, reference, 'The two Storybooks must expose the same stories and docs')
const stories = reference.filter(entry => entry.type === 'story')
assert.ok(stories.length > 0)
const report = { index: reference, fixtures: fixtures.map(({ name, sha256 }) => ({ name, sha256 })), results: [] }
const browser = await chromium.launch({ channel: 'chrome', headless: false })
try {
  report.chrome = browser.version()
  for (const { id } of stories) {
    for (const [base, engine] of [[values.webgl, 'WebGL'], [values.webgpu, 'WebGPU']]) {
      const result = await checkStory(browser, base, id, engine)
      report.results.push(result)
      console.log(engine, id, result.failure ?? 'passed')
      if (values.report) await writeFile(values.report, JSON.stringify(report, null, 2) + '\n')
    }
  }
} finally { await browser.close() }
const failures = report.results.filter(row => row.failure)
assert.equal(failures.length, 0, failures.map(row => `${row.engine} ${row.id}: ${row.failure}`).join('\n'))
console.log(`Passed all ${stories.length} stories in each preview`)
