import { createDevice } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import type { ExperimentInstance } from '../../runtime/experiment'
import { createSelectionWebGL, createSelectionWebGPU } from './backend'
import { pointAt, type Camera, type Pair, type Query } from './reference'

const width = 320
const height = 204
const camera: Camera = {
  viewport: [width, height],
  origin: [0, 0],
  translation: [0, 0],
  zoom: 1,
  ratio: 1,
  sizeScale: 1,
  maxSize: 16,
  scaleOnZoom: false,
}
// Spread the dots across an ellipse with repeatable positions and several visible sizes.
const points = Array.from({ length: 96 }, (_, i) => {
  const radius = Math.sqrt(i / 96)
  const angle = i * Math.PI * (3 - Math.sqrt(5))
  return pointAt(camera, [width / 2 + 144 * radius * Math.cos(angle), height / 2 + 90 * radius * Math.sin(angle)], 4 + i % 10)
})

type Tool = 'rect' | 'polygon'
const examples: Record<Tool, Query> = {
  rect: { rect: [[78, 52], [175, 133]] },
  polygon: {
    polygon: [
      [72, 86], [75, 71], [88, 58], [108, 51], [130, 50], [146, 55], [153, 65],
      [153, 78], [159, 86], [177, 87], [191, 92], [198, 103], [196, 116], [182, 128],
      [159, 136], [135, 139], [111, 135], [92, 126], [79, 113], [73, 99],
    ],
  },
}

function draw (canvas: HTMLCanvasElement, query: Query, selected: Set<number>, other: Set<number>): void {
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.beginPath()
  if ('rect' in query) {
    const [[x, y], [right, bottom]] = query.rect
    ctx.rect(x, y, right - x, bottom - y)
  } else {
    query.polygon.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
    ctx.closePath()
  }
  ctx.fillStyle = '#aac7e822'
  ctx.fill('evenodd')
  ctx.strokeStyle = '#aac7e8'
  ctx.stroke()
  points.forEach(({ world: [x, y], size }, i) => {
    ctx.beginPath()
    ctx.arc(x + width / 2, height / 2 - y, size / 2, 0, 2 * Math.PI)
    ctx.fillStyle = selected.has(i) ? '#f4d889' : '#778a9e'
    ctx.fill()
    if (other.has(i) !== selected.has(i)) {
      ctx.strokeStyle = '#ff786c'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.lineWidth = 1
    }
  })
}

function position (event: PointerEvent, box: DOMRect): Pair {
  return [(event.clientX - box.left) * width / box.width, (event.clientY - box.top) * height / box.height]
}

