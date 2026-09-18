/**
 * 把测量出来的浮点数还原成**精确形式**：整数 / 分数 / π 的有理倍数 / 二次无理数。
 *
 * 用户口径："旁边增加一个数据转换功能，能够识别到图中的小数，并且在功能内输出分数形式，
 * 无理数也能输出"。
 *
 * 三层判据（2026-09-19 起，见 `exactFormOf`）：
 * 1. **精确层**：紧容差（相对 1e-9 + 绝对 1e-12）命中 ⇒ 不带 `≈`。能准确算出来的就必须保留精度；
 * 2. **吸附层**：只在**常见形式**（整数、常见分母的既约分数、π 的有理倍数、简单根式）里找，
 *    命中一律带 `≈` 并给出残差 —— 手拖动出来的值也是"往常见整数与分数靠"的；
 * 3. **兜底**：都不中才给两位小数（`≈ 0.64`），绝不出现"未识别"这句话。
 *
 * 两条纪律：
 * 1. **区分"确实是"与"按容差认出来的"**：`2/3` 与 `≈ 2/3` 的可信度必须一眼可辨，读数一律带残差；
 * 2. **纯函数**：不读文档、不碰状态，因此画布、属性栏、导出、单测可以共用同一份判据。
 *
 * 分数的约分与格式化复用 `polynomial.ts` 的 `rational` / `rationalToString`，不另写一套。
 */
import { rational, rationalToString } from "./polynomial"

export type ExactForm =
  | { kind: "integer"; text: string }
  | { kind: "rational"; text: string }
  | { kind: "pi-multiple"; text: string }
  | { kind: "e-multiple"; text: string }
  | { kind: "surd"; text: string }
  | { kind: "unrecognised"; text: string }

export interface ExactFormReading {
  form: ExactForm
  /** 精确形式的浮点值；落回两位小数时 = 四舍五入后的值。 */
  value: number
  /** |输入 − 显示值|；输入非有限时为 null。 */
  residual: number | null
  /**
   * `exact` = 按**紧容差**命中（这个值确实等于那个精确形式）；
   * `approximate` = 按**松容差**命中（是它的四舍五入写法，文本带 `≈`）或落回两位小数。
   *
   * 分开标注是刻意的：面板据此告诉用户"这是认出来的近似"，而不是让 `2/3` 与 `≈ 2/3`
   * 看起来一样可信。
   */
  certainty: "exact" | "approximate"
}

/**
 * 紧容差：这个值**确实**等于那个精确形式。
 *
 * 用户反馈（2026-09-18）："为什么会显示未识别为精确形式" —— 实测根因是量出来的值常常是
 * **简单分数的六位小数写法**（点的坐标是 `0.333333` ⇒ 长度 `0.666667`），而 1e-9 会把
 * `2/3` 判成"不是 2/3"。所以紧容差之外还有一层松容差（见下），两层都不中才落回两位小数。
 */
const DEFAULT_RELATIVE_TOLERANCE = 1e-9
const DEFAULT_ABSOLUTE_TOLERANCE = 1e-12
/**
 * 吸附层的两条带：**常量认紧、常见分数认宽**。
 *
 * 用户口径（2026-09-19）："这个近似不那么好用，手稍微偏一偏分数就没了，我们不需要那么精确，
 * 我们要将数据往常见整数和分数上面靠。"＋"坐标是整数或分数时，能够准确计算时，还是保留精度。"
 *
 * 旧实现的两个毛病（实测读数见 `exact-forms.test.ts`）：
 * 1. 松容差取"输入自身十进制末位的半个单位"（**绝对**值）——拖出来的值是全精度浮点
 *    （`0.667023`），容差只剩 5e-7，而 2/3 差 4.6e-4 ⇒ 被拒，读数掉回 `≈ 0.67`；
 * 2. 分数取"分母 ≤ 64 里**最接近**的有理数"——只要有一点余量就抓 `33/50`、`20/29`，根式族更会
 *    反解出 `(11-4√7)/5`、`(5+4√39)/10` 这类教学上没有意义的形式。
 *
 * 为什么常量带只有 0.3%：π 的有理倍数与根式是"有名有姓"的强主张，而简单根式在小数轴上相当密
 * （`√2/2 = 0.7071` 离手输的 `0.71` 只有 0.4%），放宽就会把一个普通的 `0.71` 说成 `√2/2`。
 */
