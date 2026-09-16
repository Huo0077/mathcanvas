/**
 * 代数消元（Resultant Elimination）
 *
 * 轨迹求取的进阶路线：不做数值采样，而是**从输入约束方程直接消去动点参数**，得到轨迹的隐式代数方程。
 *
 * 输入是一组几何约束方程（都是多项式）：
 *
 *     P = (u, v) 在圆上        u² + v² - 1 = 0
 *     M 是 P 与 A(2,0) 的中点   2x - u - 2 = 0,  2y - v = 0
 *
 * 把 (u, v) 当作待消去的参数，只剩 (x, y)，一次消元就得到轨迹方程：
 *
 *     4x² + 4y² - 8x + 3 = 0
 *
 * 这正是"中点轨迹是圆"的代数证明，而不是"采样看起来像圆"。
 *
 * ## 实现要点
 *
 * - 系数是**精确有理数**（BigInt 分数），所以整个消元过程没有浮点误差累积；
 *   几何输入常常是 0.5、0.333… 这类数，先用连分数吸附到最简分数再进入消元。
 * - 结式用 **Sylvester 矩阵 + Bareiss 无分数消元**计算。Bareiss 的中间除法在多项式环上仍然整除，
 *   因此结果精确；不能整除就说明输入退化，明确返回 null 而不是返回错误的曲线。
 * - **逐次消元会产生增根因子**：先消 u 再消 v，得到的多项式是真正轨迹方程乘以某些多余因子
 *   （这是结式法的固有性质，权威做法是 Gröbner 基）。`eliminate` 的返回值因此标注 `extraneous`，
 *   调用方在绘制前应用 `removeExtraneousFactors` 或用数值代入筛掉。
 */

export interface Rational {
  numerator: bigint
  denominator: bigint
}

function gcd(first: bigint, second: bigint): bigint {
  let a = first < 0n ? -first : first
  let b = second < 0n ? -second : second
  while (b) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a
}

export function rational(numerator: bigint, denominator: bigint = 1n): Rational {
  if (denominator === 0n) throw new Error("rational denominator must not be zero")
  let n = numerator
  let d = denominator
  if (d < 0n) {
    n = -n
    d = -d
  }
  const factor = gcd(n, d)
  return { numerator: n / factor, denominator: d / factor }
}

/**
 * 浮点数 → 有理数（连分数收敛）。
 * 几何里的系数几乎总是"整数或短分数"，32 层收敛足以精确还原它们，
 * 同时把 0.30000000000000004 这类噪声吸附回 3/10。
 */
export function rationalFromNumber(value: number, maxDenominator = 1_000_000n): Rational {
  if (!Number.isFinite(value)) throw new Error("cannot represent a non-finite value as a rational")
  if (Number.isInteger(value)) return rational(BigInt(value))
  const sign = value < 0 ? -1n : 1n
  let fraction = Math.abs(value)
  let pPrev = 1n
  let pPrevPrev = 0n
  let qPrev = 0n
  let qPrevPrev = 1n
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const whole = Math.floor(fraction)
    if (!Number.isFinite(whole)) break
    const a = BigInt(whole)
    const p = a * pPrev + pPrevPrev
    const q = a * qPrev + qPrevPrev
    if (q > maxDenominator) break
    pPrevPrev = pPrev
    pPrev = p
    qPrevPrev = qPrev
    qPrev = q
    const remainder = fraction - whole
    if (remainder < 1e-12) break
    fraction = 1 / remainder
    if (!Number.isFinite(fraction)) break
  }
  return rational(sign * pPrev, qPrev === 0n ? 1n : qPrev)
}

export function rationalToNumber(value: Rational): number {
  return Number(value.numerator) / Number(value.denominator)
}

const qZero = rational(0n)
const qOne = rational(1n)

function qAdd(first: Rational, second: Rational): Rational {
  return rational(first.numerator * second.denominator + second.numerator * first.denominator, first.denominator * second.denominator)
}

