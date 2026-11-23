import type { ExperimentInstance } from '../../runtime/experiment'
import { createLiveChecks } from '../../runtime/live-checks'
import { linkChoice, linkLanes, linkNames, linkPanels } from '../../runtime/link-preview'
import { mountPixelInspector } from '../../runtime/pixel-inspector'
import { disposeRunLayout, mountRunLayout } from '../../runtime/run-layout'
import { invisibleSourcePicks } from '../straight-links/picked-source'
import { compareColors } from '../straight-links/reference'
import type { Backend, Snapshot } from './backend'
import { DEFAULTS, fixture, HEIGHT, WIDTH, type Fixture, type Scene, type Settings, type Variant } from './data'
import { curveGroups, runCurveTrial } from './pilot-suite'
import { compare, reference, type Comparison } from './reference'
import { createCurvesWebGL } from './webgl'
import { createCurvesWebGPU } from './webgpu'

type Lane = typeof linkLanes[number]
type Preview = { image: Snapshot; invisible: number; changed: number }

function selectedResult (result: Comparison, gl: Preview, gpu: Preview): string {
  const messages: string[] = []
  const padded = gl.image.variant === 'production'
  const changed = [gl.changed && 'WebGL', gpu.changed && 'WebGPU'].filter(Boolean)
  if (changed.length) messages.push(`Switching the picking rule changed the drawn colors in ${changed.join(' and ')}.`)
  const mismatch = result.firstMismatch
  const target = (id: number | null): string => id === null ? 'background' : `link ${id}`
  if (mismatch) {
    const { x, y, webgl, webgpu, expected } = mismatch
    messages.push(webgl !== webgpu
      ? `At (${x}, ${y}), WebGL picks ${target(webgl)} and WebGPU picks ${target(webgpu)}.`
      : `At (${x}, ${y}), both pick ${target(webgl)}. The CPU calculation predicts ${target(expected)}.`)
  }
  const color = result.firstColorMismatch
  if (color) messages.push(`At (${color.x}, ${color.y}), color or opacity differs by more than 2/255 across the previews and CPU calculation.`)
  if (!padded && (gl.invisible || gpu.invisible)) {
    messages.push(`The selected link paints nothing at ${gl.invisible} picked pixels in WebGL and ${gpu.invisible} in WebGPU.`)
  }
  if (result.transparentPick) {
    const { x, y, renderer } = result.transparentPick
    messages.push(`At (${x}, ${y}), ${renderer} picks a link on a fully transparent pixel.`)
  }
  if (messages.length) return messages.join(' ')
  if (padded && (gl.invisible || gpu.invisible)) return 'Colors and padded picks agree. Cosmos padding also picks pixels outside the painted curve.'
  return 'WebGL and WebGPU pick the expected links. Colors match the reference and each other within 2/255.'
}

