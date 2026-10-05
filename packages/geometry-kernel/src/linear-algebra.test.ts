import { describe, expect, it } from "vitest"

import { rankRows } from "./linear-algebra"

/**
 * 这个函数是**共享**的：`agent-core` 的 `constraintIR.reportFreeDegrees`（文档级自由度）
 * 与内核的拖动诊断（`constraints3dProjection` 的 `analysis`）现在都走它。
 *
 * 所以这里钉的是"秩"本身的语义 —— 尤其是**依赖行**，因为两边的调用方都靠它区分
 * "重复声明"与"真的多压了一个方向"。
 */
describe("rankRows（数值行的秩）", () => {
  it("单位阵满秩，没有依赖行", () => {
    const report = rankRows([
      [1, 0, 0],
      [0, 1, 0]
    ])
    expect(report.rank).toBe(2)
    expect(report.dependentIndices).toEqual([])
  })

  it("重复的行只算一次：第二条是依赖行", () => {
    const report = rankRows([
      [-1, 0, 1],
      [-1, 0, 1]
    ])
    expect(report.rank).toBe(1)
    expect(report.dependentIndices).toEqual([1])
  })

  it("能由别的行线性组合出来的行也是依赖行", () => {
    const report = rankRows([
      [1, 0, 0],
      [0, 1, 0],
      [2, 3, 0]
    ])
    expect(report.rank).toBe(2)
    expect(report.dependentIndices).toEqual([2])
  })

  it("反平行的行是依赖行（同一条约束的正负写法）", () => {
    const report = rankRows([
      [0, 1, 0],
      [0, -5, 0]
    ])
    expect(report.rank).toBe(1)
    expect(report.dependentIndices).toEqual([1])
  })

  it("零行算依赖行 —— 它没有多压掉任何一个方向", () => {
    const report = rankRows([
      [0, 0, 0],
      [0, 1, 0]
    ])
    expect(report.rank).toBe(1)
    expect(report.dependentIndices).toEqual([0])
  })

  it("空输入是 0 行 0 秩，不抛", () => {
    expect(rankRows([])).toEqual({ rank: 0, dependentIndices: [] })
  })

  it("行长不一致要抛：静默按短的对齐会算出一个看不出来的错秩", () => {
    expect(() => rankRows([[1, 0], [1]])).toThrow(/不一致/)
  })

  it("阈值是绝对的：远低于 1e-8 的残差方向算依赖，明显高于的算独立", () => {
    expect(rankRows([[1, 0], [1, 1e-12]]).dependentIndices).toEqual([1])
    expect(rankRows([[1, 0], [1, 1e-3]]).dependentIndices).toEqual([])
  })
})
