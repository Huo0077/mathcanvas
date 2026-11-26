export type BinaryOperator = "+" | "-" | "*" | "/" | "^"
export type RelationOperator = "=" | "<" | ">" | "<=" | ">=" | "!="

export interface DomainConstraint {
  kind: "nonzero" | "nonnegative" | "positive"
  expression: string
}

export interface ParsedRelationConstraint {
  terms: ExpressionNode[]
  operators: RelationOperator[]
  domains: DomainConstraint[]
  variables: string[]
  raw: string
}

export type ExpressionEvalResult =
  | { ok: true; value: number; domains: DomainConstraint[] }
  | { ok: false; error: string; domains: DomainConstraint[] }

export const MAX_EXPRESSION_LENGTH = 512
export const MAX_EXPRESSION_DEPTH = 24

const SUPER_DIGITS: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9"
}

export type ExpressionNode =
  | { type: "number"; value: number }
  | { type: "variable"; name: string }
  | { type: "unary"; operator: "+" | "-"; argument: ExpressionNode }
  | { type: "call"; name: string; argument: ExpressionNode }
  | { type: "binary"; operator: BinaryOperator; left: ExpressionNode; right: ExpressionNode }

type Token = { type: "number" | "identifier" | "operator" | "parenthesis"; value: string }

const functions = new Set([
  "abs", "acos", "acosh", "arccos", "arccot", "arcsin", "arctan", "asin", "asinh", "atan", "atanh",
  "cbrt", "ceil", "cos", "cosh", "cot", "csc", "exp", "floor", "lg", "ln", "log", "log10", "log2",
  "sec", "sgn", "sign", "sin", "sinh", "sqrt", "tan", "tanh"
])

const IMPLICIT_MUL_LEFT_VARS = new Set(["x", "y", "z", "t", "r", "theta", "pi", "e"])

function replaceLatexCommandWithBraces(
  source: string,
  command: string,
  argCount: 1 | 2,
  build: (args: string[]) => string
): string {
  let out = source
  let searchFrom = 0
  let guard = 0
  while (guard < 40) {
    guard += 1
    const idx = out.indexOf(command, searchFrom)
    if (idx === -1) break
    let cursor = idx + command.length
    const args: string[] = []
    let failed = false
    for (let a = 0; a < argCount; a += 1) {
      while (cursor < out.length && /\s/.test(out[cursor]!)) cursor += 1
      if (out[cursor] !== "{") {
        failed = true
        break
      }
      let depth = 0
      const start = cursor + 1
      while (cursor < out.length) {
        if (out[cursor] === "{") depth += 1
        else if (out[cursor] === "}") {
          depth -= 1
          if (depth === 0) break
        }
        cursor += 1
      }
      if (depth !== 0) {
        failed = true
        break
      }
      args.push(out.slice(start, cursor))
      cursor += 1
    }
    if (failed) {
      searchFrom = idx + command.length
      continue
    }
    const replacement = build(args)
    out = out.slice(0, idx) + replacement + out.slice(cursor)
    searchFrom = 0
  }
  return out
}

