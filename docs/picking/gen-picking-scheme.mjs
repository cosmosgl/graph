// Regenerates the picking-map scheme SVG for this folder. Run from here:
//   node gen-picking-scheme.mjs
// Illustrates the screen-space buffers behind hover picking (see
// history/2026/2026-07-09-picking.md): points rasterized as index-carrying
// sprites at half resolution with a 9x9 cursor window (nearest valid pixel
// wins), and the full-resolution link index buffer sampled at the single
// cursor pixel. Same visual language as docs/many-body-force/*.svg.
// Keep the numbers in sync with src/modules/Points/picking-constants.ts, then
// re-run so the diagram doesn't fossilize.
import { writeFile } from 'node:fs/promises'

const FONT = 'ui-sans-serif, system-ui, -apple-system, sans-serif'
const C = {
  bg: '#ffffff',
  panel: '#fafbfd',
  panelBorder: '#94a3b8',
  title: '#1e293b',
  caption: '#64748b',
  accent: '#7c3aed',
  grid: '#e2e8f0',
  link: '#8b9dc0',
  linkHit: '#3a86ff',
}

// Shared layout scale: panel-local px. Point map cell = 20px = one half-res
// buffer pixel; link buffer cell = 10px = one full-res pixel (2x finer).
const CELL = 20
const COLS = 21
const ROWS = 20
const GRID_W = COLS * CELL
const GRID_H = ROWS * CELL
const CELL_L = 10
const COLS_L = 42
const ROWS_L = 40

// [cx, cy, r, color, index]
const POINTS = [
  [80, 90, 22, '#5f69de', 0],
  [200, 70, 15, '#de695f', 1],
  [352, 84, 26, '#5fdea9', 2],
  [150, 240, 20, '#decb5f', 3],
  [320, 300, 18, '#a95fde', 4],
  [70, 322, 14, '#3a86ff', 5],
  [240, 370, 24, '#de695f', 6],
]
// [source point, target point]; link 4 (5->2) passes under the cursor.
const LINKS = [[0, 1], [0, 3], [2, 4], [3, 6], [5, 2], [4, 6]]
const HIT_LINK = 4
const CURSOR = [192, 212]
const PICKED = 3
const WINDOW = 9 // cells
const cursorCell = [Math.floor(CURSOR[0] / CELL), Math.floor(CURSOR[1] / CELL)]
const winX = Math.min(Math.max(cursorCell[0] - 4, 0), COLS - WINDOW)
const winY = Math.min(Math.max(cursorCell[1] - 4, 0), ROWS - WINDOW)
const cursorCellL = [Math.floor(CURSOR[0] / CELL_L), Math.floor(CURSOR[1] / CELL_L)]

const W = 950
const H = 1170
const PANEL_Y = 52
const PANEL_H = 470
const PANEL2_Y = PANEL_Y + PANEL_H + 64
const AX = 20; const AW = 440
const BX = 490; const BW = 440
const INSET_X = 10; const INSET_Y = 26

const parts = []

function text (x, y, s, { size = 12.5, color = C.caption, weight = 'normal', anchor = 'start', halo = false } = {}) {
  const haloAttrs = halo ? ` paint-order="stroke" stroke="${C.panel}" stroke-width="3.5"` : ''
  parts.push(`<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="${weight}"${haloAttrs}>${s}</text>`)
}

parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`)
parts.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`)
parts.push(`<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>`)

// ---------------------------------------------------------------- Panel A
parts.push(`<rect x="${AX}" y="${PANEL_Y}" width="${AW}" height="${PANEL_H}" rx="10" fill="${C.panel}" stroke="${C.panelBorder}"/>`)
text(AX + 16, 34, 'What you see on screen', { size: 16, color: C.title, weight: '600' })

const aox = AX + INSET_X; const aoy = PANEL_Y + INSET_Y
// Links beneath points
for (const [s, t] of LINKS) {
  const a = POINTS[s]; const b = POINTS[t]
  parts.push(`<line x1="${aox + a[0]}" y1="${aoy + a[1]}" x2="${aox + b[0]}" y2="${aoy + b[1]}" stroke="${C.link}" stroke-width="2.5" stroke-opacity="0.8"/>`)
}
for (const [cx, cy, r, color] of POINTS) {
  parts.push(`<circle cx="${aox + cx}" cy="${aoy + cy}" r="${r}" fill="${color}"/>`)
}
const [mx, my] = [aox + CURSOR[0], aoy + CURSOR[1]]
parts.push(`<path d="M ${mx} ${my} l 0 16.5 l 3.8 -3.6 l 2.6 6 l 3.4 -1.5 l -2.6 -5.9 l 5.3 -0.4 z" fill="#0f172a" stroke="#ffffff" stroke-width="1.2"/>`)
text(mx + 16, my + 8, 'cursor — on link 4,', { size: 12, halo: true })
text(mx + 16, my + 24, 'near (not on) point 3', { size: 12, halo: true })

