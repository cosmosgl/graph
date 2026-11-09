// Deliberately CPU-only teaching models: no timing claims or GPU access.
// Each example owns only DOM listeners, so removing its host releases its state.
function element<K extends keyof HTMLElementTagNameMap> (
  tag: K, text?: string, className?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}

function frame (host: HTMLElement, title: string, instruction: string): HTMLElement {
  host.className = 'learning-example'
  host.setAttribute('role', 'group')
  host.setAttribute('aria-label', title)
  host.append(element('strong', title), element('p', instruction, 'learning-hint'))
  const body = element('div')
  host.append(body)
  return body
}

function status (): HTMLParagraphElement {
  const node = element('p', '', 'learning-status')
  node.setAttribute('role', 'status')
  node.setAttribute('aria-live', 'polite')
  node.setAttribute('aria-atomic', 'true')
  return node
}

function button (label: string, action: () => void): HTMLButtonElement {
  const node = element('button', label)
  node.type = 'button'
  node.addEventListener('click', action)
  return node
}

function choice (label: string, values: number[], initial: number, change: (value: number) => void): HTMLLabelElement {
  const wrapper = element('label', label, 'learning-field')
  const select = element('select')
  for (const value of values) {
    const option = element('option', String(value))
    option.value = String(value)
    select.append(option)
  }
  select.value = String(initial)
  select.addEventListener('change', () => change(Number(select.value)))
  wrapper.append(select)
  return wrapper
}

function cells (label: string, values: number[], selected = -1): HTMLElement {
  const row = element('div', undefined, 'learning-buffer')
  row.append(element('span', label, 'learning-label'))
  const strip = element('div', undefined, 'learning-cells')
  for (const [index, value] of values.entries()) {
    const cell = element('span', String(value), 'learning-cell')
    cell.classList.toggle('is-selected', index === selected)
    cell.setAttribute('aria-label', `${label}, index ${index}: ${value}${index === selected ? ', selected' : ''}`)
    strip.append(cell)
  }
  row.append(strip)
  return row
}

function invocations (host: HTMLElement): void {
  const body = frame(host, 'Find your invocation', 'Change the input size, then select an invocation. Dashed entries have no point to process.')
  let count = 10
  let size = 4
  let selected = 5
  const controls = element('div', undefined, 'controls')
  const groups = element('div', undefined, 'learning-groups')
  const result = status()
  const buffers = element('div')
  const updateSelection = (): void => {
    const valid = selected < count
    result.textContent = `Global ${selected} = group ${Math.floor(selected / size)} × ${size} + local ${selected % size}. ${
      valid ? `Read A[${selected}], write B[${selected}].` : `Index ${selected} ≥ ${count}: return without accessing a buffer.`}`
    for (const node of groups.querySelectorAll<HTMLButtonElement>('button')) {
      node.setAttribute('aria-pressed', String(Number(node.dataset.index) === selected))
    }
    const indices = Array.from({ length: count }, (_, index) => index)
    buffers.replaceChildren(cells('Read A · point indices', indices, valid ? selected : -1),
      cells('Write B · point indices', indices, valid ? selected : -1))
  }
  const render = (): void => {
    const groupCount = Math.ceil(count / size)
    selected = Math.min(selected, groupCount * size - 1)
    groups.replaceChildren()
    for (let group = 0; group < groupCount; group++) {
      const section = element('div', undefined, 'learning-group')
      section.append(element('span', `Workgroup ${group}`, 'learning-label'))
      const row = element('div', undefined, 'learning-cells')
      for (let local = 0; local < size; local++) {
        const index = group * size + local
        const node = button(String(index), () => { selected = index; updateSelection() })
        node.dataset.index = String(index)
        node.classList.toggle('is-idle', index >= count)
        node.setAttribute('aria-label', `Invocation ${index}, group ${group}, local ${local}${index >= count ? ', outside input' : ''}`)
        row.append(node)
      }
      section.append(row)
      groups.append(section)
    }
    const launched = groupCount * size
    summary.textContent = `${count} points · ${groupCount} workgroups × ${size} invocations = ${launched} executions · ${launched - count} skip`
    updateSelection()
  }
  const summary = element('p', '', 'learning-hint')
  controls.append(choice('Points', [1, 7, 10, 16, 17], count, value => { count = value; render() }),
    choice('Workgroup size', [4, 8], size, value => { size = value; render() }))
  body.append(controls, summary, result, groups, buffers)
  render()
}

