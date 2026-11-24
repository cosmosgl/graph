import { expect, it, vi } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { positionStats } from './compare'
import { absentIndex, forceCases, forcePositions, origin, type ForceCase } from './fixture'
import { createForcePreview, type ForceSession } from './frame'
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

it.each(forceCases)('compares packaged %s at fixed ticks', async fixture => {
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
      records.push({ tick, different: pair.different, maxDelta: pair.maxDelta, rmsDelta: pair.rmsDelta, radius, motion })
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
