import { createEmptyDocument } from "@draw/dsl"
import { compilePlan, type PlanCompileResult } from "@draw/agent-core"
import { commitTransaction, recomputeDerivedObjects } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { CONIC_INVARIANT_PROMPT, conicInvariantPlan, obliquePrismEdges, obliquePrismSectionPlan } from "./representativeFixtures"

/**
 * **代表题的几何真的成立吗**（Fix round 1 / C1；规格 §8.2）。
 *
 * 这一组用例存在的理由是一次真实缺陷：夹具把不变量写成
 * `9/(3*cos θ)^2 + 4/(2*sin θ)^2`，而 `OA` 被当成了 P 的横坐标 —— 那条表达式其实是
 * `sec²θ + csc²θ`（θ=0.4 时 ≈ 7.77），**不是 1**。当时没有任何用例**求过它的值**：
 * 单测只验参数存在，e2e 只验假设文案，于是"表达式保持 1"这条验收条款从未被检验。
 *
 * 所以这里走的是**真实的求值路径**：`compilePlan` 编出草稿文档 →
 * `recomputeDerivedObjects`（预览/导出用的那一条，`operations.ts`）按表达式重算参数 →
 * 断言不变量在若干 θ 上保持 1，并顺带验证 A/B 真的落在切线与坐标轴的交点上。
 *
 * **数值采样不是形式证明**：这一组用例是"在若干 θ 上核对"，不是对任意 θ 的证明。
 * 规格 §10 明令不许把前者说成后者，所以夹具的假设里带着那句话，这里也再钉一次。
 */
function compiledConic(): PlanCompileResult {
  const result = compilePlan(conicInvariantPlan(), {
    document: createEmptyDocument("conics"),
    workspace: "conics",
    conversationId: "fixture-test",
    prompt: CONIC_INVARIANT_PROMPT
  })
  if (!result.ok) throw new Error(`the conic fixture must compile: ${JSON.stringify(result.diagnostics)}`)
  return result
}

/** 在给定的 θ 上重算整份文档（预览 / 导出走的就是这一条）。 */
function recomputeAt(document: NonNullable<PlanCompileResult["draftDocument"]>, theta: number) {
  return recomputeDerivedObjects({
    ...document,
    parameters: { ...document.parameters, theta: { ...document.parameters.theta, value: theta, expression: undefined } }
  })
}

function positionOf(document: ReturnType<typeof recomputeAt>, id: string): { x: number; y: number } {
  const primitive = document.primitives.find((candidate) => candidate.id === id)
  if (!primitive || primitive.type !== "point") throw new Error(`expected a planar point ${id}`)
  return { x: primitive.x, y: primitive.y }
}

