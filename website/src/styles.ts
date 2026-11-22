import { css, injectGlobal } from '@emotion/css'
import interFontUrl from './fonts/InterVariable.woff2?url'

// Adapted from rokotyan.com: its editorial body, typography, generous
// offsets, and asymmetric project grid are retained around a live cosmos hero.
const phone = '@media (max-width: 700px)'
const tablet = '@media (min-width: 701px) and (max-width: 1050px)'

export const globalStyles = injectGlobal`
  @font-face {
    font-family: Inter;
    font-style: normal;
    font-weight: 100 900;
    font-display: swap;
    src: url('${interFontUrl}') format('woff2');
  }
  *, *::before, *::after { box-sizing: border-box; }
  html { scroll-behavior: smooth; background: #111318; color-scheme: dark; }
  body {
    margin: 0;
    color: #f0f0f4;
    background: #111318;
    font-family: Inter, Arial, sans-serif;
    font-size: 18px;
    font-weight: 400;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; text-decoration: none; }
  button { font: inherit; }
  button, a { -webkit-tap-highlight-color: transparent; }
  button { color: inherit; }
  img { max-width: 100%; }
  h1, h2, h3, p { margin: 0; font-weight: 400; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .skip-link { position: fixed; top: -80px; left: 20px; z-index: 10; padding: 12px 20px; color: #f0f0f4; background: #1b1e26; }
  .skip-link:focus { top: 12px; }
  .footer-note { margin-left: 20px; }
  ::selection { background: rgba(139, 133, 226, 0.25); }
  :focus-visible { outline: 2px solid #a4a0ee; outline-offset: 7px; }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    *, *::before, *::after { transition-duration: 0.01ms !important; }
  }
`

export const header = css`
  label: header;
  position: absolute;
  inset: 0 0 auto;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 2.5%;
  color: #fefefe;
  font-size: 20pt;
  font-weight: 400;
  ${phone} { padding: 23px 22px; font-size: 20px; }
`

export const brand = css`
  label: brand;
  letter-spacing: -0.9px;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  img { display: block; width: 120px; height: auto; }
  ${phone} { img { width: 100px; } }
`

export const nav = css`
  label: navigation;
  display: flex;
  align-items: center;
  gap: 34px;
  font-size: 18px;
  ${phone} {
    gap: 20px;
    font-size: 15px;
    a:not(:last-child) { display: none; }
  }
`

export const navLink = css`
  label: navigation-link;
  display: inline-flex;
  align-items: center;
  gap: 9px;
  transition: opacity 180ms;
  &:hover { opacity: 0.65; }
  svg { width: 17px; height: 17px; }
`

export const hero = css`
  label: hero;
  position: relative;
  min-height: 720px;
  height: 100svh;
  overflow: hidden;
  background: #111318;
  color: #fefefe;
  ${phone} { min-height: 800px; }
  @media (max-width: 700px) and (max-height: 800px) { min-height: 760px; }
`

export const galaxy = css`
  label: galaxy;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  canvas { display: block; width: 100%; height: 100%; }
`

export const heroCopy = css`
  label: hero-copy;
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: center;
  flex-direction: column;
  height: 100%;
  margin-left: 60%;
  padding: 110px 4.5% 130px 0;
  pointer-events: none;
  > * { max-width: 490px; }
  a { pointer-events: auto; }
  ${tablet} { margin-left: 58%; padding-right: 4%; }
  ${phone} {
    height: auto;
    position: absolute;
    inset: auto 24px 110px;
    margin-left: 0;
    padding: 0;
    max-width: 420px;
  }
`

export const eyebrow = css`
  label: eyebrow;
  margin-bottom: 25px;
  color: #b5b5bd;
  font-size: 14px;
  line-height: 1.5;
  ${phone} { margin-bottom: 16px; font-size: 12px; }
`

export const headline = css`
  label: headline;
  font-size: clamp(32px, 3.1vw, 48px);
  line-height: 1.35;
  letter-spacing: -1.2px;
  font-weight: 400;
  ${phone} { font-size: 34px; line-height: 1.25; max-width: 330px; }
`

export const heroDescription = css`
  label: hero-description;
  margin-top: 22px;
  max-width: 390px;
  font-size: 20px;
  line-height: 1.55;
  color: #bcbcc6;
  ${phone} { margin-top: 16px; font-size: 17px; max-width: 340px; }
`

