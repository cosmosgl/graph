import type {
  ExperimentDefinition,
  ExperimentInstance,
  ExperimentPage,
} from '../runtime/experiment'
import vocabularySource from '../docs/vocabulary.md?raw'
import { experiments, findExperiment } from './registry'
import { experimentHref, readRoute, vocabularyHref } from './router'
import { indexVocabularyTerms } from './vocabulary'

function requiredElement<T extends HTMLElement> (host: ParentNode, selector: string): T {
  const element = host.querySelector<T>(selector)
  if (!element) throw new Error(`Missing ${selector}`)
  return element
}

function renderNavigation (
  host: HTMLElement,
  activeId?: string,
  activeReference?: 'vocabulary'
): void {
  host.replaceChildren()
  const label = document.createElement('p')
  label.className = 'nav-label'
  label.textContent = 'Experiments'
  host.append(label)

  for (const experiment of experiments) {
    const link = document.createElement('a')
    link.href = experimentHref(experiment.id)
    link.className = 'experiment-link'
    link.classList.toggle('active', experiment.id === activeId)
    link.innerHTML = `<span>${experiment.title}</span><small>${experiment.tags[0] ?? 'experiment'}</small>`
    host.append(link)
  }

  const referenceLabel = document.createElement('p')
  referenceLabel.className = 'nav-label nav-label-reference'
  referenceLabel.textContent = 'Reference'
  host.append(referenceLabel)

  const vocabulary = document.createElement('a')
  vocabulary.href = vocabularyHref()
  vocabulary.className = 'experiment-link reference-link'
  vocabulary.classList.toggle('active', activeReference === 'vocabulary')
  vocabulary.innerHTML = '<span>WebGPU vocabulary</span><small>guide</small>'
  if (activeReference === 'vocabulary') vocabulary.setAttribute('aria-current', 'page')
  host.append(vocabulary)
}

function renderHome (host: HTMLElement): void {
  host.innerHTML = `
    <section class="home-intro">
      <p class="eyebrow">Migration research workspace</p>
      <h1>Cosmos GPU Lab</h1>
      <p>
        Focused, reproducible experiments for moving Cosmos from WebGL rendering passes
        to WebGPU compute and rendering.
      </p>
    </section>
    <section class="experiment-grid" aria-label="Available experiments"></section>
    <a class="reference-card" href="${vocabularyHref()}">
      <span class="card-index">REFERENCE</span>
      <span>
        <strong>WebGPU vocabulary</strong>
        <small>Core concepts, execution model, resources and Cosmos compute terms</small>
      </span>
      <span aria-hidden="true">→</span>
    </a>
  `
  const grid = requiredElement<HTMLElement>(host, '.experiment-grid')
  for (const experiment of experiments) {
    const link = document.createElement('a')
    link.className = 'experiment-card'
    link.href = experimentHref(experiment.id)
    link.innerHTML = `
      <span class="card-index">${String(grid.childElementCount + 1).padStart(2, '0')}</span>
      <h2>${experiment.title}</h2>
      <p>${experiment.summary}</p>
      <span class="tag-row">${experiment.tags.map(tag => `<span>${tag}</span>`).join('')}</span>
    `
    grid.append(link)
  }
}

function renderVocabularyFrame (host: HTMLElement): HTMLElement {
  host.innerHTML = `
    <header class="experiment-header reference-header">
      <div>
        <p class="eyebrow">Lab reference · WebGPU</p>
        <h1>Vocabulary</h1>
        <p>
          A shared language for WebGPU resources, commands, shaders and the parallel
          data structures used by Cosmos.
        </p>
      </div>
    </header>
    <section class="experiment-stage reference-stage">
      <div class="loading">Loading vocabulary…</div>
    </section>
  `
  return requiredElement<HTMLElement>(host, '.reference-stage')
}

function createTab (label: string, href: string, active: boolean): HTMLAnchorElement {
  const link = document.createElement('a')
  link.textContent = label
  link.href = href
  link.classList.toggle('active', active)
  if (active) link.setAttribute('aria-current', 'page')
  return link
}

function renderExperimentFrame (
  host: HTMLElement,
  experiment: ExperimentDefinition,
  activePage?: ExperimentPage
): void {
  host.innerHTML = `
    <header class="experiment-header">
      <div>
        <p class="eyebrow">Experiment · ${experiment.tags.join(' · ')}</p>
        <h1>${experiment.title}</h1>
        <p>${experiment.summary}</p>
      </div>
    </header>
    <nav class="page-tabs" aria-label="Experiment sections"></nav>
    <section class="experiment-stage"></section>
  `

  const tabs = requiredElement<HTMLElement>(host, '.page-tabs')
  tabs.append(createTab('Demo', experimentHref(experiment.id), !activePage))
  for (const page of experiment.pages) {
    tabs.append(createTab(page.title, experimentHref(experiment.id, page.id), page.id === activePage?.id))
  }
}