function preprocessLatexAndUnicode(raw: string): string {
  let s = raw.trim()
  // Strip wrapping LaTeX math delimiters `$...$`, `$$...$$`, `\(...\)`, `\[...\]`
  s = s.replace(/^\$\$?([\s\S]+?)\$\$?$/u, "$1").trim()
  s = s.replace(/^\\\(([\s\S]+?)\\\)$/u, "$1").replace(/^\\\[([\s\S]+?)\\\]$/u, "$1").trim()

  // LaTeX structural commands
  s = s
    .replace(/\\left\s*([(|[])/gu, "$1")
    .replace(/\\right\s*([)|\]])/gu, "$1")
    .replace(/\\(?:cdot|times)/gu, "*")
    .replace(/\\div/gu, "/")
    .replace(/\\pi\b/gu, "pi")
    .replace(/\\theta\b/gu, "theta")
    .replace(/\\sqrt\s*\[\s*3\s*\]\s*\{/gu, "\\cbrt{")

  s = replaceLatexCommandWithBraces(s, "\\frac", 2, ([numPart, denPart]) => `((${numPart})/(${denPart}))`)
  s = replaceLatexCommandWithBraces(s, "\\dfrac", 2, ([numPart, denPart]) => `((${numPart})/(${denPart}))`)
  s = replaceLatexCommandWithBraces(s, "\\tfrac", 2, ([numPart, denPart]) => `((${numPart})/(${denPart}))`)
  s = replaceLatexCommandWithBraces(s, "\\sqrt", 1, ([arg]) => `sqrt(${arg})`)
  s = replaceLatexCommandWithBraces(s, "\\cbrt", 1, ([arg]) => `cbrt(${arg})`)

  // Strip leading backslash on standard LaTeX math functions (`\sin`, `\ln`, `\arctan`, ...)
  s = s.replace(/\\(arcsin|arccos|arctan|arccot|asinh|acosh|atanh|sinh|cosh|tanh|sin|cos|tan|cot|sec|csc|ln|lg|log10|log2|log|exp|sqrt|cbrt|abs)\b/giu, "$1")

  // Convert LaTeX grouped exponents `^{...}` to `^(...)`
  s = replaceLatexCommandWithBraces(s, "^", 1, ([expArg]) => `^(${expArg})`)

  // Fullwidth Chinese & Unicode math punctuation
  s = s
    .replace(/[（【]/gu, "(")
    .replace(/[）】]/gu, ")")
    .replace(/｜/gu, "|")
    .replace(/＋/gu, "+")
    .replace(/[−–—－]/gu, "-")
    .replace(/[×·⋅＊]/gu, "*")
    .replace(/[÷／]/gu, "/")
    .replace(/＾/gu, "^")
    .replace(/＝/gu, "=")
    .replace(/π/gu, "pi")
    .replace(/θ/gu, "theta")
    .replace(/∛\s*\(/gu, "cbrt(")
    .replace(/∛\s*(\d+(?:\.\d+)?|[A-Za-z_]\w*)/gu, "cbrt($1)")
    .replace(/√\s*\(/gu, "sqrt(")
    .replace(/√\s*(\d+(?:\.\d+)?|[A-Za-z_]\w*)/gu, "sqrt($1)")

  return s
}

function rewriteTrigPowers(source: string): string {
  // Rewrite textbook powers like `sin^2(x)` -> `(sin(x))^2`, `2sin^2(x)` -> `2(sin(x))^2`
  const pattern = /(?<![A-Za-z_])(sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|ln|lg|log)\s*\^\s*(-?\d+(?:\.\d+)?)\s*\(/giu
  let out = source
  let guard = 0
  while (guard < 24) {
    guard += 1
    pattern.lastIndex = 0
    const match = pattern.exec(out)
    if (!match) break
    const fnName = match[1]!
    const power = match[2]!
    const openIdx = match.index + match[0].length - 1
    let depth = 0
    let closeIdx = -1
    for (let i = openIdx; i < out.length; i += 1) {
      if (out[i] === "(") depth += 1
      else if (out[i] === ")") {
        depth -= 1
        if (depth === 0) {
          closeIdx = i
          break
        }
      }
    }
    if (closeIdx === -1) break
    const inner = out.slice(openIdx + 1, closeIdx)
    out = `${out.slice(0, match.index)}(${fnName}(${inner}))^${power}${out.slice(closeIdx + 1)}`
  }
  return out
}

export function normalizeFunctionExpression(source: string): string {
  const pre = preprocessLatexAndUnicode(source)
  const normalized = rewriteTrigPowers(
    pre
      .replace(/^y\s*=\s*/i, "")
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (digits) => `^${[...digits].map((ch) => SUPER_DIGITS[ch] ?? ch).join("")}`)
  )
  if (!normalized) throw new Error("Expected expression")
  if (normalized.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`Expression length ${normalized.length} exceeds budget (${MAX_EXPRESSION_LENGTH})`)
  }
  return normalized
}

function insertImplicitMultiplication(tokens: Token[]): Token[] {
  const result: Token[] = []
  for (const token of tokens) {
    const prev = result[result.length - 1]
    if (prev !== undefined) {
      const prevLower = prev.value.toLowerCase()
      const prevIsKnownVar = prev.type === "identifier" && IMPLICIT_MUL_LEFT_VARS.has(prevLower)
      const prevEndsFactor = prev.type === "number" || prev.value === ")" || prevIsKnownVar
      const nextStartsFactor = token.type === "identifier" || token.value === "(" || token.type === "number"
      if (
        prevEndsFactor &&
        nextStartsFactor &&
        !(prev.type === "number" && token.type === "number")
      ) {
        result.push({ type: "operator", value: "*" })
      }
    }
    result.push(token)
  }
  return result
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < source.length) {
    const character = source[index]
    if (/\s/.test(character)) {
      index += 1
      continue
    }
    const number = source.slice(index).match(/^\d+(?:\.\d+)?/)
    if (number) {
      tokens.push({ type: "number", value: number[0] })
      index += number[0].length
      continue
    }
    const identifier = source.slice(index).match(/^[A-Za-z_]\w*/)
    if (identifier) {
      tokens.push({ type: "identifier", value: identifier[0] })
      index += identifier[0].length
      continue
    }
    if ("+-*/^".includes(character)) {
      tokens.push({ type: "operator", value: character })
      index += 1
      continue
    }
    if ("()|".includes(character)) {
      tokens.push({ type: "parenthesis", value: character })
      index += 1
      continue
    }
    throw new Error(`Unexpected character: ${character}`)
  }
  return insertImplicitMultiplication(tokens)
}

class ExpressionParser {
  private readonly tokens: Token[]
  private position = 0
  private depth = 0

  constructor(source: string) {
    this.tokens = tokenize(normalizeFunctionExpression(source))
  }

  private enter(): void {
    this.depth += 1
    if (this.depth > MAX_EXPRESSION_DEPTH) {
      throw new Error(`Expression recursion depth exceeds budget (${MAX_EXPRESSION_DEPTH})`)
    }
  }

  private leave(): void {
    this.depth -= 1
  }

  parse(): ExpressionNode {
    const expression = this.parseAddSub()
    if (this.position < this.tokens.length) throw new Error(`Unexpected token: ${this.tokens[this.position].value}`)
    return expression
  }

  private parseAddSub(): ExpressionNode {
    this.enter()
    try {
      let expression = this.parseMulDiv()
      while (this.isOperator("+") || this.isOperator("-")) {
        const operator = this.consume().value as BinaryOperator
        expression = { type: "binary", operator, left: expression, right: this.parseMulDiv() }
      }
      return expression
    } finally {
      this.leave()
    }
  }

  private parseMulDiv(): ExpressionNode {
    this.enter()
    try {
      let expression = this.parseUnary()
      while (this.isOperator("*") || this.isOperator("/")) {
        const operator = this.consume().value as BinaryOperator
        expression = { type: "binary", operator, left: expression, right: this.parseUnary() }
      }
      return expression
    } finally {
      this.leave()
    }
  }

  private parseUnary(): ExpressionNode {
    this.enter()
    try {
      if (this.isOperator("+") || this.isOperator("-")) {
        const operator = this.consume().value as "+" | "-"
        return { type: "unary", operator, argument: this.parseUnary() }
      }
      return this.parsePower()
    } finally {
      this.leave()
    }
  }

  private parsePower(): ExpressionNode {
    this.enter()
    try {
      const left = this.parsePrimary()
      if (!this.isOperator("^")) return left
      this.consume()
      return { type: "binary", operator: "^", left, right: this.parseUnary() }
    } finally {
      this.leave()
    }
  }

  private parsePrimary(): ExpressionNode {
    this.enter()
    try {
      const token = this.tokens[this.position]
      if (!token) throw new Error("Expected expression")
      if (token.type === "number") {
        this.position += 1
        return { type: "number", value: Number(token.value) }
      }
      if (token.type === "identifier") {
        this.position += 1
        const normalizedName = token.value.toLowerCase()
        const logarithmBase = normalizedName.match(/^log_(\d+(?:\.\d+)?)$/)
        if (this.tokens[this.position]?.value === "(") {
          if (!functions.has(normalizedName) && !logarithmBase) throw new Error(`Unknown function: ${token.value}`)
          this.position += 1
          const argument = this.parseAddSub()
          if (this.tokens[this.position]?.value !== ")") throw new Error("Expected closing parenthesis")
          this.position += 1
          return { type: "call", name: normalizedName, argument }
        }
        // Support natural textbook calls without parentheses: `sin x`, `cos 2x`, `ln x`, `sqrt x`
        if (functions.has(normalizedName)) {
          const next = this.tokens[this.position]
          if (next && (next.type === "number" || next.type === "identifier" || next.value === "|")) {
            const argument = this.parsePower()
            return { type: "call", name: normalizedName, argument }
          }
        }
        return { type: "variable", name: token.value }
      }
      if (token.value === "(") {
        this.position += 1
        const expression = this.parseAddSub()
        if (this.tokens[this.position]?.value !== ")") throw new Error("Expected closing parenthesis")
        this.position += 1
        return expression
      }
      if (token.value === "|") {
        this.position += 1
        const argument = this.parseAddSub()
        if (this.tokens[this.position]?.value !== "|") throw new Error("Expected closing absolute value")
        this.position += 1
        return { type: "call", name: "abs", argument }
      }
      throw new Error("Expected expression")
    } finally {
      this.leave()
    }
  }

  private isOperator(value: string): boolean {
    return this.tokens[this.position]?.type === "operator" && this.tokens[this.position].value === value
  }

  private consume(): Token {
    return this.tokens[this.position++]
  }
}

export function parseExpression(source: string): ExpressionNode {
  return new ExpressionParser(source).parse()
}

export type CompiledExpression = ExpressionNode

const compiledExpressionCache = new Map<string, CompiledExpression>()

export function compileExpression(source: string): CompiledExpression {
  const normalized = normalizeFunctionExpression(source)
  const cached = compiledExpressionCache.get(normalized)
  if (cached) return cached
  const compiled = parseExpression(normalized)
  compiledExpressionCache.set(normalized, compiled)
  return compiled
}

export function clearExpressionCache(): void {
  compiledExpressionCache.clear()
}

export function evaluateExpression(expression: ExpressionNode, variables: Record<string, number>): number {
  if (expression.type === "number") return expression.value
  if (expression.type === "variable") {
    if (expression.name.toLowerCase() === "pi") return Math.PI
    if (expression.name.toLowerCase() === "e") return Math.E
    const value = variables[expression.name]
    if (value === undefined) throw new Error(`Unknown variable: ${expression.name}`)
    return value
  }
  if (expression.type === "unary") {
    const value = evaluateExpression(expression.argument, variables)
    return expression.operator === "-" ? -value : value
  }
  if (expression.type === "call") {
    const value = evaluateExpression(expression.argument, variables)
    if (expression.name === "abs") return Math.abs(value)
    if (expression.name === "acos" || expression.name === "arccos") return Math.acos(value)
    if (expression.name === "acosh") return Math.acosh(value)
    if (expression.name === "asin" || expression.name === "arcsin") return Math.asin(value)
    if (expression.name === "asinh") return Math.asinh(value)
    if (expression.name === "atan" || expression.name === "arctan") return Math.atan(value)
    if (expression.name === "arccot") return Math.PI / 2 - Math.atan(value)
    if (expression.name === "atanh") return Math.atanh(value)
    if (expression.name === "cbrt") return Math.cbrt(value)
    if (expression.name === "ceil") return Math.ceil(value)
    if (expression.name === "cos") return Math.cos(value)
    if (expression.name === "cosh") return Math.cosh(value)
    if (expression.name === "cot") return 1 / Math.tan(value)
    if (expression.name === "csc") return 1 / Math.sin(value)
    if (expression.name === "exp") return Math.exp(value)
    if (expression.name === "floor") return Math.floor(value)
    if (expression.name === "ln" || expression.name === "log") return Math.log(value)
    if (expression.name.startsWith("log_")) {
      const base = Number(expression.name.slice(4))
      return base > 0 && base !== 1 ? Math.log(value) / Math.log(base) : Number.NaN
    }
    if (expression.name === "log10" || expression.name === "lg") return Math.log10(value)
    if (expression.name === "log2") return Math.log2(value)
    if (expression.name === "sec") return 1 / Math.cos(value)
    if (expression.name === "sgn" || expression.name === "sign") return Math.sign(value)
    if (expression.name === "sin") return Math.sin(value)
    if (expression.name === "sinh") return Math.sinh(value)
    if (expression.name === "sqrt") return Math.sqrt(value)
    if (expression.name === "tan") return Math.tan(value)
    return Math.tanh(value)
  }
  const left = evaluateExpression(expression.left, variables)
  const right = evaluateExpression(expression.right, variables)
  if (expression.operator === "+") return left + right
  if (expression.operator === "-") return left - right
  if (expression.operator === "*") return left * right
  if (expression.operator === "/") return left / right
  return left ** right
}

export function evaluateCompiledExpression(expression: CompiledExpression, variables: Record<string, number>): number {
  return evaluateExpression(expression, variables)
}

export function formatExpressionNode(node: ExpressionNode): string {
  if (node.type === "number") return String(node.value)
  if (node.type === "variable") return node.name
  if (node.type === "unary") {
    const arg = formatExpressionNode(node.argument)
    return node.argument.type === "binary" ? `${node.operator}(${arg})` : `${node.operator}${arg}`
  }
  if (node.type === "call") return `${node.name}(${formatExpressionNode(node.argument)})`
  return `${node.left.type === "binary" ? `(${formatExpressionNode(node.left)})` : formatExpressionNode(node.left)}${node.operator}${node.right.type === "binary" ? `(${formatExpressionNode(node.right)})` : formatExpressionNode(node.right)}`
}

function resolveExpressionNode(sourceOrNode: string | ExpressionNode): ExpressionNode {
  return typeof sourceOrNode === "string" ? parseExpression(sourceOrNode) : sourceOrNode
}

function collectDomains(node: ExpressionNode, out: DomainConstraint[], seen: Set<string>): void {
  const push = (constraint: DomainConstraint): void => {
    const key = `${constraint.kind}:${constraint.expression}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(constraint)
  }
  if (node.type === "unary") {
    collectDomains(node.argument, out, seen)
    return
  }
  if (node.type === "call") {
    collectDomains(node.argument, out, seen)
    if (node.name === "sqrt") push({ kind: "nonnegative", expression: formatExpressionNode(node.argument) })
    if (node.name === "ln" || node.name === "log" || node.name === "log10" || node.name.startsWith("log_")) {
      push({ kind: "positive", expression: formatExpressionNode(node.argument) })
    }
    return
  }
  if (node.type === "binary") {
    collectDomains(node.left, out, seen)
    collectDomains(node.right, out, seen)
    if (node.operator === "/") {
      push({ kind: "nonzero", expression: formatExpressionNode(node.right) })
    } else if (node.operator === "^") {
      if (node.right.type === "unary" && node.right.operator === "-" && node.right.argument.type === "number") {
        push({ kind: "nonzero", expression: formatExpressionNode(node.left) })
      } else if (node.right.type === "number" && node.right.value < 0) {
        push({ kind: "nonzero", expression: formatExpressionNode(node.left) })
      }
    }
  }
}

/** Extracts domain constraints directly from the unsimplified AST (never cancelling `x/x` to `1`). */
export function extractExpressionDomains(sourceOrNode: string | ExpressionNode): DomainConstraint[] {
  const node = resolveExpressionNode(sourceOrNode)
  const out: DomainConstraint[] = []
  collectDomains(node, out, new Set<string>())
  return out
}

function collectExpressionVariables(node: ExpressionNode, out: Set<string>): void {
  if (node.type === "variable") {
    const lower = node.name.toLowerCase()
    if (lower !== "pi" && lower !== "e") out.add(node.name)
    return
  }
  if (node.type === "unary" || node.type === "call") {
    collectExpressionVariables(node.argument, out)
    return
  }
  if (node.type === "binary") {
    collectExpressionVariables(node.left, out)
    collectExpressionVariables(node.right, out)
  }
}

function evaluateNodeChecked(node: ExpressionNode, variables: Record<string, number>): number {
  if (node.type === "number") return node.value
  if (node.type === "variable") {
    if (node.name.toLowerCase() === "pi") return Math.PI
    if (node.name.toLowerCase() === "e") return Math.E
    const value = variables[node.name]
    if (value === undefined) throw new Error(`Unknown variable: ${node.name}`)
    return value
  }
  if (node.type === "unary") {
    const value = evaluateNodeChecked(node.argument, variables)
    return node.operator === "-" ? -value : value
  }
  if (node.type === "call") {
    const arg = evaluateNodeChecked(node.argument, variables)
    if (node.name === "sqrt" && arg < 0) throw new Error("Domain error: negative radicand in sqrt")
    if ((node.name === "ln" || node.name === "log" || node.name === "log10" || node.name.startsWith("log_")) && arg <= 0) {
      throw new Error(`Domain error: non-positive argument in ${node.name}`)
    }
    const val = evaluateExpression(node, variables)
    if (!Number.isFinite(val)) throw new Error(`Domain error: non-finite result in ${node.name}`)
    return val
  }
  const left = evaluateNodeChecked(node.left, variables)
  const right = evaluateNodeChecked(node.right, variables)
  if (node.operator === "/" && Math.abs(right) <= 1e-12) {
    throw new Error("Domain error: division by zero")
  }
  const value = node.operator === "+"
    ? left + right
    : node.operator === "-"
      ? left - right
      : node.operator === "*"
        ? left * right
        : node.operator === "/"
          ? left / right
          : left ** right
  if (!Number.isFinite(value)) throw new Error("Domain error: non-finite evaluation result")
  return value
}

export function evaluateExpressionWithDomain(
  sourceOrNode: string | ExpressionNode,
  variables: Record<string, number>
): ExpressionEvalResult {
  let node: ExpressionNode
  try {
    node = resolveExpressionNode(sourceOrNode)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      domains: []
    }
  }
  const domains = extractExpressionDomains(node)
  try {
    const value = evaluateNodeChecked(node, variables)
    return { ok: true, value, domains }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      domains
    }
  }
}

export function parseRelationConstraint(source: string): ParsedRelationConstraint {
  const trimmed = source.trim()
  if (trimmed.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`Relation length ${trimmed.length} exceeds budget (${MAX_EXPRESSION_LENGTH})`)
  }
  const chunks: string[] = []
  const operators: RelationOperator[] = []
  let depth = 0
  let absOpen = false
  let segmentStart = 0

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!
    if (ch === "(") depth += 1
    else if (ch === ")") depth = Math.max(0, depth - 1)
    else if (ch === "|") absOpen = !absOpen
    if (depth > 0 || absOpen) continue

    const two = trimmed.slice(i, i + 2)
    let matchedOp: RelationOperator | null = null
    let step = 1
    if (two === "<=") { matchedOp = "<="; step = 2 }
    else if (two === ">=") { matchedOp = ">="; step = 2 }
    else if (two === "!=" || two === "<>") { matchedOp = "!="; step = 2 }
    else if (two === "==") { matchedOp = "="; step = 2 }
    else if (ch === "=" || ch === "＝") matchedOp = "="
    else if (ch === "<" || ch === "＜") matchedOp = "<"
    else if (ch === ">" || ch === "＞") matchedOp = ">"
    else if (ch === "≤") matchedOp = "<="
    else if (ch === "≥") matchedOp = ">="
    else if (ch === "≠") matchedOp = "!="

    if (matchedOp !== null) {
      chunks.push(trimmed.slice(segmentStart, i))
      operators.push(matchedOp)
      segmentStart = i + step
      i += step - 1
    }
  }
  chunks.push(trimmed.slice(segmentStart))
  if (operators.length === 0) throw new Error(`Expected relational operator in "${source}"`)
  if (chunks.some((chunk) => chunk.trim().length === 0)) {
    throw new Error(`Incomplete relation operand in "${source}"`)
  }

  const hasLess = operators.some((op) => op === "<" || op === "<=")
  const hasGreater = operators.some((op) => op === ">" || op === ">=")
  if (hasLess && hasGreater) {
    throw new Error(`Non-monotonic or mixed-direction inequality chain in "${source}"`)
  }
  if (operators.includes("!=") && operators.length > 1) {
    throw new Error(`Unsupported chained != operator in "${source}"`)
  }

  const terms = chunks.map((chunk) => parseExpression(chunk))
  const domainSeen = new Set<string>()
  const domains: DomainConstraint[] = []
  const vars = new Set<string>()
  for (const term of terms) {
    collectExpressionVariables(term, vars)
    collectDomains(term, domains, domainSeen)
  }

  return {
    terms,
    operators,
    domains,
    variables: [...vars],
    raw: trimmed
  }
}

export function evaluateRelationConstraint(
  constraint: ParsedRelationConstraint,
  variables: Record<string, number>
): { ok: boolean; error?: string } {
  const values: number[] = []
  for (const term of constraint.terms) {
    const res = evaluateExpressionWithDomain(term, variables)
    if (!res.ok) return { ok: false, error: res.error }
    values.push(res.value)
  }
  const eps = 1e-9
  for (let i = 0; i < constraint.operators.length; i += 1) {
    const left = values[i]!
    const right = values[i + 1]!
    const op = constraint.operators[i]!
    const holds = op === "="
      ? Math.abs(left - right) <= eps
      : op === "!="
        ? Math.abs(left - right) > eps
        : op === "<"
          ? left < right - eps
          : op === "<="
            ? left <= right + eps
            : op === ">"
              ? left > right + eps
              : left >= right - eps
    if (holds) continue
    if (!holds) return { ok: false, error: `Relation ${formatExpressionNode(constraint.terms[i]!)} ${op} ${formatExpressionNode(constraint.terms[i + 1]!)} failed (${left} vs ${right})` }
  }
  return { ok: true }
}

export function evaluateFunctionWithDomain(
  sourceOrNode: string | ExpressionNode,
  x: number,
  extraVariables: Record<string, number> = {}
): ExpressionEvalResult {
  if (!Number.isFinite(x)) {
    return { ok: false, error: "Domain error: non-finite evaluation coordinate", domains: [] }
  }
  return evaluateExpressionWithDomain(sourceOrNode, { ...extraVariables, x })
}

const num = (value: number): ExpressionNode => ({ type: "number", value })
const bin = (operator: "+" | "-" | "*" | "/" | "^", left: ExpressionNode, right: ExpressionNode): ExpressionNode => ({
  type: "binary",
  operator,
  left,
  right
})
const callNode = (name: string, argument: ExpressionNode): ExpressionNode => ({ type: "call", name, argument })

function dependsOnVariable(node: ExpressionNode, variable: string): boolean {
  if (node.type === "number") return false
  if (node.type === "variable") return node.name === variable
  if (node.type === "unary" || node.type === "call") return dependsOnVariable(node.argument, variable)
  return dependsOnVariable(node.left, variable) || dependsOnVariable(node.right, variable)
}

/**
 * Exact symbolic AST derivative with respect to `variable`.
 * Returns `null` for non-differentiable/unsupported operators (e.g. `abs`, `floor`)
 * so callers never silently mask them with finite differences.
 */
export function differentiateExpressionAst(node: ExpressionNode, variable = "x"): ExpressionNode | null {
  if (node.type === "number") return num(0)
  if (node.type === "variable") return num(node.name === variable ? 1 : 0)
  if (node.type === "unary") {
    const inner = differentiateExpressionAst(node.argument, variable)
    if (!inner) return null
    return node.operator === "-" ? { type: "unary", operator: "-", argument: inner } : inner
  }
  if (node.type === "call") {
    const u = node.argument
    const du = differentiateExpressionAst(u, variable)
    if (!du) return null
    switch (node.name) {
      case "sin":
        return bin("*", callNode("cos", u), du)
      case "cos":
        return bin("*", { type: "unary", operator: "-", argument: callNode("sin", u) }, du)
      case "tan":
        return bin("/", du, bin("^", callNode("cos", u), num(2)))
      case "cot":
        return bin("/", { type: "unary", operator: "-", argument: du }, bin("^", callNode("sin", u), num(2)))
      case "sec":
        return bin("*", bin("*", callNode("sec", u), callNode("tan", u)), du)
      case "csc":
        return bin("*", { type: "unary", operator: "-", argument: bin("*", callNode("csc", u), callNode("cot", u)) }, du)
      case "exp":
        return bin("*", callNode("exp", u), du)
      case "ln":
      case "log":
        return bin("/", du, u)
      case "log10":
      case "lg":
        return bin("/", du, bin("*", u, callNode("ln", num(10))))
      case "log2":
        return bin("/", du, bin("*", u, callNode("ln", num(2))))
      case "sqrt":
        return bin("/", du, bin("*", num(2), callNode("sqrt", u)))
      case "cbrt":
        return bin("/", du, bin("*", num(3), bin("^", callNode("cbrt", u), num(2))))
      case "sinh":
        return bin("*", callNode("cosh", u), du)
      case "cosh":
        return bin("*", callNode("sinh", u), du)
      case "tanh":
        return bin("/", du, bin("^", callNode("cosh", u), num(2)))
      case "atan":
      case "arctan":
        return bin("/", du, bin("+", num(1), bin("^", u, num(2))))
      case "arccot":
        return bin("/", { type: "unary", operator: "-", argument: du }, bin("+", num(1), bin("^", u, num(2))))
      case "asin":
      case "arcsin":
        return bin("/", du, callNode("sqrt", bin("-", num(1), bin("^", u, num(2)))))
      case "acos":
      case "arccos":
        return bin("/", { type: "unary", operator: "-", argument: du }, callNode("sqrt", bin("-", num(1), bin("^", u, num(2)))))
      default:
        return null
    }
  }

  const u = node.left
  const v = node.right
  const du = differentiateExpressionAst(u, variable)
  const dv = differentiateExpressionAst(v, variable)
  if (!du || !dv) return null

  switch (node.operator) {
    case "+":
    case "-":
      return bin(node.operator, du, dv)
    case "*":
      return bin("+", bin("*", du, v), bin("*", u, dv))
    case "/":
      return bin("/", bin("-", bin("*", du, v), bin("*", u, dv)), bin("^", v, num(2)))
    case "^": {
      if (!dependsOnVariable(v, variable)) {
        return bin("*", bin("*", v, bin("^", u, bin("-", v, num(1)))), du)
      }
      if (!dependsOnVariable(u, variable)) {
        return bin("*", bin("*", node, callNode("ln", u)), dv)
      }
      // f(x)^g(x) = exp(g*ln(f)) -> node * (g' * ln(f) + g * f'/f)
      return bin("*", node, bin("+", bin("*", dv, callNode("ln", u)), bin("*", v, bin("/", du, u))))
    }
  }
}

export type SymbolicDerivativeResult =
  | {
      ok: true
      value: number
      derivativeAst: ExpressionNode
      domains: DomainConstraint[]
    }
  | {
      ok: false
      code: "parse_error" | "unsupported_derivative" | "domain_violation"
      reason: string
    }

export function evaluateSymbolicDerivative(
  sourceOrNode: string | ExpressionNode,
  x: number,
  extraVariables: Record<string, number> = {}
): SymbolicDerivativeResult {
  if (!Number.isFinite(x)) {
    return { ok: false, code: "domain_violation", reason: "Domain error: non-finite evaluation coordinate" }
  }
  let ast: ExpressionNode
  try {
    ast = resolveExpressionNode(sourceOrNode)
  } catch (error) {
    return { ok: false, code: "parse_error", reason: error instanceof Error ? error.message : String(error) }
  }
  const vars = { ...extraVariables, x }
  const baseEval = evaluateExpressionWithDomain(ast, vars)
  if (!baseEval.ok) {
    return { ok: false, code: "domain_violation", reason: baseEval.error }
  }
  const derivAst = differentiateExpressionAst(ast, "x")
  if (derivAst === null) {
    return {
      ok: false,
      code: "unsupported_derivative",
      reason: `Expression "${typeof sourceOrNode === "string" ? sourceOrNode : formatExpressionNode(ast)}" contains operators without supported symbolic derivative.`
    }
  }
  const derivEval = evaluateExpressionWithDomain(derivAst, vars)
  if (!derivEval.ok) {
    return { ok: false, code: "domain_violation", reason: derivEval.error }
  }
  return {
    ok: true,
    value: derivEval.value,
    derivativeAst: derivAst,
    domains: [...baseEval.domains, ...derivEval.domains]
  }
}

/** Algebraic AST simplifier so symbolic derivatives like `3*x^2 - 3` read cleanly like a textbook. */
export function simplifyExpressionAst(node: ExpressionNode): ExpressionNode {
  if (node.type === "number" || node.type === "variable") return node
  if (node.type === "unary") {
    const arg = simplifyExpressionAst(node.argument)
    if (node.operator === "+") return arg
    if (arg.type === "number") return num(-arg.value)
    if (arg.type === "unary" && arg.operator === "-") return arg.argument
    return { type: "unary", operator: "-", argument: arg }
  }
  if (node.type === "call") {
    const arg = simplifyExpressionAst(node.argument)
    return { type: "call", name: node.name, argument: arg }
  }
  const left = simplifyExpressionAst(node.left)
  const right = simplifyExpressionAst(node.right)
  if (left.type === "number" && right.type === "number") {
    const v = node.operator === "+"
      ? left.value + right.value
      : node.operator === "-"
        ? left.value - right.value
        : node.operator === "*"
          ? left.value * right.value
          : node.operator === "/"
            ? (right.value !== 0 ? left.value / right.value : Number.NaN)
            : left.value ** right.value
    if (Number.isFinite(v) && Math.abs(v - Math.round(v * 1e6) / 1e6) < 1e-10) {
      return num(Math.round(v * 1e6) / 1e6)
    }
  }
  if (node.operator === "+") {
    if (left.type === "number" && left.value === 0) return right
    if (right.type === "number" && right.value === 0) return left
    if (right.type === "unary" && right.operator === "-") return simplifyExpressionAst(bin("-", left, right.argument))
    if (right.type === "number" && right.value < 0) return bin("-", left, num(-right.value))
  }
  if (node.operator === "-") {
    if (right.type === "number" && right.value === 0) return left
    if (left.type === "number" && left.value === 0) return simplifyExpressionAst({ type: "unary", operator: "-", argument: right })
    if (right.type === "unary" && right.operator === "-") return simplifyExpressionAst(bin("+", left, right.argument))
  }
  if (node.operator === "*") {
    if ((left.type === "number" && left.value === 0) || (right.type === "number" && right.value === 0)) return num(0)
    if (left.type === "number" && left.value === 1) return right
    if (right.type === "number" && right.value === 1) return left
    if (left.type === "number" && left.value === -1) return simplifyExpressionAst({ type: "unary", operator: "-", argument: right })
    if (right.type === "number" && right.value === -1) return simplifyExpressionAst({ type: "unary", operator: "-", argument: left })
    if (right.type === "number" && left.type !== "number") return bin("*", right, left)
  }
  if (node.operator === "/") {
    if (left.type === "number" && left.value === 0) return num(0)
    if (right.type === "number" && right.value === 1) return left
  }
  if (node.operator === "^") {
    if (right.type === "number" && right.value === 0) return num(1)
    if (right.type === "number" && right.value === 1) return left
    if (left.type === "number" && left.value === 0) return num(0)
    if (left.type === "number" && left.value === 1) return num(1)
  }
  return bin(node.operator, left, right)
}

const PRETTY_SUPERSCRIPTS: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻"
}

function toPrettySuperscript(text: string): string | null {
  if (!/^-?\d+$/u.test(text)) return null
  return [...text].map((ch) => PRETTY_SUPERSCRIPTS[ch] ?? ch).join("")
}

function precedenceOf(node: ExpressionNode): number {
  if (node.type === "binary") {
    if (node.operator === "+" || node.operator === "-") return 1
    if (node.operator === "*" || node.operator === "/") return 2
    return 3
  }
  if (node.type === "unary") return 2
  return 4
}

/** Formats an ExpressionNode into clean, textbook-like Unicode mathematics (e.g. `3x² − 3`, `√(x² + 1)`). */
export function formatPrettyMath(node: ExpressionNode): string {
  if (node.type === "number") return Number(node.value.toFixed(6)).toString()
  if (node.type === "variable") {
    const low = node.name.toLowerCase()
    if (low === "pi") return "π"
    if (low === "theta") return "θ"
    return node.name
  }
  if (node.type === "unary") {
    const inner = formatPrettyMath(node.argument)
    const wrapped = node.argument.type === "binary" && precedenceOf(node.argument) < 2 ? `(${inner})` : inner
    return node.operator === "-" ? `−${wrapped}` : wrapped
  }
  if (node.type === "call") {
    const inner = formatPrettyMath(node.argument)
    if (node.name === "abs") return `|${inner}|`
    if (node.name === "sqrt") return `√(${inner})`
    if (node.name === "cbrt") return `∛(${inner})`
    if (node.name === "exp") return `e^(${inner})`
    return `${node.name}(${inner})`
  }
  const myPrec = precedenceOf(node)
  const formatChild = (child: ExpressionNode, isRight: boolean): string => {
    const childPrec = precedenceOf(child)
    const text = formatPrettyMath(child)
    const needsParens = childPrec < myPrec || (isRight && childPrec === myPrec && (node.operator === "-" || node.operator === "/"))
    return needsParens ? `(${text})` : text
  }
  if (node.operator === "+") return `${formatChild(node.left, false)} + ${formatChild(node.right, true)}`
  if (node.operator === "-") return `${formatChild(node.left, false)} − ${formatChild(node.right, true)}`
  if (node.operator === "*") {
    const leftText = formatChild(node.left, false)
    const rightText = formatChild(node.right, true)
    if (node.left.type === "number" && (node.right.type === "variable" || node.right.type === "call" || node.right.type === "binary" && node.right.operator === "^")) {
      return `${leftText}${rightText}`
    }
    return `${leftText} · ${rightText}`
  }
  if (node.operator === "/") return `${formatChild(node.left, false)} / ${formatChild(node.right, true)}`
  const baseText = formatChild(node.left, false)
  if (node.right.type === "number") {
    const sup = toPrettySuperscript(String(node.right.value))
    if (sup) return `${baseText}${sup}`
  }
  if (node.right.type === "unary" && node.right.operator === "-" && node.right.argument.type === "number") {
    const sup = toPrettySuperscript(`-${node.right.argument.value}`)
    if (sup) return `${baseText}${sup}`
  }
  return `${baseText}^${formatChild(node.right, true)}`
}

/** Translates low-level AST parser errors into concise Chinese UX hints. */
export function formatFriendlyMathError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error)
  if (msg === "Expected expression") return "表达式不完整：运算符后缺少数字或变量（例如 `x^3 - 3x`）"
  if (msg === "Expected closing parenthesis") return "括号未闭合：请补全右括号 `)`"
  if (msg === "Expected closing absolute value") return "绝对值符号未闭合：请补全右侧 `|`"
  const unexpectedChar = msg.match(/^Unexpected character:\s*(.+)$/u)
  if (unexpectedChar) return `存在无法识别的字符「${unexpectedChar[1]}」，请检查符号或改用快捷键盘输入`
  const unexpectedToken = msg.match(/^Unexpected token:\s*(.+)$/u)
  if (unexpectedToken) return `语法不完整：在「${unexpectedToken[1]}」处缺少运算符或括号`
  const unknownFn = msg.match(/^Unknown function:\s*(.+)$/u)
  if (unknownFn) return `暂不支持函数「${unknownFn[1]}」，支持 sin/cos/tan/arcsin/arctan/ln/lg/exp/sqrt/cbrt/abs`
  const unknownVar = msg.match(/^Unknown variable:\s*(.+)$/u)
  if (unknownVar) return `未识别的变量「${unknownVar[1]}」`
  return msg
}
