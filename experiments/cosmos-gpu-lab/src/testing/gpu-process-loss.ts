import process from 'node:process'
import type {} from '@vitest/browser-playwright'
import type { BrowserCommandContext } from 'vitest/node'

export async function crashIsolatedGpu ({ page }: BrowserCommandContext): Promise<void> {
  const { VITE_LAB_GPU_PROCESS_LOSS: enabled, LAB_INLINE_BROWSER: inline, LAB_NATIVE_VISIBLE: visible } = process.env
  if (enabled !== '1' || inline === '1' || visible !== '1') {
    throw new Error('GPU process loss requires the explicitly enabled, isolated visible Chrome runner')
  }
  const browser = page.context().browser()
  if (!browser) throw new Error('Expected the runner-owned Chrome browser')
  const session = await browser.newBrowserCDPSession()
  try { await session.send('Browser.crashGpuProcess') } finally { await session.detach() }
}
