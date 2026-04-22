/** Load a source image and sample RGBA per point on a fixed story grid. */

/** Bryullov, Horsewoman, 1832 (see horsewoman-by-bryullov-1832.jpg). */
const defaultPictureUrl = new URL('./horsewoman-by-bryullov-1832.jpg', import.meta.url).href

const POINT_GRID_COLS = 400
const POINT_GRID_ROWS = 500

function loadImage (url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = (): void => resolve(img)
    img.onerror = (): void => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}

function sampleImageToPointColors (
  img: HTMLImageElement,
  cols: number,
  rows: number
): Float32Array {
  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('Could not get 2D canvas context.')
  }
  // Graph coordinates are Y-up, so flip once while drawing to keep sampling simple.
  ctx.save()
  ctx.translate(0, rows)
  ctx.scale(1, -1)
  ctx.drawImage(img, 0, 0, cols, rows)
  ctx.restore()
  const { data } = ctx.getImageData(0, 0, cols, rows)
  const out = new Float32Array(cols * rows * 4)
  for (const [i, value] of data.entries()) {
    out[i] = value / 255
  }
  return out
}

export async function loadPointData (
  imageUrl: string = defaultPictureUrl
): Promise<{
  cols: number;
  rows: number;
  aspect: number;
  colors: Float32Array;
}> {
  const img = await loadImage(imageUrl)
  const aspect = img.width / img.height
  const cols = POINT_GRID_COLS
  const rows = POINT_GRID_ROWS
  const colors = sampleImageToPointColors(img, cols, rows)
  return { cols, rows, aspect, colors }
}
