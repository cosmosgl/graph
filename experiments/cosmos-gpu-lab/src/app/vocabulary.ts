type VocabularyTerm = {
  id: string;
  heading: string;
  aliases: string[];
}

type TermMatch = {
  term: VocabularyTerm;
  index: number;
  length: number;
}

export const vocabularyTerms: VocabularyTerm[] = [
  { id: 'adapter', heading: 'Adapter (GPUAdapter)', aliases: ['GPUAdapter', 'adapters', 'adapter'] },
  { id: 'device', heading: 'Device (GPUDevice)', aliases: ['GPUDevice', 'devices', 'device'] },
  { id: 'queue', heading: 'Queue (GPUQueue)', aliases: ['GPUQueue', 'GPU queue', 'queues', 'queue'] },
  { id: 'canvas-context', heading: 'Canvas context (GPUCanvasContext)', aliases: ['GPUCanvasContext', 'canvas context'] },
  { id: 'feature', heading: 'Feature', aliases: ['features', 'feature'] },
  { id: 'limit', heading: 'Limit', aliases: ['device limits', 'device limit', 'limits', 'limit'] },
  { id: 'resource', heading: 'Resource', aliases: ['GPU resources', 'GPU resource', 'resources', 'resource'] },
  { id: 'buffer', heading: 'Buffer (GPUBuffer)', aliases: ['GPUBuffer', 'buffers', 'buffer'] },
  { id: 'texture', heading: 'Texture (GPUTexture)', aliases: ['GPUTexture', 'textures', 'texture'] },
  { id: 'texture-view', heading: 'Texture view (GPUTextureView)', aliases: ['GPUTextureView', 'resource/view model', 'texture views', 'texture view'] },
  { id: 'sampler', heading: 'Sampler (GPUSampler)', aliases: ['GPUSampler', 'samplers', 'sampler'] },
  { id: 'uniform-buffer', heading: 'Uniform buffer', aliases: ['uniform buffer'] },
  { id: 'storage-buffer', heading: 'Storage buffer', aliases: ['storage buffers', 'storage buffer'] },
  { id: 'mapping-staging-buffer', heading: 'Mapping and staging buffer', aliases: ['staging buffers', 'staging buffer', 'buffer mapping', 'mapping'] },
  { id: 'readback', heading: 'Readback', aliases: ['readback'] },
  { id: 'binding', heading: 'Binding', aliases: ['bindings', 'binding'] },
  { id: 'bind-group-layout', heading: 'Bind group layout (GPUBindGroupLayout)', aliases: ['GPUBindGroupLayout', 'bind group layout'] },
  { id: 'bind-group', heading: 'Bind group (GPUBindGroup)', aliases: ['GPUBindGroup', 'bind groups', 'bind group'] },
  { id: 'pipeline-layout', heading: 'Pipeline layout (GPUPipelineLayout)', aliases: ['GPUPipelineLayout', 'pipeline layout'] },
  { id: 'compute-pipeline', heading: 'Compute pipeline (GPUComputePipeline)', aliases: ['GPUComputePipeline', 'compute pipeline'] },
  { id: 'render-pipeline', heading: 'Render pipeline (GPURenderPipeline)', aliases: ['GPURenderPipeline', 'render pipeline'] },
  { id: 'pipeline-cache', heading: 'Pipeline cache', aliases: ['pipeline cache'] },
  { id: 'command-encoder', heading: 'Command encoder (GPUCommandEncoder)', aliases: ['GPUCommandEncoder', 'command encoder'] },
  { id: 'command-buffer', heading: 'Command buffer (GPUCommandBuffer)', aliases: ['GPUCommandBuffer', 'command buffers', 'command buffer'] },
  { id: 'compute-pass', heading: 'Compute pass (GPUComputePassEncoder)', aliases: ['GPUComputePassEncoder', 'compute passes', 'compute pass'] },
  { id: 'render-pass', heading: 'Render pass (GPURenderPassEncoder)', aliases: ['GPURenderPassEncoder', 'render passes', 'render pass'] },
  { id: 'copy-command', heading: 'Copy command', aliases: ['copy commands', 'copy command'] },
  { id: 'dispatch', heading: 'Dispatch', aliases: ['dispatch'] },
  { id: 'draw', heading: 'Draw', aliases: ['draw command', 'draw'] },
  { id: 'primitive-topology', heading: 'Primitive topology', aliases: ['primitive topology'] },
  { id: 'indirect-dispatch-draw', heading: 'Indirect dispatch or draw', aliases: ['indirect dispatch', 'indirect draw'] },
  { id: 'wgsl', heading: 'WGSL', aliases: ['WGSL'] },
  { id: 'shader-module', heading: 'Shader module (GPUShaderModule)', aliases: ['GPUShaderModule', 'shader modules', 'shader module'] },
  { id: 'compute-shader', heading: 'Compute shader', aliases: ['compute shaders', 'compute shader'] },
  { id: 'vertex-shader', heading: 'Vertex shader', aliases: ['vertex shaders', 'vertex shader'] },
  { id: 'fragment-shader', heading: 'Fragment shader', aliases: ['fragment shaders', 'fragment shader'] },
  { id: 'entry-point', heading: 'Entry point', aliases: ['entry points', 'entry point'] },
  { id: 'invocation', heading: 'Invocation', aliases: ['invocations', 'invocation'] },
  { id: 'workgroup', heading: 'Workgroup', aliases: ['workgroups', 'workgroup'] },
  { id: 'invocation-ids', heading: 'Global, local and workgroup IDs', aliases: ['global invocation ID', 'local invocation ID', 'workgroup ID'] },
  { id: 'address-space', heading: 'Address space', aliases: ['address spaces', 'address space'] },
  { id: 'workgroup-memory', heading: 'Workgroup memory', aliases: ['workgroup memory'] },
  { id: 'barrier', heading: 'Barrier', aliases: ['workgroupBarrier', 'barriers', 'barrier'] },
  { id: 'atomic-operation', heading: 'Atomic operation', aliases: ['atomic operations', 'atomic operation', 'atomics', 'atomic'] },
  { id: 'race-condition', heading: 'Race condition', aliases: ['race conditions', 'race condition', 'data race'] },
  { id: 'gpu-resident-data', heading: 'GPU-resident data', aliases: ['GPU-resident data', 'GPU-resident', 'GPU resident'] },
  { id: 'synchronization-boundary', heading: 'CPU/GPU synchronization boundary', aliases: ['CPU/GPU synchronization boundary', 'synchronization boundary'] },
  { id: 'ping-pong-buffers', heading: 'Ping-pong buffers', aliases: ['ping-pong buffers', 'ping-pong buffer', 'ping-ponging'] },
  { id: 'double-buffering', heading: 'Double buffering', aliases: ['double buffering', 'double-buffered'] },
  { id: 'resource-hazard', heading: 'Resource hazard', aliases: ['resource hazards', 'resource hazard'] },
  { id: 'device-loss', heading: 'Device loss', aliases: ['device loss', 'device.lost'] },
  { id: 'reduction', heading: 'Reduction', aliases: ['reductions', 'reduction'] },
  { id: 'scan', heading: 'Scan / prefix sum', aliases: ['prefix sums', 'prefix sum', 'scans', 'scan'] },
  { id: 'scatter', heading: 'Scatter', aliases: ['scatters', 'scatter'] },
  { id: 'gather', heading: 'Gather', aliases: ['gathers', 'gather'] },
  { id: 'compaction', heading: 'Compaction', aliases: ['compaction'] },
  { id: 'spatial-grid', heading: 'Grid / spatial grid', aliases: ['spatial grids', 'spatial grid'] },
  { id: 'grid-primitives', heading: 'Grid primitives', aliases: ['grid primitives'] },
  { id: 'csr', heading: 'CSR (compressed sparse row)', aliases: ['compressed sparse row', 'CSR'] },
  { id: 'topology-builder', heading: 'Topology builder', aliases: ['topology builders', 'topology builder'] },
  {
    id: 'gpu-command-graph',
    heading: 'GPU command graph',
    aliases: ['GPU command graphs', 'GPU command graph', 'GPUCommandGraph', 'command graphs', 'command graph'],
  },
]

