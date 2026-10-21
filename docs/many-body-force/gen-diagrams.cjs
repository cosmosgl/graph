// Regenerates the SVG diagrams for this folder. Run from here:
//   node gen-diagrams.cjs .
// Grid-coverage panels compute cell coverage with the SAME rules as the
// shaders (first level: whole grid minus its shell; others: the child block of
// the shell above minus their own shell; shells are 5×5 on every level but the
// finest, 3×3 there), and the data-bounds panels bin points with grid-cell.ts's formula over
// the box reduce-bounds-final.frag builds, so the pictures are exact, not
// artistic impressions. Keep this script in sync
// with force-level.frag / build-nearfield-slots.vert / grid-cell.ts /
// Shared/data-bounds.ts when the algorithm changes, then re-run it so the
// diagrams don't fossilize.
const fs = require('fs')
const path = require('path')

const OUT = process.argv[2] || '.'
fs.mkdirSync(OUT, { recursive: true })

const FONT = 'ui-sans-serif, system-ui, -apple-system, sans-serif'
const C = {
  text: '#1e293b', sub: '#64748b', gridLine: '#cbd5e1', frame: '#94a3b8',
  old: '#e05555', oldSoft: '#fbdada',
  covered: ['#3a86ff', '#2a9d8f', '#e9a13b'], // per-level fills
  coveredSoft: ['#d7e6ff', '#d3ece9', '#fae8cd'],
  deferred: '#eef1f5', near: '#e05555', nearSoft: '#fbdada',
  point: '#0f172a', accent: '#7c3aed',
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const txt = (x, y, s, { size = 13, fill = C.text, anchor = 'start', weight = 'normal', style = '' } = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}" ${style}>${esc(s)}</text>`

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
  `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${width}" marker-end="url(#arr)" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`

const assert = (cond, msg) => { if (!cond) throw new Error(`diagram assertion failed: ${msg}`) }

// ---------------------------------------------------------------- Diagram A
// Old centroid near field (radial only) vs new pairwise near field.
{
  const W = 920; const H = 470
  let b = ''
  // Shared cluster of points (positions relative to panel center)
  const pts = [
    [-52, -18], [-30, 34], [-8, -44], [16, -12], [42, -34],
    [50, 22], [12, 46], [-18, 6], [34, 4], [-44, -46],
  ]
  const centroid = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0])

  const panel = (ox, title, subtitle, kind) => {
    let s = `<rect x="${ox}" y="52" width="430" height="330" rx="10" fill="#fafbfd" stroke="${C.frame}"/>`
    s += txt(ox + 16, 34, title, { size: 16, weight: '600' })
    subtitle.forEach((line, i) => { s += txt(ox + 16, 406 + i * 17, line, { size: 12.5, fill: C.sub }) })
    const cx = ox + 215; const cy = 215
    if (kind === 'old') {
      // centroid star
      s += `<circle cx="${cx + centroid[0]}" cy="${cy + centroid[1]}" r="7" fill="${C.old}"/>`
      s += txt(cx + centroid[0] + 12, cy + centroid[1] + 4, 'cell centroid', { size: 12, fill: C.old })
      for (const [px, py] of pts) {
        const x = cx + px; const y = cy + py
        const dx = x - (cx + centroid[0]); const dy = y - (cy + centroid[1])
        const l = Math.hypot(dx, dy) || 1
        s += `<line x1="${cx + centroid[0]}" y1="${cy + centroid[1]}" x2="${x}" y2="${y}" stroke="${C.oldSoft}" stroke-width="1.5"/>`
        s += arrow(x, y, x + (dx / l) * 34, y + (dy / l) * 34, C.old, 2.5)
        s += `<circle cx="${x}" cy="${y}" r="5" fill="${C.point}"/>`
      }
    } else {
      // focus point gets pairwise pushes from sampled neighbors
      const f = pts[7] // (-18, 6)
      const fx = cx + f[0]; const fy = cy + f[1]
      const sampled = [0, 2, 3, 6, 9]
      let sx = 0; let sy = 0
      for (let i = 0; i < pts.length; i++) {
        const x = cx + pts[i][0]; const y = cy + pts[i][1]
        if (i === 7) continue
        const isS = sampled.includes(i)
        s += `<circle cx="${x}" cy="${y}" r="5" fill="${isS ? C.covered[0] : '#b9c3d3'}"/>`
        if (isS) {
          const dx = fx - x; const dy = fy - y
          const l = Math.hypot(dx, dy) || 1
          s += `<line x1="${x}" y1="${y}" x2="${fx}" y2="${fy}" stroke="#d7e6ff" stroke-width="1.5"/>`
          s += arrow(fx, fy, fx + (dx / l) * 26, fy + (dy / l) * 26, C.covered[0], 2)
          sx += dx / l; sy += dy / l
        }
      }
      const sl = Math.hypot(sx, sy) || 1
      s += arrow(fx, fy, fx + (sx / sl) * 52, fy + (sy / sl) * 52, C.accent, 3.5)
      s += `<circle cx="${fx}" cy="${fy}" r="6.5" fill="${C.point}" stroke="${C.accent}" stroke-width="2.5"/>`
      s += txt(fx + (sx / sl) * 52 + 8, fy + (sy / sl) * 52 + 4, 'weighted sum', { size: 12, fill: C.accent })
      s += txt(cx - 200, 370, 'sampled neighbor', { size: 12, fill: C.covered[0] })
      s += `<circle cx="${cx - 212}" cy="366" r="5" fill="${C.covered[0]}"/>`
      s += txt(cx - 60, 370, 'not sampled this tick', { size: 12, fill: C.sub })
      s += `<circle cx="${cx - 72}" cy="366" r="5" fill="#b9c3d3"/>`
    }
    return s
  }

  b += panel(20, 'Old near field: one centroid, radial force',
    ['Every force line passes through one point — no sideways', 'push, so a dense clump can only inflate, never rearrange.'], 'old')
  b += panel(470, 'New near field: individual sampled pairs',
    ['Each neighbor pushes from its own direction — the', 'tangential component spreads the clump apart.'], 'new')
  fs.writeFileSync(path.join(OUT, 'a-near-field-old-vs-new.svg'), svgDoc(W, H, b))
}

