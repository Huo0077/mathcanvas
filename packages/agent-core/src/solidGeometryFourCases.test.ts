/**
 * **11 月 5 日四道立体几何题：阶段集成测试**（实施计划 T1 起的持续护栏）。
 *
 * 见 [实施计划](../../../../docs/superpowers/plans/2026-11-05-solid-geometry-four-cases.md) §3。
 *
 * ## 这份文件怎么读
 *
 * 它把每一道题跑过**同一条产品链路**：`parseObligationWithLegacy → specForPrompt → searchWitness`
 * （`searchWitness` 内部走 `compilePlan` + `verifyDiagramObligations`），然后把**每一阶段**的读数
 * 打出来。一个失败消息里就能看出"卡在哪一层"，而不是只有一句"画不出来"。
 *
 * ## 断言的形态
 *
 * T1 先落的是**特征化基线**（断言"今天卡在哪一层"）；T2–T5 已把它们逐条换成**目标断言**：
 * Case 1–3 的完整链路必须通过，每一层都留下可复核的理由。到 T7 收尾时本文件不得残留
 * 任何"预期失败"的断言（计划 §Global Constraints：不得把断言永久改成预期报错来让测试变绿）。
 */

import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
import { constructShapeFromSpec, type Vector3 } from "@draw/geometry-kernel"
import { parseObligationWithLegacy } from "./obligationIR"
import { compilePlan } from "./planCompiler"
import { tryBuildPolygonFoldPlan } from "./polygonFoldPlan"
import { searchWitness, specForPrompt } from "./solver/witnessSearch"
import {
  CASE_1,
  CASE_2,
  CASE_3,
  CASE_4_ORIGINAL,
  CASE_4_REVISED,
  ORIGINAL_CASES,
  REVISED_CASES,
  type SolidGeometryCase
} from "./fixtures/solidGeometryFourCases"

const MAX_CANDIDATES = 16
const TIMEOUT_MS = 10_000

/** 一条链路走完之后的逐阶段读数（**只描述实况，不含期望**）。 */
interface CaseStageReport {
  id: string
  parse: {
    givens: number
    /** 每条 `given` 的 `kind`，按题面顺序 —— 用来看"哪一句没进题设"。 */
    kinds: string[]
    unverified: { sourceText: string; reason: string }[]
  }
  shape:
    | { status: "ok"; family: string; base: string[]; apex: string | null; top: string[] | null; freeScalars: string[] }
    | { status: "unrecognised"; reason: string }
  search: { status: string; detail: string[] }
}

/** 跑一道题，把每个阶段的结果收集成一份读数。**不猜、不修、不吞异常。** */
function stagesOf(entry: SolidGeometryCase): CaseStageReport {
  const parsed = parseObligationWithLegacy(entry.prompt)
  const givens = parsed.ir.obligations.filter((obligation) => obligation.role === "given")
  const shaped = specForPrompt(entry.prompt, givens)
  const report: CaseStageReport = {
    id: entry.id,
    parse: {
      givens: givens.length,
      kinds: givens.map((obligation) => obligation.kind),
      unverified: parsed.ir.unverified.map((item) => ({ sourceText: item.sourceText, reason: item.reason }))
    },
    shape:
      shaped.status === "ok"
        ? {
            status: "ok",
            family: shaped.recognised.family,
            base: [...shaped.spec.base],
            apex: shaped.spec.apex?.at ?? null,
            top: shaped.spec.top === undefined ? null : [...shaped.spec.top],
            freeScalars: shaped.spec.freeScalars.map((scalar) => scalar.id)
          }
        : { status: "unrecognised", reason: shaped.reason },
    search: { status: "not-run", detail: ["形状描述没有成立，搜索层不会开始。"] }
  }
  if (shaped.status !== "ok") return report
  const searched = searchWitness({
    obligations: parsed.ir,
    shape: shaped.recognised.family,
    spec: shaped.spec,
    seed: 1,
    maxCandidates: MAX_CANDIDATES,
    timeoutMs: TIMEOUT_MS
  })
  const detail: string[] =
    searched.status === "verified_instance"
      ? [
          `names=${searched.candidate.names.join(",")}`,
          `aux=${(searched.candidate.auxiliaryPoints ?? [])
            .map((point) => `${point.name}@${point.hostEdge.join("")}:${point.parameter.toFixed(6)}`)
            .join(",")}`
        ]
      : searched.status === "no_witness"
        ? [...searched.failures]
        : [...searched.reasons]
  report.search = { status: searched.status, detail }
  return report
}

