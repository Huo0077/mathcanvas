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
})