// ---------------------------------------------------------------- Diagram B
// The grid pyramid: who covers what (computed with the shader's own rules).
// Every level divides the same square: this tick's data box (Diagram I), whose
// placement shifts every tick (Diagram J). The first three levels from
// ForceManyBody's COARSEST_GRID_SIZE (8).
{
  const W = 980; const H = 478
  const SIDE = 264 // panel pixel size of the data box
  const p = [0.58, 0.36] // the point, in data-box coordinates 0..1
  const levels = [8, 16, 32]
  let b = ''

  levels.forEach((g, li) => {
    const ox = 26 + li * 320; const oy = 78
    const cell = SIDE / g
    const pc = [Math.floor(p[0] * g), Math.floor(p[1] * g)]
    // coverage per shader (force-level.frag, getShellRadius): shell radius r is
    // 2 on every level but the finest, 1 there. First level = whole grid minus
    // its shell; later levels = the (4·rPrev+2)² child block of the shell above
    // (base = (pc>>1)<<1 - 2·rPrev) minus their own shell.
    const r = li === levels.length - 1 ? 1 : 2
    const rPrev = 2
    const block = 2 * (2 * rPrev + 1)
    const base = [(pc[0] >> 1 << 1) - 2 * rPrev, (pc[1] >> 1 << 1) - 2 * rPrev]
    for (let j = 0; j < g; j++) {
      for (let i = 0; i < g; i++) {
        const cheb = Math.max(Math.abs(i - pc[0]), Math.abs(j - pc[1]))
        const inBlock = li === 0 || (i >= base[0] && i < base[0] + block && j >= base[1] && j < base[1] + block)
        let fill = '#ffffff'
        if (inBlock && cheb > r) fill = C.coveredSoft[li]
        else if (inBlock && cheb <= r) fill = li === levels.length - 1 ? C.nearSoft : C.deferred
        b += `<rect x="${(ox + i * cell).toFixed(1)}" y="${(oy + j * cell).toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" fill="${fill}" stroke="${C.gridLine}" stroke-width="0.7"/>`
      }
    }
    // frame + point
    b += `<rect x="${ox}" y="${oy}" width="${SIDE}" height="${SIDE}" fill="none" stroke="${C.frame}" stroke-width="1.4"/>`
    b += `<circle cx="${ox + p[0] * SIDE}" cy="${oy + p[1] * SIDE}" r="5" fill="${C.point}"/>`
    b += txt(ox + SIDE / 2, 40, `Level ${li}: ${g} × ${g} cells`, { size: 15, weight: '600', anchor: 'middle' })
    const covLabel = li === 0
      ? 'whole data box minus the 5×5 shell'
      : li === levels.length - 1
        ? 'previous 5×5 refined, minus its own 3×3'
        : 'previous 5×5 refined, minus its own 5×5'
    b += txt(ox + SIDE / 2, 60, covLabel, { size: 11.5, fill: C.sub, anchor: 'middle' })
    // legend chip
    b += `<rect x="${ox}" y="${oy + SIDE + 14}" width="14" height="14" fill="${C.coveredSoft[li]}" stroke="${C.gridLine}"/>`
    b += txt(ox + 20, oy + SIDE + 25, li === levels.length - 1 ? 'centroid force at this level' : 'centroid force at this level', { size: 12 })
    b += `<rect x="${ox}" y="${oy + SIDE + 36}" width="14" height="14" fill="${li === levels.length - 1 ? C.nearSoft : C.deferred}" stroke="${C.gridLine}"/>`
    b += txt(ox + 20, oy + SIDE + 47, li === levels.length - 1 ? '3×3 → near field (Monte-Carlo pairs)' : '5×5 → deferred to the next level', { size: 12 })
    if (li < levels.length - 1) b += arrow(ox + SIDE + 14, oy + SIDE / 2, ox + SIDE + 44, oy + SIDE / 2, C.frame, 2.5)
  })
  b += txt(W / 2, H - 32, 'Every region of the data box — the live points’ bounding square, padded by one coarsest cell — is charged to exactly one pass.', { size: 13, fill: C.sub, anchor: 'middle' })
  b += txt(W / 2, H - 14, 'Levels start at 8² and double up to the finest, which adapts to n (≈ 2·√n cells per axis, 8²…512²); every level divides the same box.', { size: 13, fill: C.sub, anchor: 'middle' })
  fs.writeFileSync(path.join(OUT, 'b-grid-pyramid.svg'), svgDoc(W, H, b))
}

