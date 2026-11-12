import type {
  ExperimentDefinition,
  ExperimentPage,
} from '../runtime/experiment'
import vocabularySource from '../docs/vocabulary.md?raw'
import reductionSource from '../docs/reduction.md?raw'
import reductionTreeUrl from '../docs/diagrams/reduction-tree.svg?url'
import { createRetainedRun } from '../runtime/retained-run'
import { validationContractMarkdown } from '../runtime/validation'
import { disposeDocumentTables } from '../runtime/result-tables'
import { experimentGroups, findExperiment } from './registry'
import { architectureHref, conceptHref, experimentHref, featureInventoryHref, readRoute, roadmapHref, vocabularyHref, currentSection, runHref } from './router'
import { indexVocabularyTerms } from './vocabulary'
import { research } from './research'
import { renderEvidenceIndex, renderInvestigationContext, renderMigrationOverview, renderResearchOverview } from './research-ui'
import { scrollToSection } from './sections'

function requiredElement<T extends HTMLElement> (host: ParentNode, selector: string): T {
  const element = host.querySelector<T>(selector)
  if (!element) throw new Error(`Missing ${selector}`)
  return element
}

function renderNavigation (
  host: HTMLElement,
  activeId?: string,
  activeReference?: 'learn' | 'vocabulary' | 'reduction' | 'architecture' | 'roadmap' | 'feature-inventory' | 'validation-workflow' | 'numerical-research'
): void {
  host.replaceChildren()
  for (const group of experimentGroups) {
    const section = document.createElement('section')
    section.className = 'nav-group'
    section.setAttribute('aria-labelledby', `nav-${group.id}`)
    section.innerHTML = `<h2 class="nav-label" id="nav-${group.id}">${group.title}</h2><div class="nav-group-links"></div>`
    const links = requiredElement<HTMLElement>(section, '.nav-group-links')
    for (const experiment of group.experiments) {
      const link = document.createElement('a')
      link.href = experimentHref(experiment.id)
      link.className = 'experiment-link'
      link.classList.toggle('active', experiment.id === activeId)
      if (experiment.id === activeId) link.setAttribute('aria-current', 'page')
      link.innerHTML = `<span>${experiment.title}</span><small>${experiment.tags[0] ?? 'experiment'}</small>`
      links.append(link)
    }
    host.append(section)
  }

  const reference = document.createElement('section')
  reference.className = 'nav-group'
  reference.setAttribute('aria-labelledby', 'nav-reference')
  reference.innerHTML = '<h2 class="nav-label" id="nav-reference">Reference</h2><div class="nav-group-links"></div>'
  const references = requiredElement<HTMLElement>(reference, '.nav-group-links')
  host.append(reference)

  const learn = document.createElement('a')
  learn.href = '#/learn'
  learn.className = 'experiment-link reference-link'
  learn.classList.toggle('active', activeReference === 'learn')
  learn.innerHTML = '<span>How WebGPU works</span><small>learn</small>'
  if (activeReference === 'learn') learn.setAttribute('aria-current', 'page')
  references.append(learn)

  const roadmap = document.createElement('a')
  roadmap.href = roadmapHref()
  roadmap.className = 'experiment-link reference-link'
  roadmap.classList.toggle('active', activeReference === 'roadmap')
  roadmap.innerHTML = '<span>WebGPU migration</span><small>roadmap</small>'
  if (activeReference === 'roadmap') roadmap.setAttribute('aria-current', 'page')
  references.append(roadmap)

  const inventory = document.createElement('a')
  inventory.href = featureInventoryHref()
  inventory.className = 'experiment-link reference-link'
  inventory.classList.toggle('active', activeReference === 'feature-inventory')
  inventory.innerHTML = '<span>Cosmos feature coverage</span><small>inventory</small>'
  if (activeReference === 'feature-inventory') inventory.setAttribute('aria-current', 'page')
  references.append(inventory)

  for (const [id, title] of [['validation-workflow', 'Validation workflow'], ['numerical-research', 'Numerical research']] as const) {
    const link = document.createElement('a')
    link.href = `#/${id}`; link.className = 'experiment-link reference-link'
    link.classList.toggle('active', activeReference === id)
    if (activeReference === id) link.setAttribute('aria-current', 'page')
    link.innerHTML = `<span>${title}</span><small>validation</small>`
    references.append(link)
  }

  const architecture = document.createElement('a')
  architecture.href = architectureHref()
  architecture.className = 'experiment-link reference-link'
  architecture.classList.toggle('active', activeReference === 'architecture')
  architecture.innerHTML = '<span>Lab architecture</span><small>guide</small>'
  if (activeReference === 'architecture') architecture.setAttribute('aria-current', 'page')
  references.append(architecture)

  const vocabulary = document.createElement('a')
  vocabulary.href = vocabularyHref()
  vocabulary.className = 'experiment-link reference-link'
  vocabulary.classList.toggle('active', activeReference === 'vocabulary')
  vocabulary.innerHTML = '<span>WebGPU vocabulary</span><small>guide</small>'
  if (activeReference === 'vocabulary') vocabulary.setAttribute('aria-current', 'page')
  references.append(vocabulary)

  const reduction = document.createElement('a')
  reduction.href = conceptHref('reduction')
  reduction.className = 'experiment-link reference-link'
  reduction.classList.toggle('active', activeReference === 'reduction')
  reduction.innerHTML = '<span>Parallel reduction</span><small>concept</small>'
  if (activeReference === 'reduction') reduction.setAttribute('aria-current', 'page')
  references.append(reduction)
  const current = host.querySelector<HTMLElement>('[aria-current="page"]')
  if (current) current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  else { host.scrollTop = 0; host.scrollLeft = 0 }
}

