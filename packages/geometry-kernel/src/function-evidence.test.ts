import { describe, expect, it } from "vitest"
import {
  commonTangents,
  functionGraphEvidence,
  functionIntersections,
  functionLineRoots,
  judgeUniversalClaim,
  tangentsFromPoint,
  verifyTangentLine
} from "./function-evidence"

/**
 * **Task 15：函数与导数的证据分级**（计划 `Task 15｜函数与导数真题纵向交付`）。
 *
 * ## 这一份用例要钉住的三件事
 *
 * ① **真题的四种形状**（调研文档 §2.3 归纳的 F3 / F4 / F6）：
 *    2021 新高考Ⅰ卷 7 题（外点向指数函数作两条切线）、2022 新高考Ⅰ卷 22 题与
 *    2024 新课标Ⅰ卷 7 题（两函数与一条水平线的多个交点、两三角图像交点）、
 *    2024 新课标Ⅰ卷 13 题（两曲线公切线）。
 * ② **反例必须真红**：断点被连线、错切点、漏近重根、把参数实例当"所有参数成立"。
 * ③ **"画出来了"与"证出来了"分成两个字段**：`grade` 说的是**这条读数是怎么来的**
 *    （代数判别式 / 数值回代 / 只是采样折线），`complete` 说的是**个数能不能当个数用**。
 *
 * 用例里的每一个期望值都由**测试自己**独立算出来（自己求导、自己回代、自己解判别式），
 * 不读被测模块的中间量 —— 拿模块的数去证明模块，等于没证。
 */

/** 测试自己写的函数，与被测模块的表达式求值器**是两套实现**。 */
const own = {
  exp: (x: number) => Math.exp(x),
  sin: Math.sin,
  cos: Math.cos,
  square: (x: number) => x * x,
  /** `f(x) = x³ − 3x` 的导数 —— 手工求导，不是中心差分。 */
  cubicDerivative: (x: number) => 3 * x * x - 3
}

describe("Task 15 F1: 图像分段与断点（定义域）", () => {
  it("把 1/x 的两支切成两条折线，并把断点报成 x ≈ 0", () => {
    const evidence = functionGraphEvidence("1/x", [-2, 2])
    expect(evidence.segments).toHaveLength(2)
    expect(evidence.breaks).toHaveLength(1)
    expect(Math.abs(evidence.breaks[0])).toBeLessThan(0.05)
    // 关键性质：**没有一条折线跨过断点**（跨了就是把断点连起来了）。
    for (const segment of evidence.segments) {
      const low = segment[0].x
      const high = segment[segment.length - 1].x
      expect(low < 0 && high < 0 || low > 0 && high > 0).toBe(true)
    }
    // 采样折线**永远只是折线**：这条读数不许被当作证明。
    expect(evidence.grade).toBe("plot-only")
  })

  it("多项式一整段、没有断点", () => {
    const evidence = functionGraphEvidence("x^3-3*x", [-2, 2])
    expect(evidence.segments).toHaveLength(1)
    expect(evidence.breaks).toEqual([])
  })

  it("tan(x) 在两条渐近线处断开，且没有折线跨过渐近线", () => {
    const evidence = functionGraphEvidence("tan(x)", [-2, 2])
    expect(evidence.breaks.length).toBeGreaterThanOrEqual(2)
    // 断点应该落在 ±π/2 附近（测试自己算的 π/2）。
    const asymptotes = [-Math.PI / 2, Math.PI / 2]
    for (const asymptote of asymptotes) {
      expect(evidence.breaks.some((entry) => Math.abs(entry - asymptote) < 0.05)).toBe(true)
    }
    for (const segment of evidence.segments) {
      const low = segment[0].x
      const high = segment[segment.length - 1].x
      for (const asymptote of asymptotes) expect(low < asymptote && asymptote < high).toBe(false)
    }
  })
})

