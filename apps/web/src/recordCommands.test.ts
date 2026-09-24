import { createEmptyDocument } from "@draw/dsl"
import type { DomainOperation } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { createRecordCommands } from "./recordCommands"

/**
 * **拆出来的"记录"命令要留住原来的行为**（评审方案 2）。
 *
 * 标注 / 参数 / 测量这三样都不是几何，而是挂在图元或文档上的记录；搬到
 * `./recordCommands` 之后，六项依赖都能换成假货，"命令往文档里写什么、什么时候**不**写"
 * 可以直接问。这里挑的是不需要真几何就能钉住的那几条。
 */

const workspace = (name: "cad" | "geometry3d", primitives: unknown[] = []) => {
  const document = createEmptyDocument(name)
  document.primitives = primitives as typeof document.primitives
  return document
}

const harness = (name: "cad" | "geometry3d", primitives: unknown[] = [], selectedIds: string[] = []) => {
  const document = workspace(name, primitives)
  const selectedPrimitive = (selectedIds.at(-1) ?? null) === null ? null : document.primitives.find((primitive) => primitive.id === selectedIds.at(-1)) ?? null
  const applied: DomainOperation[] = []
  const guidances: (string | null)[] = []
  const errors: string[] = []
  const commands = createRecordCommands({
    document,
    selectedPrimitive,
    selectedIds,
    apply: (operation) => applied.push(operation),
    setGuidance: (value) => guidances.push(value),
    setFileError: (message) => { if (message !== null) errors.push(message) }
  })
  return { commands, applied, guidances, errors }
}

const point = { id: "point-1", type: "point", x: 1, y: 2, label: "A" }

describe("record commands", () => {
  it("anchors a new annotation to the selected primitive and names it", () => {
    const { commands, applied } = harness("cad", [point], ["point-1"])
    commands.addAnnotation("label" as never, 0)

    expect(applied).toHaveLength(1)
    // 锚点是**对图元的引用**（不是当时的坐标快照），标注因此跟着图元走。
    expect(applied[0]).toMatchObject({ op: "addAnnotation", annotation: { anchor: { kind: "primitive", primitiveId: "point-1", index: 0 }, visible: true } })
    // 有 label 就用 label（用户认得出的是名字，不是 id）。
    expect((applied[0] as { annotation: { text: string } }).annotation.text).toBe("A · label 1")

    // 没有 label 的图元退回 id —— 否则会生成一条名字空着的标注。
    const unlabeled = harness("cad", [{ id: "point-2", type: "point", x: 0, y: 0 }], ["point-2"])
    unlabeled.commands.addAnnotation("label" as never)
    expect((unlabeled.applied[0] as { annotation: { text: string } }).annotation.text).toContain("point-2")
  })

  it("does nothing when there is nothing selected to annotate", () => {
    const { commands, applied } = harness("cad")
    commands.addAnnotation("label" as never)
    expect(applied).toHaveLength(0)
  })

  it("picks the first free parameter name", () => {
    const first = harness("cad")
    first.commands.addParameter()
    // 值 / 上下界 / 步长一次给全，否则滑块没有可用范围。
    expect(first.applied[0]).toMatchObject({ op: "setParameter", id: "p1", value: 0.5, min: 0, max: 1, step: 0.01 })

    // 名字被占用时往后找：这条规则只有一处实现，所以换个文档复核它的第二个落点。
    const document = workspace("cad")
    document.parameters["p1"] = { id: "p1", value: 0, min: 0, max: 1, step: 0.1, label: "参数 1" }
    const appliedSecond: DomainOperation[] = []
    createRecordCommands({
      document,
      selectedPrimitive: null,
      selectedIds: [],
      apply: (operation) => appliedSecond.push(operation),
      setGuidance: () => undefined,
      setFileError: () => undefined
    }).addParameter()
    expect(appliedSecond[0]).toMatchObject({ op: "setParameter", id: "p2" })
  })

  it("asks for sources instead of writing a meaningless measurement", () => {
    // 平面工作区、零个来源：预检必须判为无意义，于是给指引、**不落盘**。
    const { commands, applied, guidances, errors } = harness("cad")
    commands.addMeasurement("length" as never)

    expect(applied).toHaveLength(0)
    expect(guidances).toHaveLength(1)
    expect(errors).toHaveLength(0)
  })

  it("reports why a measurement cannot be deleted instead of deleting it", () => {
    const { commands, applied, errors } = harness("cad")
    commands.deleteMeasurement("measurement-404")

    expect(applied).toHaveLength(0)
    // 删除要走校验：不存在的 id 会被拒，原因如实报出来（不是静默失败）。
    expect(errors.length).toBeGreaterThan(0)
  })
})
