import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Run with both previews open. Pass the WebGL URL twice to check the comparison itself.
const [reference = 'http://127.0.0.1:6006', candidate = 'http://127.0.0.1:6007'] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu'] })

async function countPointPixels(page, canvas) {
  const png = await canvas.screenshot()
  return page.evaluate(async base64 => {
    const pngBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([pngBytes], { type: 'image/png' }))
    const scratch = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = scratch.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height)
    let pointPixels = 0
    for (let i = 0; i < data.length; i += 4) {
      const red = data[i], green = data[i + 1], blue = data[i + 2]
      // The fitted Quick Start points can cover fractions of a pixel. Accept the
      // declared pink blended over its charcoal background at >= 20% coverage.
      const coverage = (red - 45) / (240 - 45)
      if (coverage >= 0.2 && coverage <= 1.02 &&
        Math.abs(green - (49 + coverage * 56)) < 10 && Math.abs(blue - (58 + coverage * 122)) < 10) pointPixels++
    }
    return pointPixels
  }, png.toString('base64'))
}

async function checkPreview(base, engine) {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 })
  try {
    page.on('pageerror', error => console.error(error))
    const url = new URL('iframe.html?id=examples-get-started--quick-start&viewMode=story', base)
    await page.goto(url.href)
    const canvas = page.locator('#storybook-root canvas').first()
    await canvas.waitFor()
    let pointPixels = 0
    const deadline = Date.now() + 15000
    while (pointPixels < 3 && Date.now() < deadline) {
      pointPixels = await countPointPixels(page, canvas)
    }
    assert.ok(pointPixels >= 3, `${engine} Quick Start did not paint its pink points`)
    const context = await canvas.evaluate(c => {
      if (c.getContext('webgl2')) return 'WebGL'
      if (c.getContext('webgpu')) return 'WebGPU'
      return 'unknown'
    })
    assert.equal(context, engine)
    console.log(`${engine} Quick Start rendered with ${pointPixels} point-fill pixels`)
  } finally { await page.close() }
}

try {
  await checkPreview(reference, 'WebGL')
  await checkPreview(candidate, candidate === reference ? 'WebGL' : 'WebGPU')
} finally { await browser.close() }
