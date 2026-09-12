// Regenerates the SVG diagrams for this folder. Run from here:
//   node gen-diagrams.mjs
// The grid panels bin points with the SAME rules as the shaders — build-grid.vert's
// cell = floor((p + offset · cell) / cell), clamped to the grid; force-collision-
// spatial.frag's 3×3 scan, own-cell self-subtraction and cell averages — so what a
// panel labels "seen" or "masked" is computed, not drawn by hand, and the script
// asserts the story each panel tells. Keep the constants in sync with
// src/modules/ForceCollision/index.ts and the two shaders, then re-run so the
// diagrams don't fossilize. Same visual language as docs/many-body-force/*.svg.
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = dirname(fileURLToPath(import.meta.url))

const FONT = 'ui-sans-serif, system-ui, -apple-system, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const C = {
  text: '#1e293b', sub: '#64748b', gridLine: '#cbd5e1', frame: '#94a3b8', panel: '#fafbfd',
  blue: '#3a86ff', blueSoft: '#d7e6ff',
  teal: '#2a9d8f', tealSoft: '#d3ece9',
  amber: '#e9a13b', amberSoft: '#fae8cd',
  red: '#e05555', redSoft: '#fbdada',
  point: '#0f172a', accent: '#7c3aed', accentSoft: '#ede4ff',
  disc: '#e8eef7', discStroke: '#8b9dc0',
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const txt = (x, y, s, { size = 13, fill = C.text, anchor = 'start', weight = 'normal', font = FONT } = {}) =>
  `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${esc(s)}</text>`
const mono = (x, y, s, opts = {}) => txt(x, y, s, { ...opts, font: MONO })
const f1 = (v) => Number(v).toFixed(1)

const svgDoc = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
  <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/>
  </marker>
</defs>
<rect width="${w}" height="${h}" fill="#ffffff"/>
${body}
</svg>`

const arrow = (x1, y1, x2, y2, stroke, width = 2, dash = '') =>
  `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${stroke}" stroke-width="${width}" marker-end="url(#arr)" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`

const assert = (cond, msg) => { if (!cond) throw new Error(`diagram assertion failed: ${msg}`) }

// ------------------------------------------------------------- shader mirror
// A point is { p: [x, y], r: effectiveRadius }. Sizes are 2·r and padding is 0,
// so the shader's "avgSize * 0.5 + padding" is simply the mean radius.
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)

// build-grid.vert: floor((p + offset · cell) / cell), clamped to the grid.
const binCell = (p, cell, offset, gridSize) => [
  clamp(Math.floor((p[0] + offset[0] * cell) / cell), 0, gridSize - 1),
  clamp(Math.floor((p[1] + offset[1] * cell) / cell), 0, gridSize - 1),
]

// The additive-blend accumulation: per cell [Σx, Σy, Σsize, count].
const buildGrid = (points, cell, offset, gridSize) => {
  const grid = new Map()
  points.forEach((pt, i) => {
    const key = binCell(pt.p, cell, offset, gridSize).join(',')
    const acc = grid.get(key) ?? { sx: 0, sy: 0, ssize: 0, count: 0, members: [] }
    acc.sx += pt.p[0]; acc.sy += pt.p[1]; acc.ssize += 2 * pt.r; acc.count += 1; acc.members.push(i)
    grid.set(key, acc)
  })
  return grid
}

// force-collision-spatial.frag for one point: the 3×3 scan with self-subtraction.
// Returns one record per non-empty neighbouring cell (after removing self).
const resolve = (focusIdx, points, cell, offset, gridSize) => {
  const grid = buildGrid(points, cell, offset, gridSize)
  const me = points[focusIdx]
  const [cx, cy] = binCell(me.p, cell, offset, gridSize)
  const out = []
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const nx = cx + dx; const ny = cy + dy
      if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue
      const acc = grid.get(`${nx},${ny}`)
      if (!acc) continue
      let { sx, sy, ssize, count } = acc
      if (dx === 0 && dy === 0) { count -= 1; sx -= me.p[0]; sy -= me.p[1]; ssize -= 2 * me.r }
      if (count < 0.5) continue
      const avg = [sx / count, sy / count]
      const avgR = (ssize / count) * 0.5
      const dist = Math.hypot(me.p[0] - avg[0], me.p[1] - avg[1])
      const combined = me.r + avgR
      out.push({ cell: [nx, ny], avg, avgR, count, dist, combined, seen: dist < combined && dist > 0.001 })
    }
  }
  return { ownCell: [cx, cy], cells: out }
}

