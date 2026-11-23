import type { ExperimentInstance } from '../../runtime/experiment'
import { createLiveChecks } from '../../runtime/live-checks'
import { linkLanes as lanes, linkNames as names, linkPanels } from '../../runtime/link-preview'
import { mountPixelInspector } from '../../runtime/pixel-inspector'
import { disposeRunLayout, mountRunLayout } from '../../runtime/run-layout'
import type { Backend, Snapshot } from './backend'
import { linkControls, previewInputs, type PreviewScene } from './controls'
import { HEIGHT, WIDTH, type Variant } from './data'
import { linkGroups, runLinkTrial } from './links-suite'
import { invisibleSourcePicks } from './picked-source'
import { compare, compareColors, type Comparison } from './reference'
import { createLinksWebGL } from './webgl'
import { createLinksWebGPU } from './webgpu'

type Lane = typeof lanes[number]
type Preview = { image: Snapshot; changedColors: number; invisiblePicks: number }

function previewResult (result: Comparison, gl: Preview, gpu: Preview, variant: Variant): string {
  const mismatch = result.firstMismatch
  const target = (id: number | null): string => id === null ? 'nothing' : `link ${id}`
  if (gl.changedColors || gpu.changedColors) {
    return `Changing the picking rule also changed the drawn color in ${gl.changedColors ? 'WebGL' : 'WebGPU'}.`
  }
  if (gl.invisiblePicks || gpu.invisiblePicks || result.invisible.webgl || result.invisible.webgpu) {
    if (variant === 'visible') {
      const lane = gl.invisiblePicks || result.invisible.webgl ? 'WebGL' : 'WebGPU'
      return `${lane} picks a link at a pixel where that link paints nothing. This fails visible-stroke picking.`
    }
    if (!mismatch && !result.colors.budgetFailures && !result.cpuColors.webgl.budgetFailures && !result.cpuColors.webgpu.budgetFailures) {
      return 'Picking matches. Cosmos padding also picks pixels where the selected link paints nothing.'
    }
  }
  const outside = result.edgeBand?.firstOutside
  if (outside) return `At (${outside.x}, ${outside.y}), color or picking differs beyond the pilot’s one-device-pixel edge allowance.`
  const edgeNote = result.edgeBand ? ' Every mismatch is within one device pixel of a link outline.' : ''
  if (mismatch) {
    const { x, y, webgl, webgpu, expected } = mismatch
    if (webgl !== webgpu) return `At pixel (${x}, ${y}), WebGL picks ${target(webgl)} and WebGPU picks ${target(webgpu)}.${edgeNote}`
    return `At pixel (${x}, ${y}), both pick ${target(webgl)}. The CPU calculation predicts ${target(expected.webgl)}.${edgeNote}`
  }
  if (result.colors.budgetFailures) {
    return `Picking matches. Color or opacity differs by more than 2/255 at ${result.colors.budgetFailures.toLocaleString()} pixels.${edgeNote}`
  }
  if (result.cpuColors.webgl.budgetFailures || result.cpuColors.webgpu.budgetFailures) {
    return `The previews agree within tolerance. Some pixels differ from the expected color or opacity by more than 2/255.${edgeNote}`
  }
  return result.colors.maxChannelError === 0
    ? 'Both previews draw identical pixels and pick the same links.'
    : `Both previews pick the same links. Color and opacity differ by at most ${result.colors.maxChannelError} on a 0–255 scale.`
}

