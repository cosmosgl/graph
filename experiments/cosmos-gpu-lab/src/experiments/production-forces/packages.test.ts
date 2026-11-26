import { expect, it, vi } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { replayAttractionEdits } from './attraction-edits'
import { combinedMetrics, positionStats } from './compare'
import { absentIndex, forceCases, forcePositions, origin, type ForceCase } from './fixture'
import { createForcePreview, type ForceSession } from './frame'
import { isScaleCase } from './scale-fixture'
import { replaySpringEdits } from './spring-edits'
import { createForcesView } from './view'

// Check recognizable motion even if both packages were to agree on the same broken output.
function checkFirstStep (fixture: ForceCase, initial: Float32Array, xy: Float32Array): void {
  function point (i: number, x: number, y: number): void {
    expect(Math.abs(xy[2 * i] - x)).toBeLessThan(0.001)
    expect(Math.abs(xy[2 * i + 1] - y)).toBeLessThan(0.001)
  }
  switch (fixture) {
  case 'gravity':
    point(1, origin + 40 * (1 - 0.075), origin)
    break
  case 'center': {
    const { cx, cy } = positionStats(initial, initial)
    point(1, initial[2] + (cx - initial[2]) * 0.06, initial[3] + (cy - initial[3]) * 0.06)
    break
  }
  case 'springs': {
    // Isolated 5→7 spring: rest length 14, stiffness 0.5, equal degree bias,
    // strength sqrt(0.75). The target's pass uses the updated source.
    const dx = initial[14] - initial[10]
    const dy = initial[15] - initial[11]
    const length = Math.hypot(dx, dy)
    const stiffness = 0.5 * 0.5 * Math.sqrt(0.75)
    const sourcePull = stiffness * (1 - 14 / length)
    const targetPull = stiffness * (1 - sourcePull - 14 / length)
    point(5, initial[10] + dx * sourcePull, initial[11] + dy * sourcePull)
    point(7, initial[14] - dx * targetPull, initial[15] - dy * targetPull)
    expect(xy[2]).toBeLessThan(initial[2]) // pinned left endpoint still pulls its neighbor
    point(3, initial[6], initial[7]) // unlinked
    point(4, initial[8], initial[9]) // zero-weight spring and absent neighbor
    break
  }
  case 'mouse':
    point(1, origin + 44, origin) // 8 units to the right, clamped to the 10-unit minimum
    break
  case 'attractors':
    point(1, initial[2] - 3, initial[3] + 2)
    point(2, initial[4] - 1.5, initial[5] + 1)
    point(3, initial[6], initial[7]) // missing attractor
    point(4, initial[8], initial[9]) // zero weight
    break
  case 'clusters':
    point(1, origin + 40 + ((-50 + 40 + 20) / 3 - 40) / 8, origin + (30 + 24) / 3 / 8)
    point(3, origin - 40 + 56 / 8, origin - 16 + 48 / 8)
    point(4, initial[8], initial[9]) // zero weight
    point(5, initial[10], initial[11]) // unassigned
    break
  case 'repulsion':
    expect(xy[2]).toBeGreaterThan(initial[2] + 1) // rightmost live point
    expect(xy[9]).toBeLessThan(initial[9] - 0.5) // lowest live point
    break
  }
}

