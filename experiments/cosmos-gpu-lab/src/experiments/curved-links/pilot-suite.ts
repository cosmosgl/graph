import { pick } from '../../gpu/rgba-readback'
import type { CheckResult } from '../../runtime/live-checks'
import { colorOutsideBudget } from '../straight-links/reference'
import type { Backend, Snapshot } from './backend'
import { DEFAULTS, fixture, type Scene } from './data'
import { reference } from './reference'

export const curveTrials = [
  { id: 'thin', recorded: 'passed', title: 'Thin curve', description: 'A half-CSS-pixel bow remains visible along its span. The padding picks it and a click beyond the target misses.' },
  { id: 'crossing', recorded: 'passed', title: 'Crossing curves', description: 'A click inside both bows selects the top link in either draw order.' },
  { id: 'edges', recorded: 'passed', title: 'Curve edges', description: 'Compare every painted and pickable pixel of the default bows with the CPU and between renderers, with antialiased and hard edges.' },
] as const

export const curveGroups = [{ heading: 'Solid curves with Cosmos padded picking', items: curveTrials }]

function checkThin (image: Snapshot, ref: ReturnType<typeof reference>): void {
  // This bow runs from x=40 to 220. Skip the two caps.
  for (let x = 41; x < 219; x++) {
    let painted = false
    for (let y = 0; y < image.height; y++) {
      const i = (y * image.width + x) * 4 + 3
      const stride = image.width * 4
      if (ref.color[i] && (image.color[i] || image.color[i - stride] || image.color[i + stride])) { painted = true; break }
    }
    if (!painted) throw new Error(`Thin curve missing at x=${x}.`)
  }
  const alpha = image.color[(82 * image.width + 130) * 4 + 3]
  if (alpha || pick(image, 130, 82) !== 0 || pick(image, 130, 84) !== null) {
    throw new Error('Expected an unpainted hit at (130, 82) and background at (130, 84).')
  }
}

// A one-device-pixel step on the sampled grid reaches the four axial neighbors.
// Check both directions so inward shifts and outward shifts have the same limit.
function matchesWithinPixel (values: Int32Array, i: number, expected: number, width: number): boolean {
  return values[i] === expected ||
    (i % width > 0 && values[i - 1] === expected) ||
    (i % width < width - 1 && values[i + 1] === expected) ||
    values[i - width] === expected || values[i + width] === expected
}

function checkEdges (images: Snapshot[], ref: ReturnType<typeof reference>): void {
  const frames = [ref, ...images.map(image => ({
    color: image.color,
    ids: Int32Array.from(ref.ids, (_, i) => pick(image, i % ref.width, Math.floor(i / ref.width)) ?? -1),
  }))]
  const paint = frames.map(frame => Int32Array.from(ref.ids, (_, i) => Number(frame.color[i * 4 + 3] > 0)))
  const ids = frames.map(frame => frame.ids)
  const maskGroups = [paint, ids]
  for (let i = 0; i < ref.ids.length; i++) {
    for (const masks of maskGroups) {
      for (let a = 0; a < frames.length; a++) {
        for (let b = a + 1; b < frames.length; b++) {
          if (masks[a][i] === masks[b][i]) continue
          if (!matchesWithinPixel(masks[a], i, masks[b][i], ref.width) ||
              !matchesWithinPixel(masks[b], i, masks[a][i], ref.width)) {
            throw new Error(`${masks === ids ? 'Pick' : 'Paint'} differs beyond one device pixel at (${i % ref.width}, ${Math.floor(i / ref.width)}).`)
          }
        }
      }
    }
    if (colorOutsideBudget(frames[0].color, frames[1].color, frames[2].color, i * 4) &&
        !matchesWithinPixel(paint[0], i, 1 - paint[0][i], ref.width)) {
      throw new Error(`Color exceeds 2/255 away from the CPU outline at (${i % ref.width}, ${Math.floor(i / ref.width)}).`)
    }
  }
}

export async function runCurveTrial (id: string, gl: Backend, gpu: Backend, signal?: AbortSignal): Promise<CheckResult> {
  try {
    const render = async (scene: Scene, settings = DEFAULTS): Promise<Snapshot[]> => {
      signal?.throwIfAborted()
      const images = []
      for (const backend of [gl, gpu]) images.push(await backend.render(scene, settings, 'production', false))
      return images
    }
    if (id === 'thin') {
      const scene = fixture('bows')
      scene.links = [{ ...scene.links[0], width: 0.5 }]
      const ref = reference(scene, DEFAULTS, 'production')
      for (const image of await render(scene)) checkThin(image, ref)
    } else if (id === 'crossing') {
      const scene: Scene = {
        points: [{ x: 166, y: 200 }, { x: 346, y: 200 }, { x: 216, y: 70 }, { x: 216, y: 250 }],
        links: [{ source: 0, target: 1, width: 8, color: [1, 0, 0, 1] }, { source: 2, target: 3, width: 8, color: [0, 0, 1, 1] }],
      }
      for (const reverse of [false, true]) {
        for (const image of await render(scene, { ...DEFAULTS, reverse })) {
          if (pick(image, 256, 160) !== (reverse ? 0 : 1)) throw new Error(`Wrong link at (256, 160), reverse=${reverse}.`)
        }
      }
    } else if (id === 'edges') {
      const scene = fixture('bows')
      for (const blend of [true, false]) {
        const settings = { ...DEFAULTS, blend }
        checkEdges(await render(scene, settings), reference(scene, settings, 'production'))
      }
    } else throw new Error(`Unknown curve check: ${id}`)
    return { status: 'passed' }
  } catch (error) { return { status: 'failed', detail: error instanceof Error ? error.message : String(error) } }
}
