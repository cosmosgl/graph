export type EvidenceSource = { source: string; recorded?: string; device?: string; scope: string }

// A deliberately small front-matter format: four plain-text fields, no HTML or
// YAML execution. Measurement dates come from the article, never today's date.
export function readEvidenceSource (source: string): { body: string; evidence?: EvidenceSource } {
  const match = /^---\r?\nsource: ([^\n]+)\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source)
  if (!match) return { body: source }
  const fields: Record<string, string> = { source: match[1].trim() }
  for (const line of match[2].split(/\r?\n/)) {
    const field = /^(recorded|device|scope): (.+)$/.exec(line)
    if (!field) throw new Error(`Invalid evidence metadata: ${line}`)
    if (Object.hasOwn(fields, field[1])) throw new Error(`Duplicate evidence field: ${field[1]}`)
    fields[field[1]] = field[2].trim()
  }
  if (!fields.scope) throw new Error('Evidence metadata needs an explicit scope')
  return { body: source.slice(match[0].length), evidence: fields as EvidenceSource }
}

export function evidenceSourceNote (evidence?: EvidenceSource): HTMLElement {
  const note = document.createElement('aside'); note.className = 'evidence-source'
  note.setAttribute('aria-label', 'Document source')
  const label = document.createElement('p'); label.className = 'document-source'
  label.textContent = evidence ? `${evidence.source} · separate from this browser’s live run` : 'Technical explanation · no live run results'
  note.append(label)
  if (evidence) {
    const fields = document.createElement('dl'); fields.className = 'source-fields'
    for (const [title, value] of [['Measured', evidence.recorded ?? 'Not recorded'],
      ['Device / browser', evidence.device ?? 'Not recorded'], ['Scope', evidence.scope]]) {
      const row = document.createElement('div'); const term = document.createElement('dt'); const description = document.createElement('dd')
      term.textContent = title; description.textContent = value; row.append(term, description); fields.append(row)
    }
    note.append(fields)
  }
  return note
}