it.each(forceCases.filter(fixture => !isScaleCase(fixture)))('compares packaged %s at fixed ticks', async fixture => {
  const sessions: ForceSession[] = []
  const initial = forcePositions(fixture)
  const hierarchy = fixture === 'hierarchy'
  const checkpoints = hierarchy ? [0, 1, 4, 8, 16, 31, 32] : [0, 1, 4, 8]
  let previous = [initial, initial] as Float32Array[]
  let lastTick = 0
  let firstMotion: number[] = []
  const records = []
  try {
    for (const engine of ['webgl', 'webgpu'] as const) {
      sessions.push(await createForcePreview(document.body, engine, fixture))
    }
    const devices = sessions.map(session => session.device)
    if (import.meta.env.LAB_NATIVE_GPU) {
      expect(devices[0].gpuType).not.toBe('cpu')
      expect(devices[1].fallback).toBe(false)
    } else {
      expect(devices[0].renderer).toMatch(/SwiftShader/i)
      expect(devices[1].gpuArchitecture).toBe('swiftshader')
    }
    for (const tick of checkpoints) {
      const positions = await Promise.all(sessions.map(session => session.advance(tick - lastTick)))
      const pair = positionStats(positions[1], positions[0])
      const stats = positions.map((xy, i) => positionStats(xy, previous[i]))
      const motion = stats.map(s => s.rmsDelta)
      const radius = stats.map(s => s.radius)
      let combined
      if (fixture === 'combined') {
        const [gl, gpu] = positions.map(combinedMetrics)
        combined = { webgl: gl, webgpu: gpu, positions: positions.map(xy => [...xy]) }
        // A two-endpoint distance can differ by at most twice the per-point Euclidean error.
        const lengthBudget = 2 * Math.SQRT2 * 0.01
        expect.soft(Math.abs(gl.penetration - gpu.penetration)).toBeLessThan(lengthBudget)
        gl.linkLengths.forEach((v, i) => expect.soft(Math.abs(v - gpu.linkLengths[i])).toBeLessThan(lengthBudget))
        expect.soft(Math.abs(motion[0] - motion[1])).toBeLessThan(lengthBudget)
        if (!tick) expect(gl.penetration).toBeGreaterThan(0)
      }
      records.push({ tick, combined, different: pair.different, maxDelta: pair.maxDelta, rmsDelta: pair.rmsDelta, radius, motion })
      for (const [i, xy] of positions.entries()) {
        expect(xy.length).toBe(initial.length)
        expect([...xy.subarray(0, 2)]).toEqual([...initial.subarray(0, 2)])
        expect(xy[absentIndex * 2]).toBeNaN()
        expect(xy[absentIndex * 2 + 1]).toBeNaN()
        if (!tick || (fixture === 'mouse' && tick === 8)) expect(motion[i]).toBe(0)
        if (tick === 1) checkFirstStep(fixture, initial, xy)
      }
      if (tick === 1) firstMotion = motion
      if (hierarchy) {
        expect(pair.rmsDelta / radius[0]).toBeLessThan(0.05)
        expect(Math.abs(radius[1] / radius[0] - 1)).toBeLessThan(0.05)
        if (tick === 32) {
          for (let i = 0; i < 2; i++) {
            expect(radius[i]).toBeGreaterThan(1.5 * records[0].radius[i])
            expect(firstMotion[i]).toBeGreaterThan(1)
            expect(motion[i]).toBeLessThan(firstMotion[i] * 0.05)
          }
        }
      } else {
        // One hundredth of a graph unit at 1 CSS pixel/unit; report exact counts separately.
        expect(pair.maxDelta).toBeLessThan(0.01)
        if (['springs', 'attractors', 'clusters', 'repulsion'].includes(fixture)) expect(pair.different).toBe(0)
      }
      previous = positions
      lastTick = tick
    }
    await writeArtifact(`package-forces-${fixture}`, { fixture, devices, records })
  } finally {
    for (const session of sessions) session.destroy()
  }
})

it('preserves the active spring topology through weight edits, link replacement and simulation restart', async () => {
  const reference = await replaySpringEdits('webgl')
  const candidate = await replaySpringEdits('webgpu')
  for (const [edit, expected] of Object.entries(reference)) {
    const actual = candidate[edit as keyof typeof candidate]
    expect(new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength), edit)
      .toEqual(new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength))
  }

  const { initial, weighted, zeroWeight, replaced, disabled, reenabled, resumed } = reference
  expect(weighted[2]).toBeLessThan(initial[2]) // Initial spring pulls point 1 toward pin 0.
  expect(weighted[4]).toBe(initial[4])
  expect(zeroWeight).toEqual(weighted)
  expect(replaced[2]).toBeGreaterThan(zeroWeight[2]) // Replacement spring connects 1 to 2.
  expect(replaced[4]).toBeLessThan(zeroWeight[4])
  expect(disabled).toEqual(replaced)
  expect(reenabled).toEqual(disabled)
  expect(resumed[2]).toBeGreaterThan(reenabled[2])
  expect(resumed[4]).toBeLessThan(reenabled[4])
  for (const xy of Object.values(reference)) {
    expect(xy).toHaveLength(6)
    expect(xy.slice(0, 2)).toEqual(initial.slice(0, 2))
    expect(xy.every(Number.isFinite)).toBe(true)
  }
})

