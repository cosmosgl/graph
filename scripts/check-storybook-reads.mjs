import assert from 'node:assert/strict'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

// Run against the two previews from this checkout. Set --performance to also
// exercise the three moving layouts that take asynchronous position snapshots.
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
}

try {
  for (const [engine, base] of [['WebGL', values.webgl], ['WebGPU', values.webgpu]]) {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const open = async id => {
      await page.goto(new URL(`iframe.html?id=examples-${id}&viewMode=story`, base).href)
      assert.equal(await page.locator('#cosmos-preview-build').getAttribute('data-engine'), engine)
    }
    try {
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
      if (values.performance) {
        await checkReadouts(page, open)
        console.log(`${engine} far-point, space-wall and steady-state position readouts passed`)
      }
      assert.deepEqual(errors, [])
    } catch (error) {
      const readouts = await page.locator('[role="status"], pre').allTextContents()
      console.error(engine, page.url(), { errors, readouts })
      throw error
    } finally { await page.close() }
  }
} finally { await browser.close() }
