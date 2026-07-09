/**
 * Tunables for the screen-space point-picking buffer. Kept in one place so the
 * shader-side memory budget and the CPU-side window math stay in sync.
 */

/**
 * The picking buffer is rendered at a fraction of the screen resolution — a
 * few CSS pixels of pick tolerance is enough, and rgba32float at full retina
 * resolution would cost tens of MB.
 */
export const PICKING_RESOLUTION_SCALE = 0.5

/** Hard cap on the picking buffer dimensions (bounds memory on huge screens). */
export const MAX_PICKING_BUFFER_DIMENSION = 1536

/**
 * Edge of the square window read around the cursor when picking, in picking
 * buffer pixels — its half is the pick "forgiveness" radius in buffer pixels.
 */
export const PICKING_WINDOW_SIZE = 9
