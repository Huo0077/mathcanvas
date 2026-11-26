import {
  differentiateExpressionAst,
  normalizeFunctionExpression,
  parseExpression,
  type ExpressionNode
} from "../expression"

const OP_CONST = 1
const OP_VAR = 2
const OP_NEG = 3
const OP_ADD = 4
const OP_SUB = 5
const OP_MUL = 6
const OP_DIV = 7
const OP_POW = 8
const OP_ABS = 9
const OP_ACOS = 10
const OP_ACOSH = 11
const OP_ASIN = 12
const OP_ASINH = 13
const OP_ATAN = 14
const OP_ATANH = 15
const OP_CEIL = 16
const OP_COS = 17
const OP_COSH = 18
const OP_EXP = 19
const OP_FLOOR = 20
const OP_LN = 21
const OP_LOG10 = 22
const OP_LOG_BASE = 23
const OP_SIN = 24
const OP_SINH = 25
const OP_SQRT = 26
const OP_TAN = 27
const OP_TANH = 28
const OP_CBRT = 29
const OP_COT = 30
const OP_SEC = 31
const OP_CSC = 32
const OP_ARCCOT = 33
const OP_LOG2 = 34
const OP_SIGN = 35

const CALL_OPCODES: Record<string, number> = {
  abs: OP_ABS,
  acos: OP_ACOS,
  arccos: OP_ACOS,
  acosh: OP_ACOSH,
  arccot: OP_ARCCOT,
  asin: OP_ASIN,
  arcsin: OP_ASIN,
  asinh: OP_ASINH,
  atan: OP_ATAN,
  arctan: OP_ATAN,
  atanh: OP_ATANH,
  cbrt: OP_CBRT,
  ceil: OP_CEIL,
  cos: OP_COS,
  cosh: OP_COSH,
  cot: OP_COT,
  csc: OP_CSC,
  exp: OP_EXP,
  floor: OP_FLOOR,
  lg: OP_LOG10,
  ln: OP_LN,
  log: OP_LN,
  log10: OP_LOG10,
  log2: OP_LOG2,
  sec: OP_SEC,
  sgn: OP_SIGN,
  sign: OP_SIGN,
  sin: OP_SIN,
  sinh: OP_SINH,
  sqrt: OP_SQRT,
  tan: OP_TAN,
  tanh: OP_TANH
}

export type HigherMathExpressionMode = "expression" | "implicit"

/**
 * Normalizes university-style math input before passing to the whitelisted AST parser:
 * - Strips optional function headers like `f(x) =`, `f(x, y) =`, `g(x,y) =`, `y =`, `z =`.
 * - In `"implicit"` mode, rewrites `LHS = RHS` (e.g. `x^2 + y^2 = 4`) into `(LHS) - (RHS)`.
 */
export function normalizeHigherMathInput(
  rawSource: string,
  mode: HigherMathExpressionMode = "expression"
): string {
  let trimmed = rawSource.trim()
  if (!trimmed) throw new Error("请输入数学表达式")

  // Strip optional function assignment header (e.g., `f(x) =`, `f(x, y) =`, `z =`, `y =`)
  trimmed = trimmed.replace(/^[A-Za-z]\s*\(\s*[A-Za-z](?:\s*,\s*[A-Za-z])*\s*\)\s*[=＝]\s*/u, "")
  if (mode === "expression") {
    trimmed = trimmed.replace(/^[yz]\s*[=＝]\s*/iu, "")
  }

  if (mode === "implicit") {
    const eqIndex = findTopLevelEquals(trimmed)
    if (eqIndex !== -1) {
      const lhs = trimmed.slice(0, eqIndex).trim()
      const rhs = trimmed.slice(eqIndex + 1).trim()
      if (!lhs || !rhs) {
        throw new Error("隐式方程等号两侧均不能为空")
      }
      trimmed = `(${lhs}) - (${rhs})`
    }
  }

  trimmed = trimmed
    .replace(/θ/gu, "theta")
    .replace(/(?<![A-Za-z_])([xX])([yY])(?![A-Za-z_])/gu, "$1*$2")
    .replace(/(?<![A-Za-z_])([yY])([xX])(?![A-Za-z_])/gu, "$1*$2")
    .replace(/(?<![A-Za-z_])([xyrtXYRT])\s*\(/gu, "$1*(")
    .replace(/(?<![A-Za-z_])([xyXY])\s+([xyXY])(?![A-Za-z_])/gu, "$1*$2")

  return normalizeFunctionExpression(trimmed)
}

function findTopLevelEquals(source: string): number {
  let depth = 0
  let absOpen = false
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === "(") depth += 1
    else if (ch === ")") depth = Math.max(0, depth - 1)
    else if (ch === "|") absOpen = !absOpen
    else if (depth === 0 && !absOpen && (ch === "=" || ch === "＝")) {
      return i
    }
  }
  return -1
}

