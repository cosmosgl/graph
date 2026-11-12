import { expect, it } from 'vitest'
import { assessMatchedEvidence } from './assessment'
import type { Check, Row } from './session'

const check = (): Check => ({ stages: [], wholeTick: { valid: true, failures: 0, maxError: 0, worstIndex: -1 }, valid: true, restored: true })
const row = (): Row => ({ tick: 1, alpha: 1, samples: 8, quality: {}, checks: { webgl: check(), webgpu: check() }, complete: true })

it('does not turn a compatibility pass or an empty run into mathematical or behavioral certification', () => {
  const empty = assessMatchedEvidence([])
  expect(empty.lanes.webgpu.legacyCompatibility).toBe('not-assessed')
  expect(empty.layoutQuality).toBe('not-assessed'); expect(empty.numericalAccuracy).toBe('not-assessed')
  const sample = row()
  const measured = assessMatchedEvidence([sample])
  expect(measured.lanes.webgpu.legacyCompatibility).toBe('incomplete') // missing lane output
  expect(measured.lanes.webgpu.finiteLayouts).toBe('incomplete')
  expect(measured.performance).toBe('not-assessed')
})

it('retains earlier failures, counts probes separately and exposes unavailable paths', () => {
  const failed = row(); failed.checks.webgl!.valid = false
  const probe = row(); probe.checks.webgpu!.restored = false
  const assessment = assessMatchedEvidence([failed, row()], probe, { webgpu: 'device lost' })
  expect(assessment.lanes.webgl.legacyCompatibility).toBe('fail')
  expect(assessment.lanes.webgl.checkedTicks).toBe(2)
  expect(assessment.lanes.webgpu.checkedTicks).toBe(2); expect(assessment.lanes.webgpu.probeChecked).toBe(true)
  expect(assessment.lanes.webgpu.flagsAndRestoration).toBe('fail')
  expect(assessment.lanes.webgpu.legacyCompatibility).toBe('incomplete')
  expect(assessment.numericalAccuracy).toBe('not-assessed')
})
