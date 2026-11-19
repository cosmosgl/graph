import type {
  ExperimentDefinition,
} from '../runtime/experiment'
import { caseEvidenceLinks } from '../runtime/experiment'
import vocabularySource from '../docs/vocabulary.md?raw'
import reductionSource from '../docs/reduction.md?raw'
import reductionTreeUrl from '../docs/diagrams/reduction-tree.svg?url'
import { createRetainedRun } from '../runtime/retained-run'
import { disposeDocumentTables } from '../runtime/result-tables'
import { experimentGroups, findExperiment } from './registry'
import {
  architectureHref, articleSectionId, caseHref, conceptHref, experimentHref, readRoute, vocabularyHref, currentSection,
} from './router'
import { indexVocabularyTerms } from './vocabulary'
import { research } from './research'
import { renderJourney, renderJourneyFlow } from './journey'
import { renderCoverageSummary, markCoverageRows } from './coverage'
import { renderMigrationOverview } from './research-ui'
import { scrollToSection } from './sections'
import { resolveExperimentSection } from './article-sections'
import { disposeExperimentNotes, mountExperimentNotes, renderExperimentContents } from './experiment-page'
import { renderStudyOverview } from './study-overview'
import { checkAgentFindingLinks, renderAgentFindings } from './agent-findings'
import { renderCaseEvidence, renderCaseFrame } from './case-page'
import { mountGlobalSearch } from './global-search'
import { readinessFor } from './readiness'
import { readinessBadge } from './readiness/presentation'

function requiredElement<T extends HTMLElement> (host: ParentNode, selector: string): T {
  const element = host.querySelector<T>(selector)
  if (!element) throw new Error(`Missing ${selector}`)
  return element
}

