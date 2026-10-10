import { describe, expect, it } from "vitest"

import { DEFAULT_DYNAMIC_POINT_PARAMETER, DEFAULT_PRISM_HEIGHT, DEFAULT_PRISM_SPAN, WITNESS_TRIANGLE } from "./localPlanDefaults"
import type { Relation } from "./relations"
import { firstAcceptableTriangle, isInvariantRequest, isNonSpecialTriangle, selectWitness, validatePrismWitness, validateTriangleWitness, type PolyhedronWitness } from "./underdetermined"

/**
 * **欠定题目的特值选择**（Agent DSL 切片 Task 3；规格 §6.3）。
 *
 * 规格把这件事写成两条互相牵制的规则：
 *
 * ```text
 * 欠定选择优先级：满足显式约束、保持非退化、避免特殊对称、使用小整数、最小化复杂度。
 * 若问题要求"任意""恒定""定值"，必须保留符号参数，不能特值化成单点。
 * ```
 *
 * 第一条是"必须能画出来"，第二条是"不许假装题目的结论"：一道"求证 9/OA² + 4/OB² 恒为 1"
 * 的题如果把 θ 特值成一个数，那份计划就**不再证明任何东西** —— 它变成了一个数值例子。
 * 所以这一层最重要的用例不是"选出了哪个特值"，而是"**什么时候不许选特值**"。
 */
