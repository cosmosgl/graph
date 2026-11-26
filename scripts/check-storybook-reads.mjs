import assert from 'node:assert/strict'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

// Run against the two previews from this checkout. Set --performance to also
// exercise the moving layout readouts and the stories that display frame rate.
const { values } = parseArgs({ options: {
  webgl: { type: 'string', default: 'http://127.0.0.1:6006' },
  webgpu: { type: 'string', default: 'http://127.0.0.1:6007' },
  swiftshader: { type: 'boolean' },
  performance: { type: 'boolean' },
} })
const browser = await chromium.launch({ channel: 'chrome', headless: !!values.swiftshader, args: values.swiftshader
  ? ['--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu']
  : ['--enable-unsafe-webgpu'] })

async function checkArea(page) {
  const root = page.locator('#storybook-root')
  const status = root.getByRole('status')
  const button = name => root.getByRole('button', { name, exact: true }).click()
  const selected = text => status.getByText('Selected: ' + text, { exact: true }).waitFor()
  for (const ratio of ['1×', '2×']) {
    await button(ratio)
    await button('Rectangle')
    await button('Touch')
    await button('Edge overlap')
    await selected('Circle, Square')
    await button('Center inside')
    await selected('none')
    await button('Touch')
    await button('Square vs circle')
    await selected('Square')
    await button('Different sizes')
    const box = await root.locator('svg').boundingBox()
    const x = box.x + box.width / 2
    const y = box.y + Math.max(240, box.height / 2)
    for (const tool of ['Rectangle', 'Lasso']) {
      await button(tool)
      // Start away from the existing outline, drag around just Medium, then
      // grab the selection and move it to Large before the old read can repaint.
      await page.mouse.move(x - 20, y - 20)
      await page.mouse.down()
      for (const [dx, dy] of [[20, -20], [20, 20], [-20, 20], [-20, -20]]) {
        if (tool === 'Lasso' || (dx === 20 && dy === 20)) await page.mouse.move(x + dx, y + dy)
      }
      await page.mouse.up()
      await selected('Medium')
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + 90, y, { steps: 4 })
      await page.mouse.up()
      await selected('Large')
    }
  }
}

async function checkSharedCamera(page, open) {
  await open('rendering--anti-aliasing')
  const root = page.locator('#storybook-root')
  await root.getByRole('checkbox', { name: 'reference rings' }).check()
  const canvases = root.locator('canvas')
  const rings = root.locator('svg circle:first-child')
  await canvases.nth(2).waitFor()
  await page.waitForFunction(() => {
    const rings = Array.from(document.querySelectorAll('#storybook-root svg circle:first-child'))
    return rings.length === 3 && rings.every(ring => ring.r.baseVal.value > 0)
  })
  assert.equal(await canvases.count(), 3)
  const readPanes = () => rings.evaluateAll(nodes => nodes.map(node => ({
    x: node.cx.baseVal.value - node.ownerSVGElement.clientWidth / 2,
    y: node.cy.baseVal.value - node.ownerSVGElement.clientHeight / 2,
    radius: node.r.baseVal.value,
  })))
  // Start the next gesture in a different pane. Its own zoom must continue from the shared view.
  let previous = await readPanes()
  for (const i of [0, 2]) {
    const box = await canvases.nth(i).boundingBox()
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.4)
    await page.mouse.wheel(0, -140)
    await page.waitForFunction(lastRadius => {
      const rings = Array.from(document.querySelectorAll('#storybook-root svg circle:first-child'))
      return rings.length === 3 && rings.every(ring => ring.r.baseVal.value > lastRadius * 1.05)
    }, previous[0].radius)
    const panes = await readPanes()
    for (const pane of panes) {
      assert.ok(Math.abs(pane.x - panes[0].x) < 1 && Math.abs(pane.y - panes[0].y) < 1)
      assert.ok(Math.abs(pane.radius - panes[0].radius) < 0.001)
    }
    previous = panes
    // Give the browser time to release the first scroll target before the second wheel gesture.
    if (i === 0) await page.waitForTimeout(650)
  }
  console.log('All three antialiasing panes followed gestures from either end')
}

