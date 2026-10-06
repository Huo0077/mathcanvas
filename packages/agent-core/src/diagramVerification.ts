import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { crossVector3, dihedralAngleDetail3, distanceVector3, dotVector3, lengthVector3, subtractVector3, type Vector3 } from "@draw/geometry-kernel"

import type { PlanEnvelope } from "./contracts"
import type { DiagramObligation, DiagramObligationKind, DiagramObligationSet } from "./diagramObligations"
import { buildObligationIR, type ObligationIR } from "./obligationIR"
import { relationResidual } from "./relations"

export type DiagramCheckStatus = "passed" | "failed" | "unverified"
export interface DiagramCheck {
  kind: DiagramObligationKind | "unparsed"
  sourceText: string
  status: DiagramCheckStatus
  reason: string
  expected?: number
  actual?: number
}
export interface DiagramVerificationReport {
  status: DiagramCheckStatus
  checks: DiagramCheck[]
  sampleValues: string[]
  /**
   * **统一 IR 的同一次解析结果**（Phase N1；设计 §3"任何 UI、Agent trace 都只读这份状态"）。
   *
   * 为什么挂在**这份报告**上，而不是另开一个返回值：现有三处消费点
   *（`planCompiler` 的诊断、`draftStore` 的预览、`ConfirmationPanel` 的展示）
   * 都已经在读这份报告，而报告本身就是"这一批题设核验到了什么"的载体。
   * 另开一条并行通道的代价是"有人读了新通道、有人还在读旧的"，两者一旦分叉就再也说不清
   * 哪一份是真相 —— 这个项目在"同一个判断写了两遍"上已经踩过好几次。
   *
   * 可选：`flags.obligationIR=false` 时**不生成**它（旧路径行为不变，
   * 见 `apps/web/src/agent/featureFlags.ts` 的验收条件）。
   */
  obligationIR?: ObligationIR
}

/**
 * 核验的可选项。
 *
 * **`obligationIR` 必须显式为 `true` 才产出 IR**（控制器裁决 R6）：缺省 / `undefined` / `false`
 * 一律返回**旧形状**的报告 —— 没有那个字段，而不是"值是 undefined"。
 *
 * R6 之前这里是"缺省 `true`"。那样写的代价不是形式问题：生产调用方根本没传过这个参数，
 * 于是开关**事实上从不生效**，"默认关闭的新能力"这条约束在这条路上是空的。
 * 保守方向才是对的：旧路径是缺省，IR 由显式决定产生。
 */
export interface DiagramVerificationOptions {
  obligationIR?: boolean
}

const UNITLESS_TOLERANCE = 1e-6
const ANGLE_TOLERANCE_DEGREES = 1e-3
const distanceTolerance = (value: number): number => Math.max(1e-6, 1e-6 * Math.max(1, value))
const length = (first: Vector3, second: Vector3): number => distanceVector3(first, second)

