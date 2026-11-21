type TokenKind =
  | 'attribute'
  | 'comment'
  | 'function'
  | 'keyword'
  | 'number'
  | 'operator'
  | 'string'
  | 'type'

const wgslKeywords = new Set([
  'alias', 'break', 'case', 'const', 'const_assert', 'continue', 'continuing',
  'default', 'diagnostic', 'discard', 'else', 'enable', 'false', 'fn', 'for',
  'if', 'let', 'loop', 'override', 'requires', 'return', 'struct', 'switch',
  'true', 'var', 'while',
])

const wgslTypes = new Set([
  'array', 'atomic', 'bool', 'f16', 'f32', 'i32', 'ptr', 'sampler',
  'sampler_comparison', 'u32',
])

const glslKeywords = new Set([
  'break', 'case', 'const', 'continue', 'default', 'discard', 'do', 'else',
  'false', 'for', 'highp', 'if', 'in', 'inout', 'layout', 'lowp', 'mediump',
  'out', 'precision', 'return', 'struct', 'switch', 'true', 'uniform', 'void',
  'while',
])

const glslTypes = new Set([
  'bool', 'float', 'int', 'uint', 'sampler2D', 'sampler2DArray', 'samplerCube',
])

const numberPattern =
  /^(?:0[xX][0-9a-fA-F]+(?:\.[0-9a-fA-F]*)?(?:[pP][+-]?\d+)?|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)(?:[fhiu])?/

function escapeHtml (value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function token (kind: TokenKind, value: string): string {
  return `<span class="syntax-${kind}">${escapeHtml(value)}</span>`
}

function isIdentifierStart (character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_]/.test(character)
}

function isIdentifierPart (character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character)
}

function isWgslType (identifier: string): boolean {
  return wgslTypes.has(identifier) ||
    /^(?:vec[234](?:[fiuh])?|mat[234]x[234](?:[fh])?|texture_[A-Za-z0-9_]+)$/.test(identifier)
}

function isGlslType (identifier: string): boolean {
  return glslTypes.has(identifier) ||
    /^(?:[biu]?vec[234]|mat[234](?:x[234])?)$/.test(identifier)
}

function nextNonWhitespace (source: string, index: number): string | undefined {
  while (index < source.length && /\s/.test(source[index])) index += 1
  return source[index]
}

function readQuoted (source: string, start: number): number {
  let index = start + 1
  while (index < source.length) {
    if (source[index] === '\\') index += 2
    else if (source[index++] === '"') break
  }
  return index
}

function readBlockComment (source: string, start: number): number {
  let index = start + 2
  let depth = 1
  while (index < source.length && depth > 0) {
    if (source.startsWith('/*', index)) {
      depth += 1
      index += 2
    } else if (source.startsWith('*/', index)) {
      depth -= 1
      index += 2
    } else index += 1
  }
  return index
}

function highlightShader (source: string, language: 'wgsl' | 'glsl'): string {
  let output = ''
  let index = 0

  while (index < source.length) {
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index)
      const next = end < 0 ? source.length : end
      output += token('comment', source.slice(index, next))
      index = next
      continue
    }

    if (source.startsWith('/*', index)) {
      const end = readBlockComment(source, index)
      output += token('comment', source.slice(index, end))
      index = end
      continue
    }

    if (source[index] === '"') {
      const end = readQuoted(source, index)
      output += token('string', source.slice(index, end))
      index = end
      continue
    }

    if (language === 'glsl' && source[index] === '#') {
      const end = source.indexOf('\n', index)
      const next = end < 0 ? source.length : end
      output += token('attribute', source.slice(index, next))
      index = next
      continue
    }

    if (
      language === 'wgsl' &&
      source[index] === '@' &&
      isIdentifierStart(source[index + 1])
    ) {
      let end = index + 2
      while (isIdentifierPart(source[end])) end += 1
      output += token('attribute', source.slice(index, end))
      index = end
      continue
    }

    const numberMatch = numberPattern.exec(source.slice(index))
    if (numberMatch && (/\d/.test(source[index]) || source[index] === '.')) {
      output += token('number', numberMatch[0])
      index += numberMatch[0].length
      continue
    }

    if (isIdentifierStart(source[index])) {
      let end = index + 1
      while (isIdentifierPart(source[end])) end += 1
      const identifier = source.slice(index, end)
      const isKeyword = language === 'wgsl'
        ? wgslKeywords.has(identifier)
        : glslKeywords.has(identifier)
      const identifierIsType = language === 'wgsl'
        ? isWgslType(identifier)
        : isGlslType(identifier)
      if (isKeyword) output += token('keyword', identifier)
      else if (identifierIsType) output += token('type', identifier)
      else if (nextNonWhitespace(source, end) === '(') output += token('function', identifier)
      else output += escapeHtml(identifier)
      index = end
      continue
    }

    const operatorMatch = /^(?:->|==|!=|<=|>=|&&|\|\||<<|>>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|[+\-*/%=&|^!~<>?:])/.exec(source.slice(index))
    if (operatorMatch) {
      output += token('operator', operatorMatch[0])
      index += operatorMatch[0].length
      continue
    }

    output += escapeHtml(source[index])
    index += 1
  }

  return output
}

export function highlightWgsl (source: string): string {
  return highlightShader(source, 'wgsl')
}

export function highlightGlsl (source: string): string {
  return highlightShader(source, 'glsl')
}
