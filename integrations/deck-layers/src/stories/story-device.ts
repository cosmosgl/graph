import type { DeckProps } from '@deck.gl/core'

/** Deck 9 creates and manages the WebGL canvas for these stories. */
export function createStoryDevice (parent: HTMLDivElement): { props: Pick<DeckProps, 'parent'>; destroy?(): void } {
  return { props: { parent } }
}