text(AX + 16, PANEL_Y + PANEL_H - 34, 'Hover needs to answer: which point (or link) is under the cursor?', { size: 12.5 })
text(AX + 16, PANEL_Y + PANEL_H - 17, 'Asking the GPU per mouse move used to cost O(elements).', { size: 12.5 })

// ---------------------------------------------------------------- Panel B
parts.push(`<rect x="${BX}" y="${PANEL_Y}" width="${BW}" height="${PANEL_H}" rx="10" fill="${C.panel}" stroke="${C.panelBorder}"/>`)
text(BX + 16, 34, 'The point picking map (half resolution)', { size: 16, color: C.title, weight: '600' })

const box = BX + INSET_X; const boy = PANEL_Y + INSET_Y

const cellOwner = new Map()
for (const p of POINTS) {
  const [cx, cy, r] = p
  const c0x = Math.max(0, Math.floor((cx - r) / CELL)); const c1x = Math.min(COLS - 1, Math.floor((cx + r) / CELL))
  const c0y = Math.max(0, Math.floor((cy - r) / CELL)); const c1y = Math.min(ROWS - 1, Math.floor((cy + r) / CELL))
  for (let gy = c0y; gy <= c1y; gy++) {
    for (let gx = c0x; gx <= c1x; gx++) {
      const dx = gx * CELL + CELL / 2 - cx; const dy = gy * CELL + CELL / 2 - cy
      if (dx * dx + dy * dy <= (r + 4) * (r + 4)) cellOwner.set(`${gx},${gy}`, p)
    }
  }
}
for (const [key, p] of cellOwner) {
  const [gx, gy] = key.split(',').map(Number)
  parts.push(`<rect x="${box + gx * CELL}" y="${boy + gy * CELL}" width="${CELL}" height="${CELL}" fill="${p[3]}" fill-opacity="0.55"/>`)
}
for (let gx = 0; gx <= COLS; gx++) parts.push(`<line x1="${box + gx * CELL}" y1="${boy}" x2="${box + gx * CELL}" y2="${boy + GRID_H}" stroke="${C.grid}" stroke-width="1"/>`)
for (let gy = 0; gy <= ROWS; gy++) parts.push(`<line x1="${box}" y1="${boy + gy * CELL}" x2="${box + GRID_W}" y2="${boy + gy * CELL}" stroke="${C.grid}" stroke-width="1"/>`)

for (const [cx, cy, , , index] of POINTS) {
  const gx = Math.floor(cx / CELL); const gy = Math.floor(cy / CELL)
  text(box + gx * CELL + CELL / 2, boy + gy * CELL + CELL / 2 + 4, String(index), { size: 12, color: '#0f172a', weight: '700', anchor: 'middle' })
}
const emptyLabels = [[6, 7], [11, 8], [9, 12], [12, 13]]
for (const [gx, gy] of emptyLabels) {
  if (!cellOwner.has(`${gx},${gy}`)) {
    text(box + gx * CELL + CELL / 2, boy + gy * CELL + CELL / 2 + 3.5, '−1', { size: 9, color: '#b6c0cf', anchor: 'middle' })
  }
}

parts.push(`<rect x="${box + winX * CELL}" y="${boy + winY * CELL}" width="${WINDOW * CELL}" height="${WINDOW * CELL}" fill="none" stroke="${C.accent}" stroke-width="2.5"/>`)
parts.push(`<rect x="${box + cursorCell[0] * CELL}" y="${boy + cursorCell[1] * CELL}" width="${CELL}" height="${CELL}" fill="none" stroke="#0f172a" stroke-width="2" stroke-dasharray="3 2"/>`)

const nearCell = [8, 11]
parts.push(`<line x1="${box + cursorCell[0] * CELL + 2}" y1="${boy + cursorCell[1] * CELL + CELL - 2}" x2="${box + nearCell[0] * CELL + CELL - 6}" y2="${boy + nearCell[1] * CELL + 8}" stroke="${C.accent}" stroke-width="2.4" marker-end="url(#arr)"/>`)

