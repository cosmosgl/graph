import type { Layer } from '@deck.gl/core'

// Deck 9 clears just the view's rectangle.
export const thumbnailView = { clear: true, clearColor: [25, 33, 50, 255] as [number, number, number, number] }
export const thumbnailBackground: (id: string) => Layer | null = () => null
