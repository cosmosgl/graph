import { expect, it, vi } from 'vitest'
import { commands } from 'vitest/browser'
import { describeEnvironment } from '../../gpu/force-preview'
import { graphRgba } from '../../runtime/palette'
import { writeArtifact } from '../../testing/artifacts'
import { createIntegrated, nextFrame, type Integrated } from '../integrated-webgpu/runtime'
import { fit } from '../integrated-webgpu/validation'
import { comparePaint, type PaintComparison } from './evaluate'
import type { Production } from './production'
import { LINK_VISIBILITY, styles } from './styles'

declare module 'vitest/browser' {
  interface BrowserCommands {
    composedInput(action: 'layout'): Promise<unknown>;
    composedInput(action: 'pick', from: [number, number]): Promise<void>;
  }
}

const size = [480, 320] as const
const nativeStudy = import.meta.env.VITE_LAB_MOTION_STYLES === '1'

function visible (): void {
  expect(document.visibilityState).toBe('visible')
  expect(navigator.userAgent).not.toContain('HeadlessChrome')
}

it.skipIf(!nativeStudy)('compares fractional circle and link styles on moving geometry', async () => {
  const rows: Array<{ tick: number; ratio: number; alternate: boolean; paint: PaintComparison }> = []
  const record: Record<string, unknown> = {
    rows,
    viewport: size,
    source: import.meta.env.LAB_SOURCE_REVISION,
    snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    run: import.meta.env.LAB_RUN_ID,
    productionSha256: import.meta.env.VITE_LAB_PRODUCTION_SHA256,
    status: 'started',
  }
  const host = document.createElement('div')
  const control = document.createElement('iframe')
  control.title = 'Production WebGL viewer'
  const canvas = document.createElement('canvas')
  host.style.display = 'flex'
  for (const element of [control, canvas]) element.style.cssText = `display:block;border:0;width:${size[0]}px;height:${size[1]}px`
  const ready = new Promise<void>((resolve, reject) => {
    control.onload = (): void => resolve()
    control.onerror = (): void => reject(new Error('The production control failed to load'))
  })
  control.src = '/production-viewer.html'
  host.append(control, canvas)
  document.body.append(host)
  let gl: Production | undefined
  let gpu: Integrated | undefined
  try {
    visible()
    expect(record.source && record.snapshot && record.run && record.productionSha256).toBeTruthy()
    await ready
    gl = await (control.contentWindow as Window & { cosmosProduction: Promise<Production> }).cosmosProduction
    gpu = await createIntegrated(canvas, 'karate', 34, { paint: { smoothLinks: true, linkDistanceOpacity: LINK_VISIBILITY } })
    record.production = gl.info
    record.environment = describeEnvironment(gpu.backend.positionSource!().device, canvas)
    expect(gpu.backend.positionSource!().device.info.fallback).toBe(false)

    for (const ratio of [1, 2]) {
      await gl.replace('karate')
      await gpu.replace('karate', 34)
      gl.graph.setConfigPartial({ pixelRatio: ratio })
      gpu.resize(...size, ratio)
      await gl.frame(false)
      expect([gl.canvas.width, gl.canvas.height]).toEqual(size.map(dimension => dimension * ratio))
      fit(gpu, (await gpu.backend.read()).positions)
      gpu.zoom(1.23, canvas.width / 2, canvas.height / 2)
      const checkpoints = [1, 4, 8, 12]
      for (const tick of checkpoints) {
        visible()
        const alternate = tick >= 8
        const style = styles(34, alternate)
        gl.style(alternate)
        style.sizes.forEach((value, id) => { style.sizes[id] = value + (id % 2 ? 0.75 : -0.25) })
        gl.graph.setPointSizes(style.sizes)
        style.sizes.forEach((diameter, id) => gpu!.renderer.setStyle(id, Array.from(style.colors.subarray(id * 4, id * 4 + 4)), diameter))
        gpu.renderer.setLinkStyle(style.link, style.width)
        while (gpu.tick < tick) {
          await nextFrame()
          await gpu.frame(true)
        }
        gpu.pan(0.375 * ratio, -0.25 * ratio)
        rows.push({ tick, ratio, alternate, paint: await comparePaint(gl, gpu, { smoothLinks: true, distanceOpacity: true }) })
      }
    }
    const interior = rows.map(({ paint }) => [paint.interiorIdFailures, paint.interiorColorFailures, paint.candidateInvisiblePicks])
    expect(rows.every(({ paint }) => paint.nonempty)).toBe(true)
    expect(interior).toEqual(rows.map(() => [0, 0, 0]))
    record.status = 'complete'
  } catch (error) {
    record.status = 'failed'
    record.error = String(error)
    throw error
  } finally { gpu?.destroy(); gl?.destroy(); host.remove(); await writeArtifact('viewer-motion-styles', record) }
}, 120000)

