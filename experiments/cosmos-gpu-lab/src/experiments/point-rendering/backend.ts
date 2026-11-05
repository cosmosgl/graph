export type PointRenderData = {
  positions: Float32Array;
  colors: Float32Array;
  count: number;
}

export type PointRenderBackend = {
  setData: (data: PointRenderData) => void;
  render: (diameter: number) => void;
  measure: (diameter: number, iterations?: number) => Promise<PointRenderMeasurement>;
  destroy: () => void;
}

export type PointRenderMeasurement = {
  submitMilliseconds: number;
  completionMilliseconds: number;
}