const SNAP_CONSTANT_RELATIVE_TOLERANCE = 3e-3
const SNAP_COMMON_RELATIVE_TOLERANCE = 2e-2
/** 相对容差在 0 附近会退化成 0；用与精确层同一个绝对下限兜住。 */
const SNAP_ABSOLUTE_FLOOR = 1e-12
/** 常见分母：教科书里真会出现的等分 —— 二分、三分、四分、五分、六分、八分、十分、十二分。 */
const COMMON_DENOMINATORS = [1, 2, 3, 4, 5, 6, 8, 10, 12]
/**
 * 简单根式 `b√n/c` 的搜索边界：课堂上的 √2、√2/2、√3/2、2√2 都在里面。
 *
 * 两条边界都是实测逼出来的，不是保守：
 * 1. **只认纯根式（a = 0）**。带上整数部分的 `(a + b√n)/c` 一旦进入吸附层，0.3% 的带里几乎
 *    任何数都能被某个怪形式凑上 —— 实测 `0.6751 → (-4+3√5)/4`、`0.69 → -4+√22`、
 *    `e → (3+√62)/4`、`e → (1+√51)/3`，全都"数学上成立、教学上荒谬"。带整数部分的根式
 *    （黄金比 `(1+√5)/2`、`2+√3`）仍然由**精确层**认，因为它们是精确构造出来的，不是拖出来的。
 * 2. **系数只到 3**：`b ∈ ±{1,2,3}` 覆盖 `√2`、`2√2`、`3√2` 这类对角线长度就够；再大就与
 *    "常见"无关了。
 */
const SNAP_SURD_COEFFICIENTS = [-3, -2, -1, 1, 2, 3]
const SNAP_SURD_DIVISORS = [1, 2, 3, 4]

function snapLimit(input: number, relative: number): number {
  return Math.max(SNAP_ABSOLUTE_FLOOR, Math.abs(input) * relative)
}
/** 教学场景里够用的分母上限（**只用于精确层**）；再大就该认为它本来不是分数。 */
const MAX_DENOMINATOR = 64
/** π 的有理倍数的分母上限：覆盖 π/12 的整数倍（15°、30°、45°、60°、90°…）。 */
const MAX_PI_DENOMINATOR = 12

/**
 * 常量倍数的文本：`π`、`-π`、`2π`、`π/4`、`-3π/2`；`e`、`2e`、`-e`。
 *
 * π 与 e 共用一份格式化 —— 两族只差一个符号，各写一份就是本仓库反复吃过的"名单副本"。
 */
export function formatConstantMultiple(symbol: string, numerator: number, denominator: number): string {
  const sign = numerator < 0 ? "-" : ""
  const magnitude = Math.abs(numerator)
  const coefficient = magnitude === 1 ? symbol : `${magnitude}${symbol}`
  return denominator === 1 ? `${sign}${coefficient}` : `${sign}${coefficient}/${denominator}`
}

/** π 的有理倍数文本：`π`、`-π`、`2π`、`π/4`、`-3π/2`。 */
export function formatPiMultiple(numerator: number, denominator: number): string {
  return formatConstantMultiple("π", numerator, denominator)
}

/**
 * 二次无理数 `(a + b√n)/c` 的搜索边界。
 *
 * 这些数字不是随便取的：n 取到 99 覆盖课堂会遇到的 √2…√99；c ≤ 12 覆盖 /2、/3、/4 这类分母；
 * a、b 取小整数。
 *
 * **不枚举 n，而是解出 n**：由 `(a + b√n)/c = input` 得 `√n = (c·input − a)/b`，
 * 于是 `n = ((c·input − a)/b)²` —— 只需检查它是不是 [2, 99] 内的平方自由整数。
 * 第一版是按 n 枚举的（约 70 万个候选），**实测最坏情况 114.9 ms**，对一个渲染时调用的面板
 * 完全不可接受（见进度文档的耗时读数）；改成解 n 之后候选量降到约 1.4 万个，且与 n 的范围无关。
 */
