/**
 * **标量表达式解析（W5/W6 共用，2026-11-09 拆出）**。
 *
 * 只解析、**绝不 eval**：数字、`√n`、`√n/m`、`a√n/m`、`a/b`。
 * 超过这个形状返回 `undefined`（随之落到 `unknown`）。
 *
 * 拆成独立模块的理由：W6 的题族判据也要用它，而留在 `mathAnswerVerification`
 * 里会造成 `mathAnswerVerification ↔ domainChecks` 的循环依赖。
 */

export function parseScalar(input: string): number | undefined {
  const text = input
    .replace(/\\left|\\right/g, "")
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, "√$1")
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\cdot|\\times/g, "*")
    .replace(/[$\s]/g, "")
    .replace(/[×]/g, "*")
    .trim()
  if (text.length === 0) return undefined

  const fraction = /^\((.+)\)\/\((.+)\)$/.exec(text)
  if (fraction !== null) {
    const numerator = parseScalar(fraction[1]!)
    const denominator = parseScalar(fraction[2]!)
    if (!finite(numerator) || !finite(denominator) || denominator === 0) return undefined
    return numerator / denominator
  }
  const plain = /^(-?\d+(?:\.\d+)?)$/.exec(text)
  if (plain !== null) return Number(plain[1])
  const ratio = /^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(text)
  if (ratio !== null) {
    const denominator = Number(ratio[2])
    return denominator === 0 ? undefined : Number(ratio[1]) / denominator
  }
  const radical = /^(-?)√(\d+(?:\.\d+)?)$/.exec(text)
  if (radical !== null) return (radical[1] === "-" ? -1 : 1) * Math.sqrt(Number(radical[2]))
  const radicalOver = /^(-?)√(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(text)
  if (radicalOver !== null) {
    const denominator = Number(radicalOver[3])
    if (denominator === 0) return undefined
    return (radicalOver[1] === "-" ? -1 : 1) * Math.sqrt(Number(radicalOver[2])) / denominator
  }
  const coefficient = /^(-?\d+(?:\.\d+)?)√(\d+(?:\.\d+)?)(?:\/(-?\d+(?:\.\d+)?))?$/.exec(text)
  if (coefficient !== null) {
    const denominator = coefficient[3] === undefined ? 1 : Number(coefficient[3])
    if (denominator === 0) return undefined
    return Number(coefficient[1]) * Math.sqrt(Number(coefficient[2])) / denominator
  }
  return undefined
}

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value)
}
