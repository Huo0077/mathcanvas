import { describe, expect, it } from "vitest"

import { createToolRegistry, type ToolDescriptor, type ToolEnvironment } from "./toolRegistry"
import { DISPATCHABLE_TOOL_IDS } from "./toolDispatch"
import type { RunPhase } from "./runState"

/**
 * **发布前门禁的机器判据**（Phase 6 / Task 6.3）。
 *
 * `docs/acceptance/agent-release-gate.md` 是那份门禁的**读数**，这个文件是它的**判据**。
 * 两者分工照旧：文档说"现在能不能放行"，测试说"什么情况下不许放行"。
 *
 * ## 为什么把门禁做成测试而不是一段文档
 *
 * 计划第 3 条（"不允许出现模型可见但 dispatcher 未实现的工具"）在本项目**真的发生过**：
 * 登记表里有、分发表里没有，症状是模型看得到某个工具、调用它却拿到 `unknown_tool`，
 * 而排障的人会以为模型在瞎编工具（Phase 1 花了两轮消灭这一类）。
 * 写在文档里的纪律不会在下一个人加工具时生效；写在测试里会。
 */

const ALL_PHASES: RunPhase[] = ["created", "preflight", "observing", "planning", "answering", "compiling", "validating", "awaiting_confirmation", "committing", "waiting", "completed", "failed", "cancelled", "interrupted"]
const WORKSPACES: ToolEnvironment["workspace"][] = ["conics", "geometry3d", "cad"]

function environment(workspace: ToolEnvironment["workspace"], overrides: Partial<ToolEnvironment> = {}): ToolEnvironment {
  return { workspace, confirmed: true, readToolsAvailable: true, capabilityRevision: "2026-09-19.1", ...overrides }
}

/** 模型面发布的全部工具（跨阶段 × 工作区 × 确认与否，取并集）。 */
function everyModelFacingTool(): ToolDescriptor[] {
  const seen = new Map<string, ToolDescriptor>()
  for (const workspace of WORKSPACES) {
    for (const phase of ALL_PHASES) {
      for (const confirmed of [false, true]) {
        for (const readToolsAvailable of [false, true]) {
          for (const tool of createToolRegistry().forModelPhase(phase, environment(workspace, { confirmed, readToolsAvailable }))) seen.set(tool.id, tool)
        }
      }
    }
  }
  return [...seen.values()]
}

describe("release gate: no model-visible tool without an execution path", () => {
  it("gives every model-facing read tool a real dispatcher handler", () => {
    /**
     * 这一条正是计划第 3 条。判据是"发布 ⟹ 可执行"，而不是"发布的东西看起来合理"。
     */
    const withoutHandler = everyModelFacingTool()
      .filter((tool) => tool.effect === "none")
      .filter((tool) => !(DISPATCHABLE_TOOL_IDS as readonly string[]).includes(tool.id))
      .map((tool) => tool.id)

    expect(withoutHandler, `these tools are model-visible but have no handler: ${withoutHandler.join(", ")}`).toEqual([])
  })

  it("publishes exactly one non-read tool to the model, and names it", () => {
    /**
     * 模型面上**唯一**的非只读工具是 `plan.set_plan`（`effect: "propose_plan"`）——
     * 它的作用就是"把这一轮的计划说出来"，不碰草稿也不碰文档
     *（`propose_plan` 与 `stage_actions` 的分开正是为此，见 `toolRegistry.ts` 的 `ToolEffect`）。
     *
     * 判据写成**精确集合**而不是"不许有非只读工具"：后者在写这条时就把
     * `plan.set_plan` 冤枉成违规（我第一版正是这么写的，测试当场红了），
     * 而那会让人把判据放宽成"凡非只读一律放行"—— 那是另一头。
     *
     * 精确集合的另一个好处：哪天草稿类工具该上模型面（Phase 2 的草稿往返），
     * 这条会红，逼那次改动**显式**把它加进这个名单。
     */
    const nonRead = everyModelFacingTool()
      .filter((tool) => tool.effect !== "none")
      .map((tool) => tool.id)
      .sort()

    expect(nonRead).toEqual(["plan.set_plan"])
  })

  it("never lets a draft-writing or document-committing tool reach the model", () => {
    // 计划 Task 0.8 Step 3："do not expose `commit` as a model-facing tool"，
    // 而 `stage_actions` 会改草稿 —— 两者都不该出现在模型面上。
    const forbidden: readonly string[] = ["draft.confirm_commit", "draft.stage_actions", "draft.discard", "draft.verify"]
    for (const tool of everyModelFacingTool()) expect(forbidden, tool.id).not.toContain(tool.id)
  })

  it("never exposes the document commit tool to the model, in any phase or workspace", () => {
    // 计划 Task 0.8 Step 3 的原话是 "do not expose `commit` as a model-facing tool"。
    for (const tool of everyModelFacingTool()) expect(tool.effect, tool.id).not.toBe("commit")
  })

  it("keeps the read tools reachable only when a host tool port is connected", () => {
    /**
     * 发布一个**没有宿主执行器**的只读工具，等于让模型调用它并拿到一个端口错误 ——
     * 那与"未实现的工具"是同一类失败，只是发生在另一层。
     */
    const registry = createToolRegistry()
    for (const workspace of WORKSPACES) {
      const withoutPort = registry.forModelPhase("observing", environment(workspace, { readToolsAvailable: false })).map((tool) => tool.id)
      for (const id of DISPATCHABLE_TOOL_IDS) expect(withoutPort, `${id} in ${workspace} without a port`).not.toContain(id)
    }
  })

  it("covers every phase and workspace, so the gate cannot be satisfied by an empty set", () => {
    /**
     * 一条"发现了 0 个问题"的判据，如果它的输入集合本身是空的，就什么都没守住。
     * 这条先证明上面几条**真的在看东西**。
     */
    const tools = everyModelFacingTool()

    expect(tools.length).toBeGreaterThan(0)
    expect(tools.some((tool) => tool.effect === "none")).toBe(true)
  })
})
