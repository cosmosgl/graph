import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const [webgl = 'http://127.0.0.1:6006', webgpu = 'http://127.0.0.1:6007'] = process.argv.slice(2)
const viewport = { width: 800, height: 600 }
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu'] })

async function checkHover(page, base) {
  await page.goto(new URL('iframe.html?id=examples-links--link-hovering&viewMode=story', base).href)
  const root = page.locator('#storybook-root')
  const blending = root.getByRole('checkbox', { name: 'Link blending' })
  await blending.waitFor()
  // Wait for the initial fit to finish. At this viewport these two strokes
  // are isolated, and the seed fixes their IDs across engines and reloads.
  const canvas = root.locator('canvas')
  await page.waitForFunction(() => {
    const zoom = document.querySelector('#storybook-root canvas')?.__zoom
    if (!zoom || zoom.k === 1) return false
    const camera = [zoom.x, zoom.y, zoom.k].join()
    if (camera !== window.lastCamera) {
      window.lastCamera = camera
      window.cameraChangedAt = performance.now()
    }
    return performance.now() - window.cameraChangedAt > 550
  })
  for (const enabled of [true, false]) {
    await blending.setChecked(enabled)
    for (const [x, y, id] of [[353, 270, 881], [390, 285, 877]]) {
      await canvas.hover({ position: { x, y } })
      await root.getByText(`Link ${id}`, { exact: true }).waitFor()
    }
    await canvas.hover({ position: { x: 400, y: 300 } })
    await root.getByText('Link 877', { exact: true }).waitFor({ state: 'hidden' })
  }
}

async function checkPlayground(page, base, engine) {
  await page.goto(new URL('iframe.html?id=examples-links--link-style-playground&viewMode=story', base).href)
  const liveStory = page.locator('#storybook-root')
  await liveStory.getByRole('radio', { name: 'Dotted' }).check()
  await liveStory.getByRole('checkbox', { name: 'Curved links' }).check()
  assert.equal(await liveStory.locator('canvas').evaluate(canvas =>
    canvas.getContext('webgl2') ? 'webgl' : canvas.getContext('webgpu') ? 'webgpu' : 'unknown'), engine)

  // Mount the very same story factory as the dev preview. Keeping its returned
  // Graph lets the replay freeze the layout with public calls between gestures.
  const path = '/__cosmos-frozen-link-story.html'
  await page.route('**' + path, route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><body style="margin:0"></body>',
  }))
  await page.goto(new URL(path, base).href)
  await page.evaluate(async () => {
    const { interactiveLinkStyles } = await import('/src/stories/links/playground/index.ts')
    const { graph, div } = interactiveLinkStyles()
    document.body.append(div)
    window.storyGraph = graph
    await graph.ready
    // The story has already scheduled its initial animated fit. Let it finish
    // before setting the common camera, including when the viewport resizes.
    graph.setConfigPartial({ enableSimulation: false, enableRenderLoop: false, fitViewOnInit: false, transitionDuration: 0 })
    graph.pause()
    graph.setPointPositions(graph.graph.inputPointPositions.slice(), true)
    graph.render(1, 0)
    const readyAt = performance.now() + graph.config.fitViewDelay + graph.config.fitViewDuration
    while (performance.now() < readyAt) {
      graph.renderOneFrame()
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
    graph.setZoomLevel(0.15, 0, false)
    await graph.getPointPositionsAsync()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  assert.deepEqual(await page.locator('canvas').evaluate(canvas => [canvas.width, canvas.height]),
    [viewport.width, viewport.height])
  assert.equal(await page.evaluate(() => window.storyGraph.simulation.device.info.type), engine)
  const take = () => page.evaluate(() => {
    const graph = window.storyGraph
    const canvas = document.querySelector('canvas')
    const copy = document.createElement('canvas')
    copy.width = canvas.width
    copy.height = canvas.height
    const ctx = copy.getContext('2d', { willReadFrequently: true })
    graph.renderOneFrame()
    ctx.drawImage(canvas, 0, 0)
    const data = ctx.getImageData(0, 0, copy.width, copy.height).data
    const pixels = new Uint32Array(data.buffer, data.byteOffset, data.length / 4)
    window.solidPixels ??= pixels
    let painted = 0
    let changed = 0
    let changedFromSolid = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] && (data[i] !== 22 || data[i + 1] !== 22 || data[i + 2] !== 28)) painted++
      if (window.previousPixels && window.previousPixels[i / 4] !== pixels[i / 4]) changed++
      if (window.solidPixels[i / 4] !== pixels[i / 4]) changedFromSolid++
    }
    window.previousPixels = pixels
    return { painted, changed, changedFromSolid }
  })
  assert.ok((await take()).painted > 500, 'playground contains visible points and links')
  assert.equal((await take()).changed, 0, 'frozen playground should paint the same frame twice')
  const controls = []
  for (const [role, name] of [
    ['radio', 'Dashed'], ['radio', 'Dotted'], ['radio', 'Solid'], ['checkbox', 'Gradient (endpoint colors)'],
    ['checkbox', 'Curved links'], ['checkbox', 'Arrows'], ['checkbox', 'Scale links on zoom'],
  ]) {
    const input = page.getByRole(role, { name, exact: true })
    await input.check()
    const { changed, changedFromSolid } = await take()
    assert.ok(changed > 0, `${engine} ${name} repainted no pixels on the frozen graph`)
    controls.push([name, changed])
    if (name === 'Solid') assert.equal(changedFromSolid, 0, `${engine} did not restore the solid strokes`)
    if (role === 'checkbox') {
      await input.uncheck()
      assert.equal((await take()).changedFromSolid, 0, `${engine} failed to restore ${name}`)
    }
  }
  const zoom = await page.evaluate(() => window.storyGraph.getZoomLevel())
  await page.mouse.move(350, 300)
  await page.mouse.wheel(0, -125)
  await page.waitForFunction(before => window.storyGraph.getZoomLevel() > before, zoom)
  assert.ok((await take()).changed > 0, 'zoom visibly moved the graph')
  return controls
}

try {
  for (const [engine, base] of [['webgl', webgl], ['webgpu', webgpu]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await checkHover(page, base)
      const controls = await checkPlayground(page, base, engine)
      assert.deepEqual(errors, [])
      console.log(engine, JSON.stringify({ hovered: [881, 877], controls }))
    } finally { await page.close() }
  }
} finally { await browser.close() }
