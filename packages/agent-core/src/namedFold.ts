import { POINT_NAME_SOURCE, canonicalPointName } from "@draw/geometry-kernel"

/**
 * **同名点的翻折状态**（A3，2026-10-26）。
 *
 * ## 为什么必须有这一层
 *
 * 题面写「沿对角线 AC 把 △ABC 折起」时，**没有给折后的新点名**。可是折后那一点
 * 与折前那一点已经不是同一个位置：
 *
 * - 画面上继续叫 `B` 是对的（用户看到的就是这道题的 B）；
 * - 坐标上必须分成 `B@state0` 与 `B@state1` —— 否则核验会把两个位置当成一个，
 *   或者模型随手写的 `B` 覆盖掉折前的位置。
 *
 * 这一层只做**身份与状态的分离**，不算坐标、不生成动作：
 *
 * ```text
 * entityId   显示名 + 状态   （`B@s0` / `B@s1`，不是合法点名，不会与题面撞）
 * stateId    0 = 折前，1 = 第一次折后
 * displayName 题面/画面上看到的名字
 * ```
 *
 * ## 两种语序都要认（用户与教材都会写）
 *
 * - `沿对角线 AC 把 △ABC 折起。`（**折痕在前**）
 * - `将 △ABC 沿 AC 折起。`（**图形在前**）
 * - 以及显式点名：`…折起至 △AB′C`、`…折起，使点 B 到达点 B′`
 *
 * ## 什么时候**不**产出
 *
 * 折痕两端必须都在折前三角形里（那是"这两点不动"的定义），三角形三个点名必须互不相同。
 * 对不上就返回 `invalid` 并留下原文；**不产出一条半对的折叠**。
 *
 * ## 内部新生名字的避让
 *
 * 需要给折后点一个**显示层面**的新名字时（例如要写进动作的 `apexAs`），
 * `uniqueFoldDisplayName` 会避开题面里已经出现的 `B′` / `B′′` / `B₁`……
 * 但**内部状态永远用 `entityId` 区分**，名字是否相同不影响正确性。
 */

export type StateId = string
export type EntityId = string

export interface SourceSpan {
  start: number
  end: number
  text: string
}

/** 一个"实体 + 状态"的引用。`displayName` 是用户看到的名字。 */
export interface FoldStateRef {
  entityId: EntityId
  stateId: StateId
  displayName: string
}

/** 读出来的状态变换（与动作层无关；动作由构造器按它生成）。 */
export interface NamedFoldTransition {
  id: string
  from: StateId
  to: StateId
  source: SourceSpan
  /** 折痕两端：折前与折后是**同一个位置**，所以两个状态各有一个引用。 */
  hinge: { before: [FoldStateRef, FoldStateRef]; after: [FoldStateRef, FoldStateRef] }
  /** 折片三个顶点：折前与折后。 */
  flap: { before: [FoldStateRef, FoldStateRef, FoldStateRef]; after: [FoldStateRef, FoldStateRef, FoldStateRef] }
  /** 动的那个点（折痕两点不动，剩下的一点动）。 */
  apex: { before: FoldStateRef; after: FoldStateRef }
  angle:
    | { kind: "given"; degrees: number; source: "explicit-degrees" }
    | { kind: "unknown"; parameterId: string }
  /** 折后点的**显示名**：没改名时就是 `apex.displayName`。 */
  displayPostName: string
  /** 内部折后点 id（不是合法点名，不会与题面撞）。 */
  internalPostName: string
  /** 题面是否显式给了折后点名。 */
  explicitPostName: boolean
  syntax: "hinge-first" | "face-first" | "apex-to-point"
}

export type NamedFoldRead =
  | { status: "none" }
  | { status: "invalid"; reason: string; sourceText: string }
  | {
      status: "ok"
      transition: NamedFoldTransition
      face: [string, string, string]
      hingeNames: [string, string]
      apex: string
      /** 折痕是否被明确写成"对角线"。 */
      diagonal: boolean
    }