function candidatePoints(plan: PlanEnvelope, candidate: GeometryDocument, base?: GeometryDocument): Map<string, Vector3> | null {
  if (plan.kind !== "plan") return null
  const actions = plan.actions.filter((action) => action.actionId === "solid.create_polyhedron")
  const priorIds = new Set(base?.primitives.map((primitive) => primitive.id) ?? [])
  const solids = candidate.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "polyhedron3" }> => primitive.type === "polyhedron3" && !priorIds.has(primitive.id))
  // Without a unique solid there is no reliable alias → candidate solid mapping.
  if (actions.length !== 1 || solids.length !== 1) return null
  const input = actions[0].inputs
  if (typeof input !== "object" || input === null || !("vertexNames" in input)) return null
  const names = input.vertexNames
  const solid = solids[0]
  if (!Array.isArray(names) || names.length !== solid.vertexIds.length || !names.every((name) => typeof name === "string" && /^[A-Z]$/.test(name)) || new Set(names).size !== names.length) return null
  const points = new Map<string, Vector3>()
  for (const [index, name] of names.entries()) {
    const vertex = candidate.primitives.find((primitive) => primitive.id === solid.vertexIds[index])
    if (vertex?.type !== "point3") return null
    const position = vertex.position
    if (![position.x, position.y, position.z].every(Number.isFinite)) return null
    points.set(name as string, position)
  }

  /**
   * **再扫一遍带 `label` 的点**（2026-10-05，用户报的现场）。
   *
   * ## 为什么必须有这一步
   *
   * 上面那张表**只**从 `solid.create_polyhedron` 的 `vertexNames` 建。于是**任何由别的动作
   * 创建的点**在核验里**根本不存在** —— 最典型的就是"O 是 BD 的中点"：
   * `dynamic.create_bound_point` 能把 O 精确放到中点（实测坐标就是 (0,0,0)），
   * 但那条题设仍然报"点名缺失…未核验"。**用户看到的错句，根源在这里，不在题面。**
   *
   * ## 三条语义（缺一条就会引入新的静默错误）
   *
   * 1. **顶点名优先**：`vertexNames` 已经定了的名字，标签不许覆盖它；
   * 2. **同名只许一个**：同一个标签出现两次 ⇒ 这个**名字缺失**（依赖它的题设如实未核验）。
   *    这里**不猜** —— 猜一个就等于把"图里有两个 O"这件事静默吞掉；
   * 3. **非单字母标签不进表**：点名的形状是 `[A-Z]`，别的标签（"中点"、"O1"）不是题面点名。
   */
  const labelled = new Map<string, Vector3 | null>()
  for (const primitive of candidate.primitives) {
    if (primitive.type !== "point3") continue
    const label = (primitive as { label?: unknown }).label
    /**
     * **"顶点名优先"只在这一处判**（收集时**不**跳过与顶点同名的标签，只在下面写入时挡）。
     *
     * 原先两处都判过（收集时 `points.has(label) → continue` + 写入时 `!points.has(label)`），
     * 后果是**同一个判断写了两遍**、互为冗余：单点变异改不动行为，
     * 于是那条"顶点名优先"的用例**看着有守卫、实际抓不到任何东西**（试过，变异两次都全绿）。
     * 这与本仓那句"同一个判断不许写两遍"是同一条账。
     */
    if (typeof label !== "string" || !/^[A-Z]$/.test(label)) continue
    const position = primitive.position
    labelled.set(label, labelled.has(label) || ![position.x, position.y, position.z].every(Number.isFinite) ? null : position)
  }
  for (const [label, position] of labelled) {
    if (position !== null && !points.has(label)) points.set(label, position)
  }
  return points
}

function calculate(item: DiagramObligation, points: Map<string, Vector3>): { actual: number; expected: number; tolerance: number } | null {
  const vertices = item.targets.map((name) => points.get(name))
  if (vertices.some((point) => point === undefined)) return null
  const at = (index: number): Vector3 => vertices[index]!
  const numeric = item.value
  if (item.kind === "pointCoordinate") {
    const coordinate = item.coordinate
    if (item.targets.length !== 1 || coordinate === undefined || ![coordinate.x, coordinate.y, coordinate.z].every(Number.isFinite)) return null
    return { actual: length(at(0), coordinate), expected: 0, tolerance: distanceTolerance(1) }
  }
  if (item.kind === "fixedLength") {
    if (numeric === undefined) return null
    return { actual: length(at(0), at(1)), expected: numeric, tolerance: distanceTolerance(numeric) }
  }
  if (item.kind === "equalLength") {
    const first = length(at(0), at(1))
    const second = length(at(2), at(3))
    if (Math.min(first, second) <= 1e-10) return null
    return { actual: second, expected: first, tolerance: distanceTolerance(first) }
  }
  if (item.kind === "equilateral") {
    const ab = length(at(0), at(1))
    const bc = length(at(1), at(2))
    const ca = length(at(2), at(0))
    if (Math.min(ab, bc, ca) <= 1e-10 || lengthVector3(crossVector3(subtractVector3(at(1), at(0)), subtractVector3(at(2), at(0)))) <= 1e-10) return null
    return { actual: Math.max(ab, bc, ca) - Math.min(ab, bc, ca), expected: 0, tolerance: distanceTolerance(ab) }
  }
  if (item.kind === "segmentRatio") {
    if (numeric === undefined) return null
    const [d, e, eAgain, a] = vertices as Vector3[]
    if (e !== eAgain) return null
    const de = length(d, e)
    const ea = length(e, a)
    const da = length(d, a)
    if (ea <= 1e-10 || da <= 1e-10) return null
    // DE=2EA includes E on the segment DA, not merely a coincidental length ratio.
    const segmentGap = Math.abs(de + ea - da)
    if (segmentGap > distanceTolerance(da)) return { actual: segmentGap, expected: 0, tolerance: distanceTolerance(da) }
    return { actual: de / ea, expected: numeric, tolerance: UNITLESS_TOLERANCE }
  }
  if (item.kind === "midpoint") {
    const middle = at(0)
    const average = { x: (at(1).x + at(2).x) / 2, y: (at(1).y + at(2).y) / 2, z: (at(1).z + at(2).z) / 2 }
    if (length(at(1), at(2)) <= 1e-10) return null
    return { actual: length(middle, average), expected: 0, tolerance: distanceTolerance(length(at(1), at(2))) }
  }
  if (item.kind === "planePerpendicular") {
    const firstCount = item.planeLengths?.[0] ?? item.targets.length / 2
    const secondCount = item.planeLengths?.[1] ?? item.targets.length - firstCount
    if (![3, 4].includes(firstCount) || ![3, 4].includes(secondCount) || firstCount + secondCount !== vertices.length) return null
    const normal = (start: number) => crossVector3(subtractVector3(at(start + 1), at(start)), subtractVector3(at(start + 2), at(start)))
    const first = normal(0)
    const second = normal(firstCount)
    const firstMagnitude = lengthVector3(first)
    const secondMagnitude = lengthVector3(second)
    if (Math.min(firstMagnitude, secondMagnitude) <= 1e-10) return null
    if (firstCount === 4 && Math.abs(dotVector3(first, subtractVector3(at(3), at(0)))) / firstMagnitude > distanceTolerance(1)) return null
    if (secondCount === 4 && Math.abs(dotVector3(second, subtractVector3(at(firstCount + 3), at(firstCount)))) / secondMagnitude > distanceTolerance(1)) return null
    return { actual: Math.abs(dotVector3(first, second)) / (firstMagnitude * secondMagnitude), expected: 0, tolerance: UNITLESS_TOLERANCE }
  }
  if (item.kind === "dihedral") {
    if (numeric === undefined) return null
    const [e, b, c, d] = vertices as Vector3[]
    const detail = dihedralAngleDetail3([b, c, e], [b, c, d], b, c)
    return detail === null ? null : { actual: detail.interiorDegrees, expected: numeric, tolerance: ANGLE_TOLERANCE_DEGREES }
  }
  const kind = item.kind === "perpendicular" ? "perpendicular" : "parallel"
  // A plane can be named by four vertices: check coplanarity of the fourth,
  // then use the three-point plane expected by the existing line-plane residual.
  if (vertices.length === 6) {
    const origin = at(2)
    const normal = crossVector3(subtractVector3(at(3), origin), subtractVector3(at(4), origin))
    const magnitude = lengthVector3(normal)
    if (magnitude <= 1e-10 || Math.abs(dotVector3(normal, subtractVector3(at(5), origin))) / magnitude > distanceTolerance(1)) return null
  }
  const checkedTargets = vertices.length === 6 ? item.targets.slice(0, 5) : item.targets
  const residual = relationResidual({ kind, targets: checkedTargets.map((vertex) => ({ vertex })) }, (target) => points.get(target.vertex) ?? null)
  return residual === null ? null : { actual: residual, expected: 0, tolerance: UNITLESS_TOLERANCE }
}

