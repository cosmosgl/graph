import { expect, it } from 'vitest'
import { describeEnvironment } from '../../gpu/force-preview'
import { writeArtifact } from '../../testing/artifacts'
import { createIntegrated, type Integrated } from '../integrated-webgpu/runtime'
import { fit } from '../integrated-webgpu/validation'
import { comparePaint, type PaintComparison } from './evaluate'
import type { Production } from './production'
import { LINK_VISIBILITY, styles } from './styles'

const WITNESS_LINK = 32
const VIEWPORT = [960, 320, 2] as const

function rgbaAt (bytes: Uint8Array, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 4
  return Array.from(bytes.subarray(offset, offset + 4))
}

function maxError (a: number[], b: number[]): number {
  return Math.max(...a.map((value, i) => Math.abs(value - b[i])))
}

function opacityModel (points: number[], endpoints: number[], zoom: number, color: number[]): {
  endpoints: number[][]; cssLength: number; multiplier: number; color: number[]; expected: number[];
} {
  const [a, b] = endpoints.map(index => points.slice(index * 4, index * 4 + 2))
  const cssLength = Math.hypot(b[0] - a[0], b[1] - a[1]) * zoom
  const [near, far] = LINK_VISIBILITY.range
  const multiplier = Math.max(LINK_VISIBILITY.minimum, (cssLength - far) / (near - far))
  const quantize = (alpha: number): number[] => [...color.slice(0, 3), 1].map(c => Math.round(c * alpha * 255))
  return { endpoints: [a, b], cssLength, multiplier, color, expected: quantize(color[3] * multiplier) }
}

type Probe = {
  link: number; endpoints: number[]; pixel: number[]; widthInCssPixels: number;
  production: ReturnType<typeof opacityModel>; candidate: ReturnType<typeof opacityModel>;
  bytes: { production: number[]; rangeControl: number[]; constantCandidate: number[]; distanceCandidate: number[] };
}

async function probeLink (gl: Production, gpu: Integrated, comparison: PaintComparison): Promise<Probe> {
  const witness = comparison.colorAttribution?.links.witness
  if (!witness) throw new Error('The original link-only witness is missing')
  const { x, y } = witness
  const endpoints = Array.from(gpu.data.graph.links.subarray(WITNESS_LINK * 2, WITNESS_LINK * 2 + 2))
  const width = gpu.canvas.width
  const zoom = comparison.camera[2]
  const originalColors = gl.graph.getLinkColors()
  const original = Array.from(originalColors.subarray(WITNESS_LINK * 4, WITNESS_LINK * 4 + 4))
  const production = opacityModel(Array.from(gl.positions()), endpoints, zoom, original)
  const candidate = opacityModel(comparison.geometry, endpoints, zoom, gpu.renderer.linkStyle.color)
  const pixels = (image: Uint8Array): number[] => rgbaAt(image, width, x, y)
  const masked = new Float32Array(originalColors.length)
  masked.set(original, WITNESS_LINK * 4)
  let productionBytes: number[]; let rangeControl: number[]
  try {
    // Keep every edge and its original width. Make the other links transparent
    // using production's public channel so the real shader still draws the witness.
    gl.graph.setLinkColors(masked)
    gl.graph.render(undefined, 0)
    await gl.frame(false)
    productionBytes = pixels(gl.snapshot(false, { points: false }))
    // With the near threshold at zero, every positive projected length uses
    // the minimum factor of 1. The original A/B RGBA and geometry stay fixed.
    gl.graph.setConfigPartial({ linkVisibilityDistanceRange: [0, LINK_VISIBILITY.range[1]] })
    await gl.frame(false)
    rangeControl = pixels(gl.snapshot(false, { points: false }))
  } finally {
    gl.graph.setConfigPartial({ linkVisibilityDistanceRange: [...LINK_VISIBILITY.range] })
    gl.graph.setLinkColors(new Float32Array())
    gl.graph.render(undefined, 0)
    await gl.frame(false)
  }
  const link = { linkIndex: WITNESS_LINK, points: false }
  const constantCandidate = pixels(await gpu.renderer.snapshotColor(link))
  const distanceCandidate = pixels(await gpu.renderer.snapshotColor({ ...link, linkDistanceOpacity: LINK_VISIBILITY }))
  return {
    link: WITNESS_LINK,
    endpoints,
    pixel: [x, y],
    widthInCssPixels: gpu.renderer.linkStyle.width,
    production,
    candidate,
    bytes: { production: productionBytes, rangeControl, constantCandidate, distanceCandidate },
  }
}

