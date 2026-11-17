import { playwright } from '@vitest/browser-playwright'

export function labBrowser (gpu) {
  // The lab investigates the current machine. Do not force a software adapter.
  const provider = playwright({ launchOptions: {
    channel: 'chrome',
    args: gpu ? ['--enable-unsafe-webgpu'] : [],
  } })
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
    enabled: true, headless: !inline, connectTimeout: inline ? 180000 : 60000,
    screenshotFailures: false, provider, instances: [{ browser: 'chromium' }],
  }
}