export interface CompiledRpnProgram {
  readonly opcodes: Uint8Array
  readonly argIndices: Int32Array
  readonly constants: Float64Array
  readonly variableNames: readonly string[]
  readonly maxStackDepth: number
  evalAt(values: readonly number[]): number
  eval1D(x: number): number
  eval2D(x: number, y: number): number
  evalGrid2D(
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
    nx: number,
    ny: number
  ): Float64Array
}

/**
 * Compiles a validated ExpressionNode AST into a flat RPN bytecode stream.
 * Never uses `eval` or `new Function`, staying 100% CSP-safe for Tauri & WebView.
 */
export function compileAstToRpn(
  ast: ExpressionNode,
  variableNames: readonly string[]
): CompiledRpnProgram {
  const varIndexMap = new Map<string, number>()
  variableNames.forEach((name, idx) => {
    varIndexMap.set(name, idx)
  })

  const opList: number[] = []
  const argList: number[] = []
  const constList: number[] = []

  const emit = (op: number, arg = 0): void => {
    opList.push(op)
    argList.push(arg)
  }

  const pushConst = (value: number): void => {
    const idx = constList.length
    constList.push(value)
    emit(OP_CONST, idx)
  }

  const compileNode = (node: ExpressionNode): void => {
    if (node.type === "number") {
      pushConst(node.value)
      return
    }
    if (node.type === "variable") {
      const lower = node.name.toLowerCase()
      if (lower === "pi") {
        pushConst(Math.PI)
        return
      }
      if (lower === "e") {
        pushConst(Math.E)
        return
      }
      const slot = varIndexMap.get(node.name) ?? varIndexMap.get(lower)
      if (slot === undefined) {
        throw new Error(`未识别的变量 "${node.name}"（当前允许变量：${variableNames.join(", ")}）`)
      }
      emit(OP_VAR, slot)
      return
    }
    if (node.type === "unary") {
      compileNode(node.argument)
      if (node.operator === "-") emit(OP_NEG)
      return
    }
    if (node.type === "call") {
      compileNode(node.argument)
      if (node.name.startsWith("log_")) {
        const base = Number(node.name.slice(4))
        const denom = base > 0 && base !== 1 ? Math.log(base) : Number.NaN
        const idx = constList.length
        constList.push(denom)
        emit(OP_LOG_BASE, idx)
        return
      }
      const op = CALL_OPCODES[node.name]
      if (op === undefined) {
        throw new Error(`不支持的函数：${node.name}`)
      }
      emit(op)
      return
    }
    compileNode(node.left)
    compileNode(node.right)
    switch (node.operator) {
      case "+": emit(OP_ADD); break
      case "-": emit(OP_SUB); break
      case "*": emit(OP_MUL); break
      case "/": emit(OP_DIV); break
      case "^": emit(OP_POW); break
    }
  }

  compileNode(ast)

  // Compute exact maximum stack depth to pre-allocate a reusable Float64Array.
  let depth = 0
  let maxDepth = 1
  for (const op of opList) {
    if (op === OP_CONST || op === OP_VAR) {
      depth += 1
      if (depth > maxDepth) maxDepth = depth
    } else if (op >= OP_ADD && op <= OP_POW) {
      depth -= 1
    }
  }

  const opcodes = new Uint8Array(opList)
  const argIndices = new Int32Array(argList)
  const constants = new Float64Array(constList)
  const stack = new Float64Array(Math.max(4, maxDepth + 2))
  const len = opcodes.length

  const runLoop = (v0: number, v1: number, values: readonly number[] | null): number => {
    let sp = 0
    for (let i = 0; i < len; i += 1) {
      const op = opcodes[i]!
      switch (op) {
        case OP_CONST:
          stack[sp++] = constants[argIndices[i]!]!
          break
        case OP_VAR: {
          const slot = argIndices[i]!
          if (values !== null) {
            stack[sp++] = values[slot] ?? Number.NaN
          } else {
            stack[sp++] = slot === 0 ? v0 : slot === 1 ? v1 : Number.NaN
          }
          break
        }
        case OP_NEG:
          stack[sp - 1] = -stack[sp - 1]!
          break
        case OP_ADD:
          sp -= 1
          stack[sp - 1] = stack[sp - 1]! + stack[sp]!
          break
        case OP_SUB:
          sp -= 1
          stack[sp - 1] = stack[sp - 1]! - stack[sp]!
          break
        case OP_MUL:
          sp -= 1
          stack[sp - 1] = stack[sp - 1]! * stack[sp]!
          break
        case OP_DIV: {
          sp -= 1
          const denom = stack[sp]!
          stack[sp - 1] = denom === 0 ? Number.NaN : stack[sp - 1]! / denom
          break
        }
        case OP_POW:
          sp -= 1
          stack[sp - 1] = stack[sp - 1]! ** stack[sp]!
          break
        case OP_ABS:
          stack[sp - 1] = Math.abs(stack[sp - 1]!)
          break
        case OP_ACOS:
          stack[sp - 1] = Math.acos(stack[sp - 1]!)
          break
        case OP_ACOSH:
          stack[sp - 1] = Math.acosh(stack[sp - 1]!)
          break
        case OP_ASIN:
          stack[sp - 1] = Math.asin(stack[sp - 1]!)
          break
        case OP_ASINH:
          stack[sp - 1] = Math.asinh(stack[sp - 1]!)
          break
        case OP_ATAN:
          stack[sp - 1] = Math.atan(stack[sp - 1]!)
          break
        case OP_ATANH:
          stack[sp - 1] = Math.atanh(stack[sp - 1]!)
          break
        case OP_CEIL:
          stack[sp - 1] = Math.ceil(stack[sp - 1]!)
          break
        case OP_COS:
          stack[sp - 1] = Math.cos(stack[sp - 1]!)
          break
        case OP_COSH:
          stack[sp - 1] = Math.cosh(stack[sp - 1]!)
          break
        case OP_EXP:
          stack[sp - 1] = Math.exp(stack[sp - 1]!)
          break
        case OP_FLOOR:
          stack[sp - 1] = Math.floor(stack[sp - 1]!)
          break
        case OP_LN: {
          const a = stack[sp - 1]!
          stack[sp - 1] = a > 0 ? Math.log(a) : Number.NaN
          break
        }
        case OP_LOG10: {
          const a = stack[sp - 1]!
          stack[sp - 1] = a > 0 ? Math.log10(a) : Number.NaN
          break
        }
        case OP_LOG_BASE: {
          const a = stack[sp - 1]!
          const denom = constants[argIndices[i]!]!
          stack[sp - 1] = a > 0 ? Math.log(a) / denom : Number.NaN
          break
        }
        case OP_SIN:
          stack[sp - 1] = Math.sin(stack[sp - 1]!)
          break
        case OP_SINH:
          stack[sp - 1] = Math.sinh(stack[sp - 1]!)
          break
        case OP_SQRT: {
          const a = stack[sp - 1]!
          stack[sp - 1] = a >= 0 ? Math.sqrt(a) : Number.NaN
          break
        }
        case OP_TAN:
          stack[sp - 1] = Math.tan(stack[sp - 1]!)
          break
        case OP_TANH:
          stack[sp - 1] = Math.tanh(stack[sp - 1]!)
          break
        case OP_CBRT:
          stack[sp - 1] = Math.cbrt(stack[sp - 1]!)
          break
        case OP_COT: {
          const t = Math.tan(stack[sp - 1]!)
          stack[sp - 1] = Math.abs(t) < 1e-12 ? Number.NaN : 1 / t
          break
        }
        case OP_SEC: {
          const c = Math.cos(stack[sp - 1]!)
          stack[sp - 1] = Math.abs(c) < 1e-12 ? Number.NaN : 1 / c
          break
        }
        case OP_CSC: {
          const s = Math.sin(stack[sp - 1]!)
          stack[sp - 1] = Math.abs(s) < 1e-12 ? Number.NaN : 1 / s
          break
        }
        case OP_ARCCOT:
          stack[sp - 1] = Math.PI / 2 - Math.atan(stack[sp - 1]!)
          break
        case OP_LOG2: {
          const a = stack[sp - 1]!
          stack[sp - 1] = a > 0 ? Math.log2(a) : Number.NaN
          break
        }
        case OP_SIGN:
          stack[sp - 1] = Math.sign(stack[sp - 1]!)
          break
      }
    }
    const result = stack[0]!
    return Number.isFinite(result) ? result : Number.NaN
  }

  return {
    opcodes,
    argIndices,
    constants,
    variableNames,
    maxStackDepth: maxDepth,
    evalAt(values: readonly number[]): number {
      return runLoop(0, 0, values)
    },
    eval1D(x: number): number {
      return runLoop(x, 0, null)
    },
    eval2D(x: number, y: number): number {
      return runLoop(x, y, null)
    },
    evalGrid2D(
      xMin: number,
      xMax: number,
      yMin: number,
      yMax: number,
      nx: number,
      ny: number
    ): Float64Array {
      const cols = nx + 1
      const rows = ny + 1
      const grid = new Float64Array(cols * rows)
      const dx = (xMax - xMin) / nx
      const dy = (yMax - yMin) / ny
      let offset = 0
      for (let j = 0; j < rows; j += 1) {
        const y = yMin + j * dy
        for (let i = 0; i < cols; i += 1) {
          const x = xMin + i * dx
          grid[offset++] = runLoop(x, y, null)
        }
      }
      return grid
    }
  }
}