function qSub(first: Rational, second: Rational): Rational {
  return rational(first.numerator * second.denominator - second.numerator * first.denominator, first.denominator * second.denominator)
}

function qMul(first: Rational, second: Rational): Rational {
  return rational(first.numerator * second.numerator, first.denominator * second.denominator)
}

function qDiv(first: Rational, second: Rational): Rational {
  if (second.numerator === 0n) throw new Error("polynomial division by zero")
  return rational(first.numerator * second.denominator, first.denominator * second.numerator)
}

function qIsZero(value: Rational): boolean {
  return value.numerator === 0n
}

export function rationalToString(value: Rational): string {
  return value.denominator === 1n ? String(value.numerator) : `${value.numerator}/${value.denominator}`
}

// ---------------------------------------------------------------------------
// 多元多项式
// ---------------------------------------------------------------------------

/**
 * 多元多项式。`terms` 的键是**指数向量**（与 `variables` 同序，逗号分隔），值是有理系数。
 * 零系数的项不保留，因此 `terms.size === 0` 就是零多项式。
 */
export interface Polynomial {
  variables: string[]
  terms: Map<string, Rational>
}

export interface PolynomialTerm {
  coefficient: number
  powers: Record<string, number>
}

function exponentKey(powers: readonly number[]): string {
  return powers.join(",")
}

function parseKey(key: string): number[] {
  return key.split(",").map((part) => Number(part))
}

export function polynomialFromTerms(variables: readonly string[], terms: readonly PolynomialTerm[]): Polynomial {
  const merged = new Map<string, Rational>()
  for (const term of terms) {
    const powers = variables.map((name) => Math.max(0, Math.round(term.powers[name] ?? 0)))
    const key = exponentKey(powers)
    const coefficient = rationalFromNumber(term.coefficient)
    const existing = merged.get(key)
    const next = existing ? qAdd(existing, coefficient) : coefficient
    if (qIsZero(next)) merged.delete(key)
    else merged.set(key, next)
  }
  return { variables: [...variables], terms: merged }
}

export function polynomialConstant(variables: readonly string[], value: number): Polynomial {
  return polynomialFromTerms(variables, [{ coefficient: value, powers: {} }])
}

export function polynomialVariable(variables: readonly string[], name: string): Polynomial {
  return polynomialFromTerms(variables, [{ coefficient: 1, powers: { [name]: 1 } }])
}

export function isZeroPolynomial(polynomial: Polynomial): boolean {
  return polynomial.terms.size === 0
}

export function polynomialAdd(first: Polynomial, second: Polynomial): Polynomial {
  const terms = new Map(first.terms)
  for (const [key, coefficient] of second.terms) {
    const existing = terms.get(key)
    const next = existing ? qAdd(existing, coefficient) : coefficient
    if (qIsZero(next)) terms.delete(key)
    else terms.set(key, next)
  }
  return { variables: first.variables, terms }
}

export function polynomialNegate(polynomial: Polynomial): Polynomial {
  const terms = new Map<string, Rational>()
  for (const [key, coefficient] of polynomial.terms) terms.set(key, rational(-coefficient.numerator, coefficient.denominator))
  return { variables: polynomial.variables, terms }
}

export function polynomialSubtract(first: Polynomial, second: Polynomial): Polynomial {
  return polynomialAdd(first, polynomialNegate(second))
}

export function polynomialMultiply(first: Polynomial, second: Polynomial): Polynomial {
  const terms = new Map<string, Rational>()
  for (const [firstKey, firstCoefficient] of first.terms) {
    const firstPowers = parseKey(firstKey)
    for (const [secondKey, secondCoefficient] of second.terms) {
      const secondPowers = parseKey(secondKey)
      const powers = firstPowers.map((value, index) => value + secondPowers[index])
      const key = exponentKey(powers)
      const product = qMul(firstCoefficient, secondCoefficient)
      const existing = terms.get(key)
      const next = existing ? qAdd(existing, product) : product
      if (qIsZero(next)) terms.delete(key)
      else terms.set(key, next)
    }
  }
  return { variables: first.variables, terms }
}

