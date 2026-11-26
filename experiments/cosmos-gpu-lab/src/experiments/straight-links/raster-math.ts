export type Vec = [number, number]
export function capturedQuad (data: Float32Array | undefined, link: number, width: number, height: number): { clip: Vec[]; screen: Vec[] } {
  if (!data) throw new Error('Vertex capture is required')
  const clip: Vec[] = []
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 2] === link + 1) clip[data[i + 3] - 1] = [data[i], data[i + 1]]
  }
  if (clip.filter(Boolean).length !== 4) throw new Error('Missing captured ribbon corner')
  return { clip, screen: clip.map(([x, y]) => [(x + 1) * width * 0.5, (1 - y) * height * 0.5]) }
}