describe("Task 15 F3/F6: 交点与根数（2022Ⅰ-22、2024Ⅰ-7）", () => {
  it("y = sin x 与 y = 0.5 在 [-5, 5] 上有三个交点，一个都不许漏", () => {
    const result = functionLineRoots("sin(x)", [-5, 5], { slope: 0, intercept: 0.5 })
    // 测试自己解 sin x = 0.5：π/6 + 2kπ 与 5π/6 + 2kπ 落在区间里的那些。
    const expected = [(5 * Math.PI) / 6 - 2 * Math.PI, Math.PI / 6, (5 * Math.PI) / 6].sort((a, b) => a - b)
    expect(expected).toHaveLength(3)
    expect(result.roots).toHaveLength(3)
    expect(result.complete).toBe(true)
    expect(result.grade).toBe("verified-numeric")
    result.roots.forEach((root, index) => {
      expect(root.x).toBeCloseTo(expected[index], 6)
      // 回代：交点的纵坐标真的在那条水平线上。
      expect(Math.abs(root.y - 0.5)).toBeLessThan(1e-9)
    })
  })

  it("两条三角图像在 [-5, 5] 上有三个交点（2024Ⅰ-7 的形状）", () => {
    const result = functionIntersections("sin(x)", "cos(x)", [-5, 5])
    // 测试自己解 tan x = 1 ⇒ x = π/4 + kπ。
    const expected = [-Math.PI + Math.PI / 4, Math.PI / 4, Math.PI + Math.PI / 4].sort((a, b) => a - b)
    expect(result.roots).toHaveLength(3)
    result.roots.forEach((root, index) => {
      expect(root.x).toBeCloseTo(expected[index], 6)
      // 回代：两个函数在交点处取值相同（测试自己算两个值）。
      expect(Math.abs(own.sin(root.x) - own.cos(root.x))).toBeLessThan(1e-8)
    })
  })

  it("两个根只差 2e-5 的近重根由判别式解出，不靠采样", () => {
    // (x − 1)² − 1e-10 展开后的多项式；判别式 4e-10 > 0 ⇒ 两个不同实根 1 ± 1e-5。
    const result = functionLineRoots("x^2-2*x+0.9999999999", [-2, 2], { slope: 0, intercept: 0 })
    expect(result.roots).toHaveLength(2)
    expect(result.grade).toBe("algebraic")
    expect(result.complete).toBe(true)
    expect(result.roots[0].x).toBeCloseTo(1 - 1e-5, 9)
    expect(result.roots[1].x).toBeCloseTo(1 + 1e-5, 9)
  })

  it("采样分辨不出的近重根不许报成「零个根」", () => {
    // cos x − 1 + 1e-12 在 x = 0 附近有一对相距约 2.8e-6 的根；
    // 均匀采样的每个格子两端都同号，朴素做法会报「没有根」。
    const result = functionLineRoots("cos(x)-1+0.000000000001", [-1, 1], { slope: 0, intercept: 0 })
    expect(result.roots.length).toBeGreaterThanOrEqual(1)
    expect(result.roots.some((root) => Math.abs(root.x) < 1e-3)).toBe(true)
    // 诚实的那一半：个数对分辨率敏感 ⇒ 不许把 roots.length 当根数用。
    expect(result.complete).toBe(false)
    expect(result.diagnostic).toBeTruthy()
  })
})

describe("Task 15 F4: 外点双切线（2021 新高考Ⅰ卷 7 题）", () => {
  it("从 (0, 0.5) 向 y = e^x 作两条切线，两条都回代得过", () => {
    const result = tangentsFromPoint("exp(x)", [-5, 5], { x: 0, y: 0.5 })
    expect(result.status).toBe("solved")
    expect(result.tangents).toHaveLength(2)
    expect(result.grade).toBe("verified-numeric")
    expect(result.complete).toBe(true)
    for (const tangent of result.tangents) {
      // 测试自己回代：切点必须在曲线上、斜率必须是自己算的 e^t、直线必须过那个外点。
      expect(tangent.y).toBeCloseTo(own.exp(tangent.parameter), 9)
      expect(tangent.slope).toBeCloseTo(own.exp(tangent.parameter), 6)
      expect(Math.abs(tangent.y + tangent.slope * (0 - tangent.parameter) - 0.5)).toBeLessThan(1e-9)
      expect(tangent.residual).toBeLessThan(1e-9)
    }
    // 一条切在 x < 0 那支、一条切在 x > 0 那支 —— 正是"两条不同的切线"。
    expect(result.tangents[0].parameter).toBeLessThan(-1.5)
    expect(result.tangents[1].parameter).toBeGreaterThan(0.7)
    expect(result.tangents[1].parameter).toBeLessThan(0.85)
  })

  it("外点正好落在曲线上的临界情形只给一条，并说明它已退化", () => {
    // (0, 1) 在 y = e^x 上，而且是"两条切线"的临界点（e^t(1−t) 的最大值就是 1）。
    const result = tangentsFromPoint("exp(x)", [-5, 5], { x: 0, y: 1 })
    expect(result.tangents).toHaveLength(1)
    expect(result.tangents[0].parameter).toBeCloseTo(0, 6)
    expect(result.tangents[0].slope).toBeCloseTo(1, 6)
    // 恰好卡在 1 条与 2 条的分界上 ⇒ 个数对微扰敏感，必须如实说。
    expect(result.complete).toBe(false)
    expect(result.diagnostic).toContain("退化")
  })

  it("外点在所有切线之上时如实报「没有切线」", () => {
    const result = tangentsFromPoint("exp(x)", [-5, 5], { x: 0, y: 2 })
    expect(result.status).toBe("none")
    expect(result.tangents).toEqual([])
    expect(result.complete).toBe(true)
  })

  it("外点在曲线下方时给唯一那条切线", () => {
    const result = tangentsFromPoint("exp(x)", [-5, 5], { x: 0, y: -1 })
    expect(result.status).toBe("solved")
    expect(result.tangents).toHaveLength(1)
    // 测试自己解 e^t(t − 1) = 1 ⇒ t = 1 + e^{−t} ≈ 1.2785。
    expect(result.tangents[0].parameter).toBeCloseTo(1.27846, 3)
  })
})