const winRight = box + (winX + WINDOW) * CELL
parts.push(`<rect x="${winRight + 4}" y="${boy + winY * CELL - 4}" width="132" height="100" rx="6" fill="${C.panel}" fill-opacity="0.92"/>`)
text(winRight + 8, boy + winY * CELL + 10, '9×9 window read', { size: 12, color: C.accent, weight: '600' })
text(winRight + 8, boy + winY * CELL + 26, 'under the cursor:', { size: 12, color: C.accent })
text(winRight + 8, boy + winY * CELL + 42, 'nearest valid pixel', { size: 12, color: C.accent })
text(winRight + 8, boy + winY * CELL + 58, `wins — point ${PICKED}, even`, { size: 12, color: C.accent, weight: '600' })
text(winRight + 8, boy + winY * CELL + 74, 'though the cursor', { size: 12, color: C.accent })
text(winRight + 8, boy + winY * CELL + 90, 'is not touching it', { size: 12, color: C.accent })

text(BX + 16, PANEL_Y + PANEL_H - 34, 'Each pixel stores [point index, x, y]; empty pixels hold −1.', { size: 12.5 })
text(BX + 16, PANEL_Y + PANEL_H - 17, 'Rendered by the GPU for all pixels at once, at half resolution.', { size: 12.5 })

// ---------------------------------------------------------------- Panel C
parts.push(`<rect x="${AX}" y="${PANEL2_Y}" width="${AW}" height="${PANEL_H}" rx="10" fill="${C.panel}" stroke="${C.panelBorder}"/>`)
text(AX + 16, PANEL2_Y - 18, 'The link index buffer (full resolution)', { size: 16, color: C.title, weight: '600' })

const cox = AX + INSET_X; const coy = PANEL2_Y + INSET_Y

// Rasterize links into full-res cells (later links win, like draw order)
const linkCells = new Map()
LINKS.forEach(([s, t], li) => {
  const a = POINTS[s]; const b = POINTS[t]
  const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL_L / 2))
  for (let i = 0; i <= steps; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / steps
    const y = a[1] + ((b[1] - a[1]) * i) / steps
    const gx = Math.floor(x / CELL_L); const gy = Math.floor(y / CELL_L)
    if (gx >= 0 && gx < COLS_L && gy >= 0 && gy < ROWS_L) linkCells.set(`${gx},${gy}`, li)
  }
})
for (const [key, li] of linkCells) {
  const [gx, gy] = key.split(',').map(Number)
  const hit = li === HIT_LINK
  parts.push(`<rect x="${cox + gx * CELL_L}" y="${coy + gy * CELL_L}" width="${CELL_L}" height="${CELL_L}" fill="${hit ? C.linkHit : C.link}" fill-opacity="${hit ? 0.6 : 0.45}"/>`)
}
// Finer grid: 2x the density of the point map — full resolution
for (let gx = 0; gx <= COLS_L; gx++) parts.push(`<line x1="${cox + gx * CELL_L}" y1="${coy}" x2="${cox + gx * CELL_L}" y2="${coy + ROWS_L * CELL_L}" stroke="${C.grid}" stroke-width="0.5"/>`)
for (let gy = 0; gy <= ROWS_L; gy++) parts.push(`<line x1="${cox}" y1="${coy + gy * CELL_L}" x2="${cox + COLS_L * CELL_L}" y2="${coy + gy * CELL_L}" stroke="${C.grid}" stroke-width="0.5"/>`)

// Label two links near their midpoints
for (const li of [1, HIT_LINK]) {
  const [s, t] = LINKS[li]
  const a = POINTS[s]; const b = POINTS[t]
  const lx = (a[0] + b[0]) / 2 + 10; const ly = (a[1] + b[1]) / 2 - 6
  text(cox + lx, coy + ly, String(li), { size: 11, color: li === HIT_LINK ? C.linkHit : C.caption, weight: '700', halo: true })
}

// Cursor pixel (1x1 at full res)
parts.push(`<rect x="${cox + cursorCellL[0] * CELL_L - 1}" y="${coy + cursorCellL[1] * CELL_L - 1}" width="${CELL_L + 2}" height="${CELL_L + 2}" fill="none" stroke="#0f172a" stroke-width="2" stroke-dasharray="3 2"/>`)
parts.push(`<line x1="${cox + cursorCellL[0] * CELL_L + 26}" y1="${coy + cursorCellL[1] * CELL_L - 18}" x2="${cox + cursorCellL[0] * CELL_L + CELL_L + 2}" y2="${coy + cursorCellL[1] * CELL_L}" stroke="${C.accent}" stroke-width="2" marker-end="url(#arr)"/>`)
parts.push(`<rect x="${cox + cursorCellL[0] * CELL_L + 28}" y="${coy + cursorCellL[1] * CELL_L - 62}" width="164" height="54" rx="6" fill="${C.panel}" fill-opacity="0.92"/>`)
text(cox + cursorCellL[0] * CELL_L + 32, coy + cursorCellL[1] * CELL_L - 48, '1×1 read at the cursor', { size: 12, color: C.accent, weight: '600' })
text(cox + cursorCellL[0] * CELL_L + 32, coy + cursorCellL[1] * CELL_L - 32, `→ link ${HIT_LINK}. Applied only if no`, { size: 12, color: C.accent })
text(cox + cursorCellL[0] * CELL_L + 32, coy + cursorCellL[1] * CELL_L - 16, `point picked — here point ${PICKED} wins`, { size: 12, color: C.accent })