// ---------------------------------------------------------------- Diagram C
// Depth peeling K random slots per cell (K = 8 drawn) + Horvitz–Thompson weighting.
{
  const W = 980; const H = 430
  let b = ''
  // The cell with 13 points, each with a per-tick hash
  const cellX = 40; const cellY = 70; const cellS = 250
  b += txt(cellX, 40, 'One finest-level cell, one tick', { size: 15, weight: '600' })
  b += txt(cellX, 58, '13 points, each hashed with this tick’s random seed', { size: 12, fill: C.sub })
  b += `<rect x="${cellX}" y="${cellY}" width="${cellS}" height="${cellS}" rx="6" fill="#fafbfd" stroke="${C.frame}"/>`
  const rng = (i) => ((Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1
  const hashes = []
  for (let i = 0; i < 13; i++) hashes.push({ i, h: Math.round(rng(i + 3) * 99) / 100 })
  const order = [...hashes].sort((a, b2) => a.h - b2.h)
  const peeled = new Set(order.slice(0, 8).map(o => o.i))
  const ppos = []
  for (let i = 0; i < 13; i++) {
    const gx = i % 4; const gy = Math.floor(i / 4)
    ppos.push([cellX + 38 + gx * 58 + (rng(i) - 0.5) * 26, cellY + 40 + gy * 58 + (rng(i + 40) - 0.5) * 26])
  }
  hashes.forEach(({ i, h }) => {
    const [x, y] = ppos[i]
    const isP = peeled.has(i)
    b += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="${isP ? C.covered[0] : '#ffffff'}" stroke="${isP ? C.covered[0] : '#b9c3d3'}" stroke-width="2"/>`
    b += txt(x, y + 24, h.toFixed(2).slice(1), { size: 10.5, fill: isP ? C.covered[0] : C.sub, anchor: 'middle' })
  })
  b += txt(cellX, cellY + cellS + 28, 'sampled (the K smallest hashes)', { size: 12, fill: C.covered[0] })
  b += `<circle cx="${cellX + 190}" cy="${cellY + cellS + 24}" r="7" fill="#fff" stroke="#b9c3d3" stroke-width="2"/>`
  b += txt(cellX + 202, cellY + cellS + 28, 'left out', { size: 12, fill: C.sub })

  // Peeling passes → slot textures
  const sx = 380; const sy = 78
  b += txt(sx, 40, 'K depth-peeling passes → K slot array layers (K = 8 drawn)', { size: 15, weight: '600' })
  b += txt(sx, 58, 'pass k keeps the smallest hash not yet peeled', { size: 12, fill: C.sub })
  order.slice(0, 8).forEach((o, k) => {
    const y = sy + k * 34
    b += `<rect x="${sx}" y="${y}" width="252" height="26" rx="5" fill="${C.coveredSoft[0]}" stroke="${C.covered[0]}"/>`
    b += txt(sx + 10, y + 17, `slot ${k}`, { size: 12, weight: '600', fill: C.covered[0] })
    b += txt(sx + 70, y + 17, `point #${o.i}`, { size: 12.5 })
    b += txt(sx + 160, y + 17, `hash ${o.h.toFixed(2)}`, { size: 12, fill: C.sub })
  })

  // The estimator
  const ex = 690; const ey = 78
  b += txt(ex, 40, 'Horvitz–Thompson weighting', { size: 15, weight: '600' })
  b += txt(ex, 58, 'sampled sum = full sum, on average', { size: 12, fill: C.sub })
  b += `<rect x="${ex}" y="${ey}" width="264" height="180" rx="8" fill="#faf7ff" stroke="${C.accent}"/>`
  b += txt(ex + 16, ey + 32, 'cell has 12 other points,', { size: 13.5 })
  b += txt(ex + 16, ey + 52, '8 of them sampled →', { size: 13.5 })
  b += txt(ex + 16, ey + 88, 'F  ≈  (12 / 8) · Σ F(sampled pair)', { size: 14.5, weight: '600', fill: C.accent })
  b += txt(ex + 16, ey + 122, 'E[F] = exact all-pairs sum', { size: 13.5 })
  b += txt(ex + 16, ey + 142, '(unbiased, no centroid term)', { size: 12.5, fill: C.sub })
  b += txt(ex + 16, ey + 166, '≤ K points in cell → exact.', { size: 13, weight: '600' })
  b += txt(ex, ey + 210, 'A fresh random subset every tick: the', { size: 12.5, fill: C.sub })
  b += txt(ex, ey + 228, 'noise anneals with alpha while density', { size: 12.5, fill: C.sub })
  b += txt(ex, ey + 246, 'disperses. Sustained density is why K', { size: 12.5, fill: C.sub })
  b += txt(ex, ey + 264, 'follows measured occupancy and ≤ 4k graphs go exact.', { size: 12.5, fill: C.sub })
  fs.writeFileSync(path.join(OUT, 'c-depth-peeling.svg'), svgDoc(W, H, b))
}

// ---------------------------------------------------------------- Diagram D
// The per-tick GPU pipeline.
{
  const W = 980; const H = 372
  let b = ''
  const box = (x, y, w, h, title, lines, color, soft) => {
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${soft}" stroke="${color}" stroke-width="1.6"/>`
    s += txt(x + w / 2, y + 24, title, { size: 13.5, weight: '600', anchor: 'middle', fill: color })
    lines.forEach((l, i) => { s += txt(x + w / 2, y + 46 + i * 17, l, { size: 11.5, anchor: 'middle', fill: C.text }) })
    return s
  }
  const midY = 96; const bh = 110
  b += txt(20, 40, 'One simulation tick of the repulsion force (all on the GPU)', { size: 16, weight: '600' })
  // positions, then four stages; x positions of each box
  const posX = 20; const posW = 118; const gap = 28; const sw = 178
  const stageX = [0, 1, 2, 3].map((i) => posX + posW + gap + i * (sw + gap))
  b += box(posX, midY, posW, bh, 'positions', ['one texel', 'per point (x, y)'], C.frame, '#f6f8fb')
  b += arrow(posX + posW, midY + 55, stageX[0] - 2, midY + 55, C.frame, 2.5)
  b += box(stageX[0], midY, sw, bh, '0 · data bounds', ['live points → one texel:', '[origin, extent, 1/extent],', 'padded + shifted each tick'], C.accent, '#f3eeff')
  b += arrow(stageX[0] + sw, midY + 55, stageX[1] - 2, midY + 55, C.frame, 2.5)
  b += box(stageX[1], midY, sw, bh, '1 · aggregate levels', ['draw n points into each', 'level over that square:', '[Σx, Σy, count] per cell'], C.covered[1], C.coveredSoft[1])
  b += arrow(stageX[1] + sw, midY + 55, stageX[2] - 2, midY + 55, C.frame, 2.5)
  b += box(stageX[2], midY, sw, bh, '2 · near-field slots', ['K depth-peel passes over', 'the finest grid: a fresh', 'random K-subset per cell'], C.covered[0], C.coveredSoft[0])
  b += arrow(stageX[2] + sw, midY + 55, stageX[3] - 2, midY + 55, C.frame, 2.5)
  b += box(stageX[3], midY, sw, bh, '3 · force passes', ['levels: centroid repulsion', '+ near field: weighted', 'pairs → velocity texture'], C.covered[2], C.coveredSoft[2])
  // The bounds texel feeds every later stage's cell lookup.
  const busY = midY + bh + 26
  const from = stageX[0] + sw / 2
  b += `<path d="M ${from} ${midY + bh} L ${from} ${busY} L ${stageX[3] + sw / 2} ${busY}" fill="none" stroke="${C.accent}" stroke-width="1.6" stroke-dasharray="5 4"/>`
  for (const i of [1, 2, 3]) b += arrow(stageX[i] + sw / 2, busY, stageX[i] + sw / 2, midY + bh + 3, C.accent, 1.6, '5 4')
  b += txt(from + 10, busY + 18, 'the texel every pass bins with — one shared, division-free gridCell() (grid-cell.ts)', { size: 12, fill: C.accent })
  b += txt(20, 300, 'The integration step (velocity → positions) is shared with all other forces: it bounds a step’s length, not the position it lands on.', { size: 12.5, fill: C.sub })
  b += txt(20, 322, 'Levels: 8², 16², … up to ≈ 2·√n per axis (capped 512²), all over the data box. Slot arrays: K = 8…64 layers × finest grid, [point index, hash] each.', { size: 12.5, fill: C.sub })
  b += txt(20, 344, 'Graphs of ≤ 4,096 points skip all four stages: a single exact all-pairs pass writes the velocity texture directly.', { size: 12.5, fill: C.sub })
  fs.writeFileSync(path.join(OUT, 'd-gpu-pipeline.svg'), svgDoc(W, H, b))
}

// ---------------------------------------------------------------- Diagram E
// Old algorithm sketch: theta bands + own-cell centroid.
{
  const W = 980; const H = 400
  let b = ''
  const ox = 40; const oy = 80; const S = 250; const g = 12
  b += txt(ox, 40, 'Old algorithm: theta-banded rings + own-cell centroid', { size: 16, weight: '600' })
  b += txt(ox, 60, 'per level, a band of cells at distance ≈ theta was summed; the innermost cell used its own centroid', { size: 12.5, fill: C.sub })
  const cell = S / g
  const pc = [7, 4]
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      const cheb = Math.max(Math.abs(i - pc[0]), Math.abs(j - pc[1]))
      let fill = '#ffffff'
      if (cheb >= 2 && cheb <= 3) fill = C.coveredSoft[1] // the band this level handles
      if (cheb <= 0) fill = C.nearSoft
      b += `<rect x="${(ox + i * cell).toFixed(1)}" y="${(oy + j * cell).toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" fill="${fill}" stroke="${C.gridLine}" stroke-width="0.7"/>`
    }
  }
  b += `<rect x="${ox}" y="${oy}" width="${S}" height="${S}" fill="none" stroke="${C.frame}" stroke-width="1.4"/>`
  b += `<circle cx="${ox + (pc[0] + 0.5) * cell}" cy="${oy + (pc[1] + 0.5) * cell}" r="4.5" fill="${C.point}"/>`
  b += `<rect x="${ox}" y="${oy + S + 14}" width="14" height="14" fill="${C.coveredSoft[1]}" stroke="${C.gridLine}"/>`
  b += txt(ox + 20, oy + S + 25, 'band summed at this level (width depends on theta)', { size: 12 })
  b += `<rect x="${ox}" y="${oy + S + 36}" width="14" height="14" fill="${C.nearSoft}" stroke="${C.gridLine}"/>`
  b += txt(ox + 20, oy + S + 47, 'own cell: repelled from its own centroid (radial only)', { size: 12 })

  const tx = 380
  const item = (y, head, body1, body2) => {
    let s = txt(tx, y, head, { size: 13.5, weight: '600', fill: C.old })
    s += txt(tx, y + 18, body1, { size: 12.5 })
    if (body2) s += txt(tx, y + 34, body2, { size: 12.5 })
    return s
  }
  b += txt(tx, 88, 'Structural problems this created', { size: 15, weight: '600' })
  b += item(120, '1 · Radial-only close force', 'The nearest — strongest — interaction was “me vs my cell’s centroid”:', 'a force with no tangential part. Dense hubs flattened into disks and petals.')
  b += item(184, '2 · theta seams and tuning', 'Band boundaries moved with simulationRepulsionTheta; a wrong value', 'either double-counted or skipped mass, and the “right” value varied per graph.')
  b += item(248, '3 · Approximate even for tiny graphs', 'Two points in one cell still repelled centroid-wise —', 'small graphs paid the approximation without needing one.')
  b += txt(tx, 322, 'The far-field idea (coarser grids for farther mass) was sound — the new', { size: 12.5, fill: C.sub })
  b += txt(tx, 340, 'algorithm keeps it, and replaces everything inside the 3×3 shell.', { size: 12.5, fill: C.sub })
  fs.writeFileSync(path.join(OUT, 'e-old-theta-bands.svg'), svgDoc(W, H, b))
}