function pingPong (host: HTMLElement): void {
  const body = frame(host, 'Two buffers, one snapshot', 'Advance a tick. Each point moves +1 along X; the two physical buffers stay in place.')
  let tick = 0
  let data = [[0, 2, 4, 6], [0, 0, 0, 0]]
  const result = status()
  const buffers = element('div')
  const render = (): void => {
    const source = tick % 2
    const target = 1 - source
    result.textContent = tick === 0
      ? 'Ready: read A → write B. A holds the initial positions.'
      : `Tick ${tick} complete: read ${target === 0 ? 'A' : 'B'} → wrote ${source === 0 ? 'A' : 'B'}. ` +
        `Draw ${source === 0 ? 'A' : 'B'}. Next tick reverses the bindings.`
    buffers.replaceChildren(...data.map((values, index) => cells(
      `Buffer ${index === 0 ? 'A' : 'B'} · ${index === source ? 'current positions / next input' : 'next output'} · X values`, values)))
  }
  const controls = element('div', undefined, 'controls')
  controls.append(button('Advance tick', () => {
    data[1 - tick % 2] = data[tick % 2].map(value => value + 1)
    tick++
    render()
  }), button('Reset buffers', () => { tick = 0; data = [[0, 2, 4, 6], [0, 0, 0, 0]]; render() }))
  body.append(controls, result, buffers)
  render()
}

function reduction (host: HTMLElement): void {
  const body = frame(host, 'Build a sum together', 'Reveal one tree level at a time. Each new value adds a pair from the previous row.')
  const levels = [[3, 1, 4, 2, 5, 0, 2, 7]]
  while (levels[levels.length - 1].length > 1) {
    const previous = levels[levels.length - 1]
    levels.push(Array.from({ length: previous.length / 2 }, (_, index) => previous[2 * index] + previous[2 * index + 1]))
  }
  let level = 0
  const rows = element('div', undefined, 'learning-reduction')
  const result = status()
  const next = button('Combine pairs', () => { level++; render() })
  const render = (): void => {
    rows.replaceChildren(...levels.slice(0, level + 1).map((values, index) => {
      const row = cells(index === 0 ? 'Input' : `Level ${index}`, values)
      for (const cell of row.querySelectorAll<HTMLElement>('.learning-cell')) {
        cell.style.gridColumn = `span ${2 ** index}`
      }
      return row
    }))
    result.textContent = level === 0
      ? 'Eight inputs. The first pair is 3 + 1.'
      : level === 3
        ? 'Result: 24. Seven additions total, arranged in three parallel levels.'
        : `Level ${level}: ${levels[level].length} partial sums. Each pair can be added independently.`
    next.disabled = level === 3
  }
  const controls = element('div', undefined, 'controls')
  controls.append(next, button('Reset reduction', () => { level = 0; render() }))
  body.append(controls, result, rows)
  render()
}

function grid (host: HTMLElement): void {
  const body = frame(host, 'Pack points by cell', 'Assign each point to a cell. Counts, starting offsets and packed point IDs update together.')
  const assignments = [2, 0, 2, 0, 0]
  const controls = element('div', undefined, 'controls')
  const result = status()
  const rows = element('div')
  const render = (): void => {
    const counts = [0, 0, 0]
    for (const cell of assignments) counts[cell]++
    const offsets = [0]
    for (const count of counts) offsets.push(offsets[offsets.length - 1] + count)
    const packed = [0, 1, 2].flatMap(cell => assignments.flatMap((value, index) => value === cell ? [index] : []))
    rows.replaceChildren(cells('Count · points per cell', counts), cells('Scan · offsets, including final total', offsets),
      cells('Scatter · packed point IDs', packed))
    const ranges = element('div', undefined, 'learning-groups')
    for (let cell = 0; cell < 3; cell++) {
      const ids = packed.slice(offsets[cell], offsets[cell + 1])
      ranges.append(element('p', `Cell ${cell}: [${offsets[cell]}, ${offsets[cell + 1]}) → ${ids.length ? ids.join(', ') : 'empty'}`))
    }
    rows.append(ranges)
    const emptyCount = counts.filter(count => count === 0).length
    result.textContent = `Five point IDs preserved. Empty cells: ${emptyCount}. Offsets end at ${offsets[3]}, the total count.`
  }
  assignments.forEach((value, index) => controls.append(choice(`Point ${index} → cell`, [0, 1, 2], value, cell => {
    assignments[index] = cell
    render()
  })))
  body.append(controls, rows, result)
  render()
}

