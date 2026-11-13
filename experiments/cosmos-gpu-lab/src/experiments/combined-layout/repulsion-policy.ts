// Match src/modules/ForceManyBody's algorithm selection. Forced hierarchy
// remains the default for earlier lab controls and their comparable profiles.
export type RepulsionPolicy = 'hierarchical' | 'production'
export type RepulsionMethod = 'exact' | 'hierarchical'
export const ALL_PAIRS_MAX_POINTS = 4096
export function repulsionMethod (count: number, policy: RepulsionPolicy): RepulsionMethod {
  return policy === 'production' && count <= ALL_PAIRS_MAX_POINTS ? 'exact' : 'hierarchical'
}
