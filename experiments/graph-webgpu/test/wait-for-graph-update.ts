import { vi } from 'vitest'

// A submitted pick, tracker or animation frame can take longer than Vitest's
// default one-second poll on a software GPU. Resolve as soon as it is observed.
export function waitForGraphUpdate (assertion: () => void): Promise<void> {
  return vi.waitFor(assertion, { timeout: 8000 })
}
