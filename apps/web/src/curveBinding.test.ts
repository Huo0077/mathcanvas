import { describe, expect, it } from "vitest"
import { createEmptyDocument } from "@draw/dsl"
import { applyOperation } from "@draw/scene-graph"

import {
  createBoundPointCreationOperations,
  createPointBindingOperations,
  findNearestCurveTarget
} from "./curveBinding"

describe("curveBinding - 画布直通点轨绑定", () => {
  it("在指针靠近曲线时能精确计算在轨投影与参数", () => {
    const doc = createEmptyDocument("conics")
    doc.primitives = [
      { id: "line-1", type: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, label: "l_1" }
    ]

    // 位于 (5, 0.1)，距离直线 0.1 个世界单位。如果 scale 为 50（像素/世界单位），像素距离为 5px <= 14px
    const target = findNearestCurveTarget(doc, { x: 5, y: 0.1 }, 50)
    expect(target).not.toBeNull()
    expect(target!.path.id).toBe("line-1")
    expect(target!.point.x).toBeCloseTo(5)
    expect(target!.point.y).toBeCloseTo(0)
    expect(target!.parameter).toBeCloseTo(0.5)
  })

  it("当距离超出吸附半径阈值时不触发吸附", () => {
    const doc = createEmptyDocument("conics")
    doc.primitives = [
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 5, label: "c_1" }
    ]

    // 位于 (0, 0)，距离圆周 5 个世界单位，scale 为 50 时距离为 250px >> 14px
    const target = findNearestCurveTarget(doc, { x: 0, y: 0 }, 50)
    expect(target).toBeNull()
  })

  it("支持吸附圆周并计算正确的弧度参数", () => {
    const doc = createEmptyDocument("conics")
    doc.primitives = [
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2, label: "c_1" }
    ]

    // 位于 (2.05, 0)，距离圆周 (2, 0) 为 0.05，scale 为 50 时为 2.5px
    const target = findNearestCurveTarget(doc, { x: 2.05, y: 0 }, 50)
    expect(target).not.toBeNull()
    expect(target!.point.x).toBeCloseTo(2)
    expect(target!.point.y).toBeCloseTo(0)
    expect(target!.parameter).toBeCloseTo(0)
  })

  it("忽略隐藏或锁定的曲线", () => {
    const doc = createEmptyDocument("conics")
    doc.primitives = [
      { id: "line-hidden", type: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, visible: false },
      { id: "line-locked", type: "line", a: { x: 0, y: 1 }, b: { x: 10, y: 1 }, locked: true }
    ]

    const target = findNearestCurveTarget(doc, { x: 5, y: 0 }, 50)
    expect(target).toBeNull()
  })

  it("循环依赖防护：点不能绑定到以自身为基础派生出的曲线上", () => {
    const doc = createEmptyDocument("conics")
    doc.primitives = [
      { id: "p-a", type: "point", x: 0, y: 0 },
      { id: "p-b", type: "point", x: 4, y: 0 },
      // line-ab 依赖 p-a 和 p-b
      { id: "line-ab", type: "segment", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }
    ]

    const target = findNearestCurveTarget(doc, { x: 2, y: 0.02 }, 50, { draggedPointId: "p-a", excludeIds: ["line-ab"] })
    expect(target).toBeNull()
  })

  it("生成单步事务化绑定操作并可通过单步 Ctrl+Z 完整恢复自由点状态", () => {
    const doc = createEmptyDocument("conics")
    doc.primitives = [
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 3, label: "圆 1" },
      { id: "point-free", type: "point", x: 5, y: 5, label: "P" }
    ]

    const target = findNearestCurveTarget(doc, { x: 3.02, y: 0 }, 50)
    expect(target).not.toBeNull()

    const ops = createPointBindingOperations(doc, "point-free", target!, "P")
    expect(ops).toHaveLength(2)
    expect(ops[0].op).toBe("setParameter")
    expect(ops[1].op).toBe("updatePrimitive")

    // 执行事务操作
    let boundDoc = doc
    for (const op of ops) {
      const res = applyOperation(boundDoc, op)
      expect(res.changed).toBe(true)
      boundDoc = res.document
    }

    const boundPoint = boundDoc.primitives.find((p) => p.id === "point-free")
    expect(boundPoint).toMatchObject({
      x: expect.closeTo(3),
      y: expect.closeTo(0),
      binding: {
        kind: "onPath",
        pathId: "circle-1",
        parameterId: "t-point-free"
      }
    })
    expect(boundDoc.parameters["t-point-free"]).toBeDefined()
    expect(boundDoc.parameters["t-point-free"].ownerId).toBe("point-free")
  })

  it("生成在曲线上直接创建动点的单步事务操作", () => {
    const doc = createEmptyDocument("conics")
    doc.primitives = [
      { id: "line-1", type: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, label: "直线 1" }
    ]

    const target = findNearestCurveTarget(doc, { x: 4, y: 0.05 }, 50)
    expect(target).not.toBeNull()

    const ops = createBoundPointCreationOperations(doc, "point-new", "A", target!)
    expect(ops).toHaveLength(2)
    expect(ops[0].op).toBe("setParameter")
    expect(ops[1].op).toBe("addPrimitive")

    let updatedDoc = doc
    for (const op of ops) {
      const res = applyOperation(updatedDoc, op)
      expect(res.changed).toBe(true)
      updatedDoc = res.document
    }

    const newPoint = updatedDoc.primitives.find((p) => p.id === "point-new")
    expect(newPoint).toMatchObject({
      type: "point",
      label: "A",
      x: expect.closeTo(4),
      y: expect.closeTo(0),
      binding: {
        kind: "onPath",
        pathId: "line-1",
        parameterId: "t-point-new"
      }
    })
    expect(updatedDoc.parameters["t-point-new"]).toBeDefined()
  })
})
