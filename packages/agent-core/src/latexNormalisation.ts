/**
 * **真实考试题入口的 LaTeX 归一化**（2026-10-19，任务 P5-1；T02 增补 UTF-16 source map）。
 *
 * 题面解析器只认中文与 Unicode 符号，不认 `$...$`、`\triangle`、`\sqrt`。
 * 纯文本题面逐字返回（不清洗空格），避免无谓地改动原文与 span；
 * 含 LaTeX 时记录逐 UTF-16 区间的精确映射，确保归一化后的任何片段与重复从句
 * 都可无二义地映回用户原文。
 */

const LATEX_MARKER = /[$\\]/

const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉"

export interface SourceMapSegment {
  normStart: number
  normEnd: number
  origStart: number
  origEnd: number
}

export interface MappedPrompt {
  original: string
  normalized: string
  segments: SourceMapSegment[]
}

interface TrackedText {
  text: string
  starts: number[]
  ends: number[]
}

type TrackedToken =
  | string
  | { sliceFrom: number; sliceTo: number }
  | { literal: string; origStart: number; origEnd: number }

function createTrackedText(source: string): TrackedText {
  const length = source.length
  const starts = new Array<number>(length)
  const ends = new Array<number>(length)
  for (let index = 0; index < length; index += 1) {
    starts[index] = index
    ends[index] = index + 1
  }
  return { text: source, starts, ends }
}

function spanOfMatch(doc: TrackedText, start: number, end: number): { origStart: number; origEnd: number } {
  if (end <= start) {
    const at = Math.min(Math.max(start, 0), doc.starts.length - 1)
    if (at < 0) return { origStart: 0, origEnd: 0 }
    const offset = doc.starts[at]!
    return { origStart: offset, origEnd: offset }
  }
  let origStart = doc.starts[start]!
  let origEnd = doc.ends[end - 1]!
  for (let index = start; index < end; index += 1) {
    if (doc.starts[index]! < origStart) origStart = doc.starts[index]!
    if (doc.ends[index]! > origEnd) origEnd = doc.ends[index]!
  }
  return { origStart, origEnd }
}

