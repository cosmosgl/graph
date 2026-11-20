// Use Chrome's real pointer input for the moving-graph benchmark. Coordinates
// are canvas-local CSS pixels in the test iframe.
export async function residentInput ({ page, iframe }, action, from, to) {
  return await graphInput(page, iframe.locator('[data-resident-study] [data-canvas]'), action, from, to)
}

export async function composedInput ({ page, iframe }, action, from) {
  return await graphInput(page, iframe.locator('[data-composed-study] canvas'), action, from)
}

export async function crashIsolatedGpu ({ page }) {
  if (process.env.VITE_LAB_GPU_PROCESS_LOSS !== '1' || process.env.LAB_INLINE_BROWSER === '1' || process.env.LAB_NATIVE_VISIBLE !== '1') {
    throw new Error('GPU process loss requires the explicitly enabled, isolated visible Chrome runner')
  }
  const browser = page.context().browser()
  if (!browser) throw new Error('Expected the runner-owned Chrome browser')
  const session = await browser.newBrowserCDPSession()
  try { await session.send('Browser.crashGpuProcess') } finally { await session.detach() }
}

async function graphInput (page, canvas, action, from, to) {
  if (action === 'layout') await canvas.scrollIntoViewIfNeeded()
  const bounds = await canvas.boundingBox()
  const viewport = page.viewportSize()
  if (!bounds || !viewport || bounds.x < 0 || bounds.y < 0 ||
    bounds.x + bounds.width > viewport.width || bounds.y + bounds.height > viewport.height) {
    throw new Error('The entire study canvas must be visible in the browser')
  }
  if (action === 'layout') return { bounds, viewport }
  if (action === 'left-up' || action === 'right-up') {
    await page.mouse.up({ button: action === 'left-up' ? 'left' : 'right' })
    return
  }

  const coordinate = (position) => {
    const [x, y] = position
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) {
      throw new Error('Study pointer is outside the canvas')
    }
    return [bounds.x + x, bounds.y + y]
  }
  const point = coordinate(from)
  if (action === 'pick') await page.mouse.click(...point)
  else if (action === 'move') await page.mouse.move(...point)
  else if (action === 'left-down' || action === 'right-down') {
    await page.mouse.move(...point)
    await page.mouse.down({ button: action === 'left-down' ? 'left' : 'right' })
  } else if (action === 'zoom' || action === 'zoom-deep') {
    await page.mouse.move(...point)
    await page.mouse.wheel(0, action === 'zoom-deep' ? -1200 : -100)
  } else if (action === 'pan') {
    const end = coordinate(to)
    await page.mouse.move(...point)
    await page.mouse.down()
    try { await page.mouse.move(...end, { steps: 3 }) } finally { await page.mouse.up() }
  } else throw new Error('Unknown resident study input')
}
