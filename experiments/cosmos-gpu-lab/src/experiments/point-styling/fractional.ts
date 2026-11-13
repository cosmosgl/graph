import { pick, type Snapshot, type RenderVariant } from './backend'
import { center, diameter, resolvePoint, type Point, type Settings } from './data'
import { COLOR_BUDGET, compareSnapshots, referencePick } from './reference'

type Captured = { coord: number[]; diameter: number; distance: number; coverage: number }
export type FractionalPixel = {
  x: number; y: number; point: number; reason: string;
  ids: { webgl: number | null; webgpu: number | null; cpu: number | null; cpuWebGPU: number | null };
  color: { webgl: number[]; webgpu: number[] };
  cpu: { coord: number[]; diameter: number; distance: number };
  webgl: Captured | null; webgpu: Captured | null;
}
export type FractionalInvestigation = {
  points: Array<{ id: number; diameter: number; idDifferences: number; glMask: number; gpuMask: number; colorFailures: number; maxColor: number;
    webglRaster: number[] | null; webgpuRaster: number[] | null; }>;
  samples: FractionalPixel[];
}

// These observations supplement the existing gates. They do not change the
// double-precision scalar mask, exclude contour pixels or alter COLOR_BUDGET.
export function investigateFractional (gl: Snapshot, gpu: Snapshot, points: Point[], settings: Settings): FractionalInvestigation {
  const raster = (snapshot: Snapshot, p: Point): number[] | null => {
    if (!snapshot.probe) return null
    const [cx, cy] = center(p, settings); const x = Math.floor(cx); const y = Math.floor(cy)
    if (x < 0 || y < 0 || x + 1 >= snapshot.width || y + 1 >= snapshot.height) return null
    const at = (dx: number, dy: number, c: number): number => snapshot.probe!.geometry[((y + dy) * snapshot.width + x + dx) * 4 + c]
    if (at(0, 0, 2) <= 3 || at(1, 0, 2) === 0 || at(0, 1, 2) === 0) return null
    const sx = at(1, 0, 0) - at(0, 0, 0); const sy = at(0, 1, 1) - at(0, 0, 1)
    return [2 / sx, 2 / sy, x + 0.5 - at(0, 0, 0) / sx, y + 0.5 - at(0, 0, 1) / sy]
  }
  const rows = points.map((p, id) => ({
    id,
    diameter: diameter(p, settings),
    idDifferences: 0,
    glMask: 0,
    gpuMask: 0,
    colorFailures: 0,
    maxColor: 0,
    webglRaster: raster(gl, p),
    webgpuRaster: raster(gpu, p),
  }))
  const selected = new Map<string, { x: number; y: number; id: number; reasons: Set<string> }>()
  const first = new Set<string>(); const maximum = new Map<number, { x: number; y: number; delta: number }>()
  const remember = (x: number, y: number, id: number, reason: string): void => {
    const key = `${x},${y}`; const row = selected.get(key) ?? { x, y, id, reasons: new Set<string>() }
    row.reasons.add(reason); selected.set(key, row)
  }
  const centers = points.map(p => center(p, settings))
  for (let y = 0; y < gl.height; y++) {
    for (let x = 0; x < gl.width; x++) {
      const a = pick(gl, x, y); const b = pick(gpu, x, y)
      const cpu = referencePick(points, settings, x + 0.5, y + 0.5, gl.pickingRule)
      const cpuGpu = referencePick(points, settings, x + 0.5, y + 0.5, gpu.pickingRule)
      const offset = (y * gl.width + x) * 4
      let delta = 0
      for (let c = 0; c < 4; c++) delta = Math.max(delta, Math.abs(gl.color[offset + c] - gpu.color[offset + c]))
      if (a === b && a === cpu && b === cpuGpu && delta === 0) continue
      // Fractional fixtures contain isolated circles. Attribute a rejected pixel
      // to the nearest center, including fringe pixels where all IDs are empty.
      let id = 0; let nearest = Infinity
      centers.forEach(([cx, cy], i) => { const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); if (d < nearest) { nearest = d; id = i } })
      const row = rows[id]
      const differences = [['ID', a !== b], ['WebGL mask', a !== cpu], ['WebGPU mask', b !== cpuGpu]] as const
      for (const [reason, failed] of differences) {
        if (failed) {
          if (reason === 'ID') row.idDifferences++
          else if (reason === 'WebGL mask') row.glMask++
          else row.gpuMask++
          const key = `${id}:${reason}`
          if (!first.has(key)) { first.add(key); remember(x, y, id, reason) }
        }
      }
      if (delta > COLOR_BUDGET) row.colorFailures++
      row.maxColor = Math.max(row.maxColor, delta)
      if (delta > COLOR_BUDGET && delta > (maximum.get(id)?.delta ?? 0)) maximum.set(id, { x, y, delta })
    }
  }
  for (const [id, pixel] of maximum) remember(pixel.x, pixel.y, id, 'Largest color error')
  const captured = (snapshot: Snapshot, offset: number): Captured | null => {
    const probe = snapshot.probe
    if (!probe || probe.geometry[offset + 2] === 0) return null
    return {
      coord: Array.from(probe.edge.subarray(offset, offset + 2)),
      diameter: probe.geometry[offset + 2],
      distance: probe.edge[offset + 2],
      coverage: probe.edge[offset + 3],
    }
  }
  return {
    points: rows,
    samples: Array.from(selected.values(), ({ x, y, id, reasons }) => {
      const p = resolvePoint(points[id], settings); const d = Math.max(1, diameter(p, settings)); const [cx, cy] = centers[id]
      const coord = [(x + 0.5 - cx) * 2 / d, (y + 0.5 - cy) * 2 / d]
      const offset = (y * gl.width + x) * 4
      return {
        x,
        y,
        point: id,
        reason: [...reasons].join(', '),
        ids: {
          webgl: pick(gl, x, y),
          webgpu: pick(gpu, x, y),
          cpu: referencePick(points, settings, x + 0.5, y + 0.5, gl.pickingRule),
          cpuWebGPU: referencePick(points, settings, x + 0.5, y + 0.5, gpu.pickingRule),
        },
        color: { webgl: Array.from(gl.color.subarray(offset, offset + 4)), webgpu: Array.from(gpu.color.subarray(offset, offset + 4)) },
        cpu: { coord, diameter: d, distance: Math.hypot(...coord) * d * 0.5 - d * 0.5 },
        webgl: captured(gl, offset),
        webgpu: captured(gpu, offset),
      }
    }),
  }
}

