import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import type { DocumentHandle } from "./contracts"
import { createSceneObservation, type SceneDocumentSnapshot } from "./sceneObservation"
import { createSceneTools } from "./tools/sceneTools"
import { createToolDispatcher, DISPATCHABLE_TOOL_IDS } from "./toolDispatch"
import { createToolRegistry } from "./toolRegistry"

/**
 * **工具分发**（Task 2.4 缺的那一半）。
 *
 * `ToolPort` 早就定义了，但 `ToolCallRequest` 只有 `run` / `toolCallId` / `actionCount` / `signal`
 * —— **没有工具名，也没有参数**，所以端口根本无法执行任何工具（"接上 ToolPort"因此一直是
 * 一句空话）。工具目录（`toolRegistry.ts`）声明了模型能看到什么，`sceneTools.ts` 实现了真正的
 * 观察调用，而**从名字到实现的这一段**此前不存在：这个文件就是它。
 *
 * 三条纪律：
 * 1. **只认目录里声明的名字**。模型可以要求任何字符串，分发器只认自己这张表 —— 未知名字
 *    如实报错，不猜、不转发。
 * 2. **参数畸形也要如实报错**，而不是把 `undefined` 传下去让下层崩在某处。
 * 3. **最要紧的一条**：分发器**不提供任何写文档的工具**。写入只有 `CommitterPort.commit` 一条路。
 */
function document(workspace: GeometryDocument["workspace"], primitives: unknown[]): GeometryDocument {
  return { ...createEmptyDocument(workspace), primitives } as unknown as GeometryDocument
}

function snapshot(value: GeometryDocument, id = value.metadata.id): SceneDocumentSnapshot {
  const handle: DocumentHandle = { projectId: "p", documentId: id, workspace: value.workspace as DocumentHandle["workspace"], epoch: `epoch:${id}`, generation: value.revision, contentHash: contentFingerprint(value) }
  return { handle, document: value }
}

const scene = document("conics", [
  { id: "point-1", type: "point", x: 0, y: 0, label: "点 A" },
  { id: "point-2", type: "point", x: 1, y: 0, label: "点 B" }
])

function dispatcher() {
  const observation = createSceneObservation([snapshot(scene)])
  return createToolDispatcher({ scene: createSceneTools(observation) })
}

describe("tool dispatch", () => {
  it("runs scene.inspect with the document the caller named", () => {
    const result = dispatcher().call("scene.inspect", { documentId: scene.metadata.id })

    expect(result.status).toBe("success")
    expect(result.payload).toHaveLength(2)
  })

  it("runs scene.search_entities and keeps the query in the summary", () => {
    const result = dispatcher().call("scene.search_entities", { documentId: scene.metadata.id, query: "点 A" })

    expect(result.status).toBe("success")
    expect(result.payload).toHaveLength(1)
  })

  it("refuses a tool that is not in the catalogue instead of guessing what it meant", () => {
    const result = dispatcher().call("shell.exec", { command: "rm -rf /" })

    expect(result.status).toBe("error")
    expect(result.diagnostics.map((entry) => entry.code)).toContain("unknown_tool")
    expect(result.payload).toBeNull()
  })

  it("refuses a declared read tool that has no handler yet, and says so honestly", () => {
    // `scene.measure` 在目录里（模型看得到），但观察层还没有它的实现。
    // 这里必须**如实**说"还没有实现"，而不是返回一个看起来像测量结果的东西。
    const result = dispatcher().call("scene.measure", { documentId: scene.metadata.id })

    expect(result.status).toBe("error")
    expect(result.diagnostics.map((entry) => entry.code)).toContain("tool_not_implemented")
  })

  it("refuses malformed arguments instead of passing undefined down a layer", () => {
    const missing = dispatcher().call("scene.inspect", {})
    expect(missing.status).toBe("error")
    expect(missing.diagnostics.map((entry) => entry.code)).toContain("invalid_arguments")

    const wrongType = dispatcher().call("scene.search_entities", { documentId: scene.metadata.id, query: 42 })
    expect(wrongType.status).toBe("error")
    expect(wrongType.diagnostics.map((entry) => entry.code)).toContain("invalid_arguments")
  })

  it("never offers a tool that writes the document", () => {
    // 目录里唯一的写工具是 `draft.confirm_commit`；分发器必须**不认它** ——
    // 写入只有 `CommitterPort.commit` 一条路（计划 Task 0.8 Step 3）。
    const result = dispatcher().call("draft.confirm_commit", {})

    expect(result.status).toBe("error")
    expect(result.diagnostics.map((entry) => entry.code)).toContain("unknown_tool")
    expect(DISPATCHABLE_TOOL_IDS).not.toContain("draft.confirm_commit")
  })

  it("only dispatches names the tool catalogue actually declares", () => {
    const declared = new Set(createToolRegistry().forPhase("observing", { workspace: "conics", confirmed: false, capabilityRevision: "x" }).map((tool) => tool.id))

    // 分发器认的每个名字都必须能在某处被声明（否则就是"偷偷多了一条通道"）。
    for (const id of DISPATCHABLE_TOOL_IDS) {
      const anywhere = (["observing", "planning", "compiling", "validating", "awaiting_confirmation", "waiting"] as const)
        .some((phase) => createToolRegistry().forPhase(phase, { workspace: "cad", confirmed: true, capabilityRevision: "x" }).some((tool) => tool.id === id))
      expect(anywhere, `${id} is dispatched but never declared`).toBe(true)
    }
    expect(declared.size).toBeGreaterThan(0)
  })
})