it.skipIf(import.meta.env.VITE_LAB_PAINT_LINK_OPACITY !== '1')('traces real viewer link opacity and replays the original interior color gate', async () => {
  expect(document.visibilityState).toBe('visible')
  expect(navigator.userAgent).not.toContain('HeadlessChrome')
  expect(devicePixelRatio).toBe(VIEWPORT[2])
  expect(import.meta.env.LAB_RUN_ID && import.meta.env.LAB_SOURCE_REVISION && import.meta.env.LAB_SOURCE_SNAPSHOT).toBeTruthy()
  const host = document.createElement('div')
  const iframe = document.createElement('iframe')
  iframe.title = 'Production WebGL viewer'
  const canvas = document.createElement('canvas')
  for (const element of [iframe, canvas]) element.style.cssText = `display:block;border:0;width:${VIEWPORT[0]}px;height:${VIEWPORT[1]}px`
  const loaded = new Promise<void>((resolve, reject) => {
    iframe.onload = (): void => resolve()
    iframe.onerror = (): void => reject(new Error('Production viewer failed to load'))
  })
  iframe.src = new URL('/production-viewer.html', location.href).href
  host.append(iframe, canvas); document.body.append(host)
  let gl: Production | undefined; let gpu: Integrated | undefined
  const rows = []
  try {
    await loaded
    gl = await (iframe.contentWindow as Window & { cosmosProduction: Promise<Production> }).cosmosProduction
    gpu = await createIntegrated(canvas, 'karate', 34)
    gpu.resize(...VIEWPORT, 'floor')
    fit(gpu, (await gpu.backend.read()).positions)
    await gpu.frame(false)
    const environment = describeEnvironment(gpu.backend.positionSource!().device, canvas)
    expect(gl.info).toMatch(/Apple M3/)
    expect(environment.device.fallback).toBe(false)
    expect([gl.canvas.width, gl.canvas.height, canvas.width, canvas.height]).toEqual([1920, 640, 1920, 640])
    expect(gpu.data.graph.links.length / 2).toBe(78)
    for (const alternate of [false, true]) {
      const style = styles(34, alternate)
      gl.style(alternate)
      for (let i = 0; i < style.sizes.length; i++) gpu.renderer.setStyle(i, Array.from(style.colors.subarray(i * 4, i * 4 + 4)), style.sizes[i])
      gpu.renderer.setLinkStyle(style.link, style.width)
      const constant = await comparePaint(gl, gpu, { attributeLayers: true })
      const probe = await probeLink(gl, gpu, constant)
      const smoothing = await comparePaint(gl, gpu, { attributeLayers: true, smoothLinks: true })
      const distance = await comparePaint(gl, gpu, { attributeLayers: true, distanceOpacity: true })
      const combined = await comparePaint(gl, gpu, { attributeLayers: true, distanceOpacity: true, smoothLinks: true })
      rows.push({ style: alternate ? 'B' : 'A', constant, smoothing, distance, combined, probe })
      expect(document.visibilityState).toBe('visible')
    }
    await writeArtifact('viewer-link-opacity', {
      environment,
      production: gl.info,
      viewport: VIEWPORT,
      config: LINK_VISIBILITY,
      source: import.meta.env.LAB_SOURCE_REVISION,
      snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
      controlSha256: import.meta.env.VITE_LAB_PRODUCTION_SHA256,
      rows,
    })
    for (const [index, { constant, smoothing, distance, combined, probe }] of rows.entries()) {
      expect(constant.interiorColorFailures).toBe([88, 469][index])
      expect(smoothing.interiorColorFailures).toBe(constant.interiorColorFailures)
      expect(constant.colorAttribution?.links.count).toBe(constant.interiorColorFailures)
      expect(probe.endpoints).toEqual([3, 7])
      expect(probe.pixel).toEqual([[1020, 100], [1021, 99]][index])
      expect(probe.production.cssLength).toBeCloseTo(19.146, 2)
      expect(probe.production.multiplier).toBeCloseTo(1.3085, 4)
      expect(maxError(probe.bytes.production, probe.production.expected)).toBeLessThanOrEqual(1)
      expect(maxError(probe.bytes.distanceCandidate, probe.candidate.expected)).toBeLessThanOrEqual(1)
      expect(probe.bytes.production).toEqual(constant.colorAttribution?.links.witness?.links[0])
      expect(probe.bytes.constantCandidate).toEqual(constant.colorAttribution?.links.witness?.links[1])
      expect(maxError(probe.bytes.rangeControl, probe.bytes.constantCandidate)).toBeLessThanOrEqual(1)
      expect(maxError(probe.bytes.distanceCandidate, probe.bytes.production)).toBeLessThanOrEqual(2)
      for (const comparison of [smoothing, distance, combined]) {
        expect(comparison.nonempty).toBe(true)
        expect(comparison.samples).toBe(1920 * 640)
        expect(comparison.boundarySamples).toBe(constant.boundarySamples)
        expect(comparison.geometry).toEqual(constant.geometry)
        expect(comparison.camera).toEqual(constant.camera)
        expect(comparison.interiorIdFailures).toBe(0)
        expect(comparison.productionInvisiblePicks).toBe(0)
        expect(comparison.candidateInvisiblePicks).toBe(0)
      }
      expect(distance.interiorColorFailures).toBe(0)
      expect(combined.interiorColorFailures).toBe(0)
    }
    expect(gl.tick).toBe(0)
    expect(gpu.tick).toBe(0)
    expect(gl.errors).toEqual([])
  } finally { gl?.destroy(); gpu?.destroy(); host.remove() }
}, 120000)
