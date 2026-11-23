import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Run with both previews open. Pass the WebGL URL twice to check the comparison itself.
const [reference = 'http://127.0.0.1:6006', candidate = 'http://127.0.0.1:6007'] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu'] })

async function paint(page, canvas) {
  const png = await canvas.screenshot()
  return page.evaluate(async base64 => {
    const pngBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([pngBytes], { type: 'image/png' }))
    const scratch = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = scratch.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const { width, height, data } = ctx.getImageData(0, 0, scratch.width, scratch.height)
    const centers = [[0, 0, 0], [0, 0, 0]]
    let quickStartFill = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const red = data[i], green = data[i + 1], blue = data[i + 2]
        // The fitted Quick Start points can cover fractions of a pixel. Accept the
        // declared pink blended over its charcoal background at >= 20% coverage.
        const coverage = (red - 45) / (240 - 45)
        if (coverage >= 0.2 && coverage <= 1.02 &&
          Math.abs(green - (49 + coverage * 56)) < 10 && Math.abs(blue - (58 + coverage * 122)) < 10) quickStartFill++
        // The manual story's controls and build label lie outside this band.
        if (y < height / 4 || y >= 3 * height / 4) continue
        const hit = red > 240 && green < 120 && blue < 120 ? centers[0]
          : red < 110 && green > 185 && blue > 240 ? centers[1] : undefined
        if (hit) { hit[0] += x; hit[1] += y; hit[2]++ }
      }
    }
    const points = centers.map(([x, y, n]) => n ? [x / n, y / n] : null)
    if (points.some(p => !p)) return { points, link: [], quickStartFill }
    const midX = Math.round((points[0][0] + points[1][0]) / 2)
    const midY = Math.round((points[0][1] + points[1][1]) / 2)
    const i = (midY * width + midX) * 4
    return { points, link: Array.from(data.slice(i, i + 3)), quickStartFill }
  }, png.toString('base64'))
}

async function checkPreview(base, engine) {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 })
  try {
    page.on('pageerror', error => console.error(error))
    const url = new URL('iframe.html?id=examples-get-started--manual-step&viewMode=story', base)
    await page.goto(url.href)
    const host = page.locator('#storybook-root')
    await host.getByText('Pinned x 1984.0 · Free x 2112.0', { exact: true }).waitFor()
    const canvas = host.locator('canvas').first()
    const context = await canvas.evaluate(c => c.getContext('webgl2') ? 'WebGL' : c.getContext('webgpu') ? 'WebGPU' : 'unknown')
    assert.equal(context, engine)
    const before = await paint(page, canvas)
    assert.ok(before.points.every(Boolean), `${engine} should draw both circles: ${JSON.stringify(before)}`)
    assert.ok(before.link.every(v => v > 140), `${engine} should draw the link between its endpoints`)
    const [red, blue] = before.points
    for (const [index, [x, y]] of before.points.entries()) {
      await canvas.click({ position: { x, y } })
      await host.getByText(`Selected point ${index}`, { exact: true }).waitFor()
    }
    await host.getByRole('button', { name: 'Step gravity' }).click()
    await page.waitForFunction(() => {
      const text = document.querySelector('#storybook-root output')?.textContent
      return text?.startsWith('Pinned x 1984.0 · Free x ') && Number(text.split(' ').at(-1)) < 2112
    })
    // The selected points are now away from the pointer, and the read above has completed the step.
    const after = await paint(page, canvas)
    assert.ok(after.points.every(Boolean), `${engine} lost a point after a step`)
    assert.ok(Math.abs(after.points[0][0] - red[0]) <= 1, `${engine} moved the pinned point`)
    assert.ok(after.points[1][0] < blue[0] - 1, `${engine} did not draw the gravity step`)
    assert.ok(after.link.every(v => v > 140), `${engine} lost the link after movement`)
    console.log(engine, JSON.stringify({ before, after }))
    await page.goto(new URL('iframe.html?id=examples-get-started--quick-start&viewMode=story', base).href)
    await canvas.waitFor()
    let quickStartFill = 0
    const deadline = Date.now() + 15000
    while (quickStartFill < 3 && Date.now() < deadline) {
      quickStartFill = (await paint(page, canvas)).quickStartFill
    }
    assert.ok(quickStartFill >= 3, `${engine} Quick Start did not paint its pink points`)
    console.log(`${engine} Quick Start rendered with ${quickStartFill} point-fill pixels`)
    return before
  } finally { await page.close() }
}

try {
  const control = await checkPreview(reference, 'WebGL')
  const result = await checkPreview(candidate, candidate === reference ? 'WebGL' : 'WebGPU')
  for (const [i, point] of control.points.entries()) {
    assert.ok(Math.hypot(point[0] - result.points[i][0], point[1] - result.points[i][1]) <= 1)
  }
} finally { await browser.close() }
