/** 题设来自用户原话而不是模型的 relations 声明。只读有确定点名的窄句型。 */
export type DiagramObligationKind =
  | "fixedLength" | "equilateral" | "equalLength" | "midpoint" | "segmentRatio"
  | "planePerpendicular" | "dihedral" | "perpendicular" | "parallel" | "pointCoordinate"
  | "conicAxes"
  | "tangentAt"
  | "functionGraph"

/**
 * 题面写下的圆锥曲线参数。
 *
 * 只收**方程直接给出的**那一组：`x²/9+y²/4=1` ⇒ 沿 x 的半轴 3、沿 y 的半轴 2。
 * 焦点位置**不单独存** —— 它由这两个半轴决定（`c = √(a² − b²)`），
 * 存第二份就会多出一个可能与第一份打架的来源。
 */
export interface DiagramConicStated {
  kind: "ellipse"
  radiusX: number
  radiusY: number
}

export interface DiagramObligation {
  kind: DiagramObligationKind
  sourceText: string
  start: number
  end: number
  targets: string[]
  value?: number
  planeLengths?: [number, number]
  coordinate?: { x: number; y: number; z: number }
  conic?: DiagramConicStated
  /** 题面写下的函数表达式（**已规范化**：上标转 `^`、隐式乘号补 `*`）。 */
  expression?: string
}

export interface DiagramSourceSpan {
  sourceText: string
  start: number
  end: number
}

export interface DiagramObligationSet {
  givens: DiagramObligation[]
  goals: string[]
  /** Optional for legacy/manual sets; parsed prompts carry exact original text and offsets. */
  goalSources?: DiagramSourceSpan[]
  freeChoices: string[]
  freeChoiceSources?: (DiagramSourceSpan & { name: string })[]
  unverified: { sourceText: string; reason: string }[]
}

interface Matcher {
  pattern: RegExp
  read: (match: RegExpExecArray) => Pick<DiagramObligation, "kind" | "targets" | "value" | "planeLengths" | "coordinate" | "conic"> | null
}

export interface DiagramParseOptions { spatialPointConditions?: boolean }

/** Only the explicit V0a experimental path recognizes these narrow 3D coordinates. */
const POINT_COORDINATE_MATCHER: Matcher = {
  pattern: /([A-Z])\s*=\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g,
  read: (match) => {
    const values = match.slice(2, 5).map(Number)
    return values.every(Number.isFinite)
      ? { kind: "pointCoordinate", targets: [match[1]], coordinate: { x: values[0], y: values[1], z: values[2] } }
      : null
  }
}

const names = (value: string): string[] => [...value]
const finitePositive = (value: string): number | null => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

/**
 * 从方程的分母还原半轴：`x²/9 + y²/4 = 1` 的分母是**半轴的平方**（`a²` / `b²`），
 * 所以半轴是 `√9 = 3` 与 `√4 = 2`。**直接拿分母当半轴是错的**，而那个错误看起来完全合理 ——
 * 实测就是这么错的：`(9, 4)` 被当成半轴报了出去，直到用例把正确答案摆出来才发现。
 *
 * 分母必须是有限正数：`x²/0+y²/4=1` 不是椭圆，`x²/-1+…` 更不是 —— 一律不认，交回未核验。
 */
function ellipseAxes(denominatorX: number, denominatorY: number): Pick<DiagramObligation, "kind" | "targets" | "conic"> | null {
  if (!Number.isFinite(denominatorX) || !Number.isFinite(denominatorY) || denominatorX <= 0 || denominatorY <= 0) return null
  return { kind: "conicAxes", targets: [], conic: { kind: "ellipse", radiusX: Math.sqrt(denominatorX), radiusY: Math.sqrt(denominatorY) } }
}

/**
 * **把题面写的表达式整理成表达式解析器认得的写法**（V0d）。
 *
 * 教科书里写 `x³ − 3x`，而解析器只认 `x^3-3*x`。这一步只做**纯字形替换**，
 * 不做任何数学变形 —— 因为一旦开始"化简"，判据就不再是"图是不是题面那条曲线"，
 * 而是"我的化简对不对"了。
 *
 * 隐式乘号**只补 `数字×x` 这一种**（`3x` → `3*x`）。不补宽：`log10(x)` 里那个 `0(`
 * 一旦被当成乘法，表达式就悄悄变了意思 —— 宁可让不认识的写法落回"未核验"。
 */
function normalizeStatedExpression(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  const normalized = trimmed
    .replace(/²/g, "^2").replace(/³/g, "^3").replace(/⁴/g, "^4")
    .replace(/[−–—]/g, "-")
    .replace(/[×·⋅]/g, "*")
    .replace(/(\d)\s*x/g, "$1*x")
  return normalized.length === 0 ? null : normalized
}

