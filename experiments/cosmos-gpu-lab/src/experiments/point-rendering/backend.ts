export type PointRenderData = {
  positions: Float32Array;
  colors: Float32Array;
  count: number;
}

export type PointRenderBackend = {
  readonly info?: string;
  setData: (data: PointRenderData) => void;
  render: (diameter: number) => void;
  measure: (diameter: number, iterations?: number) => Promise<PointRenderMeasurement>;
  destroy: () => void;
}

export type PointRenderMeasurement = {
  submitMilliseconds: number;
  completionMilliseconds: number;
}