async function checkRepulsionSamples(page, open) {
  await open('performance--sample-count-under-load')
  const root = page.locator('#storybook-root')
  const reading = root.locator('pre').filter({ hasText: /samples in force/ })
  await root.getByRole('button', { name: '25k', exact: true }).click()
  for (const n of [16, 8]) {
    await root.getByRole('button', { name: String(n), exact: true }).click()
    await reading.filter({ hasText: new RegExp('samples in force\\s+' + n + '\\s+\\(fixed\\)') }).waitFor()
  }
  await root.getByRole('button', { name: 'auto', exact: true }).click()
  await reading.filter({ hasText: /samples in force\s+(8|16|32|64)\s+\(auto, wanted \d+\)/ }).waitFor({ timeout: 90_000 })
  console.log('The force reported fixed sample counts and a completed occupancy reading')
}

async function checkReadouts(page, open) {
  await open('performance--far-point')
  await page.locator('pre').filter({ hasText: /finest cell:/ }).first().waitFor()
  await page.getByRole('button', { name: 'pause', exact: true }).click()
  await page.getByRole('button', { name: 'far point at 1e5', exact: true }).click()
  await page.locator('pre').filter({ hasText: /far point: 100,000 units out/ }).waitFor()
  console.log('Far Point reported the new fixture distance')
  await open('performance--space-wall')
  await page.locator('pre').filter({ hasText: /extent:/ }).waitFor()
  await page.getByRole('button', { name: 'pause', exact: true }).click()
  await page.getByRole('button', { name: 'gravity 0', exact: true }).click()
  await page.locator('pre').filter({ hasText: /state: paused\s+tick: 0\s/ }).waitFor()
  await page.getByRole('button', { name: 'step ×200', exact: true }).click()
  await page.locator('pre').filter({ hasText: /state: paused\s+tick: 200\s/ }).waitFor({ timeout: 180_000 })
  await page.getByRole('button', { name: 'run', exact: true }).click()
  await page.locator('pre').filter({ hasText: /state: running\s+tick: [1-9]\d*\s/ }).waitFor()
  console.log('Space Wall reported the paused and running ticks')
  await open('performance--steady-state-motion')
  await page.getByRole('button', { name: 'fast', exact: true }).click()
  await page.getByText(/one point, last \d+ ticks/).first().waitFor({ timeout: 180_000 })
  for (const id of ['collision-stress-test', 'point-occlusion-culling', 'hyperbolic-large-graph']) {
    await open(`performance--${id}`)
    const widget = page.locator('#storybook-root #gl-bench')
    await widget.locator('.gl-fps').filter({ hasText: /^[1-9]\d* FPS$/ }).waitFor({ timeout: 60_000 })
    await widget.locator('.gl-chart[points]:not([points=""])').waitFor({ state: 'attached' })
    console.log(`${id} displayed a live FPS counter and frame chart`)
  }
}

async function checkPage(engine, base, check, viewport = { width: 800, height: 600 }) {
  const page = await browser.newPage({ viewport })
  page.setDefaultTimeout(30_000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const open = async id => {
    console.log(`${engine} opening ${id}`)
    await page.goto(new URL(`iframe.html?id=examples-${id}&viewMode=story`, base).href, { waitUntil: 'domcontentloaded' })
    assert.equal(await page.locator('#cosmos-preview-build').getAttribute('data-engine'), engine)
  }
  try {
    await check(page, open)
    assert.deepEqual(errors, [])
  } catch (error) {
    console.error(engine, page.url(), { errors })
    throw error
  } finally { await page.close() }
}

try {
  for (const [engine, base] of [['WebGL', values.webgl], ['WebGPU', values.webgpu]]) {
    await checkPage(engine, base, async (page, open) => {
      await open('interaction--area-selection')
      if (engine === 'WebGPU') {
        const info = await page.evaluate(async () => {
          const adapter = await navigator.gpu.requestAdapter()
          if (!adapter) throw new Error('No WebGPU adapter available')
          return { vendor: adapter.info.vendor, architecture: adapter.info.architecture, fallback: adapter.info.isFallbackAdapter }
        })
        assert.equal(info.fallback, !!values.swiftshader)
        console.log('WebGPU adapter', info)
      }
      await checkArea(page)
      console.log(`${engine} area presets, modes and dragged selections passed at both pixel ratios`)
    })
    await checkPage(engine, base, checkSharedCamera, { width: 1280, height: 720 })
    if (values.performance) {
      await checkPage(engine, base, checkRepulsionSamples)
      await checkPage(engine, base, checkReadouts)
    }
  }
} finally { await browser.close() }
