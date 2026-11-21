import MarkdownIt from 'markdown-it'
import type { ExperimentDefinition } from '../runtime/experiment'
import { coverage } from './coverage'
import { readEvidenceSource } from './evidence-source'
import { experiments } from './registry'
import { caseEvidencePages, findingSection, liveCaseSection, startingCase } from './experiment-route'
import { experimentHref, experimentSectionHref, roadmapHref } from './router'
import { headingSlug } from './sections'
import { vocabularyTerms } from './vocabulary'
import { readinessFor } from './readiness'
import type { CaseReadiness } from './readiness/types'

export type SearchEntry = {
  key: string;
  title: string;
  kind: string;
  context: string;
  heading: string;
  text: string;
  href: string;
  experimentId?: string;
  caseId?: string;
  readiness?: CaseReadiness;
}

export type SearchResult = SearchEntry & { snippet: string; score: number }
export type SearchIndex = { entries: SearchEntry[]; unavailable: number }
type Token = ReturnType<MarkdownIt['parse']>[number]
type Heading = { index: number; level: number; title: string; articleSlug: string; documentSlug?: string; chapter?: number }

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true })
const instructionHeading = /\bagents?\b|\breproduc(?:e|tion)\b|\b(?:replay|test|run) (?:instructions|commands|steps)\b/i
const workflowHeading = /^run it\b|^evidence and workflow review\b/i
const instructionText = /\bagents?\b|agent[-_ ]recipe|\b(?:pnpm|npm|npx|vitest)\b|\bLAB_[A-Z0-9_]+\b/i
const sourceInstructions = /\bcaptures\/|\blocal capture\b|\bSHA-256\b|\bgit (?:diff|status|rev-parse|checkout)\b/i

function isInstructionText (text: string): boolean {
  return instructionText.test(text) || sourceInstructions.test(text)
}

function normalize (text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function inlineText (token: Token): string {
  const text = (token.children ?? []).flatMap(child => {
    if (child.type === 'text' || child.type === 'code_inline' || child.type === 'image') return [child.content]
    if (child.type === 'softbreak' || child.type === 'hardbreak') return [' ']
    return []
  }).join('')
  return text.replace(/\s+/g, ' ').trim()
}

function headingsFor (tokens: Token[]): Heading[] {
  const headings: Heading[] = []
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].type !== 'heading_open') continue
    headings.push({ index, level: Number(tokens[index].tag.slice(1)), title: inlineText(tokens[index + 1]), articleSlug: '' })
  }
  // Match the article renderer by assigning level-two and level-three headings first.
  const used = new Set<string>()
  for (const heading of [...headings.filter(item => item.level === 2 || item.level === 3),
    ...headings.filter(item => item.level !== 2 && item.level !== 3)]) {
    const stem = heading.level === 1 ? 'title' : headingSlug(heading.title)
    let slug = stem; let suffix = 2
    while (used.has(slug)) slug = `${stem}-${suffix++}`
    used.add(slug); heading.articleSlug = slug
  }
  const documentUsed = new Set<string>(); let chapter = 0
  for (const heading of headings) {
    if (heading.level === 2) chapter++
    heading.chapter = chapter || undefined
    if (heading.level !== 2 && heading.level !== 3) continue
    const stem = headingSlug(heading.title); let slug = stem; let suffix = 2
    while (documentUsed.has(slug)) slug = `${stem}-${suffix++}`
    documentUsed.add(slug); heading.documentSlug = slug
  }
  return headings
}

type DocumentOptions = {
  key: string; title: string; kind: string; context: string; baseHref: string;
  mode: 'article' | 'document' | 'learn' | 'vocabulary';
  experimentId?: string; caseId?: string; pageId?: string;
}

