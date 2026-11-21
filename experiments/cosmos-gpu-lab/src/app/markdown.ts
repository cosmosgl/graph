import MarkdownIt from 'markdown-it'
import { readResultChart, renderResultChart } from '../runtime/result-chart'
import { presentDocumentTables } from '../runtime/result-tables'
import { renderFlow } from './flow'
import { highlightGlsl, highlightWgsl } from './syntax-highlight'
import { linkVocabularyTerms } from './vocabulary'
import { addSectionNavigation } from './sections'
import { readEvidenceSource, evidenceSourceNote } from './evidence-source'

type MarkdownOptions = {
  linkTerms?: boolean;
  excludedTermIds?: string[];
  examples?: Record<string, (host: HTMLElement) => void>;
  sectionNavigation?: boolean | 'permalinks';
  headingLevelOffset?: number;
  tables?: boolean;
}

export async function renderMarkdown (
  host: HTMLElement,
  source: string,
  assets: Record<string, string> = {},
  options: MarkdownOptions = {}
): Promise<void> {
  const markdown = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
  })
  markdown.core.ruler.push('heading-levels', state => {
    for (const token of state.tokens) {
      if (token.type === 'heading_open' || token.type === 'heading_close') {
        const level = Number(token.tag.slice(1))
        if (token.type === 'heading_open') token.attrSet('data-heading-level', String(level))
        token.tag = `h${Math.min(6, level + (options.headingLevelOffset ?? 0))}`
      }
    }
  })

  // Keep wide evidence tables within the article, without clipping their rows.
  markdown.renderer.rules.table_open = (): string => '<div class="table-scroll"><table>\n'
  markdown.renderer.rules.table_close = (): string => '</table></div>\n'

  const defaultFence = markdown.renderer.rules.fence
  const examples = options.examples ?? {}
  markdown.renderer.rules.fence = (tokens, index, options, environment, renderer): string => {
    const token = tokens[index]
    const language = token.info.trim().toLocaleLowerCase()
    const exampleId = token.content.trim()
    if (language === 'example' && Object.hasOwn(examples, exampleId)) {
      return `<div data-doc-example="${markdown.utils.escapeHtml(exampleId)}"></div>`
    }
    if (language === 'flow' || language === 'flow row') {
      return renderFlow(token.content, language === 'flow row', markdown.utils.escapeHtml)
    }
    if (language === 'result-chart') {
      const chart = readResultChart(token.content)
      if (chart) return renderResultChart(chart).outerHTML
    }
    if (language === 'wgsl') {
      return `<pre class="code-block code-block-wgsl" data-language="WGSL"><code>${highlightWgsl(token.content)}</code></pre>`
    }
    if (language === 'glsl') {
      return `<pre class="code-block code-block-glsl" data-language="GLSL"><code>${highlightGlsl(token.content)}</code></pre>`
    }
    return defaultFence?.(tokens, index, options, environment, renderer) ??
      renderer.renderToken(tokens, index, options)
  }

  const defaultImage = markdown.renderer.rules.image
  markdown.renderer.rules.image = (tokens, index, options, environment, renderer): string => {
    const token = tokens[index]
    const sourceIndex = token.attrIndex('src')
    if (sourceIndex >= 0) {
      const sourceValue = token.attrs?.[sourceIndex][1]
      // Preserve the authoring key: Vite may inline small SVGs as data URLs.
      if (sourceValue) token.attrSet('data-source', sourceValue)
      if (sourceValue && assets[sourceValue]) token.attrSet('src', assets[sourceValue])
    }
    return defaultImage?.(tokens, index, options, environment, renderer) ??
      renderer.renderToken(tokens, index, options)
  }

  const { body, evidence } = readEvidenceSource(source)
  host.innerHTML = `<article class="prose">${markdown.render(body)}</article>`
  const article = host.querySelector('article')!
  if (evidence) {
    const title = article.firstElementChild
    if (title?.matches('h1,h2,h3,h4,h5,h6')) title.after(evidenceSourceNote(evidence))
    else article.prepend(evidenceSourceNote(evidence))
  }
  if (options.linkTerms !== false) {
    linkVocabularyTerms(host, new Set(options.excludedTermIds))
  }
  for (const element of host.querySelectorAll<HTMLElement>('[data-doc-example]')) {
    examples[element.dataset.docExample!](element)
  }
  if (options.sectionNavigation !== false) addSectionNavigation(host, options.sectionNavigation !== 'permalinks')
  if (options.tables !== false) presentDocumentTables(host)
}
