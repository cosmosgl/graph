import MarkdownIt from 'markdown-it'
import { renderFlow } from './flow'
import { highlightGlsl, highlightWgsl } from './syntax-highlight'
import { linkVocabularyTerms } from './vocabulary'

type MarkdownOptions = {
  linkTerms?: boolean;
  excludedTermIds?: string[];
  examples?: Record<string, (host: HTMLElement) => void>;
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

  host.innerHTML = `<article class="prose">${markdown.render(source)}</article>`
  if (options.linkTerms !== false) {
    linkVocabularyTerms(host, new Set(options.excludedTermIds))
  }
  for (const element of host.querySelectorAll<HTMLElement>('[data-doc-example]')) {
    examples[element.dataset.docExample!](element)
  }
}
