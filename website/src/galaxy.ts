import { Graph } from '@cosmos.gl/graph'

export interface GalaxyControls {
  destroy: () => void;
  setPaused: (paused: boolean) => void;
}

const TAU = Math.PI * 2
const ORIGIN = 2048
const RADIUS = 1100
const ORBIT_BANDS = 64

/** The hero is a live cosmos point cloud, including its dust and distant stars. */
export async function createGalaxy (container: HTMLDivElement): Promise<GalaxyControls> {
  const mobile = window.matchMedia('(max-width: 700px)').matches
  const count = mobile ? 22000 : 48000
  const backgroundCount = mobile ? 160 : 420
  const galaxyCount = count - backgroundCount
  const positions = new Float32Array(count * 2)
  const colors = new Float32Array(count * 4)
  const sizes = new Float32Array(count)
  const planeX = new Float32Array(galaxyCount)
  const planeY = new Float32Array(galaxyCount)
  const depth = new Float32Array(galaxyCount)
  const bands = new Uint8Array(galaxyCount)
  const background = new Float32Array(backgroundCount * 2)
  const orbitCos = new Float32Array(ORBIT_BANDS)
  const orbitSin = new Float32Array(ORBIT_BANDS)
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  // A fixed seed keeps the composition consistent between visits and screenshots.
  let seed = 104729
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0
    return (seed >>> 0) / 4294967296
  }
  const gaussian = (): number => Math.sqrt(-2 * Math.log(Math.max(0.00001, random()))) * Math.cos(TAU * random())

  for (let i = 0; i < galaxyCount; i++) {
    const population = random()
    let radius: number
    let angle: number
    let thickness: number

    if (population < 0.21) {
      // The round stellar bulge, with a very dense but finely resolved centre.
      radius = Math.min(0.46, Math.abs(gaussian()) * 0.145)
      angle = random() * TAU
      thickness = gaussian() * (1 - radius) * 35
    } else if (population < 0.88) {
      // Four logarithmic arms. Correlated ripples make their edges feel organic.
      radius = 0.055 + Math.pow(random(), 0.79) * 0.96
      const arm = Math.floor(random() * 4)
      const spread = gaussian() * (0.055 + radius * 0.105)
      angle = arm * TAU / 4 + Math.log(radius + 0.06) * 2.32 + spread
      radius += gaussian() * 0.017 + Math.sin(angle * 7 + radius * 24) * 0.008
      thickness = gaussian() * (9 + radius * 9)
    } else {
      // A diffuse disc softens the spaces between arms without hiding the spiral.
      radius = Math.pow(random(), 0.72) * 1.16
      angle = random() * TAU
      thickness = gaussian() * 26
    }

    planeX[i] = Math.cos(angle) * radius * RADIUS
    planeY[i] = Math.sin(angle) * radius * RADIUS
    depth[i] = thickness
    bands[i] = Math.min(ORBIT_BANDS - 1, Math.floor(radius * (ORBIT_BANDS - 1)))

    const warmth = Math.exp(-radius * 5.8)
    const tint = (Math.sin(angle * 1.7 + radius * 14) + 1) * 0.5
    const brightness = 0.78 + random() * 0.22
    const brightStar = random() > 0.979
    const haze = !brightStar && random() < 0.12
    const colorIndex = i * 4
    const coldRed = 0.4 + tint * 0.3
    const coldGreen = 0.68 - tint * 0.14
    colors[colorIndex] = (coldRed * (1 - warmth) + warmth) * brightness
    colors[colorIndex + 1] = (coldGreen * (1 - warmth) + 0.83 * warmth) * brightness
    colors[colorIndex + 2] = ((0.94 + tint * 0.06) * (1 - warmth) + 0.57 * warmth) * brightness
    colors[colorIndex + 3] = haze ? 0.025 + random() * 0.045 : brightStar ? 0.75 + random() * 0.25 : 0.17 + random() * 0.43
    sizes[i] = haze ? 3.2 + random() * 5.8 : brightStar ? 1.7 + random() * 1.7 : 0.6 + Math.pow(random(), 2) * 0.95
  }

  for (let i = 0; i < backgroundCount; i++) {
    background[i * 2] = random()
    background[i * 2 + 1] = random()
    const index = galaxyCount + i
    const warm = random() > 0.8
    colors[index * 4] = warm ? 0.95 : 0.57 + random() * 0.25
    colors[index * 4 + 1] = warm ? 0.78 : 0.7 + random() * 0.2
    colors[index * 4 + 2] = warm ? 0.59 : 0.95
    colors[index * 4 + 3] = 0.13 + Math.pow(random(), 2) * 0.62
    sizes[index] = 0.55 + Math.pow(random(), 4) * 1.8
  }

  const graph = new Graph(container, {
    enableSimulation: false,
    enableRenderLoop: false,
    rescalePositions: false,
    spaceSize: 4096,
    backgroundColor: [0, 0, 0, 0],
    transitionDuration: 0,
    enableZoom: false,
    enableDrag: false,
    renderLinks: false,
    renderHoveredPointRing: false,
    pointOcclusionCulling: false,
    fitViewOnInit: false,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  })

  try {
    await graph.ready
  } catch (error) {
    graph.destroy()
    throw error
  }

  let destroyed = false
  // A button press overrides the current system preference until it changes.
  let paused: boolean | undefined
  let intersecting = true
  let frame = 0
  let lastTime = 0
  let width = 1
  let height = 1
  let scale = 1
  let centreX = 0
  let centreY = 0
  let pointerX = 0
  let pointerY = 0
  let parallaxX = 0
  let parallaxY = 0

  const project = (): void => {
    const tilt = width <= 700 ? -0.88 : -0.32
    const tiltCos = Math.cos(tilt)
    const tiltSin = Math.sin(tilt)
    for (let i = 0; i < galaxyCount; i++) {
      const x = planeX[i]!
      const y = planeY[i]! * 0.58
      positions[i * 2] = ORIGIN + x * tiltCos - y * tiltSin
      positions[i * 2 + 1] = ORIGIN + x * tiltSin + y * tiltCos + depth[i]!
    }
  }

  const applyView = (): void => {
    graph.setViewTransform({
      k: scale,
      x: centreX - scale * width / 2 + parallaxX,
      y: centreY - scale * height / 2 + parallaxY,
    }, [width, height])
  }

  const resize = (): void => {
    if (destroyed) return
    width = Math.max(1, container.clientWidth)
    height = Math.max(1, container.clientHeight)
    const compact = width <= 700
    scale = Math.min(width * (compact ? 0.96 : 0.48), height * (compact ? 0.54 : 0.79)) / RADIUS
    centreX = width * (compact ? 0.48 : 0.34)
    centreY = height * (compact ? 0.35 : 0.52)
    for (let i = 0; i < backgroundCount; i++) {
      const index = (galaxyCount + i) * 2
      positions[index] = ORIGIN + (background[i * 2]! * width - centreX) / scale
      positions[index + 1] = ORIGIN - (background[i * 2 + 1]! * height - centreY) / scale
    }
    project()
    applyView()
    graph.setPointPositions(positions)
    graph.render(0, 0)
    graph.renderOneFrame()
  }

  const shouldAnimate = (): boolean => !destroyed && !(paused ?? reducedMotion.matches) && intersecting && !document.hidden

  const tick = (time: number): void => {
    frame = 0
    if (!shouldAnimate()) return
    if (!lastTime) lastTime = time
    const elapsed = time - lastTime
    if (elapsed >= 32) {
      const seconds = Math.min(elapsed, 64) / 1000
      lastTime = time
      for (let band = 0; band < ORBIT_BANDS; band++) {
        const rotation = seconds * (0.008 + 0.016 / (0.35 + band / ORBIT_BANDS))
        orbitCos[band] = Math.cos(rotation)
        orbitSin[band] = Math.sin(rotation)
      }
      for (let i = 0; i < galaxyCount; i++) {
        const band = bands[i]!
        const x = planeX[i]!
        const y = planeY[i]!
        planeX[i] = x * orbitCos[band]! - y * orbitSin[band]!
        planeY[i] = x * orbitSin[band]! + y * orbitCos[band]!
      }
      parallaxX += (pointerX - parallaxX) * 0.035
      parallaxY += (pointerY - parallaxY) * 0.035
      project()
      applyView()
      graph.setPointPositions(positions)
      graph.render(0, 0)
      graph.renderOneFrame()
    }
    frame = window.requestAnimationFrame(tick)
  }

  const syncAnimation = (): void => {
    if (shouldAnimate()) {
      if (!frame) {
        lastTime = 0
        frame = window.requestAnimationFrame(tick)
      }
    } else if (frame) {
      window.cancelAnimationFrame(frame)
      frame = 0
      lastTime = 0
    }
  }

  const onMotionPreferenceChange = (): void => {
    paused = undefined
    syncAnimation()
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || !shouldAnimate()) return
    const bounds = container.getBoundingClientRect()
    pointerX = ((event.clientX - bounds.left) / width - 0.5) * 13
    pointerY = ((event.clientY - bounds.top) / height - 0.5) * 9
  }
  const onPointerLeave = (): void => {
    pointerX = 0
    pointerY = 0
  }

  const resizeObserver = new ResizeObserver(resize)
  const intersectionObserver = new IntersectionObserver(entries => {
    intersecting = entries[0]?.isIntersecting ?? false
    syncAnimation()
  }, { rootMargin: '80px' })

  const destroy = (): void => {
    if (destroyed) return
    destroyed = true
    if (frame) window.cancelAnimationFrame(frame)
    resizeObserver.disconnect()
    intersectionObserver.disconnect()
    document.removeEventListener('visibilitychange', syncAnimation)
    reducedMotion.removeEventListener('change', onMotionPreferenceChange)
    window.removeEventListener('pointermove', onPointerMove)
    document.documentElement.removeEventListener('pointerleave', onPointerLeave)
    graph.destroy()
  }

  const controls: GalaxyControls = {
    destroy,
    setPaused: (value: boolean): void => {
      paused = value
      syncAnimation()
    },
  }

  // React may have unmounted the hero while the GPU device was being created.
  if (!container.isConnected) {
    destroy()
    return controls
  }

  container.querySelector('canvas')?.setAttribute('aria-hidden', 'true')
  graph.setPointColors(colors)
  graph.setPointSizes(sizes)
  resize()
  resizeObserver.observe(container)
  intersectionObserver.observe(container)
  document.addEventListener('visibilitychange', syncAnimation)
  reducedMotion.addEventListener('change', onMotionPreferenceChange)
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  document.documentElement.addEventListener('pointerleave', onPointerLeave)
  syncAnimation()

  return controls
}
