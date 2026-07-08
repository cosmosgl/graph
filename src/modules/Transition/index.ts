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

/**
 * Drives timed transitions (positions / colors / sizes / …) between data updates.
 *
 * Three durations, three scopes:
 * - `config.transitionDuration` — the default (app lifetime);
 * - `overrideDuration` — the plan for the next cycle (this render only; armed by
 *   `setDurationOverride()`, consumed by `start()`);
 * - `activeDuration` — the running cycle's memory (set by `start()`, paces `step()`).
 *
 * The `duration` getter (override, else config) is the single rule for the next cycle: `start()`
 * resolves through it, so code predicting animate vs. snap always matches what `start()` does.
 * The cycle's memory never feeds back into that rule.
 */
export class Transition {
  /** Last eased progress value in the `[0, 1]` range. */
  public progress = 1

  private readonly config: GraphConfigInterface
  private startTime = 0
  /** Properties queued via `queue()`, awaiting `start()` to consume them. */
  private pendingProperties = new Set<TransitionProperty>()
  /** Properties currently animating in the running cycle. */
  private activeProperties = new Set<TransitionProperty>()
  /**
   * Duration (ms) overriding `config.transitionDuration` for the cycle this render is about to
   * start. Set by `setDurationOverride()` before the update pipeline (which reads `duration` to
   * decide animate vs. snap), consumed by `start()`. `render()` sets it before every `start()`,
   * so an override never carries into another render.
   */
  private overrideDuration?: number
  /**
   * Duration (ms) the running animation remembers for all its frames.
   *
   * Matters whenever an animation with a custom duration is playing — especially
   * if another update can arrive before it finishes: `start()` records the cycle's
   * duration here, so an interrupting update with a different duration doesn't
   * affect this one, which still knows its own length frame to frame.
   */
  private activeDuration = 0

  public constructor (config: GraphConfigInterface) {
    this.config = config
  }

  /**
   * Duration (ms) the next `start()` will use: the render override if armed, else the config
   * default. `0` means snap. `start()` resolves through this same getter, so predicting
   * animate vs. snap before it runs always matches what it does.
   */
  public get duration (): number {
    return this.overrideDuration ?? this.config.transitionDuration
  }

  /** True while one or more properties are queued via `queue()` awaiting `start()`. */
  public get isPending (): boolean {
    return this.pendingProperties.size > 0
  }

  /** True between `start()` and the end of the cycle. */
  public get isActive (): boolean {
    return this.activeProperties.size > 0
  }

  /**
   * Overrides `config.transitionDuration` for the transition this render will start, for this
   * render only. `undefined` (or a non-finite value) falls back to config. Called by `render()`
   * before the update pipeline runs, and consumed by `start()`.
   */
  public setDurationOverride (duration?: number): void {
    this.overrideDuration = (duration !== undefined && Number.isFinite(duration)) ? duration : undefined
  }

  /** Reports whether a specific property is queued and awaiting `start()`. */
  public isPendingFor (property: TransitionProperty): boolean {
    return this.pendingProperties.has(property)
  }

  /** Reports whether a specific property is part of the active cycle. */
  public isActiveFor (property: TransitionProperty): boolean {
    return this.activeProperties.has(property)
  }

  /** Queues a property for the next transition cycle. */
  public queue (property: TransitionProperty): void {
    this.pendingProperties.add(property)
  }

  /** Removes a property from the pending queue without affecting the active cycle. */
  public dequeue (property: TransitionProperty): void {
    this.pendingProperties.delete(property)
  }

  /**
   * Starts a queued transition cycle.
   *
   * - No pending queue → no-op.
   * - `duration > 0` → begin cycle; fire `onTransitionStart`.
   * - `duration <= 0` → pending is discarded; no cycle begins.
   *
   * In either non-no-op path, any active cycle is reported as interrupted
   * via `onTransitionEnd(true)` before the new state takes effect.
   *
   * Uses the render override from `setDurationOverride()` (if any), else
   * `config.transitionDuration`, and clears the override so it applies once.
   */
  public start (): void {
    // Consume the override even when nothing is pending, so it can't linger into a later render.
    const transitionDuration = this.duration
    this.overrideDuration = undefined

    if (!this.isPending) return

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

    this.activeDuration = transitionDuration
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
  public step (): void {
    if (!this.isActive) return

    const transitionDuration = this.activeDuration

    if (transitionDuration <= 0) {
      this.end(true)
      return
    }

    const linear = Math.min((performance.now() - this.startTime) / transitionDuration, 1)
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
   *
   * TODO: support per-property end.
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
    this.overrideDuration = undefined
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
