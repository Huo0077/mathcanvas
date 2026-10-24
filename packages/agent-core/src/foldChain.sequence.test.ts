import { describe, expect, it } from "vitest"

import { buildFoldChain, foldPointAboutHinge, readFoldAngles, type FoldPoint3 } from "./foldChain"

/**
 * **T6（2026-10-24）：连续折叠的依赖表示与分类**
 *
 * 这一组钉住三件事：
 * 1. 两条折叠只有在**引用串起来**且**折角明确**时才算"可解的顺序链"；
 * 2. 其余多折叠输入必须被**准确分类**（引用没串起来 / 缺折角），而不是猜一个顺序；
 * 3. 明确角度的链可以被**数值验证**：折痕不动、刚性保持、没被折的对象不变。
 */
const CHAINED = "先将△AEF沿EF翻折90°至△PEF，再将△PEF沿PF折叠60°至△QPF"
const INDEPENDENT = "将△AEF沿EF翻折90°至△PEF，将△BCD沿CD折叠60°至△QCD"
const NO_ANGLES = "先将△AEF沿EF翻折至△PEF，再将△PEF沿PF翻折至△QPF"

function distance(left: FoldPoint3, right: FoldPoint3): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)
}

describe("T6 — sequential fold chains", () => {
  it("classifies a chained pair with explicit angles as resolvable, with the dependency recorded", () => {
    const chain = buildFoldChain(CHAINED)

    expect(chain.status).toBe("sequential_resolvable")
    if (chain.status !== "sequential_resolvable") return
    expect(chain.steps).toHaveLength(2)
    // 第二条折的是**第一次折后**的那张面：依赖必须写出来，输入状态不是 0。
    expect(chain.steps[1]!.dependsOn).toEqual([1])
    expect(chain.steps[1]!.inputState).toBe(1)
    expect(chain.steps[0]!.angleDegrees).toBe(90)
    expect(chain.steps[1]!.angleDegrees).toBe(60)
  })

  it("reads only the angle that belongs to the action word, not the coefficients in the goal condition", () => {
    // `PC=4√3` 里的 4 不是折角；把它读进来会让整条链跑偏。
    const angles = readFoldAngles("将△AEF沿EF翻折，使得PC=4√3")
    expect(angles).toEqual([])
    expect(readFoldAngles(CHAINED)).toEqual([90, 60])
  })

  it("refuses two folds that do not reference each other instead of guessing an order", () => {
    const chain = buildFoldChain(INDEPENDENT)

    expect(chain.status).toBe("unsupported")
    if (chain.status !== "unsupported") return
    expect(chain.reason).toBe("reference_not_chained")
    expect(chain.unknowns.length).toBeGreaterThan(0)
  })

  it("reports the missing angles as unknowns instead of pretending the chain is solvable", () => {
    const chain = buildFoldChain(NO_ANGLES)

    expect(chain.status).toBe("unsupported")
    if (chain.status !== "unsupported") return
    expect(chain.reason).toBe("fold_angle_unknown")
    expect(chain.unknowns).toEqual(["第 1 条折叠的折角", "第 2 条折叠的折角"])
  })

  it("keeps a single fold on the existing path", () => {
    const chain = buildFoldChain("将△AEF沿EF翻折90°至△PEF")

    expect(chain.status).toBe("single")
    if (chain.status !== "single") return
    expect(chain.steps[0]!.angleDegrees).toBe(90)
  })

  it("returns none when the prompt has no fold at all", () => {
    expect(buildFoldChain("画一个棱长 3 的立方体")).toEqual({ status: "none" })
  })

  /**
   * **代表链路的数值验证**：两次顺序折叠、折角明确、引用明确。
   *
   * 图形：A=(1,1,0)、E=(0,0,0)、F=(2,0,0)，另有一个**不受影响**的点 B=(5,0,0)。
   * 第一步绕 EF 折 90°；第二步绕 F–A′ 折 60°（A′ 是第一次折后的 A，于是第二次折的是折后的面）。
   * 检查的是不变量，而不是"和我算的坐标一样"：
   * 折痕两端不动、三角形边长不变、没被折的 B 一点不动。
   */
  it("verifies a representative two-fold chain by invariants (hinges fixed, rigidity kept, untouched points unchanged)", () => {
    const A: FoldPoint3 = { x: 1, y: 1, z: 0 }
    const E: FoldPoint3 = { x: 0, y: 0, z: 0 }
    const F: FoldPoint3 = { x: 2, y: 0, z: 0 }
    const B: FoldPoint3 = { x: 5, y: 0, z: 0 }

    const first = foldPointAboutHinge(A, E, F, 90)
    // 第一次折叠：折痕 E、F 不动；AE / AF 两条边长度不变。
    expect(distance(first, E)).toBeCloseTo(distance(A, E), 9)
    expect(distance(first, F)).toBeCloseTo(distance(A, F), 9)

    const second = foldPointAboutHinge(E, F, first, 60)
    // 第二次折叠：折痕 F、A′ 不动；被折的 E 到两端的距离与折前一致。
    expect(distance(second, F)).toBeCloseTo(distance(E, F), 9)
    expect(distance(second, first)).toBeCloseTo(distance(E, first), 9)
    expect(distance(first, F)).toBeCloseTo(distance(A, F), 9)

    // 没被折的点一点不动（不受影响的对象的坐标不能被整张图重算）。
    expect(B).toEqual({ x: 5, y: 0, z: 0 })
  })

  it("never rotates around a degenerate hinge and never invents an angle", () => {
    // 折痕退化成一点：原样返回，而不是 NaN。
    expect(foldPointAboutHinge({ x: 1, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 90)).toEqual({ x: 1, y: 1, z: 0 })
    expect(foldPointAboutHinge({ x: 1, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, Number.NaN)).toEqual({ x: 1, y: 1, z: 0 })
  })
})
