import { pick } from '../../gpu/rgba-readback'
import type { CheckResult, LiveCheckItem } from '../../runtime/live-checks'
import type { Backend } from './backend'
import { DEFAULTS, type Scene } from './data'
import { checkRibbon } from './ribbon-check'

async function thinStroke (backend: Backend, signal?: AbortSignal): Promise<string | undefined> {
  const y = 120.25
  const scene: Scene = {
    points: [{ x: 64, y }, { x: 448, y }],
    links: [{ source: 0, target: 1, width: 0.5, color: [1, 1, 1, 1] }],
  }
  for (const ratio of [1, 2]) {
    signal?.throwIfAborted()
    const image = await backend.render(scene, { ...DEFAULTS, ratio }, 'visible', false)
    const centerRow = Math.floor(y * ratio)
    // Exclude the caps and allow a one-device-pixel shift across the stroke.
    for (let x = 65 * ratio; x < 447 * ratio; x++) {
      const paints = [centerRow - 1, centerRow, centerRow + 1].some(row => image.color[(row * image.width + x) * 4 + 3] > 0)
      if (!paints) return `No stroke at device x=${x} with pixel ratio ${ratio}.`
    }
  }
  return undefined
}

async function crossing (backend: Backend, signal?: AbortSignal): Promise<string | undefined> {
  const points = [{ x: 64, y: 160 }, { x: 448, y: 160 }, { x: 256, y: 64 }, { x: 256, y: 256 }]
  for (const alpha of [1, 1 / 65536, 0]) {
    signal?.throwIfAborted()
    const scene: Scene = {
      points,
      links: [
        { source: 0, target: 1, width: 8, color: [0, 0, 1, 1] },
        { source: 2, target: 3, width: 8, color: [1, 0, 0, alpha] },
      ],
    }
    const image = await backend.render(scene, DEFAULTS, 'visible', false)
    const offset = (160 * image.width + 256) * 4
    const expected = alpha === 1 ? [255, 0, 0, 255] : [0, 0, 255, 255]
    const color = image.color.subarray(offset, offset + 4)
    if (expected.some((v, i) => Math.abs(v - color[i]) > 2)) {
      return `At foreground opacity ${alpha}, expected RGBA ${expected.join(', ')}, got ${color.join(', ')}.`
    }
    const expectedId = alpha === 1 ? 1 : 0
    const id = pick(image, 256, 160)
    if (id !== expectedId) return `At foreground opacity ${alpha}, expected link ${expectedId}, picked ${id ?? 'nothing'}.`
  }
  return undefined
}

async function hiddenLinks (backend: Backend): Promise<string | undefined> {
  const scene: Scene = {
    points: [
      { x: 64, y: 64 }, { x: 448, y: 64 },
      { x: 64, y: 160, absent: true }, { x: 448, y: 160 },
      { x: 64, y: 240 }, { x: 448, y: 240, absent: true },
    ],
    links: [
      { source: 0, target: 1, width: 0, color: [1, 1, 1, 1] },
      { source: 2, target: 3, width: 8, color: [1, 1, 1, 1] },
      { source: 4, target: 5, width: 8, color: [1, 1, 1, 1] },
    ],
  }
  const image = await backend.render(scene, DEFAULTS, 'visible', false)
  if (image.color.some(byte => byte !== 0)) return 'A hidden link painted a pixel.'
  if (image.ids.some(byte => byte !== 0)) return 'A hidden link left a picking ID.'
  return undefined
}

async function cappedWidth (backend: Backend): Promise<string | undefined> {
  const scene: Scene = {
    points: [{ x: 64, y: 160 }, { x: 448, y: 160 }],
    links: [{ source: 0, target: 1, width: 40, color: [1, 1, 1, 1] }],
  }
  // Integer-aligned edges put pixel centers strictly inside or outside the cap.
  const image = await backend.render(scene, { ...DEFAULTS, maxWidth: 8, blend: false }, 'visible', false)
  for (let y = 0; y < image.height; y++) {
    const inside = y >= 156 && y < 164
    const alpha = image.color[(y * image.width + 256) * 4 + 3]
    if (alpha !== (inside ? 255 : 0) || pick(image, 256, y) !== (inside ? 0 : null)) {
      return `The drawn or picked width disagrees with the 8 px cap at (256, ${y}).`
    }
  }
  return undefined
}

async function pickingPolicy (backend: Backend, signal?: AbortSignal): Promise<string | undefined> {
  const scene: Scene = {
    points: [{ x: 64, y: 160 }, { x: 448, y: 160 }],
    links: [{ source: 0, target: 1, width: 4, color: [0.8, 0.4, 0.2, 0.6] }],
  }
  const visible = await backend.render(scene, DEFAULTS, 'visible', false)
  signal?.throwIfAborted()
  const padded = await backend.render(scene, DEFAULTS, 'production', false)
  if (pick(visible, 256, 163) !== null || pick(padded, 256, 163) !== 0) return 'The padded pick did not extend beyond the visible stroke.'
  if (!visible.color.every((byte, i) => byte === padded.color[i])) return 'Switching the picking rule changed the drawn color.'
  return undefined
}

type Trial = LiveCheckItem & { check: (gl: Backend, gpu: Backend, signal?: AbortSignal) => Promise<CheckResult> }

function perRenderer (check: (backend: Backend, signal?: AbortSignal) => Promise<string | undefined>): Trial['check'] {
  return async (gl, gpu, signal) => {
    for (const [name, backend] of [['WebGL', gl], ['WebGPU', gpu]] as const) {
      signal?.throwIfAborted()
      const failure = await check(backend, signal)
      if (failure) return { status: 'failed', detail: `${name}: ${failure}` }
    }
    return { status: 'passed' }
  }
}

function trial (id: string, title: string, description: string, check: Trial['check']): Trial {
  return { id, title, description, recorded: 'passed', check }
}

export const linkGroups = [{
  heading: 'Do solid links draw and pick the same pixels?',
  items: [
    trial('blended', 'Antialiased edges', 'Compare a translucent diagonal and its ends against the expected colors and link ID.',
      (gl, gpu, signal) => checkRibbon(gl, gpu, true, signal)),
    trial('hard', 'Hard edges', 'Check the same diagonal with smoothing off, including pixels exactly on its ends.',
      (gl, gpu, signal) => checkRibbon(gl, gpu, false, signal)),
  ],
}, {
  heading: 'Which link widths stay visible?',
  items: [
    trial('thin-stroke', 'Half-pixel stroke', 'A 0.5 CSS pixel link paints along its length at pixel ratios 1 and 2.', perRenderer(thinStroke)),
    trial('hidden', 'Hidden links', 'A zero-width link and links missing either endpoint leave every pixel clear and unpickable.', perRenderer(hiddenLinks)),
    trial('width-cap', 'Maximum width', 'A 40 px link capped at 8 px draws and picks the middle eight rows.', perRenderer(cappedWidth)),
  ],
}, {
  heading: 'Does picking follow the visible link?',
  items: [
    trial('crossing', 'Foreground opacity', 'At a crossing, the underlying link wins when the foreground opacity is zero or rounds to zero.',
      perRenderer(crossing)),
    trial('picking-policy', 'Cosmos padding', 'Switching to padded picking expands the hit area and preserves every drawn color.', perRenderer(pickingPolicy)),
  ],
}]

export async function runLinkTrial (id: string, gl: Backend, gpu: Backend, signal?: AbortSignal): Promise<CheckResult> {
  const item = linkGroups.flatMap(group => group.items).find(item => item.id === id)
  if (!item) throw new Error(`Unknown link check: ${id}`)
  return item.check(gl, gpu, signal)
}