it.skipIf(!nativeStudy)('picks the top visible point or link as GPU positions and opacity change', async () => {
  visible()
  const host = document.createElement('div')
  host.dataset.composedStudy = 'true'
  const canvas = document.createElement('canvas')
  canvas.style.cssText = `display:block;width:${size[0]}px;height:${size[1]}px`
  host.append(canvas)
  document.body.append(host)
  let gpu: Integrated | undefined
  const results: unknown[] = []
  try {
    const viewer = await createIntegrated(canvas, 'chain', 4, { paint: { smoothLinks: true }, linkPicking: true })
    gpu = viewer
    await commands.composedInput('layout')
    const pick = async (): Promise<{ kind: string; id: number | null } | null> => {
      const count = viewer.feedback.length
      await commands.composedInput('pick', [size[0] / 2, size[1] / 2])
      await vi.waitFor(() => expect(viewer.feedback).toHaveLength(count + 1))
      const hit = viewer.feedback.at(-1)!
      return hit.object ? { kind: hit.object, id: hit.id } : null
    }
    for (const ratio of [1, 2]) {
      const start = viewer.feedback.length
      gpu.resize(...size, ratio)
      gpu.renderer.camera = { x: 0, y: 0, zoom: 1 }
      gpu.patchPositions(0, new Float32Array([-40, 0, 0, 0, 40, 0, 0, 0, 0, -24, 0, 0, 0, 24, 0, 0]))
      gpu.renderer.setStyle(2, graphRgba.point, 5.75)
      gpu.renderer.setLinkStyle([0.2, 0.6, 0.9, 0.35], 2.25)
      await gpu.frame(false)
      const [x, y] = gpu.screen(0, 0)
      const offset = (Math.floor(y) * canvas.width + Math.floor(x)) * 4
      const before = await gpu.renderer.snapshotColor({})
      const crossing = await pick()
      const highlighted = await gpu.renderer.snapshotColor({})
      expect(highlighted[offset]).toBeGreaterThan(before[offset])
      gpu.patchPositions(2, new Float32Array([0, -1, 0, 0]))
      gpu.renderer.setStyle(2, [0.9, 0.2, 0.3, 0.03], 5.75)
      await gpu.frame(false)
      const covered = await pick()
      gpu.renderer.setStyle(2, [0.9, 0.2, 0.3, 0], 5.75)
      await gpu.frame(false)
      const exposed = await pick()
      gpu.renderer.setLinkStyle([0.2, 0.6, 0.9, 0.001], 2.25)
      await gpu.frame(false)
      const invisible = await pick()
      results.push({ ratio, crossing, covered, exposed, invisible, feedback: viewer.feedback.slice(start) })
      expect([crossing, covered, exposed, invisible]).toEqual([
        { kind: 'link', id: 2 }, { kind: 'point', id: 2 }, { kind: 'link', id: 2 }, null,
      ])
    }
  } finally { gpu?.destroy(); host.remove(); await writeArtifact('viewer-motion-object-picks', results) }
}, 45000)