const overlaps = (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) < a.r + b.r

// Draw a grid of `g` cells of `cell` px at (ox, oy); `shade(i, j)` returns a fill.
const gridRects = (ox, oy, g, cell, shade) => {
  let s = ''
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      s += `<rect x="${f1(ox + i * cell)}" y="${f1(oy + j * cell)}" width="${f1(cell)}" height="${f1(cell)}" fill="${shade(i, j)}" stroke="${C.gridLine}" stroke-width="0.7"/>`
    }
  }
  return s
}

const disc = (x, y, r, { fill = C.disc, stroke = C.discStroke, width = 1.5 } = {}) =>
  `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`

// ---------------------------------------------------------------- Diagram A
// Why the cell must span the whole contact range (2R): the 3×3 scan reaches one
// cell of separation, and a touching pair is 2R apart. Left: today's rule. Right:
// the pre-2026-08-04 rule (cell = R), where an overlapping neighbour can sit two
// cells away and is never compared.
{
  const W = 980; const H = 600
  const S = 336 // panel side in px = the space each panel shows
  const R = 24 // the largest effective radius in the scene
  // Scene: the focus point and its neighbours (panel-local px). rF = R.
  const F = { p: [160.8, 172.8], r: R }
  const N = { p: [F.p[0] + 36, F.p[1] - 17.5], r: 20 } // overlapping: dist ≈ 40 < 44
  const others = [
    { p: [62, 70], r: 16 }, { p: [266, 72], r: 22 }, { p: [96, 262], r: 18 },
    { p: [246, 250], r: 14 }, { p: [292, 176], r: 20 }, { p: [212, 296], r: 17 },
    { p: [60, 176], r: 15 }, { p: [178, 62], r: 18 },
  ]
  const points = [F, N, ...others]
  assert(overlaps(F, N), 'N should overlap F')
  assert(others.every((o) => !overlaps(F, o)), 'only N should overlap F')

  const panel = (ox, title, subtitle, cell, kind) => {
    const g = Math.round(S / cell)
    const oy = 100
    const res = resolve(0, points, cell, [0, 0], g)
    const [cx, cy] = res.ownCell
    const nCell = binCell(N.p, cell, [0, 0], g)
    const nInBlock = Math.abs(nCell[0] - cx) <= 1 && Math.abs(nCell[1] - cy) <= 1
    if (kind === 'today') assert(nInBlock, 'with cell = 2R the overlapping neighbour must be inside the 3×3 block')
    else assert(!nInBlock, 'with cell = R the overlapping neighbour must fall outside the 3×3 block')

    let s = txt(ox, 40, title, { size: 16, weight: '600' })
    subtitle.forEach((line, i) => { s += txt(ox, 60 + i * 16, line, { size: 12.5, fill: C.sub }) })
    s += gridRects(ox, oy, g, cell, (i, j) => (Math.abs(i - cx) <= 1 && Math.abs(j - cy) <= 1 ? C.blueSoft : '#ffffff'))
    // the discs
    for (const o of others) s += disc(ox + o.p[0], oy + o.p[1], o.r)
    s += disc(ox + N.p[0], oy + N.p[1], N.r, kind === 'today' ? { fill: C.tealSoft, stroke: C.teal, width: 2 } : { fill: C.redSoft, stroke: C.red, width: 2 })
    s += disc(ox + F.p[0], oy + F.p[1], F.r, { fill: '#ffffff', stroke: C.point, width: 2 })
    s += `<circle cx="${f1(ox + F.p[0])}" cy="${f1(oy + F.p[1])}" r="3" fill="${C.point}"/>`
    // contact range: a neighbour of the largest radius touches at 2R
    s += `<circle cx="${f1(ox + F.p[0])}" cy="${f1(oy + F.p[1])}" r="${2 * R}" fill="none" stroke="${C.accent}" stroke-width="1.8" stroke-dasharray="5 4"/>`
    // cell averages the scan actually compares against
    for (const c of res.cells) {
      const x = ox + c.avg[0]; const y = oy + c.avg[1]
      s += `<line x1="${f1(x - 5)}" y1="${f1(y - 5)}" x2="${f1(x + 5)}" y2="${f1(y + 5)}" stroke="${C.blue}" stroke-width="2"/>`
      s += `<line x1="${f1(x - 5)}" y1="${f1(y + 5)}" x2="${f1(x + 5)}" y2="${f1(y - 5)}" stroke="${C.blue}" stroke-width="2"/>`
    }
    s += `<rect x="${ox}" y="${oy}" width="${S}" height="${S}" fill="none" stroke="${C.frame}" stroke-width="1.4"/>`
    // labels
    s += txt(ox + F.p[0] - 2 * R * 0.71 - 6, oy + F.p[1] + 2 * R * 0.71 + 14, '2R', { size: 12, fill: C.accent, weight: '600', anchor: 'end' })
    const lx = ox + N.p[0]; const ly0 = oy + N.p[1] - N.r - 30
    if (kind === 'today') {
      s += txt(lx, ly0, 'overlapping neighbour:', { size: 11.5, fill: C.teal, anchor: 'middle' })
      s += txt(lx, ly0 + 14, 'inside the 3×3 — compared', { size: 11.5, fill: C.teal, anchor: 'middle' })
    } else {
      s += txt(lx, ly0, 'overlapping neighbour:', { size: 11.5, fill: C.red, anchor: 'middle' })
      s += txt(lx, ly0 + 14, 'two cells away — never compared', { size: 11.5, fill: C.red, anchor: 'middle' })
    }
    // legend
    const ly = oy + S + 22
    s += `<rect x="${ox}" y="${ly - 11}" width="14" height="14" fill="${C.blueSoft}" stroke="${C.gridLine}"/>`
    s += txt(ox + 20, ly, `3×3 neighbourhood the shader scans (${g} × ${g} grid)`, { size: 12 })
    s += `<line x1="${ox + 2}" y1="${ly + 17}" x2="${ox + 12}" y2="${ly + 27}" stroke="${C.blue}" stroke-width="2"/>`
    s += `<line x1="${ox + 2}" y1="${ly + 27}" x2="${ox + 12}" y2="${ly + 17}" stroke="${C.blue}" stroke-width="2"/>`
    s += txt(ox + 20, ly + 26, 'cell average the point is compared against', { size: 12 })
    s += `<circle cx="${ox + 7}" cy="${ly + 44}" r="6" fill="none" stroke="${C.accent}" stroke-width="1.5" stroke-dasharray="3 2"/>`
    s += txt(ox + 20, ly + 48, 'contact range — 2R, where two points of radius R touch', { size: 12 })
    return s
  }

  let b = ''
  b += panel(20, 'Today: cell = 2R — the scan covers the range',
    ['cell = max(2 · effectiveRadius, 8): the 3×3 block reaches one', 'cell out, and one cell is the whole contact range'], 2 * R, 'today')
  b += panel(20 + S + 264, 'Before 2026-08-04: cell = R',
    ['a touching pair could sit two cells apart — outside', 'the 3×3 — and no offset pass extends the reach'], R, 'before')
  // A middle strip with the formula
  const mx = 20 + S + 28
  b += `<rect x="${mx}" y="150" width="208" height="176" rx="8" fill="${C.accentSoft}" stroke="${C.accent}"/>`
  b += mono(mx + 12, 178, 'R = radius + padding', { size: 12 })
  b += mono(mx + 12, 198, '  radius = size/2', { size: 11.5, fill: C.sub })
  b += mono(mx + 12, 214, '  or the fixed radius', { size: 11.5, fill: C.sub })
  b += mono(mx + 12, 244, 'cell = max(2R, 8)', { size: 12, weight: '600', fill: C.accent })
  b += mono(mx + 12, 268, 'grid = min(512,', { size: 12 })
  b += mono(mx + 12, 284, '  max(1, ⌊space/cell⌋))', { size: 12 })
  b += mono(mx + 12, 308, 'cell = space / grid', { size: 12 })
  b += txt(mx + 104, 346, 'floor, not ceil: fitting', { size: 11.5, fill: C.sub, anchor: 'middle' })
  b += txt(mx + 104, 362, 'may only grow the cell', { size: 11.5, fill: C.sub, anchor: 'middle' })
  b += txt(W / 2, H - 34, 'A point inside the middle cell reaches at most one cell in any direction within 2R, so a cell that spans the contact range', { size: 12.5, fill: C.sub, anchor: 'middle' })
  b += txt(W / 2, H - 16, 'makes the 3×3 scan exhaustive: no touching pair is left uncompared.', { size: 12.5, fill: C.sub, anchor: 'middle' })
  await writeFile(join(OUT, 'a-contact-range.svg'), svgDoc(W, H, b))
}

