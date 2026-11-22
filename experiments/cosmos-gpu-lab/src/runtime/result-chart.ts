type Value = number | readonly [number, number]
type Bar = readonly [label: string, value: Value]

export type ResultChart = {
  title: string;
  context?: string;
  unit?: string;
  bars: readonly [Bar, Bar];
  reference?: { value: number; label: string; upperLimit?: boolean };
}

function isNumber (value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isBar (bar: unknown): bar is Bar {
  if (!Array.isArray(bar) || bar.length !== 2 || typeof bar[0] !== 'string' || !bar[0].trim()) return false
  const value: unknown = bar[1]
  return isNumber(value) || (Array.isArray(value) && value.length === 2 &&
    isNumber(value[0]) && isNumber(value[1]) && value[0] <= value[1])
}

export function readResultChart (source: string): ResultChart | undefined {
  let data: Partial<ResultChart> | null
  try {
    data = JSON.parse(source) as Partial<ResultChart> | null
  } catch {
    return undefined
  }
  if (!data || typeof data.title !== 'string' || !data.title.trim() || typeof data.context !== 'string' ||
    (data.unit !== undefined && typeof data.unit !== 'string') ||
    !Array.isArray(data.bars) || data.bars.length !== 2 || !data.bars.every(isBar)) return undefined
  const { title, context, unit, bars, reference } = data
  if (reference !== undefined && (!reference || !isNumber(reference.value) ||
    typeof reference.label !== 'string' || !reference.label.trim() ||
    (reference.upperLimit !== undefined && typeof reference.upperLimit !== 'boolean'))) return undefined
  return { title, context, unit, bars: [bars[0], bars[1]], reference }
}

const numbers = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 })

function span (className: string, text?: string): HTMLSpanElement {
  const element = document.createElement('span')
  element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

export function renderResultChart ({
  title, context, bars, unit, reference, formatValue = numbers.format,
}: ResultChart & { formatValue?: (value: number) => string }): HTMLElement {
  const chart = document.createElement('figure')
  chart.className = 'result-chart'
  const caption = document.createElement('figcaption')
  caption.append(span('result-chart-title', title))
  if (context) caption.append(span('result-chart-context', context))
  const rows = document.createElement('div')
  rows.className = 'result-chart-rows'
  chart.append(caption, rows)

  // Ranges here are two observations. Plot their average and retain both readings in the label.
  const lengths = bars.map(([, value]) => typeof value === 'number' ? value : value[0] / 2 + value[1] / 2)
  const maximum = Math.max(...lengths, reference?.value ?? 0) || 1
  const percentage = (value: number): string => `${(value / maximum) * 94}%`
  if (reference) {
    rows.classList.add('result-chart-with-reference')
    rows.style.setProperty('--reference-position', percentage(reference.value))
    const guide = document.createElement('div')
    guide.className = 'result-chart-row'
    const axis = span('result-chart-axis')
    axis.append(span('result-chart-reference', reference.label))
    guide.append(axis)
    rows.append(guide)
  }

  for (const [index, [label, value]] of bars.entries()) {
    const track = span('result-chart-track')
    const bar = span('result-chart-bar')
    track.setAttribute('aria-hidden', 'true')
    track.classList.toggle('result-chart-first', index === 0)
    bar.style.width = percentage(lengths[index])
    track.append(bar)
    const display = typeof value === 'number' ? formatValue(value) : value.map(part => formatValue(part)).join('–')
    const readout = span('result-chart-value', unit ? `${display} ${unit}` : display)
    const overLimit = reference?.upperLimit === true && lengths[index] > reference.value
    track.classList.toggle('result-chart-over-limit', overLimit)
    readout.classList.toggle('result-chart-over-limit', overLimit)
    const row = document.createElement('div')
    row.className = 'result-chart-row'
    row.append(span('result-chart-label', label), track, readout)
    rows.append(row)
  }
  return chart
}
