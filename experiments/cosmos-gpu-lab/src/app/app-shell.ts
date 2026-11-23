import type { ExperimentCase, ExperimentDefinition } from '../runtime/experiment'
import vocabularySource from '../docs/vocabulary.md?raw'
import reductionSource from '../docs/reduction.md?raw'
import reductionTreeUrl from '../docs/diagrams/reduction-tree.svg?url'
import { createRetainedRun } from '../runtime/retained-run'
import { disposeDocumentTables } from '../runtime/result-tables'
import { experimentGroups, findExperiment } from './registry'
import {
  architectureHref, conceptHref, experimentHref, experimentSectionHref, readRoute, roadmapHref, vocabularyHref, currentSection,
} from './router'
import { indexVocabularyTerms } from './vocabulary'
import { scrollToSection } from './sections'
import type { renderCaseFrame } from './case-page'
import { experimentDestination, liveCaseSection, startingCase } from './experiment-route'
import type { ExperimentDestination } from './experiment-route'
import { mountGlobalSearch } from './global-search'
import { readinessFor } from './readiness'
import { readinessBadge } from './readiness/presentation'

type MountedCasePage = {
  id: string;
  release: () => void;
  visit: (destination: ExperimentDestination) => Promise<void>;
}

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
    <section class="experiment-catalog" id="experiment-catalog" aria-labelledby="concepts-title">
      <header class="catalog-header"><h2 class="catalog-title" id="concepts-title">Core interactive concepts</h2>
        <a href="#/?section=migration-studies">Jump to benchmarks and migration studies</a></header>
      <div class="catalog-groups"></div></section>
    <section class="experiment-catalog" id="migration-studies" aria-labelledby="studies-title">
      <header class="catalog-header"><h2 class="catalog-title" id="studies-title">Benchmarks and migration studies</h2>
        <a href="${roadmapHref('feature-coverage')}">Feature coverage</a></header>
      <div class="catalog-study-groups"></div></section>`
  const concepts = requiredElement<HTMLElement>(host, '.catalog-groups')
  const studies = requiredElement<HTMLElement>(host, '.catalog-study-groups')
  for (const group of experimentGroups) {
    const section = document.createElement('section')
    const heading = document.createElement('h3')
    heading.id = `catalog-${group.id}`; heading.textContent = group.title
    section.setAttribute('aria-labelledby', heading.id)
    section.append(heading)
    if (group.cards.length) {
      const grid = document.createElement('ul'); grid.className = 'experiment-grid'
      for (const experiment of group.cards) {
        const item = startingCase(experiment)
        const assessment = readinessFor(experiment.id, item)
        const card = document.createElement('li'); card.className = 'experiment-item'
        const link = document.createElement('a'); link.className = 'experiment-card'; link.href = experimentHref(experiment.id)
        link.dataset.experimentId = experiment.id
        const cardHeading = document.createElement('div'); cardHeading.className = 'experiment-card-heading'
        const title = document.createElement('h4'); title.textContent = experiment.title
        cardHeading.append(title, readinessBadge(assessment.badge, assessment.tone))
        const finding = document.createElement('p'); finding.className = 'experiment-card-finding'
        if (item.kind === 'recorded') {
          const note = document.createElement('span'); note.className = 'catalog-recorded'; note.textContent = 'Recorded study · '
          finding.append(note)
        }
        finding.append(document.createTextNode(assessment.finding)); link.append(cardHeading, finding)
        card.append(link); grid.append(card)
      }
      section.append(grid)
    }
    if (group.links.length) {
      const list = document.createElement('ul'); list.className = 'catalog-links'
      if (group.cards.length) list.setAttribute('aria-label', `More in ${group.title}`)
      for (const experiment of group.links) {
        const item = document.createElement('li')
        const link = document.createElement('a'); link.href = experimentHref(experiment.id); link.textContent = experiment.title
        item.append(link); list.append(item)
      }
      section.append(list)
    }
    const catalog = group.cards.length ? concepts : studies
    catalog.append(section)
  }
}

function renderReferenceFrame (host: HTMLElement, title: string, description: string): HTMLElement {
  host.innerHTML = `
    <div class="reading-document">
      <header class="reference-header"><h1></h1><p></p></header>
      <section class="reference-stage"><div class="loading" role="status">Loading…</div></section>
    </div>
  `
  requiredElement(host, '.reference-header h1').textContent = title
  requiredElement(host, '.reference-header p').textContent = description
  return requiredElement<HTMLElement>(host, '.reference-stage')
}

function renderMigrationFrame (host: HTMLElement): HTMLElement {
  host.innerHTML = `
    <div class="reading-document migration-document">
      <header><h1 id="migration-status">Cosmos → WebGPU</h1></header>
      <section class="migration-page"><div class="loading">Loading migration…</div></section>
    </div>
  `
  return requiredElement<HTMLElement>(host, '.migration-page')
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
          <a data-nav="roadmap" href="${roadmapHref()}">WebGPU migration</a>
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
  let run = createRetainedRun()
  let parkedSearchRun: { owner: ReturnType<typeof createRetainedRun>; id: string } | undefined
  const disposeSearch = mountGlobalSearch(header, target => {
    workspace.focus({ preventScroll: true })
    if (!run.id || !target.experimentId || run.id === target.experimentId || parkedSearchRun?.id === target.experimentId) return
    parkedSearchRun?.owner.destroy()
    mountedPage?.release()
    const id = run.id
    run.hide()
    parkedSearchRun = { owner: run, id }
    run = createRetainedRun()
  })
  const destroyRuns = (): void => { run.destroy(); parkedSearchRun?.owner.destroy(); parkedSearchRun = undefined }
  let mountedPage: MountedCasePage | undefined
  let renderVersion = 0
  const scrollPositions = new Map<string, number>()
  let previousPath: string | undefined

  function mountCasePage (
    experiment: ExperimentDefinition, owner: ReturnType<typeof createRetainedRun>, frame: ReturnType<typeof renderCaseFrame>
  ): MountedCasePage {
    let active = experiment.cases!.find(item => owner.id === experiment.id && item.id === owner.caseId) ?? startingCase(experiment)
    frame.setLiveCase(active)
    let focusRequest = 0
    let launch = 0
    let opening: { id: string; ready: Promise<void> } | undefined
    const openCase = (item: ExperimentCase): Promise<void> => {
      if (opening?.id === item.id) return opening.ready
      if (owner.id === experiment.id && owner.caseId === item.id && frame.slot.firstElementChild) return Promise.resolve()
      const request = ++launch
      active = item; frame.setLiveCase(item)
      frame.stage.setAttribute('aria-busy', 'true')
      frame.retry.hidden = true
      frame.status.textContent = ''
      const isCurrent = (): boolean => request === launch && frame.stage.isConnected
      const ready = (async (): Promise<void> => {
        try {
          const instance = await owner.show(experiment, frame.slot, item.id)
          if (isCurrent() && instance.pageEndSection) frame.stage.append(instance.pageEndSection)
        } catch (error) {
          if (!isCurrent()) return
          frame.status.textContent = `Live experiment unavailable: ${error instanceof Error ? error.message : String(error)}`
          frame.retry.hidden = false
        } finally {
          if (isCurrent()) { opening = undefined; frame.stage.setAttribute('aria-busy', 'false') }
        }
      })()
      opening = { id: item.id, ready }
      return ready
    }
    frame.retry.addEventListener('click', () => { focusRequest++; openCase(active).catch(() => {}) })
    frame.onChooseCase((item, control) => {
      const section = item === startingCase(experiment) ? null : liveCaseSection(item)
      window.history.replaceState(null, '', experimentSectionHref(experiment.id, section))
      const keepFocus = document.activeElement === control
      const request = ++focusRequest
      openCase(item).then(() => {
        if (request === focusRequest && keepFocus && document.activeElement === document.body) control.focus({ preventScroll: true })
      }).catch(() => {})
    })
    return {
      id: experiment.id,
      release (): void { focusRequest++; launch++ },
      async visit (destination: ExperimentDestination): Promise<void> {
        const request = ++focusRequest
        const { section } = destination
        if (active.kind !== 'recorded') await openCase(destination.liveCase ?? active)
        if (request !== focusRequest || !frame.stage.isConnected) return
        if (!section) { window.scrollTo(0, 0); return }
        const fallback = await frame.openEvidence(section)
        if (request !== focusRequest || !frame.stage.isConnected) return
        const target = section === 'run-configuration' && !frame.slot.querySelector('#run-configuration:not(:empty)') ? 'case-live' : section
        if (!scrollToSection(workspace, target) && fallback) scrollToSection(workspace, fallback)
      },
    }
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
    const destination = definition && experimentDestination(definition, currentSection())
    if (destination && destination.href !== window.location.hash) window.history.replaceState(null, '', destination.href)
    if (destination && mountedPage?.id === definition?.id) {
      await mountedPage!.visit(destination)
      return
    }
    if (route.kind === 'roadmap' && workspace.querySelector('.migration-page > .prose')) {
      if (!scrollToSection(workspace, route.section ?? null)) window.scrollTo(0, 0)
      return
    }
    mountedPage?.release(); mountedPage = undefined
    if (definition && destination && parkedSearchRun?.id === definition.id &&
      (!destination.liveCase || parkedSearchRun.owner.caseId === destination.liveCase.id)) {
      run.destroy(); run = parkedSearchRun.owner; parkedSearchRun = undefined
    }
    renderVersion += 1
    const version = renderVersion
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
    if (route.kind === 'home' || (route.kind === 'experiment' && (!destination || run.id !== route.experimentId))) {
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
      const stage = renderReferenceFrame(workspace, 'How WebGPU works', 'Follow one Cosmos simulation tick with interactive examples.')
      try {
        const [source, renderer, examples] = await Promise.all([
          import('../docs/learn-webgpu.md?raw'), import('./markdown'), import('./learning-examples'),
        ])
        if (version !== renderVersion) return
        renderer.renderMarkdown(stage, source.default, {}, { examples: examples.learningExamples, sectionNavigation: false })
        examples.addLearningContents(stage, route.sectionId)
      } catch (error) {
        if (version !== renderVersion) return
        renderFailure(stage, error)
      }
      finish(); return
    }

    if (route.kind === 'validation-workflow' || route.kind === 'numerical-research') {
      const title = route.kind === 'validation-workflow' ? 'Validation workflow' : 'Numerical research'
      const stage = renderReferenceFrame(workspace, title, 'Behavior, numerical accuracy, compatibility, layout quality and cost.')
      try {
        const [source, renderer] = await Promise.all([
          route.kind === 'validation-workflow' ? import('../docs/validation-workflow.md?raw') : import('../docs/numerical-research.md?raw'),
          import('./markdown'),
        ])
        if (version !== renderVersion) return
        renderer.renderMarkdown(stage, source.default)
        scrollToSection(stage, currentSection())
      } catch (error) { if (version === renderVersion) renderFailure(stage, error) }
      finish(); return
    }

    if (route.kind === 'roadmap') {
      const stage = renderMigrationFrame(workspace)
      try {
        const renderer = await import('./migration-page')
        if (version !== renderVersion) return
        renderer.renderMigrationPage(stage)
        scrollToSection(workspace, route.section ?? null)
      } catch (error) {
        if (version === renderVersion) renderFailure(stage, error)
      }
      finish(); return
    }

    if (route.kind === 'architecture') {
      const stage = renderReferenceFrame(workspace, 'Lab architecture', 'How the Lab connects independent GPU experiments, explanations and results.')
      try {
        const [source, renderer] = await Promise.all([
          import('../docs/architecture.md?raw'), import('./markdown'),
        ])
        if (version !== renderVersion) return
        renderer.renderMarkdown(stage, source.default)
        scrollToSection(stage, currentSection())
      } catch (error) {
        if (version !== renderVersion) return
        renderFailure(stage, error)
      }
      finish(); return
    }

    if (route.kind === 'vocabulary') {
      const stage = renderReferenceFrame(workspace, 'Vocabulary', 'WebGPU resources, commands, shaders and data structures used by Cosmos.')
      try {
        const renderer = await import('./markdown')
        if (version !== renderVersion) return
        renderer.renderMarkdown(stage, vocabularySource, {}, { omitTitle: true, linkTerms: false, sectionNavigation: false })
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
      const stage = renderReferenceFrame(workspace, 'Parallel reduction', 'How local trees and partial buffers combine millions of values into one.')
      try {
        const renderer = await import('./markdown')
        if (version !== renderVersion) return
        const assets = Object.fromEntries([['diagrams/reduction-tree.svg', reductionTreeUrl]])
        renderer.renderMarkdown(stage, reductionSource, assets, {
          omitTitle: true,
          excludedTermIds: ['reduction'],
        })
        scrollToSection(stage, currentSection())
      } catch (error) {
        if (version !== renderVersion) return
        renderFailure(stage, error)
      }
      finish(); return
    }

    if (!definition || !destination) {
      renderMissing(workspace, route.experimentId)
      finish()
      return
    }
    renderReferenceFrame(workspace, definition.title, definition.summary)
    try {
      const { renderCaseFrame } = await import('./case-page')
      if (version !== renderVersion) return
      const page = mountCasePage(definition, run, renderCaseFrame(workspace, definition))
      mountedPage = page
      await page.visit(destination)
    } catch (error) {
      if (version === renderVersion) renderFailure(workspace, error)
    }
  }

  const handleRoute = (): void => {
    render().catch(error => renderFailure(workspace, error))
  }

  const handleSameSection = (event: MouseEvent): void => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
    if (link?.href !== window.location.href) return
    if (previousPath === '#/') {
      if (scrollToSection(workspace, currentSection())) event.preventDefault()
    } else if (mountedPage || previousPath === roadmapHref()) {
      event.preventDefault(); handleRoute()
    }
  }
  root.addEventListener('click', handleSameSection)
  window.addEventListener('hashchange', handleRoute)
  window.addEventListener('beforeunload', destroyRuns)
  handleRoute()
  return {
    destroy (): void {
      headerSize.disconnect(); disposeDocumentTables(workspace); disposeSearch()
      renderVersion++; mountedPage?.release(); destroyRuns()
      root.removeEventListener('click', handleSameSection)
      window.removeEventListener('hashchange', handleRoute)
      window.removeEventListener('beforeunload', destroyRuns)
      root.replaceChildren()
    },
  }
}
