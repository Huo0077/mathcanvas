import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { compileExpression, conicResidualAt, crossVector3, dihedralAngleDetail3, differentiabilityAt, distanceVector3, dotVector3, evaluateExpression, functionGraphEvidence, functionLineRoots, commonTangents, intersectLineWithConic, isPointName, judgeUniversalClaim, lengthVector3, ratioParameterFor, subtractVector3, verifyTangentLine, type EvidenceGrade, type PlanarConic, type Vector3 } from "@draw/geometry-kernel"
import { foldVertexNames } from "@draw/scene-graph"

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
  /**
   * **这条读数是怎么来的**（Task 15）：函数族的判据必须把证据等级写出来，
   * 因为"采样折线上的比较"（`plot-only`）与"独立数值求导 + 回代"（`verified-numeric`）
   * 是两种完全不同的可信度，混成一个 `passed` 就等于把它们拉平了。
   */
  evidence?: EvidenceGrade
}
export interface DiagramVerificationReport {
  status: DiagramCheckStatus
  checks: DiagramCheck[]
  sampleValues: string[]
  /**
   * **这一轮核验的证据范围**（Task 15）。
   *
   * `figure-instance`：核的是一个图形实例；`parameter-instance`：图上还带了参数取值。
   * 两者都**不是**全称结论 —— 这个字段存在的意义就是让下游没法把"图上成立"
   * 悄悄读成"对所有参数成立"。
   */
  proofScope: "figure-instance" | "parameter-instance"
  /**
   * 全称主张的证据状态。今天**只有** `"not-proven"` 这一个取值：
   * 几何作图是数值/图形证据，本仓没有把它升级成形式证明的证据链。
   */
  universalClaims: "not-proven"
  /** 上面那条范围的人话解释（含"只核验了哪些参数取值"）。 */
  proofScopeNote: string
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

/**
 * **折那一笔的名字换算**：把 `vertexNames` 里被带走的那个（`apex`）改成 `apexAs`。
 *
 * 入参来自传输层（`unknown`），所以这里只做**形状**判断：读不出来返回 `undefined`，
 * 由调用方照旧把整张表判为"映射不可靠"——**不猜**。
 * 真正的换算规则在 `foldVertexNames`（编译器用的也是它），这里只是把它接到松类型的入参上。
 */
function foldedNamesOf(input: Record<string, unknown>): unknown {
  const { vertexNames, apex, apexAs } = input
  if (!Array.isArray(vertexNames) || typeof apex !== "string" || typeof apexAs !== "string") return undefined
  if (!vertexNames.every((name) => typeof name === "string")) return undefined
  return foldVertexNames(vertexNames as string[], apex, apexAs)
}

/**
 * **名字表对不上时，说清是哪个名字**（2026-10-15 用户现场）。
 *
 * 现场读数只说了"给了 3 个名字、面有 3 个顶点" —— 个数相等，所以那句话**指不出真凶**。
 * 复现出来的真因是**模型把撇写成弯撇** `C’`（U+2019），不在点名字母表里。
 * 所以这里把"非法"与"重复"分别点名出来（非法的那几个连字形一起给），
 * 下一个人一眼就能看出是字符问题还是重名问题。
 */
function nameTableProblem(names: unknown, expected: number, kind: string): string {
  const given = Array.isArray(names) ? names.length : "非数组"
  const head = `给了 ${given} 个名字、${kind}有 ${expected} 个顶点`
  if (!Array.isArray(names)) return `${head}（\`vertexNames\` 不是数组）`
  const seen = new Set<string>()
  const invalid: string[] = []
  const duplicated: string[] = []
  for (const name of names) {
    if (typeof name !== "string" || !isPointName(name)) {
      invalid.push(typeof name === "string" ? name : String(name))
      continue
    }
    if (seen.has(name)) duplicated.push(name)
    seen.add(name)
  }
  return [
    head,
    ...(invalid.length === 0 ? [] : [`**不是合法点名**的是 ${invalid.map((name) => `\`${name}\``).join("、")}（点名 = 一个大写字母 + 至多两个撇/下标；撇的变体在入口处已归一）`]),
    ...(duplicated.length === 0 ? [] : [`**重复**的是 ${duplicated.map((name) => `\`${name}\``).join("、")}`])
  ].join("；")
}

/**
 * **候选图的点名表，或者"为什么建不出来"**（2026-10-15 用户现场，四棱锥那道题）。
 *
 * 原先这一层只回 `Map | null`，而 `null` 有**八个**不同的成因（哪一笔动作没带点名、
 * 名字与顶点数不符、顶点不是空间点、计划里有两笔多面体……）。核验层把它们**压成同一句话**
 * ——"候选图缺少唯一、可靠的顶点名映射" —— 于是现场那一轮（用户贴来的读数）根本看不出
 * 该改什么：是该让模型补 `vertexNames`，还是该查为什么有两个立体。
 *
 * 这不是"文案不好看"：核验的失败理由**就是**面板上给用户看的那一列，也是下一个人唯一的线索。
 * 所以每个守卫各自带一句**点名到具体那一栏**的理由（与预算那条报错"点名哪本账、还剩多少"同一条纪律）。
 */
type CandidatePointMap =
  | { readonly ok: true; readonly points: Map<string, Vector3> }
  | { readonly ok: false; readonly reason: string }

function candidatePoints(plan: PlanEnvelope, candidate: GeometryDocument, base?: GeometryDocument): CandidatePointMap {  if (plan.kind !== "plan") return { ok: false, reason: "计划信封不是一份计划（`kind` 不是 `plan`）" }
  const polyhedronActions = plan.actions.filter((action) => action.actionId === "solid.create_polyhedron")
  /**
   * **单面的 `solid.create_polyhedron` 是平面多边形，不是闭合体**（2026-10-17 用户现场）。
   *
   * 兼容 1 个面之后，同一个动作名有两种物化结果：1 个面环 → `face3`，≥4 个面 → `polyhedron3`。
   * 判据必须按**面数**分流，不能按动作名 —— 否则单面计划会被要求“恰好一只新多面体”，
   * 而候选图里只有一只面，点名表当场判成不可靠，题设一条都核不了。
   */
  const faceCountOf = (action: (typeof polyhedronActions)[number]): number => {
    const inputs = action.inputs as unknown as Record<string, unknown> | null
    const faces = inputs?.faces
    return Array.isArray(faces) ? faces.length : 0
  }
  const closedActions = polyhedronActions.filter((action) => faceCountOf(action) !== 1)
  const priorIds = new Set(base?.primitives.map((primitive) => primitive.id) ?? [])
  const solids = candidate.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "polyhedron3" }> => primitive.type === "polyhedron3" && !priorIds.has(primitive.id))
  const points = new Map<string, Vector3>()
  /**
   * **多面体这一支只在计划里真的有它时才跑**（V0b）：平面图形没有 `solid.create_polyhedron`，
   * 若照旧**无条件**要求"恰好一只新多面体"，平面图就永远拿不到点名表 ——
   * 而那正是"平面作图从不进入核验"的机制本身。
   *
   * **多面体在场时的守卫逐字未改**：数量不是恰好一个、或点名表建不出来，仍然返回 `null`。
   * `null` 的含义是"这份候选图没有可靠的点名映射"，与"点名表恰好是空的"是两件事，
   * 混起来会让失败的**理由**变味（前者是映射不可靠，后者是图上没这个点）。
   */
  if (closedActions.length > 0) {
    /**
     * **多只闭合多面体按执行顺序配对**（2026-10-20，联考 `joint-02`）。
     *
     * 原先的守卫是"闭合动作恰好一个、新多面体恰好一只"，多一只就判"说不清题面说的是哪一只"。
     * 现场读数是：两只多面体**都带点名、也都画出来了**（30 个图元），却因为"数量不是一"整题停在未核验。
     *
     * 为什么这里按序配对**不算**"按题面顺序猜坐标"：配的是**计划动作**与它自己物化出来的图元，
     * 而"同一份计划按顺序执行"是本仓一以贯之的规则（`solid.create_segment` 的"先把点建出来"
     * 就是同一条）。题面与图元之间**没有**任何按序猜测：点名仍然只从动作的 `vertexNames` 来。
     *
     * 数量必须相等：任何一笔没物化出来、或额外多出一只，配对就没有依据 —— 照样拒绝。
     * 两张表合并时，**同一个点名指两个顶点**也拒绝（那是题面/计划自己冲突，不能靠合并掩盖）。
     */
    if (closedActions.length !== solids.length) {
      return { ok: false, reason: `计划里有 ${closedActions.length} 笔闭合 \`solid.create_polyhedron\`，候选图里有 ${solids.length} 只新多面体 —— 数量对不上，题面的点名因此对不上图上的顶点` }
    }
    for (const [solidIndex, action] of closedActions.entries()) {
      const solid = solids[solidIndex]!
      const input = action.inputs
      const which = closedActions.length === 1 ? "这一笔多面体" : `第 ${solidIndex + 1} 笔多面体`
      if (typeof input !== "object" || input === null || !("vertexNames" in input)) {
        return { ok: false, reason: `${which}**没有带点名**（\`vertexNames\`）：图上的顶点只有模板编号（\`P1\`…），题面里的点名对不上它` }
      }
      const names = input.vertexNames
      if (!Array.isArray(names) || names.length !== solid.vertexIds.length || !names.every((name) => typeof name === "string" && isPointName(name)) || new Set(names).size !== names.length) {
        return { ok: false, reason: `${which}的 \`vertexNames\` 与它的顶点对不上：${nameTableProblem(names, solid.vertexIds.length, "体")}` }
      }
      for (const [index, name] of names.entries()) {
        const vertex = candidate.primitives.find((primitive) => primitive.id === solid.vertexIds[index])
        if (vertex?.type !== "point3") return { ok: false, reason: `多面体的第 ${index + 1} 个顶点（\`${solid.vertexIds[index]}\`）不是空间点` }
        const position = vertex.position
        if (![position.x, position.y, position.z].every(Number.isFinite)) return { ok: false, reason: `多面体的顶点 ${name} 坐标不是有限数` }
        if (points.has(name as string)) return { ok: false, reason: `${which}的点名 ${name} 与前面那只多面体重复 —— 同一个点名不能指两个顶点` }
        points.set(name as string, position)
      }
    }
  }

  /**
   * **平面多边形这一支**（2026-10-10 用户现场）：`solid.create_face` 物化出来的是一只 `face3`，
   * 点名表与多面体**同一口径** —— `vertexNames` 与 `pointIds` 按下标配对。
   *
   * 与多面体那一支同一条纪律：计划里真有几笔、候选图里就必须有几只**新增**的面；
   * 数量对不上、或点名不可靠，返回 `null`（"映射不可靠"与"图上没这个点"是两件事）。
   */
  /**
   * **产出面的动作**：`solid.create_face` **与** `solid.fold`（2026-10-11 用户现场）。
   *
   * 折也物化出**一只新的 `face3`**。原先这里只认 `create_face`，于是"计划里 1 笔建面 + 1 笔折"
   * 对应"候选图里 **2** 只新面"，下面的数量判据当场对不上 ⇒ 整张表判为不可靠 ⇒
   * 用户看到的是八条题设**全部**报「候选图缺少唯一、可靠的顶点名映射」，
   * 而题面明明每条都读懂了、图也画出来了。**那句话与真实原因无关**。
   */
  const faceActions = plan.actions.flatMap((action) => {
    if (action.actionId === "solid.create_face" || action.actionId === "solid.fold") {
      const input = action.inputs as unknown as Record<string, unknown>
      return [{ input, names: action.actionId === "solid.fold" ? foldedNamesOf(input) : input.vertexNames }]
    }
    /**
     * **单面的 `solid.create_polyhedron` 也是"建面"**（2026-10-17）：它物化出 `face3`，
     * 与 `create_face` 同一口径。但 `vertexNames` 是按**顶点数组**给的，而图上的 `pointIds`
     * 按**面环**排 —— 所以进点名表前必须先按环取下标，否则名字会整体错位（那比缺名字更糟：
     * 它会静默把 A 的坐标说成 B 的）。
     */
    if (action.actionId === "solid.create_polyhedron" && faceCountOf(action) === 1) {
      const input = action.inputs as unknown as Record<string, unknown>
      const declared = input.vertexNames
      const ring = Array.isArray(input.faces) && Array.isArray(input.faces[0]) ? (input.faces[0] as unknown[]) : null
      const names = ring === null ? declared : ring.map((index) => (Array.isArray(declared) ? declared[index as number] : undefined))
      return [{ input, names }]
    }
    return []
  })
  if (faceActions.length > 0) {
    /**
     * **多面体自己的那些面不算**（2026-10-15 用户现场，四棱柱/四棱锥那道题）。
     *
     * 一只 `polyhedron3` 的子对象里**本来就带着它的面**（`faceIds`，类型里是必填的）。
     * 原先这里只按"新出现的 `face3`"数，于是"一笔多面体 + 一笔 `solid.create_face`"
     *（模型为了让 `平面 PAD` 看得见，顺手补的那一笔）恒定撞上 `faces.length !== faceActions.length`
     * —— 判据把多面体的 5 只面也算成"新面片"，读数成了 **6 只新面片 vs 1 笔建面**，
     * 整张点名表于是建不出来，题设一条都核不了（**现场读数就是这样**）。
     * 按归属排除之后，"新面片"才真的等于"由建面/折那几笔产出的面"。
     */
    const ownedFaceIds = new Set(solids.flatMap((solid) => solid.faceIds))
    const faces = candidate.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "face3" }> => primitive.type === "face3" && !priorIds.has(primitive.id) && !ownedFaceIds.has(primitive.id))
    if (faces.length !== faceActions.length) {
      return { ok: false, reason: `计划里有 ${faceActions.length} 笔建面/折，候选图里有 ${faces.length} 只新面片 —— 说不清题面说的是哪一只，题面的点名因此对不上图上的顶点` }
    }
    for (const [faceIndex, entry] of faceActions.entries()) {
      const input = entry.input
      if (typeof input !== "object" || input === null || !("vertexNames" in input)) {
        return { ok: false, reason: "这一笔面片**没有带点名**（`vertexNames`）：图上的顶点只有模板编号，题面里的点名对不上它" }
      }
      /**
       * **折多一层"改名"**：被带走的那个点折后叫 `apexAs`（题面里的 `A` 折完就叫 `P`），
       * 所以表里该出现的是**折后**那个名字。换算用编译器**同一份**规则（`foldVertexNames`）——
       * 在这里另写一遍就是本仓最忌讳的"同一件事两个口径"。
       */
      const names = entry.names
      const face = faces[faceIndex]!
      if (!Array.isArray(names) || names.length !== face.pointIds.length || !names.every((name) => typeof name === "string" && isPointName(name)) || new Set(names).size !== names.length) {
        return { ok: false, reason: `这一笔面片的 \`vertexNames\` 与它的顶点对不上：${nameTableProblem(names, face.pointIds.length, "面")}` }
      }
      for (const [nameIndex, name] of names.entries()) {
        const vertex = candidate.primitives.find((primitive) => primitive.id === face.pointIds[nameIndex])
        if (vertex?.type !== "point3") return { ok: false, reason: `面片的第 ${nameIndex + 1} 个顶点（\`${face.pointIds[nameIndex]}\`）不是空间点` }
        const position = vertex.position
        if (![position.x, position.y, position.z].every(Number.isFinite)) return { ok: false, reason: `面片的顶点 ${name} 坐标不是有限数` }
        points.set(name as string, position)
      }
    }
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
   * 3. **不是点名的标签不进表**：点名 = 一个大写字母 + 可选的撇或下标（内核 `pointNames` 的
   *    **同一份**定义，与解析层共用），别的标签（"中点"、"O1"、"A1"）不是题面点名。
   */
  const labelled = new Map<string, Vector3 | null>()
  for (const primitive of candidate.primitives) {
    /**
     * **2D 与 3D 的点都要收**（V0b）：`point3` 自带 `position`，平面 `point` 用 `x`/`y`。
     * 平面点补上 `z = 0` 之后交给**同一套**判据 —— 平面题的垂直/平行本来就在 z = 0 的平面上算，
     * 为"2D"再开一条数学分支等于把同一个判断写两遍。
     *
     * **但只在平面工作区收**（2026-10-10 用户现场）。三维文档里的一个平面点**画不出来**
     * （三维画布只画 `point3`，属性栏给它的也是「点坐标 + 创建动圆」那一套），把它按 `z = 0`
     * 收进点名表，就等于让"题设已核验"挂在一个用户**根本看不见的对象**上：现场就是
     * `O为 BD的中点` 被一个平面 `O` 满足了 ⇒ 兜底补建不触发 ⇒ 图上永远没有那个点，
     * 底部还提示"空间直线需要 2 个空间点，当前 0 个"。
     * 判据：三维工作区里平面点不进表 ⇒ 名字"缺失"，由 `missingNamedPoints` 如实报出、
     * 由编译器按题设补建一个**空间点**。
     */
    const planarPointsCount = candidate.workspace !== "geometry3d"
    const position: Vector3 | undefined = primitive.type === "point3"
      ? primitive.position
      : primitive.type === "point" && planarPointsCount
        ? { x: primitive.x, y: primitive.y, z: 0 }
        : undefined
    if (position === undefined) continue
    /**
     * **"顶点名优先"只在这一处判**（收集时**不**跳过与顶点同名的标签，只在下面写入时挡）。
     *
     * 原先两处都判过（收集时 `points.has(label) → continue` + 写入时 `!points.has(label)`），
     * 后果是**同一个判断写了两遍**、互为冗余：单点变异改不动行为，
     * 于是那条"顶点名优先"的用例**看着有守卫、实际抓不到任何东西**（试过，变异两次都全绿）。
     * 这与本仓那句"同一个判断不许写两遍"是同一条账。
     */
    const label = (primitive as { label?: unknown }).label
    if (typeof label !== "string" || !isPointName(label)) continue
    labelled.set(label, labelled.has(label) || ![position.x, position.y, position.z].every(Number.isFinite) ? null : position)
  }
  for (const [label, position] of labelled) {
    if (position !== null && !points.has(label)) points.set(label, position)
  }
  return { ok: true, points }
}

