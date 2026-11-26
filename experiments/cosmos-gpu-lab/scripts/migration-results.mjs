function percentile(values, fraction) {
  if (!values.length) return null
  const usable = values.filter(Number.isFinite).sort((a, b) => a - b)
  return usable.length ? usable[Math.ceil(fraction * usable.length) - 1] : null
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

const readback = (run, shape) => percentile(run.readbacks.filter(row => row.shape === shape).map(row => row.areaMs), 0.95)
const measures = [
  ['Steady frame p95', 'frame', run => run.steady?.p95],
  ['Interaction frame p95', 'frame', run => run.interaction?.p95],
  ['First click', 'feedback', run => run.picked[0]?.ms],
  ['Click p95', 'feedback', run => percentile(run.picked.map(row => row.ms), 0.95)],
  ['Slowest click', 'feedback', run => Math.max(...run.picked.map(row => row.ms))],
  ['Cold startup', 'bulk', run => run.startupMs],
  ['Warm startup', 'bulk', run => run.warmStartupMs],
  ['Point update', 'feedback', run => run.updates.point],
  ['Topology update', 'bulk', run => run.updates.topology],
  ['Full replacement', 'bulk', run => run.updates.replacement],
  ['Resize', 'feedback', run => run.updates.resize],
  ['Rectangle p95', 'feedback', run => readback(run, 'rectangle')],
  ['Polygon p95', 'feedback', run => readback(run, 'polygon')],
  ['Moving labels p95', 'feedback', run => percentile(run.readbacks.map(row => row.labelMs), 0.95)],
  ['Peak tracked memory', 'memory', run => run.peakBytes == null ? null : run.peakBytes / 2 ** 20],
]

function samples(runs, measure) {
  return runs.map(run => run.result && measure(run.result)).filter(Number.isFinite)
}

const validRun = run => run.status === 'complete' && run.result?.quality?.freeMoved > 0 &&
  ['nonfinite', 'flagErrors', 'fixedMoved'].every(key => run.result.quality[key] === 0)

export function calibrate(controls, labels) {
  const ready = controls.length >= 2 && controls.every(validRun) && new Set(controls.map(run => run.result.input)).size === 1
  const refresh = ready ? average(controls.map(run => run.result.refreshMs)) : null
  return Object.fromEntries(measures.filter(([label]) => !labels || labels.includes(label)).map(([label, category, measure]) => {
    const values = samples(controls, measure)
    if (!ready || values.length !== controls.length) return [label, { margin: null, reason: 'No repeated complete WebGL control' }]
    const baseline = average(values)
    const spread = Math.max(...values) - Math.min(...values)
    const cap = category === 'frame' ? 0.75 * refresh : category === 'feedback' ? refresh : baseline * 0.1
    const floor = Math.min(cap, category === 'memory' ? 1 : refresh * 0.25)
    const margin = spread > cap ? null : Math.max(floor, spread)
    return [label, { baseline, spread, cap, margin, ...(margin === null ? { reason: 'WebGL A/A varied more than the user-impact limit' } : {}) }]
  }))
}

function matchingPicks(runs) {
  return runs.every(({ result }) => result?.picked.length === 12 && result.picked.every(({ id, requested }) => id === requested))
}

export function compare(pairs, calibration) {
  const webgl = pairs.map(pair => pair.webgl)
  const webgpu = pairs.map(pair => pair.webgpu)
  const runs = [...webgl, ...webgpu]
  const comparable = pairs.length >= 2 && runs.every(validRun) && new Set(runs.map(run => run.result.input)).size === 1 &&
    new Set(runs.map(run => run.result.browser)).size === 1
  const picksMatch = matchingPicks(runs)
  return measures.filter(([label]) => label in calibration).map(([label, category, measure]) => {
    const left = samples(webgl, measure)
    const right = samples(webgpu, measure)
    const gl = left.length ? average(left) : null
    const gpu = right.length ? average(right) : null
    const difference = gl !== null && gpu !== null ? gpu - gl : null
    const percent = difference !== null && gl > 0 ? 100 * difference / gl : null
    const { margin, baseline, cap, reason } = calibration[label]
    const pickMetric = label.endsWith('click') || label === 'Click p95'
    let detail = null
    let verdict = 'Not assessed'
    if (!comparable) detail = 'Missing a complete matched pair'
    else if (margin === null) detail = reason
    else if (pickMetric && !picksMatch) detail = 'The same visible point or background was not confirmed at each click'
    else if (left.length !== pairs.length || right.length !== pairs.length) detail = 'Missing measurement'
    else if (left.some(value => Math.abs(value - baseline) > cap)) detail = 'Paired WebGL runs drifted beyond the control limit'
    else {
      const slower = right.map((value, i) => value - left[i] > margin)
      if (slower.every(Boolean)) verdict = category === 'memory' ? 'Over margin' : 'Slower'
      else if (!slower.some(Boolean)) verdict = 'Within margin'
      else detail = 'Paired results disagree'
    }
    return { label, unit: category === 'memory' ? 'MiB' : 'ms', gl, gpu, difference, percent, margin, verdict, detail }
  })
}

export function formatComparison(rows) {
  const show = value => value === null ? '—' : value.toFixed(1)
  const signed = value => value !== null && value > 0 ? `+${show(value)}` : show(value)
  return [
    '| Metric | WebGL | WebGPU | Change | Change % | Margin | Timing verdict |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...rows.map(({ label, unit, gl, gpu, difference, percent, margin, verdict, detail }) =>
      `| ${label} (${unit}) | ${show(gl)} | ${show(gpu)} | ${signed(difference)} | ${signed(percent)} | ${show(margin)} | ${verdict}${detail ? ` · ${detail}` : ''} |`),
  ].join('\n')
}
