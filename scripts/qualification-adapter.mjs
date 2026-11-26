// Luma's normalized GPU vendor is available even on some ANGLE devices
// that report the browser or translation layer as the WebGL vendor.
export function requestedGpuVendor(value) {
  if (value === undefined) return undefined
  const vendor = value.toLowerCase()
  if (!['apple', 'intel', 'amd', 'nvidia'].includes(vendor)) {
    throw new Error('Expected --adapter-vendor apple, intel, amd or nvidia')
  }
  return vendor
}

export function checkNativeGpu(info, engine, vendor) {
  const namedVendor = info.gpu === vendor ||
    (info.gpu === 'unknown' && info.vendor.toLowerCase().includes(vendor))
  if (info.type !== engine || info.gpuType === 'cpu' || !namedVendor ||
      (engine === 'webgpu' && info.fallback !== false)) {
    throw new Error(`Expected native ${vendor} ${engine}, found ${JSON.stringify(info)}`)
  }
}
