import { expect, it } from 'vitest'
import type { DeviceInfo } from '@luma.gl/core'
import type { Engine } from '../production-graph-api/frame'
import { writeArtifact } from '../../testing/artifacts'
import { positionStats } from './compare'
import { forceConfig } from './fixture'
import { createForcePreview, type ForceSession } from './frame'
import { scaleFixture, type ScaleCase, type ScaleFixture } from './scale-fixture'
import { scaleCheckpoints, scaleMetrics } from './scale-metrics'
import { scaleProbes } from './scale-probes'

const topologies = ['dense', 'hubs'] as const
type Checkpoint = {
  tick: number;
  xy: Float32Array;
  radius: number;
  rmsMotion: number;
  quality: ReturnType<typeof scaleMetrics>;
  probes: ProbeRead[];
}
type ForceSwitch = 'simulationLinkSpring' | 'simulationRepulsion' | 'simulationCollision'

async function digest (array: Float32Array | Int8Array | Uint32Array): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', array.slice().buffer)
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
}

async function describe (fixture: ScaleFixture): Promise<{
  metadata: ScaleFixture['metadata'];
  config: ReturnType<typeof forceConfig>;
  hashes: Record<string, string>;
  browser: string;
  source: string;
  snapshot: string;
}> {
  const inputs = { ...fixture, pinned: Uint32Array.from(fixture.pinned) }
  const names = ['positions', 'links', 'weights', 'sizes', 'colors', 'linkColors', 'linkWidths', 'pinned', 'communities'] as const
  const hashes = await Promise.all(names.map(async name => [name, await digest(inputs[name])]))
  return {
    metadata: fixture.metadata,
    config: forceConfig(fixture.metadata.kind),
    hashes: Object.fromEntries(hashes),
    browser: navigator.userAgent,
    source: import.meta.env.LAB_SOURCE_REVISION,
    snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
  }
}

function assertAdapter (engine: Engine, device: DeviceInfo): void {
  if (import.meta.env.LAB_NATIVE_GPU) {
    expect(device.gpuType).not.toBe('cpu')
    if (engine === 'webgpu') expect(device.fallback).toBe(false)
  } else if (engine === 'webgpu') expect(device.gpuArchitecture).toBe('swiftshader')
  else expect(device.renderer).toMatch(/SwiftShader/i)
}

function topologyFailure (session: ForceSession, fixture: ScaleFixture): number | undefined {
  for (let i = 0; i < fixture.links.length / 2; i++) {
    const [a, b] = session.linkEndpoints(i)
    if (a !== fixture.links[2 * i] || b !== fixture.links[2 * i + 1]) return i
  }
  if (session.linkEndpoints(fixture.links.length / 2).length) return fixture.links.length / 2
  return undefined
}

type ProbeRead = {
  xy: [number, number];
  expected: string;
  picked: string;
  rgba: number[];
  painted: number[];
  maxChannelDelta: number;
}

async function checkPaintAndPicks (session: ForceSession, tick: number): Promise<ProbeRead[]> {
  const results = []
  for (const { xy, expected, rgba, description } of scaleProbes(tick)) {
    const painted = session.readPixel(...xy)
    const picked = await session.click(...xy)
    const maxChannelDelta = Math.max(...painted.map((value, i) => Math.abs(value - rgba[i])))
    expect.soft(maxChannelDelta, `tick ${tick} ${description} paint`).toBeLessThanOrEqual(2)
    expect.soft(picked, `tick ${tick} ${description} click`).toBe(expected)
    results.push({ xy, expected, picked, rgba, painted, maxChannelDelta })
  }
  return results
}

async function trajectory (engine: Engine, kind: ScaleCase, label: string, disabled?: ForceSwitch): Promise<{ device: DeviceInfo; records: Checkpoint[] }> {
  const fixture = scaleFixture(kind)
  const session = await createForcePreview(document.body, engine, kind, { config: disabled ? { [disabled]: 0 } : {} })
  const records: Checkpoint[] = []
  let previous: Float32Array = fixture.positions
  let previousTick = 0
  try {
    assertAdapter(engine, session.device)
    const screenCenter = session.project(fixture.worldOrigin, fixture.worldOrigin)
    expect(screenCenter.map(Math.round)).toEqual([144, 96])
    expect(topologyFailure(session, fixture), 'public endpoints in fixture order').toBeUndefined()
    for (const tick of disabled ? [0, 8] : scaleCheckpoints) {
      let xy = previous
      // Limit outstanding submissions on software adapters. Only the named checkpoints enter the comparison.
      for (let i = previousTick; i < tick; i += 8) xy = await session.advance(Math.min(8, tick - i))
      if (!tick) xy = await session.advance(0)
      const movedPin = fixture.pinned.find(id => xy[2 * id] !== fixture.positions[2 * id] || xy[2 * id + 1] !== fixture.positions[2 * id + 1])
      const invalid = xy.findIndex((v, offset) => Math.floor(offset / 2) === 1 ? !Number.isNaN(v) : !Number.isFinite(v))
      if (xy.length !== fixture.positions.length || invalid >= 0 || movedPin !== undefined) {
        await writeArtifact(`scale-${kind}-${label}-failure`, { tick, disabled, device: session.device, invalid, movedPin, xy: [...xy] })
        throw new Error(`Invalid positions at tick ${tick}: ${xy.length} coordinates, first invalid ${invalid}, moved pin ${movedPin}`)
      }
      const { radius, rmsDelta } = positionStats(xy, previous, 1)
      const probes = disabled ? [] : await checkPaintAndPicks(session, tick)
      records.push({ tick, xy, radius, rmsMotion: rmsDelta, quality: scaleMetrics(fixture, xy), probes })
      if (!tick) expect(rmsDelta).toBe(0)
      previous = xy
      previousTick = tick
    }
    return { device: session.device, records }
  } finally { session.destroy() }
}