export function polynomialScale(polynomial: Polynomial, factor: number): Polynomial {
  const scaled = rationalFromNumber(factor)
  const terms = new Map<string, Rational>()
  for (const [key, coefficient] of polynomial.terms) {
    const next = qMul(coefficient, scaled)
    if (!qIsZero(next)) terms.set(key, next)
  }
  return { variables: polynomial.variables, terms }
}

export function polynomialEvaluate(polynomial: Polynomial, values: Record<string, number>): number {
  let total = 0
  for (const [key, coefficient] of polynomial.terms) {
    const powers = parseKey(key)
    let term = rationalToNumber(coefficient)
    for (let index = 0; index < powers.length; index += 1) term *= (values[polynomial.variables[index]] ?? 0) ** powers[index]
    total += term
  }
  return total
}

/** 某个变量的次数。 */
export function polynomialDegree(polynomial: Polynomial, variable: string): number {
  const index = polynomial.variables.indexOf(variable)
  if (index < 0) return 0
  let degree = 0
  for (const key of polynomial.terms.keys()) degree = Math.max(degree, parseKey(key)[index])
  return degree
}

/**
 * 按 `variable` 展开成系数多项式数组：`result[k]` 是 `variable^k` 的系数。结式就在这个表示上算。
 *
 * **所有结果都保留完整的变量表**（被消变量那一位置 0），不去掉变量名。
 * 这是必须的：指数向量是按位置相加的，一旦某个多项式少了一维，
 * 与其他多项式相乘时指数就会错位，算出的是垃圾而不是曲线（实测：正是这个原因
 * 让"中点轨迹"消元得到 3/7 而不是 −1/3）。
 */
export function coefficientsIn(polynomial: Polynomial, variable: string): Polynomial[] {
  const index = polynomial.variables.indexOf(variable)
  if (index < 0) return [polynomial]
  const buckets = new Map<number, Map<string, Rational>>()
  for (const [key, coefficient] of polynomial.terms) {
    const powers = parseKey(key)
    const power = powers[index]
    const reduced = [...powers]
    reduced[index] = 0
    const bucket = buckets.get(power) ?? new Map<string, Rational>()
    bucket.set(exponentKey(reduced), coefficient)
    buckets.set(power, bucket)
  }
  const highest = polynomialDegree(polynomial, variable)
  const result: Polynomial[] = []
  for (let power = 0; power <= highest; power += 1) {
    result.push({ variables: polynomial.variables, terms: buckets.get(power) ?? new Map() })
  }
  return result
}

export function polynomialToString(polynomial: Polynomial): string {
  if (polynomial.terms.size === 0) return "0"
  const parts: string[] = []
  for (const [key, coefficient] of [...polynomial.terms.entries()].sort()) {
    const powers = parseKey(key)
    const factors = polynomial.variables
      .map((name, index) => (powers[index] > 0 ? (powers[index] === 1 ? name : `${name}^${powers[index]}`) : ""))
      .filter(Boolean)
      .join("*")
    parts.push(`${rationalToString(coefficient)}${factors ? `*${factors}` : ""}`)
  }
  return parts.join(" + ")
}

// ---------------------------------------------------------------------------
// 多项式除法与结式
// ---------------------------------------------------------------------------

/** 单项式的分级字典序比较：先比总次数，再按指数向量逐位比较。保证长除法终止。 */
function compareMonomials(first: readonly number[], second: readonly number[]): number {
  const firstTotal = first.reduce((sum, value) => sum + value, 0)
  const secondTotal = second.reduce((sum, value) => sum + value, 0)
  if (firstTotal !== secondTotal) return firstTotal - secondTotal
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return first[index] - second[index]
  }
  return 0
}

