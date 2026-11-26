import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

// The same routes and controls run in both previews. Read composited pixels so
// Deck's picking pass or an updating DOM counter cannot stand in for drawing.
const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  engine: { type: 'string' }, story: { type: 'string' }, countries: { type: 'string' },
} })
const [webgl = 'http://127.0.0.1:6006', webgpu = 'http://127.0.0.1:6007'] = positionals
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu'] })
const stories = ['graph-layer', 'big-graph', 'mini-graphs', 'graph-on-map']
const countries = values.countries && await readFile(values.countries)
if (countries) assert.equal(createHash('sha256').update(countries).digest('hex'), '6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f')

async function paint(page, canvas) {
  const png = await canvas.screenshot()
  return page.evaluate(async png => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: 'image/png' }))
    const ctx = new OffscreenCanvas(image.width, image.height).getContext('2d')
    ctx.drawImage(image, 0, 0)
    const { width, height } = image
    image.close()
    const { data } = ctx.getImageData(0, 0, width, height)
    const thumbnails = [0, 0, 0]
    const candidates = []
    let colored = 0, land = 0, labels = 0
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const i = 4 * (y * width + x)
        const r = data[i], g = data[i + 1], b = data[i + 2]
        if (Math.abs(r - 38) + Math.abs(g - 48) + Math.abs(b - 72) < 5) land++
        // Exclude HTML controls and the Storybook stamp from paint and pick samples.
        if (x < 130 && y < 175 || y < 45 || y > height - 45) continue
        if (r > 205 && g > 205 && b > 205 && x < width * 0.76) labels++
        if (Math.max(r, g, b) < 98 || Math.max(r, g, b) - Math.min(r, g, b) < 30) continue
        if (x > 0.80 * width && x < 0.96 * width) {
          for (let n = 0; n < 3; n++) {
            if (y > height * (0.09 + 0.23 * n) && y < height * (0.24 + 0.23 * n)) thumbnails[n]++
          }
        }
        if (x < width * 0.76) {
          colored++
          if (colored % 13 === 0 || !candidates.length) candidates.push([x, y])
        }
      }
    }
    return { colored, land, labels, thumbnails, candidates }
  }, png.toString('base64'))
}

