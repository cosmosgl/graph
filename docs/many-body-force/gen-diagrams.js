// Regenerates the SVG diagrams for this folder. Run from here:
//   node gen-diagrams.js .
// Grid-coverage panels compute cell coverage with the SAME rules as the
// shaders (first level: whole grid minus 3×3; others: 6×6 child block minus
// 3×3), so the pictures are exact, not artistic impressions. Keep this script
// in sync with force-level.frag / build-nearfield-slots.vert when the algorithm
// changes, then re-run it so the diagrams don't fossilize.
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
{
  const W = 980; const H = 460
  const SIDE = 264 // panel pixel size of the square space
  const p = [0.58, 0.36] // the point, in space coordinates 0..1
  const levels = [4, 8, 16]
  let b = ''

  levels.forEach((g, li) => {
    const ox = 26 + li * 320; const oy = 78
    const cell = SIDE / g
    const pc = [Math.floor(p[0] * g), Math.floor(p[1] * g)]
    // coverage per shader: first level = whole grid minus 3×3;
    // later levels = 6×6 child block (base = (pc>>1)<<1 - 2) minus 3×3
    const base = [(pc[0] >> 1 << 1) - 2, (pc[1] >> 1 << 1) - 2]
    for (let j = 0; j < g; j++) {
      for (let i = 0; i < g; i++) {
        const cheb = Math.max(Math.abs(i - pc[0]), Math.abs(j - pc[1]))
        const inBlock = li === 0 || (i >= base[0] && i < base[0] + 6 && j >= base[1] && j < base[1] + 6)
        let fill = '#ffffff'
        if (inBlock && cheb >= 2) fill = C.coveredSoft[li]
        else if (inBlock && cheb <= 1) fill = li === levels.length - 1 ? C.nearSoft : C.deferred
        b += `<rect x="${(ox + i * cell).toFixed(1)}" y="${(oy + j * cell).toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" fill="${fill}" stroke="${C.gridLine}" stroke-width="0.7"/>`
      }
    }
    // frame + point
    b += `<rect x="${ox}" y="${oy}" width="${SIDE}" height="${SIDE}" fill="none" stroke="${C.frame}" stroke-width="1.4"/>`
    b += `<circle cx="${ox + p[0] * SIDE}" cy="${oy + p[1] * SIDE}" r="5" fill="${C.point}"/>`
    b += txt(ox + SIDE / 2, 40, `Level ${li}: ${g} × ${g} cells`, { size: 15, weight: '600', anchor: 'middle' })
    const covLabel = li === 0
      ? 'whole space minus the 3×3 shell'
      : 'previous 3×3 refined, minus its own 3×3'
    b += txt(ox + SIDE / 2, 60, covLabel, { size: 11.5, fill: C.sub, anchor: 'middle' })
    // legend chip
    b += `<rect x="${ox}" y="${oy + SIDE + 14}" width="14" height="14" fill="${C.coveredSoft[li]}" stroke="${C.gridLine}"/>`
    b += txt(ox + 20, oy + SIDE + 25, li === levels.length - 1 ? 'centroid force at this level' : 'centroid force at this level', { size: 12 })
    b += `<rect x="${ox}" y="${oy + SIDE + 36}" width="14" height="14" fill="${li === levels.length - 1 ? C.nearSoft : C.deferred}" stroke="${C.gridLine}"/>`
    b += txt(ox + 20, oy + SIDE + 47, li === levels.length - 1 ? '3×3 → near field (Monte-Carlo pairs)' : '3×3 → deferred to the next level', { size: 12 })
    if (li < levels.length - 1) b += arrow(ox + SIDE + 14, oy + SIDE / 2, ox + SIDE + 44, oy + SIDE / 2, C.frame, 2.5)
  })
  b += txt(W / 2, H - 14, 'Every region of space is charged to exactly one pass — no gaps, no double counting. The finest grid adapts to n (≈ 2·√n cells per axis, 8²…512²).', { size: 13, fill: C.sub, anchor: 'middle' })
  fs.writeFileSync(path.join(OUT, 'b-grid-pyramid.svg'), svgDoc(W, H, b))
}

// ---------------------------------------------------------------- Diagram C
// Depth peeling K=8 random slots per cell + Horvitz–Thompson weighting.
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
  b += txt(cellX, cellY + cellS + 28, 'sampled (8 smallest hashes)', { size: 12, fill: C.covered[0] })
  b += `<circle cx="${cellX + 190}" cy="${cellY + cellS + 24}" r="7" fill="#fff" stroke="#b9c3d3" stroke-width="2"/>`
  b += txt(cellX + 202, cellY + cellS + 28, 'left out', { size: 12, fill: C.sub })

  // Peeling passes → slot textures
  const sx = 380; const sy = 78
  b += txt(sx, 40, '8 depth-peeling passes → 8 slot textures', { size: 15, weight: '600' })
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
  b += txt(ex + 16, ey + 166, '≤ 8 points in cell → exact.', { size: 13, weight: '600' })
  b += txt(ex, ey + 210, 'A fresh random subset every tick:', { size: 12.5, fill: C.sub })
  b += txt(ex, ey + 228, 'the sampling noise shrinks with alpha', { size: 12.5, fill: C.sub })
  b += txt(ex, ey + 246, 'and acts as annealing jitter.', { size: 12.5, fill: C.sub })
  fs.writeFileSync(path.join(OUT, 'c-depth-peeling.svg'), svgDoc(W, H, b))
}

// ---------------------------------------------------------------- Diagram D
// The per-tick GPU pipeline.
{
  const W = 980; const H = 300
  let b = ''
  const box = (x, y, w, h, title, lines, color, soft) => {
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${soft}" stroke="${color}" stroke-width="1.6"/>`
    s += txt(x + w / 2, y + 24, title, { size: 13.5, weight: '600', anchor: 'middle', fill: color })
    lines.forEach((l, i) => { s += txt(x + w / 2, y + 46 + i * 17, l, { size: 11.5, anchor: 'middle', fill: C.text }) })
    return s
  }
  const midY = 96
  b += txt(20, 40, 'One simulation tick of the repulsion force (all on the GPU)', { size: 16, weight: '600' })
  b += box(20, midY, 150, 110, 'positions', ['one texel per point', '(x, y)'], C.frame, '#f6f8fb')
  b += arrow(170, midY + 55, 208, midY + 55, C.frame, 2.5)
  b += box(210, midY, 220, 110, '1 · aggregate levels', ['draw n points into each grid,', 'additive blend accumulates', '[Σx, Σy, count] per cell'], C.covered[1], C.coveredSoft[1])
  b += arrow(430, midY + 55, 468, midY + 55, C.frame, 2.5)
  b += box(470, midY, 220, 110, '2 · build near-field slots', ['8 depth-peel passes over the', 'finest grid: a fresh random', '8-subset per cell, every tick'], C.covered[0], C.coveredSoft[0])
  b += arrow(690, midY + 55, 728, midY + 55, C.frame, 2.5)
  b += box(730, midY, 230, 110, '3 · force passes', ['per level: centroid repulsion', '+ near field: weighted pairs;', 'all add into the velocity texture'], C.covered[2], C.coveredSoft[2])
  b += txt(20, 250, 'The integration step (velocity → positions) is shared with all other forces and unchanged.', { size: 12.5, fill: C.sub })
  b += txt(20, 272, 'Levels: 4², 8², … up to ≈ 2·√n per axis (capped 512²). Slot textures: 8 × finest grid, [point index, hash] each.', { size: 12.5, fill: C.sub })
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

console.log('generated:', fs.readdirSync(OUT).join(', '))
