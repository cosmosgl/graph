import vocabularySource from '../docs/vocabulary.md?raw'
import { conceptHref } from './router'

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

type ActivePopover = {
  trigger: HTMLButtonElement;
  popover: HTMLSpanElement;
  pinned: boolean;
  closeTimer?: number;
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

function plainTextFromMarkdown (value: string): string {
  return value
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeHeading (value: string): string {
  return plainTextFromMarkdown(value).toLocaleLowerCase()
}

function readVocabularySummaries (source: string): Map<string, string> {
  const summaries = new Map<string, string>()
  const lines = source.split(/\r?\n/)

  for (let index = 0; index < lines.length; index++) {
    const heading = /^###\s+(.+)$/.exec(lines[index])
    if (!heading) continue

    let cursor = index + 1
    while (cursor < lines.length && !lines[cursor].trim()) cursor += 1

    const paragraph: string[] = []
    while (cursor < lines.length && lines[cursor].trim()) {
      const line = lines[cursor].trim()
      if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|```|\|)/.test(line)) break
      paragraph.push(line)
      cursor += 1
    }

    if (paragraph.length) {
      summaries.set(normalizeHeading(heading[1]), plainTextFromMarkdown(paragraph.join(' ')))
    }
  }

  return summaries
}

const vocabularySummaries = readVocabularySummaries(vocabularySource)
let activePopover: ActivePopover | undefined
let popoverId = 0
let globalListenersInstalled = false

function termSummary (term: VocabularyTerm): string {
  if (term.id === 'invocation-ids') {
    return 'Built-in coordinates identify an invocation globally, inside its workgroup, and by the workgroup that contains it.'
  }
  return vocabularySummaries.get(normalizeHeading(term.heading)) ??
    `A WebGPU concept used by Cosmos. Open the complete ${term.heading} entry for details.`
}

export function vocabularyTermHref (termId: string): string {
  if (termId === 'reduction') return conceptHref('reduction')
  return `#/vocabulary/${encodeURIComponent(termId)}`
}

function cancelScheduledClose (): void {
  if (activePopover?.closeTimer !== undefined) {
    window.clearTimeout(activePopover.closeTimer)
    activePopover.closeTimer = undefined
  }
}

function closePopover (restoreFocus = false): void {
  const current = activePopover
  if (!current) return
  cancelScheduledClose()
  activePopover = undefined
  current.trigger.setAttribute('aria-expanded', 'false')
  current.popover.remove()
  if (restoreFocus && current.trigger.isConnected) current.trigger.focus()
}

function scheduleClose (): void {
  cancelScheduledClose()
  if (!activePopover || activePopover.pinned) return
  activePopover.closeTimer = window.setTimeout(() => closePopover(), 140)
}

function positionPopover (trigger: HTMLButtonElement, popover: HTMLSpanElement): void {
  const margin = 12
  const gap = 9
  const triggerBox = trigger.getBoundingClientRect()
  const popoverBox = popover.getBoundingClientRect()
  const fitsAbove = triggerBox.top - popoverBox.height - gap >= margin
  const fitsBelow = triggerBox.bottom + popoverBox.height + gap <= window.innerHeight - margin
  const placeAbove = !fitsBelow && fitsAbove
  const top = placeAbove
    ? triggerBox.top - popoverBox.height - gap
    : Math.min(triggerBox.bottom + gap, window.innerHeight - popoverBox.height - margin)
  const left = Math.min(
    Math.max(margin, triggerBox.left + triggerBox.width / 2 - popoverBox.width / 2),
    window.innerWidth - popoverBox.width - margin
  )

  popover.style.left = `${Math.max(margin, left)}px`
  popover.style.top = `${Math.max(margin, top)}px`
  popover.style.setProperty(
    '--glossary-anchor-x',
    `${Math.min(popoverBox.width - 18, Math.max(18, triggerBox.left + triggerBox.width / 2 - left))}px`
  )
  popover.classList.toggle('place-above', placeAbove)
}

function installGlobalListeners (): void {
  if (globalListenersInstalled) return
  globalListenersInstalled = true

  document.addEventListener('pointerdown', event => {
    if (!activePopover || !(event.target instanceof Node)) return
    if (
      !activePopover.trigger.contains(event.target) &&
      !activePopover.popover.contains(event.target)
    ) closePopover()
  }, true)

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activePopover) {
      event.preventDefault()
      closePopover(true)
    }
  })

  window.addEventListener('resize', () => closePopover())
  window.addEventListener('scroll', () => closePopover(), true)
  window.addEventListener('hashchange', () => closePopover())
}

function openPopover (
  trigger: HTMLButtonElement,
  term: VocabularyTerm,
  pinned: boolean
): HTMLAnchorElement | undefined {
  if (activePopover?.trigger === trigger) {
    activePopover.pinned ||= pinned
    cancelScheduledClose()
    return activePopover.popover.querySelector<HTMLAnchorElement>('a') ?? undefined
  }

  closePopover()
  installGlobalListeners()
  popoverId += 1

  const popover = document.createElement('span')
  const heading = document.createElement('strong')
  const summary = document.createElement('span')
  const footer = document.createElement('span')
  const link = document.createElement('a')
  const hint = document.createElement('span')
  const headingId = `glossary-heading-${popoverId}`

  popover.id = `glossary-popover-${popoverId}`
  popover.className = 'glossary-popover'
  popover.setAttribute('role', 'dialog')
  popover.setAttribute('aria-labelledby', headingId)
  heading.id = headingId
  heading.className = 'glossary-popover-title'
  heading.textContent = term.heading
  summary.className = 'glossary-popover-summary'
  summary.textContent = termSummary(term)
  footer.className = 'glossary-popover-footer'
  link.href = vocabularyTermHref(term.id)
  link.textContent = term.id === 'reduction' ? 'Read the deep dive →' : 'Read full definition →'
  hint.className = 'glossary-popover-hint'
  hint.textContent = 'Esc to close'
  footer.append(link, hint)
  popover.append(heading, summary, footer)
  trigger.insertAdjacentElement('afterend', popover)

  trigger.setAttribute('aria-controls', popover.id)
  trigger.setAttribute('aria-expanded', 'true')
  activePopover = { trigger, popover, pinned }
  positionPopover(trigger, popover)

  popover.addEventListener('pointerenter', cancelScheduledClose)
  popover.addEventListener('pointerleave', scheduleClose)
  popover.addEventListener('focusin', cancelScheduledClose)
  popover.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (
        activePopover?.popover === popover &&
        !popover.contains(document.activeElement) &&
        document.activeElement !== trigger
      ) closePopover()
    })
  })

  return link
}