function renderMissing (host: HTMLElement, id: string): void {
  host.innerHTML = `
    <section class="empty-state">
      <p class="eyebrow">Not found</p>
      <h1>Unknown experiment</h1>
      <p>No experiment is registered as <code>${id}</code>.</p>
      <a class="button-link" href="#/">Return to the lab</a>
    </section>
  `
}

function renderFailure (host: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  host.innerHTML = `
    <section class="empty-state failure">
      <p class="eyebrow">Experiment error</p>
      <h2>Unable to load this section</h2>
      <pre></pre>
    </section>
  `
  requiredElement<HTMLElement>(host, 'pre').textContent = message
}

export function createAppShell (root: HTMLElement): void {
  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand" href="#/" aria-label="Cosmos GPU Lab home">
          <span class="brand-mark" aria-hidden="true"></span>
          <span><strong>Cosmos</strong><small>GPU Lab</small></span>
        </a>
        <nav class="experiment-nav" aria-label="Experiments"></nav>
        <div class="sidebar-note">
          <span class="status-dot"></span>
          luma.gl v10 research workspace
        </div>
      </aside>
      <main class="workspace" tabindex="-1"></main>
    </div>
  `

  const navigation = requiredElement<HTMLElement>(root, '.experiment-nav')
  const workspace = requiredElement<HTMLElement>(root, '.workspace')
  let activeInstance: ExperimentInstance | undefined
  let renderVersion = 0

  const destroyActive = (): void => {
    activeInstance?.destroy()
    activeInstance = undefined
  }

  const render = async (): Promise<void> => {
    renderVersion += 1
    const version = renderVersion
    destroyActive()
    const route = readRoute()
    renderNavigation(
      navigation,
      route.kind === 'experiment' ? route.experimentId : undefined,
      route.kind === 'vocabulary' ? 'vocabulary' : undefined
    )

    if (route.kind === 'home') {
      renderHome(workspace)
      return
    }

    if (route.kind === 'vocabulary') {
      const stage = renderVocabularyFrame(workspace)
      try {
        const renderer = await import('./markdown')
        if (version !== renderVersion) return
        await renderer.renderMarkdown(stage, vocabularySource, {}, false)
        indexVocabularyTerms(stage)
        if (route.termId) {
          const target = document.getElementById(route.termId)
          if (target && stage.contains(target)) {
            target.classList.add('vocabulary-target')
            target.scrollIntoView({ block: 'start' })
          }
        }
      } catch (error) {
        if (version !== renderVersion) return
        renderFailure(stage, error)
      }
      return
    }

    const experiment = findExperiment(route.experimentId)
    if (!experiment) {
      renderMissing(workspace, route.experimentId)
      return
    }

    const page = route.pageId
      ? experiment.pages.find(candidate => candidate.id === route.pageId)
      : undefined
    renderExperimentFrame(workspace, experiment, page)
    const stage = requiredElement<HTMLElement>(workspace, '.experiment-stage')

    try {
      if (!page) {
        stage.innerHTML = '<div class="loading">Creating GPU devices…</div>'
        const instance = await experiment.create(stage)
        if (version !== renderVersion) {
          instance.destroy()
          return
        }
        activeInstance = instance
      } else if (page.kind === 'markdown') {
        stage.innerHTML = '<div class="loading">Loading documentation…</div>'
        const [source, renderer] = await Promise.all([page.load(), import('./markdown')])
        if (version !== renderVersion) return
        await renderer.renderMarkdown(stage, source, page.assets)
      } else {
        stage.innerHTML = '<div class="loading">Loading results…</div>'
        const [report, renderer] = await Promise.all([page.load(), import('./report')])
        if (version !== renderVersion) return
        renderer.renderReport(stage, report, experiment.id)
      }
    } catch (error) {
      if (version !== renderVersion) return
      renderFailure(stage, error)
    }
  }

  const handleRoute = (): void => {
    render().catch(error => renderFailure(workspace, error))
  }

  window.addEventListener('hashchange', handleRoute)
  window.addEventListener('beforeunload', destroyActive)
  handleRoute()
}