it('updates cluster centroids and point attractions after live edits and simulation restart', async () => {
  const { phases: gl } = await replayAttractionEdits('webgl')
  const { phases: gpu, device } = await replayAttractionEdits('webgpu')
  for (const [phase, reference] of Object.entries(gl)) {
    const actual = gpu[phase as keyof typeof gpu]
    // SwiftShader's WebGL control rounds one resumed x coordinate one float32 step higher at 2,120.
    const threshold = device.gpuArchitecture === 'swiftshader' && (phase === 'resumed' || phase === 'cleared') ? 2 ** -12 : 0
    expect(positionStats(actual.xy, reference.xy).maxDelta, phase).toBeLessThanOrEqual(threshold)
    expect(actual.centroids.length, phase).toBe(reference.centroids.length)
    reference.centroids.forEach((value, i) => {
      if (Number.isNaN(value)) expect(actual.centroids[i], phase).toBeNaN()
      else expect(Math.abs(actual.centroids[i] - value), phase).toBeLessThanOrEqual(threshold)
    })
    expect([...actual.xy.slice(0, 2)]).toEqual([origin - 50, origin + 30]) // pin
    expect([...actual.xy.slice(12, 14)]).toEqual([NaN, NaN]) // absent
  }

  const { initial, first, edited, pulled, reweighted, disabled, resumed, cleared } = gpu
  expect(first.xy[2]).toBeLessThan(initial.xy[2])
  expect(edited.xy[2]).toBe(origin + 24)
  for (const { xy, centroids } of [edited, pulled, reweighted, disabled, resumed]) {
    // Sparse cluster IDs 1 and 3. Cluster 3 includes the absent slot, which contributes no mass.
    expect(centroids).toHaveLength(8)
    expect([centroids[0], centroids[1], centroids[4], centroids[5]]).toEqual([NaN, NaN, NaN, NaN])
    for (const axis of [0, 1]) {
      expect(centroids[2 + axis]).toBeCloseTo((xy[4 + axis] + xy[6 + axis]) / 2, 3)
      expect(centroids[6 + axis]).toBeCloseTo((xy[axis] + xy[2 + axis]) / 2, 3)
    }
  }
  expect(pulled.xy[2]).toBeLessThan(edited.xy[2]) // point 1 moves toward the live centroid
  expect(pulled.xy[4]).toBeGreaterThan(edited.xy[4]) // point 2 moves toward the explicit cluster target
  expect(pulled.xy[10]).toBe(edited.xy[10] + (origin + 64 - edited.xy[10]) / 8) // half-strength point attractor
  expect(pulled.xy[14]).toBe(edited.xy[14])
  expect(reweighted.xy[2]).toBe(pulled.xy[2]) // zero cluster strength
  expect(reweighted.xy[10]).toBe(pulled.xy[10]) // zero attractor strength
  expect(reweighted.xy[14]).toBeLessThan(pulled.xy[14])
  expect(disabled.xy).toEqual(reweighted.xy)
  expect(resumed.xy[14]).toBeLessThan(disabled.xy[14])
  expect(cleared.xy).toEqual(resumed.xy)
  expect(cleared.centroids).toHaveLength(0)
})