// Index prose and table text, not source code, recipes, command blocks or
// agent-directed instructions. Only already-published document manifests call this.
export function indexMarkdown (source: string, options: DocumentOptions): SearchEntry[] {
  const tokens = markdown.parse(readEvidenceSource(source).body, {})
  const headings = headingsFor(tokens); const byIndex = new Map(headings.map(item => [item.index, item]))
  const entries: SearchEntry[] = []
  let current: SearchEntry | undefined; let excludedLevel: number | undefined
  let tableHeader = false; let tableCell = -1; let tableColumns: Set<number> | undefined
  let lastDocumentSlug: string | undefined; let lastChapter: number | undefined; let lastVocabulary: string | undefined
  const start = (heading?: Heading): void => {
    let href = options.baseHref
    if (heading && heading.level >= 2) {
      if (options.mode === 'article' && options.experimentId && options.pageId) {
        href = experimentHref(options.experimentId, options.pageId, heading.articleSlug)
      } else if (options.mode === 'document') {
        lastDocumentSlug = heading.documentSlug ?? lastDocumentSlug
        if (lastDocumentSlug) href = `${options.baseHref}?section=${encodeURIComponent(lastDocumentSlug)}`
      } else if (options.mode === 'learn') {
        lastChapter = heading.chapter ?? lastChapter
        if (lastChapter) href = `#/learn/${lastChapter}`
      } else if (options.mode === 'vocabulary') {
        if (heading.level === 3) lastVocabulary = vocabularyTerms.find(term => term.heading === heading.title)?.id
        else if (heading.level === 2) lastVocabulary = undefined
        if (lastVocabulary) href = `#/vocabulary/${encodeURIComponent(lastVocabulary)}`
      }
    }
    current = { ...options, key: options.key, heading: heading?.level === 1 ? '' : heading?.title ?? '', text: '', href }
    entries.push(current)
  }
  start()
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token.type === 'table_open') tableColumns = new Set()
    else if (token.type === 'table_close') tableColumns = undefined
    else if (token.type === 'thead_open') tableHeader = true
    else if (token.type === 'thead_close') tableHeader = false
    else if (token.type === 'tr_open') tableCell = -1
    else if (token.type === 'th_open' || token.type === 'td_open') tableCell++
    if (tableColumns && tableHeader && token.type === 'inline' &&
      /\bcaptures\/|\blocal capture\b|SHA-256|source archive/i.test(token.content)) tableColumns.add(tableCell)
    if (tableColumns?.has(tableCell) && token.type === 'inline') continue
    const heading = byIndex.get(index)
    if (heading) {
      if (excludedLevel !== undefined && heading.level > excludedLevel) continue
      excludedLevel = undefined
      if (instructionHeading.test(heading.title) || workflowHeading.test(heading.title)) {
        excludedLevel = heading.level; current = undefined; continue
      }
      start(heading); continue
    }
    if (excludedLevel !== undefined || !current || tokens[index].type !== 'inline' || tokens[index - 1]?.type === 'heading_open') continue
    if (isInstructionText(token.content) || (token.children ?? []).some(child =>
      child.type === 'link_open' && /agent[-_]?recipe/i.test(child.attrGet('href') ?? ''))) continue
    const text = inlineText(token)
    if (text && !isInstructionText(text)) current.text += `${current.text ? ' ' : ''}${text}`
  }
  return entries.filter(entry => entry.text || entry.heading)
}

function entry (values: Omit<SearchEntry, 'heading'>): SearchEntry {
  return { ...values, heading: '' }
}

function publicText (values: Array<string | undefined>): string {
  return values.filter((value): value is string => !!value && !isInstructionText(value)).join(' ')
}

function experimentEntries (experiment: ExperimentDefinition): SearchEntry[] {
  const first = startingCase(experiment)
  const entries = experiment.cases!.flatMap(item => {
    const assessment = readinessFor(experiment.id, item)
    const results: SearchEntry[] = []
    if (item === first || item.kind !== 'recorded') {
      results.push(entry({
        key: `${experiment.id}/${item.id}`,
        title: item === first ? experiment.title : item.title,
        kind: item === first ? 'Experiment' : 'Live case',
        context: item === first ? '' : experiment.title,
        href: experimentSectionHref(experiment.id, item === first ? null : liveCaseSection(item)),
        experimentId: experiment.id,
        caseId: item.id,
        readiness: assessment,
        text: publicText([item.title, item.question, item.description, item.tryIt, item.reference, item.acceptance,
          assessment.badge, assessment.finding, ...assessment.evidence.map(result => result.text), assessment.next]),
      }))
    }
    if (item.recorded) {
      const finding = item.recorded
      results.push(entry({
        key: `${experiment.id}/${item.id}/finding`,
        title: item.title,
        kind: 'Recorded finding',
        context: experiment.title,
        href: experimentSectionHref(experiment.id, experiment.singlePage ? 'recorded-findings' : findingSection(item)),
        experimentId: experiment.id,
        caseId: item.id,
        text: publicText([finding.conclusion, finding.scope, finding.limits, finding.date,
          finding.environment, ...assessment.evidence.map(result => result.text)]),
      }))
    }
    return results
  })
  for (const observation of experiment.singlePage?.observations ?? []) {
    entries.push(entry({
      key: `${experiment.id}/${observation.id}`,
      title: observation.title,
      kind: 'Recorded evidence',
      context: experiment.title,
      href: experimentSectionHref(experiment.id, observation.id),
      experimentId: experiment.id,
      caseId: first.id,
      text: publicText([observation.evidence, observation.limits, observation.date]),
    }))
  }
  return entries
}

function featureRows (): SearchEntry[] {
  return coverage.map(feature => entry({
    key: `feature/${feature.id}`,
    title: feature.name,
    kind: 'Feature coverage',
    context: feature.group,
    href: roadmapHref(feature.id),
    text: publicText([feature.searchText]),
  }))
}

