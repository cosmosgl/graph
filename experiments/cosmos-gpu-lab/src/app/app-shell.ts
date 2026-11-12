import type {
  ExperimentDefinition,
} from '../runtime/experiment'
import vocabularySource from '../docs/vocabulary.md?raw'
import reductionSource from '../docs/reduction.md?raw'
import reductionTreeUrl from '../docs/diagrams/reduction-tree.svg?url'
import { createRetainedRun } from '../runtime/retained-run'
import { disposeDocumentTables } from '../runtime/result-tables'
import { experimentGroups, findExperiment } from './registry'
import {
  architectureHref, articleSectionId, conceptHref, experimentHref, featureInventoryHref, readRoute, roadmapHref, vocabularyHref, currentSection,
} from './router'
import { indexVocabularyTerms } from './vocabulary'
import { research } from './research'
import { renderMigrationOverview } from './research-ui'
import { scrollToSection } from './sections'
import { resolveExperimentSection } from './article-sections'
import { disposeExperimentNotes, mountExperimentNotes, renderExperimentContents } from './experiment-page'

function requiredElement<T extends HTMLElement> (host: ParentNode, selector: string): T {
  const element = host.querySelector<T>(selector)
  if (!element) throw new Error(`Missing ${selector}`)
  return element
}

function renderHome (host: HTMLElement): void {
  host.innerHTML = `
    <header class="home-intro">
      <h1>Cosmos GPU Lab</h1>
    </header>
    <div data-migration-overview></div>
    <div class="home-sections">
    <div class="experiment-catalog" id="experiment-catalog" aria-label="Available experiments">
      <header class="catalog-header">
      <h2 class="catalog-title">Experiment catalog</h2>
      <p class="catalog-intro">Explore the groups from foundations to validation.
        Experiments within each group follow a suggested reading order; the migration roadmap records our findings and next steps.</p>
      </header>
    </div>

    <a class="reference-card" href="#/validation-workflow">
      <span class="card-index">VALIDATION</span>
      <span><strong>Validation workflow</strong><small>Separate behavioral contracts, accuracy, compatibility, quality and cost</small></span>
      <span aria-hidden="true">→</span>
    </a>
    <a class="reference-card" href="${roadmapHref()}">
      <span class="card-index">THE JOURNEY</span>
      <span>
        <strong>Cosmos → WebGPU</strong>
        <small>Migration readiness: what is demonstrated, what is missing and what would justify switching</small>
      </span>
      <span aria-hidden="true">→</span>
    </a>
    <a class="reference-card" href="#/learn">
      <span class="card-index">START HERE</span>
      <span>
        <strong>How WebGPU works</strong>
        <small>Learn the vocabulary through small interactive examples, from point data to pixels</small>
      </span>
      <span aria-hidden="true">→</span>
    </a>
    <a class="reference-card" href="${featureInventoryHref()}">
      <span class="card-index">COVERAGE</span>
      <span>
        <strong>Cosmos feature coverage</strong>
        <small>Forces and rendering: how WebGL works, what experiments cover and what WebGPU still needs to prove</small>
      </span>
      <span aria-hidden="true">→</span>
    </a>
    <a class="reference-card" href="${architectureHref()}">
      <span class="card-index">REFERENCE</span>
      <span>
        <strong>Lab architecture</strong>
        <small>How the shell, experiments, GPU backends and documentation fit together</small>
      </span>
      <span aria-hidden="true">→</span>
    </a>
    <a class="reference-card" href="${vocabularyHref()}">
      <span class="card-index">REFERENCE</span>
      <span>
        <strong>WebGPU vocabulary</strong>
        <small>Core concepts, execution model, resources and Cosmos compute terms</small>
      </span>
      <span aria-hidden="true">→</span>
    </a>
    <a class="reference-card" href="${conceptHref('reduction')}">
      <span class="card-index">CONCEPT</span>
      <span>
        <strong>Parallel reduction</strong>
        <small>From algebra and workgroup trees to a production Cosmos compute primitive</small>
      </span>
      <span aria-hidden="true">→</span>
    </a>
    </div>
  `
  renderMigrationOverview(requiredElement(host, '[data-migration-overview]'))
  const catalog = requiredElement<HTMLElement>(host, '.experiment-catalog')
  for (const group of experimentGroups) {
    const section = document.createElement('section')
    section.className = 'home-experiment-group'
    section.setAttribute('aria-labelledby', `catalog-${group.id}`)
    section.innerHTML = `
      <header class="catalog-group-heading">
        <h2 id="catalog-${group.id}">${group.title}</h2>
        <p>${group.description}</p>
      </header>
      <div class="experiment-grid"></div>
    `
    const grid = requiredElement<HTMLElement>(section, '.experiment-grid')
    for (const experiment of group.experiments) {
      const link = document.createElement('a')
      link.className = 'experiment-card'
      link.href = experimentHref(experiment.id)
      link.innerHTML = `
        <h3>${experiment.title}</h3>
        <p>${research[experiment.id]?.conclusion ?? experiment.summary}</p>
        <span class="tag-row">${experiment.tags.map(tag => `<span>${tag}</span>`).join('')}</span>
      `
      grid.append(link)
    }
    catalog.append(section)
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

function renderRoadmapFrame (host: HTMLElement): HTMLElement {
  host.innerHTML = `
    <header class="experiment-header reference-header">
      <div>
        <p class="eyebrow">Migration journey · Cosmos readiness</p>
        <h1>Cosmos → WebGPU</h1>
        <p>How realistic is the migration, how ready is Cosmos, and what evidence do we still need?</p>
      </div>
    </header>
    <section class="experiment-stage reference-stage">
      <div class="loading">Loading migration roadmap…</div>
    </section>
  `
  return requiredElement<HTMLElement>(host, '.reference-stage')
}

function renderArchitectureFrame (host: HTMLElement): HTMLElement {
  host.innerHTML = `
    <header class="experiment-header reference-header">
      <div>
        <p class="eyebrow">Lab reference · Architecture</p>
        <h1>Lab architecture</h1>
        <p>One shared interface for independent GPU experiments, explanations and results.</p>
      </div>
    </header>
    <section class="experiment-stage reference-stage">
      <div class="loading">Loading architecture guide…</div>
    </section>
  `
  return requiredElement<HTMLElement>(host, '.reference-stage')
}

function renderFeatureInventoryFrame (host: HTMLElement): HTMLElement {
  host.innerHTML = `
    <header class="experiment-header reference-header">
      <div>
        <p class="eyebrow">Cosmos → WebGPU · Feature inventory</p>
        <h1>Cosmos feature coverage</h1>
        <p>The production WebGL behavior, the evidence in our experiments and the remaining WebGPU validation.</p>
      </div>
    </header>
    <section class="experiment-stage reference-stage">
      <div class="loading">Loading feature inventory…</div>
    </section>
  `
  return requiredElement<HTMLElement>(host, '.reference-stage')
}

function renderReductionFrame (host: HTMLElement): HTMLElement {
  host.innerHTML = `
    <header class="experiment-header reference-header">
      <div>
        <p class="eyebrow">Concept deep dive · Parallel compute</p>
        <h1>Parallel reduction</h1>
        <p>
          How millions of independent values become one trustworthy result through
          local trees, partial buffers and recursively scheduled compute passes.
        </p>
      </div>
    </header>
    <section class="experiment-stage reference-stage">
      <div class="loading">Loading reduction research…</div>
    </section>
  `
  return requiredElement<HTMLElement>(host, '.reference-stage')
}

function renderExperimentFrame (host: HTMLElement, experiment: ExperimentDefinition): void {
  const record = research[experiment.id]
  host.innerHTML = `<div class="experiment-document">
    <header class="experiment-header unified-header"><h1>${experiment.title}</h1><p>${record.question}</p>
      <p class="research-conclusion">${record.conclusion}</p></header>
    <section class="experiment-stage unified-experiment" aria-busy="true"></section></div>`
}

function renderMissing (host: HTMLElement, id: string): void {
  host.innerHTML = `
    <section class="empty-state">
      <p class="eyebrow">Not found</p>
      <h1>Unknown experiment</h1>
      <p>No experiment is registered as <code data-missing-id></code>.</p>
      <a class="button-link" href="#/">Return to the lab</a>
    </section>
  `
  requiredElement<HTMLElement>(host, '[data-missing-id]').textContent = id
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

export function createAppShell (root: HTMLElement): { destroy(): void } {
  root.innerHTML = `
    <div class="app-shell">
      <header class="lab-header">
        <a class="brand" href="#/" aria-label="Cosmos GPU Lab home">
          <span class="brand-mark" aria-hidden="true"></span>
          <span><strong>Cosmos</strong><small>GPU Lab</small></span>
        </a>
        <nav class="lab-navigation" aria-label="Lab navigation">
          <a href="#/?section=experiment-catalog">All experiments</a><a href="#/roadmap">Roadmap</a><a href="#/learn">Learn</a>
        </nav>
      </header>
      <main class="workspace" tabindex="-1"></main>
    </div>
  `

  const workspace = requiredElement<HTMLElement>(root, '.workspace')
  const run = createRetainedRun(disposeExperimentNotes)
  let disposeContents = (): void => {}
  let mountedExperiment: string | undefined
  let failedRun: HTMLElement | undefined
  let renderVersion = 0
  const scrollPositions = new Map<string, number>()
  let previousPath: string | undefined

  const focusExperimentSection = (id: string): void => {
    const original = currentSection()
    const loading = workspace.querySelector('.unified-experiment[aria-busy="true"]')
    const section = loading ? original : resolveExperimentSection(workspace, research[id], original)
    if (section !== original) window.history.replaceState(null, '', `${experimentHref(id)}?section=${encodeURIComponent(section!)}`)
    if (section) scrollToSection(workspace, section)
    else window.scrollTo(0, 0)
  }

  const render = async (): Promise<void> => {
    const route = readRoute()
    const definition = route.kind === 'experiment' ? findExperiment(route.experimentId) : undefined
    const validPage = definition && (route.kind !== 'experiment' || !route.pageId || definition.pages.some(page => page.id === route.pageId))
    if (route.kind === 'experiment' && validPage) {
      const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
      if (route.pageId) params.set('section', articleSectionId(route.pageId, currentSection() ?? undefined))
      else if (route.view === 'evidence' && !params.has('section')) params.set('section', 'recorded-findings')
      window.history.replaceState(null, '', `${experimentHref(route.experimentId)}${params.size ? `?${params}` : ''}`)
      if (mountedExperiment === route.experimentId) { focusExperimentSection(route.experimentId); return }
    }
    renderVersion += 1
    const version = renderVersion
    disposeContents(); mountedExperiment = undefined
    if (failedRun) { disposeExperimentNotes(failedRun); failedRun = undefined }
    disposeDocumentTables(workspace)
    if (previousPath) scrollPositions.set(previousPath, window.scrollY)
    const path = window.location.hash.split('?')[0] || '#/'
    previousPath = path
    const finish = (): void => {
      if (version !== renderVersion || currentSection() || (route.kind === 'learn' && route.sectionId) ||
        (route.kind === 'vocabulary' && route.termId)) return
      window.scrollTo(0, route.kind === 'home' ? 0 : scrollPositions.get(path) ?? 0)
    }
    run.hide()
    if (route.kind === 'home' || (route.kind === 'experiment' && run.id !== route.experimentId)) {
      if (run.id) scrollPositions.delete(experimentHref(run.id))
      run.destroy()
    }
    window.scrollTo(0, 0)

    if (route.kind === 'home') {
      renderHome(workspace)
      scrollToSection(workspace, currentSection())
      finish()
      return
    }

    if (route.kind === 'learn') {
      workspace.innerHTML = `
        <header class="experiment-header reference-header">
          <div>
            <p class="eyebrow">Learn · From point data to pixels</p>
            <h1>How WebGPU works</h1>
            <p>A guided introduction through one Cosmos simulation tick. Read, try, then explore the real experiments.</p>
          </div>
        </header>
        <section class="experiment-stage reference-stage"><div class="loading">Loading guide…</div></section>
      `
      const stage = requiredElement<HTMLElement>(workspace, '.reference-stage')
      try {
        const [source, renderer, examples] = await Promise.all([
          import('../docs/learn-webgpu.md?raw'), import('./markdown'), import('./learning-examples'),
        ])
        if (version !== renderVersion) return
        await renderer.renderMarkdown(stage, source.default, {}, { examples: examples.learningExamples, sectionNavigation: false })
        examples.addLearningContents(stage, route.sectionId)
      } catch (error) {
        if (version !== renderVersion) return
        renderFailure(stage, error)
      }
      finish(); return
    }

    if (route.kind === 'validation-workflow' || route.kind === 'numerical-research') {
      const title = route.kind === 'validation-workflow' ? 'Validation workflow' : 'Numerical research'
      workspace.innerHTML = `<header class="experiment-header reference-header"><div>
        <p class="eyebrow">Migration evidence</p><h1>${title}</h1>
        <p>Behavior, numerical accuracy, compatibility, layout quality and cost.</p>
        </div></header><section class="experiment-stage reference-stage"></section>`
      const stage = requiredElement<HTMLElement>(workspace, '.reference-stage')
      try {
        const [source, renderer] = await Promise.all([
          route.kind === 'validation-workflow' ? import('../docs/validation-workflow.md?raw') : import('../docs/numerical-research.md?raw'),
          import('./markdown'),
        ])
        if (version !== renderVersion) return
        await renderer.renderMarkdown(stage, source.default)
        if (version === renderVersion) scrollToSection(stage, currentSection())
      } catch (error) { if (version === renderVersion) renderFailure(stage, error) }
      finish(); return
    }

    if (route.kind === 'architecture' || route.kind === 'roadmap' || route.kind === 'feature-inventory') {
      const stage = route.kind === 'roadmap'
        ? renderRoadmapFrame(workspace)
        : route.kind === 'feature-inventory' ? renderFeatureInventoryFrame(workspace) : renderArchitectureFrame(workspace)
      try {
        const [source, renderer] = await Promise.all([
          route.kind === 'roadmap'
            ? import('../docs/roadmap.md?raw')
            : route.kind === 'feature-inventory' ? import('../docs/feature-inventory.md?raw') : import('../docs/architecture.md?raw'),
          import('./markdown'),
        ])
        if (version !== renderVersion) return
        await renderer.renderMarkdown(stage, source.default, {}, {
          examples: { migrationStatus: host => renderMigrationOverview(host, true) },
        })
        if (version === renderVersion) scrollToSection(stage, currentSection())
      } catch (error) {
        if (version !== renderVersion) return
        renderFailure(stage, error)
      }
      finish(); return
    }

    if (route.kind === 'vocabulary') {
      const stage = renderVocabularyFrame(workspace)
      try {
        const renderer = await import('./markdown')
        if (version !== renderVersion) return
        await renderer.renderMarkdown(stage, vocabularySource, {}, { linkTerms: false, sectionNavigation: false })
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
      finish(); return
    }

    if (route.kind === 'concept') {
      if (route.conceptId !== 'reduction') {
        renderMissing(workspace, `concepts/${route.conceptId}`)
        return
      }
      const stage = renderReductionFrame(workspace)
      try {
        const renderer = await import('./markdown')
        if (version !== renderVersion) return
        const assets = Object.fromEntries([['diagrams/reduction-tree.svg', reductionTreeUrl]])
        await renderer.renderMarkdown(stage, reductionSource, assets, {
          excludedTermIds: ['reduction'],
        })
        if (version === renderVersion) scrollToSection(stage, currentSection())
      } catch (error) {
        if (version !== renderVersion) return
        renderFailure(stage, error)
      }
      finish(); return
    }

    const experiment = findExperiment(route.experimentId)
    if (!experiment) {
      renderMissing(workspace, route.experimentId)
      finish()
      return
    }

    if (route.pageId && !experiment.pages.some(page => page.id === route.pageId)) {
      renderMissing(workspace, `${experiment.id}/docs/${route.pageId}`); finish(); return
    }
    const record = research[experiment.id]
    renderExperimentFrame(workspace, experiment)
    const documentFrame = requiredElement<HTMLElement>(workspace, '.experiment-document')
    const stage = requiredElement<HTMLElement>(workspace, '.experiment-stage')
    disposeContents = renderExperimentContents(documentFrame, experiment)
    try {
      let live: HTMLElement
      try {
        await run.show(experiment, stage)
        if (version !== renderVersion) return
        live = requiredElement(stage, '.experiment-run')
      } catch (error) {
        if (version !== renderVersion) return
        live = document.createElement('div'); live.className = 'experiment-run'
        live.innerHTML = `<div class="run-layout"><section id="run-run"><h2>Live experiment unavailable</h2>
          <p>The explanations and recorded findings remain available below.</p><pre></pre></section>
          <section id="run-results"><h2>Live results</h2><p>Unavailable: the experiment could not initialize.</p></section></div>`
        live.querySelector('pre')!.textContent = error instanceof Error ? error.message : String(error)
        stage.append(live); failedRun = live
      }
      mountedExperiment = experiment.id
      await mountExperimentNotes(live, experiment, record)
      if (version !== renderVersion) return
      disposeContents(); disposeContents = renderExperimentContents(documentFrame, experiment)
      stage.setAttribute('aria-busy', 'false'); mountedExperiment = experiment.id
      if (currentSection()) focusExperimentSection(experiment.id)
    } catch (error) {
      if (version !== renderVersion) return
      stage.setAttribute('aria-busy', 'false'); renderFailure(stage, error)
    }
    finish()
  }

  const handleRoute = (): void => {
    render().catch(error => renderFailure(workspace, error))
  }

  const handleSameSection = (event: MouseEvent): void => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !mountedExperiment) return
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
    if (link && link.hash === window.location.hash && link.origin === window.location.origin && link.pathname === window.location.pathname) {
      event.preventDefault(); focusExperimentSection(mountedExperiment)
    }
  }
  root.addEventListener('click', handleSameSection)
  window.addEventListener('hashchange', handleRoute)
  window.addEventListener('beforeunload', run.destroy)
  handleRoute()
  return {
    destroy (): void {
      disposeDocumentTables(workspace)
      renderVersion++; disposeContents(); run.destroy()
      if (failedRun) disposeExperimentNotes(failedRun)
      root.removeEventListener('click', handleSameSection)
      window.removeEventListener('hashchange', handleRoute)
      window.removeEventListener('beforeunload', run.destroy)
      root.replaceChildren()
    },
  }
}
