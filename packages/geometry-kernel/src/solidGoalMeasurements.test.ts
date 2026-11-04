import { describe, expect, it } from "vitest"

import type { Vector3 } from "../geometry3d"
import { dihedralCosine, dihedralDegrees, linePlaneSine, planeAngleCosine, planeNormalOf, pointPlaneDistance } from "./solidGoalMeasurements"

/**
 * **T7：立体几何目标的坐标量测**（2026-11-05 四题修复）。
 *
 * 输入是设计 §3 的**人工参考坐标**（手抄，不调用被测构造器）：
 * 期望值也是人工解析算出来的 —— 这一层只负责"从坐标量出那个数"。
 */

const v = (x: number, y: number, z: number): Vector3 => ({ x, y, z })

describe("T7 量测：线面角 / 点面距 / 二面角 / 平面夹角", () => {
  it("Case 1：直线 PC 与平面 ADE 所成角的正弦 = 1/√2", () => {
    /** A(0,0,0)、D(0,2,0)、E(1,0,1)、P(0,0,2)、C(1,2,0)。 */
    const normal = planeNormalOf([v(0, 0, 0), v(0, 2, 0), v(1, 0, 1)])
    expect(normal.status).toBe("ok")
    if (normal.status !== "ok") return
    const sine = linePlaneSine(v(1, 2, -2), normal.normal)
    expect(sine.status).toBe("ok")
    if (sine.status !== "ok") return
    expect(sine.value).toBeCloseTo(Math.SQRT1_2, 12)
  })

  it("Case 3：点 A 到平面 PBD 的距离 = √3", () => {
    /** P(3/2,√3/2,√3)、B(2,0,0)、D(1,√3,0)、A(0,0,0)。 */
    const normal = planeNormalOf([v(1.5, Math.sqrt(3) / 2, Math.sqrt(3)), v(2, 0, 0), v(1, Math.sqrt(3), 0)])
    expect(normal.status).toBe("ok")
    if (normal.status !== "ok") return
    const distance = pointPlaneDistance(v(0, 0, 0), v(2, 0, 0), normal.normal)
    expect(distance.status).toBe("ok")
    if (distance.status !== "ok") return
    expect(distance.value).toBeCloseTo(Math.sqrt(3), 12)
  })

  it("Case 2：二面角 A-DE-B₁ 的余弦 = 0（180° 的补角不会被误报）", () => {
    /** D(1/2,√3/2,0)、E(2,0,1)、A(0,0,0)、B₁(2,0,3)。 */
    const cosine = dihedralCosine({ hingeStart: v(0.5, Math.sqrt(3) / 2, 0), hingeEnd: v(2, 0, 1), firstPoint: v(0, 0, 0), secondPoint: v(2, 0, 3) })
    expect(cosine.status).toBe("ok")
    if (cosine.status !== "ok") return
    expect(cosine.value).toBeCloseTo(0, 12)
    expect(dihedralDegrees(cosine.value)).toBeCloseTo(90, 10)
  })

  it("Case 4 修订版：二面角 P-AB-C 的余弦 = 1/√3（约 54.7356°）", () => {
    /** P(1/2,1/2,1/√2)、A(0,0,0)、B(2,0,0)、C(1,1,0)；折痕 AB。 */
    const cosine = dihedralCosine({ hingeStart: v(0, 0, 0), hingeEnd: v(2, 0, 0), firstPoint: v(0.5, 0.5, Math.SQRT1_2), secondPoint: v(1, 1, 0) })
    expect(cosine.status).toBe("ok")
    if (cosine.status !== "ok") return
    expect(cosine.value).toBeCloseTo(1 / Math.sqrt(3), 12)
    expect(dihedralDegrees(cosine.value)).toBeCloseTo(54.735610317, 6)
  })

  it("二面角**不取绝对值**：120° 就是 120°，不是 60°；平面夹角才是锐角 60°", () => {
    /**
     * 折痕取 x 轴；两个半平面里的投影方向分别是 `(0, cos60°, sin60°)` 与
     * `(0, cos60°, −sin60°)` ⇒ 半平面夹角 120°、余弦 −1/2。
     */
    const cosine = dihedralCosine({
      hingeStart: v(0, 0, 0),
      hingeEnd: v(1, 0, 0),
      firstPoint: v(0, Math.cos(Math.PI / 3), Math.sin(Math.PI / 3)),
      secondPoint: v(0, Math.cos(Math.PI / 3), -Math.sin(Math.PI / 3))
    })
    expect(cosine.status).toBe("ok")
    if (cosine.status !== "ok") return
    /** **负数保留**：120° 的余弦就是 −1/2。 */
    expect(cosine.value).toBeCloseTo(-0.5, 12)
    expect(dihedralDegrees(cosine.value)).toBeCloseTo(120, 9)
    /** 而"两个平面的夹角"取锐角 60°（`|n1·n2|`）。 */
    const firstNormal = planeNormalOf([v(0, 0, 0), v(1, 0, 0), v(0, Math.cos(Math.PI / 3), Math.sin(Math.PI / 3))])
    const secondNormal = planeNormalOf([v(0, 0, 0), v(1, 0, 0), v(0, Math.cos(Math.PI / 3), -Math.sin(Math.PI / 3))])
    expect(firstNormal.status).toBe("ok")
    expect(secondNormal.status).toBe("ok")
    if (firstNormal.status !== "ok" || secondNormal.status !== "ok") return
    const planeCosine = planeAngleCosine(firstNormal.normal, secondNormal.normal)
    expect(planeCosine.status).toBe("ok")
    if (planeCosine.status !== "ok") return
    expect(planeCosine.value).toBeCloseTo(0.5, 12)
    expect((Math.acos(planeCosine.value) * 180) / Math.PI).toBeCloseTo(60, 9)
  })

  it("退化输入是结构化拒绝，不返回 NaN", () => {
    expect(planeNormalOf([v(0, 0, 0), v(1, 0, 0), v(2, 0, 0)]).status).toBe("rejected")
    expect(linePlaneSine(v(0, 0, 0), v(0, 0, 1)).status).toBe("rejected")
    expect(pointPlaneDistance(v(1, 1, 1), v(0, 0, 0), v(0, 0, 0)).status).toBe("rejected")
    expect(dihedralCosine({ hingeStart: v(0, 0, 0), hingeEnd: v(0, 0, 0), firstPoint: v(1, 0, 0), secondPoint: v(0, 1, 0) }).status).toBe("rejected")
    /** 有一侧的点落在折痕上 ⇒ 投影退化。 */
    expect(dihedralCosine({ hingeStart: v(0, 0, 0), hingeEnd: v(1, 0, 0), firstPoint: v(0.5, 0, 0), secondPoint: v(0, 1, 0) }).status).toBe("rejected")
    for (const result of [
      linePlaneSine(v(Number.NaN, 0, 0), v(0, 0, 1)),
      pointPlaneDistance(v(0, 0, 0), v(0, 0, 0), v(Number.POSITIVE_INFINITY, 0, 0))
    ]) {
      expect(result.status).toBe("rejected")
      if (result.status === "rejected") expect(result.message.length).toBeGreaterThan(0)
    }
  })
})
