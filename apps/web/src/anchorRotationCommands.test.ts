import { createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"
import type { DomainOperation } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { createAnchorRotationCommands, type AnchorRotationDeps } from "./anchorRotationCommands"

/**
 * **拆出来的"动圆 / 绕定点旋转"要留住原来的行为**（评审方案 2）。
 *
 * 这两条命令原来定义在 `App.tsx` 的组件体里。搬到 `./anchorRotationCommands` 之后，
 * 七项依赖都能换成假货 —— 于是"曲线到底怎么摆、写进文档的是引用还是快照"可以直接问。
 *
 * 最要紧的两条不变式都在下面的用例里：**定点写的是对点的引用**（不是坐标快照），
 * **两笔补丁走一次批量提交**（整批一步撤销）。
 */

const scene = (primitives: PrimitiveSpec[]) => {
  const document = createEmptyDocument("cad")
  document.primitives = primitives
  return document
}

const point = { id: "point-1", type: "point", x: 2, y: 0, label: "A" } as PrimitiveSpec
const circle = { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 } as PrimitiveSpec

const harness = (selectedPrimitive: PrimitiveSpec | null, anchor: AnchorRotationDeps["rotationAnchor"], primitives: PrimitiveSpec[] = [point, circle]) => {
  const applied: DomainOperation[] = []
  const batched: DomainOperation[][] = []
  const errors: string[] = []
  const pending: string[] = []
  const commands = createAnchorRotationCommands({
    document: scene(primitives),
    selectedPrimitive,
    rotationAnchor: anchor,
    apply: (operation) => applied.push(operation),
    applyBatch: (operations) => batched.push(operations),
    setFileError: (message) => { if (message !== null) errors.push(message) },
    setPendingSelection: (id) => pending.push(id)
  })
  return { commands, applied, batched, errors, pending }
}

const anchorOf = () => ({ point: point as Extract<PrimitiveSpec, { type: "point" }>, curve: circle as Extract<PrimitiveSpec, { type: "circle" | "ellipse" }> })

describe("anchor rotation commands", () => {
  it("creates a moving circle whose pivot is a reference to the point", () => {
    const { commands, applied, pending } = harness(point, null, [point])
    commands.createMovingCircle()

    expect(applied).toHaveLength(1)
    const primitive = (applied[0] as { primitive: { id: string; type: string; rotationAbout?: { pivot: unknown; baseCenter: unknown } } }).primitive
    expect(primitive.type).toBe("circle")
    // **引用而不是快照**：定点还是一个活的点，之后拖它曲线会跟着转。
    expect(primitive.rotationAbout?.pivot).toEqual({ kind: "primitive", primitiveId: "point-1" })
    // 圆心摆在定点正右方一个默认半径处 —— 参数 0 落在定点上，所以"过定点"从第一帧就成立。
    expect(primitive.rotationAbout?.baseCenter).toEqual({ x: 2 + 2, y: 0 })
    // 新建的曲线要等文档更新之后才选中，所以这里只登记"待选中"。
    expect(pending).toEqual([primitive.id])
  })

  it("does nothing without a point to anchor on", () => {
    const { commands, applied, pending } = harness(null, null, [])
    commands.createMovingCircle()
    expect(applied).toHaveLength(0)
    expect(pending).toHaveLength(0)
  })

  it("anchors the rotation in one batch, point first", () => {
    const { commands, batched } = harness(null, anchorOf())
    commands.anchorRotation()

    // **一次批量**（不是两次 apply）：整批只压一条撤销记录，中间状态不会留在历史里。
    expect(batched).toHaveLength(1)
    const [first, second] = batched[0] as { op: string; id: string; patch: Record<string, unknown> }[]
    expect(first.op).toBe("updatePrimitive")
    expect(first.id).toBe("point-1")   // 点先落到位
    expect(second.id).toBe("circle-1") // 曲线再摆到"过它"的位置
    expect((second.patch.rotationAbout as { pivot: unknown }).pivot).toEqual({ kind: "primitive", primitiveId: "point-1" })
  })

  it("refuses a point that sits at the curve's centre", () => {
    // 点在曲线上没有确定方向（与圆心重合）：如实拒绝，而不是摆一条任意朝向的曲线。
    const atCentre = { id: "point-1", type: "point", x: 0, y: 0, label: "A" } as PrimitiveSpec
    const { commands, batched, errors } = harness(null, { point: atCentre as Extract<PrimitiveSpec, { type: "point" }>, curve: circle as Extract<PrimitiveSpec, { type: "circle" | "ellipse" }> }, [atCentre, circle])
    commands.anchorRotation()

    expect(batched).toHaveLength(0)
    expect(errors).toHaveLength(1)
  })

  it("does nothing without both a point and a closed curve", () => {
    const { commands, batched } = harness(null, null)
    commands.anchorRotation()
    expect(batched).toHaveLength(0)
  })
})
