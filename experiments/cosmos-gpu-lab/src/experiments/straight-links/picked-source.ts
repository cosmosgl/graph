import { pick, type RgbaSnapshot } from '../../gpu/rgba-readback'
import type { Scene } from './data'

// An opaque link underneath can hide an invisible pick in the composed color buffer.
export async function invisibleSourcePicks (
  image: RgbaSnapshot, scene: Scene, indexOffset: number, renderIsolated: (scene: Scene) => Promise<RgbaSnapshot>
): Promise<number> {
  let invisible = 0
  const pickedPixels = new Map<number, number[]>()
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const picked = pick(image, x, y)
      if (picked === null) continue
      const id = picked - indexOffset
      if (!scene.links[id]) { invisible++; continue }
      let offsets = pickedPixels.get(id)
      if (!offsets) { offsets = []; pickedPixels.set(id, offsets) }
      offsets.push((y * image.width + x) * 4 + 3)
    }
  }
  for (const [id, offsets] of pickedPixels) {
    const isolated = { ...scene, links: scene.links.map((link, i) => i === id ? link : { ...link, width: 0 }) }
    const snapshot = await renderIsolated(isolated)
    for (const offset of offsets) if (snapshot.color[offset] === 0) invisible++
  }
  return invisible
}
