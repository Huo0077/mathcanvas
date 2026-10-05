import { isInvariantRequest } from "./invariantRequest"
import type { PolyhedronWitness } from "./solver/solverContracts"
import { selectPolyhedronWitness } from "./solver/witnessSearch"
import { rejectedSelection, selectWitnessWithoutSearch, symbolicSelection, type WitnessRequest, type WitnessSelection } from "./witnessSelection"

/**
 * **欠定题目的特值选择：兼容 facade**（Agent DSL 切片 Task 3；规格 §6.3；复核裁决 R13 / R29-B）。
 *
 * 这个文件现在只做两件事：
 *
 * 1. **polyhedron 那一族**：候选坐标来自调用方（模型算出来的），"哪一组合格"由
 *    `solver/witnessSearch.ts` 里**唯一一份**筛选 / 排序逻辑判定（R13），这里只把结果包回
 *    旧形状（`considered` / `assumption` / 诊断）；
 * 2. **对外包装与 re-export**：`selectWitness` 是既有调用方的入口，其余族
 *    （triangle / slope / prism / moving_point + 符号分支）整段住在叶子模块
 *    `witnessSelection.ts`。
 *
 * ## 为什么要拆（R29-B：断模块环，不是为了好看）
 *
 * `parameterAudit.ts` 要用选择器，而 `planCompiler.ts` 要用 `parameterAudit`。只要
 * "audit 用的选择器"还能走到 `planCompiler`（经 `solver/witnessSearch` 走既有编译路径物化候选），
 * 模块图就成环：
 *
 * ```text
 * parameterAudit -> underdetermined -> solver/witnessSearch -> planCompiler -> parameterAudit
 * ```
 *
 * 拆开之后，audit 只依赖 `witnessSelection.ts`（它的依赖全是能直接落到叶子的纯类型 / 纯函数），
 * 而 polyhedron 这条**需要编译器**的分支只留在本文件 —— 于是环断在这里。附带的好处是
 * "audit 不会请求 polyhedron"这件事**由类型保证**：`selectWitnessWithoutSearch` 只收
 * `Exclude<WitnessKind, "polyhedron">`。
 *
 * 行为逐字不变：`underdetermined.test.ts`（14 条）一字未改仍然全绿，
 * `considered` 文案、`assumption` 形状、诊断码都没有动。
 *
 * 原始口径仍然成立：polyhedron 是"只有关系、没有数值"的立体题面（四棱锥 P-ABCD 那类）
 * 唯一可能的出口，而**本批没有产品调用点**（`selectWitness` 的非测试调用点只有
 * `parameterAudit.ts`，它只请求 triangle / prism，走的是叶子那条路）。
 */

/**
 * 叶子模块的整份对外表面直接透出（`WitnessKind` / `WitnessRequest` / `WitnessSelection` /
 * `validateTriangleWitness` / `firstAcceptableTriangle` …）：搬迁之前这些名字都在本文件里，
 * `underdetermined.test.ts` 与 `@draw/agent-core` 的 barrel 都按老位置 import，所以一个都不能少。
 */
export * from "./witnessSelection"

export type { PolyhedronWitness }

export { isInvariantRequest }

/**
 * **多面体**（设计 2026-10-03 §5.4）：候选来自 `request`，这里只做**转调**（R13）。
 *
 * 与其它族的关键区别：其它族的候选是**常量表**（`witnessTriangleCandidates()`），
 * 而"四棱锥满足 PA ⊥ 底面"这组坐标不可能预置 —— 它取决于题面。所以候选来自调用方。
 *
 * **筛选与排序住在 `solver/witnessSearch.ts`**（计划 N2 的 Ownership："不得再出现
 * 两套候选选择逻辑"）：那边按规格 §6.3 的优先级先验显式关系（`verifyRelations`）、
 * 再验几何合法性（内核 `buildFromPoints`，与真正落盘时是同一个构造器），
 * 最后按可读性排序。这里只剩"把结果包回旧形状"。
 */
function selectPolyhedron(request: WitnessRequest & { kind: "polyhedron" }): WitnessSelection {
  const considered: string[] = []
  /**
   * **符号优先**（规格 §6.3 的硬要求）：任务要求普遍证明或动态参数时，连候选都不挑。
   * 这一段与叶子模块的第一段是同一条规则、同一份文案（`symbolicSelection`），
   * 只是 polyhedron 的分支不能整体转调叶子（它要编译器），所以在这里按同样的顺序重放一次。
   */
  if (isInvariantRequest(request.prompt)) {
    considered.push("symbolic: 题目要求任意/恒定，保留符号参数。")
    return symbolicSelection("polyhedron", considered)
  }

  const selection = selectPolyhedronWitness({ candidates: request.candidates ?? [], relations: request.relations ?? [] })
  considered.push(...selection.considered)
  if (selection.status === "none") return rejectedSelection("polyhedron", "no_acceptable_witness", "没有候选能同时满足题面关系与几何合法性。", considered)
  const candidate = selection.candidate
  const described = candidate.names
    .map((name, position) => `${name}(${candidate.vertices[position].x}, ${candidate.vertices[position].y}, ${candidate.vertices[position].z})`)
    .join("、")
  return {
    status: "witness",
    value: { kind: "polyhedron", ...candidate },
    assumption: {
      id: "witness:polyhedron",
      text: `题目没有给定具体尺寸，以下为系统选取的一组示例值（满足题面全部关系，可在属性栏修改）：${described}。`,
      kind: "witness",
      value: candidate,
      overridable: true,
      path: "witness.polyhedron"
    },
    considered,
    diagnostics: []
  }
}

/**
 * **挑一个满足显式约束、非退化、非特殊、尽量小的特值**（规格 §6.3）。
 *
 * `polyhedron` 需要搜索器（因此需要编译器）⇒ 留在本文件的 `selectPolyhedron`；
 * 其余族整段转调叶子模块 `witnessSelection.ts`。两边的顺序完全一致：
 * 符号优先 → 显式约束 → 候选表。
 */
export function selectWitness(request: WitnessRequest): WitnessSelection {
  if (request.kind === "polyhedron") return selectPolyhedron({ ...request, kind: "polyhedron" })
  return selectWitnessWithoutSearch({ ...request, kind: request.kind })
}
