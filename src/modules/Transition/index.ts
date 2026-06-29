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
  /** One-shot duration (ms) for the next cycle, set via `setNextDuration`. Consumed by `start()`. */
  private overrideDuration?: number
  /**
   * Duration (ms) the running animation remembers for all its frames.
   *
   * Matters whenever an animation with a custom duration is playing — especially
   * if another update can arrive before it finishes: `start()` copies the one-shot
   * override here and clears the override right away, so an interrupting update
   * isn't affected by this one's override, while this animation still knows its own
   * length frame to frame.
   */
  private activeDuration = 0

  public constructor (config: GraphConfigInterface) {
    this.config = config
  }

  /**
   * How long the *next* update's transition should last (ms). A duration of 0 means
   * the next update snaps instead of animating.
   *
   * Priority:
   *   1. a one-shot override from `setNextTransitionDuration()`, if set;
   *   2. else the running cycle's duration, if one is active;
   *   3. else the config default.
   *
   * The override wins even mid-animation, so `setNextTransitionDuration(0)` always
   * snaps the next update. This only affects the next update — a transition that is
   * already playing keeps its own length (`step()` uses `activeDuration` directly).
   */
  public get duration (): number {
    return this.overrideDuration ?? (this.isActive ? this.activeDuration : this.config.transitionDuration)
  }

  /** True while one or more properties are queued via `queue()` awaiting `start()`. */
  public get isPending (): boolean {
    return this.pendingProperties.size > 0
  }

  /** True between `start()` and the end of the cycle. */
  public get isActive (): boolean {
    return this.activeProperties.size > 0
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
   * Sets a one-shot duration (ms) for the next cycle only, overriding
   * `config.transitionDuration`. `0` snaps with no animation; `undefined` falls
   * back to config. Consumed when the next cycle starts.
   */
  public setNextDuration (duration?: number): void {
    this.overrideDuration = duration
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

    // Consume the one-shot override (if any) so it applies to this cycle only.
    const transitionDuration = this.overrideDuration ?? this.config.transitionDuration
    this.overrideDuration = undefined

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