const MAX_SURD_RADICAND = 99
const MAX_SURD_DENOMINATOR = 12
const MAX_SURD_COEFFICIENT = 12
const MAX_SURD_INTEGER = 24

function isSquareFree(value: number): boolean {
  for (let factor = 2; factor * factor <= value; factor += 1) {
    if (value % (factor * factor) === 0) return false
  }
  return true
}

/** 候选表在模块加载时算一次：放进循环里会让每次枚举重新分配数组（耗时读数会骗人）。 */
const SURD_INTEGERS = Array.from({ length: MAX_SURD_INTEGER * 2 + 1 }, (_, index) => index - MAX_SURD_INTEGER)

/** `(a + b√n)/c` 的文本：`√2`、`3√2`、`√2/2`、`-√3/2`、`2+√3`、`(1+√5)/2`。 */
export function formatQuadraticSurd(a: number, b: number, radicand: number, divisor: number): string {
  const root = `√${radicand}`
  const radicalPart = Math.abs(b) === 1 ? root : `${Math.abs(b)}${root}`
  if (a === 0) {
    const signed = b < 0 ? `-${radicalPart}` : radicalPart
    return divisor === 1 ? signed : `${signed}/${divisor}`
  }
  const body = b === 0 ? `${a}` : `${a}${b > 0 ? "+" : "-"}${radicalPart}`
  return divisor === 1 ? body : `(${body})/${divisor}`
}

/**
 * 由 `(a + b√n)/c = input` 反解出 `n`，返回 `[n]`（是 [2, 99] 内的平方自由整数时）或 `null`。
 *
 * 整数判定用了一点相对容差（1e-6）：输入本身是浮点，反解出的 n 会有末位误差；
 * 但**最终是否命中仍由 `hit()` 用调用方给的容差把关**，所以放宽这一步不会造成误报。
 *
 * `valueTolerance` 是**吸附层**额外传进来的：那里的输入可以离真值 0.3% 远，反解出的 n 的误差
 * 也随之放大到 `2·√n·(c/|b|)·Δx` —— 实测 `1.41421` 反解出 n = 1.9999895（差 1.05e-5），
 * 用固定的 2e-6 会把它判成"不是 2"，于是 `√2` 认不出来、掉到 `≈ 17/12`。
 */
function radicandFrom(input: number, whole: number, coefficient: number, divisor: number, valueTolerance = 0): number | null {
  const rootCandidate = (divisor * input - whole) / coefficient
  if (!(rootCandidate > 0)) return null
  const radicand = rootCandidate * rootCandidate
  const rounded = Math.round(radicand)
  /**
   * 边界按**四舍五入后的整数**判：吸附层的 `1.41421` 反解出 `n = 1.9999903`（略小于 2），
   * 若拿原始 `radicand` 去比 `>= 2` 就会把 `√2` 判成"不在范围内"，于是它掉到 `≈ 17/12`。
   */
  if (rounded < 2 || rounded > MAX_SURD_RADICAND) return null
  const errorFromValue = 2 * rootCandidate * (divisor / Math.abs(coefficient)) * valueTolerance
  if (Math.abs(radicand - rounded) > Math.max(1e-9, rounded * 1e-6, errorFromValue)) return null
  return isSquareFree(rounded) ? rounded : null
}

function toleranceFor(input: number, tolerance?: number): number {
  if (tolerance !== undefined) return tolerance
  return Math.max(DEFAULT_ABSOLUTE_TOLERANCE, Math.abs(input) * DEFAULT_RELATIVE_TOLERANCE)
}

/**
 * 连分数展开求**最佳有理逼近**：返回分母不超过 `maxDenominator` 的渐近分数。
 *
 * 负数取绝对值算、最后补符号 —— `Math.floor` 对负数的行为与连分数约定不一致，分开处理最不容易错。
 */
