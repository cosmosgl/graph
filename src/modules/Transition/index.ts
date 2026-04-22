import {
  easeLinear,
  easeQuadIn, easeQuadOut, easeQuadInOut,
  easeCubicIn, easeCubicOut, easeCubicInOut,
  easeSinIn, easeSinOut, easeSinInOut,
  easeExpIn, easeExpOut, easeExpInOut,
  easeCircleIn, easeCircleOut, easeCircleInOut,
} from 'd3-ease'

import { type GraphConfigInterface } from '@/graph/config'

export enum TransitionProperty {
  Positions = 'positions',
  PointColors = 'pointColors',
  PointSizes = 'pointSizes',
  LinkColors = 'linkColors',
  LinkWidths = 'linkWidths',
}

export enum TransitionEasing {
  Linear = 'linear',
  QuadIn = 'quad-in',
  QuadOut = 'quad-out',
  QuadInOut = 'quad-in-out',
  CubicIn = 'cubic-in',
  CubicOut = 'cubic-out',
  CubicInOut = 'cubic-in-out',
  SinIn = 'sin-in',
  SinOut = 'sin-out',
  SinInOut = 'sin-in-out',
  ExpIn = 'exp-in',
  ExpOut = 'exp-out',
  ExpInOut = 'exp-in-out',
  CircleIn = 'circle-in',
  CircleOut = 'circle-out',
  CircleInOut = 'circle-in-out',
}

const easingFunctions: Record<TransitionEasing, (t: number) => number> = {
  [TransitionEasing.Linear]: easeLinear,
  [TransitionEasing.QuadIn]: easeQuadIn,
  [TransitionEasing.QuadOut]: easeQuadOut,
  [TransitionEasing.QuadInOut]: easeQuadInOut,
  [TransitionEasing.CubicIn]: easeCubicIn,
  [TransitionEasing.CubicOut]: easeCubicOut,
  [TransitionEasing.CubicInOut]: easeCubicInOut,
  [TransitionEasing.SinIn]: easeSinIn,
  [TransitionEasing.SinOut]: easeSinOut,
  [TransitionEasing.SinInOut]: easeSinInOut,
  [TransitionEasing.ExpIn]: easeExpIn,
  [TransitionEasing.ExpOut]: easeExpOut,
  [TransitionEasing.ExpInOut]: easeExpInOut,
  [TransitionEasing.CircleIn]: easeCircleIn,
  [TransitionEasing.CircleOut]: easeCircleOut,
  [TransitionEasing.CircleInOut]: easeCircleInOut,
}

export class Transition {
  /** Last eased progress value in the `[0, 1]` range. */
  public progress = 1

  private readonly config: GraphConfigInterface
  private startTime = 0
  /** Properties queued via `queue()`, awaiting `start()` to consume them. */
  private pendingProperties = new Set<TransitionProperty>()
  /** Properties currently animating in the running cycle. */
  private activeProperties = new Set<TransitionProperty>()

  public constructor (config: GraphConfigInterface) {
    this.config = config
  }

  /** True while one or more properties are queued via `queue()` awaiting `start()`. */
  public get isPending (): boolean {
    return this.pendingProperties.size > 0
  }

  /** True between `start()` and the end of the cycle. */
  public get isActive (): boolean {
    return this.activeProperties.size > 0
  }

  /** Reports whether a specific property is part of the active cycle. */
  public isActiveFor (property: TransitionProperty): boolean {
    return this.activeProperties.has(property)
  }

  /** Queues a property for the next transition cycle. */
  public queue (property: TransitionProperty): void {
    this.pendingProperties.add(property)
  }

  /**
   * Starts a queued transition cycle.
   *
   * - No pending queue → no-op.
   * - `transitionDuration > 0` → begin cycle; fire `onTransitionStart`.
   * - `transitionDuration <= 0` → pending is discarded; no cycle begins.
   *
   * In either non-no-op path, any active cycle is reported as interrupted
   * via `onTransitionEnd(true)` before the new state takes effect.
   */
  public start (): void {
    if (!this.isPending) return

    const { transitionDuration } = this.config

    if (transitionDuration <= 0) {
      const wasActive = this.isActive
      this.pendingProperties.clear()
      this.clearActiveCycle()
      if (wasActive) this.config.onTransitionEnd?.(true)
      return
    }

    if (this.isActive) {
      this.end(true)
    }

    this.startTime = performance.now()
    this.progress = 0
    this.activeProperties = new Set(this.pendingProperties)
    this.pendingProperties.clear()
    this.config.onTransitionStart?.()
  }

  /**
   * Advances the active cycle.
   *
   * - No active cycle → no-op.
   * - `transitionDuration <= 0` → end interrupted; fire `onTransitionEnd(true)`.
   * - Progress < 1 → update `progress`; fire `onTransition(eased)`.
   * - Progress reaches 1 → fire `onTransition(1)` then `onTransitionEnd(false)`.
   */
  public step (nowMs: number): void {
    if (!this.isActive) return

    const { transitionDuration } = this.config

    if (transitionDuration <= 0) {
      this.end(true)
      return
    }

    const linear = Math.min((nowMs - this.startTime) / transitionDuration, 1)
    const eased = this.applyEasing(linear)
    this.progress = eased
    this.config.onTransition?.(eased)

    if (linear >= 1) this.end(false)
  }

  /**
   * Ends the active cycle.
   *
   * - No active cycle → no-op.
   * - Otherwise → fire `onTransitionEnd(interrupted)`.
   */
  public end (interrupted: boolean): void {
    if (!this.isActive) return
    this.clearActiveCycle()
    this.config.onTransitionEnd?.(interrupted)
  }

  /**
   * Clears all transition state — active cycle and pending queue — without
   * firing lifecycle callbacks. Unlike `end()`, also drops any properties
   * queued via `queue()`.
   */
  public abort (): void {
    this.pendingProperties.clear()
    this.clearActiveCycle()
  }

  private applyEasing (t: number): number {
    return (easingFunctions[this.config.transitionEasing] ?? easeLinear)(t)
  }

  /** Ends the active cycle, preserving any pending queue for the next `start()`. */
  private clearActiveCycle (): void {
    this.startTime = 0
    this.progress = 1
    this.activeProperties.clear()
  }
}