function rendering (host: HTMLElement): void {
  const body = frame(host, 'From a square to a circle', 'Switch stages and change the radius. The center stays fixed; only the point’s footprint changes.')
  let stage = 0
  let radius = 42
  const controls = element('div', undefined, 'controls')
  controls.classList.add('learning-stages')
  controls.setAttribute('role', 'group')
  controls.setAttribute('aria-label', 'Rendering stage')
  const picture = element('div', undefined, 'learning-picture')
  const result = status()
  const labels = ['1 · Vertices', '2 · Triangles', '3 · Circle coverage']
  const descriptions = [
    'Four corner positions around one point. The vertex shader places them using the point position and radius.',
    'Two triangles cover the square. Rasterization generates fragments inside those triangles.',
    'The fragment shader evaluates distance from the center. Outside the radius, coverage is zero; inside, the circle remains.',
  ]
  const buttons = labels.map((label, index) => button(label, () => { stage = index; render() }))
  const render = (): void => {
    buttons.forEach((node, index) => node.setAttribute('aria-pressed', String(stage === index)))
    const low = 100 - radius
    const high = 100 + radius
    const corners = [[low, low], [high, low], [high, high], [low, high]]
    // All interpolated values are local numeric state; no authored HTML is evaluated.
    picture.innerHTML = `<svg viewBox="20 20 160 160" role="img" aria-label="${labels[stage]}, radius ${radius}">
      <path d="M100 10V190 M10 100H190" class="learning-axis"/>
      <rect x="${low}" y="${low}" width="${radius * 2}" height="${radius * 2}" class="learning-outline"/>
      ${stage === 1 ? `<path d="M${low} ${low}H${high}V${high}Z M${low} ${low}V${high}H${high}Z" class="learning-triangles"/>` : ''}
      ${stage === 2 ? `<circle cx="100" cy="100" r="${radius}" class="learning-disc"/>` : ''}
      ${stage < 2 ? corners.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" class="learning-vertex"/>`).join('') : ''}
      <circle cx="100" cy="100" r="2" class="learning-center"/>
    </svg>`
    result.textContent = descriptions[stage]
  }
  controls.append(...buttons)
  const explanation = element('div', undefined, 'learning-render-explanation')
  explanation.append(choice('Radius (illustration units)', [24, 42, 65], radius, value => { radius = value; render() }), result)
  const preview = element('div', undefined, 'learning-render-preview')
  preview.append(picture, explanation)
  body.append(controls, preview)
  render()
}

export const learningExamples: Record<string, (host: HTMLElement) => void> = {
  invocations,
  pingPong,
  reduction,
  grid,
  rendering,
}

export function addLearningContents (host: HTMLElement, sectionId?: string): void {
  const contents = element('details', undefined, 'learning-contents')
  const summary = element('summary', 'Chapters · 12 lessons and references')
  contents.append(summary)
  const links = element('nav')
  links.setAttribute('aria-label', 'Guide chapters')
  const headings = Array.from(host.querySelectorAll<HTMLElement>('h2'))
  const jump = (target: HTMLElement, href: string): void => {
    // Keep local example state while making the address match the selected chapter.
    window.history.replaceState(window.history.state, '', href)
    target.scrollIntoView({ block: 'start' })
    target.focus({ preventScroll: true })
  }
  for (const [index, heading] of headings.entries()) {
    const id = String(index + 1)
    heading.id = `learn-${id}`
    heading.tabIndex = -1
    const link = element('a', heading.textContent ?? '')
    link.href = `#/learn/${id}`
    link.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      contents.open = false
      jump(heading, link.href)
    })
    links.append(link)
    const chapter = element('div', undefined, 'learning-chapter')
    const back = element('a', 'Chapters ↑', 'learning-back')
    back.href = '#/learn'
    back.setAttribute('aria-label', `Back to chapters from ${heading.textContent}`)
    back.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      contents.open = true
      jump(summary, back.href)
    })
    heading.before(chapter)
    chapter.append(heading, back)
  }
  contents.append(links)
  headings[0]?.parentElement?.before(contents)
  if (sectionId) {
    const target = host.querySelector<HTMLElement>(`#learn-${CSS.escape(sectionId)}`)
    target?.scrollIntoView({ block: 'start' })
    target?.focus({ preventScroll: true })
  }
}
