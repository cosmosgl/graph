import { afterAll, afterEach } from 'vitest'
import { browserGpuTargets, installGpuRequestGuard } from './gpu-request-guard'
// Deliberately not vi.spyOn: a test's restoreAllMocks must not remove the guard.
const guard = installGpuRequestGuard(browserGpuTargets())
afterEach(() => { guard.assertUnused() })
afterAll(() => { try { guard.assertUnused() } finally { guard.restore() } })