function createTermTrigger (term: VocabularyTerm, label: string): HTMLButtonElement {
  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'vocabulary-term-link'
  trigger.textContent = label
  trigger.setAttribute('aria-expanded', 'false')
  trigger.setAttribute('aria-haspopup', 'dialog')
  trigger.setAttribute('aria-label', `${label}: show quick definition`)

  trigger.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'touch') openPopover(trigger, term, false)
  })
  trigger.addEventListener('pointerleave', scheduleClose)
  trigger.addEventListener('focus', () => openPopover(trigger, term, false))
  trigger.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (
        activePopover?.trigger === trigger &&
        !activePopover.popover.contains(document.activeElement)
      ) closePopover()
    })
  })
  trigger.addEventListener('click', event => {
    event.preventDefault()
    if (activePopover?.trigger === trigger && activePopover.pinned) {
      closePopover()
      return
    }
    const link = openPopover(trigger, term, true)
    if (event.detail === 0) window.requestAnimationFrame(() => link?.focus())
  })

  return trigger
}

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

export function linkVocabularyTerms (
  host: HTMLElement,
  excludedTerms = new Set<string>()
): void {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let current = walker.nextNode()
  while (current) {
    if (current instanceof Text && canLinkTextNode(current)) nodes.push(current)
    current = walker.nextNode()
  }

  const linkedTerms = new Set(excludedTerms)
  for (const node of nodes) {
    const text = node.data
    const fragment = document.createDocumentFragment()
    let cursor = 0
    let match = findNextMatch(text, cursor, linkedTerms)
    if (!match) continue

    while (match) {
      fragment.append(text.slice(cursor, match.index))
      fragment.append(createTermTrigger(
        match.term,
        text.slice(match.index, match.index + match.length)
      ))
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