export function createLinksView (host: HTMLElement): ExperimentInstance {
  host.innerHTML = linkControls() + linkPanels(WIDTH, HEIGHT)
  mountRunLayout(host)
  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const choice = (key: string): string => el<HTMLButtonElement>(`[data-choice="${key}"] [aria-pressed="true"]`).value
  const status = el('[data-preview-status]')
  const retry = el<HTMLButtonElement>('[data-retry]')
  const buttons = host.querySelectorAll<HTMLButtonElement>('[data-choice] button')
  const backends: Partial<Record<Lane, Backend>> = {}
  const previews: Partial<Record<Lane, Preview>> = {}
  let drawing = false
  let disposed = false
  let pending = Promise.resolve()
  const inspector = mountPixelInspector(host, true, lane => previews[lane]?.image, () => !drawing && !disposed, 'link')
  function enqueue<T> (work: () => Promise<T>): Promise<T> {
    const task = pending.then(work)
    pending = task.then(() => {}, () => {})
    return task
  }
  const checks = createLiveChecks({
    sectionId: 'doc-automated-cases',
    recordedEnvironment: 'Chrome 157 · M3',
    recordedLabel: 'Recorded (M3)',
    ruleNote: 'For solid ribbons, picked IDs must agree and colors must stay within 2/255 outside a one-device-pixel band around the outline.',
    groups: linkGroups,
    unavailableReason: 'Preparing previews…',
    runCheck: (id, signal) => enqueue(async () => {
      signal.throwIfAborted()
      if (!backends.webgl || !backends.webgpu) throw new Error('Both renderers are required.')
      return runLinkTrial(id, backends.webgl, backends.webgpu, signal)
    }),
  })

  function release (lane: Lane): void {
    const backend = backends[lane]
    delete backends[lane]
    backend?.destroy()
  }

  async function draw (recover: boolean): Promise<void> {
    const { scene, settings } = previewInputs(choice('fixture') as PreviewScene, choice('blend') === 'blend')
    const variant = choice('variant') as Variant
    for (const lane of lanes) {
      delete previews[lane]
      if (disposed) return
      const errorBox = el(`[data-error="${lane}"]`)
      const canvas = el<HTMLCanvasElement>(`[data-canvas="${lane}"]`)
      const viewport = canvas.parentElement!
      try {
        if (!backends[lane] && recover) {
          // A destroyed device can leave its canvas tied to the old context.
          const fresh = canvas.cloneNode(false) as HTMLCanvasElement
          canvas.replaceWith(fresh)
          backends[lane] = await (lane === 'webgl' ? createLinksWebGL : createLinksWebGPU)(fresh)
        }
        const backend = backends[lane]
        if (!backend || disposed) continue
        const original = await backend.render(scene, settings, 'production', variant === 'production')
        if (disposed) return
        const image = variant === 'production' ? original : await backend.render(scene, settings, variant)
        if (disposed) return
        previews[lane] = {
          image,
          changedColors: variant === 'production' ? 0 : compareColors(original.color, image.color).changedPixels,
          invisiblePicks: await invisibleSourcePicks(image, scene, settings.indexOffset, isolated => backend.render(isolated, settings, variant, false)),
        }
        viewport.hidden = false
        errorBox.hidden = true
      } catch (error) {
        release(lane)
        viewport.hidden = true
        errorBox.hidden = false
        errorBox.textContent = `${names[lane]} unavailable. ${error instanceof Error ? error.message : String(error)}`
      }
    }
    if (disposed) return
    const { webgl, webgpu } = previews
    if (!webgl || !webgpu) { status.textContent = 'Both previews must render to compare pixels.'; return }
    const result = await compare(webgl.image, webgpu.image, scene, settings)
    if (!disposed) status.textContent = previewResult(result, webgl, webgpu, variant)
  }

  function redraw (recover = false): void {
    if (drawing || disposed) return
    drawing = true
    inspector.reset()
    for (const button of buttons) button.disabled = true
    retry.disabled = true
    status.textContent = 'Comparing pixels…'
    enqueue(() => draw(recover)).catch(error => {
      if (!disposed) status.textContent = `Comparison failed. ${String(error)}`
    }).finally(() => {
      drawing = false
      if (disposed) return
      for (const button of buttons) button.disabled = false
      retry.hidden = Boolean(backends.webgl && backends.webgpu)
      if (retry.hidden) checks.enable()
      else checks.disable('Live checks require both WebGL and WebGPU.')
      retry.disabled = false
      inspector.restore()
    })
  }
  for (const button of buttons) {
    button.onclick = (): void => {
      if (button.getAttribute('aria-pressed') === 'true') return
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
      disposed = true
      checks.destroy()
      disposeRunLayout(host)
      pending.then(() => { try { release('webgl') } finally { release('webgpu') } }).catch(error => console.error('Link preview cleanup failed', error))
    },
  }
}
