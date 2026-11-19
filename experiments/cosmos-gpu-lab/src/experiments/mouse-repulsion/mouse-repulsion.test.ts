import { expect, it, vi } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { replaceCanvas } from '../../gpu/force-preview'
import { compareArray, type Snapshot } from '../many-body/reference'
import type { Measurement } from '../many-body/timing'
import { createBackend, type Api, type MouseBackend } from './backend'
import {
  DEFAULT_STRENGTH, movingFixture, pointerRepulsionActive, screenToWorld, semanticsFixture, viewFor, type Camera, type Vector, type Viewport,
} from './data'
import { compareMouse, mouseReference } from './reference'
import { createView } from './view'

const APIS = ['webgl', 'webgpu'] as const
const held = { simulationEnabled: true, rightClickRepulsionEnabled: true, secondaryHeld: true }
const phases = [
  { name: 'Running with right button', active: true, running: true, gate: held },
  { name: 'Running with relocated pointer', active: true, running: true, gate: held },
  { name: 'Paused with right button', active: true, running: false, gate: held },
  { name: 'Paused after release', active: false, running: false, gate: { ...held, secondaryHeld: false } },
  { name: 'Paused with option disabled', active: false, running: false, gate: { ...held, rightClickRepulsionEnabled: false } },
  { name: 'Simulation globally disabled', active: false, running: false, gate: { ...held, simulationEnabled: false } },
  { name: 'Paused after re-enable and resize', active: true, running: false, gate: held },
  { name: 'Paused with signed strength', active: true, running: false, gate: held },
] as const
const PLAN = { cases: [12, 1024, 8192], phases, warmups: 2, samples: 7, operations: 16, seed: 29471 }

function testCanvas (): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = 340
  return canvas
}

it('maps CSS pointer offsets through pan, zoom and the flipped world Y axis', () => {
  const viewport = { width: 480, height: 340 }
  const camera = { origin: [-120, 2048], translation: [-100, 80], zoom: 1.5 } as const
  expect(screenToWorld([260, 110], viewport, camera)).toEqual([-120, 2198])
  expect(screenToWorld([260, 110], { width: 640, height: 400 }, camera)).toEqual([-200, 2228])
  expect(viewFor(viewport, camera)).toEqual([...screenToWorld([240, 170], viewport, camera), 3 / 480, 3 / 340])
})

it('respects the clamp, squared distance and independent right-button gate', () => {
  const input = semanticsFixture()
  const result = mouseReference(input.points, [0, 0], DEFAULT_STRENGTH)
  expect(result.forces[0]).toBeCloseTo(1.2, 6)
  expect(result.forces[1]).toBeCloseTo(1.6, 6)
  expect(result.forces[4]).toBeCloseTo(-1.2, 6)
  expect(result.forces[5]).toBeCloseTo(-1.6, 6)
  expect(result.forces[8]).toBeCloseTo(0.3, 6)
  expect(result.forces[9]).toBeCloseTo(-0.4, 6)
  expect(Array.from(result.forces.slice(24, 28))).toEqual([0, 0, 0, 0])
  expect(Array.from(result.positions.slice(28, 40))).toEqual(Array.from(input.points.slice(28, 40)))
  expect(result.forces[28]).toBeGreaterThan(0)
  expect(mouseReference(input.points, [0, 0], -DEFAULT_STRENGTH).forces[0]).toBeCloseTo(-1.2, 6)
  for (const phase of phases) expect(pointerRepulsionActive({ ...phase.gate })).toBe(phase.active)
})

for (const api of APIS) {
  it(`${api} compares force and integration on clamp, axes, pins and absence, then releases and resumes without reset`, async () => {
    const input = semanticsFixture()
    const backend = await createBackend(api, testCanvas(), input)
    try {
      let world: Vector = [0, 0]
      backend.setPointer(world, DEFAULT_STRENGTH)
      expect(backend.stepWhenHeld(held)).toBe(true)
      const first = await backend.read()
      const check = compareMouse(first, mouseReference(input.points, world, DEFAULT_STRENGTH), input.points, world, api === 'webgl')
      if (!check.valid) await writeArtifact(`mouse-${api}-semantics`, { check, first, input, environment: backend.environment() })
      expect(check.valid, JSON.stringify(check)).toBe(true)
      for (const phase of phases.filter(p => !p.active)) {
        expect(backend.stepWhenHeld(phase.gate)).toBe(false)
        expect((await backend.read()).positions).toEqual(first.positions)
      }
      world = [12.25, -14.5]
      backend.setPointer(world, -DEFAULT_STRENGTH)
      expect(backend.stepWhenHeld(held)).toBe(true)
      const changed = compareMouse(await backend.read(), mouseReference(first.positions, world, -DEFAULT_STRENGTH), first.positions, world, api === 'webgl')
      expect(changed.valid, JSON.stringify(changed)).toBe(true)
    } finally { backend.destroy(); backend.destroy() }
  })
}