export function bestRational(input: number, maxDenominator: number): { numerator: bigint; denominator: bigint } | null {
  let value = Math.abs(input)
  if (!Number.isFinite(value)) return null
  let previousNumerator = 0n
  let numerator = 1n
  let previousDenominator = 1n
  let denominator = 0n
  for (let step = 0; step < 64; step += 1) {
    const whole = Math.floor(value)
    const nextNumerator = BigInt(whole) * numerator + previousNumerator
    const nextDenominator = BigInt(whole) * denominator + previousDenominator
    if (nextDenominator > BigInt(maxDenominator)) break
    previousNumerator = numerator
    numerator = nextNumerator
    previousDenominator = denominator
    denominator = nextDenominator
    const fraction = value - whole
    if (fraction < 1e-15) break
    value = 1 / fraction
  }
  if (denominator === 0n) return null
  return rational(input < 0 ? -numerator : numerator, denominator)
}

/** 非有限数：没有两位小数可显示，只能如实说"不是有限数"。 */
export function nonFiniteForm(input: number): ExactFormReading {
  return { form: { kind: "unrecognised", text: "未识别（不是有限数）" }, value: input, residual: null, certainty: "approximate" }
}

/**
 * 两位小数兜底（用户口径："如果不能转换为分数就保留两位小数"）。
 *
 * 认不出精确形式时**不再显示"未识别"**，而是给一个四位有效信息的近似值，并如实给出差值。
 * 负零归一成 `0.00`（`-0.001.toFixed(2)` 是 `"-0.00"`，那会被读成负号）。
 */
export function decimalFallback(input: number): ExactFormReading {
  const rounded = Number(input.toFixed(2))
  const value = Object.is(rounded, -0) ? 0 : rounded
  return { form: { kind: "unrecognised", text: `≈ ${value.toFixed(2)}` }, value, residual: Math.abs(input - value), certainty: "approximate" }
}

/** 命中判据：`|input − value| ≤ 容差`，命中就返回带残差与确信度的读数。 */
export function hit(input: number, value: number, form: ExactForm, limit: number, certainty: "exact" | "approximate" = "exact"): ExactFormReading | null {
  const residual = Math.abs(input - value)
  return residual <= limit ? { form, value, residual, certainty } : null
}

/**
 * 按给定容差在四族里找精确形式；找不到返回 `null`（由调用方决定降级策略）。
 *
 * `approximate` = 这一轮用的是松容差，文本统一加 `≈`：读者必须能一眼看出
 * "`2/3`" 与 "`≈ 2/3`" 的可信度不同。
 */