// ---------------------------------------------------------------- Diagram B
// The four half-cell-offset grids. A pair split by a cell boundary is only seen
// through its neighbour cell's AVERAGE, which a third point can drag out of range;
// a shifted partition lets the pair share a cell, where the own-cell average (after
// self-subtraction) is the neighbour itself. Every "seen"/"masked" label is computed
// with the shader's own rules.
{
  const W = 980; const H = 470
  const S = 200; const cell = 40; const g = S / cell; const R = 20
  const A = { p: [72, 90], r: R }
  const B = { p: [98, 90], r: R }
  const Cc = { p: [119, 114], r: R }
  const D = { p: [117, 119], r: R }
  const points = [A, B, Cc, D]
  assert(overlaps(A, B), 'A and B should overlap')
  assert(!overlaps(A, Cc) && !overlaps(A, D), 'C and D must not overlap A')
  const OFFSETS = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]]
  const results = OFFSETS.map((offset) => {
    const res = resolve(0, points, cell, offset, g)
    const bCell = binCell(B.p, cell, offset, g).join(',')
    const rec = res.cells.find((c) => c.cell.join(',') === bCell)
    return { offset, res, rec }
  })
  assert(results[0].rec && !results[0].rec.seen, 'the unshifted grid must mask the A–B overlap')
  assert(results.slice(1).every((r) => r.rec && r.rec.seen), 'every shifted grid must see the A–B overlap')

  let b = ''
  b += txt(20, 34, 'Four half-cell offsets: a boundary-split pair is masked by one partition and seen by the others', { size: 16, weight: '600' })
  b += txt(20, 54, 'Same four points every panel. The force pass runs once per grid, each contributing ¼ of the push.', { size: 12.5, fill: C.sub })
  results.forEach(({ offset, res, rec }, k) => {
    const ox = 20 + k * 240; const oy = 84
    b += mono(ox, oy - 10, `gridOffset = [${offset[0]}, ${offset[1]}]`, { size: 12, fill: C.sub })
    b += `<rect x="${ox}" y="${oy}" width="${S}" height="${S}" fill="#ffffff" stroke="${C.frame}" stroke-width="1.2"/>`
    // own cell of A (shaded) — drawn in the offset frame: cell i spans [(i − off)·cell, (i + 1 − off)·cell)
    const [ax, ay] = res.ownCell
    const rx = (ax - offset[0]) * cell; const ry = (ay - offset[1]) * cell
    b += `<rect x="${f1(ox + Math.max(rx, 0))}" y="${f1(oy + Math.max(ry, 0))}" width="${f1(Math.min(rx + cell, S) - Math.max(rx, 0))}" height="${f1(Math.min(ry + cell, S) - Math.max(ry, 0))}" fill="${C.blueSoft}"/>`
    // grid lines at x = (i − off) · cell
    for (let i = 0; i <= g; i++) {
      const x = ox + (i - offset[0]) * cell; const y = oy + (i - offset[1]) * cell
      if (x >= ox && x <= ox + S) b += `<line x1="${f1(x)}" y1="${oy}" x2="${f1(x)}" y2="${oy + S}" stroke="${C.gridLine}" stroke-width="0.9"/>`
      if (y >= oy && y <= oy + S) b += `<line x1="${ox}" y1="${f1(y)}" x2="${ox + S}" y2="${f1(y)}" stroke="${C.gridLine}" stroke-width="0.9"/>`
    }
    b += disc(ox + Cc.p[0], oy + Cc.p[1], Cc.r)
    b += disc(ox + D.p[0], oy + D.p[1], D.r)
    b += disc(ox + B.p[0], oy + B.p[1], B.r, { fill: C.tealSoft, stroke: C.teal, width: 1.8 })
    b += disc(ox + A.p[0], oy + A.p[1], A.r, { fill: '#ffffff', stroke: C.point, width: 2 })
    b += txt(ox + A.p[0], oy + A.p[1] + 4, 'A', { size: 12, weight: '600', anchor: 'middle' })
    b += txt(ox + B.p[0], oy + B.p[1] + 4, 'B', { size: 12, weight: '600', anchor: 'middle', fill: C.teal })
    b += txt(ox + Cc.p[0] + 2, oy + Cc.p[1] - 22, 'C', { size: 11, fill: C.sub, anchor: 'middle' })
    b += txt(ox + D.p[0] - 22, oy + D.p[1] + 10, 'D', { size: 11, fill: C.sub, anchor: 'middle' })
    // the average A is compared against, for the cell holding B
    const [mxp, myp] = rec.avg
    const color = rec.seen ? C.teal : C.red
    b += `<line x1="${f1(ox + mxp - 5)}" y1="${f1(oy + myp - 5)}" x2="${f1(ox + mxp + 5)}" y2="${f1(oy + myp + 5)}" stroke="${color}" stroke-width="2.2"/>`
    b += `<line x1="${f1(ox + mxp - 5)}" y1="${f1(oy + myp + 5)}" x2="${f1(ox + mxp + 5)}" y2="${f1(oy + myp - 5)}" stroke="${color}" stroke-width="2.2"/>`
    b += `<line x1="${f1(ox + A.p[0])}" y1="${f1(oy + A.p[1])}" x2="${f1(ox + mxp)}" y2="${f1(oy + myp)}" stroke="${color}" stroke-width="1.2" stroke-dasharray="3 3"/>`
    // caption
    const cy0 = oy + S + 24
    b += txt(ox, cy0, rec.seen ? 'seen: A is pushed off B' : 'masked: no push this pass', { size: 13, weight: '600', fill: color })
    b += txt(ox, cy0 + 18, `B's cell holds ${rec.count === 1 ? 'B alone' : `B, C, D → average ×`}`, { size: 12, fill: C.sub })
    b += txt(ox, cy0 + 34, `distance ${rec.dist.toFixed(0)} vs contact ${rec.combined.toFixed(0)}`, { size: 12, fill: C.sub })
  })
  b += txt(20, 400, 'Cell averages hide a contact when a third point drags the neighbour cell’s mean out of range (left). Shifting the partition by half a cell', { size: 12.5 })
  b += txt(20, 418, 'changes who shares a cell with whom: in three of the four grids A and B share one, or B is alone in its cell, and the average is B itself.', { size: 12.5 })
  b += txt(20, 446, 'The offsets reshuffle alignment; they never extend the search radius — that is the cell size’s job (previous figure).', { size: 12.5, fill: C.sub })
  await writeFile(join(OUT, 'b-offset-grids.svg'), svgDoc(W, H, b))
}

