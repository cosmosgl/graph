import React from 'react'
import { githubUrl, siteUrl, storybookUrl } from './site-urls'
import * as s from './styles'

export function SiteHeader ({ home = false }: { home?: boolean }): React.JSX.Element {
  return <header className={s.header}>
    <a className={s.brand} href={home ? '#' : siteUrl()} aria-label="cosmos.gl home">
      <img src={siteUrl('cosmos-logo.svg')} width={1201} height={330} alt="" />
    </a>
    <nav className={s.nav} aria-label="Main navigation">
      <a className={s.navLink} href={home ? '#examples' : `${siteUrl()}#examples`}>Showcase</a>
      <a className={s.navLink} href={githubUrl} target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a>
      <a className={s.navLink} href={storybookUrl} target="_blank" rel="noreferrer">Storybook <span aria-hidden="true">↗</span></a>
    </nav>
  </header>
}

export function SiteFooter (): React.JSX.Element {
  return <footer className={s.footer}>
    <span>cosmos.gl <span className="footer-note">Open source. MIT licensed.</span></span>
    <div><a href={githubUrl} target="_blank" rel="noreferrer">GitHub ↗</a><a href={storybookUrl} target="_blank" rel="noreferrer">Storybook ↗</a></div>
  </footer>
}