function leadingTerm(polynomial: Polynomial): { powers: number[]; coefficient: Rational } | null {
  let best: { powers: number[]; coefficient: Rational } | null = null
  for (const [key, coefficient] of polynomial.terms) {
    const powers = parseKey(key)
    if (!best || compareMonomials(powers, best.powers) > 0) best = { powers, coefficient }
  }
  return best
}

/**
 * 精确多项式除法。不能整除时返回 null —— 这正是"输入退化"的可靠信号，
 * 比默默返回一个近似商要安全得多。
 */
export function polynomialDivideExact(dividend: Polynomial, divisor: Polynomial): Polynomial | null {
  if (isZeroPolynomial(divisor)) return null
  let remainder = dividend
  let quotient = { variables: dividend.variables, terms: new Map<string, Rational>() } as Polynomial
  const divisorLeading = leadingTerm(divisor)!
  let guard = 0
  while (!isZeroPolynomial(remainder)) {
    if (guard++ > 4096) return null
    const remainderLeading = leadingTerm(remainder)!
    const powers = remainderLeading.powers.map((value, index) => value - divisorLeading.powers[index])
    if (powers.some((value) => value < 0)) return null
    const coefficient = qDiv(remainderLeading.coefficient, divisorLeading.coefficient)
    const term: Polynomial = { variables: dividend.variables, terms: new Map([[exponentKey(powers), coefficient]]) }
    quotient = polynomialAdd(quotient, term)
    remainder = polynomialSubtract(remainder, polynomialMultiply(term, divisor))
  }
  return quotient
}

/**
 * 两个多项式关于 `variable` 的结式（Sylvester 矩阵行列式），用 Bareiss 无分数消元计算。
 * 结式为零 ⇔ 两者有公根，这正是消元的依据。
 */
export function resultant(first: Polynomial, second: Polynomial, variable: string): Polynomial | null {
  const firstCoefficients = coefficientsIn(first, variable)
  const secondCoefficients = coefficientsIn(second, variable)
  const firstDegree = polynomialDegree(first, variable)
  const secondDegree = polynomialDegree(second, variable)
  const base: Polynomial = { variables: first.variables, terms: new Map() }
  const zero = (): Polynomial => ({ variables: base.variables, terms: new Map() })
  if (firstDegree === 0 || secondDegree === 0) {
    // 常数（对 variable 而言）与另一者没有公根可消；结式退化为常数的幂。
    const constant = firstDegree === 0 ? firstCoefficients[0] : secondCoefficients[0]
    const exponent = firstDegree === 0 ? secondDegree : firstDegree
    if (isZeroPolynomial(constant)) return zero()
    let power: Polynomial = { variables: base.variables, terms: new Map([[exponentKey(base.variables.map(() => 0)), qOne]]) }
    for (let index = 0; index < exponent; index += 1) power = polynomialMultiply(power, constant)
    return power
  }
  const size = firstDegree + secondDegree
  // Sylvester 矩阵：前 secondDegree 行是 first 的系数右移，后 firstDegree 行是 second 的系数右移。
  const matrix: Polynomial[][] = []
  const descending = (coefficients: readonly Polynomial[]) => [...coefficients].reverse()
  const firstRow = descending(firstCoefficients)
  const secondRow = descending(secondCoefficients)
  /**
   * 每一行都必须是完整的 `size` 列。按 `row.map(...)` 生成是错的 —— 那只会产出
   * `row.length`（= 该多项式次数 + 1）列，矩阵就不是方阵，Bareiss 会在越界处读到 undefined。
   */
  const shiftedRow = (coefficients: readonly Polynomial[], shift: number): Polynomial[] =>
    Array.from({ length: size }, (_, column) => (column >= shift && column - shift < coefficients.length ? coefficients[column - shift] : zero()))
  for (let row = 0; row < secondDegree; row += 1) matrix.push(shiftedRow(firstRow, row))
  for (let row = 0; row < firstDegree; row += 1) matrix.push(shiftedRow(secondRow, row))

  // Bareiss：A[i][j] = (A[k][k]A[i][j] - A[i][k]A[k][j]) / previousPivot
  let previousPivot: Polynomial = { variables: base.variables, terms: new Map([[exponentKey(base.variables.map(() => 0)), qOne]]) }
  let sign = 1
  for (let pivot = 0; pivot < size - 1; pivot += 1) {
    if (isZeroPolynomial(matrix[pivot][pivot])) {
      // 选主元：往下找同列非零项交换，行列式变号。
      let swap = -1
      for (let row = pivot + 1; row < size; row += 1) {
        if (!isZeroPolynomial(matrix[row][pivot])) {
          swap = row
          break
        }
      }
      if (swap < 0) return zero()
      ;[matrix[pivot], matrix[swap]] = [matrix[swap], matrix[pivot]]
      sign = -sign
    }
    for (let row = pivot + 1; row < size; row += 1) {
      for (let column = pivot + 1; column < size; column += 1) {
        const numerator = polynomialSubtract(
          polynomialMultiply(matrix[pivot][pivot], matrix[row][column]),
          polynomialMultiply(matrix[row][pivot], matrix[pivot][column])
        )
        const divided = polynomialDivideExact(numerator, previousPivot)
        // Bareiss 保证整除；除不尽说明输入已经退化，宁可失败也不要给出错误曲线。
        if (divided === null) return null
        matrix[row][column] = divided
      }
      matrix[row][pivot] = zero()
    }
    previousPivot = matrix[pivot][pivot]
  }
  const determinant = matrix[size - 1][size - 1]
  return sign < 0 ? polynomialNegate(determinant) : determinant
}