it('applies four held-button impulses when the responsive previews run straight to tick eight', async () => {
  const host = document.createElement('div')
  host.style.width = '560px'
  document.body.append(host)
  const view = createForcesView(host, 'mouse')
  try {
    const end = host.querySelector<HTMLButtonElement>('[data-end]')!
    await vi.waitFor(() => expect(end.disabled).toBe(false), { timeout: 10000 })
    end.click()
    await vi.waitFor(() => {
      expect(host.querySelector('[data-force-result]')?.textContent).toContain('Tick 8. All 7 present point positions match exactly.')
    }, { timeout: 10000 })
    const radii = Array.from(host.querySelectorAll('.package-forces-panels [role="status"]'), label => label.textContent)
    // Prevent two ignored pointers from passing the paired comparison.
    expect(radii).toEqual(['RMS radius 44.313 graph units', 'RMS radius 44.313 graph units'])
  } finally {
    view.destroy()
    host.remove()
  }
})

// CSS coordinates fixed from the native WebGL reference before running the candidate.
// Link 0 is deliberately isolated from other links and points at both midpoints.
const combinedProbes = [
  { xy: [79, 61], initial: 'Background', final: 'Link 0' },
  { xy: [72, 84], initial: 'Link 0', final: 'Background' },
  { xy: [44, 40], initial: 'Point 0', final: 'Point 0' },
] as const

type ProbeResult = { xy: readonly [number, number]; expected: string; actual: string; rgba: number[] }

async function checkCombinedProbes (session: ForceSession, state: 'initial' | 'final'): Promise<ProbeResult[]> {
  const results = []
  for (const { xy, [state]: expected } of combinedProbes) {
    const [x, y] = xy
    const rgba = session.readPixel(x, y)
    const actual = await session.click(x, y)
    const color = expected === 'Point 0' ? [242, 107, 71, 255] : expected === 'Link 0' ? [255, 199, 107, 255] : [24, 32, 43, 255]
    expect.soft(rgba, `paint at ${x},${y} in ${state} layout`).toEqual(color)
    expect.soft(actual, `click at ${x},${y} in ${state} layout`).toBe(expected)
    results.push({ xy, expected, actual, rgba })
  }
  return results
}

it('draws and picks the simulated link after reset, batch stepping and individual steps', async () => {
  const records = []
  for (const engine of ['webgl', 'webgpu'] as const) {
    let batchPositions: number[] | undefined
    for (const batch of [true, false]) {
      const session = await createForcePreview(document.body, engine, 'combined')
      try {
        let xy = await session.advance(0)
        const initial = await checkCombinedProbes(session, 'initial')
        const stepsPerUpdate = batch ? 8 : 1
        for (let tick = 0; tick < 8; tick += stepsPerUpdate) xy = await session.advance(stepsPerUpdate)
        if (batch) batchPositions = [...xy]
        else expect([...xy]).toEqual(batchPositions)
        const final = await checkCombinedProbes(session, 'final')
        records.push({ engine, batch, device: session.device, initial, final, xy: [...xy] })
      } finally { session.destroy() }
    }
  }
  await writeArtifact('package-forces-combined-picks', { browser: navigator.userAgent, records })
})

it('changes the WebGL trajectory when any one of the three forces is disabled', async () => {
  const records = []
  let reference: Float32Array | undefined
  for (const disabled of [undefined, 'simulationLinkSpring', 'simulationRepulsion', 'simulationCollision'] as const) {
    const session = await createForcePreview(document.body, 'webgl', 'combined', { config: disabled ? { [disabled]: 0 } : {} })
    try {
      await session.advance(0)
      const xy = await session.advance(8)
      reference ??= xy
      const { maxDelta } = positionStats(xy, reference)
      if (disabled) expect.soft(maxDelta, `disabling ${disabled} should move a coordinate beyond the parity budget`).toBeGreaterThan(0.01)
      records.push({ disabled: disabled ?? 'none', maxDelta, xy: [...xy], metrics: combinedMetrics(xy), device: session.device })
    } finally { session.destroy() }
  }
  await writeArtifact('package-forces-combined-reference', { browser: navigator.userAgent, records })
})
