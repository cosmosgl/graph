import { pick, type RgbaSnapshot } from '../../gpu/rgba-readback'
import { sourceAlphaByte } from '../../gpu/source-alpha'
import { compareColors, type Comparison, type ColorResult } from './reference'
import type { Scene, Settings } from './data'

const LANES = ['webgl', 'webgpu'] as const
export function firstAlphaBoundary (opacity: number): number[] {
  const value = new Float32Array([0.5 / 255 / Math.fround(opacity)])
  const bits = new Uint32Array(value.buffer); const center = bits[0]
  return [-1, 0, 1].map(offset => { bits[0] = center + offset; return value[0] })
}
export function faintAlphaCases (): Array<{ name: string; alpha: number; opacity: number; ratio: number;
  overlap: boolean; reverse: boolean; blend: boolean; }> {
  const rows = []
  for (const opacity of [0, 0.35, 1]) {
    const [below, boundary, above] = firstAlphaBoundary(opacity || 1)
    for (const [name, alpha] of Object.entries({
      zero: 0,
      tiny: 1 / 65536,
      below,
      boundary,
      above,
      byte: 1 / 255 / Math.fround(opacity || 1),
      translucent: 0.35,
      opaque: 1,
    })) {
      for (const overlap of [false, true]) rows.push({ name, alpha, opacity, ratio: 1, overlap, reverse: false, blend: true })
    }
  }
  for (const opacity of [0.35, 1]) {
    for (const [index, alpha] of firstAlphaBoundary(opacity).entries()) {
      for (const overlap of [false, true]) {
        rows.push({ name: `retina-${index - 1}`, alpha, opacity, ratio: 2, overlap, reverse: false, blend: true })
      }
      rows.push({ name: `reversed-${index - 1}`, alpha, opacity, ratio: 1, overlap: true, reverse: true, blend: true })
    }
  }
  for (const opacity of [0, 0.35, 1]) {
    for (const overlap of [false, true]) {
      rows.push({ name: 'hard-tiny', alpha: 1 / 65536, opacity, ratio: 1, overlap, reverse: false, blend: false })
    }
  }
  return rows
}

// Width-zero background preserves original source IDs in isolation. No shader,
// coverage rule or reference is changed by the replay.
export function faintAlphaScene (curve: boolean, alpha: number, overlap: boolean): Scene {
  return {
    points: [{ x: 80, y: curve ? 200 : 160.5 }, { x: 432, y: curve ? 200 : 160.5 }],
    links: [
      { source: 0, target: 1, width: overlap ? 14 : 0, color: [0.2, 0.5, 0.85, 1] },
      { source: 0, target: 1, width: 6, color: [0.95, 0.6, 0.3, alpha] },
    ],
  }
}
function visibility (frame: RgbaSnapshot, isolated: RgbaSnapshot, sourceId: number): {
  selected: number; invisible: number; first?: { x: number; y: number; frameRgba: number[]; sourceRgba: number[] };
} {
  const result: ReturnType<typeof visibility> = { selected: 0, invisible: 0 }
  for (let i = 0; i < frame.ids.length; i += 4) {
    const id = frame.ids[i] + frame.ids[i + 1] * 256 + frame.ids[i + 2] * 65536 - 1
    if (id !== sourceId) continue
    result.selected++
    if (isolated.color[i + 3] === 0) {
      result.invisible++
      result.first ??= {
        x: (i / 4) % frame.width,
        y: Math.floor(i / 4 / frame.width),
        frameRgba: Array.from(frame.color.subarray(i, i + 4)),
        sourceRgba: Array.from(isolated.color.subarray(i, i + 4)),
      }
    }
  }
  return result
}
export type FaintAlphaRow<S extends Settings = Settings> = {
  entry: ReturnType<typeof faintAlphaCases>[number]; settings: S; scene: Scene;
  lanes: Array<{
    lane: typeof LANES[number]; preservation: ColorResult;
    productionSource: ReturnType<typeof visibility>; candidateSource: ReturnType<typeof visibility>;
    probe: { x: number; y: number; productionId: number | null; candidateId: number | null; sourceRgba: number[] };
  }>;
  fullCoverageAlpha: number; fullCoveragePredictedByte: number; production: Comparison; candidate: Comparison;
}
export async function replayFaintAlpha<S extends Settings, T extends RgbaSnapshot> (options: {
  curve: boolean; defaults: S;
  render(lane: typeof LANES[number], scene: Scene, settings: S, candidate: boolean): Promise<T>;
  compare(a: T, b: T, scene: Scene, settings: S): Promise<Comparison>;
}): Promise<FaintAlphaRow<S>[]> {
  const rows: FaintAlphaRow<S>[] = []
  for (const entry of faintAlphaCases()) {
    const settings = { ...options.defaults, opacity: entry.opacity, ratio: entry.ratio, reverse: entry.reverse, blend: entry.blend }
    const scene = faintAlphaScene(options.curve, entry.alpha, entry.overlap)
    const input = faintAlphaScene(options.curve, entry.alpha, false)
    const frames = []; const originals = []; const lanes = []
    const probe = options.curve ? [256, 122] : [150, 160]
    const x = probe[0] * settings.ratio; const y = probe[1] * settings.ratio
    for (const lane of LANES) {
      const original = await options.render(lane, scene, settings, false)
      const frame = await options.render(lane, scene, settings, true)
      const isolated = entry.overlap ? await options.render(lane, input, settings, true) : frame
      const offset = (y * frame.width + x) * 4
      lanes.push({
        lane,
        preservation: compareColors(original.color, frame.color),
        productionSource: visibility(original, isolated, 1),
        candidateSource: visibility(frame, isolated, 1),
        probe: {
          x,
          y,
          productionId: pick(original, x, y),
          candidateId: pick(frame, x, y),
          sourceRgba: Array.from(isolated.color.subarray(offset, offset + 4)),
        },
      })
      originals.push(original); frames.push(frame)
    }
    rows.push({
      entry,
      settings,
      scene,
      lanes,
      fullCoverageAlpha: Math.fround(Math.fround(entry.alpha) * Math.fround(settings.opacity)),
      fullCoveragePredictedByte: sourceAlphaByte(Math.fround(Math.fround(entry.alpha) * Math.fround(settings.opacity))),
      production: await options.compare(originals[0], originals[1], scene, settings),
      candidate: await options.compare(frames[0], frames[1], scene, settings),
    })
  }
  return rows
}
