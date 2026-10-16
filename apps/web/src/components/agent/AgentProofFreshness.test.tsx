import { act, render, screen } from "@testing-library/react"
import { createEmptyDocument } from "@draw/dsl"
import { beforeEach, describe, expect, it } from "vitest"

import { useAgentStore } from "../../agentStore"
import { createAgentRunner } from "../../agent/agentRunner"
import { saveProofExportEnabled } from "../../persistence/nextPhasePreferences"
import { useSceneStore } from "../../store"
import { AgentMessageList } from "./AgentMessageList"

const PROMPT = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD，画出这个四棱锥，求证 PA ⊥ BD"

function Transcript() {
  const conversation = useAgentStore((state) => state.activeConversation)
  return <AgentMessageList conversation={conversation} />
}

async function stage() {
  const runner = createAgentRunner()
  await act(async () => {
    await useAgentStore.getState().sendPrompt(PROMPT)
    const user = useAgentStore.getState().activeConversation!.messages.at(-2)!
    expect((await runner.run(PROMPT, user.id)).phase).toBe("awaiting_confirmation")
  })
  return runner
}

function proof() { return screen.getByRole("region", { name: "形式证明" }) }

describe("proof transcript follows the real scene, without rewriting historical results", () => {
  beforeEach(() => {
    localStorage.clear()
    useAgentStore.getState().clearAll()
    const document = createEmptyDocument("geometry3d")
    useSceneStore.setState({ document, workspaceDocuments: { geometry3d: document }, history: [], future: [], error: null })
    saveProofExportEnabled(true)
  })

  it("binds the production preview, stays current after confirm, and becomes stale after one undo", async () => {
    render(<Transcript />)
    const runner = await stage()
    expect(proof().getAttribute("data-outcome")).toBe("toolchain_unavailable")
    const original = useAgentStore.getState().activeConversation!.messages.at(-1)!.draft!
    // Browser has no Lean: this verifies real runner -> persisted message -> live panel wiring, not Lean success.
    expect(original.proofSceneBinding).toMatchObject({ documentId: useSceneStore.getState().document.metadata.id })
    await act(async () => { expect(runner.confirm().status).toBe("committed") })
    expect(useSceneStore.getState().document.primitives).toHaveLength(19)
    expect(proof().getAttribute("data-outcome")).toBe("toolchain_unavailable")
    act(() => useSceneStore.getState().undo())
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
    expect(proof().getAttribute("data-outcome")).toBe("stale")
    expect(proof().textContent).toContain("当前画布")
    expect(useAgentStore.getState().activeConversation!.messages.at(-1)!.draft!.proofAttempt).toEqual(original.proofAttempt)
    // Restoring exactly the bound content is safe; no new backend success is invented.
    act(() => useSceneStore.getState().redo())
    expect(proof().getAttribute("data-outcome")).toBe("toolchain_unavailable")
  })

  it("invalidates a pending preview when its base geometry changes", async () => {
    render(<Transcript />)
    await stage()
    act(() => useSceneStore.getState().apply({ op: "addPrimitive", primitive: { id: "other", type: "point3", position: { x: 1, y: 2, z: 3 } } }))
    expect(useSceneStore.getState().error).toBeNull()
    expect(useSceneStore.getState().document.primitives).toHaveLength(1)
    expect(proof().getAttribute("data-outcome")).toBe("stale")
  })

  it("never labels a historical acceptance current after undo, and exposes its actual backend binding", async () => {
    const runner = await stage()
    await act(async () => { runner.confirm() })
    const conversation = useAgentStore.getState().activeConversation!
    // UI acceptance fixture only: real Lean execution is tested separately on the native desktop.
    const messages = conversation.messages.map((message) => message.draft ? { ...message, draft: { ...message.draft,
      proofAttempt: { ...message.draft.proofAttempt!, outcome: "verified" as const, binding: { inputHash: "fixture-proposition-hash", backendVersion: "Lean UI fixture" } }
    } } : message)
    render(<AgentMessageList conversation={{ ...conversation, messages }} />)
    expect(proof().textContent).toContain("受限引理已证")
    expect(proof().textContent).toContain("Lean UI fixture")
    expect(proof().textContent).toContain("fixture-proposition-hash")
    act(() => useSceneStore.getState().undo())
    expect(proof().getAttribute("data-outcome")).toBe("stale")
    expect(proof().textContent).not.toContain("受限引理已证")
  })

  it("fails closed for a legacy acceptance with no saved scene binding", async () => {
    await stage()
    const conversation = useAgentStore.getState().activeConversation!
    const messages = conversation.messages.map((message) => {
      if (!message.draft) return message
      const draft = { ...message.draft }
      delete draft.proofSceneBinding
      return { ...message, draft: { ...draft, proofAttempt: { ...draft.proofAttempt!, outcome: "verified" as const } } }
    })
    render(<AgentMessageList conversation={{ ...conversation, messages }} />)
    expect(proof().getAttribute("data-proof-stale")).toBe("scene_binding_unavailable")
    expect(proof().textContent).not.toContain("受限引理已证")
  })

  it("does not invalidate for revision/time-only updates but does for document replacement", async () => {
    render(<Transcript />)
    const runner = await stage()
    await act(async () => { runner.confirm() })
    const document = useSceneStore.getState().document
    act(() => useSceneStore.setState({ document: { ...document, revision: document.revision + 1, metadata: { ...document.metadata, updatedAt: "2026-10-16T12:00:00Z" } } }))
    expect(proof().getAttribute("data-outcome")).toBe("toolchain_unavailable")
    act(() => useSceneStore.getState().replace(createEmptyDocument("geometry3d")))
    expect(proof().getAttribute("data-outcome")).toBe("stale")
  })
})
