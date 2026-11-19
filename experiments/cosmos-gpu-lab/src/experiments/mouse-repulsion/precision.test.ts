import { Buffer } from '@luma.gl/core'
import { expect, it } from 'vitest'
import { createDevice, readFloats, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { writeArtifact } from '../../testing/artifacts'
import { createFixture } from '../many-body/data'
import { measureBatch, summarize, timestamps, type Measurement, type TimestampWrites } from '../many-body/timing'
import { movingFixture, semanticsFixture, type Vector } from './data'
import { mouseReference } from './reference'
import { createMouseWebGPU } from './webgpu'

const observedPointer: Vector = [-1.0235331058502197, 3.7198379039764404]
const count = 8192

function discrepancies (actual: Float32Array, expected: Float32Array): {
  mismatches: number; maxError: number; first?: { component: number; expected: number; actual: number };
} {
  let mismatches = 0
  let maxError = 0
  let first: ReturnType<typeof discrepancies>['first']
  for (const [i, element] of expected.entries()) {
    // A zero force has the same effect with either sign.
    if (actual[i] === element) continue
    mismatches++
    maxError = Math.max(maxError, Math.abs(actual[i] - element))
    first ??= { component: i, expected: element, actual: actual[i] }
  }
  return { mismatches, maxError, first }
}

it('matches final mouse-force rounding for faint forces and keeps native fallback outside the expanded range', async () => {
  const timed = import.meta.env.LAB_MOUSE_REPULSION_STUDY
  const run = import.meta.env.LAB_RUN_ID
  const source = import.meta.env.LAB_SOURCE_REVISION
  const snapshot = import.meta.env.LAB_SOURCE_SNAPSHOT
  if (timed) expect(run && source && snapshot).toBeTruthy()
  let hidden = document.visibilityState !== 'visible'
  const visibility = (): void => { hidden ||= document.visibilityState !== 'visible' }
  const visible = (): void => {
    if (timed && (hidden || document.visibilityState !== 'visible' || navigator.userAgent.includes('HeadlessChrome'))) {
      throw new Error('Use continuously visible native Chrome for the pointer timing')
    }
  }
  const device = await createDevice('webgpu', undefined, timed)
  document.addEventListener('visibilitychange', visibility)
  const scope = resourceScope()
  const rows = []
  const samples: Array<{ arithmetic: 'native' | 'expanded'; sample: number; timing: Measurement }> = []
  let error: string | undefined
  try {
    expect(device.info.fallback).toBe(false)
    const observed = createFixture('uniform', count).points
    observed[2] = 1; observed[7] = 1
    const points = scope.own(upload(device, observed))
    const forces = scope.own(device.createBuffer({ byteLength: observed.byteLength, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
    const kernels = {
      native: scope.own(await createMouseWebGPU(device, forces)),
      expanded: scope.own(await createMouseWebGPU(device, forces, undefined, 'expanded')),
    }
    const encode = (arithmetic: keyof typeof kernels, timing?: TimestampWrites): void => {
      const pass = device.beginComputePass(timing)
      try { kernels[arithmetic].encode(pass, points) } finally { pass.end() }
    }
    const cases: Array<{ name: string; points: Float32Array; world: Vector; strength: number; nativeFallback?: boolean }> = [
      { name: 'clamp and masks', points: semanticsFixture().points, world: [0, 0], strength: 2 },
      { name: 'signed strength', points: semanticsFixture().points, world: [0, 0], strength: -2 },
      { name: 'translated', points: movingFixture(count, [2048, -1024]).points, world: [2033.75, -1010.625], strength: -1.35 },
      { name: 'faint distant force', points: new Float32Array([1e12, 0, 0, 0]), world: [0, 0], strength: 1e-13 },
      { name: 'native fallback', points: new Float32Array([8, 0, 0, 0]), world: [0, 0], strength: 1e25, nativeFallback: true },
      { name: 'observed pointer', points: observed, world: observedPointer, strength: 2 },
    ]
    for (const trial of cases) {
      points.write(trial.points)
      const expected = mouseReference(trial.points, trial.world, trial.strength).forces
      let reference = expected
      for (const arithmetic of ['native', 'expanded'] as const) {
        kernels[arithmetic].prepare(trial.points.length / 4, trial.world, trial.strength)
        encode(arithmetic)
        device.submit()
        const actual = await readFloats(forces, trial.points.byteLength)
        rows.push({
          arithmetic,
          input: trial.name,
          points: trial.points.length / 4,
          world: trial.world,
          strength: trial.strength,
          reference: reference === expected ? 'CPU' : 'native',
          ...discrepancies(actual, reference),
        })
        if (trial.nativeFallback && arithmetic === 'native') {
          expect(expected[0]).toBeGreaterThan(0)
          expect(actual[0]).toBeGreaterThan(0)
          reference = actual
        }
      }
    }
    if (timed) {
      // The last trial leaves the observed frozen input and uniforms resident.
      for (let sample = -2; sample < 7; sample++) {
        const order = sample % 2 ? ['expanded', 'native'] as const : ['native', 'expanded'] as const
        for (const arithmetic of order) {
          visible()
          const timing = await measureBatch(device, 16, (query, begin, end) => encode(arithmetic, timestamps(query, begin, end)))
          samples.push({ arithmetic, sample, timing })
        }
      }
      visible()
    }
    expect(rows.filter(row => row.arithmetic === 'expanded' && row.mismatches), JSON.stringify(rows)).toEqual([])
  } catch (cause) { error = String(cause); throw cause } finally {
    document.removeEventListener('visibilitychange', visibility)
    try {
      if (run) {
        await writeArtifact('mouse-expanded-precision', {
          source,
          snapshot,
          browser: navigator.userAgent,
          adapter: device.info,
          seed: 29471,
          rows,
          samples,
          ...(timed
            ? {
              timing: Object.fromEntries((['native', 'expanded'] as const).map(arithmetic => [
                arithmetic, summarize(samples.filter(sample => sample.sample >= 0 && sample.arithmetic === arithmetic).map(sample => sample.timing)),
              ])),
            }
            : {}),
          error,
        })
      }
    } finally { scope.destroy(); device.destroy() }
  }
}, 90000)
