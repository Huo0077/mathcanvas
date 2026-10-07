import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { createFace3, createPoint3, createPolyhedron3 } from "../index"
import { compileActions } from "./index"
import type { ActionContext, DraftAction, IdAllocator } from "./types"

/**
 * **`derived.create_circumsphere` / `derived.create_insphere`**（S5 派生球）。
 *
 * 与 `sphereAction.test.ts`（`solid.create_sphere`）的分工是"谁决定几何"：那只球的球心与半径由调用方给，
 * 这一族的两个数**只能由宿主算出来**。判据三条：
 * ① 宿主算得出 → 恰好一条操作、球的球心 / 半径**等于内核解出来的那组**，且带 `derivedFrom` 绑定
 *（宿主动了才会跟着重算）；
 * ② 宿主算不出（例：长方体没有内切球）→ **一条操作都不产出**，诊断说清"这只实体没有内切球"，
 *    **不编一个球**（设计 §4.1）；
 * ③ 宿主不存在 / 不是多面体、或工作区不对 → 明确诊断。
 *
 * （文件名不是 `derivedSphereAction.test.ts`：那个路径被我上一轮的 PowerShell 文本替换写坏过，
 * 删掉之后工具的快照还停在旧状态；换个名字不改变它测的东西。）
 */

function makeAllocator(): IdAllocator {
  const known = new Map<string, string>()
  let counter = 0
  return {
    allocate(kind, alias) {
      const key = `${kind}:${alias}`
      const existing = known.get(key)
      if (existing) return existing
      counter += 1
      const id = `${kind}-${counter}`
      known.set(key, id)
      return id
    }
  }
}

function contextWith(document: GeometryDocument): ActionContext {
  return { targetDocument: document, targetWorkspace: document.workspace, orderedSelection: [], capabilityRevision: "test.1", idAllocator: makeAllocator() }
}

const action = (actionId: string, inputs: Record<string, unknown>): DraftAction =>
  ({ actionKey: "k1", factIds: [], actionId, inputs }) as unknown as DraftAction

const addedPrimitives = (result: ReturnType<typeof compileActions>) =>
  result.operations.flatMap((entry) => (entry.op === "addPrimitives" ? entry.primitives : []))

/** `compileActions(文档, 动作, 上下文)`：文档在前、上下文在后，别写反。 */
const compile = (document: GeometryDocument, actions: DraftAction[]) => compileActions(document, actions, contextWith(document))

/** 立方体（棱长 2、一角在原点）：外接球 `(1,1,1)`/`√3`，内切球 `(1,1,1)`/`1`。 */
function cubeDocument(): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  const corners: [string, number, number, number][] = [
    ["a", 0, 0, 0], ["b", 2, 0, 0], ["c", 2, 2, 0], ["d", 0, 2, 0],
    ["e", 0, 0, 2], ["f", 2, 0, 2], ["g", 2, 2, 2], ["h", 0, 2, 2]
  ]
  const points = corners.map(([name, x, y, z]) => createPoint3(`p-${name}`, { x, y, z }))
  const rings: string[][] = [
    ["a", "b", "c", "d"], ["e", "f", "g", "h"],
    ["a", "b", "f", "e"], ["b", "c", "g", "f"], ["c", "d", "h", "g"], ["d", "a", "e", "h"]
  ]
  const faces = rings.map((ring, index) => createFace3(`f-${index}`, ring.map((name) => `p-${name}`)))
  document.primitives = [...points, ...faces, createPolyhedron3("solid-1", points.map((point) => point.id), [], faces.map((face) => face.id))]
  return document
}