text(AX + 16, PANEL2_Y + PANEL_H - 34, 'Each pixel stores [link index, 0, 0, validity]; alpha 0 = empty.', { size: 12.5 })
text(AX + 16, PANEL2_Y + PANEL_H - 17, 'Same link draw shader, switched to index mode (renderMode = 1).', { size: 12.5 })

// ---------------------------------------------------------------- Notes
const NX = BX + 16
let ny = PANEL2_Y + 10
text(NX, ny, 'How link picking differs', { size: 16, color: C.title, weight: '600' })
ny += 30
const bullets = [
  ['Full resolution, not half —', 'a 1-pixel-wide link would fall between half-res texels.'],
  ['A single 1×1 pixel read —', 'links are thin, so no window scan or nearest-candidate logic.'],
  ['Alpha gates pickability —', 'a fully transparent link writes nothing and cannot be hovered.'],
  ['Dashes stay solid here —', 'the dash mask applies only to the visible pass, so dashed links', 'are pickable along their whole length, gaps included.'],
  ['Hover hysteresis —', 'the hovered link is re-drawn wider in this buffer, so it is easier', 'to keep a link hovered than to acquire it.'],
  ['Points win —', 'the link result applies only when no point was picked. Here the', `cursor sits on link ${HIT_LINK}, but point ${PICKED} from the 9×9 window takes priority.`],
]
for (const [head, ...rest] of bullets) {
  parts.push(`<circle cx="${NX + 4}" cy="${ny - 4}" r="3" fill="${C.accent}"/>`)
  text(NX + 16, ny, head, { size: 13, color: C.title, weight: '600' })
  ny += 19
  for (const line of rest) {
    text(NX + 16, ny, line, { size: 12.5 })
    ny += 19
  }
  ny += 9
}

ny += 4
text(NX, ny, 'Both buffers share one lifecycle', { size: 14, color: C.title, weight: '600' })
ny += 22
for (const line of [
  'Re-rendered only when marked stale: points move, data or config',
  'changes, zoom, resize, hover change. Read back asynchronously',
  '(PBO + fence) — the hover path never stalls the GPU pipeline.',
]) {
  text(NX, ny, line, { size: 12.5 })
  ny += 19
}

// ---------------------------------------------------------------- Legend + caption
const LY = PANEL2_Y + PANEL_H + 30
parts.push(`<rect x="${AX + 2}" y="${LY - 11}" width="13" height="13" fill="#decb5f" fill-opacity="0.55" stroke="${C.grid}"/>`)
text(AX + 21, LY, 'pixels covered by a point', { size: 12 })
parts.push(`<rect x="${AX + 190}" y="${LY - 11}" width="13" height="13" fill="${C.link}" fill-opacity="0.45" stroke="${C.grid}"/>`)
text(AX + 209, LY, 'pixels covered by a link', { size: 12 })
parts.push(`<rect x="${AX + 375}" y="${LY - 11}" width="13" height="13" fill="#ffffff" stroke="${C.grid}"/>`)
text(AX + 394, LY, 'empty', { size: 12 })
parts.push(`<rect x="${AX + 460}" y="${LY - 11}" width="13" height="13" fill="none" stroke="${C.accent}" stroke-width="2"/>`)
text(AX + 479, LY, 'read window', { size: 12 })
parts.push(`<rect x="${AX + 575}" y="${LY - 11}" width="13" height="13" fill="none" stroke="#0f172a" stroke-width="1.6" stroke-dasharray="3 2"/>`)
text(AX + 594, LY, 'cursor pixel', { size: 12 })

text(AX, LY + 30, 'The maps refresh only when the scene changes — a still scene does no picking work. A hover then reads 81 pixels for points', { size: 13, color: C.title })
text(AX, LY + 48, 'and 1 pixel for links, so it costs the same at 300 elements or 300,000.', { size: 13, color: C.title })

parts.push('</svg>')
await writeFile(new URL('./picking-scheme.svg', import.meta.url), parts.join('\n'))
console.log('wrote picking-scheme.svg')