/**
 * 更具体的模式排在普通等号/垂直之前，避免截取比例式或面-面句式的一部分。
 *
 * **导出而不是私有**：Phase N1 的 IR 要用**同一张表**给"求证段"里的目标句定种类
 *（`求证 OA⊥CD` → `perpendicular`）。让 IR 自己再写一套匹配规则，两份规则必然分叉，
 * 而分叉的症状是"题设认平行、目标认垂直"这种最难查的错。
 */
export const DIAGRAM_OBLIGATION_MATCHERS: readonly Matcher[] = [
  /**
   * **椭圆的方程**：`x²/9 + y²/4 = 1`（`x^2` 那种写法也收）。
   *
   * 为什么必须认它、而不是留给"未核验"：方程里带 `=`，而下面的残留扫描把**带 `=` 的整句**
   * 一律标成未核验 —— 不认它，用户每次都会看到一句"尚未被可靠解析"。认了它，判据才有东西可量。
   *
   * 两条分开写、而不是一条带分支：`x²/a² + y²/b² = 1` 与 `y²/b² + x²/a² = 1` 说的是**同一条曲线**，
   * 但半轴分别落在哪个轴上不同。合成一条会让"读哪一组"变成第二个判断。
   */
  {
    pattern: /x\s*(?:\^2|²)\s*\/\s*(\d+(?:\.\d+)?)\s*\+\s*y\s*(?:\^2|²)\s*\/\s*(\d+(?:\.\d+)?)\s*=\s*1/g,
    read: (m) => ellipseAxes(Number(m[1]), Number(m[2]))
  },
  {
    pattern: /y\s*(?:\^2|²)\s*\/\s*(\d+(?:\.\d+)?)\s*\+\s*x\s*(?:\^2|²)\s*\/\s*(\d+(?:\.\d+)?)\s*=\s*1/g,
    read: (m) => ellipseAxes(Number(m[2]), Number(m[1]))
  },
  /**
   * **在某点处的切线**：`在 x=1 处的切线`。
   *
   * 这条 obligation 只记**横坐标**，斜率一个字都不记 —— 因为它不由题面给出，而由函数决定。
   * 判据也不读图元里存的那个 `slope`（那是内核自己填的，拿它当判据就是拿系统自证），
   * 而是由核验器**自己对该函数数值求导**再比。详见 `diagramVerification` 的 `tangentAt` 分支。
   */
  {
    pattern: /x\s*=\s*(-?\d+(?:\.\d+)?)\s*处[^，,。；;\n]{0,4}的?切线/g,
    read: (m) => {
      const x = Number(m[1])
      return Number.isFinite(x) ? { kind: "tangentAt", targets: [], value: x } : null
    }
  },
  /**
   * **函数定义**：`f(x)=x³−3x`。
   *
   * 为什么必须认它，而不是留给"未核验"：题面里这一句带 `=`，而残留扫描把**带 `=` 的整句**
   * 一律标成未核验 —— 不认它，用户每次都会看到一句"尚未被可靠解析"，
   * 而他真正想知道的是"画出来的曲线是不是这条函数"。
   *
   * 捕获到的是**非中文、非标点**的一段，再交给 `normalizeStatedExpression` 整理字形。
   * 这样 `f(x) = x^3 - 3x`（带空格）与 `f(x)=x³−3x`（上标紧凑）都能收。
   */
  {
    // 末位要求"非空白**且非中文**"：`\S` 不够 —— 中文的"的"也不是空白，会被它吃掉。
    // 否则 `match[0]`（也就是报告里的 `sourceText`）会变成 `f(x)=x³−3x 的`，
    // 而题面引文多一个字，用户在报告里看不出来，只会让断言莫名其妙地失败。
    pattern: /f\s*\(\s*x\s*\)\s*=\s*([^，,。；;\u4e00-\u9fff]*[^，,。；;\u4e00-\u9fff\s])/g,
    read: (m) => {
      const expression = normalizeStatedExpression(m[1])
      return expression === null ? null : { kind: "functionGraph", targets: [], expression }
    }
  },  {
    pattern: /二面角\s*([A-Z])\s*[-−]\s*([A-Z])([A-Z])\s*[-−]\s*([A-Z])\s*=\s*(\d+(?:\.\d+)?)\s*°/g,
    read: (m) => { const value = finitePositive(m[5]); return value === null || value >= 180 ? null : { kind: "dihedral", targets: m.slice(1, 5), value } }
  },
  {
    pattern: /平面\s*([A-Z]{3,4})\s*(?:⊥|垂直于?)\s*平面\s*([A-Z]{3,4})/g,
    read: (m) => ({ kind: "planePerpendicular", targets: [...names(m[1]), ...names(m[2])], planeLengths: [m[1].length, m[2].length] })
  },
  {
    pattern: /(?:△|三角形)\s*([A-Z]{3})\s*(?:为|是)?\s*等边三角形/g,
    read: (m) => ({ kind: "equilateral", targets: names(m[1]) })
  },
  {
    pattern: /([A-Z])\s*(?:为|是)\s*([A-Z]{2})\s*的?\s*中点/g,
    read: (m) => ({ kind: "midpoint", targets: [m[1], ...names(m[2])] })
  },
  {
    pattern: /([A-Z]{2})\s*=\s*(\d+(?:\.\d+)?)\s*([A-Z]{2})(?![A-Z])/g,
    read: (m) => { const value = finitePositive(m[2]); return value === null ? null : { kind: "segmentRatio", targets: [...names(m[1]), ...names(m[3])], value } }
  },
  {
    pattern: /([A-Z]{2})\s*=\s*(\d+(?:\.\d+)?)(?![\d.A-Z])/g,
    read: (m) => { const value = finitePositive(m[2]); return value === null ? null : { kind: "fixedLength", targets: names(m[1]), value } }
  },
  {
    pattern: /([A-Z]{2})\s*(?:与|和)\s*([A-Z]{2})\s*(?:长度相等|线段相等|边相等|等长)/g,
    read: (m) => ({ kind: "equalLength", targets: [...names(m[1]), ...names(m[2])] })
  },  {
    pattern: /([A-Z]{2})\s*=\s*([A-Z]{2})(?![A-Z])/g,
    read: (m) => ({ kind: "equalLength", targets: [...names(m[1]), ...names(m[2])] })
  },
  {
    pattern: /([A-Z]{2})\s*(⊥|∥|垂直于?|平行于?)\s*平面\s*([A-Z]{3,4})/g,
    read: (m) => ({ kind: m[2].includes("平行") || m[2] === "∥" ? "parallel" : "perpendicular", targets: [...names(m[1]), ...names(m[3])] })
  },
  {
    pattern: /([A-Z]{2})\s*(⊥|∥|垂直于?|平行于?)\s*([A-Z]{2})(?![A-Z])/g,
    read: (m) => ({ kind: m[2].includes("平行") || m[2] === "∥" ? "parallel" : "perpendicular", targets: [...names(m[1]), ...names(m[3])] })
  }
]