// ---------------------------------------------------------------- Diagram F
// The sustained-density failure mode: a fresh sample every tick means the
// force on a confined point is re-rolled noise, not annealing jitter.
{
  const W = 980; const H = 430
  let b = ''
  b += txt(20, 34, 'Same cell, same positions — a fresh sample every tick', { size: 16, weight: '600' })
  // One shared dot layout (relative to a 200×200 cell): sample A one tick,
  // sample B the next, one dot never drawn either tick, plus the observed point.
  const setA = [[60, 50], [120, 55], [75, 80], [165, 100], [115, 105], [70, 140], [130, 145], [120, 165]]
  const setB = [[90, 40], [150, 70], [45, 85], [135, 90], [55, 115], [145, 120], [100, 135], [160, 150]]
  const extra = [[90, 175]]
  const self = [105, 75]
  const panel = (ox, label, sampled, unsampled, color, arrowTo) => {
    let s = txt(ox, 66, label, { size: 13, fill: C.sub })
    s += `<rect x="${ox}" y="76" width="200" height="200" fill="#f6f8fb" stroke="${C.gridLine}"/>`
    for (const [x, y] of [...unsampled, ...extra]) s += `<circle cx="${ox + x}" cy="${76 + y}" r="4" fill="${C.gridLine}"/>`
    for (const [x, y] of sampled) s += `<circle cx="${ox + x}" cy="${76 + y}" r="5" fill="${color}"/>`
    s += `<circle cx="${ox + self[0]}" cy="${76 + self[1]}" r="6.5" fill="#ffffff" stroke="${C.text}" stroke-width="2"/>`
    s += arrow(ox + self[0], 76 + self[1], ox + arrowTo[0], 76 + arrowTo[1], color, 2.5)
    return s
  }
  b += panel(30, 'tick t — sample A (amber)', setA, setB, C.covered[2], [68, 32])
  b += txt(30, 300, 'force on ⊙ = Σ over sample A × m/K', { size: 12, fill: C.sub })
  b += panel(360, 'tick t+1 — sample B (teal)', setB, setA, C.covered[1], [144, 116])
  b += txt(360, 300, 'same positions, different draw → different answer', { size: 12, fill: C.sub })
  b += txt(690, 66, 'the point, tick after tick', { size: 13, fill: C.sub })
  b += `<rect x="690" y="76" width="200" height="200" fill="#f6f8fb" stroke="${C.gridLine}"/>`
  b += `<polyline points="710,240 726,228 718,210 736,202 748,216 764,208 758,190 774,178 790,188 784,206 800,216 816,206 810,188 826,176 842,184" fill="none" stroke="${C.text}" stroke-width="1.5" marker-end="url(#arr)"/>`
  b += `<circle cx="710" cy="240" r="3.5" fill="${C.text}"/>`
  b += txt(690, 300, '≈0.5 units/tick, ~92° mean turn — at equilibrium', { size: 12, fill: C.sub })
  b += txt(20, 345, 'The estimate is unbiased — averaged over ticks it equals the exact force — but each tick draws a fresh K-subset and', { size: 13 })
  b += txt(20, 365, 'weights it by m/K. While the cell stays dense (m ≫ K) that per-tick difference never shrinks: the noise is not annealing,', { size: 13 })
  b += txt(20, 385, 'it is a permanent random walk stacked on a settled layout.', { size: 13 })
  fs.writeFileSync(path.join(OUT, 'f-resample-jitter.svg'), svgDoc(W, H, b))
}

