import { describe, expect, it } from "vitest"

import type { CirclePrimitive, Coordinate, EllipsePrimitive, HyperbolaPrimitive, ParabolaPrimitive } from "@draw/dsl"

import { conicResidualAt, intersectLineWithConic } from "./conic-line"

/**
 * **代数**直线 ∩ 圆锥曲线（Task 14）。
 *
 * ## 为什么不能沿用采样法
 *
 * 仓里已有的 `intersectSampledPrimitives`（`curve-intersections.ts`）把曲线离散成折线再求线段交点，
 * 它的返回只有 `none / point / points / degenerate` —— **永远给不出 `tangent`**：相切与"两个极近的
 * 交点"在采样下无法区分，交点数取决于弦端点有没有跨过曲线，与**重数**无关。计划对 Task 14 的要求
 * 是原文：「切触用代数重根或可验证切向条件，**不用画面采样宣称恰有 n 个交点**」。
 *
 * ## 这一组用例的口径
 *
 * 判据一律**自己算**，不读被测函数自报的残差当结论：
 * - 交点在不在曲线上：直接代进曲线自己的方程（`x²/a² ± y²/b²`、`y² = 2px`）现算；
 * - 相切：既要求判别式那一支报 `tangent`，又要求**切向条件**成立（`∇Q(P) · d = 0`，自己算）。
 */