it('updates the live paired preview while held and stops after a still release', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const view = await createView(host)
  try {
    const canvas = host.querySelector<HTMLCanvasElement>('[data-webgpu]')!
    const status = host.querySelector('[role="status"]')!
    const step = host.querySelector<HTMLButtonElement>('[data-step]')!
    expect(step.disabled, status.textContent ?? '').toBe(false)
    const rect = canvas.getBoundingClientRect()
    const pointer = { isPrimary: true, button: 2, clientX: rect.x + 20, clientY: rect.y + 20 }
    canvas.dispatchEvent(new PointerEvent('pointermove', { ...pointer, buttons: 2 }))
    await vi.waitFor(() => expect(status.textContent).toMatch(/[1-9]\d* pointer steps/))
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }))
    const released = status.textContent
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    expect(status.textContent).toBe(released)
    step.click()
    const checks = host.querySelector('[data-check]')!
    await vi.waitFor(() => expect(checks.textContent).toContain('WebGPU passed'))
    expect(checks.textContent).toContain('WebGL passed')
  } finally { view.destroy(); host.remove() }
})

type Check = ReturnType<typeof compareMouse>
type Row = {
  count: number; api: Api; phase: string; running: boolean; world: Vector; strength: number;
  gateMatches: boolean; exactWhenSkipped: boolean | null; sameInput: Check | null; trajectory: ReturnType<typeof compareArray> | null;
  witness?: { index: number; before: number[]; actual: number[]; expected: number[] };
}
type Timing = { count: number; api: Api; sample: number; measurement: Measurement }
type Environment = { count: number; api: Api; adapter: ReturnType<MouseBackend['environment']> }
type Report = {
  status: 'running' | 'complete' | 'error'; plan: typeof PLAN; errors: string[];
  provenance: { revision: string; snapshot: string }; environment: Environment[];
  rows: Row[]; timings: Timing[]; postTiming: Array<{ count: number; api: Api; check: Check; positionsUnchanged: boolean }>;
  pairs: Array<{ count: number; check: Check }>;
  coincident: Partial<Record<Api, { force: number[]; position: number[] }>>;
}

function exact (a: Float32Array, b: Float32Array): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
}

function rowPasses (row: Row): boolean {
  return row.gateMatches && row.exactWhenSkipped !== false && row.sameInput?.valid !== false && row.trajectory?.valid !== false
}