const patterns = vocabularyTerms.flatMap(term =>
  term.aliases.map(alias => ({ term, alias, normalized: alias.toLocaleLowerCase() }))
).sort((left, right) => right.alias.length - left.alias.length)

function isWordCharacter (character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}_]/u.test(character)
}

function hasWordBoundaries (text: string, index: number, length: number): boolean {
  return !isWordCharacter(text[index - 1]) && !isWordCharacter(text[index + length])
}

function findNextMatch (
  text: string,
  start: number,
  linkedTerms: Set<string>
): TermMatch | undefined {
  const normalizedText = text.toLocaleLowerCase()
  let best: TermMatch | undefined

  for (const pattern of patterns) {
    if (linkedTerms.has(pattern.term.id)) continue
    let index = normalizedText.indexOf(pattern.normalized, start)
    while (index >= 0 && !hasWordBoundaries(text, index, pattern.alias.length)) {
      index = normalizedText.indexOf(pattern.normalized, index + 1)
    }
    if (index < 0) continue
    if (!best || index < best.index || (index === best.index && pattern.alias.length > best.length)) {
      best = { term: pattern.term, index, length: pattern.alias.length }
    }
  }

  return best
}

function canLinkTextNode (node: Text): boolean {
  const parent = node.parentElement
  return Boolean(
    parent &&
    node.data.trim() &&
    !parent.closest('a, code, pre, h1, h2, h3, svg, .mermaid-source, .mermaid-diagram, .diagram-error')
  )
}

export function vocabularyTermHref (termId: string): string {
  return `#/vocabulary/${encodeURIComponent(termId)}`
}

export function linkVocabularyTerms (host: HTMLElement): void {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let current = walker.nextNode()
  while (current) {
    if (current instanceof Text && canLinkTextNode(current)) nodes.push(current)
    current = walker.nextNode()
  }

  const linkedTerms = new Set<string>()
  for (const node of nodes) {
    const text = node.data
    const fragment = document.createDocumentFragment()
    let cursor = 0
    let match = findNextMatch(text, cursor, linkedTerms)
    if (!match) continue

    while (match) {
      fragment.append(text.slice(cursor, match.index))
      const link = document.createElement('a')
      link.className = 'vocabulary-term-link'
      link.href = vocabularyTermHref(match.term.id)
      link.textContent = text.slice(match.index, match.index + match.length)
      link.title = `Vocabulary: ${match.term.heading}`
      fragment.append(link)
      linkedTerms.add(match.term.id)
      cursor = match.index + match.length
      match = findNextMatch(text, cursor, linkedTerms)
    }

    fragment.append(text.slice(cursor))
    node.replaceWith(fragment)
  }
}

export function indexVocabularyTerms (host: HTMLElement): void {
  const headings = Array.from(host.querySelectorAll<HTMLHeadingElement>('h3'))
  for (const term of vocabularyTerms) {
    const heading = headings.find(candidate => candidate.textContent?.trim() === term.heading)
    if (heading) heading.id = term.id
  }
}
