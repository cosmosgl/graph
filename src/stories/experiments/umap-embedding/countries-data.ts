/**
 * Real-data input for the UMAP embedding stories: ~190 countries described by
 * ~30 numeric development indicators (GDP, health/education spending, governance
 * scores, freedom indices, …). The CSV is parsed and turned into z-scored
 * feature vectors; heavy-tailed columns (population, GDP, …) are log-transformed
 * first, and missing values ("-") are imputed with the column mean.
 */

import countriesCsv from './countries.csv?raw'

export type CountriesData = {
  /** Country names, index-aligned with the vectors */
  names: string[];
  /** `n * dim` row-major z-scored feature vectors */
  vectors: Float32Array;
  dim: number;
  /** Human development index per country (NaN when missing) — used for color */
  hdi: Float32Array;
  /** Population per country (NaN when missing) — used for point size */
  population: Float32Array;
}

/** Minimal CSV parser: handles quoted fields with embedded commas and newlines. */
const parseCsv = (text: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.some((f) => f.trim() !== '')) rows.push(row)
  }
  return rows
}

/** Columns spanning orders of magnitude get a log10 transform before z-scoring. */
const LOG_COLUMNS = new Set([
  'population',
  'surface area (km²)',
  'GDP (billions PPP)',
  'GDP per capita (PPP)',
  'health expenditure per person (int. $)',
  'education expenditure per person ($)',
])

/** Countries missing more than this fraction of indicators are dropped. */
const MAX_MISSING_FRACTION = 0.4

export const loadCountries = (): CountriesData => {
  const rows = parseCsv(countriesCsv)
  const header = (rows[0] as string[]).map((h) => h.replace(/\s+/g, ' ').trim())
  // Column 0 is the country name, column 1 the ISO code — the rest are numeric.
  const featureColumns: number[] = []
  for (let c = 2; c < header.length; c++) featureColumns.push(c)
  const dim = featureColumns.length

  const hdiColumn = header.indexOf('human development index')
  const populationColumn = header.indexOf('population')

  const names: string[] = []
  const raw: number[][] = []
  const hdiValues: number[] = []
  const populationValues: number[] = []

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as string[]
    const values = featureColumns.map((c) => {
      const v = parseFloat((row[c] ?? '').trim())
      return Number.isFinite(v) ? v : NaN
    })
    const missing = values.filter((v) => Number.isNaN(v)).length / dim
    if (missing > MAX_MISSING_FRACTION) continue
    names.push((row[0] as string).trim())
    raw.push(values)
    const hdi = parseFloat((row[hdiColumn] ?? '').trim())
    hdiValues.push(Number.isFinite(hdi) ? hdi : NaN)
    const population = parseFloat((row[populationColumn] ?? '').trim())
    populationValues.push(Number.isFinite(population) ? population : NaN)
  }

  const n = raw.length
  const vectors = new Float32Array(n * dim)
  for (let d = 0; d < dim; d++) {
    const isLog = LOG_COLUMNS.has(header[(featureColumns[d] as number)] as string)
    const column = raw.map((values) => {
      const v = values[d] as number
      return isLog && Number.isFinite(v) ? Math.log10(Math.max(v, 0) + 1) : v
    })
    const present = column.filter((v) => !Number.isNaN(v))
    const mean = present.reduce((a, b) => a + b, 0) / Math.max(present.length, 1)
    const variance = present.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(present.length, 1)
    const std = Math.sqrt(variance) || 1
    for (let i = 0; i < n; i++) {
      const v = column[i] as number
      vectors[i * dim + d] = Number.isNaN(v) ? 0 : (v - mean) / std
    }
  }

  return {
    names,
    vectors,
    dim,
    hdi: new Float32Array(hdiValues),
    population: new Float32Array(populationValues),
  }
}

/** Three-stop gradient over the HDI range (low → red, mid → sand, high → teal). */
export const hdiColors = (hdi: Float32Array): Float32Array => {
  const stops = [
    [0.88, 0.36, 0.36], // ~0.35 HDI
    [0.93, 0.78, 0.36], // ~0.65 HDI
    [0.30, 0.76, 0.72], // ~0.95 HDI
  ]
  const colors = new Float32Array(hdi.length * 4)
  hdi.forEach((v, i) => {
    let rgb = [0.6, 0.6, 0.6] // missing HDI
    if (!Number.isNaN(v)) {
      const t = Math.min(1, Math.max(0, (v - 0.35) / 0.6)) * 2
      const [a, b] = t < 1 ? [stops[0], stops[1]] : [stops[1], stops[2]]
      const f = t < 1 ? t : t - 1
      rgb = (a as number[]).map((c, ch) => c + ((b as number[])[ch] as number - c) * f)
    }
    colors[i * 4] = rgb[0] as number
    colors[i * 4 + 1] = rgb[1] as number
    colors[i * 4 + 2] = rgb[2] as number
    colors[i * 4 + 3] = 1
  })
  return colors
}

/** Point sizes from log-population (missing population → smallest size). */
export const populationSizes = (population: Float32Array, minSize = 4, maxSize = 34): Float32Array => {
  const logs = Array.from(population).map((p) => (Number.isNaN(p) ? NaN : Math.log10(p + 1)))
  const present = logs.filter((v) => !Number.isNaN(v))
  const min = Math.min(...present)
  const max = Math.max(...present)
  const sizes = new Float32Array(population.length)
  logs.forEach((v, i) => {
    const t = Number.isNaN(v) ? 0 : (v - min) / Math.max(max - min, 1e-9)
    sizes[i] = minSize + t * (maxSize - minSize)
  })
  return sizes
}