const POINT = POINT_NAME_SOURCE
const ACTION = "(?:折起|翻起|翻折|折叠)"
const ANGLE = "(?:\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(?:°|度))?"
const TARGET = "(?:\\s*(?:至|成|到)\\s*(?:△|三角形)?\\s*(" + POINT + ")(" + POINT + ")(" + POINT + "))?"
/** 点名串的取词（含弯撇等排版变体，比较前统一归一到 `′`）。 */
const NAME_RUN = /[A-Z](?:[′'’´ʹʼ`]|[₁₂₃₄₅₆]){0,2}/g

const HINGE_FIRST = new RegExp(
  `沿\\s*(对角线\\s*)?(${POINT})(${POINT})\\s*把\\s*(?:△|三角形)?\\s*(${POINT})(${POINT})(${POINT})\\s*${ACTION}${ANGLE}${TARGET}`,
  "g"
)
const FACE_FIRST = new RegExp(
  `(?:将|把)\\s*(?:△|三角形)?\\s*(${POINT})(${POINT})(${POINT})\\s*沿\\s*(对角线\\s*)?(${POINT})(${POINT})\\s*${ACTION}${ANGLE}${TARGET}`,
  "g"
)
const APEX_TO_POINT = new RegExp(
  `(?:将|把)?\\s*(?:△|三角形)?\\s*(${POINT})(${POINT})(${POINT})\\s*沿\\s*(对角线\\s*)?(${POINT})(${POINT})\\s*${ACTION}${ANGLE}\\s*[，,]?\\s*使\\s*点?\\s*(${POINT})\\s*(?:到达|落到|落在|与|到)\\s*(?:点\\s*)?(${POINT})`,
  "g"
)

/** 题面里已经出现的点名（归一后）。 */
export function pointNamesIn(prompt: string): Set<string> {
  return new Set([...prompt.matchAll(NAME_RUN)].map((match) => canonicalPointName(match[0])))
}

/**
 * 给折后点挑一个**题面里没被占用**的显示名：`B′` → `B′′` → `B₁` → `B₂`。
 *
 * 只用于"必须写一个显式名字"的场合（例如动作的 `apexAs`）；内部状态由
 * `entityId` 区分，这个函数**不**参与核验。
 */
export function uniqueFoldDisplayName(prompt: string, base: string): string {
  const taken = pointNamesIn(prompt)
  for (const suffix of ["′", "′′", "₁", "₂", "₃"]) {
    const candidate = `${canonicalPointName(base)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  return `${canonicalPointName(base)}@1`
}

function stateRef(name: string, stateId: StateId): FoldStateRef {
  return { entityId: `${name}@${stateId}`, stateId, displayName: name }
}

function makeTransition(input: {
  face: [string, string, string]
  hinge: [string, string]
  apex: string
  explicitPostName?: string
  angleDegrees?: number
  syntax: NamedFoldTransition["syntax"]
  source: SourceSpan
  offset: number
}): NamedFoldTransition {
  const canonical = (name: string): string => canonicalPointName(name)
  const face = input.face.map(canonical) as [string, string, string]
  const hinge = input.hinge.map(canonical) as [string, string]
  const apex = canonical(input.apex)
  const displayPostName = input.explicitPostName === undefined ? apex : canonical(input.explicitPostName)
  const flapAfter = face.map((name) => (name === apex ? displayPostName : name)) as [string, string, string]
  return {
    id: `fold@${input.offset}`,
    from: "s0",
    to: "s1",
    source: input.source,
    hinge: { before: [stateRef(hinge[0], "s0"), stateRef(hinge[1], "s0")], after: [stateRef(hinge[0], "s1"), stateRef(hinge[1], "s1")] },
    flap: {
      before: [stateRef(flapAfter[0] === displayPostName ? apex : flapAfter[0], "s0"), stateRef(flapAfter[1] === displayPostName ? apex : flapAfter[1], "s0"), stateRef(flapAfter[2] === displayPostName ? apex : flapAfter[2], "s0")],
      after: [stateRef(flapAfter[0], "s1"), stateRef(flapAfter[1], "s1"), stateRef(flapAfter[2], "s1")]
    },
    apex: { before: stateRef(apex, "s0"), after: stateRef(displayPostName, "s1") },
    angle: input.angleDegrees === undefined
      ? { kind: "unknown", parameterId: "foldAngle" }
      : { kind: "given", degrees: input.angleDegrees, source: "explicit-degrees" },
    displayPostName,
    internalPostName: `${displayPostName}@s1`,
    explicitPostName: input.explicitPostName !== undefined,
    syntax: input.syntax
  }
}

/**
 * **题面里有几笔折起**（2026-10-27）：同一组句型扫一遍、按**起点**去重 —— 一条从句可能同时
 * 被两种语序命中（`沿 AC 把 △ABC 折起` 与 `将 △ABC 沿 AC 折起` 是两种，不会同时命中同一段），
 * 但**同一个起点**只算一次。
 *
 * 为什么需要它：`readNamedFold` 只返回**第一笔**（它是单折的读取器）。连续折起的题面
 * 若直接用它会**静默丢掉第二笔** —— 那正是本仓最不能接受的一类：图少画一笔、报告却是干净的。
 * 有了这个计数，调用方可以明确选择"支持"或"如实拒绝"。
 */
export function countNamedFolds(prompt: string): number {
  const starts = new Set<number>()
  for (const pattern of [HINGE_FIRST, FACE_FIRST, APEX_TO_POINT]) {
    for (const match of prompt.matchAll(pattern)) starts.add(match.index)
  }
  return starts.size
}

/** 题面里**每一笔**折起的原文片段（按出现顺序），给"不支持"的说明用。 */
export function namedFoldSpans(prompt: string): string[] {
  const byStart = new Map<number, string>()
  for (const pattern of [HINGE_FIRST, FACE_FIRST, APEX_TO_POINT]) {
    for (const match of prompt.matchAll(pattern)) {
      if (!byStart.has(match.index)) byStart.set(match.index, match[0])
    }
  }
  return [...byStart.entries()].sort((left, right) => left[0] - right[0]).map((entry) => entry[1])
}

/**
 * 读出一条翻折：折痕、折片、动的点、折角，以及**内部状态引用**。
 *
 * 三种语序都归一到同一份结构；读不出（折痕不在折片上、点名重复、残缺）就返回
 * `invalid` 并留下原文 —— 不猜、不产出半对的一条。
 */
type FoldHit = { index: number; match: RegExpExecArray; syntax: NamedFoldTransition["syntax"] }

/**
 * **题面里每一笔折起的命中**，按出现顺序，且**互不重叠**。
 *
 * 去重是必要的：一条从句可能同时被两种语序的句型各命中一次（同一段文字从不同起点算起），
 * 不去重就会把"一笔"数成两笔 —— 连续折叠的守卫会因此误拒，链式读取会读出一笔假的第二折。
 */
function collectFoldHits(prompt: string): FoldHit[] {
  const hits: FoldHit[] = []
  for (const match of prompt.matchAll(HINGE_FIRST)) hits.push({ index: match.index, match, syntax: "hinge-first" })
  for (const match of prompt.matchAll(FACE_FIRST)) hits.push({ index: match.index, match, syntax: "face-first" })
  for (const match of prompt.matchAll(APEX_TO_POINT)) hits.push({ index: match.index, match, syntax: "apex-to-point" })
  hits.sort((left, right) => left.index - right.index)
  const kept: FoldHit[] = []
  for (const hit of hits) {
    const end = hit.index + hit.match[0].length
    if (kept.some((other) => hit.index < other.index + other.match[0].length && other.index < end)) continue
    kept.push(hit)
  }
  return kept
}

/** 把一条命中解析成一条折起（读不出就 `invalid`，带原文）。 */
function foldFromHit(first: FoldHit): NamedFoldRead {
  const sourceText = first.match[0]
  const span: SourceSpan = { start: first.index, end: first.index + sourceText.length, text: sourceText }

  const groups = first.match
  let faceRaw: [string, string, string]
  let hingeRaw: [string, string]
  let diagonal: boolean
  let explicitPostName: string | undefined
  let angleRaw: string | undefined
  if (first.syntax === "hinge-first") {
    diagonal = groups[1] !== undefined
    hingeRaw = [groups[2]!, groups[3]!]
    faceRaw = [groups[4]!, groups[5]!, groups[6]!]
    angleRaw = groups[7]
    const target = [groups[8], groups[9], groups[10]].filter((entry): entry is string => entry !== undefined)
    if (target.length === 3) {
      const remaining = target.map(canonicalPointName).filter((name) => !hingeRaw.map(canonicalPointName).includes(name))
      if (remaining.length !== 1) return { status: "invalid", reason: "折后三角形的点名与折痕对不上（折痕两端必须不动）。", sourceText }
      explicitPostName = remaining[0]
    }
  } else if (first.syntax === "face-first") {
    faceRaw = [groups[1]!, groups[2]!, groups[3]!]
    diagonal = groups[4] !== undefined
    hingeRaw = [groups[5]!, groups[6]!]
    angleRaw = groups[7]
    const target = [groups[8], groups[9], groups[10]].filter((entry): entry is string => entry !== undefined)
    if (target.length === 3) {
      const remaining = target.map(canonicalPointName).filter((name) => !hingeRaw.map(canonicalPointName).includes(name))
      if (remaining.length !== 1) return { status: "invalid", reason: "折后三角形的点名与折痕对不上（折痕两端必须不动）。", sourceText }
      explicitPostName = remaining[0]
    }
  } else {
    faceRaw = [groups[1]!, groups[2]!, groups[3]!]
    diagonal = groups[4] !== undefined
    hingeRaw = [groups[5]!, groups[6]!]
    angleRaw = groups[7]
    const apexName = canonicalPointName(groups[8]!)
    const postName = canonicalPointName(groups[9]!)
    if (!faceRaw.map(canonicalPointName).includes(apexName)) {
      return { status: "invalid", reason: `题面说动的是点 ${apexName}，它不在折片 ${faceRaw.join("")} 上。`, sourceText }
    }
    explicitPostName = postName
  }

  const face = faceRaw.map(canonicalPointName)
  const hinge = hingeRaw.map(canonicalPointName)
  if (new Set(face).size !== 3) return { status: "invalid", reason: `折片点名有重复（${faceRaw.join("")}）。`, sourceText }
  if (new Set(hinge).size !== 2) return { status: "invalid", reason: `折痕点名有重复（${hingeRaw.join("")}）。`, sourceText }
  if (!hinge.every((name) => face.includes(name))) {
    return { status: "invalid", reason: `折痕 ${hinge.join("")} 的两端必须都在折片 ${face.join("")} 上（那是"这两点不动"的定义）。`, sourceText }
  }
  const apex = face.find((name) => !hinge.includes(name))
  if (apex === undefined) return { status: "invalid", reason: "折片上找不到会动的那个点。", sourceText }
  if (explicitPostName !== undefined && explicitPostName === apex) {
    return { status: "invalid", reason: `折后点名与折前相同（${apex}），无法区分两个位置。`, sourceText }
  }

  const angleValue = angleRaw === undefined ? undefined : Number(angleRaw)
  const angleDegrees = angleValue !== undefined && Number.isFinite(angleValue) && angleValue > 0 && angleValue < 360 ? angleValue : undefined
  const transition = makeTransition({
    face: faceRaw,
    hinge: hingeRaw,
    apex,
    ...(explicitPostName === undefined ? {} : { explicitPostName }),
    ...(angleDegrees === undefined ? {} : { angleDegrees }),
    syntax: first.syntax,
    source: span,
    offset: first.index
  })
  return { status: "ok", transition, face: faceRaw.map(canonicalPointName) as [string, string, string], hingeNames: hingeRaw.map(canonicalPointName) as [string, string], apex, diagonal }
}

/**
 * 读出一条翻折（**第一笔**）：折痕、折片、动的点、折角，以及**内部状态引用**。
 *
 * 三种语序都归一到同一份结构；读不出（折痕不在折片上、点名重复、残缺）就返回
 * `invalid` 并留下原文 —— 不猜、不产出半对的一条。
 *
 * 连续折起请看 `readNamedFolds`：这个入口只给第一笔（单折那条路的既有语义）。
 */
export function readNamedFold(prompt: string): NamedFoldRead {
  const hits = collectFoldHits(prompt)
  if (hits.length === 0) return { status: "none" }
  return foldFromHit(hits[0]!)
}

/**
 * **每一笔**折起（按出现顺序，互不重叠）。`invalid` 的条目也照原样返回 ——
 * 由调用方决定"第二笔读不出"算不算阻断（连续折叠这一层是**必须阻断**的）。
 */
export function readNamedFolds(prompt: string): NamedFoldRead[] {
  return collectFoldHits(prompt).map(foldFromHit)
}