describe("underdetermined witness selection", () => {
  it("allows an example for a static arbitrary diagram but not for a universal claim", () => {
    expect(isInvariantRequest("画一张任意四棱锥的示意图")).toBe(false)
    expect(isInvariantRequest("求证任意四棱锥都满足该结论")).toBe(true)
    expect(isInvariantRequest("点P在椭圆上任意移动")).toBe(true)
    const sample = selectWitness({ kind: "triangle", prompt: "画一个任意三角形 ABC 的示意图" })
    expect(sample.status).toBe("witness")
    if (sample.status === "witness") expect(sample.assumption.text).not.toContain("证明")
  })

  it("treats 'any/constant/invariant' phrasings as symbolic requests", () => {
    for (const prompt of ["求证 9/OA²+4/OB² 为定值", "证明任意三角形都成立", "这个量恒定不变", "点 P 在椭圆上任意移动"]) {
      expect(isInvariantRequest(prompt), prompt).toBe(true)
    }
    for (const prompt of ["画一个任意三角形", "画一个边长 3 的正方形", "在椭圆 x²/9+y²/4=1 上取一点作切线"]) {
      expect(isInvariantRequest(prompt), prompt).toBe(false)
    }
    expect(isInvariantRequest(undefined)).toBe(false)
  })

  it("preserves symbolic parameters instead of specialising an invariant request", () => {
    const result = selectWitness({ kind: "triangle", prompt: "证明任意三角形 ABC 都满足该结论" })

    expect(result.status).toBe("symbolic")
    if (result.status !== "symbolic") throw new Error("expected a symbolic witness")
    expect(result.value.symbols).toEqual(["A", "B", "C"])
    // 符号结果里**没有**任何坐标：特值化正是这一步要避免的事。
    expect(JSON.stringify(result.value)).not.toContain("x")
    expect(result.assumption.kind).toBe("symbolic")
    // "题目要求恒定"不是可以随手改掉的假设 → 不可覆盖。
    expect(result.assumption.overridable).toBe(false)
    expect(result.assumption.text).toContain("符号")
  })

  it("picks the documented non-special triangle and proves it through the kernel", () => {
    const result = selectWitness({ kind: "triangle", prompt: "画一个三角形" })

    expect(result.status).toBe("witness")
    if (result.status !== "witness" || result.value.kind !== "triangle") throw new Error("expected a triangle witness")
    // 规格 §6.3 的默认特值，逐字。
    expect(result.value).toMatchObject({ a: WITNESS_TRIANGLE.a, b: WITNESS_TRIANGLE.b, c: WITNESS_TRIANGLE.c })
    // 非退化的判据来自内核（`triangleCenter2` 的外心），不是这里自己发明的一条。
    expect(validateTriangleWitness({ a: WITNESS_TRIANGLE.a, b: WITNESS_TRIANGLE.b, c: WITNESS_TRIANGLE.c }).ok).toBe(true)
    expect(isNonSpecialTriangle(WITNESS_TRIANGLE)).toBe(true)
    expect(result.assumption.kind).toBe("witness")
    expect(result.assumption.overridable).toBe(true)
  })

  it("skips degenerate and special-symmetric candidates in the documented priority order", () => {
    const equilateral = { a: { x: 0, y: 0 }, b: { x: 2, y: 0 }, c: { x: 1, y: Math.sqrt(3) } }
    const rightIsosceles = { a: { x: 0, y: 0 }, b: { x: 2, y: 0 }, c: { x: 0, y: 2 } }
    const collinear = { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, c: { x: 2, y: 0 } }

    const picked = firstAcceptableTriangle([collinear, equilateral, rightIsosceles, WITNESS_TRIANGLE])

    expect(picked).not.toBeNull()
    expect(picked?.triangle).toMatchObject(WITNESS_TRIANGLE)
    // 三个被跳过的候选各自留下理由 —— "为什么不是等边三角形"必须能回答。
    expect(picked?.considered).toHaveLength(4)
    expect(picked?.considered[0]).toContain("degenerate")
    expect(picked?.considered[1]).toContain("symmetry")
    expect(picked?.considered[2]).toContain("symmetry")
    // 一个都不可接受时返回 null，而不是硬塞一个退化三角形。
    expect(firstAcceptableTriangle([collinear])).toBeNull()
  })

  it("keeps explicit constraints verbatim, even when a generated default would differ", () => {
    const explicit = { a: { x: 0, y: 0 }, b: { x: 6, y: 0 }, c: { x: 0, y: 2 } }
    const result = selectWitness({ kind: "triangle", prompt: "画三角形", constraints: { triangle: explicit } })

    expect(result.status).toBe("witness")
    if (result.status !== "witness" || result.value.kind !== "triangle") throw new Error("expected a triangle witness")
    expect(result.value).toMatchObject(explicit)
    // 显式约束不是"我替你定的"，所以它不该被写成假设。
    expect(result.assumption.text).toContain("你给出")
  })

  it("rejects a degenerate explicit constraint instead of drawing something that is not a triangle", () => {
    const result = selectWitness({ kind: "triangle", constraints: { triangle: { a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, c: { x: 2, y: 2 } } } })

    expect(result.status).toBe("rejected")
    expect(result.diagnostics.some((entry) => entry.code === "degenerate_witness")).toBe(true)
    expect(result.diagnostics[0].stage).toBe("geometry_validation")
  })

  it("uses a horizontal default slope and the documented prism span/height", () => {
    const slope = selectWitness({ kind: "slope", prompt: "求这条直线的斜率" })
    expect(slope.status).toBe("witness")
    if (slope.status === "witness" && slope.value.kind === "slope") expect(slope.value.value).toBe(0)
    // 题目要求"恒为 k"时必须留着 k。
    expect(selectWitness({ kind: "slope", prompt: "证明斜率恒为 k" }).status).toBe("symbolic")

    const prism = selectWitness({ kind: "prism", prompt: "画一个棱柱" })
    expect(prism.status).toBe("witness")
    if (prism.status !== "witness" || prism.value.kind !== "prism") throw new Error("expected a prism witness")
    expect(prism.value.basePolygon).toHaveLength(4)
    expect(prism.value.basePolygon[2]).toEqual({ x: DEFAULT_PRISM_SPAN, y: DEFAULT_PRISM_SPAN, z: 0 })
    expect(prism.value.vector).toEqual({ x: 0, y: 0, z: DEFAULT_PRISM_HEIGHT })
    // 生成的候选也必须过内核判据（零体积 / 自交 / 共面）。
    expect(validatePrismWitness(prism.value.basePolygon, prism.value.vector).ok).toBe(true)

    const zeroVector = selectWitness({ kind: "prism", constraints: { vector: { x: 0, y: 0, z: 0 } } })
    expect(zeroVector.status).toBe("rejected")
    expect(zeroVector.diagnostics.some((entry) => entry.code === "degenerate_witness")).toBe(true)

    const movingPoint = selectWitness({ kind: "moving_point", prompt: "点 P 在棱上滑动" })
    expect(movingPoint.status).toBe("witness")
    if (movingPoint.status === "witness" && movingPoint.value.kind === "moving_point") expect(movingPoint.value.parameter).toBe(DEFAULT_DYNAMIC_POINT_PARAMETER)
  })
})

/**
 * **多面体见证**（设计 2026-10-03 §5.4）。
 *
 * 这一族要解决的是用户现场那句话："在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD" ——
 * 只有关系、没有数值，过去根本画不出来（不规则立体只能走 `solid.create_polyhedron`，
 * 而它的顶点与面环是必填、零默认）。
 *
 * 与其它族的关键区别：候选**不可能预置**（满足"PA ⊥ 底面"的坐标取决于题面），所以候选由模型
 * 给出，`selectWitness` 只负责按规格 §6.3 的优先级**筛选**。
 *
 * **本批没有产品调用点**（执行前的范围裁定）：这些用例钉的是这一层自己的能力；真正解掉报障的
 * 是 `planCompiler` 里的关系核验。不要把它读成"它修好了报障"。
 */
const PYRAMID: PolyhedronWitness = {
  vertices: [
    { x: 0, y: 0, z: 4 }, // v0 = P
    { x: 0, y: 0, z: 0 }, // v1 = A
    { x: 2, y: 0, z: 0 }, // v2 = B
    { x: 2, y: 3, z: 0 }, // v3 = C
    { x: 0, y: 3, z: 0 } // v4 = D
  ],
  names: ["v0", "v1", "v2", "v3", "v4"],
  // 底面 ABCD + 四个侧面，绕向**暴力搜出来的合法组合**（这个顶点的四棱锥只有 2 组合法）：
  // 我第一版手推的绕向被内核判 inconsistent-winding，四个侧面全错 —— 拓扑别手推。
  faces: [[1, 2, 3, 4], [0, 2, 1], [0, 3, 2], [0, 4, 3], [0, 1, 4]]
}

