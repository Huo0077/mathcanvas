import { act, render, screen } from "@testing-library/react"
import { proofScopeOf } from "@draw/agent-core"
import { createEmptyDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"
import { useSceneStore } from "../../store"
import { describe, expect, it, vi } from "vitest"
import type { AgentConversation } from "../../agentStore"
import { AgentMessageList } from "./AgentMessageList"

const initialScene = createEmptyDocument("geometry3d")
const draft = { draftId: "draft-1", draftVersion: 2, previewHash: "hash", stageCount: 1, undoesInOneStep: true, drawingCertified: true, drawingSceneBinding: { documentId: initialScene.metadata.id, contentHash: contentFingerprint(initialScene) }, diagramVerification: { status: "passed" as const, checks: [{ kind: "unparsed" as const, sourceText: "条件", status: "passed" as const, reason: "已核" }], sampleValues: [], ...proofScopeOf({}) } }
function conversation(committed: boolean): AgentConversation {
  return { id: "conversation-1", title: "一题", createdAt: 1, updatedAt: 1, messages: [{
    id: "message-1", role: "assistant", text: "已作图并回答", createdAt: 1, runId: "run-1", draft,
    ...(committed ? { commit: { status: "committed" as const } } : {})
  }] }
}

describe("draft confirmation lifecycle", () => {
  it("does not leave a stale certified button active after a scene edit", () => {
    useSceneStore.setState({ document: initialScene, workspaceDocuments: { geometry3d: initialScene } })
    const confirm = vi.fn()
    render(<AgentMessageList conversation={conversation(false)} onConfirm={confirm} />)
    expect(screen.getByRole("button", { name: "\u786e\u8ba4\u5e76\u63d0\u4ea4" })).toBeTruthy()
    const edited = structuredClone(initialScene)
    edited.primitives.push({ id: "manual-point", type: "point3", position: { x: 7, y: 4, z: 1 } })
    act(() => useSceneStore.setState({ document: edited, workspaceDocuments: { geometry3d: edited } }))
    expect(screen.queryByRole("button", { name: "\u786e\u8ba4\u5e76\u63d0\u4ea4" })).toBeNull()
    expect(screen.getByRole("region", { name: "\u9898\u8bbe\u6838\u9a8c" }).textContent).toContain("\u5df2\u8fc7\u671f")
    expect(confirm).not.toHaveBeenCalled()
  })

  it("removes the confirmation panel after the same run commits", () => {
    useSceneStore.setState({ document: initialScene, workspaceDocuments: { geometry3d: initialScene } })
    const confirm = vi.fn()
    const { rerender } = render(<AgentMessageList conversation={conversation(false)} onConfirm={confirm} />)
    expect(screen.getByRole("button", { name: "确认并提交" })).toBeTruthy()

    rerender(<AgentMessageList conversation={conversation(true)} onConfirm={confirm} />)
    expect(screen.queryByRole("button", { name: "确认并提交" })).toBeNull()
    expect(screen.getByText("已提交")).toBeTruthy()
    expect(confirm).not.toHaveBeenCalled()
  })
})