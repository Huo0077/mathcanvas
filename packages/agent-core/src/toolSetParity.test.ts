import { describe, expect, it } from "vitest"

import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"

import type { DocumentHandle } from "./contracts"
import { createSceneObservation, type SceneDocumentSnapshot } from "./sceneObservation"
import { createSceneTools } from "./tools/sceneTools"
import { createToolDispatcher, DISPATCHABLE_TOOL_IDS } from "./toolDispatch"
import { createToolRegistry, type ToolEnvironment } from "./toolRegistry"
import { parseReadToolInput, toolInputs } from "./readToolSchemas"
import type { RunPhase } from "./runState"

/**
 * **工具目录 = schema = 分发器**（Phase 1 阶段门槛）。
 *
 * ## 这一组用例挡的是什么
 *
 * "模型看得到某个工具，宿主却不会执行它"是这一层最坏的一类失败：模型会照着工具列表
 * 反复调用，每次都拿到 `unknown_tool`，而排障的人会以为**模型在瞎编工具**。
 *
 * 三个集合此前是三份**手写清单**：
 * - `toolRegistry.ts` 的 `TOOLS`（模型能看到什么）
 * - `readToolSchemas.ts` 的 `toolInputs`（有哪些读工具的 schema 与必填参数）
 * - `toolDispatch.ts` 的 `DISPATCHABLE_TOOL_IDS`（宿主真的能执行什么）
 *
 * 既有用例只钉住了**一个方向**（分发器认的名字必须在目录里声明过）。
 * 反方向 —— "目录声明了、但分发器没有 handler" —— 没有任何用例挡着，
 * 而那正是"模型看得到却调不动"的方向。
 *
 * 这一组把三个集合的一致性逐条钉死，并且**用一个真实参数去调一次**：
 * 光比对名单不够，名单一致但 handler 抛错也同样是坏的。
 */

const ALL_PHASES: RunPhase[] = ["created", "preflight", "observing", "planning", "answering", "compiling", "validating", "awaiting_confirmation", "committing", "waiting", "completed", "failed", "cancelled", "interrupted"]

function environment(overrides: Partial<ToolEnvironment> = {}): ToolEnvironment {
  return { workspace: "conics", confirmed: false, capabilityRevision: "2026-09-19.1", ...overrides }
}

/** 目录里真正声明过的工具（含只对模型发布的那些）。 */
function declaredToolIds(): string[] {
  const ids = new Set<string>()
  for (const phase of ALL_PHASES) {
    for (const tool of createToolRegistry().forPhase(phase, environment({ confirmed: true, readToolsAvailable: true }))) ids.add(tool.id)
    for (const tool of createToolRegistry().forModelPhase(phase, environment({ confirmed: true, readToolsAvailable: true }))) ids.add(tool.id)
  }
  return [...ids].sort()
}

/** 按 schema 造一份刚好合法的参数，用来真的调一次。 */
function validArgumentsFor(toolId: (typeof DISPATCHABLE_TOOL_IDS)[number], documentId: string): Record<string, unknown> {
  const spec = toolInputs[toolId] as { required: readonly string[]; properties: Record<string, { type: string; items?: { type: string } }> }
  const args: Record<string, unknown> = {}
  for (const field of spec.required) {
    const property = spec.properties[field]
    if (field === "documentId") args[field] = documentId
    else if (field === "entityId" || field === "entityIds") args[field] = property?.type === "array" ? ["point-1"] : "point-1"
    else if (property?.type === "array") args[field] = ["point-1"]
    else args[field] = "probe"
  }
  return args
}

function sceneFixture() {
  const document = {
    ...createEmptyDocument("conics"),
    primitives: [
      { id: "point-1", type: "point", x: 0, y: 0, label: "点 A" },
      { id: "point-2", type: "point", x: 1, y: 0, label: "点 B" }
    ]
  } as unknown as GeometryDocument
  const handle: DocumentHandle = {
    projectId: "p",
    documentId: document.metadata.id,
    workspace: "conics",
    epoch: `epoch:${document.metadata.id}`,
    generation: document.revision,
    contentHash: contentFingerprint(document)
  }
  const snapshot: SceneDocumentSnapshot = { handle, document }
  return { document, dispatcher: createToolDispatcher({ scene: createSceneTools(createSceneObservation([snapshot])) }) }
}