const UNREAD_CONDITION = /∠\s*[A-Z]{3}\s*=\s*\d+(?:\.\d+)?\s*°|[A-Z]{2}\s*[:：]\s*[A-Z]{2}\s*=\s*\d+(?:\.\d+)?|[A-Z]{2}\s*=\s*-?\d+(?:\.\d+)?/g

export function parseDiagramObligations(prompt: string, options: DiagramParseOptions = {}): DiagramObligationSet {
  const boundary = /(?:求证|证明)/.exec(prompt)
  const givenText = boundary === null ? prompt : prompt.slice(0, boundary.index)
  const goalRawStart = boundary === null ? -1 : boundary.index + boundary[0].length
  const goalRaw = goalRawStart < 0 ? "" : prompt.slice(goalRawStart)
  const prefixLength = /^[：:，,\s]*/.exec(goalRaw)?.[0].length ?? 0
  const goalText = goalRaw.slice(prefixLength).trim()
  const goals = goalText ? [goalText] : []
  const goalSources: DiagramSourceSpan[] = goalText ? [{ sourceText: goalText, start: goalRawStart + prefixLength, end: goalRawStart + prefixLength + goalText.length }] : []
  const freeChoiceSources: (DiagramSourceSpan & { name: string })[] = []
  const namedChoices = new Set<string>()
  for (const match of givenText.matchAll(/(?:任取|任意|自由)(?:一?个)?\s*点\s*([A-Z])/g)) {
    const name = match[1]
    if (namedChoices.has(name)) continue
    namedChoices.add(name)
    freeChoiceSources.push({ name, sourceText: match[0], start: match.index, end: match.index + match[0].length })
  }
  const freeChoices = freeChoiceSources.map(({ name }) => name)
  const givens: DiagramObligation[] = []
  const unverified: DiagramObligationSet["unverified"] = []
  const used = new Set<number>()

  const matchers = options.spatialPointConditions === true ? [POINT_COORDINATE_MATCHER, ...DIAGRAM_OBLIGATION_MATCHERS] : DIAGRAM_OBLIGATION_MATCHERS
  for (const { pattern, read } of matchers) {
    for (const match of givenText.matchAll(pattern)) {
      const start = match.index
      const end = start + match[0].length
      // A suffix of ∠ABC=60° is not the segment condition BC=60.
      if (start > 0 && /[A-Z∠:：]/.test(givenText[start - 1])) continue
      const next = /^\s*(\S)/.exec(givenText.slice(end))?.[1]
      if (next && /[A-Z°+*/√π^%]/.test(next)) continue
      if (Array.from({ length: end - start }, (_, offset) => start + offset).some((at) => used.has(at))) continue
      const result = read(match)
      // 圆锥曲线、切线、函数定义与点坐标都**不带点名**：它们自己就是被核验的对象，不能拿"至少两个名字"去卡。
      if (result === null || (result.kind !== "pointCoordinate" && result.kind !== "conicAxes" && result.kind !== "tangentAt" && result.kind !== "functionGraph" && new Set(result.targets).size < 2)) continue
      givens.push({ ...result, sourceText: match[0], start, end })
      for (let at = start; at < end; at++) used.add(at)
    }
  }

  for (const match of givenText.matchAll(UNREAD_CONDITION)) {
    if ([...match[0]].some((_, offset) => used.has(match.index + offset))) continue
    /**
       * **引「整句」，不引「第一个词」**（2026-10-05 修）。
       *
       * 原来是 `/^[^，,。；;\s]+/` —— 只取到第一个空白为止。于是 `∠ABC=60°`（**无空格**）拿到整条，
       * 而 `∠PAB = 60°`（**有空格**）只拿到 `∠PAB`、`sin∠PAB = 0.5` 只拿到 `AB`、`AB:AD = 1:2`
       * 只拿到 `AB:AD` —— **值全被截掉**。
       *
       * 为什么这是**用户可见的缺陷**而不是内部细节：`diagramVerification.ts` 把 residue 的
       * `sourceText` **原样**变成核验 check 的文案，而那条 check 会出现在用户的"题设尚未核验"列表里。
       * 用户看到的是"**∠PAB 没核验**" —— 条件本身没显示出来。
       *
       * 为什么此前没被发现：既有用例用的是 `∠ABC=60°`（**无空格**）那位，它一直是对的；
       * **缺陷正好藏在"带空格的写法"那一侧**，而那是用户随手就会打出来的形状。
       */
      const clause = [...givenText.matchAll(/[^，,。；;\n]+/g)]
        .find((entry) => (entry.index ?? 0) <= match.index && match.index < (entry.index ?? 0) + entry[0].length)
      const sourceText = clause?.[0].trim() ?? match[0]
    unverified.push({ sourceText, reason: "这个条件没有被可靠解析或数值非法，未核验。" })
  }

  if (options.spatialPointConditions === true) {
    // A bare A(0,0,0) has no equals sign; clause scanning splits on commas,
    // so capture the whole tuple before it can silently disappear in three pieces.
    for (const match of givenText.matchAll(/[A-Z]\s*\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/g)) {
      if ([...match[0]].some((_, offset) => used.has(match.index + offset))) continue
      unverified.push({ sourceText: match[0], reason: "这个点的坐标写法尚未可靠解析，未核验。" })
    }
  }

  // Scan the portions no reliable matcher consumed. A new textbook notation must
  // become visible as unverified, not silently turn a non-empty problem into an empty pass.
  for (const clause of givenText.matchAll(/[^，,。；;\n]+/g)) {
    if (unverified.some((entry) => clause[0].includes(entry.sourceText))) continue
    const leftover = [...clause[0]].map((character, offset) => used.has(clause.index + offset) ? " " : character).join("").trim()
    const unknownPointCondition = options.spatialPointConditions === true
      && (/[A-Z]\s*\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/.test(leftover)
        || /[A-Z]\s*(?:在|位于)[^，,。；;\n]{0,30}(?:上方|下方)/.test(leftover))
    if (/[=⊥∥]|二面角|等边|等长|长度相等|线段相等|边相等|相等|中点|垂直|平行|共面|之比|比值|比例|共线|(?:点?[A-Z]\s*在\s*平面)/.test(leftover) || unknownPointCondition) {
      unverified.push({ sourceText: leftover, reason: "原题出现了尚未被可靠解析的几何条件，未核验。" })
    }
  }
  givens.sort((left, right) => left.start - right.start)
  return { givens, goals, ...(goalSources.length ? { goalSources } : {}), freeChoices, ...(freeChoiceSources.length ? { freeChoiceSources } : {}), unverified }
}