/** 长方体 `2 × 4 × 6`：外接球存在，**内切球不存在**（到三对面 1/2/3，没有到六面等距的点）。 */
function brickDocument(): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  const corners: [string, number, number, number][] = [
    ["a", 0, 0, 0], ["b", 2, 0, 0], ["c", 2, 4, 0], ["d", 0, 4, 0],
    ["e", 0, 0, 6], ["f", 2, 0, 6], ["g", 2, 4, 6], ["h", 0, 4, 6]
  ]
  const points = corners.map(([name, x, y, z]) => createPoint3(`p-${name}`, { x, y, z }))
  const rings: string[][] = [
    ["a", "b", "c", "d"], ["e", "f", "g", "h"],
    ["a", "b", "f", "e"], ["b", "c", "g", "f"], ["c", "d", "h", "g"], ["d", "a", "e", "h"]
  ]
  const faces = rings.map((ring, index) => createFace3(`f-${index}`, ring.map((name) => `p-${name}`)))
  document.primitives = [...points, ...faces, createPolyhedron3("solid-1", points.map((point) => point.id), [], faces.map((face) => face.id))]
  return document
}

describe("derived.create_circumsphere / derived.create_insphere", () => {
  it("writes exactly one bound sphere, with the geometry the kernel solved for the host", () => {
    const result = compile(cubeDocument(), [action("derived.create_circumsphere", { alias: "O", solidId: "solid-1" })])
    expect(result.diagnostics).toEqual([])
    const primitives = addedPrimitives(result)
    expect(primitives).toHaveLength(1)
    const sphere = primitives[0] as { type: string; center: { x: number; y: number; z: number }; radius: number; derivedFrom?: unknown }
    expect(sphere.type).toBe("sphere")
    expect(sphere.center).toEqual({ x: 1, y: 1, z: 1 })
    expect(sphere.radius).toBeCloseTo(Math.sqrt(3), 10)
    // **绑定必须在**：没有它，这只球以后不会跟着宿主重算（那就退回"物化但不重算"，设计明确否决）。
    expect(sphere.derivedFrom).toEqual({ kind: "circumsphere", solidId: "solid-1" })
  })

  it("solves the insphere of a cube", () => {
    const result = compile(cubeDocument(), [action("derived.create_insphere", { alias: "I", solidId: "solid-1" })])
    expect(result.diagnostics).toEqual([])
    const sphere = addedPrimitives(result)[0] as { center: { x: number; y: number; z: number }; radius: number }
    expect(sphere.center).toEqual({ x: 1, y: 1, z: 1 })
    expect(sphere.radius).toBeCloseTo(1, 10)
  })

  it("produces no operation at all when the solid has no such sphere, and says why", () => {
    /**
     * 长方体**没有内切球**：正确行为是**拒绝整条动作**并说清理由，
     * 而不是交一个半径 1 的"最大内接球" —— 那会让用户读成"这个长方体的内切球半径是 1"。
     */
    const result = compile(brickDocument(), [action("derived.create_insphere", { alias: "I", solidId: "solid-1" })])
    expect(addedPrimitives(result)).toHaveLength(0)
    expect(result.diagnostics.map((entry) => entry.code)).toContain("no_derived_sphere")
    expect(result.diagnostics.map((entry) => entry.message).join(" ")).toContain("内切球")
  })

  it("refuses a missing host and an off-workspace document", () => {
    const missing = compile(cubeDocument(), [action("derived.create_circumsphere", { alias: "O", solidId: "nope" })])
    expect(addedPrimitives(missing)).toHaveLength(0)
    expect(missing.diagnostics.map((entry) => entry.code)).toContain("missing_host")

    // 非立体几何工作区：`conics` 是合法的另一种工作区（**不能瞎写 "geometry"** ——
    // `Workspace` 是闭集，写错的字面量只有 `typecheck` 拦得住，vitest 不查类型）。
    const planar = createEmptyDocument("conics")
    const wrongWorkspace = compile(planar, [action("derived.create_circumsphere", { alias: "O", solidId: "solid-1" })])
    expect(addedPrimitives(wrongWorkspace)).toHaveLength(0)
    expect(wrongWorkspace.diagnostics.map((entry) => entry.code)).toContain("workspace_mismatch")
  })
})
