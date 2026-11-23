import { headingSlug } from '../app/sections'

export type CheckStatus = 'passed' | 'failed'
export type CheckResult = { status: CheckStatus; detail?: string }
export type LiveCheckItem = { id: string; title: string; description: string; recorded: CheckStatus }
export type LiveCheckGroup = { heading: string; items: readonly LiveCheckItem[] }
export type LiveChecksOptions = {
  recordedLabel: string;
  recordedEnvironment: string;
  ruleNote: string;
  groups: readonly LiveCheckGroup[];
  runCheck: (id: string) => Promise<CheckResult>;
  runtimeLabel?: string;
  unavailableReason?: string;
  sectionId?: string;
}

function textElement<K extends keyof HTMLElementTagNameMap> (tag: K, text: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  element.textContent = text
  return element
}

const labels = { passed: 'Passed', failed: 'Failed' }

export function createLiveChecks (options: LiveChecksOptions): { element: HTMLElement; stop(): void; destroy(): void } {
  const element = document.createElement('section')
  element.className = 'live-checks'
  if (options.sectionId) element.id = options.sectionId
  const header = document.createElement('div')
  header.className = 'live-checks-header'
  const runLabel = 'run on this GPU'
  const runAll = textElement('button', runLabel)
  runAll.type = 'button'
  runAll.disabled = !!options.unavailableReason
  const controls = document.createElement('span')
  controls.append(`${options.recordedEnvironment} · `, runAll)
  const status = textElement('span', options.unavailableReason ?? '')
  status.setAttribute('role', 'status')
  header.append(controls, ' ', status)
  element.append(textElement('h2', 'Automated test results'), header, textElement('p', options.ruleNote))

  const rows = new Map<string, { cell: HTMLTableCellElement; detail: HTMLElement; result?: CheckResult }>()
  let runId = 0
  let active: string | undefined
  let destroyed = false
  const listeners = new AbortController()
  function render (id: string): void {
    const { cell, detail, result } = rows.get(id)!
    const running = active === id
    cell.textContent = running ? 'Running…' : result ? labels[result.status] : '—'
    cell.dataset.status = running ? 'running' : result?.status ?? ''
    detail.textContent = !running && result?.status === 'failed' ? result.detail ?? '' : ''
    detail.hidden = !detail.textContent
  }

  function formatSummary (passed: number, failed: number): string {
    const counts = failed ? `${passed} passed, ${failed} failed` : `${passed} of ${rows.size} passed`
    return `${counts} on ${options.runtimeLabel || 'this GPU'}.`
  }

  function summary (): string {
    let passed = 0
    let failed = 0
    for (const { result } of rows.values()) {
      if (result?.status === 'passed') passed++
      if (result?.status === 'failed') failed++
    }
    return formatSummary(passed, failed)
  }

  function stop (): void {
    runId++
    if (active === undefined) return
    const previous = active
    active = undefined
    render(previous)
    runAll.textContent = runLabel
    status.textContent = `Stopped. ${summary()}`
  }

  async function start (): Promise<void> {
    if (destroyed || options.unavailableReason) return
    stop()
    const current = runId
    for (const [id, row] of rows) {
      row.result = undefined
      render(id)
    }
    runAll.textContent = 'stop'
    let index = 0
    for (const [id, row] of rows) {
      index++
      active = id
      render(id)
      status.textContent = `Running ${index} of ${rows.size}…`
      let result: CheckResult
      try { result = await options.runCheck(id) } catch (error) {
        result = { status: 'failed', detail: error instanceof Error ? error.message : String(error) }
      }
      if (current !== runId) return
      row.result = result
      active = undefined
      render(id)
    }
    runAll.textContent = runLabel
    status.textContent = summary()
  }

  for (const group of options.groups) {
    const heading = textElement('h3', group.heading)
    if (options.sectionId) heading.id = `${options.sectionId}-${headingSlug(group.heading)}`
    const table = document.createElement('table')
    table.setAttribute('aria-label', group.heading)
    const headings = table.createTHead().insertRow()
    for (const title of ['Test case', options.recordedLabel, 'This GPU']) {
      const th = textElement('th', title)
      th.scope = 'col'
      headings.append(th)
    }
    const body = table.createTBody()
    for (const item of group.items) {
      const row = body.insertRow()
      const description = row.insertCell()
      const detail = document.createElement('p')
      detail.className = 'live-check-detail'
      detail.hidden = true
      description.append(textElement('strong', `${item.title}. `), item.description, detail)
      row.insertCell().textContent = labels[item.recorded]
      const cell = row.insertCell()
      cell.textContent = '—'
      rows.set(item.id, { cell, detail })
    }
    const scroll = document.createElement('div')
    scroll.className = 'live-check-table'
    scroll.append(table)
    element.append(heading, scroll)
  }

  if (!runAll.disabled) {
    // Size the narrow status row for a stopped run with both passes and failures.
    header.dataset.statusReserve = `Stopped. ${formatSummary(rows.size, rows.size)}`
  }
  runAll.addEventListener('click', () => {
    if (active !== undefined) stop()
    else start()
  }, { signal: listeners.signal })
  return {
    element,
    stop,
    destroy (): void {
      destroyed = true
      stop()
      listeners.abort()
    },
  }
}