export async function createView (host: HTMLElement): Promise<ExperimentInstance> {
  const scope = resourceScope()
  try {
    const glDevice = scope.own(await createDevice('webgl', document.createElement('canvas'), false))
    const gl = scope.own(createSelectionWebGL(glDevice))
    const gpuDevice = scope.own(await createDevice('webgpu', document.createElement('canvas'), false))
    const gpu = scope.own(await createSelectionWebGPU(gpuDevice))

    host.innerHTML = `<div class="choice-control selection-tools" role="group" aria-label="Selection tool">
      <div class="choice-options"><button type="button" data-tool="rect">Rectangle</button>
      <button type="button" data-tool="polygon">Lasso</button></div></div>
      <div class="backend-panels selection-preview">${['WebGL', 'WebGPU'].map(name =>
    `<div class="backend-panel"><strong>${name}</strong><canvas aria-label="${name} selection preview"></canvas></div>`).join('')}</div>
      <p role="status"></p>
      <p class="case-meta">The rectangle catches dots whose bounding boxes touch it. The lasso checks their centers.
      After <a href="https://github.com/cosmosgl/graph/pull/296">PR #296</a> merges, update both to count any overlap with the dot itself.</p>`
    const canvases = Array.from(host.querySelectorAll('canvas'))
    const buttons = host.querySelectorAll<HTMLButtonElement>('button[data-tool]')
    const status = host.querySelector<HTMLElement>('[role="status"]')!
    let tool: Tool = 'rect'
    let query = examples[tool]
    let ids = [new Set<number>(), new Set<number>()]
    let drag: { pointer: number; canvas: HTMLCanvasElement; start: Pair } | undefined
    let revision = 0
    let pending = 0
    let disposed = false

    const render = (): void => canvases.forEach((canvas, i) => draw(canvas, query, ids[i], ids[1 - i]))
    const compare = async (): Promise<void> => {
      const request = ++revision
      pending++
      status.textContent = 'Comparing selection…'
      try {
        const results = await Promise.allSettled([gl.select(points, camera, query), gpu.select(points, camera, query)])
        if (request !== revision) return
        ids = results.map(result => {
          if (result.status === 'rejected') throw result.reason
          return new Set(result.value)
        })
        const differences = points.filter((_, i) => ids[0].has(i) !== ids[1].has(i)).length
        status.textContent = differences
          ? `WebGL selected ${ids[0].size} · WebGPU selected ${ids[1].size} · Red rings mark ${differences} differing IDs.`
          : `Both selected ${ids[0].size} of ${points.length} points. All IDs match.`
        render()
      } catch (error) {
        if (request === revision) status.textContent = `Selection failed: ${String(error)}`
      } finally {
        pending--
        if (disposed && !pending) scope.destroy()
      }
    }
    const cancelDrag = (): void => {
      if (drag?.canvas.hasPointerCapture(drag.pointer)) drag.canvas.releasePointerCapture(drag.pointer)
      drag = undefined
    }
    const choose = (next: Tool): void => {
      cancelDrag()
      tool = next
      query = examples[tool]
      ids = [new Set(), new Set()]
      buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tool === tool)))
      render()
      compare()
    }
    buttons.forEach(button => { button.onclick = (): void => choose(button.dataset.tool as Tool) })
    for (const canvas of canvases) {
      canvas.width = width * 2
      canvas.height = height * 2
      const extend = (event: PointerEvent): void => {
        if (drag?.pointer !== event.pointerId || drag.canvas !== canvas) return
        const box = canvas.getBoundingClientRect()
        if (!box.width || !box.height) return
        if ('rect' in query) {
          const [x, y] = position(event, box)
          const [sx, sy] = drag.start
          query = { rect: [[Math.min(x, sx), Math.min(y, sy)], [Math.max(x, sx), Math.max(y, sy)]] }
        } else {
          const samples = event.getCoalescedEvents?.() ?? []
          for (const sample of samples.length ? samples : [event]) query.polygon.push(position(sample, box))
        }
        render()
      }
      canvas.onpointerdown = (event): void => {
        if (drag || event.button !== 0) return
        const box = canvas.getBoundingClientRect()
        if (!box.width || !box.height) return
        revision++
        const start = position(event, box)
        drag = { pointer: event.pointerId, canvas, start }
        canvas.setPointerCapture(event.pointerId)
        query = tool === 'rect' ? { rect: [start, start] } : { polygon: [start] }
        ids = [new Set(), new Set()]
        status.textContent = 'Release to compare.'
        render()
      }
      canvas.onpointermove = extend
      canvas.onpointerup = (event): void => {
        if (drag?.pointer !== event.pointerId || drag.canvas !== canvas) return
        extend(event)
        cancelDrag()
        compare()
      }
      canvas.onlostpointercapture = (event): void => {
        if (drag?.pointer === event.pointerId && drag.canvas === canvas) choose(tool)
      }
    }
    choose(tool)
    return {
      pause (): void { if (drag) choose(tool) },
      destroy (): void {
        disposed = true
        revision++
        cancelDrag()
        if (!pending) scope.destroy()
      },
    }
  } catch (error) { scope.destroy(); throw error }
}
