/**
 * **函数定义域与分段采样反例（W6-B，2026-11-09）**。
 *
 * 只做**否定**与**采样**，不做证明：
 * - 找到一处 `|f−g| > tol` → `refuted`（带反例点）；
 * - 一处定义域不一致（一侧有限、一侧非有限）→ `refuted`（`domain_mismatch`）；
 * - 全部采样通过 → `sampled` —— **不是** `verified_instance`；
 * - 解析不了、范围为空、没有可比采样 → `unknown`。
 *
 * 表达式解析是手写递归下降，**绝不 eval**：只认数字、`x`、`π`、四则、整数幂、
 * 一元负号、绝对值竖线，以及 `sin/cos/tan/sqrt/abs`。
 */

export type FunctionUnits = "radians" | "degrees"

type Node =
  | { kind: "number"; value: number }
  | { kind: "x" }
  | { kind: "neg"; value: Node }
  | { kind: "add" | "sub" | "mul" | "div" | "pow"; left: Node; right: Node }
  | { kind: "abs"; value: Node }
  | { kind: "call"; name: "sin" | "cos" | "tan" | "sqrt" | "abs"; arg: Node }

interface Token {
  kind: "number" | "name" | "op" | "lparen" | "rparen" | "bar"
  text: string
}

const NAMES = new Set(["x", "pi", "π", "sin", "cos", "tan", "sqrt", "abs"])

function tokenize(input: string): Token[] | null {
  const text = input.replace(/\\left|\\right|\\cdot|\\times/g, (match) => (match === "\\cdot" || match === "\\times" ? "*" : "")).replace(/[{}]/g, "").replace(/\s+/g, "")
  const tokens: Token[] = []
  for (let index = 0; index < text.length;) {
    const rest = text.slice(index)
    const number = /^\d+(?:\.\d+)?/.exec(rest)
    if (number !== null) { tokens.push({ kind: "number", text: number[0] }); index += number[0].length; continue }
    const name = /^(sin|cos|tan|sqrt|abs|x|pi|π)/.exec(rest)
    if (name !== null) { tokens.push({ kind: "name", text: name[1] === "π" ? "pi" : name[1] }); index += name[0].length; continue }
    const character = text[index]!
    if ("+-*/^".includes(character)) { tokens.push({ kind: "op", text: character }); index += 1; continue }
    if (character === "(") { tokens.push({ kind: "lparen", text: character }); index += 1; continue }
    if (character === ")") { tokens.push({ kind: "rparen", text: character }); index += 1; continue }
    if (character === "|") { tokens.push({ kind: "bar", text: character }); index += 1; continue }
    return null
  }
  return tokens
}

class Parser {
  private index = 0
  /** 当前处在几层 `|…|` 里面：闭合竖线不能再被当成隐式乘法的新原子。 */
  private bars = 0
  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token | undefined { return this.tokens[this.index] }
  private eat(text: string): boolean {
    const token = this.peek()
    if (token === undefined || token.text !== text) return false
    this.index += 1
    return true
  }
  private startsAtom(token: Token | undefined): boolean {
    if (token === undefined) return false
    if (token.kind === "bar") return this.bars === 0
    return token.kind === "number" || token.kind === "name" || token.kind === "lparen"
  }

  parse(): Node | null {
    const node = this.expression()
    return node !== null && this.index === this.tokens.length ? node : null
  }

  private expression(): Node | null {
    let left = this.term()
    if (left === null) return null
    for (;;) {
      if (this.eat("+")) { const right = this.term(); if (right === null) return null; left = { kind: "add", left, right }; continue }
      if (this.eat("-")) { const right = this.term(); if (right === null) return null; left = { kind: "sub", left, right }; continue }
      return left
    }
  }

  private term(): Node | null {
    let left = this.factor()
    if (left === null) return null
    for (;;) {
      if (this.eat("*")) { const right = this.factor(); if (right === null) return null; left = { kind: "mul", left, right }; continue }
      if (this.eat("/")) { const right = this.factor(); if (right === null) return null; left = { kind: "div", left, right }; continue }
      // 隐式乘法：`2x`、`sin(x)cos(x)`、`2(x+1)`、`2|x|`。
      if (this.startsAtom(this.peek())) {
        const right = this.factor()
        if (right === null) return null
        left = { kind: "mul", left, right }
        continue
      }
      return left
    }
  }

  private factor(): Node | null {
    if (this.eat("-")) { const value = this.factor(); return value === null ? null : { kind: "neg", value } }
    const base = this.atom()
    if (base === null) return null
    if (!this.eat("^")) return base
    const exponent = /^-?\d+$/.test(this.peek()?.text ?? "") ? Number(this.peek()!.text) : Number.NaN
    if (!Number.isInteger(exponent)) return null
    this.index += 1
    return { kind: "pow", left: base, right: { kind: "number", value: exponent } }
  }