it.skipIf(!import.meta.env.LAB_MOUSE_REPULSION_STUDY)('records the visible native mouse repulsion matrix and isolated force timings', async () => {
  const revision = import.meta.env.LAB_SOURCE_REVISION as string
  const snapshot = import.meta.env.LAB_SOURCE_SNAPSHOT as string
  const run = import.meta.env.LAB_RUN_ID as string
  expect(revision).toMatch(/^[a-f0-9]{40}$/)
  expect(snapshot).not.toBe('')
  expect(run).not.toBe('')
  const report: Report = {
    status: 'running',
    plan: PLAN,
    errors: [],
    provenance: { revision, snapshot },
    environment: [],
    rows: [],
    timings: [],
    postTiming: [],
    pairs: [],
    coincident: {},
  }
  let interrupted = document.visibilityState !== 'visible'
  const onVisibility = (): void => { interrupted ||= document.visibilityState !== 'visible' }
  const visible = (): void => { if (interrupted || document.visibilityState !== 'visible') throw new Error('Study requires continuous visibility') }
  document.addEventListener('visibilitychange', onVisibility)
  const host = document.createElement('div')
  const canvases = { webgl: testCanvas(), webgpu: testCanvas() }
  host.append(canvases.webgl, canvases.webgpu)
  document.body.append(host)
  try {
    for (const count of PLAN.cases) {
      visible()
      const origin: Vector = count === 8192 ? [2048, -1024] : [0, 0]
      const input = count === 12 ? semanticsFixture() : movingFixture(count, origin)
      const backends: Partial<Record<Api, MouseBackend>> = {}
      const camera: Camera = count === 8192 ? { origin, translation: [-105, -103], zoom: 1.5 } : { origin, translation: [0, 0], zoom: 1 }
      const viewport: Viewport = { width: 480, height: 340 }
      const pointerAt = (phase: number): Vector => {
        if (phase === 0) return origin
        const current = phase >= 6 ? { width: 640, height: 400 } : viewport
        return screenToWorld([current.width / 2 + 18.25, current.height / 2 - 6.5], current, camera)
      }
      try {
        for (const api of APIS) {
          canvases[api] = replaceCanvas(canvases[api])
          const backend = await createBackend(api, canvases[api], input)
          backends[api] = backend
          const adapter = backend.environment()
          report.environment.push({ count, api, adapter })
          if (adapter.device.fallback || adapter.device.gpu === 'software') throw new Error(`${api}: expected native device`)
          backend.render(viewFor(viewport, camera))
        }
        let cpu: Float32Array = input.points.slice()
        const previous = { webgl: input.points, webgpu: input.points }
        for (const [index, phase] of (count === 12 ? phases.slice(0, 1) : phases).entries()) {
          visible()
          const world = pointerAt(index)
          const strength = index === phases.length - 1 ? -DEFAULT_STRENGTH : DEFAULT_STRENGTH
          if (phase.active) cpu = mouseReference(cpu, world, strength).positions
          let sharedWebGL: Snapshot | undefined
          for (const api of APIS) {
            const backend = backends[api]!
            backend.setPointer(world, strength)
            const ran = backend.stepWhenHeld(phase.gate)
            const before = previous[api]
            const actual = await backend.read()
            const expected = mouseReference(before, world, strength)
            const sameInput = ran ? compareMouse(actual, expected, before, world, api === 'webgl') : null
            const trajectory = count !== 12 ? compareArray(actual.positions, cpu, input.points) : null
            const row: Row = {
              count,
              api,
              phase: phase.name,
              running: phase.running,
              world,
              strength,
              gateMatches: ran === phase.active,
              exactWhenSkipped: ran ? null : exact(actual.positions, before),
              sameInput,
              trajectory,
            }
            if (!rowPasses(row)) {
              const useForce = sameInput?.forces.valid === false
              const worst = sameInput ? (useForce ? sameInput.forces : sameInput.positions) : trajectory
              const i = Math.max(0, Math.floor((worst?.worstIndex ?? 0) / 4) * 4)
              const values = (state: Snapshot): number[] => Array.from((useForce ? state.forces : state.positions).subarray(i, i + 4))
              row.witness = { index: i / 4, before: Array.from(before.subarray(i, i + 4)), actual: values(actual), expected: values(expected) }
            }
            report.rows.push(row)
            if (index === 0 && api === 'webgl') sharedWebGL = actual
            if (sharedWebGL && api === 'webgpu') report.pairs.push({ count, check: compareMouse(actual, sharedWebGL, before, world, true) })
            if (count === 12) {
              report.coincident[api] = {
                force: Array.from(actual.forces.subarray(24, 26)), position: Array.from(actual.positions.subarray(24, 26)),
              }
            }
            previous[api] = actual.positions
          }
        }
        for (const api of APIS) {
          backends[api]!.setPositions(input.points)
          backends[api]!.setPointer(origin, DEFAULT_STRENGTH)
          backends[api]!.render(viewFor(viewport, camera))
        }
        for (let sample = -PLAN.warmups; sample < PLAN.samples; sample++) {
          for (const api of (sample % 2 ? [...APIS].reverse() : APIS)) {
            visible()
            const measurement = await backends[api]!.measureForce(PLAN.operations)
            visible()
            report.timings.push({ count, api, sample, measurement })
          }
        }
        for (const api of APIS) {
          const actual = await backends[api]!.read()
          const expected = { ...mouseReference(input.points, origin, DEFAULT_STRENGTH), positions: input.points }
          const check = compareMouse(actual, expected, input.points, origin, api === 'webgl')
          report.postTiming.push({ count, api, check, positionsUnchanged: exact(actual.positions, input.points) })
        }
      } finally { for (const backend of Object.values(backends)) backend.destroy() }
    }
    visible()
    report.status = 'complete'
  } catch (error) {
    report.status = 'error'
    report.errors.push(String(error))
    throw error
  } finally {
    document.removeEventListener('visibilitychange', onVisibility)
    host.remove()
    await writeArtifact('mouse-repulsion-native', report)
  }
  expect(report.rows).toHaveLength(34)
  expect(report.timings).toHaveLength(54)
  expect(report.postTiming).toHaveLength(6)
  expect(report.pairs).toHaveLength(3)
  expect(report.rows.filter(row => !rowPasses(row))).toEqual([])
  expect(report.postTiming.filter(row => !row.check.valid || !row.positionsUnchanged)).toEqual([])
  expect(report.pairs.filter(row => !row.check.valid)).toEqual([])
}, 180000)
