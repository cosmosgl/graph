import type { Device } from '@luma.gl/core'

// A destroyed luma device must not be rediscovered through the old canvas context.
export function replaceCanvas (previous: HTMLCanvasElement): HTMLCanvasElement {
  const next = previous.cloneNode(false) as HTMLCanvasElement
  previous.replaceWith(next)
  return next
}
export function describeEnvironment (device: Device, canvas: HTMLCanvasElement): {
  browser: string; device: Device['info']; timestamps: boolean; visible: boolean;
  canvas: { width: number; height: number; cssWidth: number; cssHeight: number; dpr: number };
} {
  const rect = canvas.getBoundingClientRect()
  return {
    browser: navigator.userAgent,
    device: device.info,
    timestamps: device.features.has('timestamp-query'),
    visible: document.visibilityState === 'visible',
    canvas: { width: canvas.width, height: canvas.height, cssWidth: rect.width, cssHeight: rect.height, dpr: window.devicePixelRatio },
  }
}
