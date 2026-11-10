import { expect, it } from 'vitest'
import { Buffer } from '@luma.gl/core'
import { Kernel } from '@luma.gl/engine'
import { deviceForTest } from '../../gpu/test-device'
import { bindingLayout, readFloats, upload } from '../../gpu/luma'
import { createFixture, PARAMETERS } from '../many-body/data'
import { buildReference, frameFor } from './data'
import { comparePresent, gridReference } from './reference'
import { createGridWebGPU } from './webgpu'
import { compareStructure } from './validation'
import { createTrace, traceChecks } from './trace'
import { centroidReference, centroidRounding } from './centroids'
import square from './rounded-square.wgsl?raw'

it('rounds squared significands exactly across every normal-result exponent, both signs and boundary significands', async context => {
  const device = await deviceForTest(); if (!device) { context.skip(); return }
  const owned: Array<{ destroy(): void }> = []
  const own = <T extends { destroy(): void }>(r: T): T => { owned.push(r); return r }
  try {
    const bits: number[] = []; let seed = 42
    for (let exponent = 64; exponent <= 190; exponent++) {
      for (let i = 0; i < 256; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        const fraction = i < 4 ? [0, 1, 0x7ffffe, 0x7fffff][i] : seed & 0x7fffff
        const value = (exponent << 23) | fraction
        bits.push(value, value | 0x80000000)
      }
    }
    const inputBits = new Uint32Array(bits); const values = new Float32Array(inputBits.buffer)
    const input = own(upload(device, inputBits))
    const output = own(device.createBuffer({ byteLength: inputBits.byteLength, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
    const kernel = own(await Kernel.createAsync(device, {
      id: 'rounded-square-corpus',
      source: `${square}
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < arrayLength(&input)) { output[id.x] = bitcast<u32>(roundedSquare(bitcast<f32>(input[id.x]))); }
}`,
      shaderLayout: { bindings: bindingLayout([['input', 'read-only-storage'], ['output', 'storage']]) },
    }))
    const pass = device.beginComputePass()
    try { kernel.dispatch(pass, { x: Math.ceil(bits.length / 64), bindings: { input, output } }) } finally { pass.end() }
    device.submit()
    const actual = await readFloats(output)
    const expected = Float32Array.from(values, value => value * value)
    expect(new Uint32Array(actual.buffer)).toEqual(new Uint32Array(expected.buffer))
    expect(bits.length).toBe(65024)
  } finally { owned.reverse().forEach(r => r.destroy()); device.destroy() }
})

for (const mode of ['materialized', 'streamed'] as const) {
  for (const count of [8192, 16384]) {
    it(`${mode}, ${count} dense points: refined stored contributions pass three CPU-anchored ticks at the original tolerance`, async () => {
      const input = createFixture('clusters', count)
      let points = input.points
      const backend = await createGridWebGPU(document.createElement('canvas'), input, PARAMETERS, frameFor(points, 0), mode)
      try {
        for (let tick = 0; tick < 3; tick++) {
          const frame = frameFor(points, tick)
          backend.setPositions(points); backend.setFrame(frame); backend.step()
          const actual = await backend.read(); const structure = await backend.readStructure()
          expect(compareStructure(structure, buildReference(points, frame)).valid).toBe(true)
          expect(centroidRounding(await backend.readCentroids!(), centroidReference(structure)).differingComponents).toBe(0)
          const expectedTrace = createTrace(count)
          const expected = gridReference(input, points, PARAMETERS, frame, buildReference(points, frame), expectedTrace)
          const result = comparePresent(actual, expected, points)
          expect(result.valid, JSON.stringify({ tick, result })).toBe(true)
          const trace = await backend.diagnose!()
          expect(comparePresent({ ...actual, forces: trace.forces }, actual, points).valid).toBe(true)
          const stages = traceChecks(trace.trace, expectedTrace, points)
          expect(stages.every(stage => stage.check.valid), JSON.stringify({ tick, stages })).toBe(true)
          points = expected.positions
        }
      } finally { backend.destroy() }
    })
  }
  for (const fixture of ['uniform', 'coincident', 'boundary', 'edge-cases'] as const) {
    for (const precise of [true, false]) {
      it(`${mode}, ${fixture}, precise=${precise}: preserves the original force law and absent/pinned points`, async () => {
        const input = createFixture(fixture, 65)
        const frame = frameFor(input.points, 0, 8, precise)
        const backend = await createGridWebGPU(document.createElement('canvas'), input, PARAMETERS, frame, mode)
        try {
          backend.step()
          const expected = gridReference(input, input.points, PARAMETERS, frame, buildReference(input.points, frame))
          const result = comparePresent(await backend.read(), expected, input.points)
          expect(result.valid, JSON.stringify(result)).toBe(true)
        } finally { backend.destroy() }
      })
    }
  }
}

for (const mode of ['inline', 'materialized', 'streamed'] as const) {
  it(`${mode}: timestamps span batched grid work without advancing the source positions`, async () => {
    const input = createFixture('uniform', 65); const frame = frameFor(input.points, 0)
    const backend = await createGridWebGPU(document.createElement('canvas'), input, PARAMETERS, frame, mode)
    const expected = gridReference(input, input.points, PARAMETERS, frame, buildReference(input.points, frame))
    try {
      for (const stage of ['force', 'step'] as const) {
        const result = await backend.measure(stage, 4)
        expect(comparePresent(result.snapshot, stage === 'force' ? { ...expected, positions: input.points } : expected, input.points).valid).toBe(true)
        expect(['valid', 'unavailable']).toContain(result.timing.timerStatus)
        expect(result.timing.batchGpuMs === null || result.timing.batchGpuMs >= 0).toBe(true)
        expect((await backend.read()).positions).toEqual(input.points)
      }
      backend.step()
      expect(comparePresent(await backend.read(), expected, input.points).valid).toBe(true)
    } finally { backend.destroy() }
  })
}