export function verifyDiagramObligations(set: DiagramObligationSet, plan: PlanEnvelope, candidate: GeometryDocument, base?: GeometryDocument, options: DiagramVerificationOptions = {}): DiagramVerificationReport {
  const points = candidatePoints(plan, candidate, base)
  const checks: DiagramCheck[] = set.givens.map((item) => {
    if (points === null) return { kind: item.kind, sourceText: item.sourceText, status: "unverified", reason: "候选图缺少唯一、可靠的顶点名映射；不能按题面顺序猜坐标。" }
    const result = calculate(item, points)
    if (result === null) return { kind: item.kind, sourceText: item.sourceText, status: "unverified", reason: "点名缺失、图形退化或角度无法计算，未核验。" }
    const status = Math.abs(result.actual - result.expected) <= result.tolerance ? "passed" : "failed"
    return { kind: item.kind, sourceText: item.sourceText, status, reason: status === "passed" ? "已按候选图坐标核验。" : `实测 ${result.actual.toPrecision(5)}，题设要求 ${result.expected}。`, expected: result.expected, actual: result.actual }
  })
  checks.push(...set.unverified.map((entry): DiagramCheck => ({ kind: "unparsed", sourceText: entry.sourceText, status: "unverified", reason: entry.reason })))
  const sampleValues: string[] = []
  for (const name of set.freeChoices) {
    const point = points?.get(name)
    if (!point) checks.push({ kind: "unparsed", sourceText: `自由点 ${name}`, status: "unverified", reason: "此自由点未能对应候选图中的点名。" })
    else sampleValues.push(`自由点 ${name} 采用示例坐标 (${point.x}, ${point.y}, ${point.z})`)
  }
  if (checks.length === 0) checks.push({ kind: "unparsed", sourceText: "题设", status: "unverified", reason: "没有可靠识别到可核验的题设，不能用空报告宣布全部通过。" })
  const status = checks.some((entry) => entry.status === "failed") ? "failed" : checks.some((entry) => entry.status === "unverified") ? "unverified" : "passed"
  return {
    status,
    checks,
    sampleValues,
    ...(options.obligationIR === true ? { obligationIR: buildObligationIR(set) } : {})
  }
}