function trackedReplace(
  doc: TrackedText,
  pattern: RegExp,
  replacer: string | ((match: RegExpExecArray, span: { origStart: number; origEnd: number }) => string | TrackedToken[])
): TrackedText {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`
  const globalPattern = new RegExp(pattern.source, flags)
  let cursor = 0
  const chunks: string[] = []
  const nextStarts: number[] = []
  const nextEnds: number[] = []

  const appendOriginalSlice = (from: number, to: number): void => {
    if (to <= from) return
    chunks.push(doc.text.slice(from, to))
    for (let index = from; index < to; index += 1) {
      nextStarts.push(doc.starts[index]!)
      nextEnds.push(doc.ends[index]!)
    }
  }

  const appendLiteral = (value: string, origStart: number, origEnd: number): void => {
    if (value.length === 0) return
    chunks.push(value)
    for (let offset = 0; offset < value.length; offset += 1) {
      nextStarts.push(origStart)
      nextEnds.push(origEnd)
    }
  }

  for (const match of doc.text.matchAll(globalPattern)) {
    const start = match.index
    const end = start + match[0].length
    appendOriginalSlice(cursor, start)
    const span = spanOfMatch(doc, start, end)
    const result = typeof replacer === "string"
      ? match[0].replace(new RegExp(pattern.source, pattern.flags.replace("g", "")), replacer)
      : replacer(match as RegExpExecArray, span)

    if (typeof result === "string") {
      appendLiteral(result, span.origStart, span.origEnd)
    } else {
      for (const token of result) {
        if (typeof token === "string") appendLiteral(token, span.origStart, span.origEnd)
        else if ("sliceFrom" in token) appendOriginalSlice(token.sliceFrom, token.sliceTo)
        else appendLiteral(token.literal, token.origStart, token.origEnd)
      }
    }
    cursor = end
  }
  appendOriginalSlice(cursor, doc.text.length)

  return { text: chunks.join(""), starts: nextStarts, ends: nextEnds }
}

function captureRange(match: RegExpExecArray, groupIndex: number): { from: number; to: number } | null {
  const value = match[groupIndex]
  if (value === undefined) return null
  const inMatch = match[0].indexOf(value)
  if (inMatch < 0) return null
  const from = match.index + inMatch
  return { from, to: from + value.length }
}

function sliceTracked(doc: TrackedText, from: number, to: number): TrackedText {
  return {
    text: doc.text.slice(from, to),
    starts: doc.starts.slice(from, to),
    ends: doc.ends.slice(from, to)
  }
}

function concatTracked(parts: readonly TrackedText[]): TrackedText {
  return {
    text: parts.map((part) => part.text).join(""),
    starts: parts.flatMap((part) => part.starts),
    ends: parts.flatMap((part) => part.ends)
  }
}

function literalTracked(value: string, origStart: number, origEnd: number): TrackedText {
  return {
    text: value,
    starts: new Array<number>(value.length).fill(origStart),
    ends: new Array<number>(value.length).fill(origEnd)
  }
}

function groupOperandTracked(doc: TrackedText, start: number, end: number): TrackedText {
  const raw = doc.text.slice(start, end)
  const leadingSpaces = raw.length - raw.trimStart().length
  const trailingSpaces = raw.length - raw.trimEnd().length
  const trimmedStart = start + leadingSpaces
  const trimmedEnd = Math.max(trimmedStart, end - trailingSpaces)
  const trimmed = doc.text.slice(trimmedStart, trimmedEnd)
  if (/^(?:√?\d+(?:\.\d+)?|π|[A-Za-z](?:[²³⁴⁵⁶⁷⁸⁹]|\^\d+)?)$/.test(trimmed)) {
    return sliceTracked(doc, trimmedStart, trimmedEnd)
  }
  const span = spanOfMatch(doc, start, end)
  return concatTracked([
    literalTracked("(", span.origStart, span.origStart + 1),
    sliceTracked(doc, start, end),
    literalTracked(")", Math.max(span.origStart, span.origEnd - 1), span.origEnd)
  ])
}

function lowerMathGroupsTracked(source: TrackedText, inFunction: boolean): TrackedText {
  let current = source
  for (let depth = 0; depth < 32; depth += 1) {
    let changed = false
    const withBracedExponent = trackedReplace(current, /\^\s*\{([^{}]+)\}/g, (match, span) => {
      changed = true
      const group = captureRange(match, 1)
      const inner = group === null ? literalTracked(match[1] ?? "", span.origStart, span.origEnd) : sliceTracked(current, group.from, group.to)
      const leading = inner.text.length - inner.text.trimStart().length
      const trailing = inner.text.length - inner.text.trimEnd().length
      const trimmed = sliceTracked(inner, leading, inner.text.length - trailing)
      if (trimmed.text === "2") return [{ literal: "²", origStart: span.origStart, origEnd: span.origEnd }]
      if (trimmed.text === "°") return [{ literal: "°", origStart: span.origStart, origEnd: span.origEnd }]
      const caretEnd = Math.min(span.origEnd, trimmed.starts[0] ?? span.origStart + 1)
      const innerTokens: TrackedToken[] = Array.from({ length: trimmed.text.length }, (_, i) => ({
        literal: trimmed.text[i]!,
        origStart: trimmed.starts[i]!,
        origEnd: i === trimmed.text.length - 1 ? span.origEnd : trimmed.ends[i]!
      }))
      if (/^[A-Za-z0-9]+$/.test(trimmed.text)) {
        return [{ literal: "^", origStart: span.origStart, origEnd: caretEnd }, ...innerTokens]
      }
      return [
        { literal: "^(", origStart: span.origStart, origEnd: caretEnd },
        ...innerTokens,
        { literal: ")", origStart: Math.max(span.origStart, span.origEnd - 1), origEnd: span.origEnd }
      ]
    })

    const withSqrt = trackedReplace(withBracedExponent, /\\sqrt\s*\{([^{}]+)\}/g, (match, span) => {
      changed = true
      const group = captureRange(match, 1)
      const inner = group === null ? literalTracked(match[1] ?? "", span.origStart, span.origEnd) : sliceTracked(withBracedExponent, group.from, group.to)
      const trimmed = inner.text.trim()
      if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
        const leading = inner.text.length - inner.text.trimStart().length
        const trailing = inner.text.length - inner.text.trimEnd().length
        const trimmedInner = sliceTracked(inner, leading, inner.text.length - trailing)
        const tokens: TrackedToken[] = [
          { literal: "√", origStart: span.origStart, origEnd: Math.min(span.origEnd, span.origStart + 5) }
        ]
        for (let i = 0; i < trimmedInner.text.length; i += 1) {
          tokens.push({ literal: trimmedInner.text[i]!, origStart: trimmedInner.starts[i]!, origEnd: trimmedInner.ends[i]! })
        }
        return tokens
      }
      const tokens: TrackedToken[] = [
        { literal: "√(", origStart: span.origStart, origEnd: span.origEnd },
        ...Array.from({ length: inner.text.length }, (_, i) => ({ literal: inner.text[i]!, origStart: inner.starts[i]!, origEnd: inner.ends[i]! })),
        { literal: ")", origStart: span.origStart, origEnd: span.origEnd }
      ]
      return tokens
    })

    const withFrac = trackedReplace(withSqrt, /\\(?:[dt]?frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, (match, span) => {
      changed = true
      const numRange = captureRange(match, 1)
      const denRange = (() => {
        const value = match[2]
        if (value === undefined) return null
        const afterFirstClose = numRange === null ? match.index : withSqrt.text.indexOf("}", numRange.to) + 1
        const at = withSqrt.text.indexOf(value, Math.max(match.index, afterFirstClose))
        return at < 0 ? null : { from: at, to: at + value.length }
      })()
      const numTracked = numRange === null
        ? literalTracked(match[1] ?? "", span.origStart, span.origEnd)
        : groupOperandTracked(withSqrt, numRange.from, numRange.to)
      const denTracked = denRange === null
        ? literalTracked(match[2] ?? "", span.origStart, span.origEnd)
        : groupOperandTracked(withSqrt, denRange.from, denRange.to)
      const body = concatTracked([
        numTracked,
        literalTracked("/", numTracked.ends[numTracked.ends.length - 1] ?? span.origStart, denTracked.starts[0] ?? span.origEnd),
        denTracked
      ])
      const wrapped = inFunction
        ? concatTracked([literalTracked("(", span.origStart, span.origStart + 1), body, literalTracked(")", Math.max(span.origStart, span.origEnd - 1), span.origEnd)])
        : body
      return Array.from({ length: wrapped.text.length }, (_, i) => ({
        literal: wrapped.text[i]!,
        origStart: wrapped.starts[i]!,
        origEnd: wrapped.ends[i]!
      }))
    })
    current = withFrac
    if (!changed) break
  }
  return current
}

/** 等长替换：只修字形，不移动 span（P5-2）。 */
function fixOcrText(text: string): string {
  return text
    .replace(/棱雉|棱椎/g, "棱锥")
    .replace(/圆雉|圆椎/g, "圆锥")
}

function fixOcrTracked(doc: TrackedText): TrackedText {
  let next = trackedReplace(doc, /棱雉|棱椎/g, (match) => [
    { sliceFrom: match.index, sliceTo: match.index + 1 },
    { literal: "锥", origStart: doc.starts[match.index + 1]!, origEnd: doc.ends[match.index + 1]! }
  ])
  next = trackedReplace(next, /圆雉|圆椎/g, (match) => [
    { sliceFrom: match.index, sliceTo: match.index + 1 },
    { literal: "锥", origStart: next.starts[match.index + 1]!, origEnd: next.ends[match.index + 1]! }
  ])
  return next
}

/**
 * 把“等边三角形边长为 N”展开成三条边。
 * 这是**语法展开**，不猜题意；只在解析/核验内部用，原文与 span 保持不变时不要调用。
 */
export function expandExamShorthand(text: string): string {
  return text
    .replace(/△?([A-Z])([A-Z])([A-Z])是边长为([0-9.]+)的等边三角形/g, "$1$2=$4，$1$3=$4，$2$3=$4")
    .replace(/([0-9])\s*[.。]\s*(?=[\u4e00-\u9fff])/g, "$1，")
    .replace(/(^|[，,；;。.])\s*若/g, "$1")
}

function expandExamShorthandTracked(doc: TrackedText): TrackedText {
  let current = trackedReplace(doc, /△?([A-Z])([A-Z])([A-Z])是边长为([0-9.]+)的等边三角形/g, (_match) =>
    `${_match[1]}${_match[2]}=${_match[4]}，${_match[1]}${_match[3]}=${_match[4]}，${_match[2]}${_match[3]}=${_match[4]}`
  )
  current = trackedReplace(current, /([0-9])\s*[.。]\s*(?=[\u4e00-\u9fff])/g, (match) => [
    { sliceFrom: match.index, sliceTo: match.index + 1 },
    { literal: "，", origStart: current.starts[match.index + 1]!, origEnd: current.ends[match.index + match[0].length - 1]! }
  ])
  current = trackedReplace(current, /(^|[，,；;。.])\s*若/g, (match) => {
    const prefix = match[1] ?? ""
    if (prefix.length === 0) return []
    return [{ sliceFrom: match.index, sliceTo: match.index + prefix.length }]
  })
  return current
}

function buildSegments(doc: TrackedText): SourceMapSegment[] {
  const segments: SourceMapSegment[] = []
  for (let index = 0; index < doc.text.length; index += 1) {
    const origStart = doc.starts[index]!
    const origEnd = doc.ends[index]!
    const prev = segments[segments.length - 1]
    if (prev !== undefined && prev.normEnd === index && prev.origStart === origStart && prev.origEnd === origEnd) {
      prev.normEnd = index + 1
      continue
    }
    if (prev !== undefined && prev.normEnd === index && prev.origEnd === origStart) {
      prev.normEnd = index + 1
      prev.origEnd = origEnd
      continue
    }
    segments.push({ normStart: index, normEnd: index + 1, origStart, origEnd })
  }
  return segments
}

export function normalizeGeometryPromptWithSourceMap(prompt: string): MappedPrompt {
  if (!LATEX_MARKER.test(prompt)) {
    const normalized = fixOcrText(prompt)
    return {
      original: prompt,
      normalized,
      segments: normalized.length === 0 ? [] : [{ normStart: 0, normEnd: normalized.length, origStart: 0, origEnd: prompt.length }]
    }
  }

  let doc = createTrackedText(prompt)
  doc = trackedReplace(doc, /\$|\\[()[\]]/g, "")
  doc = trackedReplace(doc, /\\(?:left|right)\s*/g, "")
  doc = trackedReplace(doc, /\\(?:,|;|!|quad|qquad)\s*/g, "")
  doc = trackedReplace(doc, /~/g, "")

  doc = trackedReplace(doc, /\\triangle\s*/g, "△")
  doc = trackedReplace(doc, /\\angle\s*/g, "∠")
  doc = trackedReplace(doc, /\\pi\b/g, "π")
  doc = trackedReplace(doc, /\\perp\b/g, "⊥")
  doc = trackedReplace(doc, /\\parallel\b/g, "∥")
  doc = trackedReplace(doc, /\\cdot\b/g, "·")
  doc = trackedReplace(doc, /\\times\b/g, "×")
  doc = trackedReplace(doc, /\\neq\b/g, "≠")
  doc = trackedReplace(doc, /\\leq\b/g, "≤")
  doc = trackedReplace(doc, /\\geq\b/g, "≥")
  doc = trackedReplace(doc, /\\infty\b/g, "∞")
  doc = trackedReplace(doc, /\\circ\b/g, "°")

  doc = trackedReplace(doc, /([fgh]\s*\(\s*x\s*\)\s*=\s*)([^，,。；;\n\u4e00-\u9fff]+)/g, (match) => {
    const prefixLength = match[1]!.length
    const exprTracked = sliceTracked(doc, match.index + prefixLength, match.index + match[0].length)
    const lowered = lowerMathGroupsTracked(exprTracked, true)
    return [
      { sliceFrom: match.index, sliceTo: match.index + prefixLength },
      ...Array.from({ length: lowered.text.length }, (_, i) => ({
        literal: lowered.text[i]!,
        origStart: lowered.starts[i]!,
        origEnd: lowered.ends[i]!
      }))
    ]
  })

  doc = lowerMathGroupsTracked(doc, false)

  doc = trackedReplace(doc, /\\(?:mathrm|text|mathbf|operatorname)\s*\{([^{}]+)\}/g, (match) => {
    const group = captureRange(match, 1)
    return group === null ? match[1] ?? "" : [{ sliceFrom: group.from, sliceTo: group.to }]
  })
  doc = trackedReplace(doc, /\\overrightarrow\s*\{([^{}]+)\}/g, (match) => {
    const group = captureRange(match, 1)
    return group === null ? match[1] ?? "" : [{ sliceFrom: group.from, sliceTo: group.to }]
  })
  doc = trackedReplace(doc, /\\vec\s*\{([^{}]+)\}/g, (match) => {
    const group = captureRange(match, 1)
    return group === null ? match[1] ?? "" : [{ sliceFrom: group.from, sliceTo: group.to }]
  })
  doc = trackedReplace(doc, /\\arctan\b/g, "arctan")
  doc = trackedReplace(doc, /\\(sin|cos|tan)\s*x(?![\w(]|\s*\^)/g, (_match) => `${_match[1]}(x)`)
  doc = trackedReplace(doc, /\\(sin|cos|tan)(?=\s*\()/g, (match) => {
    const name = match[1]!
    const at = match.index + 1
    return [{ sliceFrom: at, sliceTo: at + name.length }]
  })

  doc = trackedReplace(doc, /\^\s*(?:\{\s*2\s*\}|2(?![\d.]))/g, "²")
  doc = trackedReplace(doc, /\^\s*\{?\s*°\s*\}?/g, "°")
  doc = trackedReplace(doc, /_\{?\s*([0-9]+)\s*\}?/g, (match) =>
    [...match[1]!].map((digit) => SUBSCRIPTS[Number(digit)] ?? digit).join(""))

  doc = fixOcrTracked(doc)
  doc = expandExamShorthandTracked(doc)

  const snapshot = doc
  doc = trackedReplace(doc, /\s+/g, (match) =>
    /[\r\n]/.test(match[0]) && /^(?:[（(]\s*[1-9]\d*\s*[）)]|[①-⑳])/.test(snapshot.text.slice(match.index + match[0].length))
      ? "\n"
      : ""
  )

  const trimStart = doc.text.length - doc.text.trimStart().length
  const trimEnd = doc.text.trimEnd().length
  const trimmed = sliceTracked(doc, trimStart, Math.max(trimStart, trimEnd))

  return {
    original: prompt,
    normalized: trimmed.text,
    segments: buildSegments(trimmed)
  }
}

export function normalizeGeometryPrompt(prompt: string): string {
  return normalizeGeometryPromptWithSourceMap(prompt).normalized
}

export function mapNormalizedRangeToOriginal(
  mapped: Pick<MappedPrompt, "original" | "normalized" | "segments">,
  normStart: number,
  normEnd: number
): { start: number; end: number } {
  if (mapped.segments.length === 0) return { start: 0, end: 0 }
  if (normEnd <= normStart) {
    const at = mapped.segments.find((segment) => normStart >= segment.normStart && normStart <= segment.normEnd)
    const target = at ?? mapped.segments[mapped.segments.length - 1]!
    return { start: target.origStart, end: target.origStart }
  }
  const overlapping = mapped.segments.filter((segment) => segment.normEnd > normStart && segment.normStart < normEnd)
  if (overlapping.length === 0) return { start: 0, end: 0 }
  // When normalized falls in a monotonic untouched segment (no length rewrite inside it), refine within segment bounds.
  let start = overlapping[0]!.origStart
  let end = overlapping[overlapping.length - 1]!.origEnd
  const first = overlapping[0]!
  if (first.normEnd - first.normStart === first.origEnd - first.origStart && normStart > first.normStart) {
    start = first.origStart + (normStart - first.normStart)
  }
  const last = overlapping[overlapping.length - 1]!
  if (last.normEnd - last.normStart === last.origEnd - last.origStart && normEnd < last.normEnd) {
    end = last.origStart + (normEnd - last.normStart)
  }
  return { start, end: Math.max(start, end) }
}
