import type { Check, Row } from './session'

type Status = 'pass' | 'fail' | 'not-assessed' | 'incomplete'
export type MatchedAssessment = {
  scope: string;
  numericalAccuracy: 'not-assessed';
  layoutQuality: 'measured-only' | 'not-assessed';
  performance: 'not-assessed';
  lanes: Record<'webgl' | 'webgpu', {
    legacyCompatibility: Status;
    flagsAndRestoration: Status;
    checkedTicks: number;
    probeChecked: boolean;
    finiteLayouts: Status;
  }>;
}

export function assessMatchedEvidence (
  rows: Row[], probe?: Row, errors: Partial<Record<'webgl' | 'webgpu', string>> = {}
): MatchedAssessment {
  const allRows = [...rows, ...(probe ? [probe] : [])]
  const result = (checks: Check[], failed: boolean, unavailable: boolean): Status =>
    failed ? 'fail' : unavailable ? 'incomplete' : checks.length ? 'pass' : 'not-assessed'
  const lane = (name: 'webgl' | 'webgpu'): MatchedAssessment['lanes']['webgl'] => {
    const checks = allRows.flatMap(row => row.checks[name] ? [row.checks[name]!] : [])
    const layouts = allRows.flatMap(row => row.quality[name] ? [row.quality[name]!] : [])
    const unavailable = !!errors[name] || allRows.some(row => !row.quality[name])
    return {
      legacyCompatibility: result(checks, checks.some(check => !check.valid), unavailable),
      flagsAndRestoration: result(checks, checks.some(check => !check.restored || check.stages.some(stage => !stage.flagsExact)), unavailable),
      checkedTicks: rows.filter(row => row.checks[name]).length,
      probeChecked: !!probe?.checks[name],
      finiteLayouts: layouts.some(layout => !layout.shape.finite) ? 'fail' : unavailable ? 'incomplete' : layouts.length ? 'pass' : 'not-assessed',
    }
  }
  return {
    scope: 'Limited flags/restoration checks and existing float32 compatibility gates only; unchecked ticks have no numerical verdict.',
    numericalAccuracy: 'not-assessed',
    layoutQuality: allRows.some(row => Object.keys(row.quality).length > 0) ? 'measured-only' : 'not-assessed',
    performance: 'not-assessed',
    lanes: { webgl: lane('webgl'), webgpu: lane('webgpu') },
  }
}