export function renderFractionalInvestigation (
  host: HTMLElement, investigation: FractionalInvestigation, gl: Snapshot, gpu: Snapshot, points: Point[], settings: Settings,
  control?: ReturnType<typeof compareSnapshots>, variant: RenderVariant = 'production'
): void {
  const section = document.createElement('section'); section.className = 'fractional-investigation'
  const number = (value: number): string => value === 0 ? '0' : Math.abs(value) < 0.001 ? value.toExponential(3) : value.toFixed(6)
  const ids = (value: number | null): string => value === null ? '—' : String(value)
  const field = (value: Captured | null): string => value ? `${number(value.distance)} / ${number(value.coverage)}` : 'No fragment'
  section.innerHTML = `<h3>Fractional pixel investigation</h3>
    <p>Float-target probes capture the selected renderer’s coordinates, diameter, edge distance and coverage.
      ${variant !== 'production'
    ? `The main verdict checks candidate geometry with the declared ${gl.pickingRule} CPU rule.`
    : 'The analytical-coordinate control replaces only gl_PointCoord in a shader copy; the main verdict still uses the production shader.'}</p>
    ${control
    ? `<h4>Coordinate control</h4><table><thead><tr><th>Diagnostic comparison</th><th>ID differences</th>
      <th>CPU mask differences · GL / GPU</th><th>Color failures</th><th>Maximum channel error</th><th>Result</th></tr></thead>
      <tbody><tr><td>Analytical-coordinate WebGL ↔ WebGPU</td><td>${control.idDisagreements}</td>
      <td>${control.webglReferenceFailures} / ${control.webgpuReferenceFailures}</td><td>${control.colorFailures}</td>
      <td>${control.maxChannelError}/255</td><td>${control.valid ? 'Pass' : 'Fail'}</td></tr></tbody></table>`
    : ''}
    <h4>Which circles differ?</h4><p>Diameters and fitted coordinate spans are in device pixels.
      The span is inferred from neighboring captured coordinates; it is an observation of this run, not a hardware limit.</p>
    <table><thead><tr><th>Point</th><th>Requested diameter</th><th>WebGL fitted span · x / y</th>
      <th>WebGPU fitted span · x / y</th><th>ID differences</th><th>CPU mask differences · GL / GPU</th><th>Color failures · max</th></tr></thead>
      <tbody>${investigation.points.map(row => `<tr><td>${row.id}</td><td>${row.diameter}</td>
        <td>${row.webglRaster ? row.webglRaster.slice(0, 2).map(number).join(' / ') : 'Not fitted'}</td>
        <td>${row.webgpuRaster ? row.webgpuRaster.slice(0, 2).map(number).join(' / ') : 'Not fitted'}</td>
        <td>${row.idDifferences}</td><td>${row.glMask} / ${row.gpuMask}</td>
        <td>${row.colorFailures} · ${row.maxColor}/255</td></tr>`).join('')}</tbody></table>
    <h4>Representative rejected pixels</h4><p>First ID/mask rejection and largest color error per circle. Negative distance means inside.
      Picking requires coverage ≥ 0.5. “No fragment” means the rasterized sprite did not reach that pixel.</p>
    ${investigation.samples.length ? '' : '<p>No rejected pixels in this candidate comparison.</p>'}
    <div data-mask-previews></div>
    <table data-rejected-pixels><thead><tr><th>Pixel · point</th><th>Reason</th><th>IDs · GL / GPU / CPU GL / CPU GPU</th><th>CPU distance · px</th>
      <th>WebGL distance / coverage</th><th>WebGPU distance / coverage</th><th>RGBA · GL / GPU</th></tr></thead>
      <tbody>${investigation.samples.map(row => `<tr><td>(${row.x}, ${row.y}) · ${row.point}</td><td>${row.reason}</td>
        <td>${ids(row.ids.webgl)} / ${ids(row.ids.webgpu)} / ${ids(row.ids.cpu)} / ${ids(row.ids.cpuWebGPU)}</td><td>${number(row.cpu.distance)}</td>
        <td>${field(row.webgl)}</td><td>${field(row.webgpu)}</td>
        <td>${row.color.webgl.join(', ')} / ${row.color.webgpu.join(', ')}</td></tr>`).join('')}</tbody></table>
    <p>Export JSON includes the fitted coordinate fields, representative raw float values and the complete control verdict.
      Float probes and the extra control draws are diagnostics, not runtime performance measurements.</p>`
  const sample = investigation.samples[0]
  if (!sample) section.querySelector('[data-rejected-pixels]')!.remove()
  if (sample) {
    const previews = section.querySelector<HTMLElement>('[data-mask-previews]')!
    previews.className = 'fractional-mask-previews'
    for (const [title, snapshot] of [[variant !== 'production' ? `${variant} WebGL` : 'Production WebGL', gl],
      [variant !== 'production' ? `${variant} WebGPU` : 'luma WebGPU', gpu], ['CPU mask', null]] as const) {
      const figure = document.createElement('figure'); const caption = document.createElement('figcaption'); caption.textContent = title
      const canvas = document.createElement('canvas'); const cells = 9; const scale = 16
      canvas.width = canvas.height = cells * scale
      canvas.setAttribute('aria-label', `${title}: 9 by 9 picking pixels centered at (${sample.x}, ${sample.y})`)
      const ctx = canvas.getContext('2d')!
      for (let y = 0; y < cells; y++) {
        for (let x = 0; x < cells; x++) {
          const px = sample.x + x - 4; const py = sample.y + y - 4
          const selected = px < 0 || py < 0 || px >= gl.width || py >= gl.height
            ? null
            : snapshot ? pick(snapshot, px, py) : referencePick(points, settings, px + 0.5, py + 0.5, gl.pickingRule)
          ctx.fillStyle = selected === null ? '#202329' : '#aac7e8'; ctx.fillRect(x * scale, y * scale, scale - 1, scale - 1)
        }
      }
      ctx.strokeStyle = '#f4d889'; ctx.lineWidth = 2; ctx.strokeRect(4 * scale, 4 * scale, scale - 1, scale - 1)
      figure.append(caption, canvas); previews.append(figure)
    }
    const caption = document.createElement('p')
    caption.textContent = `Around (${sample.x}, ${sample.y}): one square per framebuffer pixel. Blue = picked; yellow outline = sample.`
    previews.after(caption)
  }
  host.append(section)
}