async function checkStory(base, engine, name) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }))
  if (countries) {
    await page.route('https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_110m_admin_0_countries.geojson',
      route => route.fulfill({ contentType: 'application/json', body: countries }))
  }
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' || /GPUValidationError|invalid command buffer/i.test(message.text())) errors.push(message.text())
  })
  await page.addInitScript(() => {
    const original = globalThis.GPUAdapter?.prototype.requestDevice
    window.storyDevices = []
    if (original) GPUAdapter.prototype.requestDevice = async function (...args) {
      const device = await original.apply(this, args)
      const record = { vendor: this.info.vendor, fallback: this.info.isFallbackAdapter, destroyed: false }
      window.storyDevices.push(record)
      device.lost.then(info => { record.destroyed = info.reason === 'destroyed' })
      return device
    }
  })
  try {
    await page.goto(new URL(`iframe.html?id=examples-integrations--${name}&viewMode=story`, base).href)
    const root = page.locator('#storybook-root')
    const status = root.locator('.status')
    const action = text => root.locator('.action').filter({ hasText: new RegExp(`^${text}$`) }).click()
    const canvas = root.locator('canvas')
    await canvas.waitFor()
    const actualContext = await canvas.evaluate(c => c.getContext('webgpu') ? 'WebGPU' : c.getContext('webgl2') ? 'WebGL' : 'unknown')
    assert.equal(actualContext, engine)
    const firstPaintDeadline = Date.now() + 20000
    while ((await paint(page, canvas)).colored < 5 && Date.now() < firstPaintDeadline && !errors.length) {
      await page.evaluate(() => new Promise(requestAnimationFrame))
    }
    if (name !== 'graph-on-map') {
      await status.filter({ hasText: /running/ }).waitFor()
      await action('Pause')
      await status.filter({ hasText: /paused/ }).waitFor()
    } else {
      await status.filter({ hasText: /13 cities · 585 travellers/ }).waitFor()
      await action('Shuffle trips')
    }
    if (name === 'graph-layer') {
      await action('Add cluster')
      await status.filter({ hasText: /4 clusters · 60 points/ }).waitFor()
      await action('Remove cluster')
      await status.filter({ hasText: /3 clusters · 45 points/ }).waitFor()
      await action('Recolor')
      await action('Pause')
    } else if (name === 'big-graph') {
      assert.match(await status.innerText(), /99,856 points/)
    } else if (name === 'mini-graphs') {
      await root.locator('.thumbnail').nth(1).click()
      await status.filter({ hasText: /dataset B/ }).waitFor()
    }
    if (name === 'big-graph' || name === 'mini-graphs') {
      await action('Reheat')
      await status.filter({ hasText: /running/ }).waitFor()
      await action('Pause')
      await status.filter({ hasText: /paused/ }).waitFor()
    }
    const deadline = Date.now() + 25000
    let frame
    do {
      frame = await paint(page, canvas)
      if (frame.colored >= 5 && (name !== 'graph-layer' || frame.labels >= 3) &&
        (name !== 'graph-on-map' || frame.land >= 100 && frame.labels >= 3) &&
        (name !== 'mini-graphs' || frame.thumbnails.every(n => n >= 3))) break
    } while (Date.now() < deadline && !errors.length)
    assert.ok(frame.colored >= 5, 'Missing point/link paint')
    if (name === 'graph-layer') assert.ok(frame.labels >= 3, 'Missing hub label paint')
    if (name === 'graph-on-map') assert.ok(frame.land >= 100 && frame.labels >= 3, 'Missing country or city label paint')
    if (name === 'mini-graphs') assert.ok(frame.thumbnails.every(n => n >= 3), 'A thumbnail is blank')
    if (name !== 'mini-graphs') {
      const box = await canvas.boundingBox()
      const hover = root.locator('.hover')
      let picked = false
      for (let i = 0; i < Math.min(30, frame.candidates.length); i++) {
        const [x, y] = frame.candidates[Math.floor(i * frame.candidates.length / Math.min(30, frame.candidates.length))]
        await page.mouse.move(box.x + x, box.y + y)
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        if (!(await hover.innerText()).startsWith('hover to see')) { picked = true; break }
      }
      assert.ok(picked, 'No painted element produced a Deck hover')
    }
    if (engine === 'WebGPU') {
      const devices = await page.evaluate(() => window.storyDevices)
      assert.equal(devices.length, 1, 'Deck and every graph must share a single GPU device')
      assert.equal(devices[0].fallback, false)
    }
    // Keep the iframe document alive while Storybook unmounts the story.
    await page.evaluate(() => window.__STORYBOOK_ADDONS_CHANNEL__.emit('setCurrentStory', {
      storyId: 'examples-get-started--quick-start', viewMode: 'story',
    }))
    await status.waitFor({ state: 'detached' })
    if (engine === 'WebGPU') {
      await page.waitForFunction(() => window.storyDevices[0]?.destroyed)
    }
    assert.deepEqual(errors, [])
    console.log(`${engine} ${name} passed`, { paint: frame.colored, land: frame.land, thumbnails: frame.thumbnails })
  } catch (error) {
    console.error(engine, name, errors, await page.locator('#storybook-root').innerText().catch(() => ''))
    throw error
  } finally { await page.close() }
}

try {
  for (const [base, engine] of [[webgl, 'WebGL'], [webgpu, 'WebGPU']]) {
    if (values.engine && engine.toLowerCase() !== values.engine) continue
    for (const story of stories) {
      if (!values.story || story === values.story) await checkStory(base, engine, story)
    }
  }
} finally { await browser.close() }
