import MarkdownIt from 'markdown-it'
import { sanitizeDiagram } from './sanitize-diagram'
import { highlightGlsl, highlightWgsl } from './syntax-highlight'
import { linkVocabularyTerms } from './vocabulary'

type MarkdownOptions = {
  linkTerms?: boolean;
  excludedTermIds?: string[];
}

let diagramId = 0
let mermaidInitialized = false

async function renderDiagrams (host: HTMLElement): Promise<void> {
  const { default: mermaid } = await import('mermaid')
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
      themeVariables: {
        background: '#292e36',
        primaryColor: '#373d47',
        primaryTextColor: '#e3e4e7',
        lineColor: '#9da3ad',
      },
    })
    mermaidInitialized = true
  }

  const diagrams = host.querySelectorAll<HTMLElement>('.mermaid-source')
  for (const diagram of diagrams) {
    try {
      const id = `cosmos-diagram-${diagramId}`
      diagramId += 1
      const result = await mermaid.render(id, diagram.textContent ?? '')
      diagram.className = 'mermaid-diagram'
      diagram.replaceChildren(sanitizeDiagram(result.svg))
      result.bindFunctions?.(diagram)
    } catch (error) {
      diagram.className = 'diagram-error'
      diagram.textContent = error instanceof Error ? error.message : String(error)
    }
  }
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
  markdown.renderer.rules.fence = (tokens, index, options, environment, renderer): string => {
    const token = tokens[index]
    const language = token.info.trim().toLocaleLowerCase()
    if (language === 'mermaid') {
      return `<div class="mermaid-source">${markdown.utils.escapeHtml(token.content)}</div>`
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
      if (sourceValue && assets[sourceValue]) token.attrSet('src', assets[sourceValue])
    }
    return defaultImage?.(tokens, index, options, environment, renderer) ??
      renderer.renderToken(tokens, index, options)
  }

  host.innerHTML = `<article class="prose">${markdown.render(source)}</article>`
  if (options.linkTerms !== false) {
    linkVocabularyTerms(host, new Set(options.excludedTermIds))
  }
  await renderDiagrams(host)
}