function serializable (records: Checkpoint[]): (Omit<Checkpoint, 'xy'> & { xy: number[] })[] {
  return records.map(record => ({ ...record, xy: [...record.xy] }))
}

// Run with -t 'records two WebGL' before opening the candidate for a new fixture.
it.each(topologies)('records two WebGL %s trajectories and isolated force contributions', async kind => {
  const fixture = scaleFixture(kind)
  const spec = await describe(fixture)
  expect(spec.metadata.pointCount).toBe(8192)
  if (kind === 'hubs') {
    expect(spec.metadata.hubPinned).toBe(false)
    expect(spec.metadata.largestIncomingDegree).toBeGreaterThan(4 * scaleFixture('dense').metadata.largestIncomingDegree)
  }
  const reference = await trajectory('webgl', kind, 'control-a')
  await writeArtifact(`scale-${kind}-control-a`, { spec, device: reference.device, records: serializable(reference.records) })
  const repeat = await trajectory('webgl', kind, 'control-b')
  const differences = repeat.records.map((r, i) => ({ tick: r.tick, ...positionStats(r.xy, reference.records[i].xy, 1) }))
  await writeArtifact(`scale-${kind}-control-b`, { spec, device: repeat.device, differences, records: serializable(repeat.records) })
  const atEight = reference.records.find(r => r.tick === 8)!
  const spread = differences.find(r => r.tick === 8)!.maxDelta
  const controls = []
  for (const disabled of ['simulationLinkSpring', 'simulationRepulsion', 'simulationCollision'] as const) {
    const variant = await trajectory('webgl', kind, disabled, disabled)
    const result = variant.records[1]
    const delta = positionStats(result.xy, atEight.xy, 1)
    controls.push({ disabled, tick: result.tick, delta, quality: result.quality, xy: [...result.xy] })
    expect.soft(delta.maxDelta, disabled).toBeGreaterThan(Math.max(0.01, spread))
  }
  await writeArtifact(`scale-${kind}-force-controls`, { spec, repeatSpreadAt8: spread, controls })
}, 1200000)

it.each(topologies)('compares packaged %s layouts through 100 ticks', async kind => {
  const fixture = scaleFixture(kind)
  const spec = await describe(fixture)
  const gl = await trajectory('webgl', kind, 'paired-webgl')
  const gpu = await trajectory('webgpu', kind, 'paired-webgpu')
  expect((await describe(fixture)).hashes, 'public setters preserved caller inputs').toEqual(spec.hashes)
  const pairs = gl.records.map((r, i) => {
    const candidate = gpu.records[i]
    const pair = positionStats(candidate.xy, r.xy, 1)
    const rmsFraction = pair.rmsDelta / r.radius
    const radiusFraction = Math.abs(candidate.radius - r.radius) / r.radius
    const retentionLosses = r.quality.communities.map((c, j) => c.retainedFraction - candidate.quality.communities[j].retainedFraction)
    const worstRetentionLoss = Math.max(...retentionLosses)
    const label = `${kind} tick ${r.tick}`
    expect.soft(rmsFraction, `${label} paired displacement fraction`).toBeLessThan(0.05)
    expect.soft(radiusFraction, `${label} radius fraction`).toBeLessThan(0.05)
    expect.soft(worstRetentionLoss, `${label} loss of community retention`).toBeLessThanOrEqual(0.01)
    return { tick: r.tick, pair, rmsFraction, radiusFraction, worstRetentionLoss }
  })
  for (const lane of [gl, gpu]) {
    const first = lane.records[1].rmsMotion
    expect.soft(first).toBeGreaterThan(0)
    expect.soft(lane.records.at(-1)!.rmsMotion, 'last step smaller than first').toBeLessThan(first)
  }
  await writeArtifact(`scale-${kind}-paired`, {
    spec,
    pairs,
    webgl: { device: gl.device, records: serializable(gl.records) },
    webgpu: { device: gpu.device, records: serializable(gpu.records) },
  })
}, 1200000)