// ---------------------------------------------------------------- Diagram G
// The two paths after the fix: exact all-pairs ≤ 4,096 points, grid + sampling above.
{
  const W = 980; const H = 330
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
  let b = ''
  b += txt(20, 34, 'Two paths — the point count picks one', { size: 16, weight: '600' })
  b += `<rect x="20" y="130" width="110" height="52" fill="#f6f8fb" stroke="${C.frame}" rx="4"/>`
  b += txt(75, 152, 'graph of', { size: 13, anchor: 'middle' })
  b += txt(75, 170, 'n points', { size: 13, anchor: 'middle' })
  b += `<polygon points="240,116 320,156 240,196 160,156" fill="#ffffff" stroke="${C.text}" stroke-width="1.5"/>`
  b += `<text x="240" y="152" font-family="${MONO}" font-size="12" fill="${C.text}" text-anchor="middle">n ≤ 4096</text>`
  b += txt(240, 168, 'usesAllPairs', { size: 11, fill: C.sub, anchor: 'middle' })
  b += arrow(130, 156, 156, 156, C.text, 1.5)
  b += arrow(266, 129, 352, 94, C.text, 1.5)
  b += txt(300, 96, 'no', { size: 12, fill: C.sub })
  b += `<rect x="358" y="60" width="160" height="56" fill="#f6f8fb" stroke="${C.frame}" rx="4"/>`
  b += txt(438, 84, 'aggregate the', { size: 13, anchor: 'middle' })
  b += txt(438, 102, 'grid pyramid', { size: 13, anchor: 'middle' })
  b += arrow(518, 88, 552, 88, C.text, 1.5)
  b += `<rect x="556" y="60" width="160" height="56" fill="${C.coveredSoft[0]}" stroke="${C.frame}" rx="4"/>`
  b += txt(636, 84, 'depth-peel K slots', { size: 13, anchor: 'middle' })
  b += txt(636, 102, 'per finest cell', { size: 13, anchor: 'middle' })
  b += `<text x="636" y="136" font-family="${MONO}" font-size="11" fill="${C.sub}" text-anchor="middle">K = simulationRepulsionSamples, or measured: 8 … 64</text>`
  b += arrow(716, 88, 750, 88, C.text, 1.5)
  b += `<rect x="754" y="60" width="200" height="56" fill="#f6f8fb" stroke="${C.frame}" rx="4"/>`
  b += txt(854, 84, 'far field per level +', { size: 13, anchor: 'middle' })
  b += txt(854, 102, 'sampled near field ×m/K', { size: 13, anchor: 'middle' })
  b += arrow(266, 183, 424, 234, C.text, 1.5)
  b += txt(318, 226, 'yes', { size: 12, fill: C.sub })
  b += `<rect x="430" y="216" width="250" height="64" fill="${C.coveredSoft[2]}" stroke="${C.covered[2]}" rx="4"/>`
  b += `<text x="555" y="242" font-family="${MONO}" font-size="12" fill="${C.text}" text-anchor="middle">force-allpairs.frag</text>`
  b += txt(555, 262, 'one exact O(n²) pass — no grid, no sampling', { size: 13, anchor: 'middle' })
  b += `<rect x="850" y="200" width="110" height="52" fill="${C.coveredSoft[1]}" stroke="${C.frame}" rx="4"/>`
  b += txt(905, 222, 'velocity', { size: 13, anchor: 'middle' })
  b += txt(905, 240, 'texture', { size: 13, anchor: 'middle' })
  b += arrow(854, 116, 887, 196, C.text, 1.5)
  b += txt(892, 156, 'additive', { size: 11, fill: C.sub })
  b += arrow(680, 242, 846, 230, C.text, 1.5)
  b += txt(742, 222, 'single write', { size: 11, fill: C.sub })
  b += txt(20, 312, 'Same pairwise falloff and coincident-point kick on both paths — the small-graph path just computes every pair instead of estimating.', { size: 12, fill: C.sub })
  fs.writeFileSync(path.join(OUT, 'g-two-paths.svg'), svgDoc(W, H, b))
}

