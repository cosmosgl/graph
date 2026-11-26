import type { DeviceInfo } from '@luma.gl/core'
import type { Graph } from '../../../../../dist/index.js'
import { lineConfig, lineViewport } from '../production-lines/fixture'
import { withLinkGraph } from './link-graph'
import type { Engine } from './frame'

type Probe = 'point' | 'witness' | 'stroke' | 'background'
type Control = { pixels: ImageData; pick: string; rgb: number[] }
export type CrossingSample = {
  phase: 'before' | 'during' | 'after';
  time: number;
  strokeY: number;
  pixels: ImageData;
  colors: Record<Probe, number[]>;
  picks: Record<Probe, string>;
  linkOnly: Control;
}

const { width, height } = lineViewport
const phases = ['before', 'during', 'after'] as const

function positions (endpointY: number, withPoint: boolean): Float32Array {
  // CSS endpoints (32, y) and (224, y), with an unrelated point at (128, 80).
  const y = 256 + height / 2 - endpointY
  const xy = [160, y, 352, y]
  if (withPoint) xy.push(256, 256)
  return Float32Array.from(xy)
}

type CrossingFrame = Pick<CrossingSample, 'pixels' | 'phase' | 'time' | 'strokeY'> & {
  click(x: number, y: number): Promise<string>;
  rgb(x: number, y: number): number[];
}

/** Each foreground uses the same link-only control, camera, endpoints, clock and public pointer events. */
export async function replayCurve<C, S> (engine: Engine, ratio: 1 | 2, scene: {
  configurePoint?(graph: Graph): void;
  control(frame: CrossingFrame): Promise<C>;
  sample(frame: CrossingFrame, control: C): Promise<S>;
}): Promise<{ deviceInfo: DeviceInfo; samples: S[] }> {
  return withLinkGraph(engine, ratio, {
    ...lineConfig('curved', ratio),
    backgroundColor: '#000',
    linkDefaultColor: '#0f0',
    linkDefaultWidth: 8,
    curvedLinkControlPointDistance: 0.25,
    transitionEasing: 'linear',
  }, async ({ graph, deviceInfo, win, capture, click }) => {
    let now = win.performance.now()
    Object.defineProperty(win.performance, 'now', { configurable: true, value: () => now })
    const controls: C[] = []
    const samples: S[] = []
    for (const withPoint of [false, true]) {
      graph.setPointPositions(positions(72, withPoint), true)
      graph.setLinks(Float32Array.of(0, 1))
      graph.setPointSizes(withPoint ? Float32Array.of(6, 6, 24) : Float32Array.of(6, 6))
      const colors = [0.6, 0.6, 0.6, 1, 0.6, 0.6, 0.6, 1]
      if (withPoint) colors.push(1, 0, 0, 1)
      graph.setPointColors(Float32Array.from(colors))
      if (withPoint) scene.configurePoint?.(graph)
      graph.render(undefined, 0)
      graph.pause()
      graph.setViewTransform({ k: 1, x: 0, y: 0 }, [width, height])
      const start = now
      graph.setPointPositions(positions(136, withPoint), true)
      graph.render(undefined, 1000)
      for (const [i, phase] of phases.entries()) {
        const time = i * 500
        now = start + time
        graph.renderOneFrame()
        const pixels = capture()
        const rgb = (x: number, y: number): number[] => {
          const offset = 4 * (y * ratio * pixels.width + x * ratio)
          return Array.from(pixels.data.subarray(offset, offset + 3))
        }
        // At t=1/4 on this quadratic, the left shoulder is 18 CSS px above its endpoints.
        const frame = { phase, time, pixels, strokeY: 54 + i * 32, click, rgb }
        if (withPoint) samples.push(await scene.sample(frame, controls[i]!))
        else controls.push(await scene.control(frame))
      }
    }
    return { deviceInfo, samples }
  })
}

export function runCurvedCrossing (engine: Engine, ratio: 1 | 2): Promise<{ deviceInfo: DeviceInfo; samples: CrossingSample[] }> {
  return replayCurve<Control, CrossingSample>(engine, ratio, {
    control: async ({ pixels, click, rgb }) => ({ pixels, pick: await click(128, 80), rgb: rgb(128, 80) }),
    sample: async ({ phase, time, strokeY, pixels, click, rgb }, linkOnly) => ({
      phase,
      time,
      strokeY,
      pixels,
      linkOnly,
      picks: { point: await click(128, 80), witness: await click(160, 83), stroke: await click(80, strokeY), background: await click(16, 16) },
      colors: { point: rgb(128, 80), witness: rgb(160, 83), stroke: rgb(80, strokeY), background: rgb(16, 16) },
    }),
  })
}