export const heroLink = css`
  label: hero-link;
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 16px;
  margin-top: 32px;
  padding-bottom: 8px;
  font-size: 17px;
  transition: opacity 180ms;
  &:hover { opacity: 0.72; }
  svg { width: 23px; height: 15px; }
  ${phone} { margin-top: 23px; font-size: 16px; }
`

export const heroBottom = css`
  label: hero-bottom;
  position: absolute;
  z-index: 2;
  bottom: 26px;
  left: 2.5%;
  right: 2.5%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  color: #9c9da8;
  font-size: 13px;
  > div { display: flex; align-items: center; gap: 25px; }
  ${phone} {
    left: 24px;
    right: 24px;
    bottom: 24px;
    font-size: 11px;
    .galaxy-note { max-width: 58%; }
    > div { gap: 18px; }
  }
`

export const motionButton = css`
  label: motion-button;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  padding: 5px 0;
  font-size: inherit;
  white-space: nowrap;
  cursor: pointer;
  &:hover { color: #fefefe; }
  svg { width: 12px; height: 12px; }
`

export const scrollLink = css`
  label: scroll-link;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  &:hover { color: #fefefe; }
  svg { width: 12px; height: 18px; }
  ${phone} { display: none; }
`

export const content = css`
  label: content;
  margin: auto;
  width: 100%;
  padding: 0 40px 0 90px;
  background: #111318;
  ${tablet} { padding: 0 32px 0 50px; }
  ${phone} { padding: 0 24px; }
`

export const introSection = css`
  label: introduction;
  position: relative;
  width: 60%;
  margin-left: 40%;
  padding: 16% 5% 12%;
  ${tablet} { width: 65%; margin-left: 35%; padding: 17% 2% 13%; }
  ${phone} { width: 100%; margin-left: 0; padding: 95px 24px 85px; }
`

export const sectionIndex = css`
  label: section-index;
  display: block;
  margin-bottom: 26px;
  color: #9c9da8;
  font-size: 13px;
  line-height: 1.5;
`

export const introText = css`
  label: introductory-text;
  font-size: clamp(25px, 2.1vw, 34px);
  font-weight: 400;
  line-height: 1.5;
  letter-spacing: -0.6px;
  h2 { font-size: clamp(32px, 3.2vw, 46px); line-height: 1.3; margin-bottom: 32px; }
  p + p { margin-top: 28px; }
  a { margin-top: 28px; }
  ${phone} { font-size: 25px; }
`

export const textLink = css`
  label: text-link;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: #f0f0f4;
  font-size: 17px;
  line-height: 1.5;
  padding-bottom: 4px;
  border-bottom: 1px solid #515561;
  &:hover { border-color: #f0f0f4; }
  svg { width: 23px; height: 15px; }
`

export const sectionHeading = css`
  label: section-heading;
  font-size: clamp(32px, 3.2vw, 46px);
  line-height: 1.4;
  font-weight: 400;
  letter-spacing: -1px;
  padding: 70px 1.5% 23px;
  ${phone} { padding: 50px 0 20px; font-size: 34px; }
`

export const sectionDescription = css`
  label: section-description;
  max-width: 760px;
  padding: 0 1.5% 48px;
  color: #a7a9b8;
  font-size: 19px;
  line-height: 1.6;
  ${phone} { padding: 0 0 30px; font-size: 17px; }
`

export const gallery = css`
  label: examples-gallery;
  margin: 0 1.5%;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  grid-template-areas:
    'p0 p0 p1'
    'p0 p0 p2'
    'p3 p4 p5';
  align-items: stretch;
  ${tablet} { gap: 15px; }
  ${phone} {
    margin: 0;
    grid-template-columns: 1fr;
    grid-template-areas: 'p0' 'p1' 'p2' 'p3' 'p4' 'p5';
    gap: 30px;
  }
`

export const project = (index: number): string => css`
  label: example-${index};
  grid-area: p${index};
  min-width: 0;
  display: flex;
  flex-direction: column;
  color: #f0f0f4;
  cursor: pointer;
  transition: transform 250ms;
  > a { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  &:hover { transform: translateY(-3px); }
  &:hover img { filter: contrast(0.93); }
  ${index === 0 ? '> a > img { aspect-ratio: auto; flex: 1; min-height: 0; height: 0; }' : ''}
  ${phone} {
    grid-column: auto;
    > a > img { aspect-ratio: 1.6; height: auto; flex: none; }
    > a > div { padding-left: 24px; padding-right: 24px; }
  }
`