function renderHome (host: HTMLElement): void {
  host.innerHTML = `<header class="home-intro"><h1>Cosmos GPU Lab</h1>
    <p>Independent experiments exploring Cosmos rendering, simulation and WebGPU.</p></header>
    <nav class="home-references" aria-label="Lab references"><a href="#/validation-workflow">Validation workflow</a>
      <a href="${architectureHref()}">Lab architecture</a><a href="${vocabularyHref()}">Vocabulary</a>
      <a href="${conceptHref('reduction')}">Parallel reduction</a></nav>
    <section class="experiment-catalog" id="experiment-catalog" aria-label="Available experiments">
      <header class="catalog-header"><h2 class="catalog-title">Experiments</h2></header>
      <div class="catalog-groups"></div></section>`
  const catalog = requiredElement<HTMLElement>(host, '.catalog-groups')
  for (const group of experimentGroups) {
    const section = document.createElement('section'); section.className = 'home-experiment-group'
    section.setAttribute('aria-labelledby', `catalog-${group.id}`)
    const heading = document.createElement('header'); heading.className = 'catalog-group-heading'
    const title = document.createElement('h3'); title.id = `catalog-${group.id}`; title.textContent = group.title
    const description = document.createElement('p'); description.textContent = group.description
    heading.append(title, description)
    const grid = document.createElement('ul'); grid.className = 'experiment-grid'
    for (const experiment of group.experiments) {
      if (!experiment.cases) {
        const card = document.createElement('li'); card.className = 'experiment-item'
        const link = document.createElement('a'); link.className = 'experiment-card'; link.href = experimentHref(experiment.id)
        link.dataset.experimentId = experiment.id
        const title = document.createElement('h4'); title.textContent = experiment.title
        const question = document.createElement('p'); question.textContent = research[experiment.id].question
        link.append(title, question)
        if (research[experiment.id].investigations.some(item => item.page === research[experiment.id].evidence && item.state === 'Parked')) {
          const note = document.createElement('span'); note.className = 'catalog-meta'; note.textContent = 'Recorded study'; link.append(note)
        }
        card.append(link); grid.append(card)
        continue
      }
      for (const item of experiment.cases) {
        const assessment = readinessFor(experiment.id, item)
        const card = document.createElement('li'); card.className = 'experiment-item'
        const link = document.createElement('a'); link.className = 'experiment-card'; link.href = caseHref(experiment.id, item.id)
        link.dataset.experimentId = experiment.id; link.dataset.caseId = item.id
        const heading = document.createElement('div'); heading.className = 'experiment-card-heading'
        const title = document.createElement('h4'); title.textContent = item.title
        heading.append(title, readinessBadge(assessment.badge, assessment.tone))
        const finding = document.createElement('p'); finding.className = 'experiment-card-finding'
        if (item.kind === 'recorded') {
          const note = document.createElement('span'); note.className = 'catalog-recorded'; note.textContent = 'Recorded study · '
          finding.append(note)
        }
        finding.append(document.createTextNode(assessment.finding)); link.append(heading, finding)
        card.append(link); grid.append(card)
      }
    }
    section.append(heading, grid); catalog.append(section)
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
    <header class="experiment-header unified-header"><h1>${experiment.title}</h1>
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
        <nav class="lab-navigation" aria-label="Lab navigation">
          <a data-nav="experiments" href="#/?section=experiment-catalog">Experiments</a>
          <a data-nav="roadmap" href="#/roadmap">Roadmap</a>
          <a data-nav="feature-inventory" href="#/feature-inventory">Feature coverage</a>
          <a data-nav="learn" href="#/learn">Learn</a>
        </nav>
        <form class="global-search" id="lab-search-form" role="search" aria-label="Quick jump">
          <div class="global-search-field">
            <label class="search-label" for="lab-search">Search the lab</label>
            <input id="lab-search" type="text" role="combobox" placeholder="Search the lab…" autocomplete="off"
              autocapitalize="none" spellcheck="false" enterkeyhint="go" aria-autocomplete="list" aria-expanded="false"
              aria-controls="lab-search-options" aria-keyshortcuts="Meta+K Control+K">
            <button type="button" data-search-clear aria-label="Clear search" title="Clear search" hidden>×</button>
          </div>
          <section class="global-search-results" id="lab-search-results" aria-label="Quick jump results" hidden>
            <p data-search-status role="status"></p>
            <ol id="lab-search-options" role="listbox" aria-label="Search results"></ol>
            <div class="global-search-actions" hidden>
              <button type="button" data-search-more hidden></button>
              <button type="button" data-search-retry hidden>Retry search</button>
              <span class="global-search-keys" aria-hidden="true"><kbd>↑↓</kbd> Choose <kbd>↵</kbd> Open</span>
            </div>
          </section>
        </form>
      </header>
      <main class="workspace" tabindex="-1"></main>
    </div>
  `

  const header = requiredElement<HTMLElement>(root, '.lab-header')
  const measureHeader = (): void => { root.style.setProperty('--lab-header-height', `${Math.ceil(header.getBoundingClientRect().height)}px`) }
  const headerSize = new ResizeObserver(measureHeader); headerSize.observe(header); measureHeader()
  const workspace = requiredElement<HTMLElement>(root, '.workspace')
  let run = createRetainedRun(disposeExperimentNotes)
  let parkedSearchRun: { owner: ReturnType<typeof createRetainedRun>; id: string; caseId?: string } | undefined
  const disposeSearch = mountGlobalSearch(header, target => {
    workspace.focus({ preventScroll: true })
    if (!run.id || !target.experimentId || (run.id === target.experimentId && run.caseId === target.caseId)) return
    if (parkedSearchRun?.id === target.experimentId && parkedSearchRun.caseId === target.caseId) return
    parkedSearchRun?.owner.destroy()
    const id = run.id; const caseId = run.caseId
    run.hide()
    parkedSearchRun = { owner: run, id, caseId }
    run = createRetainedRun(disposeExperimentNotes)
  })
  const destroyRuns = (): void => { run.destroy(); parkedSearchRun?.owner.destroy(); parkedSearchRun = undefined }
  let disposeContents = (): void => {}
  let mountedExperiment: string | undefined
  let mountedCase: string | undefined
  let mountedEvidence: string | undefined
  let failedRun: HTMLElement | undefined
  let studyNotes: HTMLElement | undefined
  let startStudyLive: (() => Promise<void>) | undefined
  let renderVersion = 0
  const scrollPositions = new Map<string, number>()
  let previousPath: string | undefined

  const focusCaseSection = (section: string | null): boolean => {
    if (section === 'run-diagnostics') {
      const tools = workspace.querySelector<HTMLDetailsElement>('.case-single-page #run-diagnostics > details')
      if (tools) tools.open = true
    }
    return scrollToSection(workspace, section)
  }

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
    const brand = root.querySelector('.brand')!
    if (route.kind === 'home') brand.setAttribute('aria-current', 'page'); else brand.removeAttribute('aria-current')
    for (const link of root.querySelectorAll<HTMLAnchorElement>('[data-nav]')) {
      if (link.dataset.nav === 'experiments' && route.kind === 'home' && currentSection() === 'experiment-catalog') {
        link.setAttribute('aria-current', 'location')
      } else if (link.dataset.nav === route.kind) link.setAttribute('aria-current', 'page')
      else link.removeAttribute('aria-current')
    }
    const definition = route.kind === 'experiment' ? findExperiment(route.experimentId) : undefined
    const validPage = definition && (route.kind !== 'experiment' || !route.pageId || definition.pages.some(page => page.id === route.pageId))
    let selectedCase = route.kind === 'experiment' && definition?.cases
      ? definition.cases.find(item => item.id === (route.caseId ?? definition.cases![0].id))
      : undefined
    let caseSection = currentSection()
    let evidencePage = route.kind === 'experiment' ? route.evidencePage ?? route.pageId : undefined
    if (route.kind === 'experiment' && definition?.singlePage && validPage) {
      const { legacyCases, pageSections } = definition.singlePage
      const legacySection = route.caseId && Object.hasOwn(legacyCases, route.caseId) ? legacyCases[route.caseId] : undefined
      if (selectedCase || legacySection) {
        const slug = caseSection ?? ''
        const page = evidencePage ?? Object.keys(pageSections).sort((a, b) => b.length - a.length).find(id =>
          slug === articleSectionId(id) || slug.startsWith(`${articleSectionId(id)}-`))
        const inlineSection = page && Object.hasOwn(pageSections, page) ? pageSections[page] : legacySection
        if (inlineSection) {
          selectedCase = definition.cases![0]; caseSection = inlineSection; evidencePage = undefined
          window.history.replaceState(null, '', caseHref(definition.id, selectedCase.id, inlineSection))
        }
      }
    }
    if (route.kind === 'experiment' && selectedCase && definition) {
      if (route.pageId && evidencePage) {
        caseSection = caseSection?.startsWith(`${articleSectionId(route.pageId)}-`)
          ? caseSection
          : articleSectionId(route.pageId, caseSection ?? undefined)
      }
      if (!evidencePage && caseSection?.startsWith('doc-')) {
        evidencePage = [...definition.pages].sort((a, b) => b.id.length - a.id.length).find(page =>
          caseSection === articleSectionId(page.id) || caseSection!.startsWith(`${articleSectionId(page.id)}-`))?.id
      }
      if (!route.caseId && evidencePage && evidencePage !== 'agent-recipe') {
        const candidates = definition.cases!.filter(item => caseEvidenceLinks(item).some(link => link.page === evidencePage))
        const exact = candidates.find(item => caseEvidenceLinks(item).some(link => link.page === evidencePage && link.section &&
          caseSection === articleSectionId(link.page, link.section)))
        selectedCase = exact ?? candidates.find(item => item.kind === 'recorded') ?? candidates[0] ?? selectedCase
      }
      if (!route.caseId && caseSection === 'run-diagnostics' && definition.id === 'point-styling') {
        selectedCase = definition.cases!.find(item => item.id === 'picking')!
      }
      if (caseSection === 'run-run') caseSection = 'case-live'
      if (caseSection === 'study-overview' || caseSection === 'study-investigations') caseSection = 'recorded-findings'
      if (evidencePage === 'agent-recipe') {
        evidencePage = undefined; caseSection = 'recorded-findings'
        window.history.replaceState(null, '', `${caseHref(definition.id, selectedCase.id)}&section=recorded-findings`)
      } else if (route.view === 'evidence' && !evidencePage && !caseSection) caseSection = 'recorded-findings'
      const needsMeasurements = definition.singlePage && caseSection === 'run-diagnostics' && run.id !== definition.id
      if (!needsMeasurements && mountedExperiment === definition.id && mountedCase === selectedCase.id && mountedEvidence === evidencePage) {
        if (caseSection) {
          if (!focusCaseSection(caseSection) && evidencePage) scrollToSection(workspace, articleSectionId(evidencePage))
        } else window.scrollTo(0, 0)
        return
      }
    } else if (route.kind === 'experiment' && validPage && !definition?.cases) {
      const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
      if (route.pageId === 'agent-recipe' || params.get('section')?.startsWith('doc-agent-recipe')) {
        params.set('section', 'recorded-findings')
      } else if (route.pageId) params.set('section', articleSectionId(route.pageId, currentSection() ?? undefined))
      else if (route.view === 'evidence' && !params.has('section')) params.set('section', 'recorded-findings')
      window.history.replaceState(null, '', `${experimentHref(route.experimentId)}${params.size ? `?${params}` : ''}`)
      if (mountedExperiment === route.experimentId) {
        if (startStudyLive && wantsLiveStudy(route.view, currentSection())) await startStudyLive()
        focusExperimentSection(route.experimentId); return
      }
    }
    if (route.kind === 'experiment' && definition && parkedSearchRun?.id === definition.id &&
      parkedSearchRun.caseId === selectedCase?.id) {
      run.destroy(); run = parkedSearchRun.owner; parkedSearchRun = undefined
    }
    renderVersion += 1
    const version = renderVersion
    disposeContents(); mountedExperiment = undefined; mountedCase = undefined; mountedEvidence = undefined
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
    if (route.kind === 'home' || (route.kind === 'experiment' &&
      (run.id !== route.experimentId || (definition?.cases && run.caseId !== selectedCase?.id)))) {
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
    if (experiment.cases) {
      selectedCase = selectedCase ?? (route.caseId ? undefined : experiment.cases[0])
      if (!selectedCase) { renderMissing(workspace, `${experiment.id}?case=${route.caseId}`); return }
      if (evidencePage) {
        const page = experiment.pages.find(entry => entry.id === evidencePage)
        if (!page) { renderMissing(workspace, `${experiment.id}/docs/${evidencePage}`); return }
        try {
          await renderCaseEvidence(workspace, experiment, selectedCase, page)
          if (version !== renderVersion) return
          mountedExperiment = experiment.id; mountedCase = selectedCase.id; mountedEvidence = evidencePage
          if (caseSection && !scrollToSection(workspace, caseSection)) scrollToSection(workspace, articleSectionId(page.id))
        } catch (error) { if (version === renderVersion) renderFailure(workspace, error) }
        return
      }
      const frame = renderCaseFrame(workspace, experiment, selectedCase)
      mountedExperiment = experiment.id; mountedCase = selectedCase.id; mountedEvidence = undefined
      if (selectedCase.kind === 'recorded') {
        frame.stage.setAttribute('aria-busy', 'false')
        if (caseSection) scrollToSection(workspace, caseSection)
        return
      }
      let opening: Promise<void> | undefined
      const openCase = (): Promise<void> => {
        if (opening) return opening
        frame.stage.setAttribute('aria-busy', 'true')
        frame.retry.hidden = true; frame.retry.disabled = true; frame.status.textContent = 'Creating the live experiment…'
        opening = (async (): Promise<void> => {
          try {
            const deferComparison = !!experiment.singlePage && caseSection === 'run-diagnostics'
            await run.show(experiment, frame.slot, selectedCase!.id, deferComparison ? { deferComparison } : undefined)
            if (version !== renderVersion || !frame.slot.isConnected) return
            const layout = frame.slot.querySelector<HTMLElement>('.run-layout')
            if (layout) {
              layout.querySelector('.case-recorded')?.remove()
              layout.querySelector('.case-comparison')?.remove()
              const supplementary = layout.querySelector('#run-explanation, #run-live-explanation, #run-diagnostics')
              if (supplementary) (supplementary.closest('details') ?? supplementary).before(frame.recorded, frame.comparison)
              else layout.append(frame.recorded, frame.comparison)
            }
            frame.status.textContent = ''
          } catch (error) {
            if (version !== renderVersion || !frame.slot.isConnected) return
            frame.status.textContent = `Live experiment unavailable: ${error instanceof Error ? error.message : String(error)}`
            frame.retry.hidden = false; frame.retry.disabled = false
          } finally {
            if (version === renderVersion) {
              frame.stage.setAttribute('aria-busy', 'false')
              if (caseSection) focusCaseSection(caseSection)
            }
          }
        })().finally(() => { opening = undefined })
        return opening
      }
      frame.retry.addEventListener('click', () => { openCase().catch(error => { frame.status.textContent = String(error) }) })
      const readingEvidence = experiment.singlePage && (caseSection === 'recorded-findings' || caseSection === 'case-comparison' ||
        experiment.singlePage.observations.some(item => item.id === caseSection))
      if (readingEvidence && (run.id !== experiment.id || run.caseId !== selectedCase.id)) {
        const start = document.createElement('button'); start.type = 'button'; start.textContent = 'Start the live comparison'
        start.className = 'button-primary'; frame.slot.append(start)
        start.addEventListener('click', () => {
          start.remove(); caseSection = null
          openCase().catch(error => { frame.status.textContent = String(error) })
        })
        frame.stage.setAttribute('aria-busy', 'false'); scrollToSection(workspace, caseSection)
        return
      }
      await openCase()
      return
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
  window.addEventListener('beforeunload', destroyRuns)
  handleRoute()
  return {
    destroy (): void {
      headerSize.disconnect(); disposeDocumentTables(workspace); disposeSearch()
      renderVersion++; disposeContents(); destroyRuns()
      if (failedRun) disposeExperimentNotes(failedRun)
      if (studyNotes) disposeExperimentNotes(studyNotes)
      root.removeEventListener('click', handleSameSection)
      window.removeEventListener('hashchange', handleRoute)
      window.removeEventListener('beforeunload', destroyRuns)
      root.replaceChildren()
    },
  }
}
