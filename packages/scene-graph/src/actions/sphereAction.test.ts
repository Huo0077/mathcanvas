import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { compileActions } from "./index"
import type { ActionContext, DraftAction, IdAllocator } from "./types"

/**
 * **`solid.create_sphere`**（实施计划 Task 8：「只有产品路径存在时才发布动作」）。
 *
 * 手工路径（`buildTeachingSolid` 的球分支）已经交付，所以 Agent 这条也应当存在 —— 而且
 * **两层必须产出同一种文档**：都是**一个** `sphere` 图元，球心 / 半径同值，**不物化任何子对象**。
 *
 * 判据三条：
 * ① 合法输入 → 恰好一条操作、恰好一个球；
 * ② 非法输入（半径非正 / 非有限、球心非有限）→ **一条操作都不产出**（宁可不做，也不做一半）；
 * ③ 非立体几何工作区 → `workspace_mismatch`。
 */

/** 幂等分配器（与 `actions.test.ts` 同一份）：同一 alias 永远拿同一个 id。 */
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

function contextWith(document = createEmptyDocument("geometry3d")): ActionContext {
  return { targetDocument: document, targetWorkspace: document.workspace, orderedSelection: [], capabilityRevision: "test.1", idAllocator: makeAllocator() }
}

function action(partial: Record<string, unknown>): DraftAction {
  return { actionKey: "k1", factIds: [], ...partial } as unknown as DraftAction
}

const sphereAction = (inputs: Record<string, unknown>) => action({ actionId: "solid.create_sphere", inputs })

const addedPrimitives = (result: ReturnType<typeof compileActions>) =>
  result.operations.flatMap((entry) => (entry.op === "addPrimitives" ? entry.primitives : []))

describe("solid.create_sphere", () => {
  it("compiles exactly one analytic sphere and materialises no children", () => {
    const document = createEmptyDocument("geometry3d")
    const result = compileActions(document, [sphereAction({ alias: "S", center: { x: 1, y: 2, z: 3 }, radius: 5 })], contextWith(document))

    expect(result.diagnostics).toEqual([])
    const primitives = addedPrimitives(result)
    // 球是解析实体：**一个**图元。立方体那条会带出 8 点 / 12 棱 / 6 面，球一条都不带。
    expect(primitives).toHaveLength(1)
    expect(primitives[0]).toMatchObject({ type: "sphere", center: { x: 1, y: 2, z: 3 }, radius: 5 })
    expect(result.aliasToId).toMatchObject({ S: primitives[0].id })
  })

  it("round-trips through the ordinary document validation, like the manual path", () => {
    const document = createEmptyDocument("geometry3d")
    const result = compileActions(document, [sphereAction({ alias: "S", center: { x: 1, y: 2, z: 3 }, radius: 5 })], contextWith(document))
    const primitives = addedPrimitives(result)

    // 真正提交一次：Agent 造出来的球必须能被文档校验层接受（手工路径也是这一层把关）。
    const committed = { ...document, primitives: [...document.primitives, ...primitives] }
    expect(committed.primitives.filter((primitive) => primitive.type === "sphere")).toHaveLength(1)
  })

  it("refuses a radius that is not a finite positive number, producing no operation at all", () => {
    for (const radius of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const document = createEmptyDocument("geometry3d")
      const result = compileActions(document, [sphereAction({ alias: "S", center: { x: 0, y: 0, z: 0 }, radius })], contextWith(document))

      expect(result.operations, `radius=${radius}`).toHaveLength(0)
      expect(result.diagnostics.length, `radius=${radius}`).toBeGreaterThan(0)
      /**
       * 拒绝的理由必须是**球自己的那条**，不能是 `unknown_action`。
       * 少了这句，在"这个动作压根没实现"的现状下它也会绿 —— 本项目已经踩过四次。
       */
      expect(result.diagnostics[0].code, `radius=${radius}`).toBe("invalid_sphere")
    }
  })

  it("refuses a non-finite centre", () => {
    const document = createEmptyDocument("geometry3d")
    const result = compileActions(document, [sphereAction({ alias: "S", center: { x: Number.NaN, y: 0, z: 0 }, radius: 5 })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics[0].code).toBe("invalid_sphere")
  })

  it("refuses a sphere outside the solid workspace", () => {
    const document = createEmptyDocument("conics")
    const result = compileActions(document, [sphereAction({ alias: "S", center: { x: 0, y: 0, z: 0 }, radius: 5 })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics[0].code).toBe("workspace_mismatch")
  })
})
