export type ExperimentInstance = {
  destroy: () => void;
}

export type MarkdownPage = {
  kind: 'markdown';
  id: string;
  title: string;
  load: () => Promise<string>;
  assets?: Record<string, string>;
}

export type ExperimentReportResult = {
  backend: string;
  values: Record<string, string | number>;
}

export type ExperimentReport = {
  schemaVersion: number;
  experiment: string;
  title: string;
  recordedAt: string;
  status: string;
  commit: string;
  environment: Record<string, string>;
  parameters: Record<string, string | number>;
  results: ExperimentReportResult[];
  notes: string[];
}

export type ReportPage = {
  kind: 'report';
  id: string;
  title: string;
  load: () => Promise<ExperimentReport>;
}

export type ExperimentPage = MarkdownPage | ReportPage

export type ExperimentDefinition = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  create: (host: HTMLElement) => Promise<ExperimentInstance>;
  pages: ExperimentPage[];
}

export type ExperimentModule = {
  experiment: ExperimentDefinition;
}

export function defineExperiment (definition: ExperimentDefinition): ExperimentDefinition {
  return definition
}
