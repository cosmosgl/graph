import { playwright } from '@vitest/browser-playwright'

export function labBrowser (gpu) {
  const native = gpu && process.env.LAB_NATIVE_GPU === '1'
  const args = !gpu ? [] : native ? ['--enable-unsafe-webgpu'] : [
    '--enable-unsafe-webgpu', '--use-angle=swiftshader',
    ...(process.platform === 'linux' ? ['--use-vulkan=swiftshader', '--enable-features=Vulkan'] : []),
  ]
  const provider = playwright({ launchOptions: { ...(native ? { channel: 'chrome' } : {}), args } })
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