describe("the representative conic fixture is mathematically right", () => {
  it("keeps 9/OA^2 + 4/OB^2 equal to 1 as theta varies", () => {
    const compiled = compiledConic()
    const document = compiled.draftDocument
    if (!document) throw new Error("expected a draft document")

    for (const theta of [0.4, 1.0, 2.0]) {
      const recomputed = recomputeAt(document, theta)
      // 采样核对（不是形式证明）：`OA = 3/cos θ`、`OB = 2/sin θ`（切线与轴的交点），
      // 于是 9/OA² + 4/OB² = cos²θ + sin²θ = 1。
      expect(recomputed.parameters.invariant?.value, `theta=${theta}`).toBeCloseTo(1, 9)
    }
  })

  it("places the axis intersections A and B where the tangent at P actually meets the axes", () => {
    const compiled = compiledConic()
    const document = compiled.draftDocument
    if (!document) throw new Error("expected a draft document")

    for (const theta of [0.4, 1.0, 2.0]) {
      const recomputed = recomputeAt(document, theta)
      const a = positionOf(recomputed, compiled.aliases.A)
      const b = positionOf(recomputed, compiled.aliases.B)
      // 解析位置：A = (3/cos θ, 0)、B = (0, 2/sin θ)。
      expect(a.x, `A.x at theta=${theta}`).toBeCloseTo(3 / Math.cos(theta), 9)
      expect(a.y).toBeCloseTo(0, 12)
      expect(b.y, `B.y at theta=${theta}`).toBeCloseTo(2 / Math.sin(theta), 9)
      expect(b.x).toBeCloseTo(0, 12)

      // 而且它们真的在**切线上**（切线由内核在 P 处算出，这里只读它的读数）。
      const tangent = recomputed.primitives.find((primitive) => primitive.type === "tangent")
      expect(tangent?.type).toBe("tangent")
      if (tangent?.type !== "tangent") throw new Error("expected a tangent")
      const onTangent = (point: { x: number; y: number }) => tangent.point.y + tangent.slope * (point.x - tangent.point.x) - point.y
      expect(Math.abs(onTangent(a)), `A is on the tangent (theta=${theta})`).toBeLessThan(1e-6)
      expect(Math.abs(onTangent(b)), `B is on the tangent (theta=${theta})`).toBeLessThan(1e-6)
    }
  })

  it("drives P and the tangent from the symbolic parameter instead of a fixed point", () => {
    const compiled = compiledConic()
    const document = compiled.draftDocument
    if (!document) throw new Error("expected a draft document")

    const point = document.primitives.find((primitive) => primitive.id === compiled.aliases.P)
    expect(point).toMatchObject({ type: "point", binding: { kind: "onPath", parameterId: "theta" } })
    // 参数一变，P 与切线都动：这才是"任意点处"的题，而不是特值化成某一点。
    const before = recomputeAt(document, 0.4)
    const after = recomputeAt(document, 2.0)
    const pBefore = positionOf(before, compiled.aliases.P)
    const pAfter = positionOf(after, compiled.aliases.P)
    expect(Math.hypot(pAfter.x - pBefore.x, pAfter.y - pBefore.y)).toBeGreaterThan(1)
  })

  it("discloses that the sweep is numeric sampling, not a formal proof", () => {
    const plan = conicInvariantPlan()
    expect(plan.kind).toBe("plan")
    if (plan.kind !== "plan") throw new Error("expected a plan")
    expect((plan.assumptions ?? []).some((text) => text.includes("不是形式证明"))).toBe(true)
    // 编译层也必须给出同一个口径（`PlanVerification`）。
    expect(compiledConic().verification?.kind).toBe("numeric_sampling")
  })
})

/**
 * **棱柱夹具的中间量**：三边形 E-M-N 就是截面本身，所以"三个中点共面"这条验收
 * 在编译产物上是可验证的（不依赖界面读数）。
 *
 * 并且 —— **规格 §8.1 的"P 在截面边界上"在这里第一次被真的断言**（Fix round 1 / C2）：
 * 过 E/M/N 的平面以底棱 `B0B1` 为一条边，而 P 就绑在那条棱上，所以 P 的**任何**参数
 * 都落在截面边界上；`translatePrimitive3` 平移实体之后依然如此（"Solid 平移时所有对象跟随"）。
 */
