import { createEmptyDocument } from "@draw/dsl"
import type { DomainOperation } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { createDraftingCommands, type CreationStep } from "./draftingCommands"

/**
 * **拆出来的 2D 创建流程要留住原来的行为**（评审方案 2）。
 *
 * 这段是"点两下画一条线"的现场：点击序列本身就是状态（`creationStep`），所以下面的夹具
 * **照着组件的语义复现那一步状态更新**（`setCreationStep` 把值存下来，下一次点击用新的值重建）。
 * 这样测的是真实的点击序列，而不是"拿一个手搭的中间状态去调一次函数"。
 *
 * 钉住的是三条：**3D 工作区里模式转发给三维工具**、**两点太近就不建**（退化图元）、
 * **折线双击收尾要去重**。
 */

const session = (workspace: "cad" | "geometry3d" = "cad", overrides: Partial<Parameters<typeof createDraftingCommands>[0]> = {}) => {
  const document = createEmptyDocument(workspace)
  document.activeLayerId = "layer-1"
  let step: CreationStep | null = null
  const applied: DomainOperation[] = []
  const selections: string[][] = []
  const guidances: (string | null)[] = []
  const forwarded: string[] = []
  const build = () => createDraftingCommands({
    document,
    creationStep: step,
    addLine3: () => forwarded.push("line"),
    addPlane3: () => forwarded.push("plane"),
    addFace3: () => forwarded.push("face"),
    canCreateLine3: false,
    canCreatePlane3: false,
    canCreateFace3: false,
    selectedPoint3Ids: [],
    apply: (operation) => applied.push(operation),
    setCreationStep: (next) => { step = next },
    setSelectedIds: (ids) => selections.push(ids),
    setGuidance: (value) => guidances.push(value),
    cadLayerFields: () => (document.activeLayerId ? { layerId: document.activeLayerId } : {}),
    ...overrides
  })
  return {
    document,
    applied,
    selections,
    guidances,
    forwarded,
    step: () => step,
    start: (mode: Parameters<ReturnType<typeof build>["startCreation"]>[0]) => build().startCreation(mode),
    click: (coordinate: { x: number; y: number }) => build().handleCanvasCreationClick(coordinate),
    doubleClick: (coordinate: { x: number; y: number }) => build().handleCanvasDoubleClick(coordinate)
  }
}

const firstPrimitive = (applied: DomainOperation[]) => {
  const operation = applied[0]
  if (operation.op !== "addPrimitive") throw new Error(`expected addPrimitive, received ${operation.op}`)
  return operation.primitive
}

describe("drafting commands", () => {
  it("starts a 2D creation step and explains it in the status bar", () => {
    const s = session()
    s.start("circle")
    expect(s.step()).toEqual({ mode: "circle", center: null })
    expect(s.guidances).toHaveLength(1)
  })

  it("forwards the 3D modes to the space tools, and guides instead of failing", () => {
    // 3D 工作区里"直线"就是空间直线：能建就转发，不能建就给**指引**（还要选几个点）。
    const ready = session("geometry3d", { canCreateLine3: true })
    ready.start("line")
    expect(ready.forwarded).toEqual(["line"])
    expect(ready.step()).toBeNull()

    const blocked = session("geometry3d")
    blocked.start("line")
    expect(blocked.forwarded).toHaveLength(0)
    expect(blocked.guidances).toHaveLength(1)
  })

  it("takes a centre first, then lands a line on the active layer", () => {
    const s = session()
    s.start("line")
    s.click({ x: 0, y: 0 })
    expect(s.applied).toHaveLength(0)
    expect(s.step()).toEqual({ mode: "line", center: { x: 0, y: 0 } })

    s.click({ x: 3, y: 4 })
    expect(firstPrimitive(s.applied)).toMatchObject({ type: "line", a: { x: 0, y: 0 }, b: { x: 3, y: 4 }, layerId: "layer-1" })
    // 建完就退出创建流程（否则下一次点击会莫名其妙再建一个）。
    expect(s.step()).toBeNull()
  })

  it("refuses a degenerate line when the two clicks are on top of each other", () => {
    const s = session()
    s.start("segment")
    s.click({ x: 1, y: 1 })
    s.click({ x: 1.01, y: 1 })
    // 退化图元之后会变成"看不见但删不掉"的东西 —— 干脆不建。
    expect(s.applied).toHaveLength(0)
  })

  it("takes the circle radius from the second click", () => {
    const s = session()
    s.start("circle")
    s.click({ x: 0, y: 0 })
    s.click({ x: 3, y: 4 })
    expect(firstPrimitive(s.applied)).toMatchObject({ type: "circle", center: { x: 0, y: 0 }, radius: 5 })
  })

  it("collects polyline points and drops the duplicate at the closing double click", () => {
    const s = session()
    s.start("polyline")
    s.click({ x: 0, y: 0 })
    s.click({ x: 2, y: 0 })
    s.click({ x: 2, y: 2 })
    // 双击收尾那一击常常与最后一个点重合：不该多出一个重合点。
    s.doubleClick({ x: 2, y: 2 })
    expect(firstPrimitive(s.applied)).toMatchObject({ type: "polyline", points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }] })
  })

  it("refuses to close a polyline that has fewer than two points", () => {
    const s = session()
    s.start("polyline")
    s.click({ x: 0, y: 0 })
    s.doubleClick({ x: 0, y: 0 })
    expect(s.applied).toHaveLength(0)
  })

  it("ignores clicks when no creation is in progress", () => {
    const s = session()
    s.click({ x: 1, y: 1 })
    s.doubleClick({ x: 1, y: 1 })
    expect(s.applied).toHaveLength(0)
  })
})
