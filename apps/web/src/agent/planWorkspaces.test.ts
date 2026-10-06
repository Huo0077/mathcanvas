import { describe, expect, it } from "vitest"

import { DRAFT_ACTION_IDS, PLAN_SCHEMA_VERSION, type PlanEnvelope } from "@draw/agent-core"

import { planWorkspaces } from "./agentRunner"

/**
 * **"这条计划要去哪个工作区"必须有用例**（V0d）。
 *
 * ## 为什么单独有这份文件
 *
 * 这个判断此前**没有任何用例**。V0d 加 `function.create_graph` 时，我把它路由到了 `calculus` ——
 * 而 `calculus` **已经退役**（`App.test.tsx` 钉着"外壳里不再提供"，`draftStorage` 钉着
 * "旧草稿不许重开它"，`useAgentDocumentBinding` 只给三个在役工作区做绑定）。
 * 结果是：Agent 会把用户切进一个界面上根本不存在的工作区，而**全量测试全绿** ——
 * 因为没有一条用例问过"这个动作该去哪个工作区"。
 *
 * 这份文件把那个问题钉住：函数族去 `conics`（平面几何），且**任何动作族都不许路由到 `calculus`**。
 */
function planWith(...actionIds: readonly string[]): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "工作区路由用例",
    factIds: [],
    actions: actionIds.map((actionId) => ({ actionId, actionKey: "a", factIds: [], inputs: {} }))
  } as never
}

describe("planWorkspaces", () => {
  it("sends function actions to the plane workspace, where function graphs actually live now", () => {
    expect(planWorkspaces(planWith("function.create_graph"))).toEqual(["conics"])
    expect(planWorkspaces(planWith("function.create_graph", "function.create_tangent"))).toEqual(["conics"])
  })

  it("returns the same set whatever order the model wrote the actions in", () => {
    /**
     * 这个函数的返回值是"**需要哪些**工作区"的集合，不是最终目标 ——
     * 从集合里挑哪一个落在 `prepareWorkspaceFor`（三维优先），那里没有被导出。
     * 所以这里钉的是**集合与动作顺序无关**这一半；另一半靠 `prepareWorkspaceFor` 的固定偏好次序。
     */
    const first = [...planWorkspaces(planWith("planar.create_point", "solid.create_prism", "function.create_graph"))].sort()
    const second = [...planWorkspaces(planWith("solid.create_prism", "function.create_graph", "planar.create_point"))].sort()
    expect(first).toEqual(["conics", "geometry3d"])
    expect(second).toEqual(first)
    // 只涉及 2D 两族时，集合就是平面几何一个。
    expect(planWorkspaces(planWith("function.create_graph", "planar.create_point"))).toEqual(["conics"])
  })

  it("never routes any action family to the retired calculus workspace", () => {
    for (const actionId of DRAFT_ACTION_IDS) {
      const target = planWorkspaces(planWith(actionId))
      expect(target, `${actionId} 被路由到了已退役的工作区`).not.toContain("calculus" as never)
    }
  })

  it("asks for no switch at all when the plan is not a plan", () => {
    expect(planWorkspaces({ schemaVersion: PLAN_SCHEMA_VERSION, kind: "answer", goal: "只读回答", factIds: [], answer: "没有动作", toolResultRefs: [] } as never)).toEqual([])
  })
})
