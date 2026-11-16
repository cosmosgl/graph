import { it } from 'vitest'
import { writeArtifact } from '../testing/artifacts'
import { createDevice } from './luma'
it('records the actual browser and adapter identities for reproduction', async () => {
  const adapters: unknown[] = []; const errors: string[] = []
  try {
    for (const api of ['webgl', 'webgpu'] as const) {
      try {
        const device = await createDevice(api, document.createElement('canvas'))
        try { adapters.push({ api, info: device.info, features: [...device.features] }) } finally { device.destroy() }
      } catch (error) { errors.push(`${api}: ${String(error)}`) }
    }
  } finally { await writeArtifact('environment', { browser: navigator.userAgent, adapters, errors }) }
  if (errors.length) throw new Error(errors.join('\n'))
})
