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
  "abs", "acos", "acosh", "asin", "asinh", "atan", "atanh", "ceil", "cos", "cosh", "exp", "floor", "ln", "log", "log10", "sin", "sinh", "sqrt", "tan", "tanh"
])

export function normalizeFunctionExpression(source: string): string {
  const normalized = source
    .trim()
    .replace(/^y\s*=\s*/i, "")
    .replace(/[−–—]/g, "-")
    .replace(/[×·⋅]/g, "*")
    .replace(/π/g, "pi")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (digits) => `^${[...digits].map((ch) => SUPER_DIGITS[ch] ?? ch).join("")}`)
    .replace(/√\s*\(/g, "sqrt(")
    .replace(/√\s*(\d+(?:\.\d+)?|[A-Za-z_]\w*)/g, "sqrt($1)")
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
      const prevEndsFactor = prev.type === "number" || prev.value === ")"
      const nextStartsFactor = token.type === "identifier" || token.value === "(" || token.type === "number"
      if (prevEndsFactor && nextStartsFactor && !(prev.type === "number" && token.type === "number")) {
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
    if (expression.name === "acos") return Math.acos(value)
    if (expression.name === "acosh") return Math.acosh(value)
    if (expression.name === "asin") return Math.asin(value)
    if (expression.name === "asinh") return Math.asinh(value)
    if (expression.name === "atan") return Math.atan(value)
    if (expression.name === "atanh") return Math.atanh(value)
    if (expression.name === "ceil") return Math.ceil(value)
    if (expression.name === "cos") return Math.cos(value)
    if (expression.name === "cosh") return Math.cosh(value)
    if (expression.name === "exp") return Math.exp(value)
    if (expression.name === "floor") return Math.floor(value)
    if (expression.name === "ln" || expression.name === "log") return Math.log(value)
    if (expression.name.startsWith("log_")) {
      const base = Number(expression.name.slice(4))
      return base > 0 && base !== 1 ? Math.log(value) / Math.log(base) : Number.NaN
    }
    if (expression.name === "log10") return Math.log10(value)
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
    if (!holds) return { ok: false, error: `Relation ${formatExpressionNode(constraint.terms[i]!)} ${op} ${formatExpressionNode(constraint.terms[i + 1]!)} failed (${left} vs ${right})` }
  }
  return { ok: true }
}
