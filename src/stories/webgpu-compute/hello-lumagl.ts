import { ComputeManager, ComputeSettings } from '@cosmos.gl/graph'
import { BouncingDisksApp, BouncingDisksAppConfig, OnTickCallback } from './app'
import { NativePointRenderer } from './native-renderer'

export const helloLumagl = async (): Promise<{ div: HTMLDivElement; destroy: () => void }> => {
  // Create the main container div
  const div = document.createElement('div')
  div.style.display = 'flex'
  div.style.flexDirection = 'column'
  div.style.justifyContent = 'center'
  div.style.alignItems = 'center'
  div.style.minHeight = '100vh'
  div.style.backgroundColor = '#f5f5f5'
  div.style.gap = '20px'

  // Create the native canvas element (above)
  const nativeCanvas = document.createElement('canvas')
  const displayWidth = 400
  const displayHeight = 300
  const devicePixelRatio = window.devicePixelRatio || 1

  // Set the display size (CSS pixels)
  nativeCanvas.style.width = `${displayWidth}px`
  nativeCanvas.style.height = `${displayHeight}px`
  nativeCanvas.style.border = '2px solid #ccc'
  nativeCanvas.style.borderRadius = '8px'
  nativeCanvas.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)'
  nativeCanvas.style.backgroundColor = '#ffffff'

  // Set the actual canvas size accounting for device pixel ratio
  nativeCanvas.width = displayWidth * devicePixelRatio
  nativeCanvas.height = displayHeight * devicePixelRatio

  // Create the WebGPU canvas element (below)
  const canvas = document.createElement('canvas')

  // Set the display size (CSS pixels)
  canvas.style.width = `${displayWidth}px`
  canvas.style.height = `${displayHeight}px`
  canvas.style.border = '2px solid #ccc'
  canvas.style.borderRadius = '8px'
  canvas.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)'
  canvas.style.backgroundColor = '#ffffff'

  // Set the actual canvas size accounting for device pixel ratio
  canvas.width = displayWidth * devicePixelRatio
  canvas.height = displayHeight * devicePixelRatio

  // Create titles for each canvas
  const nativeTitle = document.createElement('h3')
  nativeTitle.textContent = 'Native Canvas 2D'
  nativeTitle.style.margin = '0 0 4px 0'
  nativeTitle.style.fontSize = '14px'
  nativeTitle.style.fontWeight = '500'
  nativeTitle.style.color = '#666'
  nativeTitle.style.textAlign = 'center'

  const webgpuTitle = document.createElement('h3')
  webgpuTitle.textContent = 'Luma.gl WebGPU'
  webgpuTitle.style.margin = '0 0 4px 0'
  webgpuTitle.style.fontSize = '14px'
  webgpuTitle.style.fontWeight = '500'
  webgpuTitle.style.color = '#666'
  webgpuTitle.style.textAlign = 'center'

  // Create containers for each canvas group
  const nativeContainer = document.createElement('div')
  nativeContainer.style.marginBottom = '24px'
  nativeContainer.appendChild(nativeTitle)
  nativeContainer.appendChild(nativeCanvas)

  const webgpuContainer = document.createElement('div')
  webgpuContainer.appendChild(webgpuTitle)
  webgpuContainer.appendChild(canvas)

  // Append containers to the main div
  div.appendChild(nativeContainer)
  div.appendChild(webgpuContainer)

  const INSTANCE_COUNT = 150 // The number of instances (colored disks)
  const DISK_RADIUS = 0.1 // Disk radius for collision detection

  // Initialize instance data (same logic as in app, but externally)
  const instanceOffsets = new Float32Array(2 * INSTANCE_COUNT)
  for (let i = 0; i < INSTANCE_COUNT; i++) {
  // Random positions in range -0.9 to 0.9
    instanceOffsets[2 * i] = 1.8 * Math.random() - 0.9
    instanceOffsets[2 * i + 1] = 1.8 * Math.random() - 0.9
  }

  // Create the ComputeManager with canvas
  const computeManager = new ComputeManager({
    canvas,
    diskRadius: DISK_RADIUS,
  })

  // Set positions and initialize ComputeManager
  computeManager.setPointPositions(instanceOffsets)
  await computeManager.initialize()

  // Create the native point renderer
  const nativePointRenderer = new NativePointRenderer({
    canvas: nativeCanvas,
    instanceCount: INSTANCE_COUNT,
  })

  // Get device and position buffer from ComputeManager (for potential future use)
  const device = computeManager.getDevice()
  const positionBuffer = computeManager.getPositionBuffer()

  // Create the onTick callback that runs the physics step
  const onTick: OnTickCallback = async () => {
    const computeSettings: ComputeSettings = {
      physicsEnabled: true,
      physicsStrength: 0.10,
      gravityEnabled: true,
      gravityStrength: 0.1,
      jiggleStrength: 0.02, // Increased for more visible spring jiggle
      springConstant: 0.05, // Spring constant for center attraction
      dampingFactor: 0.02, // Damping to prevent infinite oscillation
    }
    computeManager.update(computeSettings)

    // Read positions and render to native canvas
    const positions = await computeManager.readPositions()
    nativePointRenderer.render(positions)
  }

  // Create the app configuration
  const appConfig: BouncingDisksAppConfig = {
    device,
    positionBuffer,
    instanceCount: INSTANCE_COUNT,
    onTick,
    scalePointSizeWithZoom: false, // Points stay same size when zooming (better for data visualization)
  }

  // Create and initialize the application
  const app = new BouncingDisksApp(appConfig)
  await app.initialize()

  app.start()

  return {
    div,
    destroy: (): void => {
      // Cleanup function if needed
      div.remove()
      app.destroy()
      computeManager.destroy()
      nativePointRenderer.destroy()
    },
  }
}
