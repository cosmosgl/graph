import { expect, it } from 'vitest'
import inventory from '../docs/feature-inventory.md?raw'
import { coverage, parseCoverage, renderCoverageIndex, renderCoverageSummary } from './coverage'
import { experimentRole, journeySteps, renderJourney, currentStep } from './journey'
import { migrationFocus } from './research'
it('indexes all inventory features without treating partial curves as unstarted or a parked sub-study as the whole experiment', () => {
  expect(coverage).toHaveLength(37)
  expect(coverage.find(row => row.name === 'Curved links')?.status).toBe('Partial')
  expect(coverage.find(row => row.name === 'Per-point attractors')?.status).toBe('Needs validation')
  expect(experimentRole('weighted-links')).not.toBe('Parked')
  expect(experimentRole(migrationFocus.experiment)).toBe('Current investigation')
  expect(() => parseCoverage(inventory.replace('**Partial.**', '**Unclassified.**'))).toThrow('Unclassified inventory feature')
})
it('derives visible counts and method links from the inventory and retains every feature', () => {
  const host = document.createElement('div'); renderCoverageIndex(host)
  expect(host.querySelectorAll('tbody tr')).toHaveLength(37)
  expect(host.textContent).toContain('No validating experiment yet')
  expect(host.querySelector('[href="#/curved-links"]')!.textContent).toContain('color-face')
  renderCoverageSummary(host)
  expect(host.textContent).toContain('1 covered in isolation')
  expect(host.textContent).toContain('26 partial')
  expect(host.textContent).toContain('10 needs validation')
  expect(host.textContent).toContain('not a completion percentage')
})
it('distinguishes the ordered current investigation from still-open migration workstreams', () => {
  const host = document.createElement('div'); renderJourney(host)
  expect(host.querySelectorAll('tbody tr')).toHaveLength(5)
  expect(journeySteps.filter(step => step.number === currentStep)).toHaveLength(1)
  expect(host.querySelector('#journey-polygon-boundaries')!.textContent).toContain('Closed with retained failures')
  expect(host.textContent).toContain('GPU execution and resources and')
  expect(host.querySelector('#journey-link-rendering a')!.getAttribute('href')).toBe(`#/${migrationFocus.experiment}`)
})