/** 失败消息里带上"卡在哪一层"，省得再手跑一遍。 */
function summary(report: CaseStageReport): string {
  return [
    `${report.id}`,
    `  解析：givens=${report.parse.givens}，残留=${report.parse.unverified.length}`,
    `  形状：${report.shape.status === "ok" ? `ok family=${report.shape.family} base=${report.shape.base.join("")}` : `unrecognised —— ${report.shape.reason}`}`,
    `  搜索：${report.search.status}`,
    ...report.search.detail.map((line) => `    ${line}`)
  ].join("\n")
}

describe("11-05 四道立体几何题：阶段基线（T1）", () => {
  const original = new Map(ORIGINAL_CASES.map((entry) => [entry.id, stagesOf(entry)]))
  const revised = new Map(REVISED_CASES.map((entry) => [entry.id, stagesOf(entry)]))

  it("Case 1：直角梯形底 + PA⊥底面 + E 为 PB 中点 —— 全链路核验通过", () => {
    const report = original.get(CASE_1.id)!
    /** 连等式 `PA=AB=AD=2` 已经被展开成三条定长 + 两条等长（T2 只需加回归，不重复实现）。 */
    expect(report.parse.givens, summary(report)).toBe(10)
    expect(report.parse.unverified, summary(report)).toEqual([])
    expect(report.shape.status, summary(report)).toBe("ok")
    if (report.shape.status !== "ok") return
    expect(report.shape.base).toEqual(["A", "B", "C", "D"])
    expect(report.shape.apex).toBe("P")
    /**
     * **T5 之后：整条链走通**。`E 为 PB 中点` 落成辅助点（绑在 `PB` 上、参数 1/2），
     * 于是题设里那一条按名字说的条件也有了可核验的对象。
     */
    expect(report.search.status, summary(report)).toBe("verified_instance")
    expect(report.search.detail.join("\n"), summary(report)).toContain("aux=E@PB:0.500000")
  })

  it("Case 2：正三棱柱 + 顶点保留 `A₁B₁C₁` + D/E 分点 —— 全链路核验通过", () => {
    const report = original.get(CASE_2.id)!
    expect(report.parse.givens, summary(report)).toBe(5)
    expect(report.parse.kinds).toEqual(["fixedLength", "fixedLength", "midpoint", "pointOnSegment", "fixedLength"])
    expect(report.parse.unverified, summary(report)).toEqual([])
    /** T2 之后：形状描述成立，且**顶环是题面的 `A₁B₁C₁`**，不是默认的 `A′B′C′`。 */
    expect(report.shape.status, summary(report)).toBe("ok")
    if (report.shape.status !== "ok") return
    expect(report.shape.family).toBe("prism")
    expect(report.shape.base).toEqual(["A", "B", "C"])
    expect(report.shape.top).toEqual(["A₁", "B₁", "C₁"])
    /**
     * **T5 之后：`D`（AC 中点，参数 1/2）与 `E`（BB₁ 上 `BE=1` ⇒ 参数 1/3）都落地**。
     * 参数来自**题面给的长度除以宿主边长**，不是系统挑的（`AA₁=3`、`BE=1` ⇒ 1/3）。
     */
    expect(report.search.status, summary(report)).toBe("verified_instance")
    const detail = report.search.detail.join("\n")
    expect(detail, summary(report)).toContain("aux=")
    expect(detail, summary(report)).toMatch(/D@AC:0\.500000/)
    expect(detail, summary(report)).toMatch(/E@BB₁:0\.333333/)
  })

  it("Case 3：菱形底 + 对角线交点 O + M 为 PC 中点 —— 全链路核验通过", () => {
    const report = original.get(CASE_3.id)!
    /** T4 之后：`AC与BD相交于点O` 与 `底面…是边长为2的菱形` 都不再是残留。 */
    expect(report.parse.unverified, summary(report)).toEqual([])
    expect(report.shape.status, summary(report)).toBe("ok")
    if (report.shape.status !== "ok") return
    expect(report.shape.family).toBe("pyramid")
    expect(report.shape.base).toEqual(["A", "B", "C", "D"])
    expect(report.shape.apex).toBe("P")
    /** 底面环仍然**严格**只有 A/B/C/D（O 不是环顶点）。 */
    expect(report.shape.base).not.toContain("O")
    /** **T5 之后**：`O`（辅助点）与 `M`（PC 中点，参数 1/2）都落地，整条链通过。 */
    expect(report.search.status, summary(report)).toBe("verified_instance")
    const detail = report.search.detail.join("\n")
    expect(detail, summary(report)).toMatch(/O@AC:0\.500000/)
    expect(detail, summary(report)).toMatch(/M@PC:0\.500000/)
  })

  it("Case 4 原题：折叠入口依据折痕轴不动推导 D→P，保留折前叠影线，直接成功出图", () => {
    const report = original.get(CASE_4_ORIGINAL.id)!
    expect(report.parse.givens, summary(report)).toBe(8)
    /** `AD=CD=1` 的连等式同样已展开；三条长度都在。 */
    expect(report.parse.kinds.filter((kind) => kind === "fixedLength")).toHaveLength(3)
    /** 立体形状描述仍然认不出（它是平面图形 + 翻折，不属于棱锥/棱柱那条链）。 */
    expect(report.shape.status, summary(report)).toBe("unrecognised")
    expect(report.search.status, summary(report)).toBe("not-run")
    /**
     * 原题直接出图：依据轴不动拓扑映射 D→P，保留折前叠影线，且能编译通过。
     */
    const built = tryBuildPolygonFoldPlan({ prompt: CASE_4_ORIGINAL.prompt })
    expect(built.status, JSON.stringify(built)).toBe("ok")
    if (built.status !== "ok") return
    const compiled = compilePlan(built.plan, { document: createEmptyDocument("geometry3d"), prompt: CASE_4_ORIGINAL.prompt, conversationId: "four-cases-orig", documentGeneration: 0 })
    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("；")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
  })

  it("Case 4 修订版：与原题是两份固定题面，且**修订版可作图**", () => {
    const report = revised.get(CASE_4_REVISED.id)!
    expect(report.parse.givens, summary(report)).toBe(8)
    expect(report.shape.status, summary(report)).toBe("unrecognised")
    /** 修订版与原文**不是**同一段题面：`D→P` 与 `CD 指折前` 都写进去了。 */
    expect(CASE_4_REVISED.prompt).not.toBe(CASE_4_ORIGINAL.prompt)
    expect(CASE_4_REVISED.prompt).toContain("固定A、C")
    expect(CASE_4_REVISED.prompt).toContain("指折前")
    expect(CASE_4_REVISED.ambiguity).toBeNull()
    /** **T6**：明确修订版出计划，且能编译。 */
    const built = tryBuildPolygonFoldPlan({ prompt: CASE_4_REVISED.prompt })
    expect(built.status, JSON.stringify(built)).toBe("ok")
    if (built.status !== "ok") return
    const compiled = compilePlan(built.plan, { document: createEmptyDocument("geometry3d"), prompt: CASE_4_REVISED.prompt, conversationId: "four-cases", documentGeneration: 0 })
    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("；")).toBe(true)
  })

  /**
   * **关系保真**（计划 T2 第 2 条）：连等式里**每一条长度**都要进入题设，
   * 而"E 在 BB₁ 上且 BE=1"不能被读成"中点"。
   *
   * 这条挡的是原报告"只解析首段赋值、后续等式被丢弃"的判断 —— 实测**不成立**：
   * `PA=AB=AD=2` 已经是四条独立题设。把它写成断言，以后谁改坏连等式解析都会红。
   */
  it("关系保真：连等式每条长度都进入题设，`BE=1` 不是『中点』，目标不混进 givens", () => {
    const obligationsOf = (prompt: string) => parseObligationWithLegacy(prompt).ir.obligations
    const lengthsOf = (prompt: string): string[] =>
      obligationsOf(prompt)
        .filter((obligation) => obligation.role === "given" && obligation.kind === "fixedLength")
        .map((obligation) => `${obligation.targets.join("")}=${String(obligation.expected)}`)
        .sort()

    expect(lengthsOf(CASE_1.prompt)).toEqual(["AB=2", "AD=2", "CD=1", "PA=2"])
    expect(lengthsOf(CASE_4_ORIGINAL.prompt)).toEqual(["AB=2", "AD=1", "CD=1"])

    const case2 = obligationsOf(CASE_2.prompt)
    expect(
      case2
        .filter((obligation) => obligation.kind === "fixedLength")
        .map((obligation) => `${obligation.targets.join("")}=${String(obligation.expected)}`)
    ).toContain("BE=1")
    /** `BE=1` 是**定长**，不是"中点"：中点只属于 `D`（`AC` 的中点）。 */
    expect(case2.filter((obligation) => obligation.kind === "midpoint").map((obligation) => obligation.targets[0])).toEqual(["D"])
    expect(case2.filter((obligation) => obligation.kind === "pointOnSegment").map((obligation) => obligation.targets[0])).toEqual(["E"])

    /**
     * **目标不进入 givens**：`求证 AE⊥平面PBC` 与 `求直线PC与平面ADE所成角的正弦值`
     * 都必须是 `goal` 角色；把它们当成约束去"修正"图形正是设计 §4.2 第 2 条禁止的事。
     */
    const case1 = obligationsOf(CASE_1.prompt)
    const givens = case1.filter((obligation) => obligation.role === "given")
    expect(givens.some((obligation) => obligation.sourceText.includes("求证") || obligation.sourceText.includes("所成角"))).toBe(false)
    expect(case1.filter((obligation) => obligation.role === "goal").length).toBeGreaterThan(0)

    /** **Case 3 的两句**（T4）：菱形 ⇒ 三条等长 + 一条边长；对角线交点 ⇒ 两条"点在线上"。 */
    const case3 = obligationsOf(CASE_3.prompt)
    expect(case3.filter((obligation) => obligation.kind === "equalLength").map((obligation) => obligation.targets.join(""))).toEqual([
      "ABBC",
      "BCCD",
      "CDDA"
    ])
    expect(
      case3
        .filter((obligation) => obligation.kind === "fixedLength")
        .map((obligation) => `${obligation.targets.join("")}=${String(obligation.expected)}`)
    ).toContain("AB=2")
    expect(case3.filter((obligation) => obligation.kind === "pointOnSegment").map((obligation) => obligation.targets.join(""))).toEqual(["OAC", "OBD"])
  })

  it("无法理解的内容继续显示为残留（不静默丢掉）", () => {
    const parsed = parseObligationWithLegacy("在四棱锥P-ABCD中，PA⊥平面ABCD，且点F到平面ABC的距离为2")
    expect(parsed.ir.unverified.map((entry) => entry.sourceText)).toContain("且点F到平面ABC的距离为2")
  })

  /**
   * **T3：底面的解析构造**（2026-11-05 四题修复）。
   *
   * 这一组不经过搜索层（搜索还会因为辅助点没落地而报 unverified），
   * 直接看**内核按 spec 造出来的底面坐标**：长度、平行、垂直一律自己量。
   */
  describe("T3 底面解析构造", () => {
    const candidateOf = (entry: SolidGeometryCase) => {
      const givens = parseObligationWithLegacy(entry.prompt).ir.obligations.filter((obligation) => obligation.role === "given")
      const shaped = specForPrompt(entry.prompt, givens)
      expect(shaped.status, JSON.stringify(shaped)).toBe("ok")
      if (shaped.status !== "ok") throw new Error("形状描述没有成立")
      expect(shaped.spec.freeScalars.map((scalar) => scalar.id), `${entry.id} 不该再有自由标量（长度都由题面给定）`).toEqual([])
      const constructed = constructShapeFromSpec(shaped.spec)
      expect(constructed.status, JSON.stringify(constructed)).toBe("candidate")
      if (constructed.status !== "candidate") throw new Error("底面没有构造出来")
      return constructed.witness
    }

    const at = (built: { names: string[]; points: Vector3[] }, name: string): Vector3 => {
      const index = built.names.indexOf(name)
      if (index < 0) throw new Error(`候选里没有 ${name}；现有：${built.names.join("、")}`)
      return built.points[index]!
    }

    it("Case 1：底面是直角梯形（AB=2、AD=2、CD=1），不是矩形", () => {
      const built = candidateOf(CASE_1)
      const a = at(built, "A")
      const b = at(built, "B")
      const c = at(built, "C")
      const d = at(built, "D")
      const distance = (left: Vector3, right: Vector3) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)
      expect(distance(a, b), "AB").toBeCloseTo(2, 9)
      expect(distance(a, d), "AD").toBeCloseTo(2, 9)
      expect(distance(c, d), "CD").toBeCloseTo(1, 9)
      const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
      const ad = { x: d.x - a.x, y: d.y - a.y, z: d.z - a.z }
      const cd = { x: d.x - c.x, y: d.y - c.y, z: d.z - c.z }
      expect(Math.abs(ab.x * ad.x + ab.y * ad.y + ab.z * ad.z), "AD⊥AB").toBeLessThan(1e-9)
      expect(Math.abs(ab.x * cd.y - ab.y * cd.x), "AB∥CD").toBeLessThan(1e-9)
      /** 矩形会把 `BC` 也做成 2 —— 那正是这条用例要挡住的事。 */
      expect(distance(b, c), "BC ≠ AD（等长就是矩形）").not.toBeCloseTo(2, 6)
      /** 底面严格共面、顶点在 A 正上方 2。 */
      for (const point of [a, b, c, d]) expect(point.z).toBe(0)
      const p = at(built, "P")
      expect(Math.hypot(p.x - a.x, p.y - a.y)).toBeLessThan(1e-12)
      expect(p.z - a.z).toBeCloseTo(2, 9)
    })

    it("Case 2：正三棱柱的底面是**正三角形**（三边都等于 2），不是任意三角形", () => {
      const built = candidateOf(CASE_2)
      const a = at(built, "A")
      const b = at(built, "B")
      const c = at(built, "C")
      const distance = (left: Vector3, right: Vector3) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)
      expect(distance(a, b)).toBeCloseTo(2, 9)
      expect(distance(b, c), "BC=2（正三角形的第二条边）").toBeCloseTo(2, 9)
      expect(distance(c, a), "CA=2（正三角形的第三条边）").toBeCloseTo(2, 9)
      /** 侧棱长 AA₁=3、且竖直：顶面就是底面平移 (0,0,3)。 */
      const a1 = at(built, "A₁")
      expect(a1.z - a.z).toBeCloseTo(3, 9)
      expect(Math.hypot(a1.x - a.x, a1.y - a.y)).toBeLessThan(1e-12)
      /** 题面原名保留：顶面三个点就叫 `A₁B₁C₁`，不是 `A′B′C′`。 */
      expect(built.names.filter((name) => name.endsWith("₁"))).toEqual(["A₁", "B₁", "C₁"])
    })
  })

  /**
   * **T4：底面内部派生垂足**（2026-11-05）。
   *
   * Case 3 的 `O` 是 `AC` 与 `BD` 的交点，**不是**环顶点。这一组钉住三件事：
   * ① 底面环仍然严格只有 A/B/C/D；② `O` 作为辅助点带来源（落在 `AC` 上、参数 1/2）；
   * ③ `P` 在 `O` 正上方且 `PO = √3`，底面是 60° 菱形。
   */
  describe("T4 派生垂足", () => {
    const givensOf = (entry: SolidGeometryCase) =>
      parseObligationWithLegacy(entry.prompt).ir.obligations.filter((obligation) => obligation.role === "given")
    const builtOf = (entry: SolidGeometryCase) => {
      const shaped = specForPrompt(entry.prompt, givensOf(entry))
      expect(shaped.status, JSON.stringify(shaped)).toBe("ok")
      if (shaped.status !== "ok") throw new Error("形状描述没有成立")
      const constructed = constructShapeFromSpec(shaped.spec)
      expect(constructed.status, JSON.stringify(constructed)).toBe("candidate")
      if (constructed.status !== "candidate") throw new Error("没有构造出候选")
      return constructed.witness
    }
    const pointOf = (witness: { names: string[]; points: Vector3[] }, name: string): Vector3 => {
      const index = witness.names.indexOf(name)
      if (index < 0) throw new Error(`候选里没有 ${name}；现有：${witness.names.join("、")}`)
      return witness.points[index]!
    }

    it("Case 3：O = AC∩BD（在 AC 上、参数 1/2），P 在 O 正上方且 PO=√3", () => {
      const witness = builtOf(CASE_3)
      /** ① 底面环仍然是 A/B/C/D —— `O` 不在其中。 */
      expect(witness.names).toEqual(["A", "B", "C", "D", "P"])
      /** ② `O` 是辅助点，且**有来源**：落在 `AC` 上、参数 `|AO|/|AC|`；`M` 是 `PC` 中点。 */
      const auxiliary = witness.auxiliaryPoints ?? []
      const o = auxiliary.find((point) => point.name === "O")
      const m = auxiliary.find((point) => point.name === "M")
      expect(o, JSON.stringify(auxiliary)).toBeDefined()
      expect(m, JSON.stringify(auxiliary)).toBeDefined()
      expect(o!.hostEdge).toEqual(["A", "C"])
      expect(o!.parameter).toBeCloseTo(0.5, 9)
      expect(o!.source).toContain("BD")
      expect(m!.hostEdge).toEqual(["P", "C"])
      expect(m!.parameter).toBeCloseTo(0.5, 12)
      const oPoint = o!.point
      /** ③ 自己算：底面是 60° 菱形、O 是对角线交点、P 在 O 正上方 √3。 */
      const a = pointOf(witness, "A")
      const b = pointOf(witness, "B")
      const c = pointOf(witness, "C")
      const d = pointOf(witness, "D")
      const p = pointOf(witness, "P")
      const distance = (left: Vector3, right: Vector3) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)
      for (const side of [[a, b], [b, c], [c, d], [d, a]] as const) expect(distance(side[0], side[1])).toBeCloseTo(2, 9)
      const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
      const ad = { x: d.x - a.x, y: d.y - a.y, z: d.z - a.z }
      const cosine = (ab.x * ad.x + ab.y * ad.y + ab.z * ad.z) / (Math.hypot(ab.x, ab.y, ab.z) * Math.hypot(ad.x, ad.y, ad.z))
      expect((Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI).toBeCloseTo(60, 8)
      /** O 真的在两条对角线的交点上（不是"位置碰巧"的自由点）。 */
      expect(distance(oPoint, { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 })).toBeLessThan(1e-9)
      expect(distance(oPoint, { x: (b.x + d.x) / 2, y: (b.y + d.y) / 2, z: (b.z + d.z) / 2 })).toBeLessThan(1e-9)
      /** 顶点在 O 正上方、高 √3：`PO ⊥ 底面` 与 `PO = √3` 同时成立。 */
      expect(Math.hypot(p.x - oPoint.x, p.y - oPoint.y), "P 在 O 正上方").toBeLessThan(1e-12)
      expect(p.z - oPoint.z).toBeCloseTo(Math.sqrt(3), 9)
      /** 底面严格共面、且 z = 0（解析构造）。 */
      for (const point of [a, b, c, d, oPoint]) expect(point.z).toBe(0)
    })
  })

  it("四题的独立 oracle 是手抄坐标，且不满足『用实现生成期望值』（自检）", () => {
    /** 坐标数量与点名必须自洽：参考图里有几个点，goals 就必须有来源说明。 */
    for (const entry of [...ORIGINAL_CASES, ...REVISED_CASES]) {
      const names = Object.keys(entry.reference.points)
      expect(names.length, entry.id).toBeGreaterThan(0)
      for (const goal of entry.reference.goals) {
        expect(goal.statement.length, `${entry.id} 的目标缺少说明`).toBeGreaterThan(0)
      }
    }
    /**
     * **Case 1/2 的第一个待证结论是假的**（设计 §3）：这条 oracle 与"必须证出来"的直觉相反，
     * 所以单独钉住 —— 谁把实现改成"硬证出垂直"，这里就会说话。
     */
    expect(CASE_1.reference.goals[0]?.holds).toBe(false)
    expect(CASE_2.reference.goals[0]?.holds).toBe(false)
  })
})
