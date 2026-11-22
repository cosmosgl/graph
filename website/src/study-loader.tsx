import React, { useEffect, useRef } from 'react'
import { Graph, PointShape, getRgbaColor } from '@cosmos.gl/graph'

const POINT_COUNT = 217
const MOTION_INTERVAL = 3200
const SPAWN_INTERVAL = 100

export function StudyLoader ({ palette }: { palette: readonly string[] }): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!container.current) return undefined
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const width = container.current.clientWidth
    const height = container.current.clientHeight
    const spaceSize = Math.max(width, height, 256)
    const center = spaceSize / 2
    const positions = new Float32Array(POINT_COUNT * 2)
    const colors = new Float32Array(POINT_COUNT * 4)
    const shapes = new Float32Array(POINT_COUNT).fill(motion.matches ? PointShape.Circle : PointShape.None)
    const cluster = [center, center]
    const rgb = palette.map(color => getRgbaColor(color)!)
    shapes[0] = PointShape.Circle
    for (let i = 0; i < POINT_COUNT; i++) {
      const radius = motion.matches ? 72 * Math.sqrt((i + 0.5) / POINT_COUNT) : Math.min(width, height) / 2 - 8
      const angle = i * 2.399963229728653
      positions[i * 2] = center + radius * Math.cos(angle)
      positions[i * 2 + 1] = center + radius * Math.sin(angle)
      const seed = Math.imul(i + 1, 2654435761) >>> 0
      const color = rgb[seed % rgb.length]!
      const bright = i === 0 || (seed >>> 8) % 100 < 45
      for (let channel = 0; channel < 3; channel++) colors[i * 4 + channel] = bright ? color[channel]! : 0.07 + color[channel]! * 0.14
      colors[i * 4 + 3] = 1
    }
    const graph = new Graph(container.current, {
      backgroundColor: [0, 0, 0, 0],
      spaceSize,
      pointDefaultSize: 9,
      pointDefaultStrokeWidth: 0.35,
      pointStrokeContrast: 0.06,
      pixelRatio: Math.min(devicePixelRatio || 1, 2),
      rescalePositions: false,
      enableSimulation: !motion.matches,
      enableRenderLoop: false,
      enableZoom: false,
      enableDrag: false,
      initialZoomLevel: 1,
      fitViewOnInit: false,
      simulationGravity: 0.005,
      simulationRepulsion: 5.5,
      simulationCluster: 0.25,
      simulationCollision: 0.5,
      simulationCollisionPadding: 0.9,
      simulationDecay: 1000000,
      transitionDuration: 0,
      attribution: '',
      randomSeed: 'study-loader',
    })
    let disposed = false
    let frame = 0
    let lastFrame = 0
    let drift: number | undefined
    let spawn: number | undefined
    let spawned = motion.matches ? POINT_COUNT : 1
    let phase = 0
    const animated = (): boolean => !motion.matches && !document.hidden
    const draw = (time: number): void => {
      if (time - lastFrame >= 1000 / 30) {
        lastFrame = time
        graph.renderOneFrame()
      }
      frame = requestAnimationFrame(draw)
    }
    const updateMotion = (): void => {
      cancelAnimationFrame(frame)
      const animate = animated()
      if (motion.matches && spawned < POINT_COUNT) {
        spawned = POINT_COUNT
        shapes.fill(PointShape.Circle)
        graph.setPointShapes(shapes)
        graph.setPinnedPoints(null)
      }
      graph.setConfigPartial({ enableSimulation: animate })
      if (animate) {
        graph.start(0.2)
        frame = requestAnimationFrame(draw)
      } else {
        graph.pause()
        graph.render(0, 0)
        graph.renderOneFrame()
      }
    }
    graph.ready.then(() => {
      if (disposed) return
      graph.setPointPositions(positions, true)
      graph.setPointColors(colors)
      graph.setPointShapes(shapes)
      graph.setPointClusters(new Array<number>(POINT_COUNT).fill(0))
      graph.setClusterPositions(cluster)
      graph.setPinnedPoints(motion.matches ? null : Array.from({ length: POINT_COUNT - 1 }, (_, i) => i + 1))
      graph.render(0, 0)
      updateMotion()
      motion.addEventListener('change', updateMotion)
      document.addEventListener('visibilitychange', updateMotion)
      drift = window.setInterval(() => {
        if (!animated()) return
        phase++
        cluster[0] = center + 16 * Math.cos(phase * 0.7)
        cluster[1] = center + 16 * Math.sin(phase * 0.7)
        graph.setClusterPositions(cluster)
        graph.render(0, 0)
        graph.start(0.2)
      }, MOTION_INTERVAL)
      spawn = window.setInterval(() => {
        if (spawned === POINT_COUNT) window.clearInterval(spawn)
        if (!animated() || spawned === POINT_COUNT) return
        shapes[spawned] = PointShape.Circle
        graph.setPinnedPoint(spawned++, false)
        graph.setPointShapes(shapes)
        graph.render(undefined, 0)
      }, SPAWN_INTERVAL)
    }).catch((error: unknown) => {
      if (!disposed) console.warn('Could not draw the loading animation', error)
    })

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      window.clearInterval(drift)
      window.clearInterval(spawn)
      motion.removeEventListener('change', updateMotion)
      document.removeEventListener('visibilitychange', updateMotion)
      graph.destroy()
    }
  }, [palette])

  return <div ref={container} className="study-loader" aria-hidden="true" />
}
