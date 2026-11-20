import { playwright } from '@vitest/browser-playwright'

export function labBrowser (gpu) {
  // The lab investigates the current machine. Do not force a software adapter.
  const residentStudy = process.env.VITE_LAB_RESIDENT_INTERACTION === '1' || process.env.VITE_LAB_RESIDENT_DRAW_COST === '1' ||
    process.env.VITE_LAB_COMPOSED_INTERACTION === '1' || process.env.VITE_LAB_RESIDENT_REAL_GRAPH === '1' ||
    process.env.VITE_LAB_MOTION_STYLES === '1'
  const provider = playwright({ launchOptions: {
    channel: 'chrome',
    args: gpu ? ['--enable-unsafe-webgpu'] : [],
  }, ...(residentStudy ? { contextOptions: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 } } : {}) })
  const inline = process.env.LAB_INLINE_BROWSER === '1'
  if (inline) {
    provider.name = 'existing-browser'
    provider.providerFactory = () => ({
      name: 'existing-browser', supportsParallelism: false, getCommandsContext: () => ({}),
      openPage: async (_session, url) => { process.stdout.write(`\nOpen test session: ${url}\n`) },
      close: () => {},
    })
  }
  return {
    enabled: true, headless: !inline && process.env.LAB_NATIVE_VISIBLE !== '1', connectTimeout: inline ? 180000 : 60000,
    screenshotFailures: false, provider, instances: [{ browser: 'chromium' }],
    ...(residentStudy ? { ui: false, viewport: { width: 1080, height: 680 } } : {}),
  }
}