// ---------------------------------------------------------------- Diagram H
// Peeling ping-pong between two slot array textures: pass k renders into layer
// k / 2 of array k % 2 and samples the other array (rendering into a layer of a
// texture you are sampling another layer of is a WebGL feedback loop). No copy.
{
  const W = 980; const H = 430
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
  let b = ''
  b += txt(20, 34, 'Peeling ping-pong: two slot array textures, each pass rendered into its own layer', { size: 16, weight: '600' })
  const cols = [
    { x: 100, label: 'pass 0', l1: 'writes even · layer 0', l2: 'smallest hash / cell', soft: C.coveredSoft[0] },
    { x: 320, label: 'pass 1', l1: 'reads even 0 · writes odd 0', l2: 'next-smallest hash', soft: C.coveredSoft[1] },
    { x: 540, label: 'pass 2', l1: 'reads odd 0 · writes even 1', l2: 'next-smallest hash', soft: C.coveredSoft[0] },
    { x: 760, label: 'pass 3 … K−1', l1: 'reads even 1 · writes odd 1', l2: '… alternating', soft: C.coveredSoft[1] },
  ]
  cols.forEach((col, k) => {
    b += txt(col.x + 80, 96, col.label, { size: 13, fill: C.sub, anchor: 'middle' })
    b += `<rect x="${col.x}" y="110" width="160" height="64" fill="${col.soft}" stroke="${C.frame}" rx="4"/>`
    b += txt(col.x + 80, 136, col.l1, { size: 12, anchor: 'middle' })
    b += txt(col.x + 80, 156, col.l2, { size: 12, fill: C.sub, anchor: 'middle' })
    if (k < cols.length - 1) {
      b += arrow(col.x + 160, 142, col.x + 216, 142, C.text, 1.5)
      b += txt(col.x + 188, 130, 'winner', { size: 11, fill: C.sub, anchor: 'middle' })
    }
  })
  // The two arrays: even slots in one, odd slots in the other, slot k at layer k / 2
  const arrays = [
    { y: 230, label: 'slotsEven : sampler2DArray', layers: ['layer 0 = slot 0', 'layer 1 = slot 2', '…'], xs: [100, 540, 760] },
    { y: 300, label: 'slotsOdd : sampler2DArray', layers: ['layer 0 = slot 1', 'layer 1 = slot 3', '…'], xs: [320, 760, 900] },
  ]
  arrays.forEach((array) => {
    b += `<rect x="90" y="${array.y}" width="840" height="48" fill="none" stroke="${C.covered[2]}" stroke-dasharray="4 3" rx="4"/>`
    b += `<text x="96" y="${array.y - 6}" font-family="${MONO}" font-size="11" fill="${C.covered[2]}">${array.label}</text>`
    array.layers.forEach((label, i) => {
      const x = array.xs[i]
      const width = i < 2 ? 160 : 20
      b += `<rect x="${x}" y="${array.y + 8}" width="${width}" height="32" fill="${C.coveredSoft[2]}" stroke="${C.covered[2]}" rx="3"/>`
      b += txt(x + width / 2, array.y + 29, label, { size: 12, anchor: 'middle' })
    })
  })
  b += arrow(180, 174, 180, 236, C.covered[2], 2)
  b += arrow(400, 174, 400, 306, C.covered[2], 2)
  b += arrow(620, 174, 620, 236, C.covered[2], 2)
  b += arrow(840, 174, 840, 306, C.covered[2], 2)
  b += txt(20, 390, 'Pass k must sample pass k−1\'s output, and sampling one layer of a texture while rendering to another layer of the same', { size: 13 })
  b += txt(20, 410, 'texture is a WebGL feedback loop. Alternating between two arrays keeps every pass off the texture it reads — no copy, one shared depth buffer.', { size: 13 })
  fs.writeFileSync(path.join(OUT, 'h-pingpong-peel.svg'), svgDoc(W, H, b))
}