export interface CompiledScalarField1D {
  readonly source: string
  readonly normalizedSource: string
  readonly ast: ExpressionNode
  readonly program: CompiledRpnProgram
  readonly hasSymbolicDerivative: boolean
  eval(x: number): number
  derivative(x: number): number
  secondDerivative(x: number): number
  leftDerivative(x: number, h?: number): number
  rightDerivative(x: number, h?: number): number
}

export interface CompiledScalarField2D {
  readonly source: string
  readonly normalizedSource: string
  readonly ast: ExpressionNode
  readonly program: CompiledRpnProgram
  readonly hasSymbolicGradient: boolean
  eval(x: number, y: number): number
  evalGrid(xMin: number, xMax: number, yMin: number, yMax: number, nx: number, ny: number): Float64Array
  gradient(x: number, y: number): [number, number]
  hessian(x: number, y: number): { fxx: number; fxy: number; fyy: number }
}

const DERIV_H = 1e-5
const SECOND_DERIV_H = 1e-4

export function compileScalarField1D(source: string): CompiledScalarField1D {
  const normalizedSource = normalizeHigherMathInput(source, "expression")
  const ast = parseExpression(normalizedSource)
  const program = compileAstToRpn(ast, ["x"])

  const d1Ast = differentiateExpressionAst(ast, "x")
  const d1Prog = d1Ast ? compileAstToRpn(d1Ast, ["x"]) : null
  const d2Ast = d1Ast ? differentiateExpressionAst(d1Ast, "x") : null
  const d2Prog = d2Ast ? compileAstToRpn(d2Ast, ["x"]) : null

  const evalFn = (x: number): number => program.eval1D(x)

  const derivative = (x: number): number => {
    if (d1Prog) {
      const sym = d1Prog.eval1D(x)
      if (Number.isFinite(sym)) return sym
    }
    const h = DERIV_H * Math.max(1, Math.abs(x))
    const fp = evalFn(x + h)
    const fm = evalFn(x - h)
    if (Number.isFinite(fp) && Number.isFinite(fm)) {
      return (fp - fm) / (2 * h)
    }
    return Number.NaN
  }

  const secondDerivative = (x: number): number => {
    if (d2Prog) {
      const sym = d2Prog.eval1D(x)
      if (Number.isFinite(sym)) return sym
    }
    const h = SECOND_DERIV_H * Math.max(1, Math.abs(x))
    const fp = evalFn(x + h)
    const f0 = evalFn(x)
    const fm = evalFn(x - h)
    if (Number.isFinite(fp) && Number.isFinite(f0) && Number.isFinite(fm)) {
      return (fp - 2 * f0 + fm) / (h * h)
    }
    return Number.NaN
  }

  const leftDerivative = (x: number, hScale = 1e-5): number => {
    const h = hScale * Math.max(1, Math.abs(x))
    const f0 = evalFn(x)
    const f1 = evalFn(x - h)
    const f2 = evalFn(x - 2 * h)
    if (Number.isFinite(f0) && Number.isFinite(f1) && Number.isFinite(f2)) {
      return (3 * f0 - 4 * f1 + f2) / (2 * h)
    }
    if (Number.isFinite(f0) && Number.isFinite(f1)) {
      return (f0 - f1) / h
    }
    return Number.NaN
  }

  const rightDerivative = (x: number, hScale = 1e-5): number => {
    const h = hScale * Math.max(1, Math.abs(x))
    const f0 = evalFn(x)
    const f1 = evalFn(x + h)
    const f2 = evalFn(x + 2 * h)
    if (Number.isFinite(f0) && Number.isFinite(f1) && Number.isFinite(f2)) {
      return (-3 * f0 + 4 * f1 - f2) / (2 * h)
    }
    if (Number.isFinite(f0) && Number.isFinite(f1)) {
      return (f1 - f0) / h
    }
    return Number.NaN
  }

  return {
    source,
    normalizedSource,
    ast,
    program,
    hasSymbolicDerivative: d1Prog !== null,
    eval: evalFn,
    derivative,
    secondDerivative,
    leftDerivative,
    rightDerivative
  }
}

