import type { GraphConfig } from '@cosmos.gl/graph'

export interface ClusterLabel {
  text: string;
  color: string;
  weight: number;
}

/** Gallery studies: all visual elements become cosmos data channels. */
export interface SceneData {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  links?: Float32Array;
  linkColors?: Float32Array;
  linkWidths?: Float32Array;
  pointLabels?: string[];
  pointClusters?: number[];
  clusterLabels?: readonly ClusterLabel[];
  updateColors?: (tick: number) => void;
  update?: (timeSeconds: number) => void;
}

interface SceneBase {
  id: string;
  title: string;
  description: string;
  pointCount: number;
  linkCount: number;
  background: string;
  source?: { label: string; url: string };
}

export interface DatasetSceneDefinition extends SceneBase {
  benchmark?: false;
  simulation?: never;
  dataset: {
    file: string;
    pointSize: number;
    linkWidth: number;
    pointColor: string;
    linkColor: string;
    /** Opening camera in the dataset's normalized, y-up coordinates. Fit view still frames the full data. */
    initialView: { center: readonly [number, number]; height: number };
  };
}

export interface GeneratedSceneDefinition extends SceneBase {
  benchmark?: false;
  dataset?: never;
  loadingDataset?: true;
  simulation?: GraphConfig;
  /** Opening zoom relative to the fitted graph. */
  initialZoomFactor?: number;
  warmupSteps?: number;
  create: (random: () => number, signal?: AbortSignal) => SceneData | Promise<SceneData>;
}

export interface BenchmarkSceneDefinition extends SceneBase {
  benchmark: true;
  dataset?: never;
  simulation?: never;
}

export type SceneDefinition = GeneratedSceneDefinition | BenchmarkSceneDefinition | DatasetSceneDefinition
