// Installed in the page for an isolated diagnostic lane, outside calibration.
export function installWorkflowTrace() {
  const trace = { phase: '', events: [] }
  window.forceWorkflowTrace = trace
  const now = () => performance.now()
  const record = (method, extra = {}) => {
    const row = { phase: trace.phase, method, start: now(), ...extra }
    trace.events.push(row)
    return row
  }
  for (const type of ['mousemove', 'mousedown', 'click']) {
    window.addEventListener(type, event => {
      if (trace.phase) record(`DOM ${type}`, { eventTime: event.timeStamp, trusted: event.isTrusted, x: event.clientX, y: event.clientY })
    }, true)
  }
  const prototype = window.Cosmos.Graph.prototype
  const first = prototype.renderOneFrame
  prototype.renderOneFrame = function(...args) {
    prototype.renderOneFrame = first
    const device = this.simulation.device
    const queue = device.handle?.queue
    // Traces observe promises without awaiting them on the graph's critical path.
    function wrap(target, key, prefix, describe) {
      const native = target?.[key]
      if (typeof native !== 'function') return
      target[key] = function(...values) {
        if (!trace.phase) return native.apply(this, values)
        const row = record(`${prefix}.${key}`, describe?.(values) ?? {})
        const result = native.apply(this, values)
        row.returned = now()
        if (result?.then) result.then(() => { row.resolved = now() }, error => { row.error = String(error) })
        if (key === 'submit' && queue) queue.onSubmittedWorkDone().then(() => { row.queueCompleted = now() }, error => { row.error = String(error) })
        return result
      }
    }
    for (const key of ['drawFrame', 'renderOneFrame', 'render', 'setLinks', 'setPointPositions', 'setPointPosition', 'pickAt']) {
      wrap(this, key, 'graph')
    }
    for (const key of ['draw', 'pick', 'update']) wrap(this.renderer, key, 'renderer')
    wrap(device, 'beginRenderPass', 'device', ([options]) => ({ framebuffer: options?.framebuffer?.id ?? 'canvas' }))
    wrap(device, 'submit', 'device')
    return this.renderOneFrame(...args)
  }
}