export function createCurvesView (host: HTMLElement): ExperimentInstance {
  host.innerHTML = `<div data-run-part="configuration" class="choice-controls">
    ${linkChoice('scene', 'Scene', [['bows', 'Default bow'], ['folded', 'Folded ribbon'], ['overlap', 'Crossing curves']])}
    ${linkChoice('policy', 'Picking', [['production', 'Cosmos (+5 CSS px)'], ['front', 'Drawn faces'], ['visible', 'Both faces']])}
    ${linkChoice('edges', 'Edges', [['blend', 'Antialiased'], ['hard', 'Hard']])}
  </div>${linkPanels(WIDTH, HEIGHT)}`
  mountRunLayout(host)
  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const value = (group: string): string => el<HTMLButtonElement>(`[data-choice="${group}"] [aria-pressed="true"]`).value
  const status = el('[data-preview-status]')
  const retry = el<HTMLButtonElement>('[data-retry]')
  const buttons = host.querySelectorAll<HTMLButtonElement>('[data-choice] button')
  const devices: Partial<Record<Lane, Backend>> = {}
  const previews: Partial<Record<Lane, Preview>> = {}
  let busy = false
  let destroyed = false
  let pending = Promise.resolve()
  const inspector = mountPixelInspector(host, true, lane => previews[lane]?.image, () => !busy && !destroyed, 'link')

  function enqueue<T> (work: () => Promise<T>): Promise<T> {
    const task = pending.then(work)
    pending = task.then(() => {}, () => {})
    return task
  }
  const checks = createLiveChecks({
    sectionId: 'doc-automated-cases',
    recordedEnvironment: 'Chrome 157 · M3',
    recordedLabel: 'Recorded (M3)',
    ruleNote: 'Frozen curves at pixel ratio 1. The painted edge and padded click edge may shift by one device pixel. Moving curves and performance are untested.',
    groups: curveGroups,
    unavailableReason: 'Preparing previews…',
    runCheck: (id, signal) => enqueue(async () => {
      signal.throwIfAborted()
      if (!devices.webgl || !devices.webgpu) throw new Error('Both renderers are required.')
      return runCurveTrial(id, devices.webgl, devices.webgpu, signal)
    }),
  })

  function release (lane: Lane): void {
    const device = devices[lane]
    delete devices[lane]
    device?.destroy()
  }

  async function drawLane (lane: Lane, scene: Scene, settings: Settings, variant: Variant, recover: boolean): Promise<void> {
    delete previews[lane]
    const canvas = el<HTMLCanvasElement>(`[data-canvas="${lane}"]`)
    const viewport = canvas.parentElement!
    const errorBox = el(`[data-error="${lane}"]`)
    try {
      if (!devices[lane] && recover) {
        const fresh = canvas.cloneNode(false) as HTMLCanvasElement
        canvas.replaceWith(fresh)
        devices[lane] = await (lane === 'webgl' ? createCurvesWebGL : createCurvesWebGPU)(fresh)
      }
      const device = devices[lane]
      if (!device || destroyed) return
      const image = await device.render(scene, settings, variant)
      if (destroyed) return
      const original = variant === 'production' ? image : await device.render(scene, settings, 'production', false)
      if (destroyed) return
      const invisible = await invisibleSourcePicks(image, scene, settings.indexOffset, isolated => device.render(isolated, settings, variant, false))
      if (destroyed) return
      previews[lane] = { image, invisible, changed: image === original ? 0 : compareColors(image.color, original.color).changedPixels }
      viewport.hidden = false
      errorBox.hidden = true
    } catch (error) {
      release(lane)
      if (destroyed) return
      viewport.hidden = true
      errorBox.hidden = false
      errorBox.textContent = `${linkNames[lane]} unavailable. ${error instanceof Error ? error.message : String(error)}`
    }
  }

  async function draw (recover: boolean): Promise<void> {
    const preset = value('scene') as Fixture
    const variant = value('policy') as Variant
    const scene = fixture(preset)
    const settings = {
      ...DEFAULTS,
      blend: value('edges') === 'blend',
      ...(preset === 'folded' ? { zoom: 0.5, scaleOnZoom: false, opacity: 0.35 } : {}),
    }
    for (const lane of linkLanes) {
      if (destroyed) return
      await drawLane(lane, scene, settings, variant, recover)
    }
    if (destroyed) return
    const { webgl, webgpu } = previews
    if (!webgl || !webgpu) {
      status.textContent = 'Pixel comparison requires both WebGL and WebGPU.'
      return
    }
    const result = await compare(webgl.image, webgpu.image, reference(scene, settings, variant))
    if (!destroyed) status.textContent = selectedResult(result, webgl, webgpu)
  }

  function redraw (recover = false): void {
    if (busy || destroyed) return
    busy = true
    inspector.reset()
    for (const button of buttons) button.disabled = true
    retry.disabled = true
    status.textContent = 'Comparing pixels…'
    enqueue(() => draw(recover)).catch(error => {
      if (!destroyed) status.textContent = `Comparison failed. ${String(error)}`
    }).finally(() => {
      busy = false
      if (destroyed) return
      for (const button of buttons) button.disabled = false
      retry.hidden = Boolean(devices.webgl && devices.webgpu)
      if (retry.hidden) checks.enable()
      else checks.disable('Live checks require both WebGL and WebGPU.')
      retry.disabled = false
      inspector.restore()
    })
  }
  for (const button of buttons) {
    button.onclick = (): void => {
      if (busy || destroyed || button.getAttribute('aria-pressed') === 'true') return
      for (const option of button.parentElement!.querySelectorAll('button')) option.setAttribute('aria-pressed', String(option === button))
      redraw()
    }
  }
  retry.onclick = (): void => redraw(true)
  redraw(true)
  return {
    pageEndSection: checks.element,
    pause: checks.stop,
    destroy (): void {
      destroyed = true
      checks.destroy()
      disposeRunLayout(host)
      pending.then(() => { try { release('webgl') } finally { release('webgpu') } }).catch(error => console.error('Curve preview cleanup failed', error))
    },
  }
}
