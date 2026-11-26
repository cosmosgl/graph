import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Compare two fixed-tick correctness runs, or two --draw-tick profiles.
const files = process.argv.slice(2)
assert.equal(files.length, 2, 'Pass the before and after result.json paths')
const captures = await Promise.all(files.map(async file => JSON.parse(await readFile(file, 'utf8'))))
const [baseline, candidate] = captures
const digest = /^[0-9a-f]{64}$/
assert.match(baseline.fixtureSha256, digest)
assert.equal(candidate.fixtureSha256, baseline.fixtureSha256, 'different YouTube fixtures')
assert.equal(candidate.cpu, baseline.cpu, 'different host CPUs')
assert.deepEqual(candidate.boxes, baseline.boxes, 'different input drags')
const [before, after] = captures.map(capture => {
  assert.equal(capture.runs.length, 1, 'Use a fixed-tick capture for one engine and size')
  const [run] = capture.runs
  assert.equal(run.stage, 'complete')
  assert.deepEqual(run.errors, [])
  assert.equal(run.samples.length, 4)
  for (const field of ['positions', 'links', 'weights', 'pins', 'tracked']) assert.match(run.input[field], digest)
  return run
})
for (const field of ['count', 'links', 'engine', 'mode', 'browser', 'device', 'dpr', 'input']) {
  assert.deepEqual(after[field], before[field], `different ${field}`)
}
assert.ok(before.mode === 'correctness' || before.mode === 'profile', 'Expected correctness or frozen draw')
for (const [i, old] of before.samples.entries()) {
  const current = after.samples[i]
  const where = `drag ${i + 1}`
  assert.ok(Number.isInteger(old.targetTick), `${where}: missing requested release tick`)
  assert.equal(current.targetTick, old.targetTick, `${where}: different requested tick`)
  for (const sample of [old, current]) {
    assert.equal(sample.tickAtRelease, old.targetTick, `${where}: missed release tick`)
    assert.equal(sample.labels, 1000)
    assert.equal(sample.ordered, true)
  }
  for (const field of ['from', 'to', 'center', 'zoom', 'selected']) assert.deepEqual(current[field], old[field], `${where}: different ${field}`)
  if (before.mode === 'correctness') {
    for (const sample of [old, current]) {
      assert.equal(sample.verified, true, `${where}: release snapshot mismatch`)
      assert.match(sample.oracle.selectedIdsSha256, digest)
      assert.match(sample.oracle.trackedPositionsSha256, digest, 'Rerun with tracked coordinate digests enabled')
    }
    for (const field of ['selectedIdsSha256', 'trackedPositionsSha256']) {
      assert.equal(current.oracle[field], old.oracle[field], `${where}: different ${field}`)
    }
  }
}
if (before.mode === 'profile') {
  const a = before.frozenDraw
  const b = after.frozenDraw
  assert.ok(a && b, 'Pass --draw-tick to both profile replays')
  assert.equal(b.tick, a.tick)
  assert.match(a.positionsSha256, digest)
  assert.equal(b.positionsSha256, a.positionsSha256, 'different frozen positions')
  assert.match(a.highlights.idsSha256, digest)
  assert.equal(b.highlights.idsSha256, a.highlights.idsSha256, 'different frozen selection')
  assert.match(a.image.rgbaSha256, digest)
  for (const field of ['width', 'height', 'rgbaSha256']) assert.equal(b.image[field], a.image[field], `different canvas ${field}`)
  console.log(`Matched all frozen positions, selected IDs and RGBA pixels at tick ${a.tick}.`)
} else {
  console.log(`Matched ordered selections and 1,000 label XY pairs on all four ${after.count}-point ${after.engine} drags.`)
}
