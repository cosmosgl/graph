import { expect, it } from 'vitest'
import { createCenterMassExperiment } from './view'

it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('runs and displays the scale study from the center experiment', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const experiment = await createCenterMassExperiment(host)
  try {
    const input = host.querySelector<HTMLInputElement>('[data-scale-counts]')!
    input.value = '257'
    host.querySelector<HTMLButtonElement>('[data-scale-run]')!.click()
    await expect.poll(() => host.querySelector('[data-scale-status]')!.textContent, { timeout: 30000 }).toContain('Finished')
    const text = host.querySelector('[data-scale-rows]')!.textContent!
    expect(text).toContain('high-low + linear force')
    expect(text).toContain('WebGL blend')
    expect(text).toContain('Pass (all)')
    expect(host.querySelector<HTMLButtonElement>('[data-scale-export]')!.disabled).toBe(false)
    host.querySelector<HTMLInputElement>('[data-once-count]')!.value = '257'
    host.querySelector<HTMLButtonElement>('[data-once-run]')!.click()
    await expect.poll(() => host.querySelector('[data-once-status]')!.textContent, { timeout: 30000 }).toContain('Finished')
    expect(host.querySelector('[data-once-checks]')!.textContent).toContain('force tolerance passed')
    expect(host.querySelector('[data-once-rows]')!.textContent).toContain('Reduction + force')
    expect(host.querySelector<HTMLButtonElement>('[data-once-export]')!.disabled).toBe(false)
  } finally { experiment.destroy(); host.remove() }
}, 120000)