export function compileScalarField2D(
  source: string,
  mode: HigherMathExpressionMode = "expression"
): CompiledScalarField2D {
  const normalizedSource = normalizeHigherMathInput(source, mode)
  const ast = parseExpression(normalizedSource)
  const program = compileAstToRpn(ast, ["x", "y"])

  const dxAst = differentiateExpressionAst(ast, "x")
  const dyAst = differentiateExpressionAst(ast, "y")
  const dxProg = dxAst ? compileAstToRpn(dxAst, ["x", "y"]) : null
  const dyProg = dyAst ? compileAstToRpn(dyAst, ["x", "y"]) : null

  const dxxAst = dxAst ? differentiateExpressionAst(dxAst, "x") : null
  const dxyAst = dxAst ? differentiateExpressionAst(dxAst, "y") : null
  const dyyAst = dyAst ? differentiateExpressionAst(dyAst, "y") : null
  const dxxProg = dxxAst ? compileAstToRpn(dxxAst, ["x", "y"]) : null
  const dxyProg = dxyAst ? compileAstToRpn(dxyAst, ["x", "y"]) : null
  const dyyProg = dyyAst ? compileAstToRpn(dyyAst, ["x", "y"]) : null

  const evalFn = (x: number, y: number): number => program.eval2D(x, y)

  const gradient = (x: number, y: number): [number, number] => {
    let gx = dxProg ? dxProg.eval2D(x, y) : Number.NaN
    let gy = dyProg ? dyProg.eval2D(x, y) : Number.NaN
    if (!Number.isFinite(gx)) {
      const hx = DERIV_H * Math.max(1, Math.abs(x))
      gx = (evalFn(x + hx, y) - evalFn(x - hx, y)) / (2 * hx)
    }
    if (!Number.isFinite(gy)) {
      const hy = DERIV_H * Math.max(1, Math.abs(y))
      gy = (evalFn(x, y + hy) - evalFn(x, y - hy)) / (2 * hy)
    }
    return [gx, gy]
  }

  const hessian = (x: number, y: number): { fxx: number; fxy: number; fyy: number } => {
    let fxx = dxxProg ? dxxProg.eval2D(x, y) : Number.NaN
    let fxy = dxyProg ? dxyProg.eval2D(x, y) : Number.NaN
    let fyy = dyyProg ? dyyProg.eval2D(x, y) : Number.NaN

    const hx = SECOND_DERIV_H * Math.max(1, Math.abs(x))
    const hy = SECOND_DERIV_H * Math.max(1, Math.abs(y))
    if (!Number.isFinite(fxx)) {
      const [gxp] = gradient(x + hx, y)
      const [gxm] = gradient(x - hx, y)
      fxx = (gxp - gxm) / (2 * hx)
    }
    if (!Number.isFinite(fyy)) {
      const [, gyp] = gradient(x, y + hy)
      const [, gym] = gradient(x, y - hy)
      fyy = (gyp - gym) / (2 * hy)
    }
    if (!Number.isFinite(fxy)) {
      const [gxp] = gradient(x, y + hy)
      const [gxm] = gradient(x, y - hy)
      fxy = (gxp - gxm) / (2 * hy)
    }
    return { fxx, fxy, fyy }
  }

  return {
    source,
    normalizedSource,
    ast,
    program,
    hasSymbolicGradient: dxProg !== null && dyProg !== null,
    eval: evalFn,
    evalGrid: (xMin, xMax, yMin, yMax, nx, ny) => program.evalGrid2D(xMin, xMax, yMin, yMax, nx, ny),
    gradient,
    hessian
  }
}
