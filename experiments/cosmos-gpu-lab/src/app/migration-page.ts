import source from '../docs/roadmap.md?raw'
import { youtubeMotionResult } from '../experiments/youtube-network/motion-result'
import { renderResultChart } from '../runtime/result-chart'
import { coverage, renderCoverage } from './coverage'
import { renderMarkdown } from './markdown'
import { migrationFocus, research } from './research'
import { experimentHref, roadmapHref } from './router'

function renderCurrentFocus (host: HTMLElement): void {
  const id = migrationFocus.experiment
  const focus = research[id]
  host.className = 'migration-focus'
  host.innerHTML = `<p class="migration-next">${focus.next}</p>
    <p>${focus.conclusion} <a href="${experimentHref(id, focus.evidence)}">Study findings</a></p>`
}

function addMigrationContents (article: HTMLElement): void {
  const parkedCount = article.querySelectorAll('#parked-investigations ~ ul > li').length
  const futureCount = article.querySelectorAll('#future-directions ~ h3').length
  const contents = document.createElement('nav')
  contents.className = 'migration-jumps migration-contents'
  contents.setAttribute('aria-label', 'On this page')
  contents.innerHTML = `<a href="${roadmapHref('feature-coverage')}">${coverage.length} features</a>
    <a href="${roadmapHref('parked-investigations')}">${parkedCount} parked investigations</a>
    <a href="${roadmapHref('future-directions')}">${futureCount} future ideas</a>`
  article.firstElementChild!.after(contents)
}

export function renderMigrationPage (host: HTMLElement): void {
  renderMarkdown(host, source, {}, {
    sectionNavigation: 'permalinks',
    linkTerms: false,
    examples: {
      migrationFocus: renderCurrentFocus,
      youtubeMotion: slot => { slot.replaceWith(renderResultChart(youtubeMotionResult)) },
      featureCoverage: renderCoverage,
    },
  })
  const article = host.querySelector('article')!
  for (const list of article.querySelectorAll('#what-remains + ul, #parked-investigations + p + ul')) list.setAttribute('role', 'list')
  addMigrationContents(article)
}
