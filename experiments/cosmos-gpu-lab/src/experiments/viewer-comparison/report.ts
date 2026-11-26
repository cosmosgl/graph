export type Report = { name: string; verdict: 'Pass' | 'Fail' | 'Recorded'; detail: string }
type Row = Record<string, unknown>
export function pixelPass (r: Row): boolean {
  return r.interiorIdFailures === 0 && r.interiorColorFailures === 0 &&
    (r.invisiblePicks ?? r.candidateInvisiblePicks) === 0 && (r.productionInvisiblePicks ?? 0) === 0 &&
    r.finite !== false && r.nonempty !== false
}
export function report (value: unknown): Report {
  const r = value as Row
  const verdict = (pass: boolean): 'Pass' | 'Fail' => pass ? 'Pass' : 'Fail'
  if (r.error) return { name: String(r.action), verdict: 'Fail', detail: String(r.error) }
  if (r.window) {
    return {
      name: `${r.backend} · ${r.window}`,
      verdict: verdict(r.pass === true),
      detail: `p95 ${Number(r.p95).toFixed(1)} ms · ${(Number(r.within33) * 100).toFixed(1)}% within 33 ms`,
    }
  }
  if (r.checkpoint) {
    return {
      name: `${r.backend} · tick ${r.actualTick}`,
      verdict: r.finite === true && r.actualTick === r.checkpoint ? 'Recorded' : 'Fail',
      detail: `Graph-distance stress ${Number(r.stress).toFixed(4)} · finite positions ${r.finite}. Stress alone does not approve quality.`,
    }
  }
  const pixels = (r.pixelAudit ?? r.candidatePixels ?? r) as Row
  const detail = `IDs ${pixels.interiorIdFailures} wrong · colors ${pixels.interiorColorFailures} outside tolerance · ` +
    `invisible picks ${pixels.invisiblePicks ?? pixels.candidateInvisiblePicks} · ${pixels.samples} pixels checked`
  if (r.action === 'updates') {
    const [a, b] = r.attachments as number[][]
    const pass = r.finite === true && r.glSizes === true && r.glColors === true && r.gpuStyles === true &&
      r.glCount === r.gpuCount && a[0] === b[0] && a[1] === b[1] && pixelPass(pixels)
    return {
      name: `${r.scene} · style ${r.style} · ${r.running ? 'running' : 'paused'} update`,
      verdict: verdict(pass),
      detail: `${r.glCount} / ${r.gpuCount} points; canvas ${a.join(' × ')} / ${b.join(' × ')}. ${detail}`,
    }
  }
  if (r.action === 'recreate') {
    return {
      name: 'Destroy and recreate',
      verdict: verdict(r.oldCanvasDetached === true && r.candidateReady === true),
      detail: 'Old production canvas detached; candidate recreated. Resource destruction is also called twice.',
    }
  }
  if (r.action === 'resize') return { name: 'Resize delivery', verdict: 'Recorded', detail: `Settled after ${r.frames} animation opportunities.` }
  const scene = typeof r.scene === 'string' ? ` · ${r.scene}` : ''
  let paint = r.smoothLinks === true ? 'Smoothed links' : 'Same-geometry paint'
  if (r.distanceOpacity === true) paint = 'Corrected link paint'
  const layers = r.colorAttribution as Record<string, { count: number }> | undefined
  return {
    name: r.pixelAudit ? `${r.backend} · CPU pixel audit` : `${paint}${scene} · style ${r.style}`,
    verdict: verdict(pixelPass(pixels)),
    detail: detail + (r.productionInvisiblePicks !== undefined ? ` · production invisible picks ${r.productionInvisiblePicks}` : '') +
      (typeof r.boundaryColorFailures === 'number' ? ` · excluded edge color differences ${r.boundaryColorFailures}` : '') +
      (layers
        ? ` · Failing pixels by layer · points ${layers.points.count} · links ${layers.links.count}` +
          ` · both ${layers.both.count} · composed ${layers.composed.count}`
        : ''),
  }
}