/**
 * 描述一条圆锥曲线**只需要这几个数**（半轴 / 焦准距 / 轴）。
 *
 * 与 `FigureConic` 分开的理由：题面那一条（`DiagramConicStated`）只有这几个数，
 * 没有、也不该有图元；而候选图那一条要能拿去算交点，所以额外带 `primitive`。
 * 合成一个类型就得让题面那侧也伪造一个 `primitive` —— 那正是"为了让类型过得去而编造数据"。
 */
type ConicDescription =
  | { kind: "ellipse"; radiusX: number; radiusY: number }
  | { kind: "hyperbola"; radiusX: number; radiusY: number; axis: "x" | "y" }
  | { kind: "parabola"; focalParameter: number; axis: "x" | "y" }
  /** 圆带着**圆心** —— 那三档标准曲线都以原点为中心，所以圆不能并进椭圆。 */
  | { kind: "circle"; centerX: number; centerY: number; radius: number }

/** 候选图里那条圆锥曲线。**不含"是否满足题设"的结论** —— 那是 `calculate` 的事。 */
type FigureConic = ConicDescription & { primitive: PlanarConic }

/**
 * **候选图里那条新画的圆锥 / 圆柱 / 正 N 棱锥**（2026-10-20，实体标量尺寸）。
 *
 * 只留判据真正要用的那几个数。圆锥 / 圆柱给 `radius` 与 `height`（图元里就有）；正 N 棱锥
 * 图元里**没有**这两个数（物化成一整组点 + 棱 + 面），所以它的度量是**从坐标量出来的**：
 * 底边长 / 底面周长 / 底面积 / 侧棱长 / 高。
 */
type FigureSolid =
  | { shape: "cone" | "cylinder"; radius: number; height: number }
  | {
    shape: "pyramid"
    /** 底面边数（从底环上数出来，不读动作参数）。 */
    sides: number
    baseEdge: number
    basePerimeter: number
    baseArea: number
    lateralEdge: number
    height: number
  }

/**
 * **候选图里那条唯一的、新画出来的圆锥曲线**（V0c）。
 *
 * 与多面体那条同一条纪律：**恰好一个**才谈得上"题面说的就是它"。多一条就说不清
 * 判的是哪一条，宁可返回 `null`（报告里表现为"未核验"，而不是"通过"）。
 *
 * ⚠️ **这段注释原先写着"只认 `ellipse`：`hyperbola` / `parabola` 的题面写法与判据都还没做"** ——
 * 那句话早就过期了：解析器（`diagramObligations.ts:218-224`、`:231-237`）读得出三类，
 * 下面三个分支与 `calculate` 里的 `conicAxes`（本文件 `:389`、`:400`）也都按类判。
 * 留着它会让下一个人以为"双曲线只是没做"，而实际上它**判得比注释说的多**（2026-10-12 更正）。
 */
function candidateConic(plan: PlanEnvelope, candidate: GeometryDocument, base?: GeometryDocument): FigureConic | null {
  if (plan.kind !== "plan") return null
  const priorIds = new Set(base?.primitives.map((primitive) => primitive.id) ?? [])
  /**
   * **圆单独一支**（2026-10-20，联考 `joint-27`）：它走 `planar.create_circle`、图元类型是
   * `circle`，而且带着**圆心** —— 那三档标准圆锥曲线都以原点为中心，不能互相冒充。
   * 只有"没有新画的圆锥曲线、且有恰好一个新圆"时才认它：同一次里既画椭圆又画辅助圆时，
   * 不能悄悄把辅助圆当成题面说的那条曲线。
   */
  if (plan.actions.some((action) => action.actionId === "planar.create_conic")) {
    const conics = candidate.primitives.filter((primitive) => (primitive.type === "ellipse" || primitive.type === "hyperbola" || primitive.type === "parabola") && !priorIds.has(primitive.id))
    if (conics.length === 1) {
      const [conic] = conics
      // 逐种显式分支，而不是靠"剩下的一定是抛物线" —— 上面那个 `filter` 没有做类型守卫，
      // 兜底分支拿不到窄化，`focalParameter` / `axis` 会报"不存在于联合类型上"。
      if (conic.type === "ellipse") return { kind: "ellipse", radiusX: conic.radiusX, radiusY: conic.radiusY, primitive: conic }
      if (conic.type === "hyperbola") return { kind: "hyperbola", radiusX: conic.radiusX, radiusY: conic.radiusY, axis: conic.axis, primitive: conic }
      if (conic.type === "parabola") return { kind: "parabola", focalParameter: conic.focalParameter, axis: conic.axis, primitive: conic }
    }
  }
  if (plan.actions.some((action) => action.actionId === "planar.create_circle")) {
    // 图元是 `PrimitiveSpec` 的联合，`filter` 不会自己窄化 —— 这里显式断言成圆那一支。
    const circles = candidate.primitives.filter(
      (primitive) => primitive.type === "circle" && !priorIds.has(primitive.id)
    ) as Extract<PlanarConic, { type: "circle" }>[]
    if (circles.length === 1) {
      const [circle] = circles
      return { kind: "circle", centerX: circle.center.x, centerY: circle.center.y, radius: circle.radius, primitive: circle }
    }
  }
  return null
}

/**
 * 交点情形的人话（`conicChord` 的失败文案要用它）。
 *
 * **不把机器词甩给用户**：`single` 那一档尤其要说清"为什么只有一个" —— 直线与抛物线的对称轴
 * 平行时，另一个交点在无穷远，那与"相切"是两件完全不同的事。
 */
function describeChordExpectation(kind: "secant" | "tangent" | "single" | "none"): string {
  if (kind === "secant") return "相交于两点"
  if (kind === "tangent") return "相切（一个二重交点）"
  if (kind === "single") return "只有一个交点（直线与对称轴平行，另一交点在无穷远）"
  return "没有交点"
}

/**
 * 曲线种类的人话（判据文案用）。与 `describeConic` 分开：那一份给的是**参数**，
 * 这一份给的是**名字**，而 `pointOnConic` 要问的恰恰是"图上是哪一种、题面说的是哪一种"。
 */
function conicKindName(kind: "ellipse" | "hyperbola" | "parabola" | "circle"): string {
  return kind === "ellipse" ? "椭圆" : kind === "hyperbola" ? "双曲线" : kind === "circle" ? "圆" : "抛物线"
}

/** 数字的可读写法：整数不带小数点，其余最多六位。 */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(6)).toString()
}

/** 候选图里那条切线。同样**不含"是否满足题设"的结论**。 */
interface FigureTangent {
  /** 切点的横坐标（函数来源时就是它）。 */
  x: number
  /** 图元里存着的斜率。**判据不直接信它** —— 见 `derivativeAt` 与 `verifyTangentLine`。 */
  slope: number
  /** 图元里存着的切点。**也不直接信** —— 它可能根本不在曲线上（Task 15 的错切点反例）。 */
  pointY: number
  /** 来源函数那条曲线；没有就是"切线的来源不是函数"，算不出导数 ⇒ 未核验。 */
  source: { expression: string; domain: [number, number] } | null
}

