import { createEmptyDocument, type ConstraintSpec, type GeometryDocument, type PrimitiveSpec } from "@draw/dsl"
import { beforeEach, describe, expect, it } from "vitest"

import { planConstrainedDrag3 } from "./constrainedDrag3"
import { useSceneStore } from "./store"

/**
 * **约束拖动之后，一次撤销回到原状** —— N3 计划 RED 里点名的最后一条，
 * 也是发布门禁与记分卡都写明"**没有任何用例验过**"的那一条。
 *
 * ## 为什么它能在单元层验，不必等浏览器
 *
 * "一步撤销"不是界面行为，而是**事务边界**的行为：拖动的提交走**一次** `applyBatch`
 * （→ `commitTransaction`），所以它本来就该正好占**一步**历史。用**真的** `useSceneStore`
 *（不是替身）就能把这件事钉死 —— 与 `agentRunner.test.ts` 里那条"确认提交一步撤销"同一口径。
 *
 * ## 两条判据一正一反
 *
 * 1. **拖动真的改了东西，而且一次撤销回到原状** —— 少了前半句，"撤销回原状"可能是**空转**
 *（`.each` 那条教训的另一面：**要证明的不是"撤销之后没变"，而是"变过、然后被撤销回去了"**）；
 * 2. **被约束完全抵消的那次拖动（`noop`）一步历史都不占** —— 否则用户按 Ctrl+Z 会撤掉一个
 *    看不出任何变化的"幽灵步骤"。
 */

function scene(extra: PrimitiveSpec[] = []): PrimitiveSpec[] {
  return [
    { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } },
    { id: "b", type: "point3", position: { x: 1, y: 0, z: 0 } },
    { id: "c", type: "point3", position: { x: 0, y: 1, z: 0 } },
    /** `p` 一开始就**在这张平面上**（z = 0）。 */
    { id: "p", type: "point3", position: { x: 2, y: 3, z: 0 } },
    { id: "plane-abc", type: "plane3", definition: { kind: "throughPoints", pointIds: ["a", "b", "c"] } },
    ...extra
  ]
}

const ON_PLANE: ConstraintSpec[] = [{ id: "on-plane", type: "pointOnPlane", targets: ["p", "plane-abc"] }]

function documentWith(primitives: PrimitiveSpec[], constraints: ConstraintSpec[] = []): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  document.primitives = primitives
  document.constraints = constraints
  return document
}

/** 把一份文档装进**真的** store，并把历史清空（与 `pipeline.test.ts` 的 `makeHarness` 同口径）。 */
function load(document: GeometryDocument) {
  useSceneStore.setState({
    document,
    workspaceDocuments: { [document.workspace]: document },
    history: [],
    future: [],
    error: null
  })
}

function positionOf(id: string): { x: number; y: number; z: number } | null {
  const primitive = useSceneStore.getState().document.primitives.find((entry) => entry.id === id)
  return primitive?.type === "point3" ? primitive.position : null
}

describe("约束拖动的一步撤销（N3 计划 RED 的最后一条）", () => {
  beforeEach(() => {
    load(documentWith(scene(), ON_PLANE))
  })

  it("**拖动真的改了东西，然后一次撤销回到原状**（且只占一步历史）", () => {
    const before = useSceneStore.getState().document
    // 切向 1（会被采纳）+ 法向 5（会被约束消掉）——两者都有，才既真的动了、又保住了约束。
    const outcome = planConstrainedDrag3({ document: before, draggedId: "p", delta: { x: 1, y: 0, z: 5 }, enabled: true })
    expect(outcome.kind).toBe("commit")
    if (outcome.kind !== "commit") return

    useSceneStore.getState().applyBatch(outcome.operations)

    // ① 约束保住了（还在 z = 0 上），而且**真的**动了 —— 否则下一步是空转。
    expect(positionOf("p")).toEqual({ x: 3, y: 3, z: 0 })
    // ② 整批提交**只占一步**历史。
    expect(useSceneStore.getState().history).toHaveLength(1)

    useSceneStore.getState().undo()

    // ③ 撤销一次就回到拖动之前，历史也回到零。
    expect(positionOf("p")).toEqual({ x: 2, y: 3, z: 0 })
    expect(useSceneStore.getState().document.primitives).toEqual(before.primitives)
    expect(useSceneStore.getState().history).toHaveLength(0)
  })

  it("被约束**完全抵消**的那次拖动（`noop`）：一个坐标都不写，一步历史都不占", () => {
    const before = useSceneStore.getState().document
    // 纯法向：`p` 被推到平面外，投影又把它放回原地 —— 净变化为零。
    const outcome = planConstrainedDrag3({ document: before, draggedId: "p", delta: { x: 0, y: 0, z: 5 }, enabled: true })

    expect(outcome.kind).toBe("noop")
    expect(positionOf("p")).toEqual({ x: 2, y: 3, z: 0 })
    expect(useSceneStore.getState().history).toHaveLength(0)
  })
})
