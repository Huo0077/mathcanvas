import { describe, expect, it } from "vitest"

import type { RunPhase } from "./runState"
import { actionsWithoutAChannel, createToolRegistry, describeEnvironmentMismatch, isWritingTool, READ_ONLY_PHASES, TOOL_REGISTRY_REVISION, type ToolEnvironment } from "./toolRegistry"

/**
 * Task 2.2 Step 3 的发布面。
 *
 * 重点不是"工具能列出来"，而是**按阶段发布**这件事本身是安全边界：
 * 工具的可见性就是模型的能力边界。
 */
function environment(overrides: Partial<ToolEnvironment> = {}): ToolEnvironment {
  return { workspace: "conics", confirmed: false, capabilityRevision: "2026-09-19.1", ...overrides }
}

const ALL_PHASES: RunPhase[] = ["created", "preflight", "observing", "planning", "answering", "compiling", "validating", "awaiting_confirmation", "committing", "waiting", "completed", "failed", "cancelled", "interrupted"]

describe("tool publication by phase", () => {
  it("publishes between 6 and 10 tools in the phases that do work", () => {
    const registry = createToolRegistry()

    for (const phase of ["observing", "planning", "compiling", "validating"] as RunPhase[]) {
      const tools = registry.forPhase(phase, environment())
      // 太少不够用；太多等于把整个菜单摊开（清单存在的理由就是不要摊开）。
      expect(tools.length, `phase ${phase} published ${tools.length}`).toBeGreaterThanOrEqual(6)
      expect(tools.length, `phase ${phase} published ${tools.length}`).toBeLessThanOrEqual(10)
    }
  })

  it("publishes nothing at all in phases where the model is not working", () => {
    const registry = createToolRegistry()

    for (const phase of ["created", "committing", "completed", "failed", "cancelled", "interrupted"] as RunPhase[]) {
      expect(registry.forPhase(phase, environment()), `phase ${phase}`).toHaveLength(0)
    }
  })

  it("offers the seven observation tools the plan names", () => {
    const registry = createToolRegistry()
    const ids = registry.forPhase("observing", environment()).map((tool) => tool.id)

    for (const id of ["scene.inspect", "scene.search_entities", "scene.describe_entities", "scene.dependencies", "scene.measure", "scene.check_relations", "scene.capabilities"]) {
      expect(ids, `missing ${id}`).toContain(id)
    }
  })
})

describe("writing tools stay out of read-only phases", () => {
  it("never publishes a writing tool while observing or planning", () => {
    const registry = createToolRegistry()

    for (const phase of ["observing", "planning", "waiting"] as RunPhase[]) {
      expect(registry.forPhase(phase, environment()).filter(isWritingTool), `phase ${phase}`).toHaveLength(0)
    }
  })

  it("keeps every read-only phase free of writing tools", () => {
    const registry = createToolRegistry()
    for (const phase of READ_ONLY_PHASES) {
      expect(registry.forPhase(phase, environment()).filter(isWritingTool), `phase ${phase}`).toHaveLength(0)
    }
  })

  it("publishes a draft-building control only where a draft can be built", () => {
    const registry = createToolRegistry()
    const withStaging = ALL_PHASES.filter((phase) => registry.forPhase(phase, environment()).some((tool) => tool.effect === "stage_actions" || tool.effect === "propose_plan"))

    // 规划阶段有 `plan.set_plan`（提议计划）、编译与确认阶段有 `draft.stage_actions` / `draft.discard`。
    expect(withStaging.sort()).toEqual(["awaiting_confirmation", "compiling", "planning"])
  })
})

