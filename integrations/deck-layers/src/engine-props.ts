import { defaultConfigValues } from '@cosmos.gl/graph'
import type { GraphConfig } from '@cosmos.gl/graph'
import type { DefaultProps } from '@deck.gl/core'

/**
 * The engine config keys the links sublayer draws with. A key is added here,
 * once: its name, type and JSDoc come from cosmos's `GraphConfig`, its default
 * from `defaultConfigValues`, and the composite forwards it by this list — so
 * nothing about it is written twice, and the two layers cannot drift apart.
 */
export const LINK_ENGINE_KEYS = ['curvedLinks', 'curvedLinkSegments', 'curvedLinkWeight', 'curvedLinkControlPointDistance'] as const

/** The engine keys as layer props: cosmos's own types and docs. */
export type LinkEngineProps = Pick<GraphConfig, (typeof LINK_ENGINE_KEYS)[number]>

/**
 * deck defaults for engine keys, read from cosmos. An array default is declared
 * deep-compared, or an inline literal would count as a change on every render.
 */
export const engineDefaults = <K extends keyof GraphConfig & keyof typeof defaultConfigValues>(
  keys: readonly K[]
): DefaultProps<Pick<GraphConfig, K>> => {
  const defaults: Partial<Record<K, unknown>> = {}
  for (const key of keys) {
    const value: unknown = defaultConfigValues[key]
    defaults[key] = Array.isArray(value) ? { type: 'array', value, compare: true } : value
  }
  return defaults as DefaultProps<Pick<GraphConfig, K>>
}

export const LINK_ENGINE_DEFAULTS = engineDefaults(LINK_ENGINE_KEYS)

/** The listed keys of `props`: what the composite hands a sublayer. */
export const pickKeys = <T, K extends keyof T>(props: T, keys: readonly K[]): Pick<T, K> => {
  const picked = {} as Pick<T, K>
  for (const key of keys) picked[key] = props[key]
  return picked
}

/**
 * `record` without the listed keys. The composite forwards `transitions` to its
 * sublayers; the engine keys stay out, because the composite already
 * interpolates them, and the sublayer would animate the interpolated value again.
 */
export const omitKeys = <T extends Record<string, unknown>>(record: T | null | undefined, keys: readonly string[]): T | null | undefined => {
  if (!record) return record
  const kept = { ...record }
  for (const key of keys) delete kept[key]
  return kept
}