/**
 * **候选图里那条唯一的、新画出来的切线**（V0d）。
 *
 * 与多面体、圆锥曲线同一条纪律：恰好一条才谈得上"题面说的就是它"。
 * 同时把它的**来源函数**（表达式 + 定义域）一并取出来：没有来源就求不了导，
 * 那条路必须如实走到"未核验"。
 */
function candidateTangent(plan: PlanEnvelope, candidate: GeometryDocument, base?: GeometryDocument): FigureTangent | null {
  if (plan.kind !== "plan") return null
  if (!plan.actions.some((action) => action.actionId === "function.create_tangent")) return null
  const priorIds = new Set(base?.primitives.map((primitive) => primitive.id) ?? [])
  const tangents = candidate.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "tangent" }> => primitive.type === "tangent" && !priorIds.has(primitive.id))
  if (tangents.length !== 1) return null
  const [tangent] = tangents
  const source = candidate.primitives.find((primitive) => primitive.id === tangent.sourceId)
  const domain = source?.type === "function" ? source.domain : undefined
  return {
    x: tangent.x,
    slope: tangent.slope,
    pointY: tangent.point?.y ?? Number.NaN,
    source: source?.type === "function" && domain !== undefined && Number.isFinite(domain[0]) && Number.isFinite(domain[1]) && domain[0] < domain[1]
      ? { expression: source.expression, domain: [domain[0], domain[1]] }
      : null
  }
}

/** 候选图里那条函数曲线。 */
interface FigureFunction {
  expression: string
  domain: [number, number]
}

/** **候选图里那条唯一的、新画出来的函数曲线**（V0d）。与其它几类同一条"恰好一条"纪律。 */
interface FigureCommonTangent extends FigureTangent {
  branch: number | null
  otherSource: { expression: string; domain: [number, number] } | null
}

/** 候选图里所有新建的公切线；每条都保留两条来源曲线，核验器不信图元自报的结论。 */
function candidateCommonTangents(plan: PlanEnvelope, candidate: GeometryDocument, base?: GeometryDocument): FigureCommonTangent[] {
  if (plan.kind !== "plan" || !plan.actions.some((action) => action.actionId === "function.create_tangent" && (action.inputs as { anchor?: { kind?: string } }).anchor?.kind === "common")) return []
  const priorIds = new Set(base?.primitives.map((primitive) => primitive.id) ?? [])
  return candidate.primitives.flatMap((primitive): FigureCommonTangent[] => {
    const anchor = primitive.type === "tangent" ? primitive.anchor : undefined
    if (primitive.type !== "tangent" || priorIds.has(primitive.id) || anchor?.kind !== "common") return []
    const source = candidate.primitives.find((entry) => entry.id === primitive.sourceId)
    const other = candidate.primitives.find((entry) => entry.id === anchor.otherSourceId)
    const sourceData = source?.type === "function" && Number.isFinite(source.domain[0]) && Number.isFinite(source.domain[1]) && source.domain[0] < source.domain[1]
      ? { expression: source.expression, domain: [source.domain[0], source.domain[1]] as [number, number] }
      : null
    const otherData = other?.type === "function" && Number.isFinite(other.domain[0]) && Number.isFinite(other.domain[1]) && other.domain[0] < other.domain[1]
      ? { expression: other.expression, domain: [other.domain[0], other.domain[1]] as [number, number] }
      : null
    return [{
      x: primitive.x,
      slope: primitive.slope,
      pointY: primitive.point?.y ?? Number.NaN,
      source: sourceData,
      branch: anchor.branch ?? null,
      otherSource: otherData
    }]
  })
}

function candidateCurve(plan: PlanEnvelope, candidate: GeometryDocument, base?: GeometryDocument): FigureFunction | null {
  if (plan.kind !== "plan") return null
  if (!plan.actions.some((action) => action.actionId === "function.create_graph")) return null
  const priorIds = new Set(base?.primitives.map((primitive) => primitive.id) ?? [])
  const curves = candidate.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "function" }> => primitive.type === "function" && !priorIds.has(primitive.id))
  if (curves.length !== 1) return null
  const [curve] = curves
  if (!Number.isFinite(curve.domain[0]) || !Number.isFinite(curve.domain[1]) || !(curve.domain[0] < curve.domain[1])) return null
  return { expression: curve.expression, domain: [curve.domain[0], curve.domain[1]] }
}

/** 采样点数。判的是**函数值**，不是字符串。 */
const CURVE_SAMPLES = 9

/**
 * **两条曲线在"共同有定义"的采样点上的最大函数值差**。
 *
 * ## 为什么是采样，而不是字符串比较、也不是我自己化简
 *
 * 题面写 `x³ − 3x`、图元里存 `x^3-3*x` —— **同一条曲线、两种写法**。字符串比会把它们判成
 * "不是这条函数"；而"先化简再比"要我另写一套化简，判据就变成"我的化简对不对"了。
 *
 * ## 边界的第二条：有一侧没定义就**跳过**（Task 15）
 *
 * 原先这里遇到非有限值就整条返 `null`（⇒ 落"未核验"），于是 `1/x` 这种题面永远只能得到
 * 一句"尚未被可靠解析"。可是"断点在哪、有几段"是**另一个问题**，由 `functionGraphEvidence`
 * 的断点集合单独判（`calculate` 的 `functionGraph` 分支）。两件事混在一起时，
 * 用户既不知道曲线对不对，也不知道断点对不对。
 *
 * ## 边界（如实写在这里，不含糊）
 *
 * 采样等价**不是**符号证明 —— 两个不同的表达式恰好在 9 个点上取值相同是可能的。
 * 对高中阶段的有理 / 三角曲线，9 个点足以把"少一项""系数写错"这类错分开；
 * 但它证明的是"**在这 9 个点上没发现差异**"，不是"处处相同" —— 所以这条判据的证据等级
 * 只能是 `plot-only`，它不许被读成"这条函数已经被证明了"。
 */
function curveGapAcrossBreaks(stated: string, drawn: FigureFunction): number | null {
  try {
    const expected = compileExpression(stated)
    const actual = compileExpression(drawn.expression)
    const [low, high] = drawn.domain
    let worst = 0
    let compared = 0
    for (let index = 0; index < CURVE_SAMPLES; index += 1) {
      const x = low + (high - low) * (index / (CURVE_SAMPLES - 1))
      const left = evaluateExpression(expected, { x })
      const right = evaluateExpression(actual, { x })
      if (!Number.isFinite(left) || !Number.isFinite(right)) continue
      worst = Math.max(worst, Math.abs(left - right))
      compared += 1
    }
    // 比不到三个点就说明这条"值相等"的读数没有内容，如实返 null（落"未核验"）。
    return compared >= 3 ? worst : null
  } catch {
    return null
  }
}

/**
 * **核验器自己算的导数**（中心差分）。
 *
 * ## 为什么不用内核那个
 *
 * 内核重算切线时会把 `slope` **写进图元**。若判据去读那个数，就是在拿系统自证：
 * 无论切点画在哪、斜率算成什么，图元里的数都会"符合"它自己。所以这里独立地
 * 从**表达式**出发数值求导 —— 与内核那条符号路径是两套实现，能互相证伪。
 *
 * 步长取 `1e-5 · max(1, |x|)`：对三次函数，中心差分的截断误差在这个步长下约 `1e-10`，
 * 远小于判据容差；而太小会让浮点相消吃掉全部有效位。
 */
