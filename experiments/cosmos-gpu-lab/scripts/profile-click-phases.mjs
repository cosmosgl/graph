// A diagnostic of repeated, fresh pointer releases, separate from first-click acceptance.
function installClickClock() {
  const state = { events: [], frames: [], sample: null }
  window.forceClickClock = state
  let frame
  function observe(time) {
    state.frames.push(time)
    if (state.frames.length > 12) state.frames.shift()
    frame = requestAnimationFrame(observe)
  }
  frame = requestAnimationFrame(observe)
  state.stop = () => cancelAnimationFrame(frame)
  window.addEventListener('click', event => {
    if (state.sample === null) return
    const previous = state.frames.findLast(time => time <= event.timeStamp)
    state.events.push({ sample: state.sample, method: 'input', time: event.timeStamp, previousFrame: previous })
  }, true)

  // Observe the existing promise without adding a fence or forcing an extra read.
  const first = window.Cosmos.Graph.prototype.renderOneFrame
  window.Cosmos.Graph.prototype.renderOneFrame = function(...args) {
    window.Cosmos.Graph.prototype.renderOneFrame = first
    function observeCall(target, key, label) {
      const original = target?.[key]
      if (typeof original !== 'function') return
      target[key] = function(...values) {
        const sample = state.sample
        if (sample === null) return original.apply(this, values)
        const start = performance.now()
        const result = original.apply(this, values)
        const event = { sample, method: label, start }
        state.events.push(event)
        Promise.resolve(result).then(() => { event.end = performance.now() }, () => { event.error = true })
        return result
      }
    }
    observeCall(this.renderer, 'pick', 'renderer.pick')
    observeCall(this.simulation, 'getPointPositionsByIndicesAsync', 'coordinates')
    return first.apply(this, args)
  }
}

export async function measureClickPhases(page, bounds) {
  await page.evaluate(installClickClock)
  await page.evaluate(() => window.forceTiming.run(8, 48))
  const requested = []
  // Four equally spaced phases, shared by both targets and both engines. Rotate
  // the order over six rounds and retain every input, including off-target arrivals.
  for (let round = 0; round < 6; round++) {
    for (const offset of [0, 2, 1, 3]) {
      for (let target = 0; target < 2; target++) {
        const sample = requested.length
        const phase = (round + offset) % 4
        requested.push(phase)
        const [x, y] = await page.evaluate(i => window.forceTiming.target(i), sample)
        await page.mouse.move(bounds.x + x, bounds.y + y)
        if (sample === 0) await page.evaluate(() => window.forceTiming.frames(2))
        await page.mouse.down()
        await page.evaluate(({ sample, phase }) => new Promise(resolve => requestAnimationFrame(time => {
          const frameMs = window.forceTiming.snapshot().refreshMs
          window.forceClickClock.sample = sample
          const release = time + 2 * frameMs + (phase + 0.5) * frameMs / 4
          setTimeout(resolve, Math.max(0, release - performance.now()))
        })), { sample, phase })
        await page.mouse.up()
        await page.waitForFunction(i => window.forceTiming.snapshot().picked.length === i + 1, sample, { timeout: 5000 })
        await page.evaluate(() => { window.forceClickClock.sample = null })
      }
    }
  }
  const events = await page.evaluate(() => {
    window.forceClickClock.stop()
    return window.forceClickClock.events
  })
  await page.evaluate(() => window.forceTiming.finish())
  const result = await page.evaluate(() => window.forceTiming.snapshot())
  if (result.picked.length !== requested.length || result.editTick !== 58 || result.memoryAfterTeardown !== 0) {
    throw new Error('Incomplete matched-phase release trial')
  }
  result.phases = result.picked.map((pick, i) => {
    if (pick.inputTick !== 58 || pick.tick !== 58 || !pick.trusted || pick.id !== pick.requested) throw new Error('Invalid frozen release')
    const measured = events.filter(event => event.sample === i)
    const input = measured.find(event => event.method === 'input')
    if (!input || input.previousFrame === undefined || input.time !== pick.clickAt) throw new Error('Missing input frame timestamp')
    const elapsed = input.time - input.previousFrame
    return {
      requestedBin: requested[i], elapsed, bin: Math.floor(elapsed / result.refreshMs * 4) % 4,
      id: pick.id, callback: pick.callbackAt - pick.clickAt, untilFrame: pick.feedbackAt - pick.callbackAt,
      visible: pick.ms, methods: measured.filter(event => event.method !== 'input'),
    }
  })
  return result
}

/** Give each quarter of the refresh interval equal weight, independently of input latency. */
export function summarizeClickPhases(trials) {
  if (trials.some(trial => trial.status !== 'complete')) throw new Error('Incomplete phase diagnostic')
  if (new Set(trials.map(trial => trial.result.input)).size !== 1 || new Set(trials.map(trial => trial.browser)).size !== 1) {
    throw new Error('Matched phase trials did not use identical inputs and browsers')
  }
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length
  return trials.flatMap(({ name, result }) => ['Point 0', 'Background'].map(id => {
    const phases = result.phases.filter(row => row.id === id)
    const bins = [0, 1, 2, 3].map(bin => {
      const rows = phases.filter(row => row.bin === bin)
      return {
        count: rows.length,
        callback: rows.length ? mean(rows.map(row => row.callback)) : null,
        visible: rows.length ? mean(rows.map(row => row.visible)) : null,
      }
    })
    const covered = bins.every(bin => bin.count > 0)
    return {
      name, id, bins,
      delayedFrameClocks: phases.filter(row => row.elapsed > result.refreshMs * 1.25).length,
      equalWeightCallback: covered ? mean(bins.map(bin => bin.callback)) : null,
      equalWeightVisible: covered ? mean(bins.map(bin => bin.visible)) : null,
    }
  }))
}