// ---------------------------------------------------------------- Diagram I
// Where the grid sits. Anchored to the space, a compact layout lands in a few
// over-full cells; fitted to the data, the same points get the whole grid. The
// cells are counted with grid-cell.ts's formula, the box built the way
// reduce-bounds-final.frag builds it for the many-body force: the data's
// bounding square, padded by one cell of the coarsest (8²) level and slid back
// by one tick's shift.
{
  const W = 980; const H = 470
  const SIDE = 264 // panel pixel size
  const G = 16 // cells per axis — the finest level for n = 64 (2·√n)
  const N = 64
  const F = 0.3 // fraction of each axis of the space the layout spans
  // mulberry32: a fixed seed keeps the picture stable from run to run
  let seed = 7
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const centre = [0.3, 0.6] // in space coordinates 0..1
  const pts = []
  for (let i = 0; i < N; i++) pts.push([centre[0] + (rnd() - 0.5) * F, centre[1] + (rnd() - 0.5) * F])
  // reduce-bounds-final.frag: the bounding square around the data's centre…
  const lo = [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1]))]
  const hi = [Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))]
  const fitted = Math.max(hi[0] - lo[0], hi[1] - lo[1])
  const fittedOrigin = [(lo[0] + hi[0]) / 2 - fitted / 2, (lo[1] + hi[1]) / 2 - fitted / 2]
  // …padded by one coarsest cell and slid back by one tick's shift (originShift)
  const COARSEST = 8
  const shift = [0.35, 0.6]
  const pad = fitted / (COARSEST - 1)
  const extent = fitted + pad
  const origin = [fittedOrigin[0] - shift[0] * pad, fittedOrigin[1] - shift[1] * pad]
  assert(origin[0] <= lo[0] && origin[1] <= lo[1] && origin[0] + extent >= hi[0] && origin[1] + extent >= hi[1], 'the shifted box must contain every point')
  // grid-cell.ts: clamp(floor((p − origin) · (1/extent · N)), 0, N − 1)
  const gridCell = (q, o, e) => [0, 1].map((k) => Math.min(G - 1, Math.max(0, Math.floor((q[k] - o[k]) * ((1 / e) * G)))))
  const occupancy = (o, e) => {
    const counts = new Map()
    for (const q of pts) { const key = gridCell(q, o, e).join(','); counts.set(key, (counts.get(key) ?? 0) + 1) }
    return counts
  }
  const shade = (c) => (!c ? '#ffffff' : c === 1 ? C.coveredSoft[0] : c === 2 ? '#a9c8ff' : C.covered[0])
  const panel = (ox, title, sub, o, e, toPx) => {
    const oy = 78
    const counts = occupancy(o, e)
    const cell = SIDE / G
    let s = txt(ox + SIDE / 2, 40, title, { size: 15, weight: '600', anchor: 'middle' })
    s += txt(ox + SIDE / 2, 60, sub, { size: 11.5, fill: C.sub, anchor: 'middle' })
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        s += `<rect x="${(ox + i * cell).toFixed(1)}" y="${(oy + j * cell).toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" fill="${shade(counts.get(`${i},${j}`))}" stroke="${C.gridLine}" stroke-width="0.7"/>`
      }
    }
    s += `<rect x="${ox}" y="${oy}" width="${SIDE}" height="${SIDE}" fill="none" stroke="${C.frame}" stroke-width="1.4"/>`
    // the data box, in this panel's pixels
    const [bx, by] = toPx(origin); const bs = toPx([origin[0] + extent, origin[1]])[0] - bx
    s += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bs.toFixed(1)}" height="${bs.toFixed(1)}" fill="none" stroke="${C.accent}" stroke-width="1.8" stroke-dasharray="5 3"/>`
    for (const q of pts) { const [x, y] = toPx(q); s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.3" fill="${C.point}"/>` }
    const used = counts.size
    const max = Math.max(...counts.values())
    s += txt(ox, oy + SIDE + 24, `${N} points in ${used} of ${G * G} cells — up to ${max} in one`, { size: 12.5, weight: '600' })
    return { s, used, max }
  }
  let b = ''
  // Space-anchored: panel = the space [0, 1]²
  const spacePx = (q) => [26 + q[0] * SIDE, 78 + q[1] * SIDE]
  const before = panel(26, 'Before: the grid covers the space', 'spaceSize / R per cell, counted from world zero', [0, 0], 1, spacePx)
  b += before.s
  // Data-anchored: panel = the data box
  const boxPx = (q) => [346 + ((q[0] - origin[0]) / extent) * SIDE, 78 + ((q[1] - origin[1]) / extent) * SIDE]
  const after = panel(346, 'Now: the grid covers the data', 'extent / R per cell, from this tick’s shifted origin', origin, extent, boxPx)
  b += after.s
  assert(before.used < after.used && before.max > after.max, 'the data-anchored grid must spread the points over more, emptier cells')
  b += `<rect x="26" y="${78 + SIDE + 36}" width="14" height="14" fill="none" stroke="${C.accent}" stroke-width="1.8" stroke-dasharray="5 3"/>`
  b += txt(46, 78 + SIDE + 47, 'data box: bounding square + one coarsest cell', { size: 12 })
  b += `<rect x="346" y="${78 + SIDE + 36}" width="14" height="14" fill="${C.coveredSoft[0]}" stroke="${C.gridLine}"/>`
  b += `<rect x="362" y="${78 + SIDE + 36}" width="14" height="14" fill="#a9c8ff" stroke="${C.gridLine}"/>`
  b += `<rect x="378" y="${78 + SIDE + 36}" width="14" height="14" fill="${C.covered[0]}" stroke="${C.gridLine}"/>`
  b += txt(398, 78 + SIDE + 47, '1 · 2 · 3+ points in a cell', { size: 12 })

  // The reduction that produces the box, every tick.
  const rx = 666
  b += txt(rx, 40, 'The box, every tick, on the GPU', { size: 15, weight: '600' })
  b += txt(rx, 60, 'three passes, never read back to the CPU', { size: 11.5, fill: C.sub })
  const stage = (y, size, divs, fill, lines) => {
    const x = rx + (40 - size) / 2
    let s = `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${fill}" stroke="${C.frame}" stroke-width="1.2"/>`
    for (let i = 1; i < divs; i++) {
      const d = (i * size) / divs
      s += `<line x1="${(x + d).toFixed(1)}" y1="${y}" x2="${(x + d).toFixed(1)}" y2="${y + size}" stroke="${C.gridLine}" stroke-width="0.7"/>`
      s += `<line x1="${x}" y1="${(y + d).toFixed(1)}" x2="${x + size}" y2="${(y + d).toFixed(1)}" stroke="${C.gridLine}" stroke-width="0.7"/>`
    }
    lines.forEach(([t, opts], i) => { s += txt(rx + 54, y + 13 + i * 16, t, { size: 12, ...opts }) })
    return s
  }
  const ys = [86, 160, 234, 300]
  const sizes = [40, 40, 26, 14]
  b += stage(ys[0], sizes[0], 6, '#f6f8fb', [['positions — one texel per point', { weight: '600' }], ['absent and non-finite skipped', { fill: C.sub }], ['(exponent bits, not a compare)', { fill: C.sub }]])
  b += stage(ys[1], sizes[1], 8, C.coveredSoft[1], [['64 × 64 partial boxes', { weight: '600' }], ['fragment b takes points', { fill: C.sub }], ['b, b + 4096, b + 2·4096, …', { fill: C.sub }]])
  b += stage(ys[2], sizes[2], 4, C.coveredSoft[1], [['8 × 8 — each folds an 8 × 8', { weight: '600' }], ['block of the partial boxes', { fill: C.sub }]])
  b += stage(ys[3], sizes[3], 1, '#f3eeff', [['1 texel', { weight: '600', fill: C.accent }], ['[originX, originY, extent, 1/extent]', { fill: C.accent }], ['squared, ≥ ¼ unit per finest cell,', { fill: C.sub }], ['padded ⅐, shifted each tick', { fill: C.sub }]])
  for (let i = 0; i < 3; i++) b += arrow(rx + 20, ys[i] + sizes[i] + 3, rx + 20, ys[i + 1] - 3, C.frame, 2)

  b += txt(W / 2, H - 32, 'Anchored to the space, a layout spanning a fraction f of each axis gets (f·R)² of the R² cells — 0.25/f² points per cell, not ≤ ⅓.', { size: 12.5, fill: C.sub, anchor: 'middle' })
  b += txt(W / 2, H - 14, 'Laid over the data, the average occupancy depends on the point count alone, wherever the layout sits and whatever its size.', { size: 12.5, fill: C.sub, anchor: 'middle' })
  fs.writeFileSync(path.join(OUT, 'i-grid-follows-data.svg'), svgDoc(W, H, b))
}