describe("tool catalogue, schemas and dispatcher agree", () => {
  it("derives the dispatchable set from the read-tool schemas instead of a second list", () => {
    expect([...DISPATCHABLE_TOOL_IDS].sort()).toEqual(Object.keys(toolInputs).sort())
  })

  it("gives every declared tool a real execution path", () => {
    /**
     * 逐条核对"声明 ⟹ 可执行"。只有一处刻意例外，且它必须**有名字地**例外：
     * `draft.confirm_commit` 是目录里唯一的写工具，分发器**明确不认它** ——
     * 写文档只有 `CommitterPort.commit` 一条路（计划 Task 0.8 Step 3）。
     */
    const notDispatchable = declaredToolIds().filter((id) => !(DISPATCHABLE_TOOL_IDS as readonly string[]).includes(id))
    /**
     * 这些是**控制类**工具：它们改的是隔离草稿、不是文档，因此不走只读分发表。
     * `draft.verify` 同样在这一类里（它验证草稿的候选文档）。
     * 例外必须**有名字**地列出来，而不是"凡是控制类都放行" ——
     * 后者会让将来任何一个新控制工具自动获得豁免。
     */
    const controlTools = ["plan.set_plan", "draft.stage_actions", "draft.discard", "draft.verify"]
    expect(notDispatchable.filter((id) => !controlTools.includes(id) && id !== "draft.confirm_commit")).toEqual([])
    // 上面那条是"键面"检查；下面这条才是真正的承诺：写工具绝不出现在分发表里。
    expect(DISPATCHABLE_TOOL_IDS as readonly string[]).not.toContain("draft.confirm_commit")
  })

  it("never declares a dispatched tool only somewhere the model cannot reach", () => {
    const declared = new Set(declaredToolIds())
    for (const id of DISPATCHABLE_TOOL_IDS) {
      expect(declared.has(id), `${id} is dispatched but never declared in the catalogue`).toBe(true)
    }
  })

  it("publishes exactly the executable read tools once the host tool port is connected", () => {
    const registry = createToolRegistry()
    for (const phase of ["observing", "planning", "compiling", "validating", "awaiting_confirmation"] as RunPhase[]) {
      const modelFacing = registry.forModelPhase(phase, environment({ readToolsAvailable: true })).map((tool) => tool.id)
      const reads = modelFacing.filter((id) => (DISPATCHABLE_TOOL_IDS as readonly string[]).includes(id))
      expect(reads, `phase ${phase}`).toEqual([...DISPATCHABLE_TOOL_IDS])
    }
  })

  it("publishes no read tool at all when the host tool port is not connected", () => {
    const registry = createToolRegistry()
    const modelFacing = registry.forModelPhase("planning", environment({ readToolsAvailable: false })).map((tool) => tool.id)
    for (const id of DISPATCHABLE_TOOL_IDS) expect(modelFacing, id).not.toContain(id)
  })

  it("actually runs every dispatched tool with schema-valid arguments", () => {
    // 名单一致不代表能跑：这里用 schema 造一份刚好合法的参数，真的调一次，要求**不是**错误。
    const { document, dispatcher } = sceneFixture()
    for (const id of DISPATCHABLE_TOOL_IDS) {
      const args = validArgumentsFor(id, document.metadata.id)
      const parsed = parseReadToolInput(id, args)
      expect(parsed.ok, `${id} rejected its own schema-shaped arguments`).toBe(true)
      const result = dispatcher.call(id, args)
      expect(result.status, `${id} returned ${result.summary}`).toBe("success")
      expect(result.diagnostics.filter((entry) => entry.code === "unknown_tool"), id).toEqual([])
      expect(result.diagnostics.filter((entry) => entry.code === "tool_not_implemented"), id).toEqual([])
    }
  })

  it("keeps every declared read tool at effect none, so nothing read-only can write", () => {
    for (const phase of ALL_PHASES) {
      for (const tool of createToolRegistry().forPhase(phase, environment({ confirmed: true }))) {
        if (!(DISPATCHABLE_TOOL_IDS as readonly string[]).includes(tool.id)) continue
        expect(tool.effect, tool.id).toBe("none")
        expect(tool.kind, tool.id).toBe("read")
      }
    }
  })
})
