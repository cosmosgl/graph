import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { examplePreview, galleryExamples } from './examples'
import { SiteFooter, SiteHeader } from './site'
import { exampleUrl, siteUrl } from './site-urls'
import { scenes } from './scenes/scenes'
import { createScene } from './scenes/renderer'
import type { SceneControls } from './scenes/renderer'
import { studyPalette } from './scenes/palette'
import { StudyLoader } from './study-loader'
import './example-page.css'

const query = new URLSearchParams(location.search)
const id = location.pathname.split('/').filter(Boolean).at(-1) === 'index.html'
  ? location.pathname.split('/').filter(Boolean).at(-2)
  : location.pathname.split('/').filter(Boolean).at(-1)
const scene = scenes.find(item => item.id === id)!
const galleryIndex = galleryExamples.findIndex(example => example.id === id)
const still = query.has('still')
const requestedTime = Number(query.get('time') ?? 8)
const initialTime = Number.isFinite(requestedTime) ? requestedTime : 8

export function ExamplePage (): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const instance = useRef<SceneControls>()
  const [paused, setPaused] = useState(still || matchMedia('(prefers-reduced-motion: reduce)').matches)
  const pauseChoice = useRef(paused)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [benchmarkCount, setBenchmarkCount] = useState<number | null>(null)

  useEffect(() => {
    let disposed = false
    const controller = new AbortController()
    const canvas = container.current
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    const changed = (): void => {
      pauseChoice.current = still || preference.matches
      setPaused(pauseChoice.current)
      instance.current?.setPaused?.(pauseChoice.current)
    }
    preference.addEventListener('change', changed)
    const updateBenchmarkCount = (event: Event): void => {
      if (!disposed) setBenchmarkCount((event as CustomEvent<number | null>).detail)
    }
    if (canvas) {
      if (scene.benchmark) canvas.addEventListener('benchmark-verified', updateBenchmarkCount)
      createScene(canvas, scene, still, initialTime, controller.signal).then(controls => {
        if (disposed) controls.destroy()
        else {
          instance.current = controls
          controls.setPaused?.(pauseChoice.current)
          setReady(true)
        }
      }).catch((error: unknown) => {
        if (!disposed) {
          setFailed(true)
          console.error('Could not initialize example', error)
        }
      })
    }
    return () => {
      disposed = true
      controller.abort()
      instance.current?.destroy()
      instance.current = undefined
      preference.removeEventListener('change', changed)
      canvas?.removeEventListener('benchmark-verified', updateBenchmarkCount)
    }
  }, [attempt])

  const toggleMotion = (): void => {
    pauseChoice.current = !paused
    setPaused(!paused)
    instance.current?.setPaused?.(!paused)
  }
  const previous = galleryExamples[galleryIndex - 1] ?? galleryExamples.at(-1)!
  const next = galleryExamples[galleryIndex + 1] ?? galleryExamples[0]!
  const stageClassName = ['example-stage', scene.simulation && 'example-stage--simulation', scene.dataset && 'example-stage--dataset',
    scene.id === 'collision-stress-test' && 'example-stage--collision',
    scene.benchmark && 'example-stage--benchmark'].filter(Boolean).join(' ')
  const loadsDataset = scene.dataset || ('loadingDataset' in scene && scene.loadingDataset)
  const cameraOnly = scene.id !== 'lorenz-attractor'
  const viewerReady = scene.benchmark ? benchmarkCount !== null : ready
  const pointCount = (benchmarkCount ?? scene.pointCount).toLocaleString()
  const pointSummary = scene.benchmark && benchmarkCount === null ? `Up to ${pointCount} points` : `${pointCount} points`

  return <div className={query.has('capture') ? 'example-page example-capture' : 'example-page'}>
    <a className="skip-link" href="#example-viewer">Skip to visualization</a>
    <div className="example-hero">
      <SiteHeader />
      <main>
        <section className={stageClassName} id="example-viewer" aria-label={`${scene.title} interactive visualization`}
          style={{ background: scene.background }} data-ready={viewerReady}>
          <div className="example-canvas" ref={container} aria-hidden={scene.benchmark ? undefined : true} />
          <a className="example-back" href={`${siteUrl()}#examples`}><span aria-hidden="true">←</span>All examples</a>
          {!ready && (loadsDataset
            ? <div className="example-status study-status">
              {!failed && <StudyLoader palette={studyPalette} />}
              <p role="status">{failed ? 'Could not load this study.' : 'Loading dataset…'}</p>
              {failed && <button type="button" onClick={() => { setFailed(false); setAttempt(attempt + 1) }}>Try again</button>}
            </div>
            : <p className="example-status" role="status">
              {failed ? 'This example needs a browser with WebGL 2.' : 'Preparing the scene…'}
            </p>)}
          <div className="example-overlay">
            <div className="example-info">
              <h1>{scene.title}</h1>
              <p className="example-description">{scene.description}</p>
              <p className="example-counts">
                {loadsDataset
                  ? galleryExamples[galleryIndex]!.detail
                  : `${pointSummary}${scene.linkCount > 0 ? ` · ${scene.linkCount.toLocaleString()} links` : ''}`}
                {!scene.dataset && <span> · {scene.simulation
                  ? 'Live GPU force simulation'
                  : scene.benchmark
                    ? 'GPU rendering benchmark'
                    : 'Rendered live with cosmos.gl'}</span>}
              </p>
              {scene.source && <a className="example-source" href={scene.source.url} target="_blank" rel="noreferrer">{scene.source.label}</a>}
            </div>
            {!scene.benchmark && <div className={cameraOnly ? 'example-toolbar example-toolbar--camera-only' : 'example-toolbar'}>
              {!cameraOnly && <p className="example-hint">Scroll or pinch to zoom · Drag to pan</p>}
              <div className="example-actions">
                {!cameraOnly && <button type="button" onClick={toggleMotion} aria-pressed={paused} disabled={!ready}>
                  <span aria-hidden="true">{paused ? '▷' : 'Ⅱ'}</span> {paused ? 'Play' : 'Pause'} motion
                </button>}
                <div className="example-camera" role="group" aria-label="Camera controls">
                  <button type="button" aria-label="Zoom out" onClick={() => instance.current?.zoomOut?.()} disabled={!ready}>−</button>
                  <button type="button" onClick={() => instance.current?.fitView?.()} disabled={!ready}>Fit view</button>
                  <button type="button" aria-label="Zoom in" onClick={() => instance.current?.zoomIn?.()} disabled={!ready}>+</button>
                </div>
              </div>
            </div>}
          </div>
        </section>
      </main>
    </div>

    <nav className="example-related" aria-label="More examples">
      {[{ item: previous, label: 'Previous example', arrow: '←' }, { item: next, label: 'Next example', arrow: '→' }].map(({ item, label, arrow }) =>
        <a href={exampleUrl(item.id)} key={label}>
          <p>{label} <span aria-hidden="true">{arrow}</span></p>
          <img {...examplePreview(item, siteUrl('examples/'))} sizes="(max-width: 700px) calc(50vw - 33px), calc(47.5vw - 12px)" loading="lazy" />
          <h2>{item.title}</h2>
        </a>)}
    </nav>
    <SiteFooter />
  </div>
}

createRoot(document.getElementById('root')!).render(<ExamplePage />)