describe("commit is gated on a one-time confirmation", () => {
  it("hides the commit tool until the user has confirmed", () => {
    const registry = createToolRegistry()

    const unconfirmed = registry.forPhase("awaiting_confirmation", environment({ confirmed: false }))
    const confirmed = registry.forPhase("awaiting_confirmation", environment({ confirmed: true }))

    expect(unconfirmed.some((tool) => tool.effect === "commit")).toBe(false)
    expect(confirmed.some((tool) => tool.effect === "commit")).toBe(true)
  })

  it("never publishes the commit tool outside the confirmation phase, even when confirmed", () => {
    // 这条是"模型不能自己找时机提交"：确认之后工具也只在该阶段存在。
    const registry = createToolRegistry()

    for (const phase of ALL_PHASES) {
      if (phase === "awaiting_confirmation") continue
      expect(registry.forPhase(phase, environment({ confirmed: true })).some((tool) => tool.effect === "commit"), `phase ${phase}`).toBe(false)
    }
  })

  it("describes the commit tool as needing a credential instead of hiding that requirement", () => {
    const registry = createToolRegistry()
    const commit = registry.forPhase("awaiting_confirmation", environment({ confirmed: true })).find((tool) => tool.effect === "commit")

    expect(commit).toBeTruthy()
    // 描述会原样进模型上下文，所以要如实说明"需要一次性确认凭据"。
    expect(commit?.description).toContain("确认")
  })
})

describe("the environment actually filters tools", () => {
  it("hides workspace-specific tools outside their workspace", () => {
    // 第一版 `ToolEnvironment.workspace` **声明了却完全没用** ——
    // 于是模型在平面几何里也能看到空间建模与制图的工具。声明了却没接上的边界比没有边界更危险。
    const registry = createToolRegistry()

    const inPlanar = registry.forPhase("observing", environment({ workspace: "conics" })).map((tool) => tool.id)
    const inSpatial = registry.forPhase("observing", environment({ workspace: "geometry3d" })).map((tool) => tool.id)
    const inCad = registry.forPhase("observing", environment({ workspace: "cad" })).map((tool) => tool.id)

    expect(inPlanar).not.toContain("cad.inspect_drawing")
    expect(inPlanar).not.toContain("scene.check_section")
    expect(inCad).toContain("cad.inspect_drawing")
    // 截面检查在立体几何与制图里都有意义（制图可以投影空间文档）。
    expect(inSpatial).toContain("scene.check_section")
    expect(inCad).toContain("scene.check_section")
  })

  it("keeps the workspace-agnostic tools in every workspace", () => {
    const registry = createToolRegistry()

    for (const workspace of ["conics", "geometry3d", "cad"] as const) {
      const ids = registry.forPhase("observing", environment({ workspace })).map((tool) => tool.id)
      // 空 `workspaces` 数组表示"任何工作区"。
      expect(ids, workspace).toContain("scene.inspect")
      expect(ids, workspace).toContain("scene.capabilities")
    }
  })

  it("reports a capability-revision mismatch instead of silently using a stale catalogue", () => {
    expect(describeEnvironmentMismatch(environment())).toBeNull()
    const warning = describeEnvironmentMismatch(environment({ capabilityRevision: "2020-01-01.1" }))
    expect(warning).toContain(TOOL_REGISTRY_REVISION)
    expect(warning).toContain("2020-01-01.1")
  })
})

describe("tool catalogue hygiene", () => {
  it("gives every tool a description and at least one phase", () => {
    const registry = createToolRegistry()

    for (const phase of ALL_PHASES) {
      for (const tool of registry.forPhase(phase, environment({ confirmed: true }))) {
        expect(tool.description.length, tool.id).toBeGreaterThan(0)
        expect(tool.phases.length, tool.id).toBeGreaterThan(0)
      }
    }
  })

  it("gives every skill manifest a channel to act through", () => {
    // 清单说"允许这些动作"，而模型只能用控制工具产生动作。
    // 若没有任何 `stage_actions` 通道，那些清单就是空头支票。
    expect(actionsWithoutAChannel()).toEqual([])
  })

  it("keeps the observation tools available in every working phase", () => {
    // 模型在任何工作阶段都可能需要再看一眼场景；观察工具不该随阶段消失。
    const registry = createToolRegistry()

    for (const phase of ["observing", "planning", "compiling", "validating", "awaiting_confirmation"] as RunPhase[]) {
      const ids = registry.forPhase(phase, environment()).map((tool) => tool.id)
      expect(ids, `phase ${phase}`).toContain("scene.inspect")
      expect(ids, `phase ${phase}`).toContain("scene.describe_entities")
    }
  })
})
