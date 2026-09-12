export type BinaryOperator = "+" | "-" | "*" | "/"

export type ExpressionNode =
  | { type: "number"; value: number }
  | { type: "variable"; name: string }
  | { type: "binary"; operator: BinaryOperator; left: ExpressionNode; right: ExpressionNode }

type Token = { type: "number" | "identifier" | "operator" | "parenthesis"; value: string }

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
    if ("+-*/".includes(character)) {
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
    this.tokens = tokenize(source)
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
    let expression = this.parsePrimary()
    while (this.isOperator("*") || this.isOperator("/")) {
      const operator = this.consume().value as BinaryOperator
      expression = { type: "binary", operator, left: expression, right: this.parsePrimary() }
    }
    return expression
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

export function evaluateExpression(expression: ExpressionNode, variables: Record<string, number>): number {
  if (expression.type === "number") return expression.value
  if (expression.type === "variable") {
    const value = variables[expression.name]
    if (value === undefined) throw new Error(`Unknown variable: ${expression.name}`)
    return value
  }
  const left = evaluateExpression(expression.left, variables)
  const right = evaluateExpression(expression.right, variables)
  if (expression.operator === "+") return left + right
  if (expression.operator === "-") return left - right
  if (expression.operator === "*") return left * right
  return left / right
}
