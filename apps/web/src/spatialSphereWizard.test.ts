import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { buildTeachingSolid } from "./spatialSolidCommands"
import { DEFAULT_SOLID_WIZARD_DRAFT, solidWizardInput, type SolidWizardDraft } from "./spatialSolidWizardModel"

/**
 * **「常用立体」里的球体预设**（实施计划 Task 6 的模型 / 命令那一半）。
 *
 * 判据三条，每条对着一个具体的坏结果：
 * ① 草稿 → 输入的映射要**逐字段**对（球心 + 半径），不能把半径当成"高"或"宽"；
 * ② 半径非法时**先报错，不碰文档** —— 半个球写进文档比"创建失败"糟得多；
 * ③ 球**只落一个图元**：不像立方体那样带出 8 点 / 12 棱 / 6 面（球是解析体，没有子对象）。
 */

const sphereDraft = (overrides: Partial<SolidWizardDraft> = {}): SolidWizardDraft => ({
  ...DEFAULT_SOLID_WIZARD_DRAFT,
  preset: "sphere",
  radius: 5,
  origin: { x: 1, y: 2, z: 3 },
  ...overrides
})

describe("the common-solid wizard's sphere preset", () => {
  it("maps the draft to a sphere input with the centre and the radius", () => {
    expect(solidWizardInput(sphereDraft())).toEqual({ kind: "sphere", center: { x: 1, y: 2, z: 3 }, radius: 5 })
  })

  it("rejects a radius that is not a finite positive number", () => {
    for (const radius of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const input = solidWizardInput(sphereDraft({ radius }))
      expect("error" in input, `radius=${radius}`).toBe(true)
      /**
       * 报错必须**是球那一条**。少了这句，`在"球走棱锥分支"的现状下这条也会绿**
       *（棱锥分支同样会拒绝 0 / NaN），于是它什么都没钉住。
       */
      if ("error" in input) expect(input.error, `radius=${radius}`).toMatch(/球/)
    }
  })

  it("rejects a non-finite centre", () => {
    const input = solidWizardInput(sphereDraft({ origin: { x: Number.NaN, y: 2, z: 3 } }))

    expect("error" in input).toBe(true)
    if ("error" in input) expect(input.error).toMatch(/球/)
  })

  it("builds exactly one sphere primitive — a ball materialises no children", () => {
    const result = buildTeachingSolid(createEmptyDocument("geometry3d"), { kind: "sphere", center: { x: 1, y: 2, z: 3 }, radius: 5 })
    if ("error" in result) throw new Error(result.error)

    expect(result.operations).toHaveLength(1)
    const operation = result.operations[0]
    expect(operation.op).toBe("addPrimitives")
    if (operation.op !== "addPrimitives") return
    // 一个图元，而且就是球自己 —— 没有点 / 棱 / 面 / polyhedron3 跟着落盘。
    expect(operation.primitives).toHaveLength(1)
    expect(operation.primitives[0]).toMatchObject({ id: result.selectedId, type: "sphere", center: { x: 1, y: 2, z: 3 }, radius: 5 })
  })

  it("labels the new sphere 球体 N with N taken from the document", () => {
    const result = buildTeachingSolid(createEmptyDocument("geometry3d"), { kind: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 2 })
    if ("error" in result) throw new Error(result.error)
    const operation = result.operations[0]
    if (operation.op !== "addPrimitives") throw new Error("expected addPrimitives")
    expect(operation.primitives[0].label).toMatch(/^球体 \d+$/)
    expect(result.selectedId).toMatch(/^sphere-\d+$/)
  })

  it("refuses a bad radius before touching the document", () => {
    const document = createEmptyDocument("geometry3d")
    const result = buildTeachingSolid(document, { kind: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 0 })

    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/球/)
    // 原文档一个图元都没有被落进去。
    expect(document.primitives).toHaveLength(0)
  })

  it("refuses to create a sphere outside the 3D workspace", () => {
    const planar = createEmptyDocument("conics")
    const result = buildTeachingSolid(planar, { kind: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 2 })

    expect("error" in result).toBe(true)
  })
})
