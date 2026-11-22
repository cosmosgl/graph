import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createGalaxy } from './galaxy'
import { examplePreview, galleryExamples } from './examples'
import * as s from './styles'
import { SiteFooter, SiteHeader } from './site'
import { exampleUrl, githubUrl, siteUrl, storyUrl } from './site-urls'

const install = 'npm install @cosmos.gl/graph'
const featuredPreviewSizes = '(max-width: 700px) 100vw, (max-width: 1050px) calc((194vw - 15px) / 3), calc((194vw - 20px) / 3)'
const previewSizes = '(max-width: 700px) 100vw, (max-width: 1050px) calc((97vw - 30px) / 3), calc((97vw - 40px) / 3)'
const talks = [
  {
    year: 2026,
    title: 'Better graph visualizations with cosmos.gl',
    venue: 'Open Visualization Summit, Zurich',
    action: 'View slides',
    url: 'https://talks.rokotyan.com/2026-open-vis-zurich/#1',
  },
  {
    year: 2025,
    title: 'cosmos.gl: A new library for visualizing massive network graphs',
    venue: 'Open Visualization Summit, Seattle',
    action: 'Watch video',
    url: 'https://www.youtube.com/watch?v=4IzklLo5Hj8',
  },
]

export function App (): React.JSX.Element {
  const galaxyContainer = useRef<HTMLDivElement>(null)
  const galaxy = useRef<Awaited<ReturnType<typeof createGalaxy>>>()
  const motionOverride = useRef<boolean>()
  const [paused, setPaused] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [galaxyFailed, setGalaxyFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyTimeout = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    // Cross-page gallery links arrive before React has mounted the anchor target.
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'instant' })
    let disposed = false
    const motionPreference = matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotionPreference = (event: MediaQueryListEvent): void => {
      motionOverride.current = undefined
      setPaused(event.matches)
    }
    motionPreference.addEventListener('change', updateMotionPreference)
    const container = galaxyContainer.current
    if (container) {
      createGalaxy(container).then(instance => {
        if (disposed) instance.destroy()
        else {
          galaxy.current = instance
          if (motionOverride.current !== undefined) instance.setPaused(motionOverride.current)
        }
      }).catch(error => {
        if (!disposed) setGalaxyFailed(true)
        console.error('Galaxy initialization failed', error)
      })
    }
    return () => {
      disposed = true
      motionPreference.removeEventListener('change', updateMotionPreference)
      galaxy.current?.destroy()
      clearTimeout(copyTimeout.current)
    }
  }, [])

  const toggleMotion = (): void => {
    const next = !paused
    motionOverride.current = next
    setPaused(next)
    galaxy.current?.setPaused(next)
  }

  const copyInstall = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(install)
      setCopied(true)
      clearTimeout(copyTimeout.current)
      copyTimeout.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // The command remains selectable when clipboard permission is unavailable.
      setCopied(false)
    }
  }

  return <>
    <a className="skip-link" href="#about">Skip to content</a>
    <SiteHeader home />

    <main>
      <section className={s.hero} aria-labelledby="hero-title">
        <div className={s.galaxy} ref={galaxyContainer} aria-hidden="true" />
        <div className={s.heroCopy}>
          <p className={s.eyebrow}>Beyond 1 million nodes and edges</p>
          <h1 className={s.headline} id="hero-title">GPU-powered graph visualization</h1>
          <p className={s.heroDescription}>An open-source engine for exploring large graphs and point clouds</p>
          <a className={s.heroLink} href="#examples">Explore what’s possible <span aria-hidden="true">↓</span></a>
        </div>
        <div className={s.heroBottom}>
          <span className="galaxy-note">{galaxyFailed ? 'A universe waiting to be explored' : 'A galaxy, rendered live with cosmos.gl'}</span>
          <div className="hero-controls">
            {!galaxyFailed && <button type="button" className={s.motionButton} onClick={toggleMotion} aria-pressed={paused}>
              <span aria-hidden="true">{paused ? '▷' : 'Ⅱ'}</span> {paused ? 'Resume motion' : 'Pause motion'}
            </button>}
            <a className={s.scrollLink} href="#about">Scroll to discover <span aria-hidden="true">↓</span></a>
          </div>
        </div>
      </section>

      <section className={`${s.content} ${s.introSection}`} id="about" aria-labelledby="about-title">
        <div className={s.introText}>
          <h2 id="about-title">Low Level<br />High Performance<br />Simulation and Rendering</h2>
          <p>
            cosmos.gl brings large networks to life, it's the core of <a href='https://cosmograph.app' target="_blank" rel="noreferrer"><u>Cosmograph</u></a>,
            a web platform for graph analytics.
            Its extremely fast force simulation and renderer run on the GPU,
            keeping hundreds of thousands of points and millions of links within reach of your browser.
          </p>
          <a className={s.textLink} href={storyUrl('examples-get-started--quick-start')} target="_blank" rel="noreferrer">
            Get started <span aria-hidden="true">↗</span>
          </a>
        </div>
      </section>

      <section id="examples" aria-labelledby="examples-title">
        <div className={s.content}>
          <h2 className={s.sectionHeading} id="examples-title">Showcase</h2>
          <p className={s.sectionDescription}>Simple ingredients. Unexpected worlds.<br />Open an example to explore it live.</p>
        </div>
        <div className={s.gallery}>
          {galleryExamples.map((example, index) => <article className={s.project(index)} key={example.id}>
            <a href={exampleUrl(example.id)}
              aria-label={`${example.title} — explore live`}>
              <img className={s.projectImage} {...examplePreview(example, siteUrl('examples/'))}
                sizes={index === 0 ? featuredPreviewSizes : previewSizes} loading="lazy" />
              <div className={s.projectCaption}>
                <h3 className={s.projectTitle}>{example.title} <span aria-hidden="true">→</span></h3>
                <p className={s.projectMeta}>{example.detail}</p>
              </div>
            </a>
          </article>)}
        </div>
      </section>

      <section className={`${s.content} ${s.startSection}`} aria-labelledby="start-title">
        <p className={s.sectionIndex}>An OpenJS Foundation project</p>
        <div>
          <h2 className={s.startTitle} id="start-title">Try on NPM</h2>
          <div className={s.installCommand}>
            <code>{install}</code>
            <button className={s.copyButton} type="button" onClick={copyInstall} aria-label="Copy install command">{copied ? 'Copied ✓' : 'Copy ↗'}</button>
          </div>
          <p aria-live="polite" className="sr-only">{copied ? 'Install command copied' : ''}</p>
          <div className={s.startLinks}>
            <a href={storyUrl('examples-get-started--quick-start')} target="_blank" rel="noreferrer">Quick start ↗</a>
            <a href={githubUrl} target="_blank" rel="noreferrer">View the source ↗</a>
            <a href="https://www.openvisualization.org/" target="_blank" rel="noreferrer">Open Visualization ↗</a>
          </div>
        </div>
      </section>
      <section className={`${s.content} ${s.talksSection}`} id="talks" aria-labelledby="talks-title">
        <h2 className={s.sectionTitle} id="talks-title">Talks about cosmos.gl</h2>
        {talks.map(talk => <article className={s.talk} key={talk.title}>
          <p className="talk-year">{talk.year}</p>
          <div><h3>{talk.title}</h3><p className="talk-venue">{talk.venue}</p></div>
          <a className={s.textLink} href={talk.url} target="_blank" rel="noreferrer" aria-label={`${talk.action}: ${talk.title}`}>
            {talk.action} <span aria-hidden="true">↗</span>
          </a>
        </article>)}
      </section>
      <section className={`${s.content} ${s.creatorsSection}`} id="creators" aria-labelledby="creators-title">
        <h2 className={s.sectionTitle} id="creators-title">Creators</h2>
        <ul role="list" className={s.creatorsList}>
          <li><a href="https://rokotyan.com" target="_blank" rel="noreferrer">Nikita Rokotyan</a></li>
          <li>Olya Stukova</li>
          <li>Denis Ovsyannikov</li>
        </ul>
      </section>
    </main>

    <SiteFooter />
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
