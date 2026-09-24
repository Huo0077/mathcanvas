import { createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"
import type { DomainOperation } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import type { IntersectionPreview } from "./intersectionPreview"
import { createPreviewCommands } from "./previewCommands"
import type { ThreeScenePreview } from "./threeScenePreview"

/**
 * **拆出来的"点预览就建图元"要留住原来的行为**（评审方案 2）。
 *
 * 两条命令原来定义在 `App.tsx` 的组件体里（而且**隔着** `createSolidCommands` 那一行：
 * 3D 那条要用它的 `addSection`）。搬到 `./previewCommands` 之后，五项目依赖都能换成假货，
 * 于是"点下去到底写了什么"可以直接问。
 *
 * 这里最要紧的两条：**hint 就是"用户点的那个解"**（不是随手给一个原点），
 * 以及**线与圆的顺序会被摆正**（`lineCircleIntersection` 的字段名有方向，写反了重算就认不出）。
 */

const preview = (over: Partial<ThreeScenePreview>): ThreeScenePreview => ({
  key: "preview-1",
  kind: "face",
  sourceIds: ["solid-1", "solid-2"],
  segments: [],
  points: [],
  label: "预览",
  ...over
})

const intersectionPreview = (over: Partial<IntersectionPreview> = {}): IntersectionPreview => ({
  objectA: "line-1",
  objectB: "circle-1",
  point: { x: 2, y: 0 },
  solutionIndex: 1,
  approximate: false,
  ...over
})

const harness = (primitives: PrimitiveSpec[] = [], addSection = () => undefined) => {
  const document = createEmptyDocument("geometry3d")
  document.primitives = primitives
  const applied: DomainOperation[] = []
  const selections: string[][] = []
  const notices: (string | null)[] = []
  const commands = createPreviewCommands({
    document,
    apply: (operation) => applied.push(operation),
    setSelectedIds: (ids) => selections.push(ids),
    setLayerNotice: (message) => notices.push(message),
    addSection
  })
  return { commands, applied, selections, notices, document }
}

/** 取"新增图元"那一笔的图元体（先按 `op` 收窄，不把联合硬断言成别的形状）。 */
const added = (applied: DomainOperation[]) => {
  const operation = applied[0]
  if (operation.op !== "addPrimitive") throw new Error(`expected addPrimitive, received ${operation.op}`)
  return operation.primitive
}

describe("preview commands", () => {
  it("hands the section preview straight to the existing section command", () => {
    let sections = 0
    const { commands, applied, notices } = harness([], () => { sections += 1 })
    commands.createFromPreview(preview({ kind: "section", sourceIds: ["solid-1"] }))

    // 不在预览这条路上另写一份剖切平面逻辑：两条路各写一遍必然会长出"两边不一样"。
    expect(sections).toBe(1)
    expect(applied).toHaveLength(0)
    expect(notices).toHaveLength(0)
  })

  it("creates an intersection face whose hint is the point the user clicked", () => {
    const { commands, applied, selections, notices } = harness()
    commands.createFromPreview(preview({ kind: "face", hint: { x: 1, y: 2, z: 3 } }))

    expect(added(applied)).toMatchObject({ type: "intersectionFace", sourceIds: ["solid-1", "solid-2"], points: [], hint: { x: 1, y: 2, z: 3 } })
    expect(selections).toHaveLength(1)
    expect(notices).toEqual(["已创建交面图元"])
  })

  it("prefers the previewed position for a point, and falls back to the hint", () => {
    const withPosition = harness()
    withPosition.commands.createFromPreview(preview({ kind: "point", position: { x: 5, y: 0, z: 0 }, hint: { x: 9, y: 9, z: 9 } }))
    expect(added(withPosition.applied)).toMatchObject({ type: "intersectionPoint3", position: { x: 5, y: 0, z: 0 } })

    const hintOnly = harness()
    hintOnly.commands.createFromPreview(preview({ kind: "point", hint: { x: 9, y: 9, z: 9 } }))
    expect(added(hintOnly.applied)).toMatchObject({ type: "intersectionPoint3", position: { x: 9, y: 9, z: 9 } })
  })

  it("classifies an intersection line by how many segments it has", () => {
    const single = harness()
    single.commands.createFromPreview(preview({ kind: "intersection", segments: [{ a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } }] }))
    expect(added(single.applied)).toMatchObject({ type: "intersectionLine", classification: "segment", status: "valid" })

    const many = harness()
    many.commands.createFromPreview(preview({ kind: "intersection", segments: [
      { a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } },
      { a: { x: 1, y: 0, z: 0 }, b: { x: 2, y: 0, z: 0 } }
    ] }))
    expect(added(many.applied)).toMatchObject({ type: "intersectionLine", classification: "polyline" })
  })

  it("refuses a preview that does not name two sources", () => {
    const { commands, applied } = harness()
    commands.createFromPreview(preview({ kind: "face", sourceIds: ["solid-1"] }))
    expect(applied).toHaveLength(0)
  })

  it("puts the line and the circle in the right slots, whichever order they were selected", () => {
    const line = { id: "line-1", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } } as PrimitiveSpec
    const circle = { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 } as PrimitiveSpec

    // 先选线：字段名本来就对得上。
    const lineFirst = harness([line, circle])
    lineFirst.commands.createIntersectionFromPreview(intersectionPreview())
    expect(added(lineFirst.applied)).toMatchObject({ type: "lineCircleIntersection", lineId: "line-1", circleId: "circle-1", solutionIndex: 1, hint: { x: 2, y: 0 } })

    // 先选圆：**必须摆正**（`lineCircleIntersection` 的字段名有方向，写反了重算认不出这对来源）。
    const circleFirst = harness([line, circle])
    circleFirst.commands.createIntersectionFromPreview(intersectionPreview({ objectA: "circle-1", objectB: "line-1" }))
    expect(added(circleFirst.applied)).toMatchObject({ lineId: "line-1", circleId: "circle-1" })
  })

  it("refuses an intersection preview whose objects are gone", () => {
    const { commands, applied } = harness()
    commands.createIntersectionFromPreview(intersectionPreview())
    expect(applied).toHaveLength(0)
  })
})
