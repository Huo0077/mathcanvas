export type BinaryOperator = "+" | "-" | "*" | "/" | "^"

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
  const normalized = source.trim().replace(/^y\s*=\s*/i, "")
  if (!normalized) throw new Error("Expected expression")
  return normalized
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
    if ("()".includes(character)) {
      tokens.push({ type: "parenthesis", value: character })
      index += 1
      continue
    }
    throw new Error(`Unexpected character: ${character}`)
  }
  return tokens
}

class ExpressionParser {
  private readonly tokens: Token[]
  private position = 0

  constructor(source: string) {
    this.tokens = tokenize(normalizeFunctionExpression(source))
  }

  parse(): ExpressionNode {
    const expression = this.parseAddSub()
    if (this.position < this.tokens.length) throw new Error(`Unexpected token: ${this.tokens[this.position].value}`)
    return expression
  }

  private parseAddSub(): ExpressionNode {
    let expression = this.parseMulDiv()
    while (this.isOperator("+") || this.isOperator("-")) {
      const operator = this.consume().value as BinaryOperator
      expression = { type: "binary", operator, left: expression, right: this.parseMulDiv() }
    }
    return expression
  }

  private parseMulDiv(): ExpressionNode {
    let expression = this.parseUnary()
    while (this.isOperator("*") || this.isOperator("/")) {
      const operator = this.consume().value as BinaryOperator
      expression = { type: "binary", operator, left: expression, right: this.parseUnary() }
    }
    return expression
  }

  private parseUnary(): ExpressionNode {
    if (this.isOperator("+") || this.isOperator("-")) {
      const operator = this.consume().value as "+" | "-"
      return { type: "unary", operator, argument: this.parseUnary() }
    }
    return this.parsePower()
  }

  private parsePower(): ExpressionNode {
    const left = this.parsePrimary()
    if (!this.isOperator("^")) return left
    this.consume()
    return { type: "binary", operator: "^", left, right: this.parseUnary() }
  }

  private parsePrimary(): ExpressionNode {
    const token = this.tokens[this.position]
    if (!token) throw new Error("Expected expression")
    if (token.type === "number") {
      this.position += 1
      return { type: "number", value: Number(token.value) }
    }
    if (token.type === "identifier") {
      this.position += 1
      if (this.tokens[this.position]?.value === "(") {
        if (!functions.has(token.value.toLowerCase())) throw new Error(`Unknown function: ${token.value}`)
        this.position += 1
        const argument = this.parseAddSub()
        if (this.tokens[this.position]?.value !== ")") throw new Error("Expected closing parenthesis")
        this.position += 1
        return { type: "call", name: token.value.toLowerCase(), argument }
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
    throw new Error("Expected expression")
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

export function compileExpression(source: string): CompiledExpression {
  return parseExpression(source)
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