const references = [
  {
    key: 'roadmap',
    title: 'WebGPU migration',
    kind: 'Guide',
    href: roadmapHref(),
    mode: 'document' as const,
    load: async (): Promise<string> => (await import('../docs/roadmap.md?raw')).default,
  },
  {
    key: 'learn',
    title: 'How WebGPU works',
    kind: 'Guide',
    href: '#/learn',
    mode: 'learn' as const,
    load: async (): Promise<string> => (await import('../docs/learn-webgpu.md?raw')).default,
  },
  {
    key: 'validation-workflow',
    title: 'Validation workflow',
    kind: 'Guide',
    href: '#/validation-workflow',
    mode: 'document' as const,
    load: async (): Promise<string> => (await import('../docs/validation-workflow.md?raw')).default,
  },
  {
    key: 'numerical-research',
    title: 'Numerical research',
    kind: 'Reference',
    href: '#/numerical-research',
    mode: 'document' as const,
    load: async (): Promise<string> => (await import('../docs/numerical-research.md?raw')).default,
  },
  {
    key: 'architecture',
    title: 'Lab architecture',
    kind: 'Reference',
    href: '#/architecture',
    mode: 'document' as const,
    load: async (): Promise<string> => (await import('../docs/architecture.md?raw')).default,
  },
  {
    key: 'vocabulary',
    title: 'Vocabulary',
    kind: 'Reference',
    href: '#/vocabulary',
    mode: 'vocabulary' as const,
    load: async (): Promise<string> => (await import('../docs/vocabulary.md?raw')).default,
  },
  {
    key: 'reduction',
    title: 'Parallel reduction',
    kind: 'Guide',
    href: '#/concepts/reduction',
    mode: 'document' as const,
    load: async (): Promise<string> => (await import('../docs/reduction.md?raw')).default,
  },
]

export async function buildSearchIndex (): Promise<SearchIndex> {
  const entries = [...experiments.flatMap(experimentEntries), ...featureRows()]
  const jobs: Array<Promise<SearchEntry[]>> = references.map(async reference => {
    const source = await reference.load()
    return indexMarkdown(source, {
      key: reference.key, title: reference.title, kind: reference.kind, context: '', baseHref: reference.href, mode: reference.mode,
    })
  })
  for (const experiment of experiments) {
    for (const page of caseEvidencePages(experiment)) {
      if (page.kind !== 'markdown') continue
      jobs.push((async (): Promise<SearchEntry[]> => indexMarkdown(await page.load(), {
        key: `${experiment.id}/document/${page.id}`,
        title: page.title,
        kind: 'Evidence',
        context: experiment.title,
        baseHref: experimentHref(experiment.id, page.id),
        mode: 'article',
        experimentId: experiment.id,
        pageId: page.id,
      }))())
    }
  }
  const settled = await Promise.allSettled(jobs)
  let unavailable = 0
  for (const result of settled) {
    if (result.status === 'fulfilled') entries.push(...result.value)
    else unavailable++
  }
  return { entries, unavailable }
}

function snippet (text: string, words: string[]): string {
  const prefix = '(?:^|[^\\p{L}\\p{N}])'
  const phrase = new RegExp(`${prefix}${words.join('[^\\p{L}\\p{N}]+')}`, 'iu').exec(text)
  const single = words.map(word => new RegExp(`${prefix}${word}`, 'iu').exec(text)).find(Boolean)
  const position = phrase?.index ?? single?.index ?? 0
  const start = Math.max(0, position - 70); const end = Math.min(text.length, start + 180)
  return `${start ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

function containsWord (text: string, word: string): boolean {
  return text.startsWith(word) || text.includes(` ${word}`)
}

export function searchIndex (index: SearchIndex, query: string): SearchResult[] {
  const normalized = normalize(query)
  if (!normalized) return []
  const words = normalized.split(' '); const best = new Map<string, SearchResult>()
  for (const candidate of index.entries) {
    if (isInstructionText(`${candidate.title} ${candidate.context} ${candidate.heading}`)) continue
    const title = normalize(candidate.title); const heading = normalize(candidate.heading)
    const context = normalize(candidate.context); const text = normalize(candidate.text)
    const haystack = `${title} ${heading} ${context} ${text}`
    if (!words.every(word => containsWord(haystack, word))) continue
    let score = candidate.kind === 'Experiment' || candidate.kind === 'Live case' ? 3 : candidate.kind === 'Recorded finding' ? 2 : 0
    if (title === normalized) score += 60
    else if (title.includes(normalized)) score += 30
    if (heading.includes(normalized)) score += 18
    if (text.includes(normalized)) score += 20 + (candidate.caseId ? 8 : 0)
    for (const word of words) score += (containsWord(title, word) ? 8 : 0) + (containsWord(heading, word) ? 4 : 0)
    const result = { ...candidate, score, snippet: snippet(candidate.text, words) }
    const previous = best.get(candidate.key)
    if (!previous || previous.score < score) best.set(candidate.key, result)
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
}