describe("Task 15 F4: 公切线（2024 新课标Ⅰ卷 13 题）", () => {
  it("y = x² 与 y = −(x−2)²+1 有两条公切线，斜率是 2 ± √2", () => {
    const result = commonTangents("x^2", "-(x-2)^2+1", [-2, 3], [-2, 3])
    expect(result.status).toBe("solved")
    expect(result.tangents).toHaveLength(2)
    result.tangents.forEach((tangent, index) => {
      const expectedSlope = 2 + (index === 0 ? -Math.SQRT2 : Math.SQRT2)
      expect(tangent.slope).toBeCloseTo(expectedSlope, 6)
      // 测试自己算两个切点与截距，再回代两条曲线。
      const firstT = expectedSlope / 2
      const secondT = 2 - expectedSlope / 2
      expect(tangent.first.parameter).toBeCloseTo(firstT, 6)
      expect(tangent.second.parameter).toBeCloseTo(secondT, 6)
      expect(Math.abs(own.square(firstT) - (expectedSlope * firstT + tangent.intercept))).toBeLessThan(1e-9)
      const secondY = -((secondT - 2) ** 2) + 1
      expect(Math.abs(secondY - (expectedSlope * secondT + tangent.intercept))).toBeLessThan(1e-9)
      // 斜率在两处都等于各自的导数：f′ = 2t、g′ = −2(t−2)。
      expect(2 * firstT).toBeCloseTo(expectedSlope, 9)
      expect(-2 * (secondT - 2)).toBeCloseTo(expectedSlope, 9)
      expect(tangent.residual).toBeLessThan(1e-9)
    })
  })

  it("两条平移开来的抛物线没有公切线", () => {
    const result = commonTangents("x^2", "x^2+1", [-2, 2], [-3, 3])
    expect(result.status).toBe("none")
    expect(result.tangents).toEqual([])
  })
})

describe("Task 15 反例：错切点（斜率对、直线不对）", () => {
  it("认下真正的切线 y = 2（切在 x = −1）", () => {
    const verdict = verifyTangentLine("x^3-3*x", [-2, 2], { slope: 0, intercept: 2 })
    expect(verdict.tangent).toBe(true)
    expect(verdict.parameter).toBeCloseTo(-1, 6)
    expect(verdict.residual).toBeLessThan(1e-9)
  })

  it("同样的斜率、错的截距不许当成切线", () => {
    // y = 0.5 与 y = 2 斜率一样（都是 0），但 f(x) = x³ − 3x 在 ±1 处离它还有 1.5 / 2.5。
    const verdict = verifyTangentLine("x^3-3*x", [-2, 2], { slope: 0, intercept: 0.5 })
    expect(verdict.tangent).toBe(false)
    expect(verdict.residual).toBeGreaterThan(0.1)
    expect(verdict.reason).toContain("不相切")
  })

  it("割线 y = 9x 不许当成切线，哪怕斜率正好是 f′(2)", () => {
    const verdict = verifyTangentLine("x^3-3*x", [-2, 2], { slope: 9, intercept: 0 })
    expect(verdict.tangent).toBe(false)
    // 自己核对：f′(2) 确实是 9，切线该是 y = 9x − 16 那条。
    expect(own.cubicDerivative(2)).toBeCloseTo(9, 9)
    expect(verdict.residual).toBeGreaterThan(1)
  })
})

describe("Task 15 反例：把一个参数实例写成「所有参数成立」", () => {
  it("只有参数实例时，全称主张一律不成立", () => {
    const verdict = judgeUniversalClaim(
      { scope: "all-parameters", parameterNames: ["a"] },
      [{ a: 1 }, { a: 2 }]
    )
    expect(verdict.scope).toBe("at-parameters")
    expect(verdict.upheld).toBe(false)
    expect(verdict.grade).toBe("plot-only")
    expect(verdict.reason).toContain("所有参数")
  })

  it("只声称在给定取值上成立时，如实标成参数实例", () => {
    const verdict = judgeUniversalClaim({ scope: "at-parameters", parameterNames: ["a"] }, [{ a: 1 }])
    expect(verdict.scope).toBe("at-parameters")
    expect(verdict.upheld).toBe(true)
    expect(verdict.grade).toBe("plot-only")
  })

  it("一个参数取值都没核验时不许通过任何主张", () => {
    const verdict = judgeUniversalClaim({ scope: "at-parameters", parameterNames: ["a"] }, [])
    expect(verdict.upheld).toBe(false)
    expect(verdict.reason).toContain("没有任何参数取值")
  })
})