  private atom(): Node | null {
    const token = this.peek()
    if (token === undefined) return null
    if (token.kind === "number") { this.index += 1; return { kind: "number", value: Number(token.text) } }
    if (token.kind === "bar") {
      if (this.bars > 0) return null
      this.index += 1
      this.bars += 1
      const value = this.expression()
      if (value === null || !this.eat("|")) return null
      this.bars -= 1
      return { kind: "abs", value }
    }
    if (token.kind === "lparen") {
      this.index += 1
      const value = this.expression()
      if (value === null || !this.eat(")")) return null
      return value
    }
    if (token.kind === "name") {
      this.index += 1
      if (token.text === "x") return { kind: "x" }
      if (token.text === "pi") return { kind: "number", value: Math.PI }
      if (!NAMES.has(token.text)) return null
      // `sin(x)` 或 `sin x` 两种写法都接受。
      const arg = this.eat("(") ? this.parenthesised() : this.factor()
      if (arg === null) return null
      return { kind: "call", name: token.text as "sin" | "cos" | "tan" | "sqrt" | "abs", arg }
    }
    return null
  }

  private parenthesised(): Node | null {
    const value = this.expression()
    if (value === null || !this.eat(")")) return null
    return value
  }
}

export function parseFunction(text: string): Node | null {
  if (text.length === 0 || text.length > 400) return null
  const tokens = tokenize(text)
  return tokens === null ? null : new Parser(tokens).parse()
}

/** 定义域外返回 `NaN`（不是抛异常）：采样点是否可比由调用方决定。 */
export function evaluateFunction(node: Node, x: number, units: FunctionUnits = "radians"): number {
  const trig = (value: number): number => (units === "degrees" ? (value * Math.PI) / 180 : value)
  switch (node.kind) {
    case "number": return node.value
    case "x": return x
    case "neg": return -evaluateFunction(node.value, x, units)
    case "add": return evaluateFunction(node.left, x, units) + evaluateFunction(node.right, x, units)
    case "sub": return evaluateFunction(node.left, x, units) - evaluateFunction(node.right, x, units)
    case "mul": return evaluateFunction(node.left, x, units) * evaluateFunction(node.right, x, units)
    case "div": {
      const denominator = evaluateFunction(node.right, x, units)
      return denominator === 0 ? Number.NaN : evaluateFunction(node.left, x, units) / denominator
    }
    case "pow": return Math.pow(evaluateFunction(node.left, x, units), evaluateFunction(node.right, x, units))
    case "abs": return Math.abs(evaluateFunction(node.value, x, units))
    case "call": {
      const arg = evaluateFunction(node.arg, x, units)
      if (node.name === "sin") return Math.sin(trig(arg))
      if (node.name === "cos") return Math.cos(trig(arg))
      if (node.name === "tan") return Math.tan(trig(arg))
      if (node.name === "sqrt") return arg < 0 ? Number.NaN : Math.sqrt(arg)
      return Math.abs(arg)
    }
  }
}

export interface FunctionClaimInput {
  reference: string
  candidate: string
  domain: readonly [number, number]
  units?: FunctionUnits
  /** 显式采样点（测试与定点复核用）；缺省按定义域内部均匀取 21 点。 */
  samples?: readonly number[]
}

export interface FunctionClaimResult {
  decision: "refuted" | "sampled" | "unknown"
  reasonCodes: string[]
  samplesChecked: number
  counterexample?: { x: number; reference: number; candidate: number }
}

const RELATIVE = 1e-9

export function checkFunctionClaim(input: FunctionClaimInput): FunctionClaimResult {
  const [lower, upper] = input.domain
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower >= upper) {
    return { decision: "unknown", reasonCodes: ["outside_supported_domain"], samplesChecked: 0 }
  }
  const reference = parseFunction(input.reference)
  const candidate = parseFunction(input.candidate)
  if (reference === null || candidate === null) return { decision: "unknown", reasonCodes: ["unparsable_expression"], samplesChecked: 0 }

  const units = input.units ?? "radians"
  const samples = input.samples ?? Array.from({ length: 21 }, (_, index) => lower + ((upper - lower) * (index + 0.5)) / 21)
  let checked = 0
  for (const x of samples) {
    if (!Number.isFinite(x) || x < lower || x > upper) continue
    const left = evaluateFunction(reference, x, units)
    const right = evaluateFunction(candidate, x, units)
    const leftFinite = Number.isFinite(left)
    const rightFinite = Number.isFinite(right)
    if (!leftFinite && !rightFinite) continue
    if (leftFinite !== rightFinite) {
      return { decision: "refuted", reasonCodes: ["domain_mismatch"], samplesChecked: checked, counterexample: { x, reference: left, candidate: right } }
    }
    checked += 1
    const tolerance = RELATIVE * Math.max(1, Math.abs(left), Math.abs(right))
    if (Math.abs(left - right) > tolerance) {
      return { decision: "refuted", reasonCodes: ["counterexample_found"], samplesChecked: checked, counterexample: { x, reference: left, candidate: right } }
    }
  }
  if (checked === 0) return { decision: "unknown", reasonCodes: ["no_comparable_sample"], samplesChecked: 0 }
  // 采样通过只是 sampled：**不能**说成"已验证"或"形式证明"。
  return { decision: "sampled", reasonCodes: ["sampled_only"], samplesChecked: checked }
}
