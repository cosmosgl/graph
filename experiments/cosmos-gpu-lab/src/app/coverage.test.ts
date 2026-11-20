import { expect, it } from 'vitest'
import inventory from '../docs/feature-inventory.md?raw'
import { coverage, parseCoverage, renderCoverage } from './coverage'

it('keeps all inventory features classified and rejects an unrecognized status', () => {
  expect(coverage).toHaveLength(37)
  expect(coverage.find(row => row.name === 'Curved links')?.status).toBe('Partial')
  expect(coverage.find(row => row.name === 'Other shapes')?.status).toBe('Covered in isolation')
  expect(coverage.find(row => row.name === 'Arrowheads')?.status).toBe('Needs validation')
  expect(() => parseCoverage(inventory.replace('| Partial |', '| Unclassified |'))).toThrow('unclassified inventory feature')
})

it('shows each feature with its evidence and WebGL behavior in the open checklist', () => {
  const host = document.createElement('div')
  renderCoverage(host)
  expect(host.querySelectorAll('.coverage-group')).toHaveLength(4)
  expect(host.querySelectorAll('li[id^="feature-"]')).toHaveLength(37)
  expect(host.querySelectorAll('.coverage-evidence')).toHaveLength(37)
  expect(host.querySelectorAll('.coverage-baseline')).toHaveLength(37)
  const summary = host.querySelector('.coverage-summary')!.textContent
  expect(summary).toContain('1 covered in isolation')
  expect(summary).toContain('33 partial')
  expect(summary).toContain('3 need validation')
  const collision = host.querySelector('#feature-collision')!
  expect(collision.querySelector('a')?.getAttribute('href')).toBe('#/collision?section=doc-hashed-findings')
  expect(collision.textContent).toContain('Production WebGL')
  expect(host.querySelector('nav[aria-label="Coverage groups"] a[href="#/roadmap?section=coverage-simulation"]')?.textContent).toBe('Simulation 12')
})
