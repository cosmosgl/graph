import { loadDatasetBytes } from './dataset-loader'

interface ResearchNetworkData {
  version: 2;
  names: string[];
  communities: number[];
  categories: number[];
  links: Float32Array;
  groups: string[];
}

export async function loadResearchNetwork (
  manifest: { file: string; pointCount: number; linkCount: number; communityCount: number; categoryNames: readonly string[] },
  signal?: AbortSignal
): Promise<ResearchNetworkData> {
  const bytes = await loadDatasetBytes(manifest.file, signal)
  const data = JSON.parse(new TextDecoder().decode(bytes)) as (Omit<ResearchNetworkData, 'links'> & { links: number[] }) | null
  const invalid = (): never => { throw new Error('The arXiv dataset does not match the Knowledge Network build.') }
  const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
  if (!data || data.version !== 2 || !Array.isArray(data.names) || data.names.length !== manifest.pointCount || !data.names.every(isText) ||
      !Array.isArray(data.communities) || data.communities.length !== manifest.pointCount || !Array.isArray(data.groups) ||
      data.groups.length !== manifest.communityCount || !data.groups.every(isText) ||
      !Array.isArray(data.categories) || data.categories.length !== manifest.pointCount ||
      !Array.isArray(data.links) || data.links.length !== manifest.linkCount * 2) return invalid()

  const isIndex = (value: number, count: number): boolean => Number.isInteger(value) && value >= 0 && value < count
  if (data.communities.some(index => !isIndex(index, data.groups.length)) ||
      data.categories.some(index => !isIndex(index, manifest.categoryNames.length)) ||
      data.links.some((index, i) => !isIndex(index, data.names.length) || (i % 2 === 1 && index <= data.links[i - 1]!))) return invalid()

  return { ...data, links: new Float32Array(data.links) }
}