describe("代数直线 ∩ 圆锥曲线", () => {
  const ellipse: EllipsePrimitive = { id: "e", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2 }
  const hyperbola: HyperbolaPrimitive = { id: "h", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x" }
  const parabola: ParabolaPrimitive = { id: "p", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "x" }
  const circle: CirclePrimitive = { id: "c", type: "circle", center: { x: 0, y: 0 }, radius: 2 }

  /** 水平直线 `y = k`。 */
  const horizontal = (k: number) => ({ a: { x: -10, y: k }, b: { x: 10, y: k } })
  /** **竖直**直线 `x = k` —— 斜截式 `y = kx + m` 在这里根本写不出来，是这一层必须单独管的一支。 */
  const vertical = (k: number) => ({ a: { x: k, y: -10 }, b: { x: k, y: 10 } })
  const through = (first: Coordinate, second: Coordinate) => ({ a: first, b: second })

  /** 椭圆上的方程值（自己算，不用内核的隐式形式）：`x²/a² + y²/b² − 1`。 */
  const ellipseValue = (point: Coordinate, conic: EllipsePrimitive) =>
    (point.x - conic.center.x) ** 2 / conic.radiusX ** 2 + (point.y - conic.center.y) ** 2 / conic.radiusY ** 2 - 1
  /** 双曲线：`axis` 是**实轴**，`axis: "x"` ⇒ `x²/rx² − y²/ry² = 1`。 */
  const hyperbolaValue = (point: Coordinate, conic: HyperbolaPrimitive) => {
    const dx = point.x - conic.center.x
    const dy = point.y - conic.center.y
    return conic.axis === "x"
      ? dx * dx / conic.radiusX ** 2 - dy * dy / conic.radiusY ** 2 - 1
      : dy * dy / conic.radiusY ** 2 - dx * dx / conic.radiusX ** 2 - 1
  }
  /** 抛物线：`axis: "x"` ⇒ `y² = 2px`（顶点在 `vertex`）。 */
  const parabolaValue = (point: Coordinate, conic: ParabolaPrimitive) => {
    const dx = point.x - conic.vertex.x
    const dy = point.y - conic.vertex.y
    return conic.axis === "x" ? dy * dy - 2 * conic.focalParameter * dx : dx * dx - 2 * conic.focalParameter * dy
  }

  it("椭圆与一条割线：两个交点，且都在曲线上", () => {
    const result = intersectLineWithConic(horizontal(0), ellipse)
    expect(result.kind).toBe("secant")
    if (result.kind !== "secant") throw new Error("expected a secant")
    const xs = result.points.map((point) => point.x).sort((left, right) => left - right)
    expect(xs[0]).toBeCloseTo(-3, 9)
    expect(xs[1]).toBeCloseTo(3, 9)
    for (const point of result.points) expect(ellipseValue(point, ellipse)).toBeCloseTo(0, 9)
    // 割线**不是**相切：切向条件必须明显不成立（不然"相切"这个词就没有意义了）。
    expect(result.tangency).toBeGreaterThan(0.1)
  })

  it("椭圆与一条切线：报 tangent，切点在曲线上，且切向条件成立", () => {
    // `x²/9 + y²/4 = 1` 在 (0, 2) 的切线是 `y = 2`。
    const result = intersectLineWithConic(horizontal(2), ellipse)
    expect(result.kind).toBe("tangent")
    if (result.kind !== "tangent") throw new Error("expected a tangent")
    expect(result.point.x).toBeCloseTo(0, 9)
    expect(result.point.y).toBeCloseTo(2, 9)
    expect(ellipseValue(result.point, ellipse)).toBeCloseTo(0, 9)
    /** **可验证切向条件**：切线方向与曲线在该点的梯度垂直。自己算 ∇Q = (2x/a², 2y/b²)。 */
    const gradient = { x: 2 * result.point.x / ellipse.radiusX ** 2, y: 2 * result.point.y / ellipse.radiusY ** 2 }
    const direction = { x: 1, y: 0 }
    const perpendicular = (gradient.x * direction.x + gradient.y * direction.y) / (Math.hypot(gradient.x, gradient.y) * Math.hypot(direction.x, direction.y))
    expect(perpendicular).toBeCloseTo(0, 9)
    expect(result.tangency).toBeLessThan(1e-9)
  })

  it("椭圆与一条无交直线：none（不是 degenerate，也不是空的 secant）", () => {
    expect(intersectLineWithConic(horizontal(3), ellipse).kind).toBe("none")
  })

  it("**竖直线**：`x = 0` 是割线、`x = 3` 是切线 —— 斜截式表达不了这一支", () => {
    const secant = intersectLineWithConic(vertical(0), ellipse)
    expect(secant.kind).toBe("secant")
    if (secant.kind !== "secant") throw new Error("expected a secant")
    for (const point of secant.points) {
      expect(point.x).toBeCloseTo(0, 9)
      expect(ellipseValue(point, ellipse)).toBeCloseTo(0, 9)
    }
    const tangent = intersectLineWithConic(vertical(3), ellipse)
    expect(tangent.kind).toBe("tangent")
    if (tangent.kind !== "tangent") throw new Error("expected a tangent")
    expect(tangent.point.x).toBeCloseTo(3, 9)
    expect(tangent.point.y).toBeCloseTo(0, 9)
  })

  it("双曲线按**实轴**算：`x²/9 − y²/4 = 1` 与 `y = 0` 交于 (±3, 0)，与 `x = 3` 相切于顶点", () => {
    const secant = intersectLineWithConic(horizontal(0), hyperbola)
    expect(secant.kind).toBe("secant")
    if (secant.kind !== "secant") throw new Error("expected a secant")
    const xs = secant.points.map((point) => point.x).sort((left, right) => left - right)
    expect(xs[0]).toBeCloseTo(-3, 9)
    expect(xs[1]).toBeCloseTo(3, 9)
    for (const point of secant.points) expect(hyperbolaValue(point, hyperbola)).toBeCloseTo(0, 9)
    // 实轴在 x ⇒ 顶点处的切线是**竖直**的。
    const tangent = intersectLineWithConic(vertical(3), hyperbola)
    expect(tangent.kind).toBe("tangent")
    if (tangent.kind !== "tangent") throw new Error("expected a tangent")
    expect(hyperbolaValue(tangent.point, hyperbola)).toBeCloseTo(0, 9)
    // `y = 1` 与右支交于一点、与左支交于一点 ⇒ 两点（不是 0 个）。
    const twoPoints = intersectLineWithConic(horizontal(1), hyperbola)
    expect(twoPoints.kind).toBe("secant")
  })

  it("抛物线 `y² = 4x`：`x = 1` 是割线、`x = 0` 是顶点切线、`y = 2` 只交一次（α = 0 那一支）", () => {
    const secant = intersectLineWithConic(vertical(1), parabola)
    expect(secant.kind).toBe("secant")
    if (secant.kind !== "secant") throw new Error("expected a secant")
    for (const point of secant.points) expect(parabolaValue(point, parabola)).toBeCloseTo(0, 9)
    const tangent = intersectLineWithConic(vertical(0), parabola)
    expect(tangent.kind).toBe("tangent")
    if (tangent.kind !== "tangent") throw new Error("expected a tangent")
    expect(tangent.point.x).toBeCloseTo(0, 9)
    expect(tangent.point.y).toBeCloseTo(0, 9)
    /**
     * 与对称轴平行的直线 `y = 2`：一元二次的二次项系数是 0 ⇒ 只有**一个**有限交点
     * （另一个在无穷远）。这一支既不是 `secant`（没有第二个点）也不是 `tangent`（并不相切），
     * 所以必须有自己的名字 —— 把它硬塞进 `secant` 会让"恰好一个交点"这句话变成假的。
     */
    const parallel = intersectLineWithConic(horizontal(2), parabola)
    expect(parallel.kind).toBe("single")
    if (parallel.kind !== "single") throw new Error("expected a single point")
    expect(parallel.point.x).toBeCloseTo(1, 9)
    expect(parabolaValue(parallel.point, parabola)).toBeCloseTo(0, 9)
  })

  it("圆与旋转椭圆：交点在**世界坐标**里也要落在曲线上", () => {
    const around = intersectLineWithConic(horizontal(0), circle)
    expect(around.kind).toBe("secant")
    if (around.kind !== "secant") throw new Error("expected a secant")
    for (const point of around.points) expect(point.x ** 2 + point.y ** 2).toBeCloseTo(4, 9)

    const rotated: EllipsePrimitive = { id: "er", type: "ellipse", center: { x: 1, y: -1 }, radiusX: 4, radiusY: 1, rotation: Math.PI / 6 }
    // 取一个确定在椭圆上的点，再取它的切线方向（把该点处的局部法向转回世界）。
    const cos = Math.cos(rotated.rotation!)
    const sin = Math.sin(rotated.rotation!)
    const localTangentPoint = { x: rotated.radiusX, y: 0 }
    const worldTangentPoint = { x: rotated.center.x + localTangentPoint.x * cos, y: rotated.center.y + localTangentPoint.x * sin }
    const tangentLine = through(worldTangentPoint, { x: worldTangentPoint.x - sin, y: worldTangentPoint.y + cos })
    const result = intersectLineWithConic(tangentLine, rotated)
    expect(result.kind).toBe("tangent")
    if (result.kind !== "tangent") throw new Error("expected a tangent")
    // 世界坐标下自己算：先把点转回局部再代方程。
    const dx = result.point.x - rotated.center.x
    const dy = result.point.y - rotated.center.y
    const localX = dx * cos + dy * sin
    const localY = -dx * sin + dy * cos
    expect(localX * localX / rotated.radiusX ** 2 + localY * localY / rotated.radiusY ** 2).toBeCloseTo(1, 9)
  })

  it("退化输入：零长直线与退化的曲线都如实报 degenerate，不猜交点", () => {
    expect(intersectLineWithConic(through({ x: 1, y: 1 }, { x: 1, y: 1 }), ellipse).kind).toBe("degenerate")
    expect(intersectLineWithConic(horizontal(0), { id: "e0", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 0, radiusY: 2 }).kind).toBe("degenerate")
  })
})

/**
 * **「点在圆锥曲线上」的判据**（施工单①，2026-10-15）。
 *
 * ## 为什么要**导出**一个薄包装，而不是在核验层另写一份
 *
 * 题面那句 `P 是椭圆上任意一点` 今天**整句消失**（既不进给定、也不进未核验），所以它需要
 * 一条真判据。写这条判据要用到"一点离曲线多远"，而本模块**已经有**那个算法
 * （`buildLocalForm` → `evaluate` → 残差 `|Q| / max(1, |∇Q|)`，长度量纲）——
 * 只是模块私有。在 `diagramVerification` 里另写一份隐式方程，就是本仓反复付代价的
 * "同一个判断写两遍"：两份一旦分叉，"点在不在曲线上"会出现两个答案。
 *
 * 所以这里导出 `conicResidualAt`，**判据仍然只有一处**（本文件）。
 *
 * ## 这组用例的口径：判据自己算
 *
 * 期望值一律由测试**按公式现算**（`|Q| / max(1, |∇Q|)`，局部坐标里），不读被测函数的自报值；
 * 并且刻意钉住它的**性质**：在曲线上的点是浮点噪声量级、离曲线的点是**一阶**估计
 *（不是精确距离，比真距离小）—— 免得下游把它当成"到曲线的精确距离"用。
 */
describe("点在圆锥曲线上：残差只算一处", () => {
  const ellipse: EllipsePrimitive = { id: "e", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2 }

  it("椭圆上的一点：残差是浮点噪声量级，梯度按测试自己算的公式对上", () => {
    const angle = 0.4
    const point: Coordinate = { x: 3 * Math.cos(angle), y: 2 * Math.sin(angle) }
    const evidence = conicResidualAt(ellipse, point)
    expect(evidence).not.toBeNull()
    if (evidence === null) throw new Error("expected a residual")
    // 自己算：Q = x²/9 + y²/4 − 1（这一点上恒为 0），∇Q = (2x/9, 2y/4)。
    const value = point.x * point.x / 9 + point.y * point.y / 4 - 1
    const gradient = { x: 2 * point.x / 9, y: 2 * point.y / 4 }
    const expectedResidual = Math.abs(value) / Math.max(1, Math.hypot(gradient.x, gradient.y))
    expect(evidence.value).toBeCloseTo(value, 12)
    expect(evidence.gradient.x).toBeCloseTo(gradient.x, 12)
    expect(evidence.gradient.y).toBeCloseTo(gradient.y, 12)
    expect(evidence.residual).toBeCloseTo(expectedResidual, 12)
    expect(evidence.residual).toBeLessThan(1e-12)
  })

  it("椭圆外的点：残差是**一阶**估计（自己按同一公式现算），不是精确距离", () => {
    /**
     * `(0, 3)` 在 `x²/9 + y²/4 = 1` 外面：`Q = 9/4 − 1 = 1.25`、`|∇Q| = 1.5`
     * ⇒ 残差 `1.25 / 1.5 ≈ 0.8333`；而它到椭圆的**真实**距离是 `1`（最近点 `(0, 2)`）。
     * 两个数都要钉住：前者是判据用的量，后者说明**别把它当精确距离**。
     */
    const evidence = conicResidualAt(ellipse, { x: 0, y: 3 })
    expect(evidence).not.toBeNull()
    if (evidence === null) throw new Error("expected a residual")
    expect(evidence.residual).toBeCloseTo(1.25 / 1.5, 12)
    expect(evidence.residual).toBeLessThan(1)
  })

  it("旋转椭圆：残差与旋转无关（在局部坐标里算）", () => {
    const rotated: EllipsePrimitive = { id: "er", type: "ellipse", center: { x: 1, y: -1 }, radiusX: 4, radiusY: 1, rotation: Math.PI / 6 }
    const cos = Math.cos(rotated.rotation!)
    const sin = Math.sin(rotated.rotation!)
    const local = { x: 4 * Math.cos(1.1), y: Math.sin(1.1) }
    const world: Coordinate = { x: rotated.center.x + local.x * cos - local.y * sin, y: rotated.center.y + local.x * sin + local.y * cos }
    const evidence = conicResidualAt(rotated, world)
    expect(evidence).not.toBeNull()
    if (evidence === null) throw new Error("expected a residual")
    // 世界坐标下自己算：先转回局部，再代方程与梯度。
    const dx = world.x - rotated.center.x
    const dy = world.y - rotated.center.y
    const localX = dx * cos + dy * sin
    const localY = -dx * sin + dy * cos
    const value = localX * localX / 16 + localY * localY - 1
    expect(evidence.value).toBeCloseTo(value, 12)
    expect(evidence.residual).toBeLessThan(1e-12)
  })

  it("圆 / 双曲线 / 抛物线三类都在同一条判据上：曲线上的点残差为噪声量级", () => {
    const circle: CirclePrimitive = { id: "c", type: "circle", center: { x: 0, y: 0 }, radius: 2 }
    const hyperbola: HyperbolaPrimitive = { id: "h", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x" }
    const parabola: ParabolaPrimitive = { id: "p", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "x" }
    // 圆上 (2, 0)；双曲线（实轴沿 x）上 (3cosh 0.7, 2sinh 0.7)；抛物线 y² = 4x 上 (1, 2)。
    const samples: [string, PlanarConicSample, Coordinate][] = [
      ["圆", circle, { x: 2, y: 0 }],
      ["双曲线", hyperbola, { x: 3 * Math.cosh(0.7), y: 2 * Math.sinh(0.7) }],
      ["抛物线", parabola, { x: 1, y: 2 }]
    ]
    for (const [name, conic, point] of samples) {
      const evidence = conicResidualAt(conic, point)
      expect(evidence, name).not.toBeNull()
      if (evidence === null) throw new Error(`expected a residual for ${name}`)
      expect(evidence.residual, name).toBeLessThan(1e-12)
    }
  })

  it("退化的曲线参数与非有限点：一律 null，不猜一个数出来", () => {
    expect(conicResidualAt({ id: "e0", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 0, radiusY: 2 }, { x: 0, y: 0 })).toBeNull()
    expect(conicResidualAt({ id: "p0", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 0, axis: "x" }, { x: 0, y: 0 })).toBeNull()
    expect(conicResidualAt(ellipse, { x: Number.NaN, y: 0 })).toBeNull()
    expect(conicResidualAt(ellipse, { x: 0, y: Number.POSITIVE_INFINITY })).toBeNull()
  })
})

/** 上面那张表里三类曲线的联合类型（与 `conicResidualAt` 的入参同一份定义）。 */
type PlanarConicSample = Parameters<typeof conicResidualAt>[0]