// ---------------------------------------------------------------- Diagram C
// The per-pass push as a function of overlap depth, in units of the combined
// radius, and the caps that bind it. Mirrors force-collision-spatial.frag:
//   overlapRatio = (Rc − d) / Rc
//   softOverlap  = sqrt(overlapRatio) · Rc · 0.5
//   force        = alpha · strength · softOverlap · 0.25 · count   (≤ 0.5 · Rc)
//   per pass     = |Σ cells| ≤ 0.1 · R_self
{
  const W = 980; const H = 430
  const px0 = 70; const py0 = 70; const pw = 520; const ph = 270
  const X = (o) => px0 + o * pw // overlap depth 0..1
  const yMax = 0.14
  const Y = (v) => py0 + ph - (v / yMax) * ph
  const push = (o, strength, alpha = 1, count = 1) => Math.min(alpha * strength * Math.sqrt(o) * 0.5 * 0.25 * count, 0.5)
  const cap = 0.1 * 0.5 // 0.1 · R_self with equal radii, R_self = Rc / 2
  const oBind = Math.pow(cap / 0.125, 2) // where strength = 1 hits the cap
  assert(Math.abs(oBind - 0.16) < 1e-9, 'cap crossing for strength 1 should be at 16 % overlap')

  let b = ''
  b += txt(20, 34, 'What one pass pushes, per unit of combined radius Rc (alpha = 1, one neighbour, equal radii)', { size: 16, weight: '600' })
  // axes
  b += `<rect x="${px0}" y="${py0}" width="${pw}" height="${ph}" fill="${C.panel}" stroke="${C.frame}"/>`
  for (let i = 0; i <= 5; i++) {
    const o = i / 5
    b += `<line x1="${f1(X(o))}" y1="${py0}" x2="${f1(X(o))}" y2="${py0 + ph}" stroke="${C.gridLine}" stroke-width="0.7"/>`
    b += txt(X(o), py0 + ph + 18, `${Math.round(o * 100)} %`, { size: 11.5, fill: C.sub, anchor: 'middle' })
  }
  for (let i = 0; i <= 7; i++) {
    const v = (i / 7) * yMax
    b += `<line x1="${px0}" y1="${f1(Y(v))}" x2="${px0 + pw}" y2="${f1(Y(v))}" stroke="${C.gridLine}" stroke-width="0.7"/>`
    b += txt(px0 - 8, Y(v) + 4, v.toFixed(2), { size: 11, fill: C.sub, anchor: 'end' })
  }
  b += txt(px0 + pw / 2, py0 + ph + 40, 'overlap depth  (Rc − d) / Rc   —   0 % = just touching, 100 % = concentric', { size: 12.5, fill: C.sub, anchor: 'middle' })
  b += `<text x="22" y="${py0 + ph / 2}" font-family="${FONT}" font-size="12.5" fill="${C.sub}" text-anchor="middle" transform="rotate(-90 22 ${py0 + ph / 2})">push per pass / Rc</text>`
  const curve = (fn, stroke, width, dash = '') => {
    const pts = []
    for (let i = 0; i <= 200; i++) { const o = i / 200; pts.push(`${f1(X(o))},${f1(Y(fn(o)))}`) }
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${stroke}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`
  }
  b += curve((o) => 0.125 * o, C.frame, 1.5, '5 4') // linear reference
  b += curve((o) => push(o, 1), C.blue, 2.6)
  b += curve((o) => push(o, 0.25), C.teal, 2.6)
  // the per-pass cap and where it binds
  b += `<line x1="${px0}" y1="${f1(Y(cap))}" x2="${px0 + pw}" y2="${f1(Y(cap))}" stroke="${C.red}" stroke-width="1.8" stroke-dasharray="6 4"/>`
  b += curve((o) => Math.min(push(o, 1), cap), C.blue, 5)
  b += `<line x1="${f1(X(oBind))}" y1="${f1(Y(cap))}" x2="${f1(X(oBind))}" y2="${py0 + ph}" stroke="${C.red}" stroke-width="1" stroke-dasharray="3 3"/>`
  b += txt(X(oBind) + 6, py0 + ph - 8, `${Math.round(oBind * 100)} %`, { size: 11.5, fill: C.red })
  b += txt(X(0.985), Y(cap) - 8, 'per-pass cap: 0.1 · own radius = 0.05 · Rc', { size: 11.5, fill: C.red, anchor: 'end' })
  b += txt(X(0.98), Y(push(0.98, 1)) - 10, 'strength 1 (uncapped curve)', { size: 12, fill: C.blue, weight: '600', anchor: 'end' })
  b += txt(X(0.55), Y(push(0.55, 0.25)) - 10, 'strength 0.25', { size: 12, fill: C.teal, weight: '600' })
  b += txt(X(0.75) + 8, Y(0.125 * 0.75) + 16, 'linear, for reference', { size: 11.5, fill: C.sub })

  // notes
  const nx = 620; let ny = 92
  const note = (head, lines, color = C.text) => {
    b += txt(nx, ny, head, { size: 13, weight: '600', fill: color }); ny += 18
    for (const l of lines) { b += txt(nx, ny, l, { size: 12 }); ny += 16 }
    ny += 10
  }
  note('Square-root curve', ['most of the response is there at a shallow', 'overlap; deeper overlap adds little — the', 'push is nearly flat past ~30 %'], C.blue)
  note('Cap binds at strength ≈ 1', ['past 16 % overlap the push is simply 10 % of', 'the point’s own radius per pass: overlaps', 'resolve by relaxation over a few ticks'], C.red)
  note('Then, per tick', ['× 4 offset passes (each ¼-weighted, summed)', '× friction (0.85 default) in the integrator', 'so ≤ 0.4 · own radius per tick before friction'])
  note('Crowds', ['a cell’s push is × its population, then the', 'total is damped by 2 / neighbours when > 2'], C.sub)
  await writeFile(join(OUT, 'c-force-curve.svg'), svgDoc(W, H, b))
}

// ---------------------------------------------------------------- Diagram D
// Where collision sits in the tick, and its own two-phase pipeline.
{
  const W = 980; const H = 520
  let b = ''
  const box = (x, y, w, h, title, lines, color, soft, titleSize = 13) => {
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${soft}" stroke="${color}" stroke-width="1.6"/>`
    s += txt(x + w / 2, y + 22, title, { size: titleSize, weight: '600', anchor: 'middle', fill: color })
    lines.forEach((l, i) => { s += txt(x + w / 2, y + 42 + i * 15, l, { size: 11.5, anchor: 'middle', fill: C.text }) })
    return s
  }
  // Row 1: the tick order
  b += txt(20, 34, 'One simulation tick: every force does swap → force → integrate on its own; collision goes last', { size: 16, weight: '600' })
  const forces = [
    ['gravity', 'if enabled'], ['center', 'if enabled'], ['many-body', 'always'],
    ['links', 'incoming, outgoing'], ['clusters', 'if clustered'], ['collision', 'if strength > 0'],
  ]
  const bw = 138; const bx0 = 20; const by = 60; const gap = 22
  forces.forEach(([name, sub], i) => {
    const x = bx0 + i * (bw + gap)
    const last = i === forces.length - 1
    b += box(x, by, bw, 66, name, [sub, 'swap · force · integrate'], last ? C.amber : C.frame, last ? C.amberSoft : '#f6f8fb')
    if (i < forces.length - 1) b += arrow(x + bw, by + 33, x + bw + gap - 2, by + 33, C.frame, 2)
  })
  b += txt(20, 150, 'Attraction (links, clusters) re-creates overlap every tick. Running collision after it corrects that overlap within the same tick;', { size: 12, fill: C.sub })
  b += txt(20, 166, 'before it, the correction would lag a frame and the two would oscillate. Each force reads the positions the previous one just wrote.', { size: 12, fill: C.sub })

  // Row 2: collision internals
  b += txt(20, 208, 'Inside the collision force', { size: 15, weight: '600' })
  const ry = 232
  b += box(20, ry, 150, 104, 'inputs', ['positions (latest)', 'resolved sizes', 'exit status'], C.frame, '#f6f8fb')
  b += arrow(170, ry + 52, 206, ry + 52, C.frame, 2.5)
  b += box(208, ry, 220, 104, '1 · build grid  × 4', ['point-list draw, additive blend:', '[Σx, Σy, Σsize, count] per cell,', 'one grid per half-cell offset', 'absent points culled'], C.teal, C.tealSoft)
  // four little grids
  const gx = 452; const gy = ry + 6
  const OFFS = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]]
  OFFS.forEach((o, k) => {
    const x = gx + (k % 2) * 48; const y = gy + Math.floor(k / 2) * 48
    b += `<rect x="${x}" y="${y}" width="40" height="40" fill="#ffffff" stroke="${C.teal}" stroke-width="1.2"/>`
    for (let i = 1; i < 4; i++) {
      const lx = x + (i - o[0]) * 10; const ly = y + (i - o[1]) * 10
      b += `<line x1="${f1(lx)}" y1="${y}" x2="${f1(lx)}" y2="${y + 40}" stroke="${C.gridLine}" stroke-width="0.8"/>`
      b += `<line x1="${x}" y1="${f1(ly)}" x2="${x + 40}" y2="${f1(ly)}" stroke="${C.gridLine}" stroke-width="0.8"/>`
    }
    if (o[0]) b += `<line x1="${f1(x + 5)}" y1="${y}" x2="${f1(x + 5)}" y2="${y + 40}" stroke="${C.gridLine}" stroke-width="0.8"/>`
    if (o[1]) b += `<line x1="${x}" y1="${f1(y + 5)}" x2="${x + 40}" y2="${f1(y + 5)}" stroke="${C.gridLine}" stroke-width="0.8"/>`
  })
  b += arrow(428, ry + 52, 448, ry + 52, C.frame, 2.5)
  b += txt(gx + 44, ry + 104 + 14, '4 grid textures', { size: 11, fill: C.sub, anchor: 'middle' })
  b += txt(gx + 44, ry + 104 + 28, '(≤ 512², rgba32float)', { size: 11, fill: C.sub, anchor: 'middle' })
  b += arrow(gx + 92, ry + 52, gx + 116, ry + 52, C.frame, 2.5)
  b += box(gx + 118, ry, 236, 104, '2 · force pass  × 4', ['full-screen, one fragment per point;', 'reads 9 cells of grid k, pushes off', 'each cell average (¼ weight), caps;', 'adds into the velocity texture'], C.blue, C.blueSoft)
  b += arrow(gx + 354, ry + 52, gx + 378, ry + 52, C.frame, 2.5)
  b += box(gx + 380, ry, 128, 104, 'integrate', ['pos += v · friction', 'clamp to space', '(shared step)'], C.amber, C.amberSoft)
  // return arrow to inputs
  b += `<path d="M ${gx + 444} ${ry + 104} L ${gx + 444} ${ry + 150} L 95 ${ry + 150} L 95 ${ry + 108}" fill="none" stroke="${C.frame}" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#arr)"/>`
  b += txt(300, ry + 145, 'next tick (after the other forces have run again)', { size: 11, fill: C.sub, anchor: 'middle' })

  b += txt(20, 420, 'Cost per tick is O(n) with a fixed constant — 4 × n binned vertices, then 4 × n fragments doing 9 grid fetches — and does not', { size: 12 })
  b += txt(20, 437, 'grow with how crowded a cell is: the cell is one aggregate however many points it holds. Crowding costs quality and ticks to converge, not time.', { size: 12 })
  b += txt(20, 463, 'Memory: 4 grids × grid² × 16 B — 16 MB at the 512² cap, which the default size 4 reaches — plus 16 B per point of sizes; allocated lazily on', { size: 12, fill: C.sub })
  b += txt(20, 480, 'first use, never while strength is 0. The velocity texture is cleared once at the start of the force pass; the four offset passes blend into it', { size: 12, fill: C.sub })
  b += txt(20, 497, 'additively before the single integration.', { size: 12, fill: C.sub })
  await writeFile(join(OUT, 'd-tick-pipeline.svg'), svgDoc(W, H, b))
}

console.log('generated: a-contact-range.svg, b-offset-grids.svg, c-force-curve.svg, d-tick-pipeline.svg')
