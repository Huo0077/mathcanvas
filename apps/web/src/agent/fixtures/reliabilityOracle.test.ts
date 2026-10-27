import { describe, expect, it } from "vitest"

import { evaluateOracle, type Oracle } from "./reliabilityOracle"

/**
 * **独立判据自己也要有判据**（T01/T02，2026-10-27）。
 *
 * 这一组不经过任何产品模块：给一份**手写的候选文档**，逐条核对 oracle 的读数
 *（距离 / 点积 / 坐标 / 两平面垂直 / 点数 / 缺点名 / 候选缺失）。
 * 矩形折后那组数（B′=(16/5, 8/5, −4/√5)、BD=2√85/5、残差 12）在这里是**独立写死**的。
 */
function documentWith(points: Record<string, { x: number; y: number; z: number }>) {
  return {
    primitives: Object.entries(points).map(([label, position]) => ({ type: "point3", label, position }))
  }
}

const USER_FOLD = documentWith({
  A: { x: 0, y: 0, z: 0 },
  "B′": { x: 16 / 5, y: 8 / 5, z: -4 / Math.sqrt(5) },
  C: { x: 4, y: 2, z: 0 },
  D: { x: 0, y: 2, z: 0 }
})

describe("独立 oracle 回代", () => {
  it("距离 / 点积 / 坐标 / 两平面垂直全部按候选坐标算", () => {
    const oracle: Oracle = {
      facts: [
        { kind: "distance", a: "A", b: "B′", value: 4 },
        { kind: "distance", a: "B′", b: "D", value: (2 * Math.sqrt(85)) / 5 },
        { kind: "dot", a: "B′", b: "D", c: "A", d: "C", value: 12 },
        { kind: "point-coordinate", name: "B′", x: 16 / 5, y: 8 / 5, z: -4 / Math.sqrt(5) },
        { kind: "planes-perpendicular", first: ["A", "B′", "C"], second: ["A", "C", "D"] },
        { kind: "point-count", minimum: 4 }
      ]
    }
    const result = evaluateOracle(USER_FOLD, oracle)
    expect(result.facts.filter((fact) => fact.status === "failed"), JSON.stringify(result.facts, null, 2)).toEqual([])
    expect(result.status).toBe("passed")
  })

  it("改一个坐标就会被逐条挡下（不是只比一个总数）", () => {
    const tampered = documentWith({
      A: { x: 0, y: 0, z: 0 },
      "B′": { x: 3.7, y: 1.6, z: -1 },
      C: { x: 4, y: 2, z: 0 },
      D: { x: 0, y: 2, z: 0 }
    })
    const result = evaluateOracle(tampered, {
      facts: [
        { kind: "distance", a: "A", b: "B′", value: 4 },
        { kind: "planes-perpendicular", first: ["A", "B′", "C"], second: ["A", "C", "D"] }
      ]
    })
    expect(result.status).toBe("failed")
    expect(result.facts.map((fact) => fact.status)).toEqual(["failed", "failed"])
  })

  it("缺点名 ⇒ 那条失败并说清缺谁；候选缺失 ⇒ not_applicable（不算通过）", () => {
    const missing = evaluateOracle(USER_FOLD, { facts: [{ kind: "distance", a: "A", b: "Z", value: 1 }] })
    expect(missing.status).toBe("failed")
    expect(missing.facts[0]?.detail).toContain("Z")

    expect(evaluateOracle(null, { facts: [{ kind: "point-count", minimum: 1 }] }).status).toBe("not_applicable")
  })

  /**
   * **新增两种 oracle 事实**（2026-10-27，题目族长到 22 条之后）：
   * - `segment-ratio`：`|ab| / |cd|` —— 用它把"两条边的长度比"独立回代一次
   *   （这正是 §4.7 那条缺陷的形状，产品侧改成只比长度比，oracle 侧也必须能独立量出同一个比值）；
   * - `angle`：两条向量的夹角（度）—— 翻折里最有用的不变量是"折片与折痕的夹角不变"
   *   （`∠(AB′, AC) = ∠BAC`），它不依赖折后那个自由度。
   */
  it("segment-ratio 按候选坐标算比值，错值必须被挡下", () => {
    const right = evaluateOracle(USER_FOLD, { facts: [{ kind: "segment-ratio", a: "A", b: "B′", c: "B′", d: "D", value: 4 / ((2 * Math.sqrt(85)) / 5) }] })
    expect(right.status).toBe("passed")

    const wrong = evaluateOracle(USER_FOLD, { facts: [{ kind: "segment-ratio", a: "A", b: "B′", c: "B′", d: "D", value: 1 }] })
    expect(wrong.status).toBe("failed")
    expect(wrong.facts[0]?.detail).toContain("|AB′|/|B′D|")
  })

  it("angle 量两条向量的夹角：折片与折痕的夹角折叠前后不变", () => {
    // 展开态 ∠BAC = atan(BC/AB) = atan(2/4)；折起只把 AB 绕 AC 转出平面，与 AC 的夹角不变。
    const expected = (Math.atan2(2, 4) * 180) / Math.PI
    const kept = evaluateOracle(USER_FOLD, { facts: [{ kind: "angle", a: "A", b: "B′", c: "A", d: "C", value: expected }] })
    expect(kept.status).toBe("passed")

    // 折错的图（B′ 被挪到 45°）必须被挡下。
    const tampered = documentWith({
      A: { x: 0, y: 0, z: 0 },
      "B′": { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 },
      C: { x: 1, y: 0, z: 0 },
      D: { x: 0, y: 2, z: 0 }
    })
    const broken = evaluateOracle(tampered, { facts: [{ kind: "angle", a: "A", b: "B′", c: "A", d: "C", value: expected }] })
    expect(broken.status).toBe("failed")
  })

  it("两种新事实缺点名时也逐条说清缺谁（不静默跳过）", () => {
    const ratio = evaluateOracle(USER_FOLD, { facts: [{ kind: "segment-ratio", a: "A", b: "Z", c: "B′", d: "D", value: 1 }] })
    expect(ratio.status).toBe("failed")
    expect(ratio.facts[0]?.detail).toContain("Z")

    const angle = evaluateOracle(USER_FOLD, { facts: [{ kind: "angle", a: "A", b: "B′", c: "Q", d: "C", value: 90 }] })
    expect(angle.status).toBe("failed")
    expect(angle.facts[0]?.detail).toContain("Q")
  })
})
