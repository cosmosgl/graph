import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calibrate, compare } from './migration-results.mjs'

function run(steady, options = {}) {
  return {
    status: 'complete',
    result: {
      input: 'same-fixture', browser: 'same-chrome', refreshMs: 16,
      steady: { p95: steady }, interaction: { p95: steady },
      picked: Array.from({ length: 12 }, () => ({ id: 10, requested: 10, ms: 16 })),
      readbacks: [], updates: {}, peakBytes: 2 ** 20,
      quality: { nonfinite: 0, flagErrors: 0, fixedMoved: 0, freeMoved: 34 },
      ...options,
    },
  }
}

test('uses the WebGL spread and requires agreement between the pairs', () => {
  const margins = calibrate([run(40), run(46)])
  assert.equal(margins['Steady frame p95'].margin, 6)
  const first = { webgl: run(42), webgpu: run(50) }
  const second = { webgl: run(44), webgpu: run(52) }
  const [row] = compare([first, second], margins)
  assert.equal(row.difference, 8)
  assert.equal(row.verdict, 'Slower')
  second.webgpu = run(50)
  assert.equal(compare([first, second], margins)[0].detail, 'Paired results disagree')
})

test('preserves timings without a verdict for an incomplete or unstable control', () => {
  const pair = { webgl: run(45), webgpu: run(20) }
  const [missing] = compare([pair], calibrate([pair.webgl, { status: 'failed' }]))
  assert.equal(missing.difference, -25)
  assert.equal(missing.verdict, 'Not assessed')
  const [unstable] = compare([pair, pair], calibrate([run(40), run(54)]))
  assert.equal(unstable.verdict, 'Not assessed')
  assert.match(unstable.detail, /WebGL A\/A/)
})

test('a pick on the wrong point cannot satisfy the margin', () => {
  const controls = [run(16), run(16)]
  const missed = run(16)
  missed.result.picked[0].id = null
  const pair = { webgl: controls[0], webgpu: missed }
  const rows = compare([pair, pair], calibrate(controls))
  assert.equal(rows.find(row => row.label === 'Steady frame p95').verdict, 'Within margin')
  assert.equal(rows.find(row => row.label === 'First click').verdict, 'Not assessed')
})