// ---------------------------------------------------------------- Diagram J
// Why a fixed grid draws lines: a point crossing a cell boundary swaps whole
// cells between "one centroid" and "refined by the next level" (coverage by
// force-level.frag's first-level rule), so the force jumps there. Shifting the
// grid every tick (reduce-bounds-final.frag: pad by one coarsest cell, slide
// the origin back by u of it) moves every boundary off any fixed line.
{
  const W = 980; const H = 486
  const SIDE = 264
  const G = 8 // the coarsest level: ForceManyBody's COARSEST_GRID_SIZE
  const oy = 78
  // Level 0 coverage for a point in cell pc: every cell except its 5×5 shell
  // (getShellRadius: radius 2 on every level but the finest)
  const roleOf = (i, j, pc) => (Math.max(Math.abs(i - pc[0]), Math.abs(j - pc[1])) <= 2 ? 'deferred' : 'centroid')
  const left = [0.49, 0.43]
  const right = [0.51, 0.43]
  const cellOf = (p) => [Math.floor(p[0] * G), Math.floor(p[1] * G)]
  const pcL = cellOf(left); const pcR = cellOf(right)
  assert(pcL[0] === G / 2 - 1 && pcR[0] === G / 2, 'the two points must straddle the centre line')
  let changed = 0
  const coverage = (ox, p, pc, other, title, sub) => {
    const cell = SIDE / G
    let s = txt(ox + SIDE / 2, 40, title, { size: 15, weight: '600', anchor: 'middle' })
    s += txt(ox + SIDE / 2, 60, sub, { size: 11.5, fill: C.sub, anchor: 'middle' })
    let outline = ''
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const role = roleOf(i, j, pc)
        const fill = role === 'centroid' ? C.coveredSoft[0] : C.deferred
        const x = ox + i * cell; const y = oy + j * cell
        s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" fill="${fill}" stroke="${C.gridLine}" stroke-width="0.7"/>`
        if (other && role !== roleOf(i, j, other)) {
          changed += 1
          outline += `<rect x="${(x + 1.5).toFixed(1)}" y="${(y + 1.5).toFixed(1)}" width="${(cell - 3).toFixed(1)}" height="${(cell - 3).toFixed(1)}" fill="none" stroke="${C.old}" stroke-width="2.2"/>`
        }
      }
    }
    s += outline
    s += `<rect x="${ox}" y="${oy}" width="${SIDE}" height="${SIDE}" fill="none" stroke="${C.frame}" stroke-width="1.4"/>`
    s += `<line x1="${ox + SIDE / 2}" y1="${oy - 6}" x2="${ox + SIDE / 2}" y2="${oy + SIDE + 6}" stroke="${C.accent}" stroke-width="1.6" stroke-dasharray="4 3"/>`
    s += `<circle cx="${(ox + p[0] * SIDE).toFixed(1)}" cy="${(oy + p[1] * SIDE).toFixed(1)}" r="5" fill="${C.point}"/>`
    return s
  }
  let b = ''
  b += coverage(26, left, pcL, null, 'Just left of the centre line', `level 0, ${G} × ${G}: centroids everywhere but its 5×5`)
  b += coverage(346, right, pcR, pcL, 'Just right of it', 'the 5×5 moved one column: ten cells changed hands')
  assert(changed === 10, `crossing one boundary must swap two columns of five cells (got ${changed})`)
  b += `<rect x="26" y="${oy + SIDE + 14}" width="14" height="14" fill="${C.coveredSoft[0]}" stroke="${C.gridLine}"/>`
  b += txt(46, oy + SIDE + 25, 'one centroid at this level', { size: 12 })
  b += `<rect x="26" y="${oy + SIDE + 36}" width="14" height="14" fill="${C.deferred}" stroke="${C.gridLine}"/>`
  b += txt(46, oy + SIDE + 47, 'refined by the finer levels', { size: 12 })
  b += `<rect x="346" y="${oy + SIDE + 14}" width="14" height="14" fill="none" stroke="${C.old}" stroke-width="2.2"/>`
  b += txt(366, oy + SIDE + 25, 'switched treatment: the force jumps', { size: 12 })
  b += `<line x1="346" y1="${oy + SIDE + 43}" x2="360" y2="${oy + SIDE + 43}" stroke="${C.accent}" stroke-width="1.6" stroke-dasharray="4 3"/>`
  b += txt(366, oy + SIDE + 47, 'a boundary on every level at once', { size: 12 })

  // Panel 3: one axis of the data square under three ticks' shifts
  const ox = 666
  const E = 1 // the fitted data square's side
  const cellPad = E / (G - 1) // reduce-bounds-final.frag: one coarsest cell of the padded box
  const span = E + 2 * cellPad // every shifted box fits in [-cellPad, E + cellPad]
  const toPx = (v) => ox + ((v + cellPad) / span) * SIDE
  b += txt(ox + SIDE / 2, 40, 'Shifted every tick', { size: 15, weight: '600', anchor: 'middle' })
  b += txt(ox + SIDE / 2, 60, 'one axis: box = data square + one coarsest cell', { size: 11.5, fill: C.sub, anchor: 'middle' })
  const shifts = [0.15, 0.4, 0.8]
  const rulerH = 22
  const rulerY = (k) => oy + 34 + k * 82
  shifts.forEach((u, k) => {
    const origin = -u * cellPad
    const extent = E + cellPad
    assert(origin <= 0 && origin + extent >= E, 'the shifted box must contain the data square')
    const y = rulerY(k)
    const color = C.covered[k]
    b += txt(ox, y - 10, `tick ${k + 1}: origin slid back ${u} of a cell`, { size: 12 })
    // the data square's span
    b += `<rect x="${toPx(0).toFixed(1)}" y="${y}" width="${(toPx(E) - toPx(0)).toFixed(1)}" height="${rulerH}" fill="#f3eeff"/>`
    // the shifted box and its cells
    b += `<rect x="${toPx(origin).toFixed(1)}" y="${y}" width="${(toPx(origin + extent) - toPx(origin)).toFixed(1)}" height="${rulerH}" fill="none" stroke="${color}" stroke-width="1.6"/>`
    for (let i = 1; i < G; i++) {
      const x = toPx(origin + (i * extent) / G)
      b += `<line x1="${x.toFixed(1)}" y1="${y}" x2="${x.toFixed(1)}" y2="${y + rulerH}" stroke="${color}" stroke-width="1.6"/>`
    }
    // The data's centre line: a boundary only when the slide is exactly half a cell
    assert(Math.abs(u - 0.5) > 0.05, 'pick shifts that keep a boundary off the centre line')
    const cx = toPx(E / 2)
    b += `<line x1="${cx.toFixed(1)}" y1="${y - 5}" x2="${cx.toFixed(1)}" y2="${y + rulerH + 5}" stroke="${C.accent}" stroke-width="1.8" stroke-dasharray="3 2"/>`
  })
  b += `<rect x="${ox}" y="${oy + SIDE + 14}" width="14" height="14" fill="#f3eeff"/>`
  b += txt(ox + 20, oy + SIDE + 25, 'the data square, fixed', { size: 12 })
  b += `<line x1="${ox}" y1="${oy + SIDE + 43}" x2="${ox + 14}" y2="${oy + SIDE + 43}" stroke="${C.accent}" stroke-width="1.6" stroke-dasharray="4 3"/>`
  b += txt(ox + 20, oy + SIDE + 47, 'its centre line, a fixed grid\u2019s boundary', { size: 12 })

  b += txt(W / 2, H - 32, 'On a fixed grid every coarsest-level boundary is a boundary on every level, so the jumps add up, most at the centre lines: a cross.', { size: 12.5, fill: C.sub, anchor: 'middle' })
  b += txt(W / 2, H - 14, 'Shifted by a uniform random part of one coarsest cell each tick, every boundary lands somewhere new, and the jumps average into a continuous force.', { size: 12.5, fill: C.sub, anchor: 'middle' })
  fs.writeFileSync(path.join(OUT, 'j-grid-seams.svg'), svgDoc(W, H, b))
}

console.log('generated:', fs.readdirSync(OUT).join(', '))