function renderHome (host: HTMLElement): void {
  host.innerHTML = `
    <header class="home-intro">
      <h1>Cosmos GPU Lab</h1>
    </header>
    <div data-migration-overview></div>
    <div class="home-sections">
    <div class="experiment-catalog" aria-label="Available experiments">
      <p class="catalog-intro">Explore the groups from foundations to validation.
        Experiments within each group follow a suggested reading order; the migration roadmap records our findings and next steps.</p>
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
  activePage?: ExperimentPage,
  view?: 'run' | 'evidence'
): void {
  const record = research[experiment.id]
  host.innerHTML = `
    <header class="experiment-header">
      <div>
        <h1>${experiment.title}</h1>
        ${!activePage && !view ? `<p>${record?.pilot ? record.question : experiment.summary}</p>` : ''}
      </div>
    </header>
    <nav class="page-tabs" aria-label="Experiment sections"></nav>
    <section class="experiment-stage"></section>
  `

  const tabs = requiredElement<HTMLElement>(host, '.page-tabs')
  if (record?.pilot) {
    const section = activePage ? activePage.id === record.method || activePage.id === 'validation-contract' ? 'method' : 'evidence' : view ?? 'overview'
    tabs.append(
      createTab('Overview', experimentHref(experiment.id), section === 'overview'),
      createTab('Run', runHref(experiment.id), section === 'run'),
      createTab('Method', experimentHref(experiment.id, record.method), section === 'method'),
      createTab('Evidence', `#/${experiment.id}/evidence`, section === 'evidence')
    )
    if (activePage && section === 'evidence') {
      const breadcrumb = document.createElement('p'); breadcrumb.className = 'research-breadcrumb'
      breadcrumb.innerHTML = `<a href="${experimentHref(experiment.id)}">Overview</a> →
        <a href="#/${experiment.id}/evidence">Evidence</a>`
      breadcrumb.append(` → ${activePage.title}`); tabs.after(breadcrumb)
    }
    return
  }
  tabs.append(createTab('Demo', experimentHref(experiment.id), !activePage))
  for (const page of experiment.pages) {
    tabs.append(createTab(page.title, experimentHref(experiment.id, page.id), page.id === activePage?.id))
  }
  if (!activePage) {
    const note = document.createElement('p'); note.className = 'demo-note'
    const link = document.createElement('a'); link.href = experimentHref(experiment.id, 'validation-contract')
    link.textContent = 'Validation contract'
    note.append(link, ' · Reference, acceptance rules, checked population and limits. A completed run is not a production approval.')
    tabs.after(note)
  }
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
  const run = createRetainedRun()
  let renderVersion = 0
  const scrollPositions = new Map<string, number>()
  let previousPath: string | undefined

  const render = async (): Promise<void> => {
    renderVersion += 1
    const version = renderVersion
    disposeDocumentTables(workspace)
    const route = readRoute()
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
      if (run.id) { scrollPositions.delete(experimentHref(run.id)); scrollPositions.delete(runHref(run.id)) }
      run.destroy()
    }
    renderNavigation(
      navigation,
      route.kind === 'experiment' ? route.experimentId : undefined,
      route.kind === 'vocabulary'
        ? 'vocabulary'
        : route.kind === 'concept' && route.conceptId === 'reduction'
          ? 'reduction'
          : route.kind === 'learn' || route.kind === 'architecture' || route.kind === 'roadmap' || route.kind === 'feature-inventory' ||
            route.kind === 'validation-workflow' || route.kind === 'numerical-research'
            ? route.kind
            : undefined
    )
    window.scrollTo(0, 0)

    if (route.kind === 'home') {
      renderHome(workspace)
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

    const page = route.pageId
      ? experiment.pages.find(candidate => candidate.id === route.pageId)
      : undefined
    if (route.pageId && !page) { renderMissing(workspace, `${experiment.id}/docs/${route.pageId}`); finish(); return }
    const record = research[experiment.id]
    renderExperimentFrame(workspace, experiment, page, route.view)
    const stage = requiredElement<HTMLElement>(workspace, '.experiment-stage')

    try {
      if (record?.pilot && !page && route.view !== 'run') {
        if (route.view === 'evidence') renderEvidenceIndex(stage, experiment, record)
        else renderResearchOverview(stage, experiment, record)
      } else if (!page) {
        await run.show(experiment, stage)
        if (version === renderVersion) scrollToSection(stage, currentSection())
      } else if (page.kind === 'markdown') {
        stage.innerHTML = '<div class="loading">Loading documentation…</div>'
        const [source, renderer] = await Promise.all([page.load(), import('./markdown')])
        if (version !== renderVersion) return
        const method = record?.pilot && page.id === record.method
        await renderer.renderMarkdown(stage, method ? `${source}\n\n${validationContractMarkdown(experiment.id, false)}` : source, page.assets)
        if (version !== renderVersion) return
        if (record?.pilot) renderInvestigationContext(stage, experiment, record, page.id)
        scrollToSection(stage, currentSection())
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
    finish()
  }

  const handleRoute = (): void => {
    render().catch(error => renderFailure(workspace, error))
  }

  window.addEventListener('hashchange', handleRoute)
  window.addEventListener('beforeunload', run.destroy)
  handleRoute()
  return {
    destroy (): void {
      disposeDocumentTables(workspace)
      renderVersion++; run.destroy()
      window.removeEventListener('hashchange', handleRoute)
      window.removeEventListener('beforeunload', run.destroy)
      root.replaceChildren()
    },
  }
}
