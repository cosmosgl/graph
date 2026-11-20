import type { Device } from '@luma.gl/core'
import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { FIXTURES as CURVES, DEFAULTS as curveDefaults, fixture as curveFixture } from '../curved-links/data'
import { compare as compareCurves, reference as curveReference } from '../curved-links/reference'
import { createCurvesWebGL } from '../curved-links/webgl'
import { createCurvesWebGPU } from '../curved-links/webgpu'
import { EFFECTS_FIXTURES, effectScenario } from '../point-styling/effects-fixtures'
import { effectsCpuColors } from '../point-styling/effects-reference'
import { compareSnapshotsAsync } from '../point-styling/reference'
import { createStylingWebGL } from '../point-styling/webgl'
import { createStylingWebGPU } from '../point-styling/webgpu'
import { FIXTURES as LINKS, DEFAULTS as linkDefaults, fixture as linkFixture } from '../straight-links/data'
import { gradientScene } from '../straight-links/gradient-fixtures'
import type { Pattern } from '../straight-links/patterns'
import { compare as compareLinks } from '../straight-links/reference'
import { createLinksWebGL } from '../straight-links/webgl'
import { createLinksWebGPU } from '../straight-links/webgpu'

const study = it.skipIf(import.meta.env.VITE_LAB_MOTION_FEATURES !== '1')
const ratios = [1, 2]
const zooms = [1, 0.73, 1.23]
const patterns: Record<string, Pattern> = { overlap: 'dashed', limits: 'dotted' }

function moved<T extends { x: number; y: number }> (point: T, id: number, frame: number): T {
  return { ...point, x: point.x + frame * (id % 3 - 1) * 3.375, y: point.y + frame * (id % 5 - 2) * 1.625 }
}

type Renderer = { info: string; destroy(): void }
async function replay<GL extends Renderer, GPU extends Renderer & { adapter: Device['info'] }> (
  name: string, createGl: (canvas: HTMLCanvasElement) => Promise<GL>, createGpu: (canvas: HTMLCanvasElement) => Promise<GPU>,
  compare: (gl: GL, gpu: GPU, rows: unknown[]) => Promise<void>
): Promise<void> {
  const rows: unknown[] = []
  const record: Record<string, unknown> = {
    rows,
    browser: navigator.userAgent,
    luma: '10.0.0-alpha.15',
    source: import.meta.env.LAB_SOURCE_REVISION,
    snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    run: import.meta.env.LAB_RUN_ID,
    status: 'started',
  }
  const host = document.createElement('div')
  host.style.display = 'flex'
  const a = document.createElement('canvas'); const b = document.createElement('canvas')
  for (const canvas of [a, b]) canvas.style.cssText = 'display:block;width:512px;height:320px'
  host.append(a, b); document.body.append(host)
  let gl: GL | undefined
  let gpu: GPU | undefined
  try {
    expect(document.visibilityState).toBe('visible')
    expect(navigator.userAgent).not.toContain('HeadlessChrome')
    expect(record.source && record.snapshot && record.run).toBeTruthy()
    const view = host.getBoundingClientRect()
    expect(view.left >= 0 && view.top >= 0 && view.right <= innerWidth && view.bottom <= innerHeight).toBe(true)
    record.viewport = [innerWidth, innerHeight]
    gl = await createGl(a)
    gpu = await createGpu(b)
    record.devices = { webgl: gl.info, webgpu: gpu.adapter }
    expect(gpu.adapter.fallback).toBe(false)
    await compare(gl, gpu, rows)
    expect(rows).toHaveLength(24)
    expect(document.visibilityState).toBe('visible')
    record.status = 'complete'
  } catch (error) {
    record.status = 'failed'
    record.error = String(error)
    throw error
  } finally {
    gpu?.destroy(); gl?.destroy(); host.remove()
    await writeArtifact(name, record)
  }
}

study('compares moving shapes, strokes, images, rings and point ownership', async () => {
  await replay('viewer-motion-points', createStylingWebGL, createStylingWebGPU, async (gl, gpu, rows) => {
    for (const name of EFFECTS_FIXTURES) {
      for (const ratio of ratios) {
        for (const [frame, zoom] of zooms.entries()) {
          const { points, settings } = effectScenario(name, [0, 2, 4][frame], {
            ratio, zoom, sizeScale: 1.03125, reverse: frame === 2,
          })
          const positions = points.map((point, id) => moved(point, id, frame))
          const a = await gl.render(positions, settings, false, 'eligibility')
          const b = await gpu.render(positions, settings, false, 'eligibility')
          const result = await compareSnapshotsAsync(a, b, positions, settings)
          const cpuColors = { webgl: effectsCpuColors(a, positions, settings), webgpu: effectsCpuColors(b, positions, settings) }
          rows.push({ name, ratio, frame, zoom, result, cpuColors })
        }
      }
    }
  })
}, 180000)

study('compares moving straight link caps, gradients, patterns and ownership', async () => {
  await replay('viewer-motion-ribbons', createLinksWebGL, createLinksWebGPU, async (gl, gpu, rows) => {
    for (const name of LINKS) {
      const scene = gradientScene(linkFixture(name), 'endpoint-alpha')
      for (const ratio of ratios) {
        for (const [frame, zoom] of zooms.entries()) {
          const pattern = patterns[name] ?? 'solid'
          const settings = { ...linkDefaults, ratio, zoom, pattern, endpointColors: true, widthScale: 0.875, reverse: frame === 2 }
          const positions = { ...scene, points: scene.points.map((point, id) => moved(point, id, frame)) }
          const a = await gl.render(positions, settings, 'visible')
          const b = await gpu.render(positions, settings, 'visible')
          rows.push({ name, ratio, frame, zoom, pattern, result: await compareLinks(a, b, positions, settings) })
        }
      }
    }
  })
}, 180000)

study('compares moving curved link caps, gradients, patterns and ownership', async () => {
  await replay('viewer-motion-curves', createCurvesWebGL, createCurvesWebGPU, async (gl, gpu, rows) => {
    for (const name of CURVES) {
      const scene = gradientScene(curveFixture(name), 'endpoint-alpha')
      for (const ratio of ratios) {
        for (const [frame, zoom] of zooms.entries()) {
          const pattern = patterns[name] ?? 'solid'
          const settings = { ...curveDefaults, ratio, zoom, pattern, endpointColors: true, widthScale: 0.875, reverse: frame === 2 }
          const positions = { ...scene, points: scene.points.map((point, id) => moved(point, id, frame)) }
          const a = await gl.render(positions, settings, 'front')
          const b = await gpu.render(positions, settings, 'front')
          rows.push({ name, ratio, frame, zoom, pattern, result: await compareCurves(a, b, curveReference(positions, settings)) })
        }
      }
    }
  })
}, 180000)