const PYRAMID_RELATIONS: Relation[] = [
  // PA ⊥ 平面 ABCD：5 个顶点 = 前两个定线、后三个定平面。
  { id: "PA-perp-base", kind: "perpendicular", targets: [{ vertex: "v0" }, { vertex: "v1" }, { vertex: "v1" }, { vertex: "v2" }, { vertex: "v3" }] },
  { id: "BC-parallel-AD", kind: "parallel", targets: [{ vertex: "v2" }, { vertex: "v3" }, { vertex: "v1" }, { vertex: "v4" }] },
  { id: "AB-perp-AD", kind: "perpendicular", targets: [{ vertex: "v1" }, { vertex: "v2" }, { vertex: "v1" }, { vertex: "v4" }] }
]

describe("polyhedron witness selection", () => {
  it("accepts a candidate only when every declared relation holds", () => {
    const result = selectWitness({ kind: "polyhedron", prompt: "画出这个四棱锥", candidates: [PYRAMID], relations: PYRAMID_RELATIONS })

    expect(result.status).toBe("witness")
    if (result.status !== "witness" || result.value.kind !== "polyhedron") throw new Error("expected a polyhedron witness")
    // 系统挑的值必须**看得见、可改**（设计 §1 验收判据 4、5）。
    expect(result.assumption.kind).toBe("witness")
    expect(result.assumption.overridable).toBe(true)
    // 假设那句话要写清是"系统选取的示例值"，否则用户会以为题面给了这些数。
    expect(result.assumption.text).toContain("示例值")
  })

  it("prefers a readable valid witness over an equally valid but extremely stretched one", () => {
    const tall: PolyhedronWitness = { ...PYRAMID, vertices: [{ x: 0, y: 0, z: 100 }, ...PYRAMID.vertices.slice(1)] }
    const result = selectWitness({ kind: "polyhedron", prompt: "画一张四棱锥示意图", candidates: [tall, PYRAMID], relations: PYRAMID_RELATIONS })
    expect(result.status).toBe("witness")
    if (result.status === "witness" && result.value.kind === "polyhedron") {
      expect(result.value.vertices[0].z).toBe(4)
      expect(result.considered.join(" ")).toContain("候选 0")
      expect(result.considered.join(" ")).toContain("候选 1")
    }
  })
  it("skips a candidate that violates a declared relation, and says why", () => {
    // P 偏到 (1, 0, 4)：PA 不再垂直于底面。
    const skewed: PolyhedronWitness = { ...PYRAMID, vertices: [{ x: 1, y: 0, z: 4 }, ...PYRAMID.vertices.slice(1)] }

    const result = selectWitness({ kind: "polyhedron", prompt: "画出这个四棱锥", candidates: [skewed], relations: PYRAMID_RELATIONS })

    expect(result.status).toBe("rejected")
    // `considered` 是既有字段，正好用来解释"我为什么没选它"。
    // 断言真实的措辞（"未满足某条关系"），不写一个恰好能匹配上的泛词。
    expect(result.considered.join(" ")).toContain("未满足 PA-perp-base")
  })

  it("skips a candidate whose geometry the kernel rejects, even if no relation is declared", () => {
    // 面环绕向不一致 —— 内核对这一条会报 inconsistent-winding。
    const badWinding: PolyhedronWitness = { ...PYRAMID, faces: [[1, 2, 3, 4], [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 1, 4]] }

    const result = selectWitness({ kind: "polyhedron", prompt: "画出这个四棱锥", candidates: [badWinding], relations: [] })

    expect(result.status).toBe("rejected")
    expect(result.considered.join(" ")).toContain("degenerate")
  })

  it("rejects when there are no candidates at all, rather than inventing coordinates", () => {
    const result = selectWitness({ kind: "polyhedron", prompt: "画出这个四棱锥", candidates: [], relations: PYRAMID_RELATIONS })

    expect(result.status).toBe("rejected")
    expect(result.diagnostics.some((entry) => entry.code === "no_acceptable_witness")).toBe(true)
  })

  it("chooses a condition-valid sample for an arbitrary drawing but not for a universal proof", () => {
    const sample = selectWitness({ kind: "polyhedron", prompt: "画一个任意四棱锥的示意图", candidates: [PYRAMID], relations: PYRAMID_RELATIONS })
    expect(sample.status).toBe("witness")
    if (sample.status === "witness") expect(sample.assumption.text).toContain("示例值")

    const proof = selectWitness({ kind: "polyhedron", prompt: "证明任意四棱锥都满足结论", candidates: [PYRAMID], relations: PYRAMID_RELATIONS })
    expect(proof.status).toBe("symbolic")
  })
})
