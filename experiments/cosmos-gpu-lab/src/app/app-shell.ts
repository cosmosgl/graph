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
  architectureHref, articleSectionId, conceptHref, experimentHref, readRoute, vocabularyHref, currentSection,
} from './router'
import { indexVocabularyTerms } from './vocabulary'
import { research, milestones, migrationFocus } from './research'
import { currentStep, currentJourneyStep, experimentRole, focusedExperiment, milestoneTitle, renderJourney, renderJourneyFlow } from './journey'
import { renderCoverageIndex, renderCoverageSummary, markCoverageRows } from './coverage'
import { renderMigrationOverview } from './research-ui'
import { scrollToSection } from './sections'
import { resolveExperimentSection } from './article-sections'
import { disposeExperimentNotes, mountExperimentNotes, renderExperimentContents } from './experiment-page'
import { renderStudyOverview } from './study-overview'
import { checkAgentFindingLinks, renderAgentFindings } from './agent-findings'

function requiredElement<T extends HTMLElement> (host: ParentNode, selector: string): T {
  const element = host.querySelector<T>(selector)
  if (!element) throw new Error(`Missing ${selector}`)
  return element
}

function renderHome (host: HTMLElement): void {
  host.innerHTML = `<header class="home-intro"><h1>Cosmos GPU Lab</h1>
    <p>WebGPU methods, demonstrated scope and remaining Cosmos feature gaps. Production still uses WebGL.</p></header>
    <div data-migration-overview></div><section id="feature-map" class="feature-map" aria-label="Feature coverage map"></section>
    <nav class="home-references" aria-label="Lab references"><a href="#/validation-workflow">Validation workflow</a>
      <a href="${architectureHref()}">Lab architecture</a><a href="${vocabularyHref()}">Vocabulary</a>
      <a href="${conceptHref('reduction')}">Parallel reduction</a></nav>
    <section class="experiment-catalog" id="experiment-catalog" aria-label="Available experiments">
      <header class="catalog-header"><h2 class="catalog-title">Experiment catalog</h2>
      <label>Group experiments by <select data-catalog-grouping><option value="milestone">Migration area</option>
        <option value="reading">Reading path</option></select></label>
      <p class="catalog-intro">Roles describe the purpose of a study, not approval.
        Reading order teaches prerequisites; it is not migration progress.</p></header>
      <div data-catalog-groups></div></section>`
  renderMigrationOverview(requiredElement(host, '[data-migration-overview]'))
  renderCoverageIndex(requiredElement(host, '#feature-map'))
  const catalog = requiredElement<HTMLElement>(host, '[data-catalog-groups]')
  const grouping = requiredElement<HTMLSelectElement>(host, '[data-catalog-grouping]')
  const renderGroups = (): void => {
    catalog.replaceChildren()
    const groups = grouping.value === 'reading'
      ? experimentGroups
      : milestones.map(m => ({
        id: m.id,
        title: m.title,
        description: `Open workstream · ${m.position}`,
        experiments: experimentGroups.flatMap(group => group.experiments).filter(e => research[e.id].milestone === m.id),
      }))
    for (const group of groups) {
      if (!group.experiments.length) continue
      const section = document.createElement('section'); section.className = 'home-experiment-group'
      section.setAttribute('aria-labelledby', `catalog-${group.id}`)
      section.innerHTML = `<header class="catalog-group-heading"><h3 id="catalog-${group.id}">${group.title}</h3>
        <p>${group.description}</p></header><div class="experiment-grid"></div>`
      const grid = requiredElement<HTMLElement>(section, '.experiment-grid')
      for (const experiment of group.experiments) {
        const link = document.createElement('a'); link.className = 'experiment-card'; link.href = experimentHref(experiment.id)
        link.dataset.experimentId = experiment.id
        if (experiment.id === migrationFocus.experiment) link.dataset.current = 'true'
        link.innerHTML = `<p class="research-meta">${experimentRole(experiment.id)} · ${milestoneTitle(research[experiment.id].milestone)}</p>
          <h3>${experiment.title}</h3><p>${research[experiment.id].conclusion}</p>`
        grid.append(link)
      }
      catalog.append(section)
    }
  }
  grouping.addEventListener('change', renderGroups); renderGroups()
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
    <header class="experiment-header unified-header"><h1>${experiment.title}</h1>
      <p class="experiment-role">${experimentRole(experiment.id)} ·
        <a href="#/roadmap?section=milestone-${record.milestone}">${milestoneTitle(record.milestone)}</a></p>
      <p>${record.question}</p>
      ${experiment.study ? '' : `<p class="research-conclusion">${record.conclusion}</p>`}</header>
    <section class="experiment-stage unified-experiment" aria-busy="true"></section></div>`
  if (experiment.study?.visualFirst) {
    const summary = document.createElement('p'); summary.className = 'study-key-result'
    const label = document.createElement('strong'); label.textContent = 'Recorded result: '
    const link = document.createElement('a'); link.href = `${experimentHref(experiment.id)}?section=study-overview`
    link.textContent = 'See details'
    summary.append(label, document.createTextNode(`${experiment.study.record.conclusion} `), link)
    requiredElement(host, '.experiment-header').append(summary)
  }
  if (experiment.study && !experiment.study.visualFirst) {
    const header = requiredElement(host, '.experiment-header')
    const findings = renderAgentFindings(experiment); if (findings) header.append(findings)
    header.append(renderStudyOverview(experiment))
  }
}

function wantsLiveStudy (view: 'run' | 'evidence' | undefined, section: string | null): boolean {
  return (view === 'run' && !section) || ['run-run', 'run-configuration', 'run-results', 'run-diagnostics'].includes(section ?? '')
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
        <p class="lab-position">Current work · Step ${currentStep} ·
          <a href="#/roadmap?section=journey-${currentJourneyStep().id}">${currentJourneyStep().title}</a>
          <a href="${experimentHref(migrationFocus.experiment)}">${focusedExperiment().title}</a></p>
        <nav class="lab-navigation" aria-label="Lab navigation">
          <a data-nav="experiments" href="#/?section=experiment-catalog">Experiments</a><a data-nav="roadmap" href="#/roadmap">Roadmap</a>
          <a data-nav="feature-inventory" href="#/feature-inventory">Feature coverage</a><a data-nav="learn" href="#/learn">Learn</a>
        </nav>
      </header>
      <main class="workspace" tabindex="-1"></main>
    </div>
  `

  const header = requiredElement<HTMLElement>(root, '.lab-header')
  const measureHeader = (): void => { root.style.setProperty('--lab-header-height', `${Math.ceil(header.getBoundingClientRect().height)}px`) }
  const headerSize = new ResizeObserver(measureHeader); headerSize.observe(header); measureHeader()
  const workspace = requiredElement<HTMLElement>(root, '.workspace')
  const run = createRetainedRun(disposeExperimentNotes)
  let disposeContents = (): void => {}
  let mountedExperiment: string | undefined
  let failedRun: HTMLElement | undefined
  let studyNotes: HTMLElement | undefined
  let startStudyLive: (() => Promise<void>) | undefined
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
    const selectedNav = route.kind === 'experiment' || (route.kind === 'home' && currentSection() === 'experiment-catalog')
      ? 'experiments'
      : route.kind === 'vocabulary' || route.kind === 'concept' ? 'learn' : route.kind
    const brand = root.querySelector('.brand')!
    if (selectedNav === 'home') brand.setAttribute('aria-current', 'page'); else brand.removeAttribute('aria-current')
    for (const link of root.querySelectorAll<HTMLAnchorElement>('[data-nav]')) {
      if (link.dataset.nav === selectedNav) link.setAttribute('aria-current', route.kind === 'experiment' ? 'true' : 'page')
      else link.removeAttribute('aria-current')
    }
    const definition = route.kind === 'experiment' ? findExperiment(route.experimentId) : undefined
    const validPage = definition && (route.kind !== 'experiment' || !route.pageId || definition.pages.some(page => page.id === route.pageId))
    if (route.kind === 'experiment' && validPage) {
      const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
      if (route.pageId) params.set('section', articleSectionId(route.pageId, currentSection() ?? undefined))
      else if (route.view === 'evidence' && !params.has('section')) params.set('section', 'recorded-findings')
      window.history.replaceState(null, '', `${experimentHref(route.experimentId)}${params.size ? `?${params}` : ''}`)
      if (mountedExperiment === route.experimentId) {
        if (startStudyLive && wantsLiveStudy(route.view, currentSection())) await startStudyLive()
        focusExperimentSection(route.experimentId); return
      }
    }
    renderVersion += 1
    const version = renderVersion
    disposeContents(); mountedExperiment = undefined
    if (failedRun) { disposeExperimentNotes(failedRun); failedRun = undefined }
    if (studyNotes) { disposeExperimentNotes(studyNotes); studyNotes = undefined }
    startStudyLive = undefined
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
          examples: {
            migrationStatus: host => renderMigrationOverview(host, true),
            journeyPlan: renderJourney,
            journeyFlow: renderJourneyFlow,
            featureCoverageSummary: renderCoverageSummary,
          },
        })
        if (route.kind === 'feature-inventory') markCoverageRows(stage)
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
    if (experiment.study) {
      const liveSection = document.createElement('section'); liveSection.id = 'run-run'; liveSection.className = 'study-live'
      const intro = document.createElement('div'); intro.className = 'study-live-intro'
      intro.innerHTML = '<h2>Live experiment</h2><p></p>'
      requiredElement(intro, 'p').textContent = experiment.study.liveDescription ??
        'This is a new local session, separate from the recorded findings.'
      const launch = document.createElement('div'); launch.className = 'study-launch'
      launch.innerHTML = '<p role="status" data-study-status></p><button type="button" data-start-study hidden>Retry live experiment</button>'
      const slot = document.createElement('div'); slot.className = 'study-live-slot'
      liveSection.append(intro, launch, slot)
      const overview = experiment.study.visualFirst ? renderStudyOverview(experiment) : undefined
      const findings = experiment.study.visualFirst ? renderAgentFindings(experiment) : undefined
      const notesHost = document.createElement('div'); notesHost.className = 'study-notes-host'
      notesHost.innerHTML = '<div class="run-layout"></div>'
      stage.append(liveSection); if (overview) stage.append(overview)
      if (findings) stage.append(findings)
      stage.append(notesHost); studyNotes = notesHost
      const button = requiredElement<HTMLButtonElement>(launch, '[data-start-study]')
      const status = requiredElement<HTMLElement>(launch, '[data-study-status]')
      let opening: Promise<void> | undefined; let opened = false
      const refreshContents = (): void => { disposeContents(); disposeContents = renderExperimentContents(documentFrame, experiment) }
      startStudyLive = (): Promise<void> => {
        if (opened) return Promise.resolve()
        if (opening) return opening
        button.disabled = true; button.hidden = true; status.textContent = 'Creating the live experiment…'
        opening = (async (): Promise<void> => {
          try {
            await run.show(experiment, slot)
            if (version !== renderVersion || !slot.isConnected) return
            // The complete document is already mounted independently of GPU setup.
            if (overview) {
              const live = requiredElement<HTMLElement>(slot, '#run-live-viewer')
              live.querySelector('#study-overview')?.remove()
              live.append(overview); live.setAttribute('aria-label', 'Live comparison and recorded result')
            }
            launch.remove(); opened = true; refreshContents()
          } catch (error) {
            if (version !== renderVersion || !slot.isConnected) return
            status.textContent = `Live experiment unavailable: ${error instanceof Error ? error.message : String(error)}`
            button.hidden = false; button.disabled = false
            refreshContents()
          }
        })().finally(() => { opening = undefined })
        return opening
      }
      button.addEventListener('click', () => { startStudyLive?.().catch(error => { status.textContent = String(error) }) })
      const liveReady = startStudyLive()
      try {
        await mountExperimentNotes(notesHost, experiment, record)
        if (version !== renderVersion) return
        checkAgentFindingLinks(documentFrame)
        mountedExperiment = experiment.id; stage.setAttribute('aria-busy', 'false'); refreshContents()
        if (wantsLiveStudy(route.view, currentSection())) await liveReady
        if (version !== renderVersion) return
        if (currentSection()) focusExperimentSection(experiment.id)
      } catch (error) {
        if (version !== renderVersion) return
        run.destroy(); startStudyLive = undefined; disposeContents(); disposeContents = (): void => {}
        disposeExperimentNotes(notesHost); studyNotes = undefined
        stage.setAttribute('aria-busy', 'false'); renderFailure(stage, error)
        if (findings) stage.append(findings)
        checkAgentFindingLinks(documentFrame)
      }
      finish(); return
    }
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
      headerSize.disconnect(); disposeDocumentTables(workspace)
      renderVersion++; disposeContents(); run.destroy()
      if (failedRun) disposeExperimentNotes(failedRun)
      if (studyNotes) disposeExperimentNotes(studyNotes)
      root.removeEventListener('click', handleSameSection)
      window.removeEventListener('hashchange', handleRoute)
      window.removeEventListener('beforeunload', run.destroy)
      root.replaceChildren()
    },
  }
}