function recognise(input: number, limit: number, approximate: boolean): ExactFormReading | null {
  const label = (text: string) => (approximate ? `≈ ${text}` : text)
  const certainty = approximate ? "approximate" as const : "exact" as const

  const rounded = Math.round(input)
  const integerHit = hit(input, rounded, { kind: "integer", text: label(String(rounded)) }, limit, certainty)
  if (integerHit) return integerHit

  const fraction = bestRational(input, MAX_DENOMINATOR)
  if (fraction) {
    const value = Number(fraction.numerator) / Number(fraction.denominator)
    const rationalHit = hit(input, value, { kind: "rational", text: label(rationalToString(fraction)) }, limit, certainty)
    if (rationalHit) return rationalHit
  }

  /**
   * π 的有理倍数。放在分数**之后**是安全的：π 的有理倍数是无理数，任何分母 ≤ 64 的分数
   * 与它的差都远大于紧容差（例如 π/4 ≈ 0.785398 最近的是 11/14，差 1.4e-3），所以不会互相抢。
   */
  const piFraction = bestRational(input / Math.PI, MAX_PI_DENOMINATOR)
  if (piFraction && piFraction.numerator !== 0n) {
    const numerator = Number(piFraction.numerator)
    const denominator = Number(piFraction.denominator)
    const value = (numerator / denominator) * Math.PI
    const piHit = hit(input, value, { kind: "pi-multiple", text: label(formatPiMultiple(numerator, denominator)) }, limit, certainty)
    if (piHit) return piHit
  }

  /**
   * e 的**整数倍**（用户口径 2026-09-19："e 也需要有"）。
   *
   * 只认整数倍，与 π 认到 π/12 刻意不同：π 的分数倍在这个画布上有自然来源（15°/30°/45° 的角），
   * e 没有 —— 放开分母只会让更多普通值被怪形式认领（`e/12 ≈ 0.2266` 的间距下，0.3% 的带能覆盖
   * 约 7% 的数轴）。整数倍的间距是 e 本身，误认概率低两个数量级。
   */
  const eMultiple = Math.round(input / Math.E)
  if (eMultiple !== 0) {
    const eHit = hit(input, eMultiple * Math.E, { kind: "e-multiple", text: label(formatConstantMultiple("e", eMultiple, 1)) }, limit, certainty)
    if (eHit) return eHit
  }

  /**
   * 二次无理数 `(a + b√n)/c`：课堂上的 √2、√2/2、(1+√5)/2、2+√3 都在这一族里。
   *
   * 先扫 `a = 0` 的**纯根式**（最常见），再扫带整数部分的一般情形；
   * 两者都按"分母小 → 系数小 → 整数部分小"的顺序扫，于是命中的是**最简**的那个形式。
   */
  for (let divisor = 1; divisor <= MAX_SURD_DENOMINATOR; divisor += 1) {
    for (let coefficient = -MAX_SURD_COEFFICIENT; coefficient <= MAX_SURD_COEFFICIENT; coefficient += 1) {
      if (coefficient === 0) continue
      const radicand = radicandFrom(input, 0, coefficient, divisor)
      if (radicand === null) continue
      const value = (coefficient * Math.sqrt(radicand)) / divisor
      const surdHit = hit(input, value, { kind: "surd", text: label(formatQuadraticSurd(0, coefficient, radicand, divisor)) }, limit, certainty)
      if (surdHit) return surdHit
    }
  }
  for (let divisor = 1; divisor <= MAX_SURD_DENOMINATOR; divisor += 1) {
    for (let coefficient = -MAX_SURD_COEFFICIENT; coefficient <= MAX_SURD_COEFFICIENT; coefficient += 1) {
      if (coefficient === 0) continue
      for (const wholePart of SURD_INTEGERS) {
        if (wholePart === 0) continue
        const radicand = radicandFrom(input, wholePart, coefficient, divisor)
        if (radicand === null) continue
        const value = (wholePart + coefficient * Math.sqrt(radicand)) / divisor
        const surdHit = hit(input, value, { kind: "surd", text: label(formatQuadraticSurd(wholePart, coefficient, radicand, divisor)) }, limit, certainty)
        if (surdHit) return surdHit
      }
    }
  }

  return null
}

/**
 * 吸附层之一：**常见整数与分数**里最接近 `input` 的那一个（残差 ≤ `limit`）。
 *
 * 与精确层的 `bestRational`（分母 ≤ 64 里最接近的有理数）是**两种判据**：这里枚举的是常见分母
 * （1、2、3、4、5、6、8、10、12），取"命中候选里残差最小的那个"。所以 `0.68` 得到 `2/3`
 * 而不是 `17/25`，`0.0834` 得到 `1/12` 而不是 29 分之几 —— "数学上更近、教学上没用"的形式进不来。
 */
function nearestCommonValue(input: number, limit: number): ExactFormReading | null {
  let best: ExactFormReading | null = null
  for (const denominator of COMMON_DENOMINATORS) {
    const numerator = Math.round(input * denominator)
    const value = numerator / denominator
    const form: ExactForm = denominator === 1
      ? { kind: "integer", text: `≈ ${numerator}` }
      : { kind: "rational", text: `≈ ${rationalToString(rational(BigInt(numerator), BigInt(denominator)))}` }
    const candidate = hit(input, value, form, limit, "approximate")
    if (candidate && (best === null || candidate.residual! < best.residual!)) best = candidate
  }
  return best
}

/**
 * 吸附层之二：**有名有姓的常量**（π 的有理倍数、e 的整数倍、纯根式）里最接近的那一个，各族一起比残差。
 *
 * 候选集是有意压小的：根式只留 `b√n/c`（b ∈ ±{1,2,3}、c ≤ 4），于是
 * `(11-4√7)/5`、`(5+4√39)/10` 这种从宽搜索里反解出来的怪形式再也出现不了，而课上的
 * √2、√3/2、2√2 一个都不少。
 */
