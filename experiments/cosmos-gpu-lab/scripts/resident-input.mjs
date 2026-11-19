// Use Chrome's real pointer input for the moving-graph benchmark. Coordinates
// are canvas-local CSS pixels in the test iframe.
export async function residentInput ({ page, iframe }, action, from, to) {
  const canvas = iframe.locator('[data-resident-study] [data-canvas]')
  if (action === 'layout') await canvas.scrollIntoViewIfNeeded()
  const bounds = await canvas.boundingBox()
  const viewport = page.viewportSize()
  if (!bounds || !viewport || bounds.x < 0 || bounds.y < 0 ||
    bounds.x + bounds.width > viewport.width || bounds.y + bounds.height > viewport.height) {
    throw new Error('The entire study canvas must be visible in the browser')
  }
  if (action === 'layout') return { bounds, viewport }

  const coordinate = (position) => {
    const [x, y] = position
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) {
      throw new Error('Study pointer is outside the canvas')
    }
    return [bounds.x + x, bounds.y + y]
  }
  const point = coordinate(from)
  if (action === 'pick') await page.mouse.click(...point)
  else if (action === 'zoom') {
    await page.mouse.move(...point)
    await page.mouse.wheel(0, -100)
  } else if (action === 'pan') {
    const end = coordinate(to)
    await page.mouse.move(...point)
    await page.mouse.down()
    try { await page.mouse.move(...end, { steps: 3 }) } finally { await page.mouse.up() }
  } else throw new Error('Unknown resident study input')
}
