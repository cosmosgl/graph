import { Graph } from '@cosmos.gl/graph'
import { config } from './config'
import './style.css'

const SPACE_CENTER = 4096 / 2
const BASE_SIZE = 40

// A random vivid color as a normalized RGBA tuple (0..1), as the engine expects.
function randomColor (): [number, number, number, number] {
  const hue = Math.random()
  const k = (n: number): number => (n + hue * 6) % 6
  const f = (n: number): number => 1 - Math.max(0, Math.min(k(n), 4 - k(n), 1)) * 0.5
  return [f(5), f(3), f(1), 1]
}

// The fade effect applied to both adding (NaN → real) and removing (real → NaN):
// - 'grow':    grow/shrink + fade        (size & alpha animate 0 ↔ real)
// - 'opacity': fade at full size         (alpha animates 0 ↔ real, size kept)
// - 'recolor': green in / red out        (custom color while fading)
// - 'instant': no animation              (snap in / out)
type Effect = 'grow' | 'opacity' | 'recolor' | 'instant'

const EFFECTS: { id: Effect; label: string }[] = [
  { id: 'grow', label: 'grow + fade' },
  { id: 'opacity', label: 'opacity' },
  { id: 'recolor', label: 'recolor' },
  { id: 'instant', label: 'instant' },
]

