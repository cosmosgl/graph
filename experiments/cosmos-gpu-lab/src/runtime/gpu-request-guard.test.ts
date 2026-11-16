import { expect, it, vi } from 'vitest'
import { installGpuRequestGuard } from '../testing/gpu-request-guard'
it('rejects caught device requests even after mock restoration, while allowing 2D work', () => {
  const prototype = { getContext (kind: string): string { return kind }, requestAdapter (): string { return 'adapter' } }
  const original = prototype.getContext
  const guard = installGpuRequestGuard([
    { prototype, method: 'getContext', deny: (args): boolean => args[0] !== '2d' },
    { prototype, method: 'requestAdapter', deny: (): boolean => true },
  ])
  try {
    expect(prototype.getContext('2d')).toBe('2d'); guard.assertUnused()
    vi.restoreAllMocks()
    expect(() => prototype.getContext('webgl2')).toThrow('must not request a GPU')
    expect(() => guard.assertUnused()).toThrow('including caught errors')
    expect(() => prototype.requestAdapter()).toThrow('must not request a GPU')
    expect(() => guard.assertUnused()).toThrow('requestAdapter')
  } finally { guard.restore() }
  expect(prototype.getContext).toBe(original)
})