export const projectImage = css`
  label: example-image;
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 1.6;
  object-fit: cover;
  background: #15181b;
  overflow: hidden;
  position: relative;
  transition: filter 250ms;
  img { display: block; width: 100%; height: 100%; object-fit: cover; }
`

export const projectCaption = css`
  label: example-caption;
  min-height: 53px;
  padding: 12px 0 11px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 15px;
  ${phone} { min-height: 42px; padding: 10px 0 0; }
`

export const projectTitle = css`
  label: example-title;
  font-size: 14pt;
  font-weight: 400;
  line-height: 1.4;
  ${phone} { font-size: 18px; }
`

export const projectMeta = css`
  label: example-meta;
  color: #9c9da8;
  text-align: right;
  max-width: 50%;
  font-size: 12px;
  line-height: 1.5;
  ${tablet} { display: none; }
  ${phone} { display: none; }
`

export const startSection = css`
  label: get-started;
  padding: 170px 1.5% 140px;
  width: 60%;
  margin-left: 40%;
  ${tablet} { width: 70%; margin-left: 30%; padding-top: 120px; }
  ${phone} { width: 100%; margin-left: 0; padding: 100px 24px 90px; }
`

export const startTitle = css`
  label: get-started-title;
  font-size: clamp(30px, 2.7vw, 42px);
  font-weight: 400;
  line-height: 1.4;
  letter-spacing: -0.8px;
  max-width: 520px;
`

export const installCommand = css`
  label: installation-command;
  margin-top: 34px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  padding: 20px 0;
  border-top: 1px solid #30343e;
  border-bottom: 1px solid #30343e;
  font-size: 17px;
  code { font-family: 'SFMono-Regular', Consolas, monospace; font-size: 0.88em; }
  ${phone} { font-size: 16px; gap: 10px; }
`

export const copyButton = css`
  label: copy-command;
  border: 0;
  background: none;
  padding: 5px 0 5px 10px;
  font-size: 13px;
  color: #a7a9b8;
  cursor: pointer;
  &:hover { color: #f0f0f4; }
`

export const startLinks = css`
  label: get-started-links;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 32px;
  margin-top: 30px;
  ${phone} { gap: 25px; }
`

export const talksSection = css`
  label: talks-section;
  padding-bottom: 110px;
  ${phone} { padding-bottom: 65px; }
`

export const sectionTitle = css`
  label: section-title;
  font-size: clamp(30px, 3.2vw, 42px);
  letter-spacing: -1px;
  line-height: 1.4;
  margin-bottom: 20px;
`

export const talk = css`
  label: talk;
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr) auto;
  gap: 24px;
  align-items: start;
  padding: 32px 0;
  border-top: 1px solid #30343e;
  h3 { font-size: 25px; letter-spacing: -0.4px; line-height: 1.4; max-width: 850px; }
  .talk-year { padding-top: 6px; font-size: 14px; color: #9c9da8; }
  .talk-venue { margin-top: 12px; font-size: 15px; line-height: 1.6; color: #a7a9b8; }
  > a { margin-top: 4px; white-space: nowrap; }
  ${phone} {
    grid-template-columns: 1fr;
    gap: 14px;
    padding: 26px 0;
    h3 { font-size: 23px; }
    .talk-year { padding-top: 0; font-size: 13px; }
    .talk-venue { font-size: 14px; }
    > a { justify-self: start; margin-top: 3px; font-size: 15px; }
  }
`

export const creatorsSection = css`
  label: creators-section;
  padding-bottom: 90px;
  ${phone} { padding-bottom: 60px; }
`

export const creatorsList = css`
  label: creators-list;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  list-style: none;
  margin: 0;
  padding: 26px 0 0;
  border-top: 1px solid #30343e;
  font-size: 22px;
  line-height: 1.4;
  a { text-decoration: underline; text-underline-offset: 4px; }
  a:hover { color: #bcbcc6; }
  ${phone} { grid-template-columns: 1fr; gap: 16px; font-size: 20px; }
`

export const footer = css`
  label: footer;
  margin: 0 1.5%;
  padding: 30px 0 34px;
  border-top: 1px solid #30343e;
  color: #9c9da8;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 30px;
  font-size: 14px;
  line-height: 1.5;
  > div { display: flex; gap: 24px; }
  a:hover { color: #f0f0f4; }
  ${phone} {
    margin: 0 24px;
    padding: 25px 0;
    align-items: flex-start;
    font-size: 12px;
    > div { flex-direction: column; gap: 12px; align-items: flex-end; }
  }
`