export interface EliminationResult {
  polynomial: Polynomial
  /** 真实消掉的变量顺序。 */
  eliminated: string[]
  /**
   * 结果里可能含有**多余因子**。逐次结式消元无法避免（Gröbner 基可以），
   * 取零集时不影响正确性，但绘制前最好用 `polynomialEvaluate` 在样本点筛一遍。
   */
  extraneous: boolean
}

/**
 * 逐个消去变量。每一步取上一个结果与下一个方程关于该变量的结式。
 *
 * 注意：方程数必须不少于待消变量数，否则欠定（自由度 > 0，轨迹不是一个隐式方程能表达的，
 * 例如"轨迹是整个平面"）。此时返回 null。
 */
export function eliminate(equations: readonly Polynomial[], variables: readonly string[]): EliminationResult | null {
  if (equations.length === 0 || variables.length === 0) return null
  let current: Polynomial[] = [...equations]
  const eliminated: string[] = []
  for (const variable of variables) {
    const next: Polynomial[] = []
    let produced = false
    for (let first = 0; first < current.length; first += 1) {
      for (let second = first + 1; second < current.length; second += 1) {
        // 对 variable 是常数的方程直接透传，避免结式退化成常数的幂而丢掉信息。
        const firstIsConstant = polynomialDegree(current[first], variable) === 0
        const secondIsConstant = polynomialDegree(current[second], variable) === 0
        if (firstIsConstant && secondIsConstant) continue
        if (firstIsConstant || secondIsConstant) {
          next.push(firstIsConstant ? current[first] : current[second])
          produced = true
          continue
        }
        const result = resultant(current[first], current[second], variable)
        if (result === null) return null
        if (isZeroPolynomial(result)) continue
        next.push(result)
        produced = true
      }
    }
    const constants = current.filter((polynomial) => polynomialDegree(polynomial, variable) === 0)
    current = [...next, ...constants.filter((polynomial) => !next.includes(polynomial))]
    if (!produced) return null
    eliminated.push(variable)
    if (current.length === 0) return null
  }
  // 结果里对每个已消变量都不应再有依赖；剩下的按次数从低到高取最简单的一个。
  const candidates = current.filter((polynomial) => variables.every((variable) => polynomialDegree(polynomial, variable) === 0))
  if (candidates.length === 0) return null
  const best = candidates.reduce((simplest, candidate) => (candidate.terms.size < simplest.terms.size ? candidate : simplest))
  return { polynomial: best, eliminated, extraneous: current.length > 1 }
}

