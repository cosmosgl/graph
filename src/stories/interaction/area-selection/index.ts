import { Graph, PointShape } from '@cosmos.gl/graph'
import './style.css'

type Point = [number, number]
type Mode = 'Rectangle' | 'Lasso'

export const areaSelection = (): { div: HTMLDivElement; graph: Graph; destroy: () => void } => {
  const div = document.createElement('div')
  div.className = 'selection-edges'
  div.innerHTML = `
    <div class="selection-canvas"></div>
    <svg aria-hidden="true"></svg>
    <div class="selection-panel">
      <div class="selection-toolbar">
        <div class="selection-group" role="group" aria-label="Selection tool">
          <button data-tool="Rectangle" disabled>Rectangle</button>
          <button data-tool="Lasso" disabled>Lasso</button>
        </div>
        <div class="selection-group" role="group" aria-label="Pixel ratio">
          <button data-ratio="1" title="1 device pixel per CSS pixel" aria-pressed="true" disabled>1×</button>
          <button data-ratio="2" title="2 device pixels per CSS pixel" aria-pressed="false" disabled>2×</button>
        </div>
      </div>
      <div class="selection-presets" role="group" aria-label="Selection presets">
        <button data-preset="sizes" disabled>Different sizes</button>
        <button data-preset="edge" disabled>Edge overlap</button>
        <button data-preset="corner" disabled>Square vs circle</button>
        <button data-preset="inside" disabled>Inside a point</button>
      </div>
    </div>
    <div class="selection-footer">
      <div class="selection-caption"></div>
      <div class="selection-result" role="status">Loading graph…</div>
      <div class="selection-hint">Drag to select · Grab to move · Scroll to zoom</div>
    </div>
  `

  let resizeObserver: ResizeObserver | undefined
  let disposed = false
  let updateView = (): void => {}
  const graph = new Graph(div.querySelector<HTMLDivElement>('.selection-canvas')!, {
    spaceSize: 4096,
    pixelRatio: 1,
    rescalePositions: false,
    fitViewOnInit: false,
    enableSimulation: false,
    enableRenderLoop: false,
    enableZoom: true,
    onZoom: (): void => { updateView() },
    enableDrag: false,
    backgroundColor: '#2d313a',
  })
  let positions: Point[] = []
  let sizes: number[] = []
  let names: string[] = []
  // Initialize GPU resources before the first preset is applied.
  graph.setPointPositions(new Float32Array([2048, 2048]))
  graph.render()

  const status = div.querySelector('[role="status"]')!
  const caption = div.querySelector('.selection-caption')!
  const clearPresetCaption = (): void => { caption.textContent = '' }
  const buttons = Array.from(div.querySelectorAll<HTMLButtonElement>('[data-tool]'))
  const ratioButtons = Array.from(div.querySelectorAll<HTMLButtonElement>('[data-ratio]'))
  const presetButtons = Array.from(div.querySelectorAll<HTMLButtonElement>('[data-preset]'))
  const overlay = div.querySelector('svg')!
  graph.ready.then(() => {
    if (disposed) return
    overlay.innerHTML = `
      <path class="selection-outline-border" fill="none" stroke="#18202c" stroke-width="2.5" pointer-events="none"/>
      <path class="selection-outline" fill="#9ec5ff" fill-opacity="0.05" fill-rule="evenodd"
        stroke="#e4efff" stroke-width="1" stroke-linejoin="round">
        <title>Drag to move selection</title>
      </path>
      <g class="selection-labels" pointer-events="none"></g>
    `
    const outline = overlay.querySelector<SVGPathElement>('.selection-outline')!
    const outlineBorder = overlay.querySelector<SVGPathElement>('.selection-outline-border')!
    let mode: Mode = 'Rectangle'
    let preset = 'sizes'
    let selection: Point[] = []
    let displayedSelection: Point[] = []
    let gesture: { id: number; start: Point; trail: Point[]; moving: boolean } | undefined

    const draw = (vertices: Point[]): void => {
      displayedSelection = vertices
      const path = vertices.length ? `M ${vertices.map(point => point.join(' ')).join(' L ')} Z` : ''
      outline.setAttribute('d', path)
      outlineBorder.setAttribute('d', path)
    }

    const highlight = (indices: number[]): void => {
      graph.setPointColors(new Float32Array(positions.flatMap((_, index) =>
        indices.includes(index) ? [0.62, 0.77, 1, 1] : [0.48, 0.53, 0.62, 1])))
      graph.render(undefined, 0)
      graph.renderOneFrame()
    }

    const updateSelection = (vertices: Point[]): void => {
      const [first, , opposite] = vertices
      let indices: number[] = []
      if (first && opposite) {
        indices = mode === 'Rectangle'
          ? graph.findPointsInRect([first, opposite])
          : graph.findPointsInPolygon(vertices)
      }
      highlight(indices)
      status.textContent = `Selected: ${indices.length ? indices.map(index => names[index]).join(', ') : 'none'}`
    }

    updateView = (): void => {
      overlay.querySelectorAll('text').forEach((label, index) => {
        const [x, y] = graph.spaceToScreenPosition(positions[index]!)
        const radius = graph.spaceToScreenRadius(sizes[index]! / 2)
        label.setAttribute('x', String(x))
        label.setAttribute('y', String(y + radius + 18))
      })
      graph.renderOneFrame()
      // During a gesture the preview differs from the last committed selection.
      updateSelection(displayedSelection)
    }

    // The selection overlay receives pointer gestures, so forward its wheel
    // events to the canvas's existing zoom handler.
    overlay.addEventListener('wheel', event => {
      event.preventDefault()
      clearPresetCaption()
      div.querySelector('canvas')!.dispatchEvent(new WheelEvent('wheel', {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        bubbles: true,
        cancelable: true,
      }))
    }, { passive: false })

    const pointer = (event: PointerEvent): Point => {
      const bounds = overlay.getBoundingClientRect()
      return [event.clientX - bounds.left, event.clientY - bounds.top]
    }

    const verticesAt = (active: NonNullable<typeof gesture>, [x, y]: Point): Point[] => {
      const [startX, startY] = active.start
      if (active.moving) return selection.map(([vx, vy]) => [vx + x - startX, vy + y - startY])
      if (mode === 'Lasso') return [...active.trail, [x, y]]
      const [left, right] = [Math.min(startX, x), Math.max(startX, x)]
      const [top, bottom] = [Math.min(startY, y), Math.max(startY, y)]
      return [[left, top], [right, top], [right, bottom], [left, bottom]]
    }

    overlay.addEventListener('pointerdown', event => {
      if (gesture || event.button !== 0) return
      event.preventDefault()
      clearPresetCaption()
      const start = pointer(event)
      gesture = { id: event.pointerId, start, trail: [start], moving: event.target === outline }
      overlay.setPointerCapture(event.pointerId)
      if (!gesture.moving) {
        draw([])
        updateSelection([])
      }
    })
    overlay.addEventListener('pointermove', event => {
      if (gesture?.id !== event.pointerId) return
      const position = pointer(event)
      const vertices = verticesAt(gesture, position)
      draw(vertices)
      updateSelection(vertices)
      if (mode === 'Lasso' && !gesture.moving) gesture.trail.push(position)
    })
    overlay.addEventListener('lostpointercapture', event => {
      if (gesture?.id !== event.pointerId) return
      gesture = undefined
      draw(selection)
      updateSelection(selection)
    })
    overlay.addEventListener('pointerup', event => {
      if (gesture?.id !== event.pointerId) return
      const vertices = verticesAt(gesture, pointer(event))
      const { moving } = gesture
      gesture = undefined
      const [first, , opposite] = vertices
      // Ignore empty new drags, but allow moving a converted line selection.
      if (!first || !opposite || (!moving && mode === 'Rectangle' && (first[0] === opposite[0] || first[1] === opposite[1]))) {
        draw(selection)
        updateSelection(selection)
        return
      }
      selection = vertices
      draw(selection)
      outline.style.cursor = 'grab'
      updateSelection(selection)
    })

    const setMode = (nextMode: Mode): void => {
      clearPresetCaption()
      mode = nextMode
      gesture = undefined
      if (nextMode === 'Rectangle' && selection.length) {
        const xs = selection.map(([x]) => x)
        const ys = selection.map(([, y]) => y)
        const [left, right] = [Math.min(...xs), Math.max(...xs)]
        const [top, bottom] = [Math.min(...ys), Math.max(...ys)]
        selection = [[left, top], [right, top], [right, bottom], [left, bottom]]
      }
      draw(selection)
      updateSelection(selection)
      buttons.forEach(button => button.setAttribute('aria-pressed', String(button.textContent === mode)))
    }
    buttons.forEach(button => {
      button.disabled = false
      button.addEventListener('click', () => { setMode(button.textContent === 'Lasso' ? 'Lasso' : 'Rectangle') })
    })
    const applyPreset = (nextPreset: string): void => {
      preset = nextPreset
      gesture = undefined
      selection = []
      const width = overlay.clientWidth
      const height = overlay.clientHeight
      overlay.setAttribute('viewBox', `0 0 ${width} ${height}`)
      draw([])
      // Use the interactive zoom API so d3's wheel state stays in sync.
      graph.setZoomLevel(1, 0, false)
      // Apply any pending canvas resize before converting screen positions.
      graph.renderOneFrame()
      const centerX = width / 2
      const centerY = Math.max(240, height / 2)
      // Keep the scene below the floating toolbar, in CSS-pixel coordinates.
      const centers: Point[] = nextPreset === 'sizes'
        ? [[centerX - 90, centerY], [centerX, centerY], [centerX + 90, centerY]]
        : [[centerX - 70, centerY], [centerX + 70, centerY]]
      positions = centers.map(([x, y]) => graph.screenToSpacePosition([x, y]))
      sizes = nextPreset === 'sizes' ? [16, 36, 64] : [64, 64]
      names = nextPreset === 'sizes' ? ['Small', 'Medium', 'Large'] : ['Circle', 'Square']
      const shapes = nextPreset === 'sizes'
        ? [PointShape.Circle, PointShape.Circle, PointShape.Circle]
        : [PointShape.Circle, PointShape.Square]
      graph.setPointPositions(new Float32Array(positions.flat()))
      graph.setPointSizes(new Float32Array(sizes))
      graph.setPointShapes(new Float32Array(shapes))
      graph.render(undefined, 0)
      div.querySelector('.selection-labels')!.innerHTML = names.map(name =>
        `<text text-anchor="middle" fill="#aab3c5" font-size="12">${name}</text>`).join('')

      const rectangle = (left: number, top: number, right: number, bottom: number): Point[] =>
        [[left, top], [right, top], [right, bottom], [left, bottom]]
      if (nextPreset === 'edge') selection = rectangle(centerX - 110, centerY + 24, centerX + 110, centerY + 65)
      if (nextPreset === 'corner') selection = rectangle(centerX - 46, centerY + 24, centerX + 46, centerY + 65)
      if (nextPreset === 'inside') selection = rectangle(centerX - 78, centerY - 8, centerX - 62, centerY + 8)
      const captions: Record<string, string> = {
        sizes: '',
        edge: 'Edge overlap · both footprints touch the selection',
        corner: 'Corner overlap · square touches, circle stays outside',
        inside: 'Containment · selection sits entirely inside the circle',
      }
      caption.textContent = captions[nextPreset] ?? ''
      presetButtons.forEach(button => button.setAttribute('aria-pressed', String(button.getAttribute('data-preset') === nextPreset)))
      outline.style.cursor = 'grab'
      draw(selection)
      updateView()
    }

    ratioButtons.forEach(button => {
      button.disabled = false
      button.addEventListener('click', () => {
        clearPresetCaption()
        const pixelRatio = Number(button.getAttribute('data-ratio'))
        graph.setConfigPartial({ pixelRatio })
        ratioButtons.forEach(option => option.setAttribute('aria-pressed', String(option === button)))
        updateView()
      })
    })
    presetButtons.forEach(button => {
      button.disabled = false
      button.addEventListener('click', () => { applyPreset(button.getAttribute('data-preset')!) })
    })
    setMode('Rectangle')
    applyPreset('sizes')
    resizeObserver = new ResizeObserver(() => { applyPreset(preset) })
    resizeObserver.observe(div)
  }).catch((error: unknown) => {
    status.textContent = `Could not load the graph: ${String(error)}`
  })

  return {
    div,
    graph,
    destroy: (): void => {
      disposed = true
      resizeObserver?.disconnect()
    },
  }
}
