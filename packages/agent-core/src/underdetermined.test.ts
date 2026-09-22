import { describe, expect, it } from "vitest"

import { DEFAULT_DYNAMIC_POINT_PARAMETER, DEFAULT_PRISM_HEIGHT, DEFAULT_PRISM_SPAN, WITNESS_TRIANGLE } from "./localPlanDefaults"
import { firstAcceptableTriangle, isInvariantRequest, isNonSpecialTriangle, selectWitness, validatePrismWitness, validateTriangleWitness } from "./underdetermined"

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
  it("treats 'any/constant/invariant' phrasings as symbolic requests", () => {
    for (const prompt of ["求证 9/OA²+4/OB² 为定值", "画一个任意三角形", "这个量恒定不变", "点 P 在椭圆上任意移动"]) {
      expect(isInvariantRequest(prompt), prompt).toBe(true)
    }
    for (const prompt of ["画一个边长 3 的正方形", "在椭圆 x²/9+y²/4=1 上取一点作切线"]) {
      expect(isInvariantRequest(prompt), prompt).toBe(false)
    }
    expect(isInvariantRequest(undefined)).toBe(false)
  })

  it("preserves symbolic parameters instead of specialising an invariant request", () => {
    const result = selectWitness({ kind: "triangle", prompt: "画一个任意三角形 ABC" })

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