export const addRemovePoints = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.className = 'add-remove-points'

  const graphDiv = document.createElement('div')
  graphDiv.className = 'graph'
  div.appendChild(graphDiv)

  const controlsDiv = document.createElement('div')
  controlsDiv.className = 'controls'
  div.appendChild(controlsDiv)

  // Bottom panel: the array drawn as a strip of slots, plus the instruction line.
  const panelDiv = document.createElement('div')
  panelDiv.className = 'panel'
  div.appendChild(panelDiv)

  const slotsDiv = document.createElement('div')
  slotsDiv.className = 'slots'
  panelDiv.appendChild(slotsDiv)

  const hintDiv = document.createElement('div')
  hintDiv.className = 'hint'
  panelDiv.appendChild(hintDiv)

  // ── Slot-based state with NaN tombstones ───────────────────────────────────
  // A point's array index is its *stable slot*. Removing a point sets its position
  // to NaN (a tombstone) instead of compacting the array, so every other point
  // keeps its index and on-screen position. Adding is the mirror: NaN → a real
  // position. Both animate per the selected effect.
  let pointPositions: number[] = []
  let pointColors: number[] = []
  let pointSizes: number[] = []
  let pointIds: number[] = []
  let nextPointId = 0
  let effect: Effect = 'grow'

  /* ~ Slot helpers ~ */
  const slotCount = (): number => pointPositions.length / 2 // active + tombstoned
  const isActive = (slot: number): boolean => !Number.isNaN(pointPositions[slot * 2])
  const activeSlots = (): number[] => {
    const result: number[] = []
    for (let i = 0; i < slotCount(); i += 1) if (isActive(i)) result.push(i)
    return result
  }

  // Draw the array as a strip of cells in index order — one per slot. An active
  // slot is filled with its point's color and shows its index; a removed slot is a
  // dashed "tombstone" that stays in place (its index is preserved). This makes the
  // model visible: removal leaves a hole, and Compact re-packs + renumbers.
  function renderSlots (): void {
    const total = slotCount()

    const cells: string[] = []
    for (let slot = 0; slot < total; slot += 1) {
      if (isActive(slot)) {
        const r = Math.round((pointColors[slot * 4] ?? 0) * 255)
        const g = Math.round((pointColors[slot * 4 + 1] ?? 0) * 255)
        const b = Math.round((pointColors[slot * 4 + 2] ?? 0) * 255)
        cells.push(`<div class="slot" style="background: rgb(${r}, ${g}, ${b})">${slot}</div>`)
      } else {
        // A faded-out slot is literally NaN in the positions array.
        cells.push('<div class="slot empty">NaN</div>')
      }
    }

    slotsDiv.innerHTML = `
      <div class="slots-title">the array you pass to <code>setPointPositions</code></div>
      <div class="slots-strip">${cells.join('') || '<span class="slots-empty">empty array</span>'}</div>
    `
  }

  /* ~ Push state to the engine. Pass transitionDuration = 0 to snap (no animation). ~ */
  function update (transitionDuration?: number): void {
    graph.setPointPositions(new Float32Array(pointPositions))
    graph.setPointColors(new Float32Array(pointColors))
    graph.setPointSizes(new Float32Array(pointSizes))
    graph.render(undefined, transitionDuration)
    renderSlots()
  }

  /* ~ Add a point at (x, y), fading in per the current effect ~ */
  function addPointAt (x: number, y: number): void {
    const slot = slotCount()
    const [r, g, b] = randomColor()
    pointIds.push(nextPointId++)

    if (effect === 'instant') {
      // Single-phase: a new slot appears at its values immediately (no animation).
      pointPositions.push(x, y)
      pointColors.push(r, g, b, 1)
      pointSizes.push(BASE_SIZE)
      update()
      return
    }

    // Two-phase: commit the slot as absent with the effect's *start* look, then set
    // its real values so the size/color transition animates start → real (fade in).
    pointPositions.push(NaN, NaN)
    if (effect === 'grow') {
      pointSizes.push(NaN) // size 0 → grows in
      pointColors.push(r, g, b, NaN) // alpha 0 → fades in
    } else if (effect === 'opacity') {
      pointSizes.push(BASE_SIZE) // full size from the start
      pointColors.push(r, g, b, NaN) // alpha 0 → fades in
    } else { // 'recolor'
      pointSizes.push(BASE_SIZE)
      pointColors.push(0, 1, 0, NaN) // starts green, fades in
    }
    update() // commit the start state

    pointPositions[slot * 2] = x
    pointPositions[slot * 2 + 1] = y
    pointSizes[slot] = BASE_SIZE
    pointColors[slot * 4] = r
    pointColors[slot * 4 + 1] = g
    pointColors[slot * 4 + 2] = b
    pointColors[slot * 4 + 3] = 1
    update() // animate to the real values
  }

  /* ~ Remove a point, fading out per the current effect ~ */
  function removeSlot (slot: number): void {
    if (!isActive(slot)) return
    pointPositions[slot * 2] = NaN
    pointPositions[slot * 2 + 1] = NaN

    if (effect === 'grow') {
      pointSizes[slot] = NaN // → exit default 0 (shrinks out)
      pointColors[slot * 4 + 3] = NaN // → exit default 0 (fades out)
    } else if (effect === 'opacity') {
      pointColors[slot * 4 + 3] = NaN // fade out, keep the size
    } else if (effect === 'recolor') {
      pointColors[slot * 4] = 1
      pointColors[slot * 4 + 1] = 0
      pointColors[slot * 4 + 2] = 0
      pointColors[slot * 4 + 3] = NaN // recolor to red while fading out
    }
    // 'instant' needs no channel changes — the render below snaps it with duration 0.
    update(effect === 'instant' ? 0 : undefined)
  }

  /* ~ Compact: drop tombstones and renumber, snapped so nothing visibly moves ~ */
  function compact (): void {
    const active = activeSlots()
    if (active.length === slotCount()) return
    pointPositions = active.flatMap((slot) => [pointPositions[slot * 2], pointPositions[slot * 2 + 1]])
    pointColors = active.flatMap((slot) => pointColors.slice(slot * 4, slot * 4 + 4))
    pointSizes = active.map((slot) => pointSizes[slot])
    pointIds = active.map((slot) => pointIds[slot])
    update(0) // snap the renumber so nothing visibly moves
  }

  /* ~ Seed a few points so there's something to interact with ~ */
  function reset (): void {
    pointPositions = []
    pointColors = []
    pointSizes = []
    pointIds = []
    nextPointId = 0
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2
      pointPositions.push(SPACE_CENTER + Math.cos(angle) * 500, SPACE_CENTER + Math.sin(angle) * 500)
      pointColors.push(...randomColor())
      pointSizes.push(BASE_SIZE)
      pointIds.push(nextPointId++)
    }
    update(0) // seed with no animation
    graph.fitView(0, config.fitViewPadding)
  }

  /* ~ UI ~ */
  function renderHint (): void {
    const name = EFFECTS.find((e) => e.id === effect)?.label ?? ''
    hintDiv.innerHTML = `<b>Click empty space</b> to add · <b>click a point</b> to remove<span class="effect">effect: ${name}</span>`
  }

  function renderControls (): void {
    controlsDiv.innerHTML = ''

    const picker = document.createElement('div')
    picker.className = 'picker'
    for (const e of EFFECTS) {
      const chip = document.createElement('div')
      chip.className = e.id === effect ? 'chip active' : 'chip'
      chip.textContent = e.label
      chip.addEventListener('click', () => {
        effect = e.id
        renderControls()
        renderHint()
      })
      picker.appendChild(chip)
    }
    controlsDiv.appendChild(picker)

    const buttons = document.createElement('div')
    buttons.className = 'buttons'
    for (const [label, onClick] of [['Compact', compact], ['Reset', reset]] as const) {
      const button = document.createElement('div')
      button.className = 'action'
      button.textContent = label
      button.addEventListener('click', onClick)
      buttons.appendChild(button)
    }
    controlsDiv.appendChild(buttons)
  }

  // Defined after the functions above so `onClick` can call them (the functions
  // reference `graph` back — allowed: they only run after this assignment).
  const graph = new Graph(graphDiv, {
    ...config,
    // Click a point to remove it; click empty space to add one there.
    onClick: (index, _pointPosition, event): void => {
      if (index !== undefined && isActive(index)) {
        removeSlot(index)
      } else {
        const [x, y] = graph.screenToSpacePosition([event.offsetX, event.offsetY])
        addPointAt(x, y)
      }
    },
  })

  renderControls()
  renderHint()
  reset()

  const destroy = (): void => {
    graph.destroy()
  }

  return { div, graph, destroy }
}