function derivativeAt(source: { expression: string }, x: number): number | null {
  try {
    const compiled = compileExpression(source.expression)
    const step = 1e-5 * Math.max(1, Math.abs(x))
    const value = (evaluateExpression(compiled, { x: x + step }) - evaluateExpression(compiled, { x: x - step })) / (2 * step)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

/**
 * 椭圆的**人话描述**：半轴 + 由半轴决定的焦点。
 *
 * 焦点必须一起说：半轴对调时用户看到的是"两个数换了位置"，而后果其实是"焦点换了轴" ——
 * 后者才是他关心的事。
 */
function describeEllipse(radiusX: number, radiusY: number): string {
  const major = Math.max(radiusX, radiusY)
  const minor = Math.min(radiusX, radiusY)
  const focal = Math.sqrt(Math.max(0, major * major - minor * minor))
  const foci = radiusX >= radiusY ? `(±${formatNumber(focal)}, 0)` : `(0, ±${formatNumber(focal)})`
  return `半轴 (${formatNumber(radiusX)}, ${formatNumber(radiusY)})、焦点 ${foci}`
}

/** 三类圆锥曲线的人话描述。**都把"由参数决定、但用户真正关心"的那个量一起说出来**。 */
function describeConic(conic: ConicDescription): string {
  if (conic.kind === "ellipse") return describeEllipse(conic.radiusX, conic.radiusY)
  if (conic.kind === "hyperbola") return `半轴 (${formatNumber(conic.radiusX)}, ${formatNumber(conic.radiusY)})、实轴沿 ${conic.axis} 轴`
  if (conic.kind === "circle") return `圆心 (${formatNumber(conic.centerX)}, ${formatNumber(conic.centerY)})、半径 ${formatNumber(conic.radius)}`
  return `焦准距 p = ${formatNumber(conic.focalParameter)}、对称轴为 ${conic.axis} 轴`
}

/** 没有点名、由"恰好一条"确定的那几类图形。它们各自独立，缺谁就只有谁判不了。 */
interface FigureContext {
  conic: FigureConic | null
  tangent: FigureTangent | null
  commonTangents: readonly FigureCommonTangent[]
  curve: FigureFunction | null
  /**
   * **候选图里带点名的平面点**（`point` 图元的 `label` 就是点名）。
   *
   * 为什么不用 `candidatePoints` 那张表：它只从**多面体 / 面片**的 `vertexNames` 建出来，
   * 而圆锥曲线文档里没有那些动作 ⇒ 表是空的。"图上有没有这个交点"必须问**候选图自己**，
   * 不能问一张按别的图形建的映射表（2026-10-12 实测：拿那张表会把"两条都画对了"判成"丢了两个交点"）。
   */
  planarPoints: readonly { name: string; x: number; y: number }[]
  /**
   * **候选图里那条新画的圆锥 / 圆柱**（2026-10-20，实体标量尺寸）。
   *
   * 与 `conic` 同一条纪律：问**候选图自己**，不在计划里猜。`solidDimension` 的判据要量的是
   * "这条实体的这个度量"，而度量全都能从实体自己的 `radius` / `height` 算出来。
   */
  solid: FigureSolid | null
  /**
   * **候选图里那条新画的圆**（2026-10-20，弦心距 / 弧长）。
   *
   * 弦心距与弧长问的都是"**这个圆**"：圆心到弦的距离、半径与圆心角。圆心与半径都在圆图元里
   *（`planar.create_circle` 物化成 `circle`），所以判据不必要求题面把 `⊙O` 的 `O` 建成点名。
   */
  circle: FigureCircle | null
}

/** 候选图里那条新画的圆（**恰好一条**才谈得上"题面说的是它"）。 */
interface FigureCircle {
  centerX: number
  centerY: number
  radius: number
}

function candidateCircle(plan: PlanEnvelope, candidate: GeometryDocument, base?: GeometryDocument): FigureCircle | null {
  if (plan.kind !== "plan") return null
  if (!plan.actions.some((action) => action.actionId === "planar.create_circle")) return null
  const priorIds = new Set(base?.primitives.map((primitive) => primitive.id) ?? [])
  const circles = candidate.primitives.filter((primitive) => primitive.type === "circle" && !priorIds.has(primitive.id))
  if (circles.length !== 1) return null
  const [circle] = circles
  if (circle.type !== "circle") return null
  if (!Number.isFinite(circle.center.x) || !Number.isFinite(circle.center.y) || !(circle.radius > 0)) return null
  return { centerX: circle.center.x, centerY: circle.center.y, radius: circle.radius }
}

/**
 * 候选图里那条新画的圆锥 / 圆柱（**只有一条**才算数）。
 *
 * 为什么不按别名找：别名是计划里的东西，而这条义务说的是"题面上那条圆锥"。与 `candidateConic`
 * 一样按"**新出现的图元**"认（对 `base` 求差），少了或多了一条都返回 `null` ——
 * 那时如实落未核验，比挑一条来量好。
 */
function candidateSolid(plan: PlanEnvelope, candidate: GeometryDocument, base?: GeometryDocument): FigureSolid | null {
  if (plan.kind !== "plan") return null
  if (plan.actions.some((action) => action.actionId === "solid.create_regular_pyramid")) return candidatePyramid(candidate, base)
  if (!plan.actions.some((action) => action.actionId === "solid.create_template")) return null
  const priorIds = new Set(base?.primitives.map((primitive) => primitive.id) ?? [])
  const solids = candidate.primitives.filter(
    (primitive) => (primitive.type === "cone" || primitive.type === "cylinder") && !priorIds.has(primitive.id)
  )
  if (solids.length !== 1) return null
  const [solid] = solids
  // `filter` 不做类型守卫，这里逐种显式分支（与 `candidateConic` 同一个理由）。
  if (solid.type === "cone") return { shape: "cone", radius: solid.radius, height: solid.height }
  if (solid.type === "cylinder") return { shape: "cylinder", radius: solid.radius, height: solid.height }
  return null
}

/** 圆锥 / 圆柱量出来的那个度量（`null` = 这个形状没有这个度量）。 */
function measureSolid(solid: FigureSolid, metric: NonNullable<DiagramObligation["solid"]>["metric"]): number | null {
  if (solid.shape === "pyramid") {
    switch (metric) {
      case "baseEdge": return solid.baseEdge
      case "lateralEdge": return solid.lateralEdge
      case "basePerimeter": return solid.basePerimeter
      case "baseArea": return solid.baseArea
      case "height": return solid.height
      // 母线 / 半径 / 侧面积不是棱锥的度量（侧面积还要斜高面，今天不算）。
      default: return null
    }
  }
  /**
   * **母线在两种实体上是两件事**：圆锥的母线是斜的（`√(r²+h²)`），圆柱的母线与高**是同一条**。
   * 这个差别正是"圆锥的侧面展开图为什么是扇形"，写错就会把圆锥的母线量成高。
   */
  const slant = solid.shape === "cone" ? Math.hypot(solid.radius, solid.height) : solid.height
  if (!Number.isFinite(slant)) return null
  switch (metric) {
    case "radius": return solid.radius
    case "height": return solid.height
    case "slantHeight": return slant
    case "baseArea": return Math.PI * solid.radius * solid.radius
    case "lateralArea": return solid.shape === "cone" ? Math.PI * solid.radius * slant : 2 * Math.PI * solid.radius * solid.height
    default: return null
  }
}

/**
 * **正 N 棱锥：从坐标把底环认出来，再量。**
 *
 * `solid.create_regular_pyramid` 物化成一整组点 / 棱 / 面 + 一个 `polyhedron3`，
 * 图元里**没有** `radius` / `height`（那两个数只在动作里）—— 所以这里不读动作参数，**量坐标**。
 *
 * 认底面的办法只用一条几何事实：**非底面的侧面全是三角形**，底面是 N 边形（N ≥ 4），
 * 于是 `face3` 里**点最多的那张**就是底环。剩下那个顶点是锥顶。
 *
 * **N = 3 时这张表不成立**（四张面全是三角形）⇒ 返回 `null`，报告里落"未核验"。
 * 按题面顺序挑一张当底面就是"替题面猜图形"，这条判据不做。
 *
 * 底面**不是正多边形**时也返回 `null`：那时"底边长 / 侧棱长"没有唯一的数。
 */
function candidatePyramid(candidate: GeometryDocument, base?: GeometryDocument): FigureSolid | null {
  const priorIds = new Set(base?.primitives.map((primitive) => primitive.id) ?? [])
  const solids = candidate.primitives.filter((primitive) => primitive.type === "polyhedron3" && !priorIds.has(primitive.id))
  if (solids.length !== 1) return null
  const [polyhedron] = solids
  const solid = polyhedron as unknown as { vertexIds?: string[]; faceIds?: string[] }
  if (!Array.isArray(solid.vertexIds) || !Array.isArray(solid.faceIds)) return null
  const byId = new Map(candidate.primitives.map((primitive) => [primitive.id, primitive]))
  const positionOf = (id: string): Vector3 | null => {
    const primitive = byId.get(id)
    if (primitive === undefined || primitive.type !== "point3") return null
    return primitive.position
  }
  const faces = solid.faceIds
    .map((id) => byId.get(id))
    .filter((primitive): primitive is Extract<typeof candidate.primitives[number], { type: "face3" }> => primitive?.type === "face3")
  if (faces.length === 0) return null
  const counts = faces.map((face) => face.pointIds.length)
  const widest = Math.max(...counts)
  // 三角形底（N = 3）分不出哪一张是底面；两张一样宽的也说不清。
  if (widest <= 3) return null
  if (counts.filter((count) => count === widest).length !== 1) return null
  const ringIds = faces[counts.indexOf(widest)]!.pointIds
  const ring = ringIds.map(positionOf)
  if (ring.some((position) => position === null)) return null
  const ringPoints = ring as Vector3[]
  const apexId = solid.vertexIds.find((id) => !ringIds.includes(id))
  const apex = apexId === undefined ? null : positionOf(apexId)
  if (apex === null) return null
  const sides = ringPoints.length
  const edges = ringPoints.map((point, index) => euclid(point, ringPoints[(index + 1) % sides]!))
  const meanEdge = edges.reduce((sum, value) => sum + value, 0) / sides
  if (!(meanEdge > 0) || edges.some((edge) => Math.abs(edge - meanEdge) > 1e-6 * Math.max(1, meanEdge))) return null
  const laterals = ringPoints.map((point) => euclid(apex, point))
  const meanLateral = laterals.reduce((sum, value) => sum + value, 0) / sides
  if (laterals.some((value) => Math.abs(value - meanLateral) > 1e-6 * Math.max(1, meanLateral))) return null
  const area = polygonArea3(ringPoints)
  if (area === null) return null
  const centroid = ringPoints.reduce((sum, point) => ({ x: sum.x + point.x / sides, y: sum.y + point.y / sides, z: sum.z + point.z / sides }), { x: 0, y: 0, z: 0 })
  const height = polygonNormal(ringPoints) === null ? null : Math.abs(dot(subtract(apex, centroid), polygonNormal(ringPoints)!))
  if (height === null || !Number.isFinite(height) || height <= 0) return null
  return { shape: "pyramid", sides, baseEdge: meanEdge, basePerimeter: edges.reduce((sum, value) => sum + value, 0), baseArea: area, lateralEdge: meanLateral, height }
}

const euclid = (a: Vector3, b: Vector3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const subtract = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const dot = (a: Vector3, b: Vector3): number => a.x * b.x + a.y * b.y + a.z * b.z

/** 平面多边形的单位法向（Newell）；退化（面积 0）返回 `null`。 */
function polygonNormal(points: readonly Vector3[]): Vector3 | null {
  let x = 0
  let y = 0
  let z = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    x += (current.y - next.y) * (current.z + next.z)
    y += (current.z - next.z) * (current.x + next.x)
    z += (current.x - next.x) * (current.y + next.y)
  }
  const length = Math.hypot(x, y, z)
  return length > 1e-12 ? { x: x / length, y: y / length, z: z / length } : null
}

/** 平面多边形的面积（Newell 法向的一半模长）；退化返回 `null`。 */
function polygonArea3(points: readonly Vector3[]): number | null {
  let x = 0
  let y = 0
  let z = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    x += (current.y - next.y) * (current.z + next.z)
    y += (current.z - next.z) * (current.x + next.x)
    z += (current.x - next.x) * (current.y + next.y)
  }
  const double = Math.hypot(x, y, z) / 2
  return double > 1e-12 ? double : null
}

/** 度量的中文名（失败文案要指着它说，用户才知道是哪一条不对）。 */
const SOLID_DIMENSION_LABEL: Record<NonNullable<DiagramObligation["solid"]>["metric"], string> = {
  radius: "底面半径",
  height: "高",
  slantHeight: "母线长",
  baseArea: "底面积",
  lateralArea: "侧面积",
  baseEdge: "底面边长",
  lateralEdge: "侧棱长",
  basePerimeter: "底面周长"
}

function calculate(item: DiagramObligation, points: Map<string, Vector3>, figures: FigureContext): { actual: number; expected: number; tolerance: number; detail?: string; evidence?: EvidenceGrade } | null {
  /**
   * **圆锥曲线不走点名表**（V0c）：它没有顶点名，自己就是被核验的对象。
   *
   * 判据只比**半轴**，但结论包含**焦点** —— 因为焦点是半轴的函数（`c = √(a² − b²)`），
   * 两个半轴对调会把焦点从 `(±√5, 0)` 挪到 `(0, ±√5)`，那是另一条曲线。
   * 把这两个数一起写进 `detail`，用户才看得出"为什么半轴错了等于焦点错了"。
   */
  if (item.kind === "solidDimension") {
    /**
     * **实体尺寸**（2026-10-20）：题面写的是"这条圆锥的底面半径是 2"，判据量的是
     * 候选图里那条新画的圆锥自己的 `radius` / `height` 算出来的那个量。
     *
     * 形状对不上（题面说的圆柱、图上画的是圆锥）**不硬量** —— 返回 `null` 落未核验，
     * 因为那时"量的是哪条实体"本身就不成立。
     */
    const stated = item.solid
    const drawn = figures.solid
    if (stated === undefined || item.value === undefined || drawn === null || drawn.shape !== stated.shape) return null
    const measured = measureSolid(drawn, stated.metric)
    if (measured === null || !Number.isFinite(measured)) return null
    const label = SOLID_DIMENSION_LABEL[stated.metric]
    /** 底下那两个数**各形状不一样**，所以这段说明也按形状写（说错一个数就是假话）。 */
    const basis = drawn.shape === "pyramid"
      ? `正 ${drawn.sides} 棱锥，底面边长 ${drawn.baseEdge.toPrecision(6)}、侧棱长 ${drawn.lateralEdge.toPrecision(6)}、高 ${drawn.height.toPrecision(6)}`
      : `${drawn.shape === "cone" ? "圆锥" : "圆柱"}，半径 ${drawn.radius.toPrecision(6)}、高 ${drawn.height.toPrecision(6)}`
    return {
      actual: measured,
      expected: item.value,
      tolerance: distanceTolerance(1),
      detail: `实测${basis}，${label} ${measured.toPrecision(6)}；题设要求 ${label} ${item.value}。`
    }
  }
  if (item.kind === "conicAxes") {
    const stated = item.conic
    const drawn = figures.conic
    if (stated === undefined || drawn === null) return null
    const tolerance = distanceTolerance(1)
    if (stated.kind === "ellipse" && drawn.kind === "ellipse") {
      const gap = Math.max(Math.abs(drawn.radiusX - stated.radiusX), Math.abs(drawn.radiusY - stated.radiusY))
      return { actual: gap, expected: 0, tolerance, detail: `实测 ${describeConic(drawn)}；题设要求 ${describeConic(stated)}。` }
    }
    if (stated.kind === "hyperbola" && drawn.kind === "hyperbola") {
      /**
       * **轴单独判、不与数值差混在一起**：混进去的话"轴反了"会被当成"差了多少"报出来，
       * 而用户看到的两个半轴其实**一模一样** —— 那句话会让人以为系统算错了数。
       */
      if (drawn.axis !== stated.axis) {
        return { actual: 1, expected: 0, tolerance: 1e-9, detail: `实测 ${describeConic(drawn)}；题设要求 ${describeConic(stated)} —— 半轴相同也是另一条曲线。` }
      }
      const gap = Math.max(Math.abs(drawn.radiusX - stated.radiusX), Math.abs(drawn.radiusY - stated.radiusY))
      return { actual: gap, expected: 0, tolerance, detail: `实测 ${describeConic(drawn)}；题设要求 ${describeConic(stated)}。` }
    }
    if (stated.kind === "parabola" && drawn.kind === "parabola") {
      if (drawn.axis !== stated.axis) {
        return { actual: 1, expected: 0, tolerance: 1e-9, detail: `实测 ${describeConic(drawn)}；题设要求 ${describeConic(stated)} —— 开口方向不同就是另一条曲线。` }
      }
      const gap = Math.abs(drawn.focalParameter - stated.focalParameter)
      return { actual: gap, expected: 0, tolerance, detail: `实测 ${describeConic(drawn)}；题设要求 ${describeConic(stated)}。` }
    }
    /**
     * **圆**：圆心与半径**各自**比。只比半径的话，一个"半径对、位置挪了三格"的圆会被判通过 ——
     * 那是错的图，只是看起来很像。残差取两者的较大值（与"点在线段上"那条同一口径）。
     */
    if (stated.kind === "circle" && drawn.kind === "circle") {
      const centerGap = Math.hypot(drawn.centerX - stated.centerX, drawn.centerY - stated.centerY)
      const radiusGap = Math.abs(drawn.radius - stated.radius)
      return { actual: Math.max(centerGap, radiusGap), expected: 0, tolerance, detail: `实测 ${describeConic(drawn)}；题设要求 ${describeConic(stated)}。` }
    }
    // 种类不同 ⇒ 图上根本不是题面说的那种曲线。
    return null
  }
  /**
   * **直线与圆锥曲线的交点**（Task 14）。
   *
   * 判据分两层，两层缺一不可：
   *
   * ① **定性**：把题面那条直线与**最终落盘的**那条曲线交给内核的**代数**求解器
   *   （`intersectLineWithConic`，判别式给重数），档位必须与题面声称的**同名**
   *   —— `相交于 A、B 两点` ⇒ `secant`、`相切` ⇒ `tangent`、`只有一点` ⇒ `single`、`没有交点` ⇒ `none`。
   *   **不用采样**：采样法区分不开"相切"与"两个极近的交点"，而"相切"恰恰是题面会明说的东西。
   * ② **定量**：代数算出来的**每一个**交点，最终图上都得有个点名落在那儿（容差内）。
   *   **少一个就是失败** —— 这正是计划点名的"丢一交点必须真红"：图看起来很像、数少一个，
   *   在旧实现里只会走 `null` ⇒ **未核验**，永远不会红。
   *
   * 题面点了名（`相交于 A、B 两点`）时还要核对那两个名字都落在算出来的交点上：
   * 位置对而名字错，对用户来说仍然是错的图。
   */
  if (item.kind === "conicChord") {
    const stated = item.line
    const expectation = item.expectation
    const figure = figures.conic
    if (stated === undefined || expectation === undefined || figure === null) return null
    // 竖直线必须单独构造：斜截式里它是一条竖到无法表达的线。
    const line = stated.kind === "vertical"
      ? { a: { x: stated.x, y: 0 }, b: { x: stated.x, y: 1 } }
      : { a: { x: 0, y: stated.intercept }, b: { x: 1, y: stated.slope + stated.intercept } }
    const algebraic = intersectLineWithConic(line, figure.primitive)
    // 退化（零长直线 / 退化的曲线）⇒ 如实说"未核验"，不硬判。
    if (algebraic.kind === "degenerate") return null
    const tolerance = distanceTolerance(1)
    const expectedPoints = algebraic.kind === "secant"
      ? [...algebraic.points]
      : algebraic.kind === "tangent" || algebraic.kind === "single"
        ? [algebraic.point]
        : []
    if (algebraic.kind !== expectation) {
      return { actual: 1, expected: 0, tolerance: 1e-9, detail: `题面说这条直线与曲线${describeChordExpectation(expectation)}，实测是${describeChordExpectation(algebraic.kind)}。` }
    }
    const drawn = figures.planarPoints
    const near = (entry: { x: number; y: number }, point: { x: number; y: number }) => Math.hypot(entry.x - point.x, entry.y - point.y) <= tolerance
    /**
     * **题面点了名，才要求"图上必须有这些点"**。只写"相切"时题面主张的是这条直线与曲线的相对
     * 位置，那件事由上面那一层回答就够了 —— 再要求图上多一个切点，是替题面加戏。
     */
    const missing = item.targets.length > 0 ? expectedPoints.filter((point) => !drawn.some((entry) => near(entry, point))) : []
    if (missing.length > 0) {
      const where = expectedPoints.map((point) => `(${formatNumber(point.x)}, ${formatNumber(point.y)})`).join("、")
      return {
        actual: missing.length,
        expected: 0,
        tolerance,
        detail: `题面说这条直线与曲线${describeChordExpectation(expectation)}：代数上确实有 ${expectedPoints.length} 个交点（${where}），但图上只找到 ${expectedPoints.length - missing.length} 个 —— 丢了 ${missing.length} 个交点。`
      }
    }
    if (item.targets.length > 0) {
      const unmatched = item.targets.filter((name) => {
        const entry = drawn.find((candidatePoint) => candidatePoint.name === name)
        return entry === undefined || !expectedPoints.some((point) => near(entry, point))
      })
      if (unmatched.length > 0) {
        return { actual: 1, expected: 0, tolerance, detail: `题面点了 ${item.targets.join("、")}，但 ${unmatched.join("、")} 没有落在算出来的交点上。` }
      }
    }
    return { actual: 0, expected: 0, tolerance, detail: `已按候选图坐标核验：这条直线与曲线${describeChordExpectation(expectation)}，交点个数与位置都对得上。` }
  }
  /**
   * **点在圆锥曲线上**（施工单①，2026-10-15）：`P 是椭圆上任意一点`。
   *
   * 判据三层，每一层都问**候选图自己**：
   * ① 图上有没有**恰好一条**新画的圆锥曲线（`candidateConic`，与 `conicAxes` 同一处判据）；
   * ② 它是不是**题面说的那一种** —— 题面说椭圆而图上画的是抛物线时，这不是"残差大小"能表达的错，
   *   所以与 `conicAxes` 的"轴反了"同一档：直接判失败并说清两种曲线（**不拿抛物线替椭圆判 P**）；
   * ③ 那一点离这条曲线多远 —— 交给内核 `conicResidualAt`（复用 `conic-line.ts` 的局部隐式形式，
   *   **这里不写第二份方程**）。点在不在图上由点名表决定：图上没有 `P` 时返回 `null`，
   *   由调用方如实报"点名缺失：P"，**不硬凑一个点**。
   *
   * **"任意一点"那层普遍性不属于这一条**：这里核的是图上这一点（实例）。
   * 题面自己写了"任意"时，理由里另有一句**指回报告证明范围**的披露 ——
   * 少了它，一个绿字很容易被读成"对任意点都成立"。
   */
  if (item.kind === "pointOnConic") {
    const name = item.targets[0]
    const figure = figures.conic
    if (name === undefined || figure === null) return null
    if (item.conicKind !== undefined && figure.kind !== item.conicKind) {
      return {
        actual: 1,
        expected: 0,
        tolerance: 1e-9,
        detail: `题面说的是${conicKindName(item.conicKind)}，而图上唯一那条圆锥曲线是${conicKindName(figure.kind)} —— 图上没有题面说的那种曲线，点 ${name} 也就无从谈起。`
      }
    }
    const point = points.get(name)
    if (point === undefined) return null
    const evidence = conicResidualAt(figure.primitive, { x: point.x, y: point.y })
    if (evidence === null) return null
    const universal = /任意|任取/.test(item.sourceText)
      ? "（题面写的是**任意**一点：这一条核的是**图上这一点**，不是对任意点的证明 —— 「任意一点都成立」那层普遍性由报告的证明范围如实承担。）"
      : ""
    return {
      actual: evidence.residual,
      expected: 0,
      tolerance: distanceTolerance(1),
      detail: `实测点 ${name} (${formatNumber(point.x)}, ${formatNumber(point.y)}) 到这条曲线的残差 ${formatNumber(evidence.residual)}（0 = 正好在曲线上；这是**一阶**距离估计，不是精确距离）。${universal}`
    }
  }
  /**
   * **切线**（V0d）：题面只说"在 `x = 1` 处的切线"，斜率由**函数**决定。
   *
   * 所以两个数都要比，而且都不许读图元里那个自报的 `slope`：
   * ① 切点的横坐标必须就是题面说的那个 `x`（管"切在不在题面说的位置"）；
   * ② 斜率必须等于核验器**自己数值求出来**的 `f′(x)`（管"斜率对不对"）。
   *
   * 没有来源函数 ⇒ 求不了导 ⇒ 返回 `null`，由调用方如实报"未核验"。
   * **不许**退化成"那就只查横坐标吧" —— 那只核验了一半，却看起来像全过了。
   */
  if (item.kind === "commonTangent") {
    const stated = item.expressions
    const candidates = figures.commonTangents
    const expectedCount = item.value
    if (stated === undefined || expectedCount === undefined || candidates.length === 0) return null
    const fail = (detail: string) => ({ actual: 1, expected: 0, tolerance: 1e-9, evidence: "verified-numeric" as const, detail })
    if (candidates.length !== expectedCount) return fail("题面要求 " + expectedCount + " 条公切线，候选图实际有 " + candidates.length + " 条。")
    if (candidates.some((entry) => entry.branch === null || !Number.isInteger(entry.branch) || entry.branch < 0)) return fail("候选图中的公切线缺少有效 branch，不能确认每条解对应哪一支。")
    const branches = candidates.map((entry) => entry.branch as number)
    if (new Set(branches).size !== branches.length) return fail("候选图重复了公切线 branch：" + branches.join("、") + "。")
    if (candidates.some((entry) => entry.source === null || entry.otherSource === null)) return null
    const first = candidates[0]!.source!
    const second = candidates[0]!.otherSource!
    const firstGap = curveGapAcrossBreaks(stated[0], first)
    const secondGap = curveGapAcrossBreaks(stated[1], second)
    if (firstGap === null || secondGap === null) return null
    const curveTolerance = distanceTolerance(1)
    if (firstGap > curveTolerance || secondGap > curveTolerance) return fail("候选图的两条函数与题面不一致：第一条最大偏差 " + firstGap.toPrecision(5) + "，第二条最大偏差 " + secondGap.toPrecision(5) + "。")
    if (candidates.some((entry) => {
      const source = entry.source!
      const other = entry.otherSource!
      return Math.abs(source.domain[0] - first.domain[0]) > 1e-9 || Math.abs(source.domain[1] - first.domain[1]) > 1e-9 || Math.abs(other.domain[0] - second.domain[0]) > 1e-9 || Math.abs(other.domain[1] - second.domain[1]) > 1e-9
    })) return fail("公切线没有全部引用同一对题面函数，不能把候选支混在一起核验。")
    const solved = commonTangents(first.expression, second.expression, first.domain, second.domain)
    if (solved.status !== "solved" || !solved.complete) return null
    if (solved.tangents.length !== expectedCount) return fail("独立重算得到 " + solved.tangents.length + " 条公切线，而题面要求 " + expectedCount + " 条。")
    for (const entry of candidates) {
      const expected = solved.tangents[entry.branch as number]
      if (expected === undefined) return fail("候选图引用了不存在的公切线 branch " + entry.branch + "。")
      const intercept = entry.pointY - entry.slope * entry.x
      const firstVerdict = verifyTangentLine(first.expression, first.domain, { slope: entry.slope, intercept })
      const secondVerdict = verifyTangentLine(second.expression, second.domain, { slope: entry.slope, intercept })
      const lineGap = Math.max(Math.abs(entry.slope - expected.slope), Math.abs(intercept - expected.intercept))
      if (!firstVerdict.tangent || !secondVerdict.tangent || lineGap > distanceTolerance(Math.max(1, Math.abs(expected.slope), Math.abs(expected.intercept)))) {
        return fail("branch " + entry.branch + " 的直线没有同时与两条函数相切：" + firstVerdict.reason + "；" + secondVerdict.reason)
      }
    }
    return { actual: 0, expected: 0, tolerance: 1e-9, evidence: "verified-numeric" as const, detail: "独立重算确认 " + expectedCount + " 条公切线；每条都同时与两条题面函数相切。" }
  }
  if (item.kind === "tangentAt") {
    const stated = item.value
    const tangent = figures.tangent
    if (stated === undefined || tangent === null || tangent.source === null) return null
    const abscissaGap = Math.abs(tangent.x - stated)
    /**
     * **先问"这一点有没有切线"**（Task 15）。中心差分在 `|x|` 的尖点处给出 `0`，
     * 于是"斜率 = 0"成立、判据通过 —— 一条水平线被当成尖点处的切线。
     * 可导性由**单侧差商**判，左侧 −1、右侧 +1 会把这件事直接说穿。
     */
    const differentiability = differentiabilityAt(tangent.source.expression, stated, tangent.source.domain)
    if (!differentiability.differentiable) {
      return {
        actual: 1,
        expected: 0,
        tolerance: 1e-9,
        evidence: "verified-numeric" as const,
        detail: `题面要求在 x = ${formatNumber(stated)} 处作切线，但${differentiability.reason}`
      }
    }
    const expectedSlope = derivativeAt(tangent.source, stated)
    if (expectedSlope === null) return null
    if (abscissaGap > 1e-9) {
      return {
        actual: abscissaGap,
        expected: 0,
        tolerance: distanceTolerance(1),
        evidence: "verified-numeric" as const,
        detail: `切点画在 x = ${formatNumber(tangent.x)}，题设要求 x = ${formatNumber(stated)}。`
      }
    }
    const slopeGap = Math.abs(tangent.slope - expectedSlope)
    if (slopeGap > distanceTolerance(expectedSlope)) {
      return {
        actual: slopeGap,
        expected: 0,
        tolerance: distanceTolerance(expectedSlope),
        evidence: "verified-numeric" as const,
        detail: `切线斜率实测 ${formatNumber(tangent.slope)}；由函数算得 f′(${formatNumber(stated)}) = ${formatNumber(expectedSlope)}。`
      }
    }
    /**
     * **斜率对了，还要问"这条直线本身是不是切线"**（Task 15）。
     *
     * 截距由图元**自报的切点纵坐标**决定，而那个数是内核填的。只比斜率的话，
     * "切点落在曲线外"（例如 `(1, 5)` 配斜率 0 ⇒ 直线 `y = 5`）会被判通过 ——
     * 那不可能是切线，它压根不碰这条曲线。所以这里把整条直线交给内核独立验一遍。
     */
    const intercept = tangent.pointY - tangent.slope * tangent.x
    const verdict = verifyTangentLine(tangent.source.expression, tangent.source.domain, { slope: tangent.slope, intercept })
    if (!verdict.tangent) {
      return {
        actual: verdict.residual,
        expected: 0,
        tolerance: distanceTolerance(1),
        evidence: "verified-numeric" as const,
        detail: `斜率与 f′(${formatNumber(stated)}) 一致，但这条直线整体与曲线不相切：${verdict.reason}`
      }
    }
    return {
      actual: 0,
      expected: 0,
      tolerance: distanceTolerance(expectedSlope),
      evidence: "verified-numeric" as const,
      detail: `切点与斜率都由核验器自己算：f′(${formatNumber(stated)}) = ${formatNumber(expectedSlope)}；直线在 x = ${formatNumber(verdict.parameter ?? stated)} 处与曲线相切。`
    }
  }
  if (item.kind === "functionGraph") {
    const stated = item.expression
    if (stated === undefined || figures.curve === null) return null
    const drawn = figures.curve
    /**
     * **断点必须一一对上**（Task 15）。这是"断点被连线"的判据：
     * 题面 `(x²−1)/(x−1)` 在 `x = 1` 没有定义，图上画成连续的 `x + 1` ——
     * 两侧的函数值处处相等，可它把一个断点画没了，那是另一条曲线。
     */
    const statedEvidence = functionGraphEvidence(stated, drawn.domain)
    const drawnEvidence = functionGraphEvidence(drawn.expression, drawn.domain)
    if (statedEvidence.segments.length === 0 || drawnEvidence.segments.length === 0) return null
    const breakTolerance = Math.max(0.01, (drawn.domain[1] - drawn.domain[0]) / 100)
    const mismatch = statedEvidence.breaks.length !== drawnEvidence.breaks.length
      || statedEvidence.breaks.some((entry, index) => Math.abs(entry - drawnEvidence.breaks[index]) > breakTolerance)
    if (mismatch) {
      const at = (breaks: readonly number[]) => breaks.length > 0 ? `${breaks.map(formatNumber).join("、")} 处断开（${breaks.length + 1} 段）` : "整段都没有断点"
      return {
        actual: 1,
        expected: 0,
        tolerance: 1e-9,
        evidence: "plot-only" as const,
        detail: `题面那条函数在 ${at(statedEvidence.breaks)}，图上画的却在 ${at(drawnEvidence.breaks)} —— 两条曲线的定义域不是一回事（把断点画成了连续曲线，或反过来）。`
      }
    }
    const gap = curveGapAcrossBreaks(stated, drawn)
    if (gap === null) return null
    const breakNote = statedEvidence.breaks.length > 0
      ? `（在 ${statedEvidence.breaks.map(formatNumber).join("、")} 处断开，两侧各一段；断点本身不参与比较）`
      : ""
    return {
      actual: gap,
      expected: 0,
      tolerance: distanceTolerance(1),
      // 采样比"值相等"**不是**符号证明，这一条永远只是折线证据。
      evidence: "plot-only" as const,
      detail: `图上画的是 ${drawn.expression}；题设要求 ${stated}${breakNote}（在 ${CURVE_SAMPLES} 个采样点上比函数值）。`
    }
  }
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
    /**
     * **同一个 kind 装两种写法**（2026-10-10 用户现场）：
     * - `DE=2EA` —— **一个点把一条线段分开**：targets `[D,E,E,A]`（中间那个点名重复），判 `DE/EA`，
     *   而且要求 E **在线段 DA 上**（只看比值会把"斜着放在旁边"也判过）；
     * - `AD=2AB` —— **两条不同线段的倍数**：targets `[A,D,A,B]`（不重复），判 `|AD|/|AB|`。
     *
     * 判据原先只有第一支（`e !== eAgain` 直接 `return null`），于是第二支**永远核不了** ——
     * 只要题面里写了「AD=2AB」这种"两条线段成倍数"，门禁就永远不放行。抽取器早就把两种形状
     * 编得不一样（重复 / 不重复），缺的只是判据这一支。
     */
    if (e !== eAgain) {
      const numerator = length(d, e)
      const denominator = length(eAgain, a)
      if (denominator <= 1e-10) return null
      return { actual: numerator / denominator, expected: numeric, tolerance: UNITLESS_TOLERANCE }
    }
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
  /**
   * **点在线段上**（2026-10-15 用户现场，Rt△ABC 折起那道题）：`D 为 AC 上一点`。
   *
   * 与 `pointOnConic` **只差一个字**，但它是**两件事**，而且**必须分开说** ——
   * 因为它们不是同一种错：
   * ① **共线**：点到这条**直线**的距离必须为 0 ⇒ 不为 0 就是「**根本不在 `AC` 这条线上**」；
   * ② **在线段内**：参数 `t = (D−A)·(C−A)/|AC|²` 必须落在 `[0,1]` ⇒ `t<0` / `t>1` 是
   *    「**在延长线上**」。题面写的是「`AC` 上一点」，而「`AC` 的延长线上一点」是**另一件事** ——
   *    把这两种读错法说成同一句，用户不知道该改哪里。
   *
   * 残余取两者的**较大值**（等价于「点到这条线段的距离」）：`expected = 0`，
   * 容差用**长度那把尺子**并按 `|AC|` 缩放（与上面 `midpoint` 同一条约定 —— 所以 IR 那一侧
   * **不给**一个固定容差，见 `obligationIR.toleranceFor` 的说明）。
   * 点名缺失（图上没有 `D`/`A`/`C`）时返回 `null`，由调用方如实报「点名缺失：X」。
   *
   * **位置提醒（本轮踩到）**：这一支必须排在 `at` 的**定义之后**（`const at = …` 在下面）——
   * 早先挨着 `pointOnConic` 放，运行时 `ReferenceError: Cannot access 'at' before initialization`。
   */
  if (item.kind === "pointOnSegment") {
    const [name, from, to] = [item.targets[0], item.targets[1], item.targets[2]]
    if (name === undefined || from === undefined || to === undefined) return null
    const point = at(0)
    const start = at(1)
    const end = at(2)
    const span = length(start, end)
    if (span <= 1e-10) return null
    const along = ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y) + (point.z - start.z) * (end.z - start.z)) / (span * span)
    const foot = { x: start.x + along * (end.x - start.x), y: start.y + along * (end.y - start.y), z: start.z + along * (end.z - start.z) }
    const offLine = length(point, foot)
    /** 超出 `[0,1]` 的那一段，按长度计（`t<0` 是在起点这一侧的延长线上）。 */
    const outside = along < 0 ? -along * span : along > 1 ? (along - 1) * span : 0
    const tolerance = distanceTolerance(span)
    const detail = offLine > tolerance
      ? `实测点 ${name} 到直线 ${from}${to} 的距离 ${formatNumber(offLine)}（0 = 正好在这条线上）—— 它**根本不在** ${from}${to} 这条线上。`
      : outside > tolerance
        ? `点 ${name} 确实在直线 ${from}${to} 上，但**不在线段内**：参数 t=${formatNumber(along)} 落在 [0,1] 之外（超出 ${formatNumber(outside)}）—— 题面说的是「${from}${to} 上一点」，而这是**延长线**上的一点，两件事。`
        : `点 ${name} 落在线段 ${from}${to} 上（参数 t=${formatNumber(along)}，到直线距离 ${formatNumber(offLine)}）。`
    return { actual: Math.max(offLine, outside), expected: 0, tolerance, detail }
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
  if (item.kind === "acuteTriangle") {
    if (vertices.length !== 3) return null
    const [a, b, c] = vertices as Vector3[]
    if (a === undefined || b === undefined || c === undefined) return null
    const angleAt = (vertex: Vector3, first: Vector3, second: Vector3): number | null => {
      const u = subtractVector3(first, vertex)
      const v = subtractVector3(second, vertex)
      const denominator = lengthVector3(u) * lengthVector3(v)
      if (!(denominator > 1e-12)) return null
      return (Math.acos(Math.min(1, Math.max(-1, dotVector3(u, v) / denominator))) * 180) / Math.PI
    }
    const angles = [angleAt(a, b, c), angleAt(b, a, c), angleAt(c, a, b)]
    if (angles.some((angle) => angle === null)) return null
    const maximum = Math.max(...(angles as number[]))
    return { actual: maximum >= 90 ? maximum - 90 + 1 : 0, expected: 0, tolerance: 1e-9 }
  }
  if (item.kind === "rightTriangle" || item.kind === "obtuseTriangle") {
    if (vertices.length !== 3) return null
    const [a, b, c] = vertices as Vector3[]
    if (a === undefined || b === undefined || c === undefined) return null
    const angleAt = (vertex: Vector3, first: Vector3, second: Vector3): number | null => {
      const u = subtractVector3(first, vertex)
      const v = subtractVector3(second, vertex)
      const denominator = lengthVector3(u) * lengthVector3(v)
      if (!(denominator > 1e-12)) return null
      return (Math.acos(Math.min(1, Math.max(-1, dotVector3(u, v) / denominator))) * 180) / Math.PI
    }
    const angles = [angleAt(a, b, c), angleAt(b, a, c), angleAt(c, a, b)]
    if (angles.some((angle) => angle === null)) return null
    const values = angles as number[]
    if (item.kind === "rightTriangle") {
      return { actual: Math.min(...values.map((angle) => Math.abs(angle - 90))), expected: 0, tolerance: 1e-6 }
    }
    return { actual: Math.max(...values) > 90 ? 0 : 1, expected: 0, tolerance: 1e-9 }
  }
  if (item.kind === "pointInsideTriangle") {
    if (vertices.length !== 4) return null
    const [p, a, b, c] = vertices as Vector3[]
    if (p === undefined || a === undefined || b === undefined || c === undefined) return null
    const ab = subtractVector3(b, a)
    const ac = subtractVector3(c, a)
    const normal = crossVector3(ab, ac)
    const normalLength = lengthVector3(normal)
    if (!(normalLength > 1e-12)) return null
    const distance = Math.abs(dotVector3(subtractVector3(p, a), normal)) / normalLength
    if (distance > 1e-6) return { actual: 1, expected: 0, tolerance: 1e-9 }
    const project = (value: Vector3): [number, number] =>
      Math.abs(normal.x) >= Math.abs(normal.y) && Math.abs(normal.x) >= Math.abs(normal.z)
        ? [value.y, value.z]
        : Math.abs(normal.y) >= Math.abs(normal.z) ? [value.x, value.z] : [value.x, value.y]
    const [ax, ay] = project(a)
    const [bx, by] = project(b)
    const [cx, cy] = project(c)
    const [px, py] = project(p)
    const side = (x1: number, y1: number, x2: number, y2: number): number => (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)
    const sides = [side(ax, ay, bx, by), side(bx, by, cx, cy), side(cx, cy, ax, ay)]
    const inside = sides.every((value) => value >= -1e-9) || sides.every((value) => value <= 1e-9)
    return { actual: inside ? 0 : 1, expected: 0, tolerance: 1e-9 }
  }
  if (item.kind === "vectorDot") {
    if (numeric === undefined || vertices.length !== 6) return null
    const [abA, abB, aoA, aoB, rhsA, rhsB] = vertices as Vector3[]
    if (abA === undefined || abB === undefined || aoA === undefined || aoB === undefined || rhsA === undefined || rhsB === undefined) return null
    const left = numeric * dotVector3(subtractVector3(abB, abA), subtractVector3(aoB, aoA))
    const right = dotVector3(subtractVector3(rhsB, rhsA), subtractVector3(rhsB, rhsA))
    return { actual: left, expected: right, tolerance: 1e-6 }
  }
  if (item.kind === "dihedral") {
    if (numeric === undefined) return null
    const [e, b, c, d] = vertices as Vector3[]
    const detail = dihedralAngleDetail3([b, c, e], [b, c, d], b, c)
    return detail === null ? null : { actual: detail.interiorDegrees, expected: numeric, tolerance: ANGLE_TOLERANCE_DEGREES }
  }
  /**
   * **平面上的数值角**（§3-F）：`targets` 恰好三个点名、中间那个是顶点，量的是**内部角**。
   *
   * 判据**自己算**（`acos` 两条边的方向向量），不读任何构造过程留下的量 —— 与二面角那条同一条纪律。
   * 三点里有重合（方向向量退化为 0）时返回 `null`（如实"未核验"，而不是把一个 0/0 说成一个角）。
   */
  if (item.kind === "chordCenterDistance") {
    /**
     * **弦心距**（2026-10-20）：圆心到弦 `AB` 那条**直线**的距离。
     *
     * 用的是图上那个圆的圆心（`figures.circle`），不是题面里可能出现的 `O` ——
     * 那条义务的 `targets` 只有弦的两个端点，圆心是"问图"得来的。
     */
    const circle = figures.circle
    if (circle === null || numeric === undefined || item.targets.length !== 2) return null
    const [first, second] = [at(0), at(1)]
    const alongX = second.x - first.x
    const alongY = second.y - first.y
    const chordLength = Math.hypot(alongX, alongY)
    if (!(chordLength > 1e-12)) return null
    // 点到直线的距离：|叉积| / |AB|（二维，取 x–y 平面上那一段）。
    const distance = Math.abs(alongX * (circle.centerY - first.y) - alongY * (circle.centerX - first.x)) / chordLength
    return {
      actual: distance,
      expected: numeric,
      tolerance: distanceTolerance(numeric),
      detail: `实测圆心 (${circle.centerX.toPrecision(6)}, ${circle.centerY.toPrecision(6)}) 到弦 AB 的距离 ${distance.toPrecision(6)}，弦长 ${chordLength.toPrecision(6)}；题设要求弦心距 ${numeric}。`
    }
  }
  if (item.kind === "arcLength") {
    /**
     * **弧长**（2026-10-20）：`r · θ`，`θ` 是两条半径之间的夹角。
     *
     * **取劣弧**（`θ ∈ [0, π]`）：题面写「优弧」时读取器就不收（`(?<!优)`），
     * 所以这里没有"选哪条弧"的余地 —— 一条义务只对应一条弧。
     */
    const circle = figures.circle
    if (circle === null || numeric === undefined || item.targets.length !== 2) return null
    const [first, second] = [at(0), at(1)]
    const firstX = first.x - circle.centerX
    const firstY = first.y - circle.centerY
    const secondX = second.x - circle.centerX
    const secondY = second.y - circle.centerY
    const firstRadius = Math.hypot(firstX, firstY)
    const secondRadius = Math.hypot(secondX, secondY)
    if (!(firstRadius > 1e-12) || !(secondRadius > 1e-12)) return null
    const cosine = (firstX * secondX + firstY * secondY) / (firstRadius * secondRadius)
    const radians = Math.acos(Math.min(1, Math.max(-1, cosine)))
    const length = circle.radius * radians
    if (!Number.isFinite(length)) return null
    return {
      actual: length,
      expected: numeric,
      tolerance: distanceTolerance(numeric),
      detail: `实测半径 ${circle.radius.toPrecision(6)}、两条半径的夹角 ${((radians * 180) / Math.PI).toPrecision(6)}°，劣弧长 ${length.toPrecision(6)}；题设要求弧长 ${numeric}。`
    }
  }
  if (item.kind === "angleBisector") {
    /**
     * **角平分线**（2026-10-20）：`targets = [D, A, B, C]`，`A` 是顶点、`AD` 是那条平分线。
     *
     * 判两件事，**必须一起判**：
     * 1. `∠BAD = ∠DAC` —— 两个角相等；
     * 2. `∠BAD + ∠DAC = ∠BAC` —— `D` 在角**内部**。
     *
     * 只判第 1 条的话，`D` 落在平分线的**反方向**上时两个角同样相等（`A(0,0)、B(4,0)、
     * C(0,4)、D(-2,-2)` ⇒ 两个 135°，而 `∠BAC` 只有 90°），可那条射线根本不在角里 ——
     * 那就把一句"平分这个角"读成了"在这条直线上"。残余取两者较大者。
     */
    if (item.targets.length !== 4) return null
    const point = at(0)
    const vertex = at(1)
    const angleAt = (first: Vector3, third: Vector3): number | null => {
      const alongFirst = subtractVector3(first, vertex)
      const alongThird = subtractVector3(third, vertex)
      const magnitudes = lengthVector3(alongFirst) * lengthVector3(alongThird)
      if (!(magnitudes > 1e-12)) return null
      const cosine = dotVector3(alongFirst, alongThird) / magnitudes
      return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI
    }
    const betweenFirst = angleAt(at(2), point)
    const betweenSecond = angleAt(point, at(3))
    const whole = angleAt(at(2), at(3))
    if (betweenFirst === null || betweenSecond === null || whole === null) return null
    const imbalance = Math.abs(betweenFirst - betweenSecond)
    const outside = Math.abs(betweenFirst + betweenSecond - whole)
    return {
      actual: Math.max(imbalance, outside),
      expected: 0,
      tolerance: ANGLE_TOLERANCE_DEGREES,
      detail: outside > ANGLE_TOLERANCE_DEGREES
        ? `实测 ∠BAD = ${betweenFirst.toPrecision(6)}°、∠DAC = ${betweenSecond.toPrecision(6)}°，而 ∠BAC = ${whole.toPrecision(6)}° —— 这个点不在角**内部**（平分线的反方向上，两个角碰巧也相等）；题设要求 AD 平分 ∠BAC。`
        : `实测 ∠BAD = ${betweenFirst.toPrecision(6)}°、∠DAC = ${betweenSecond.toPrecision(6)}°（∠BAC = ${whole.toPrecision(6)}°）；题设要求 AD 平分 ∠BAC。`
    }
  }
  if (item.kind === "planarAngle") {
    if (numeric === undefined) return null
    const [first, vertex, third] = vertices as Vector3[]
    const alongFirst = subtractVector3(first, vertex)
    const alongThird = subtractVector3(third, vertex)
    const magnitudes = lengthVector3(alongFirst) * lengthVector3(alongThird)
    if (!(magnitudes > 1e-12)) return null
    const cosine = dotVector3(alongFirst, alongThird) / magnitudes
    const degrees = (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI
    return { actual: degrees, expected: numeric, tolerance: ANGLE_TOLERANCE_DEGREES }
  }
  /**
   * **面积**（Task 11，2026-10-12）：三个点名 ⇒ 三角形面积 = ½·|AB × AC|，**从最终坐标自己算**。
   *
   * 与角那一条同一条纪律：不读构造过程留下的量 —— 否则"造出来的面积"与"量出来的面积"
   * 是同一份数据，"只满足正弦定理而不核面积的图是错误图"（调研 §2.1）就永远抓不到。
   * 三点共线时面积是 0：那是**合法读数**（不是"算不出"），所以照实返回。
   */
  if (item.kind === "area") {
    if (numeric === undefined) return null
    if (vertices.length !== 3) return null
    const [first, second, third] = vertices as Vector3[]
    const cross = crossVector3(subtractVector3(second, first), subtractVector3(third, first))
    const area = lengthVector3(cross) / 2
    if (!Number.isFinite(area)) return null
    // 面积是 L²（不是无量纲），所以容差随量级走 —— 与 `obligationIR.toleranceFor` 同一把尺子。
    return { actual: area, expected: numeric, tolerance: Math.max(UNITLESS_TOLERANCE, UNITLESS_TOLERANCE * Math.max(1, numeric)) }
  }
  /**
   * **线面角**（Task 13 边界：斜棱柱的明说倾角，2026-10-14）。
   *
   * 判据**自己从最终坐标算**：线方向 `v` 与平面法向 `n` 满足 `sin(线面角) = |v·n| / (|v||n|)` ——
   * 不读构造过程留下的量（那是"读得懂但没人核"的反面：这条角的判据只有这一处）。
   *
   * `targets` 的前两个是线段、其余是平面（与 `planePerpendicular` 同一条约定，`planeLengths` 同义）。
   * 线段退化为一点、平面三点共线（法向为 0）时返回 `null`：如实"未核验"，而不是把 0/0 报成一个角。
   */
  if (item.kind === "linePlaneAngle") {
    if (numeric === undefined) return null
    const lineCount = item.planeLengths?.[0] ?? 2
    if (lineCount !== 2 || vertices.length < 5) return null
    const [from, to, first, second, third] = vertices as Vector3[]
    const direction = subtractVector3(to!, from!)
    const normal = crossVector3(subtractVector3(second!, first!), subtractVector3(third!, first!))
    const denominator = lengthVector3(direction) * lengthVector3(normal)
    if (!(denominator > 1e-12)) return null
    const sine = Math.abs(dotVector3(direction, normal)) / denominator
    const degrees = (Math.asin(Math.min(1, Math.max(0, sine))) * 180) / Math.PI
    return { actual: degrees, expected: numeric, tolerance: ANGLE_TOLERANCE_DEGREES }
  }
  /**
   * **函数与直线的交点个数**（Task 15 的边界，2026-10-14）。
   *
   * 判据数的是**图上那条曲线**与题面那条直线的交点（`functionLineRoots`：代数路径给精确根、
   * 数值路径带 `complete`），不读构造过程留下的量 —— 与函数值、切线那两条同一条纪律。
   *
   * **`complete === false` ⇒ 未核验，不是 failed**：数值路径自己说"这个个数不能当个数用"
   * （分辨不出的近重根）时，报"个数不对"就是拿一个算不准的量去指责用户。
   */
  if (item.kind === "functionLineIntersections") {
    if (numeric === undefined || item.line === undefined || figures.curve === null) return null
    // 竖直线与 `y = f(x)` 至多一个交点：这一档按"函数图与直线求交"的判据**不适用**，如实留白。
    if (item.line.kind === "vertical") return null
    const roots = functionLineRoots(figures.curve.expression, figures.curve.domain, { slope: item.line.slope, intercept: item.line.intercept })
    if (!roots.complete) return null
    const actual = roots.roots.length
    return {
      actual,
      expected: numeric,
      // 个数是整数：容差 0（与 `obligationIR.toleranceFor` 同一把尺子）。
      tolerance: 0,
      evidence: roots.grade,
      detail: `图上这条曲线与题面那条直线量到 ${actual} 个交点（题面说 ${numeric} 个）。`
    }
  }
  const kind = item.kind === "perpendicular" ? "perpendicular" : "parallel"
  /**
   * **平面可以用 3–6 个点名**（S2：底面支持 3–6 边）。多余的点先核**共面性**，
   * 再把前三个点交给既有的"线面残差"（它只认三点平面）。
   *
   * 此前只处理了"恰好四点"（`vertices.length === 6`）：五边形底面的 `PA ⊥ 平面 ABCDE`
   * 于是掉进 `checkedTargets = 全部 7 个` 那一支，残差认不出来 ⇒ 一律"未核验"。
   */
  const planeCount = vertices.length - 2
  if (planeCount > 3) {
    const origin = at(2)
    const normal = crossVector3(subtractVector3(at(3), origin), subtractVector3(at(4), origin))
    const magnitude = lengthVector3(normal)
    if (magnitude <= 1e-10) return null
    for (let index = 5; index < vertices.length; index += 1) {
      if (Math.abs(dotVector3(normal, subtractVector3(at(index), origin))) / magnitude > distanceTolerance(1)) return null
    }
  }
  const checkedTargets = planeCount > 3 ? item.targets.slice(0, 5) : item.targets
  const residual = relationResidual({ kind, targets: checkedTargets.map((vertex) => ({ vertex })) }, (target) => points.get(target.vertex) ?? null)
  return residual === null ? null : { actual: residual, expected: 0, tolerance: UNITLESS_TOLERANCE }
}

/**
 * **圆锥曲线 / 切线 / 函数曲线都不带点名**：拿"点表建不出来"当理由会给出一个与它们无关的解释。
 * （切线的来源是**函数**，曲线的来源是**表达式**，都不是点名点集。）
 *
 * 抽成一个函数是因为它现在有**两处**消费者：核验本身，与"题设点到、图上却没有的点名"那条
 * 查询（`missingNamedPoints`）—— 两处各写一遍就是"同一个判断写了两遍"。
 */
function isPointBased(kind: DiagramObligationKind): boolean {
  return kind !== "conicAxes" && kind !== "conicChord" && kind !== "tangentAt" && kind !== "functionGraph" && kind !== "solidDimension"
}

/** 题设点到、而候选图上**没有**的那个点名。 */
export interface MissingNamedPoint {
  kind: DiagramObligationKind
  /** 题设原文（面板与假设文案都要用它）。 */
  sourceText: string
  /** 这条题设点到的全部点名，按题面顺序。 */
  targets: readonly string[]
  /** 其中图上的点名表里确实没有的那些（去重、保持题面顺序）。 */
  missing: readonly string[]
  /** 题面写下的数值（`DE=2EA` 的 `2`）—— 比例分点的构造参数由它算出来。 */
  value?: number
}

/**
 * **题设点到、而候选图上没有的点名**（2026-10-10）。
 *
 * 现场（用户这台机器上 7 次、逐字相同的失败）：模型只交了一笔四面体，题面里的
 * `O为 BD的中点` 是**系统自己**从原话抽的题设，而 `O` 在图上不存在 ⇒ 那条题设永远无法核验
 * ⇒ 门禁判 `failed`、整轮不提交。这一条查询就是"缺哪些名字"的唯一来源：
 * 编译器拿它去**按题设补建**（只补题设唯一确定了构造的那些，见 `planCompiler`），
 * 核验器拿它把理由**说清缺谁**。
 *
 * **点名表建不出来时（`null`）返回空数组**：那时"缺谁"根本无从谈起，报告给的是另一句理由
 *（"候选图缺少唯一、可靠的顶点名映射"），两边不许混。
 */
export function missingNamedPoints(set: DiagramObligationSet, plan: PlanEnvelope, candidate: GeometryDocument, base?: GeometryDocument): MissingNamedPoint[] {
  const mapped = candidatePoints(plan, candidate, base)
  if (!mapped.ok) return []
  const points = mapped.points
  const out: MissingNamedPoint[] = []
  for (const item of set.givens) {
    if (!isPointBased(item.kind)) continue
    const missing = [...new Set(item.targets.filter((name) => !points.has(name)))]
    if (missing.length === 0) continue
    out.push({
      kind: item.kind,
      sourceText: item.sourceText,
      targets: item.targets,
      missing,
      ...(item.value === undefined ? {} : { value: item.value })
    })
  }
  return out
}

/**
 * **这一轮核验的证据范围**（Task 15）—— 报告的三个范围字段只有这一个来源。
 *
 * 为什么写成函数而不是在三处各写一遍字面量：`draftStore` 在"追加操作后旧证据失效"那条路上
 * **自己拼过一份报告**，测试夹具也各自拼过。三处各写一遍，就会出现"面板上写着图形实例、
 * 另一条路上的报告写着别的东西"—— 那时用户看到的范围取决于他从哪条路进来。
 *
 * 规则只有一条：**图上带参数取值就是 `parameter-instance`**（那只是"在这些取值上成立"），
 * 而无论哪种，`universalClaims` 今天都**只能是** `"not-proven"`。
 */
export function proofScopeOf(parameters: Readonly<Record<string, { value: number }>>): Pick<DiagramVerificationReport, "proofScope" | "universalClaims" | "proofScopeNote"> {
  const parameterNames = Object.keys(parameters)
  if (parameterNames.length === 0) {
    return {
      proofScope: "figure-instance",
      universalClaims: "not-proven",
      proofScopeNote: "这一轮核验的是**这一个图形实例**：数值回代在候选图上成立，不等于「全定义域 / 全参数都成立」的证明。"
    }
  }
  const instance = Object.fromEntries(parameterNames.map((name) => [name, parameters[name].value]))
  return {
    proofScope: "parameter-instance",
    universalClaims: "not-proven",
    proofScopeNote: judgeUniversalClaim({ scope: "at-parameters", parameterNames }, [instance]).reason
  }
}

/**
 * **`O` 约定为原点**（Task 14 的边界「面积核验要求图上真有那个点名」，2026-10-14）。
 *
 * 解析几何里 `O` **就是原点**（`△OAB` 的面积、`OA` 的长都以它为原点），而一道题里
 * 常常**不会**把 `O` 画出来（图上只有椭圆、直线与 A/B）—— 于是那条面积/长度条件
 * 永远停在"点名缺失：O，未核验"，用户与门禁都没法往前走。
 *
 * 这一档把它按**约定**补上：`O` 取 `(0, 0)`，并在**那条判据自己的理由里**写明这件事
 *（"系统替你做的选择要显形"——`diagramVerification` 的 checks 就是面板上那一列，
 * 所以披露写在 `reason` 里，不需要另开一条通道）。
 *
 * **不认约定的三种情形**（都不猜）：
 * - 图上**已经有** `O` 这个点名 —— 那时它就是图上那个点；
 * - 题面**用坐标定义过** `O`（`pointCoordinate`）—— 那时 O 在哪由题面说了算；
 * - 题面**用构造定义过** `O`（`O为 BD的中点` / 分点那一类）—— 那是"题面点名、系统补建"
 *   那条路的事（见 `planCompiler.namedPoints.test.ts`），拿约定去顶它会把它顶坏。
 */
export const ORIGIN_POINT_NAME = "O"

export function statedOriginNames(set: DiagramObligationSet, drawn: { has(name: string): boolean }): string[] {
  if (drawn.has(ORIGIN_POINT_NAME)) return []
  const usesOrigin = set.givens.some((item) => item.targets.includes(ORIGIN_POINT_NAME))
  if (!usesOrigin) return []
  const definedByPrompt = set.givens.some((item) => {
    if (item.kind === "pointCoordinate" || item.kind === "midpoint") return item.targets[0] === ORIGIN_POINT_NAME
    // 分点那一类：`O` 是不是"被算出来的那个点"由内核那一处判据说了算（不另写一套）。
    if (item.kind === "segmentRatio") return ratioParameterFor(item.targets, ORIGIN_POINT_NAME, item.value).ok
    return false
  })
  return definedByPrompt ? [] : [ORIGIN_POINT_NAME]
}

export function verifyDiagramObligations(set: DiagramObligationSet, plan: PlanEnvelope, candidate: GeometryDocument, base?: GeometryDocument, options: DiagramVerificationOptions = {}): DiagramVerificationReport {
  const mapped = candidatePoints(plan, candidate, base)
  const points = mapped.ok ? mapped.points : null
  /** 建不出点名表时**那一句理由**（见 `CandidatePointMap`）：面板上那一列就是它，所以要说清是哪一种缺。 */
  const pointMapReason = mapped.ok ? null : mapped.reason
  /**
   * **`O` 按约定补成原点**（见 `statedOriginNames`）：补的是**这一份核验**用的点名表，
   * 不往文档里加任何东西 —— 图上没有 O 这件事仍然是真的，所以披露写在判据理由里。
   */
  const originNames = points === null ? [] : statedOriginNames(set, points)
  for (const name of originNames) points?.set(name, { x: 0, y: 0, z: 0 })
  const figures: FigureContext = {
    conic: candidateConic(plan, candidate, base),
    tangent: candidateTangent(plan, candidate, base),
    commonTangents: candidateCommonTangents(plan, candidate, base),
    curve: candidateCurve(plan, candidate, base),
    solid: candidateSolid(plan, candidate, base),
    circle: candidateCircle(plan, candidate, base),
    planarPoints: candidate.primitives.flatMap((primitive) =>
      primitive.type === "point" && typeof primitive.label === "string" && Number.isFinite(primitive.x) && Number.isFinite(primitive.y)
        ? [{ name: primitive.label, x: primitive.x, y: primitive.y }]
        : []
    )
  }
  const checks: DiagramCheck[] = set.givens.map((item) => {
    const pointBased = isPointBased(item.kind)
    if (pointBased && points === null) {
      return {
        kind: item.kind,
        sourceText: item.sourceText,
        status: "unverified",
        reason: `候选图缺少可靠的点名映射：${pointMapReason ?? "原因不明"}；不能按题面顺序猜坐标。`
      }
    }
    const result = calculate(item, points ?? new Map(), figures)
    if (result === null) {
      /**
       * **先说清缺谁**（2026-10-10）：原先只有一句把三种成因混起来的
       * "点名缺失、图形退化或角度无法计算"，用户与模型都读不出下一步。
       * 点名表在手上时，"缺谁"是**算得出来的**，所以这一段把它写出来；
       * 退化 / 算不出角度仍然落回原句（那时缺的不是名字）。
       */
      const missing = pointBased && points !== null ? [...new Set(item.targets.filter((name) => !points.has(name)))] : []
      return {
        kind: item.kind,
        sourceText: item.sourceText,
        status: "unverified",
        reason: missing.length > 0
          ? `点名缺失：${missing.join("、")} —— 题面点到了它${missing.length > 1 ? "们" : ""}，图上没有这个对象，未核验。`
          : item.kind === "conicAxes"
            ? "候选图里没有唯一、可读的圆锥曲线（少了或多了一条），未核验。"
            : item.kind === "conicChord"
              ? "候选图里没有唯一、可读的圆锥曲线，或题面那条直线的写法没读出来，未核验。"
              : item.kind === "tangentAt"
              ? "候选图里没有唯一、可读的切线，或那条切线没有函数来源（求不了导），未核验。"
              : item.kind === "commonTangent"
                ? "候选图里没有足够且可读的公切线，或两条函数来源无法独立核验，未核验。"
              : item.kind === "pointOnConic"
                ? "候选图里没有唯一、可读的圆锥曲线（少了或多了一条），或那个点的坐标不是有限数，未核验。"
                : item.kind === "functionGraph"
                ? "候选图里没有唯一、可读的函数曲线（少了或多了一条），或题面表达式解析不了，未核验。"
              : item.kind === "chordCenterDistance"
                ? "候选图里没有唯一、可读的圆（少了或多了一条），或弦的两个端点在图上没有点名，未核验。"
                : item.kind === "arcLength"
                  ? "候选图里没有唯一、可读的圆（少了或多了一条），或弧的两个端点在图上没有点名，未核验。"
                  : item.kind === "solidDimension"
                /**
                 * **实体尺寸量不出来的四种来路**（说清是哪一种，用户才知道下一步该改什么）：
                 * 候选图里没有那条实体 / 形状对不上 / 底面是三角形（N = 3 分不出哪一张是底面）/
                 * 底面不是正多边形（"底边长"没有唯一的数）。
                 */
                ? "候选图里没有唯一、可量的这条实体（少了或多了一条），或这个形状量不出这个尺寸（例如正三棱锥的底面分不出是哪三张面、底面不是正多边形），未核验。"
                : "点名缺失、图形退化或角度无法计算，未核验。"
      }
    }
    const status = Math.abs(result.actual - result.expected) <= result.tolerance ? "passed" : "failed"
    /**
     * **披露**：这一条用到了"`O` 按原点"这个约定时，在它自己的理由里写出来 ——
     * 面板上那一列就是这份 `reason`，用户看得见系统替他定了什么（与"代表值"同一条纪律）。
     */
    const originNote = originNames.length > 0 && item.targets.includes(ORIGIN_POINT_NAME)
      ? `（\`O\` 按**原点** (0, 0) 取：图上没有这个点名，这是解析几何的常用约定，不是图上量出来的。）`
      : ""
    const baseReason = result.detail !== undefined
      ? (status === "passed" ? result.detail : `${result.detail}最大偏差 ${result.actual.toPrecision(5)}，容差 ${result.tolerance.toPrecision(5)}。`)
      : (status === "passed" ? "已按候选图坐标核验。" : `实测 ${result.actual.toPrecision(5)}，题设要求 ${result.expected}。`)
    const reason = `${baseReason}${originNote}`
    return {
      kind: item.kind,
      sourceText: item.sourceText,
      status,
      reason,
      expected: result.expected,
      actual: result.actual,
      ...(result.evidence === undefined ? {} : { evidence: result.evidence })
    }
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
  /**
   * **证据范围写在报告自己身上**（Task 15）。
   *
   * 为什么不是"让调用方自己判断"：`passed` 这个词太容易被下游读成"这道题对了"。
   * 几何作图给出的是**数值/图形证据**：图上带参数取值时更弱 —— 那只是"在这些取值上成立"。
   * 范围由 `proofScopeOf` 唯一地推出来（`draftStore` 拼旧证据那条路用的是同一个函数）。
   */
  return {
    status,
    checks,
    sampleValues,
    ...proofScopeOf(candidate.parameters),
    ...(options.obligationIR === true ? { obligationIR: buildObligationIR(set) } : {})
  }
}
