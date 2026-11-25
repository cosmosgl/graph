// Installed only in a benchmark page, before loading its standalone Graph.
export function installPhaseProbe(options) {
  const phaseOf = (entry, code) => {
    if (code.includes('struct NearParams')) return 'near'
    if (entry === 'farForce' || entry === 'repulse') return 'far'
    if (code.includes('sharedBounds') || code.includes('struct GridSettings') || ['buildGrid', 'fitBox', 'clearLeaves', 'binPoints', 'leafSums', 'mergeChildren', 'normalizeCells',
      'placePoints', 'leafCentroids', 'mergeLevel'].includes(entry)) return 'grid'
    return 'other'
  }
  const shaderCodes = new WeakMap()
  const pipeStages = new WeakMap()
  const descriptors = []
  const prepared = new Map()
  const preparedModules = new Map()
  const nativeCalls = []
  const passes = []
  let recording = false
  let ticks = 0
  let query
  let resolved
  let mapped

  window.prepareLassoProps = props => ({ ...props, enableRenderLoop: false, onSimulationTick(...args) {
    ticks++
    props.onSimulationTick?.(...args)
  } })

  // The normal Graph requests its own features. Only timestamped replicas add this feature.
  const requestDevice = GPUAdapter.prototype.requestDevice
  GPUAdapter.prototype.requestDevice = function(descriptor = {}) {
    if (!options.timestamps) return requestDevice.call(this, descriptor)
    if (!this.features.has('timestamp-query')) throw Error('Native timestamp queries unavailable')
    return requestDevice.call(this, { ...descriptor, requiredFeatures: [...new Set([...(descriptor.requiredFeatures ?? []), 'timestamp-query'])] })
  }
  const createModule = GPUDevice.prototype.createShaderModule
  GPUDevice.prototype.createShaderModule = function(desc) {
    const start = performance.now()
    const module = (recording && preparedModules.get(desc.code)) || createModule.call(this, desc)
    shaderCodes.set(module, desc.code)
    if (recording) nativeCalls.push({ kind: 'createShaderModule', label: desc.label, ms: performance.now() - start })
    return module
  }
  const createPipeline = GPUDevice.prototype.createComputePipeline
  const keyFor = (entry, constants, code) => JSON.stringify([entry, constants, code])
  GPUDevice.prototype.createComputePipeline = function(desc) {
    const code = shaderCodes.get(desc.compute.module)
    if (!code || desc.layout !== 'auto') throw Error('Expected the Graph native WGSL pipeline with auto layout')
    const entry = desc.compute.entryPoint
    const constants = desc.compute.constants ?? {}
    const phase = phaseOf(entry, code)
    const key = keyFor(entry, constants, code)
    const start = performance.now()
    const hit = recording && prepared.has(key)
    const pipe = hit ? prepared.get(key) : createPipeline.call(this, desc)
    pipeStages.set(pipe, { phase, entry })
    if (recording) {
      descriptors.push({ code, entry, constants, phase, label: desc.label })
      nativeCalls.push({ kind: 'createComputePipeline', label: desc.label, entry, phase, prepared: hit, ms: performance.now() - start })
    }
    return pipe
  }
  for (const name of ['createBuffer', 'createBindGroup']) {
    const original = GPUDevice.prototype[name]
    GPUDevice.prototype[name] = function(desc) {
      if (!recording) return original.call(this, desc)
      const start = performance.now()
      const result = original.call(this, desc)
      nativeCalls.push({ kind: name, label: desc.label, bytes: desc.size, ms: performance.now() - start })
      return result
    }
  }

  // WebGPU exposes timestamps at pass boundaries. Preserve dispatch order and
  // add a boundary only when an adjacent dispatch belongs to a different phase.
  const begin = GPUCommandEncoder.prototype.beginComputePass
  GPUCommandEncoder.prototype.beginComputePass = function(desc = {}) {
    if (!recording || !options.timestamps) return begin.call(this, desc)
    const encoder = this
    let handle
    let current
    return {
      setPipeline(pipeline) {
        const stage = pipeStages.get(pipeline)
        if (!stage) throw Error('Missing native pipeline identity')
        if (current?.phase !== stage.phase) {
          handle?.end()
          const i = 2 * passes.length
          if (i + 1 >= query.count) throw Error('Too many timestamp intervals')
          current = { phase: stage.phase, entries: [] }
          passes.push(current)
          handle = begin.call(encoder, { ...desc, timestampWrites: { querySet: query, beginningOfPassWriteIndex: i, endOfPassWriteIndex: i + 1 } })
        }
        current.entries.push(stage.entry)
        handle.setPipeline(pipeline)
      },
      setBindGroup: (...args) => handle.setBindGroup(...args),
      dispatchWorkgroups: (...args) => handle.dispatchWorkgroups(...args),
      end: () => handle?.end(),
    }
  }

  window.profileLassoStep = async (recipes) => {
    const { graph, initial } = window.lassoFixture
    if (ticks !== 0 || graph.constructor !== window.Cosmos.Graph) throw Error('Invalid initial Graph state')
    graph.pause()
    graph.renderOneFrame()
    const device = graph.simulation.device.handle
    await device.queue.onSubmittedWorkDone()
    const startPrep = performance.now()
    for (const r of recipes.filter(r => options.prepare === 'all' || r.phase === options.prepare)) {
      let module = preparedModules.get(r.code)
      if (!module) {
        module = createModule.call(device, { code: r.code })
        shaderCodes.set(module, r.code)
        preparedModules.set(r.code, module)
      }
      const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: r.entry, constants: r.constants } })
      prepared.set(keyFor(r.entry, r.constants, r.code), pipeline)
    }
    const prepareMs = performance.now() - startPrep
    if (options.timestamps) {
      query = device.createQuerySet({ type: 'timestamp', count: 128 })
      resolved = device.createBuffer({ size: 1024, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC })
      mapped = device.createBuffer({ size: 1024, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    }
    await device.queue.onSubmittedWorkDone()
    const records = []
    for (let tick = 1; tick <= 2; tick++) {
      nativeCalls.length = passes.length = 0
      recording = true
      const start = performance.now()
      graph.step()
      const submitted = performance.now()
      recording = false
      await device.queue.onSubmittedWorkDone()
      const done = performance.now()
      if (ticks !== tick) throw Error('Unexpected simulation tick')
      if (options.timestamps) {
        const bytes = passes.length * 16
        const encoder = device.createCommandEncoder()
        encoder.resolveQuerySet(query, 0, passes.length * 2, resolved, 0)
        encoder.copyBufferToBuffer(resolved, 0, mapped, 0, bytes)
        device.queue.submit([encoder.finish()])
        await mapped.mapAsync(GPUMapMode.READ)
        const times = new BigUint64Array(mapped.getMappedRange())
        for (const [i, pass] of passes.entries()) pass.ms = Number(times[2 * i + 1] - times[2 * i]) / 1e6
        mapped.unmap()
      }
      const xy = await graph.getPointPositionsAsync()
      const digest = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), n => n.toString(16).padStart(2, '0')).join('')
      records.push({ tick, ms: done - start, submitMs: submitted - start, passes: structuredClone(passes),
        nativeCalls: structuredClone(nativeCalls), positions: await digest(xy), mesh: await digest(initial) })
    }
    query?.destroy()
    resolved?.destroy()
    mapped?.destroy()
    return { adapter: graph.simulation.device.info, seed: graph.config.randomSeed, zoom: graph.getZoomLevel(),
      center: graph.spaceToScreenPosition([2048, 2048]), visibility: document.visibilityState, prepareMs,
      records, recipes: options.discovery ? descriptors : undefined }
  }
}
