import type { ExperimentInstance } from '../../runtime/experiment'
import { imageProbes, runImageCrossing } from './image-crossing'
import { createPairedPickView } from './paired-pick-view'

const names = { opaque: 'Opaque', translucent: 'Translucent', transparent: 'Transparent' }
const titles = { before: 'Before crossing', during: 'At the crossing', after: 'After crossing' }

function measurement (pick: string, rgb: number[]): string {
  return `${pick} · (${rgb.join(', ')})`
}

export function createImageCrossingView (host: HTMLElement): ExperimentInstance {
  const probes = Object.fromEntries(imageProbes.flatMap(({ key, x, y, alpha }) => [
    [key, key === 'edge' ? `46 CSS px from the center (${x}, ${y})` : `${names[key]} (${alpha}/255) at (${x}, ${y})`],
    [`${key}-control`, `Without point 2 at (${x}, ${y})`],
  ]))
  return createPairedPickView(host, {
    initial: 'during',
    probes,
    caption: 'Click ID and pixel RGB at each location',
    run: async (engine, ratio) => (await runImageCrossing(engine, ratio)).samples.map(sample => ({
      key: sample.phase,
      title: `${titles[sample.phase]} · ${sample.time} ms`,
      pixels: sample.pixels,
      picks: Object.fromEntries(imageProbes.flatMap(({ key }) => {
        const area = sample.areas[key]
        return [[key, measurement(area.pick, area.rgb)], [`${key}-control`, measurement(area.linkOnlyPick, area.linkOnlyRgb)]]
      })),
    })),
  })
}
