import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selection, verifyMergeParents, verifyPrSource } from './lab-validation.mjs'
test('fixed investigation choices cannot inject commands or silently enable native work', () => {
  for (const choice of ['arithmetic', 'point-styling', 'links', 'full']) {
    const base = selection(choice, false); const sweep = selection(choice, true)
    assert.equal(base.flags.LAB_STORED_ALPHA_SWEEP, '0')
    assert.equal(sweep.flags.LAB_NATIVE_GPU, '0'); assert.equal(sweep.flags.LAB_SCALE_COUNT, '0')
    assert.equal(sweep.flags.LAB_INLINE_BROWSER, '0')
  }
  assert.equal(selection('point-styling', true).flags.LAB_STORED_ALPHA_SWEEP, '1')
  assert.equal(selection('point-styling', true).flags.LAB_RIBBON_COST, '0')
  assert.equal(selection('arithmetic', true).flags.LAB_FAR_ARITHMETIC_COST, '1')
  assert.equal(selection('links', true).flags.LAB_RIBBON_COST, '1')
  assert.throws(() => selection('full; echo bad', false))
  assert.throws(() => selection('full', 'yes'))
})
test('a PR merge must have the exact base and head parents', () => {
  assert.doesNotThrow(() => verifyMergeParents('base head\n', 'base', 'head'))
  assert.throws(() => verifyMergeParents('old-base head', 'base', 'head'))
  assert.throws(() => verifyMergeParents('head', 'base', 'head'))
})

test('manual dispatch rejects fork and missing source repositories', () => {
  assert.doesNotThrow(() => verifyPrSource({ head: { repo: { full_name: 'cosmosgl/graph' } } }, 'cosmosgl/graph'))
  assert.throws(() => verifyPrSource({ head: { repo: { full_name: 'someone/graph' } } }, 'cosmosgl/graph'))
  assert.throws(() => verifyPrSource({ head: { repo: null } }, 'cosmosgl/graph'))
})
