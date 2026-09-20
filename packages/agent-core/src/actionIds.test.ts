import { describe, expect, it } from "vitest"

import { assertActionIdCatalogueIsComplete, DRAFT_ACTION_IDS } from "./actionIds"
import { parseDraftAction } from "./schemas"

/**
 * 这份用例是**实测缺陷**的回归守卫。
 *
 * 实测过程：动作层（`packages/scene-graph/src/actions/types.ts`）认得 **20** 个 actionId，
 * 而传输层的 `ACTIONS` 只登记了 **4** 个。后果是模型给出的合法动作被 `parseDraftAction`
 * 判为 `unknown_action` —— 报错像是"模型编了个不存在的动作"，实际是登记表过期，
 * 于是十几个已实现的动作**根本无法从模型输出到达编译器**。
 *
 * 编译期已在 `actionIds.ts` 用两处 `satisfies` 做了双向守卫；这里再运行期核对一次：
 * schema 是安全边界，而编译期守卫在有人跳过 `tsc` 时不会生效。
 */
describe("draft action catalogue", () => {
  it("lists every action the compiler implements", () => {
    // 20 是编译期实测值（`DraftAction["actionId"]` 的成员数）。数字写死在这里是有意的：
    // 动作层新增动作时这条会失败，提醒把新动作接进传输层，而不是让它静默不可达。
    expect(DRAFT_ACTION_IDS).toHaveLength(20)
    expect(new Set(DRAFT_ACTION_IDS).size).toBe(20)
  })

  it("recognises every catalogue action instead of calling it unknown", () => {
    for (const actionId of DRAFT_ACTION_IDS) {
      const result = parseDraftAction({ actionId, actionKey: "k", factIds: [], inputs: {} })
      // 载荷可以为空（语义校验在编译器里）；但**名字必须被认出**。
      const codes = result.ok ? [] : result.errors.map((error) => error.code)
      expect(codes, `${actionId} was rejected as ${codes.join(",")}`).not.toContain("unknown_action")
    }
  })

  it("still refuses a name that no action implements", () => {
    const result = parseDraftAction({ actionId: "planar.create_dragon", actionKey: "k", factIds: [], inputs: {} })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((error) => error.code === "unknown_action")).toBe(true)
  })

  it("refuses the two action names that were registered but never implemented", () => {
    // 这两条是**错的登记项**：动作层里没有 `object.delete` / `object.update`，
    // 真名是 `object.delete_many` / `object.update_inputs`。它们必须被拒，否则模型会一直用错名字。
    for (const ghost of ["object.delete", "object.update"]) {
      const result = parseDraftAction({ actionId: ghost, actionKey: "k", factIds: [], inputs: {} })
      expect(result.ok, `${ghost} should not be accepted`).toBe(false)
    }
  })

  it("keeps the compile-time guard reachable", () => {
    // `assertActionIdCatalogueIsComplete` 存在的理由是让"反方向守卫"那个常量被用到；
    // 它本身不该有任何行为。
    expect(assertActionIdCatalogueIsComplete()).toBe(true)
  })
})
