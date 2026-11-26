// Points 0 and 1 are at (940,982) and (1060,1022) in the packed consumer.
import assert from 'node:assert/strict'

const hit = layer => ({ layer, kind: 'point', index: 0 })

async function sharedTimeline(page) {
  const result = await page.evaluate(async () => (await window.consumer).contracts.sharedTimeline())
  assert.equal(result.shared, true)
  assert.deepEqual(result.steps, [1, 0, 1, 0, 1, 0, 1, 0, 0])
  assert.deepEqual(result.before, [hit('main'), hit('second')])
  assert.deepEqual(result.after, [null, hit('second')])
  for (const xy of [result.initial, result.both, result.one]) assert.deepEqual(xy.slice(0, 2), [940, 982])
  for (const i of [2, 3]) assert.ok(result.initial[i] < result.both[i] && result.both[i] < result.one[i])
  assert.equal(result.appGraphAlive, true)
  return result
}

async function viewportDrag(page, view) {
  const start = await page.evaluate(async id => (await window.consumer).contracts.prepareDrag(id), view)
  assert.deepEqual(start, hit(view))
  const box = await page.locator('canvas').boundingBox()
  assert.ok(box)
  const main = view === 'main'
  const from = main ? [100, 114] : [245, 45]
  const to = main ? [140, 84] : [239, 19]
  const center = main ? [160, 96] : [260, 40]
  const scale = main ? 1 : 0.25
  // Send integer client positions; the canvas itself may start at a fractional CSS pixel.
  const move = (x, y) => page.mouse.move(Math.round(box.x + x), Math.round(box.y + y))
  const screen = [Math.round(box.x + to[0]) - box.x, Math.round(box.y + to[1]) - box.y]
  const expected = [1000 + (screen[0] - center[0]) / scale, 1000 - (screen[1] - center[1]) / scale]
  const waitFor = phase => page.evaluate(async phase => (await window.consumer).contracts.waitForDrag(phase), phase)
  await move(...from)
  await page.mouse.down()
  try {
    await move(from[0] + 10, from[1] - 6)
    await waitFor('start')
    // Draw both viewports between the grab and the move.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await move(...to)
    await waitFor('move')
  } finally { await page.mouse.up() }
  await waitFor('end')
  const result = await page.evaluate(async () => (await window.consumer).contracts.dragState())
  assert.deepEqual(result.position, expected, JSON.stringify(result))
  assert.equal(result.pinned, false)
  assert.equal(result.events.filter(event => event.phase === 'start').length, 1)
  assert.equal(result.events.filter(event => event.phase === 'end').length, 1)
  assert.ok(result.events.every(event => event.id === 0 && event.viewport === view && event.pinned === (event.phase !== 'end')))
  assert.deepEqual(result.events.findLast(event => event.phase === 'move').screen, screen)
  assert.deepEqual(result.events.at(-1).screen, screen)
  const pick = at => page.evaluate(async ({ view, at }) => (await window.consumer).contracts.pick(view, ...at), { view, at })
  assert.equal(await pick(from), null)
  assert.deepEqual(await pick(to), hit(view))
  return result
}

async function reloadBounds(page, rejectOld) {
  const result = await page.evaluate(async reject => (await window.consumer).contracts.reloadBounds(reject), rejectOld)
  assert.deepEqual(result, {
    oldPositions: [0, 0, 100, 50], during: [[5000, 5000, 0], [5100, 5050, 0]], fresh: [[4900, 4950, 0], [5100, 5050, 0]],
    pendingReads: 1, settledReads: 2, cachedReads: 2, heldSteps: 0, resumedSteps: 1,
  })
  return result
}

export async function checkPublicContracts(browser, url, checkAdapter, observeErrors) {
  const results = []
  const cases = [
    ['shared-timeline', 'app', sharedTimeline],
    ['main-viewport-drag', 'app', page => viewportDrag(page, 'main')],
    ['thumbnail-viewport-drag', 'app', page => viewportDrag(page, 'thumbnail')],
    ['stale-bounds', 'layer', page => reloadBounds(page, false)], ['rejected-bounds', 'layer', page => reloadBounds(page, true)],
  ]
  for (const [name, owner, check] of cases) {
    const page = await browser.newPage({ viewport: { width: 820, height: 640 }, deviceScaleFactor: 1 })
    page.setDefaultTimeout(20000)
    const errors = observeErrors(page)
    try {
      await page.goto(url + '?owner=' + owner)
      await page.waitForFunction(() => window.consumer !== undefined)
      checkAdapter(await page.evaluate(async () => (await window.consumer).adapter))
      const result = await check(page)
      await page.evaluate(async () => {
        const app = await window.consumer
        await app.remove()
        await app.finish()
      })
      assert.deepEqual(errors, [])
      results.push({ name, owner, result })
      console.error(name + ' passed on the packed packages')
    } catch (cause) {
      throw new Error(name + ' on ' + owner + '-owned graph: ' + String(cause), { cause })
    } finally { await page.close() }
  }
  return results
}