function nearestNamedConstant(input: number, limit: number): ExactFormReading | null {
  let best: ExactFormReading | null = null
  const keep = (candidate: ExactFormReading | null) => {
    if (candidate && (best === null || candidate.residual! < best.residual!)) best = candidate
  }
  const piFraction = bestRational(input / Math.PI, MAX_PI_DENOMINATOR)
  if (piFraction && piFraction.numerator !== 0n) {
    const numerator = Number(piFraction.numerator)
    const denominator = Number(piFraction.denominator)
    keep(hit(input, (numerator / denominator) * Math.PI, { kind: "pi-multiple", text: `≈ ${formatPiMultiple(numerator, denominator)}` }, limit, "approximate"))
  }
  const eMultiple = Math.round(input / Math.E)
  if (eMultiple !== 0) {
    keep(hit(input, eMultiple * Math.E, { kind: "e-multiple", text: `≈ ${formatConstantMultiple("e", eMultiple, 1)}` }, limit, "approximate"))
  }
  for (const divisor of SNAP_SURD_DIVISORS) {
    for (const coefficient of SNAP_SURD_COEFFICIENTS) {
      // 纯根式：整数部分恒为 0，见上面 SNAP_SURD_* 的说明。
      const radicand = radicandFrom(input, 0, coefficient, divisor, limit)
      if (radicand === null) continue
      const value = (coefficient * Math.sqrt(radicand)) / divisor
      keep(hit(input, value, { kind: "surd", text: `≈ ${formatQuadraticSurd(0, coefficient, radicand, divisor)}` }, limit, "approximate"))
    }
  }
  return best
}

/**
 * 吸附层：在**常量族**与**常见分数族**里各自找最接近的一个，再取**残差更小**的那个。
 *
 * 为什么不是"常量优先"（第一版就是这么写的，被用例抓出来了）：常量族虽然带更紧，但它仍然会
 * 命中一些"合法但没用"的形式 —— 实测 `2.5001` 被 `2√14/3`（差 0.22%）抢走，而它离 `5/2`
 * 只差 0.004%。按"谁更近谁赢"就不会出现这种抢法：常量想赢必须**真的更近**。
 */
function snapToCommonValue(input: number): ExactFormReading | null {
  const constant = nearestNamedConstant(input, snapLimit(input, SNAP_CONSTANT_RELATIVE_TOLERANCE))
  const fraction = nearestCommonValue(input, snapLimit(input, SNAP_COMMON_RELATIVE_TOLERANCE))
  if (constant && fraction) return fraction.residual! < constant.residual! ? fraction : constant
  return constant ?? fraction
}

/**
 * 三层判据。
 *
 * 1. **精确层**（紧容差，相对 1e-9 + 绝对 1e-12）：这个值**确实**等于那个精确形式 ⇒ 不带 `≈`、
 *    确信度 `exact`。用户口径："坐标是整数或分数时，能够准确计算时，还是保留精度。"
 *    所以手输的 `0.0625` 仍是 `1/16`、`0.66` 仍是 `33/50`，这一层不参与"往常见值靠"。
 * 2. **吸附层**（常见分数 2%、常量族 0.3%，取更近的那个）：手拖动出来的值往**常见整数、分数与
 *    有名常量**（π 的有理倍数、e 的整数倍、纯根式）靠 ⇒ 文本带 `≈`。
 * 3. **兜底**：都不中 ⇒ 两位小数（`≈ 0.64`），**不再出现"未识别为精确形式"**。
 *
 * 显式传了 `tolerance` 时只走精确层（调用方要的是指定精度，不该被自动放宽，也不该被吸附）。
 */
export function exactFormOf(input: number, tolerance?: number): ExactFormReading {
  if (!Number.isFinite(input)) return nonFiniteForm(input)
  const exact = recognise(input, toleranceFor(input, tolerance), false)
  if (exact) return exact
  if (tolerance !== undefined) return decimalFallback(input)
  return snapToCommonValue(input) ?? decimalFallback(input)
}