/**
 * 参数方程 → 隐式方程。
 *
 * @param equations 全部约束方程（含参数方程），每项等于 0
 * @param parameter 要消去的动点参数
 * @param coordinates 留下的坐标变量
 */
export function implicitize(equations: readonly Polynomial[], parameter: string, coordinates: readonly string[]): EliminationResult | null {
  if (!equations.some((polynomial) => polynomial.variables.includes(parameter))) return null
  for (const coordinate of coordinates) {
    if (!equations.some((polynomial) => polynomial.variables.includes(coordinate))) return null
  }
  return eliminate(equations, [parameter])
}

/**
 * 隐式曲线采样（marching squares）。
 *
 * 消元得到的是"看不见的方程"，要画出来就得数值等值线化。对每个网格单元看四角符号：
 * 有变号就在边上线性插值出交点，连成线段。变号 4 次（鞍点）时用单元中心值裁决连接方式，
 * 否则会出现交叉连线这种经典 marching squares 瑕疵。
 */
export function sampleImplicitPolynomial(
  polynomial: Polynomial,
  variables: readonly [string, string],
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  resolution = 64
): { a: { x: number; y: number }; b: { x: number; y: number } }[] {
  const [xName, yName] = variables
  const steps = Math.max(4, Math.floor(resolution))
  const stepX = (bounds.maxX - bounds.minX) / steps
  const stepY = (bounds.maxY - bounds.minY) / steps
  const valueAt = (x: number, y: number) => polynomialEvaluate(polynomial, { [xName]: x, [yName]: y })
  const segments: { a: { x: number; y: number }; b: { x: number; y: number } }[] = []
  const interpolate = (x1: number, y1: number, v1: number, x2: number, y2: number, v2: number) => {
    const denominator = v1 - v2
    const ratio = Math.abs(denominator) < 1e-300 ? 0.5 : v1 / denominator
    return { x: x1 + (x2 - x1) * ratio, y: y1 + (y2 - y1) * ratio }
  }
  for (let row = 0; row < steps; row += 1) {
    for (let column = 0; column < steps; column += 1) {
      const x0 = bounds.minX + column * stepX
      const x1 = x0 + stepX
      const y0 = bounds.minY + row * stepY
      const y1 = y0 + stepY
      const v00 = valueAt(x0, y0)
      const v10 = valueAt(x1, y0)
      const v11 = valueAt(x1, y1)
      const v01 = valueAt(x0, y1)
      if (![v00, v10, v11, v01].every(Number.isFinite)) continue
      const crossings: { x: number; y: number }[] = []
      if (v00 === 0 && v10 === 0) continue
      if (v00 * v10 < 0) crossings.push(interpolate(x0, y0, v00, x1, y0, v10))
      if (v10 * v11 < 0) crossings.push(interpolate(x1, y0, v10, x1, y1, v11))
      if (v11 * v01 < 0) crossings.push(interpolate(x1, y1, v11, x0, y1, v01))
      if (v01 * v00 < 0) crossings.push(interpolate(x0, y1, v01, x0, y0, v00))
      if (crossings.length === 2) segments.push({ a: crossings[0], b: crossings[1] })
      else if (crossings.length === 4) {
        // 鞍点：用中心值的符号决定怎么连，避免画出一个不存在的交叉。
        const center = valueAt((x0 + x1) / 2, (y0 + y1) / 2)
        if (center * v00 > 0) {
          segments.push({ a: crossings[0], b: crossings[1] })
          segments.push({ a: crossings[2], b: crossings[3] })
        } else {
          segments.push({ a: crossings[0], b: crossings[3] })
          segments.push({ a: crossings[1], b: crossings[2] })
        }
      }
    }
  }
  return segments
}