describe("the representative prism fixture's section is a real cut", () => {
  const point3Of = (document: NonNullable<PlanCompileResult["draftDocument"]>, id: string) => {
    const primitive = document.primitives.find((candidate) => candidate.id === id)
    if (primitive?.type !== "point3") throw new Error(`expected a point3 ${id}`)
    return primitive
  }

  /** 点到线段的距离：`0` 表示点落在这条边上。 */
  function distanceToSegment(point: { x: number; y: number; z: number }, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): number {
    const ab = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
    const ap = { x: point.x - from.x, y: point.y - from.y, z: point.z - from.z }
    const lengthSquared = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z
    const t = Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / lengthSquared))
    const closest = { x: from.x + ab.x * t, y: from.y + ab.y * t, z: from.z + ab.z * t }
    return Math.hypot(point.x - closest.x, point.y - closest.y, point.z - closest.z)
  }

  it("cuts the solid exactly through the three midpoints", () => {
    const result = compilePlan(obliquePrismSectionPlan(), {
      document: createEmptyDocument("geometry3d"),
      workspace: "geometry3d",
      conversationId: "fixture-test"
    })
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
    const document = result.draftDocument
    if (!document) throw new Error("expected a draft document")

    const section = document.primitives.find((primitive) => primitive.type === "section")
    expect(section?.type).toBe("section")
    if (section?.type !== "section") throw new Error("expected a section")
    // 截面确实切到了实体（不是 `none`），并且有闭合的多边形边界。
    expect(section.classification).toBe("polygon")
    expect(section.points.length).toBeGreaterThanOrEqual(3)

    for (const alias of ["E", "M", "N"]) {
      const point = document.primitives.find((primitive) => primitive.id === result.aliases[alias])
      expect(point, alias).toMatchObject({ type: "point3", binding: { kind: "onHost", parameter: 0.5 } })
      if (point?.type !== "point3") throw new Error("expected a point3")
      // 中点在截面上：到平面的距离为零（截面平面就在文档里）。
      const distance = Math.abs(section.plane.normal.x * point.position.x + section.plane.normal.y * point.position.y + section.plane.normal.z * point.position.z + section.plane.constant)
      expect(distance, `${alias} is on the section plane`).toBeLessThan(1e-9)
    }
  })

  it("keeps P on the section boundary at every parameter, including after translating the solid", () => {
    const result = compilePlan(obliquePrismSectionPlan(), {
      document: createEmptyDocument("geometry3d"),
      workspace: "geometry3d",
      conversationId: "fixture-test"
    })
    const document = result.draftDocument
    if (!document) throw new Error("expected a draft document")
    const boundary = obliquePrismEdges().movingEdge

    // 宿主棱的两个端点都在截面多边形的边界上（相邻/首尾相接）→ 这条棱是截面的一条边。
    const section = document.primitives.find((primitive) => primitive.type === "section")
    if (section?.type !== "section") throw new Error("expected a section")
    const onPolygonEdge = (vertex: { x: number; y: number; z: number }) =>
      section.points.some((_, index) => distanceToSegment(vertex, section.points[index], section.points[(index + 1) % section.points.length]) < 1e-9)
    expect(onPolygonEdge(boundary.from), "B0 is a section boundary vertex").toBe(true)
    expect(onPolygonEdge(boundary.to), "B1 is a section boundary vertex").toBe(true)

    // P 在任何参数上都落在这条边界边上（含拖动中的中间位置）。
    for (const parameter of [0.2, 0.4, 0.7]) {
      const moved = recomputeDerivedObjects({
        ...document,
        primitives: document.primitives.map((primitive) =>
          primitive.id === result.aliases.P && primitive.type === "point3"
            ? ({ ...primitive, binding: { ...primitive.binding, kind: "onHost" as const, parameter } } as typeof primitive)
            : primitive
        )
      })
      const p = point3Of(moved, result.aliases.P)
      expect(distanceToSegment(p.position, boundary.from, boundary.to), `P at t=${parameter} is on the boundary edge`).toBeLessThan(1e-9)
    }

    /**
     * **Solid 平移时"所有对象跟随"只对了一半**（Fix round 1；规格 §8.1）。
     *
     * 平移实体之后：实体与 P **都跟着走了**（位移正确），但**截面没有跟着走** ——
     * 截面的平面存的是世界坐标，实体移开之后平面还是原来那个，于是截面被重算成空集
     *（下面的断言把这个事实钉出来）。这属于 `operations.ts` 的行为（另一个 worker 的文件），
     * 所以这里如实记录 + 用一条 `it.todo` 让它可见，而不是假装跟随成立。
     */
    const translated = recomputeDerivedObjects(commitTransaction({
      base: document,
      operations: [{ op: "translatePrimitive3", id: result.aliases.prism, delta: { x: 2, y: 1, z: 0 } }]
    }).document)
    const translatedP = point3Of(translated, result.aliases.P)
    expect(translatedP.position.x).toBeCloseTo(point3Of(document, result.aliases.P).position.x + 2, 6)
    expect(translatedP.position.y).toBeCloseTo(point3Of(document, result.aliases.P).position.y + 1, 6)
    const translatedSection = translated.primitives.find((primitive) => primitive.type === "section")
    if (translatedSection?.type !== "section") throw new Error("expected a section after the translation")
    // 现状：截面平面是世界坐标，实体平移之后不再相交 → 截面为空（**这条不是期望，是事实**）。
    expect(translatedSection.points).toHaveLength(0)
  })

  /**
   * **未达成项留痕**：规格 §8.1 的"Solid 平移时所有对象跟随"目前只对实体与点成立，
   * 截面（世界坐标平面）不跟随。修它要么在 `translatePrimitive3` 里同时平移截面平面，
   * 要么把截面平面改成相对实体的局部坐标 —— 都在 `operations.ts`（本切片不可改）。
   */
  it.todo("SPEC §8.1 (not implemented): the section follows the solid when the solid is translated")
})
