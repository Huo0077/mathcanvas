import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { createEmptyDocument } from "@draw/dsl"

import { App } from "./App"
import { useSceneStore } from "./store"
import { useAgentStore } from "./agentStore"
import { agentRunner } from "./agent/agentRunner"

describe("Block 4: AI Copilot 同屏抽屉与画布实时 Ghost 草稿预览", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("支持通过状态栏按钮展开与收起 AI Copilot 同屏抽屉（不卸载主画布）", () => {
    const document = createEmptyDocument("conics")
    useSceneStore.setState({
      document,
      workspaceDocuments: { [document.workspace]: document },
      history: [],
      future: [],
      error: null
    })

    render(<App />)

    // 默认抽屉处于折叠状态，画布存在
    expect(screen.getByRole("img", { name: "几何画布" })).toBeTruthy()
    expect(screen.queryByLabelText("AI 助手抽屉")).toBeNull()

    // 点击状态栏上的 ✨ AI 助手 按钮展开抽屉
    const copilotToggle = screen.getByRole("button", { name: "✨ AI 助手" })
    expect(copilotToggle.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(copilotToggle)

    // 抽屉展开，画布仍然存在并同屏共存！
    expect(copilotToggle.getAttribute("aria-expanded")).toBe("true")
    const drawer = screen.getByLabelText("AI 助手抽屉")
    expect(drawer).toBeTruthy()
    expect(screen.getByRole("img", { name: "几何画布" })).toBeTruthy()

    // 点击关闭按钮关闭抽屉
    const closeBtn = screen.getByRole("button", { name: "关闭 AI 助手" })
    fireEvent.click(closeBtn)
    expect(screen.queryByLabelText("AI 助手抽屉")).toBeNull()
    expect(copilotToggle.getAttribute("aria-expanded")).toBe("false")
  })

  it("当存在待确认草稿时，主画布实时渲染 Ghost 虚线草稿，并浮现悬浮确认胶囊横幅", () => {
    const document = createEmptyDocument("conics")
    useSceneStore.setState({
      document,
      workspaceDocuments: { [document.workspace]: document },
      history: [],
      future: [],
      error: null
    })

    const candidateDoc = createEmptyDocument("conics")
    candidateDoc.primitives = [
      { id: "ghost-pt-1", type: "point", x: 2, y: 3, label: "A" },
      { id: "ghost-seg-1", type: "segment", a: { x: 0, y: 0 }, b: { x: 2, y: 3 }, label: "s1" }
    ]

    const conversationId = "conv-test"
    const testConv = {
      id: conversationId,
      title: "草稿测试",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      binding: { projectId: "local", documentId: document.metadata.id, workspace: "conics" as const, conversationId },
      facts: [],
      messages: [
        { id: "msg-1", role: "user" as const, text: "构建线段 OA", createdAt: Date.now() },
        {
          id: "msg-2",
          role: "assistant" as const,
          text: "已生成线段 OA 草稿",
          createdAt: Date.now(),
          runId: "run-test-42",
          draft: {
            draftId: "draft-42",
            draftVersion: 1,
            previewHash: "h42",
            stageCount: 1,
            undoesInOneStep: true
          }
        }
      ]
    }

    useAgentStore.setState({
      conversations: [testConv],
      activeConversationId: conversationId,
      activeConversation: testConv
    })

    vi.spyOn(agentRunner, "getActiveDraftCandidate").mockReturnValue({
      candidate: candidateDoc,
      runId: "run-test-42",
      draftId: "draft-42"
    })

    render(<App />)

    // 验证画布上渲染了 ghost 虚线草稿图元
    const canvas = screen.getByRole("img", { name: "几何画布" })
    const ghostGroup = canvas.querySelector('[data-ghost-draft="true"]')
    expect(ghostGroup).toBeTruthy()
    expect(ghostGroup?.querySelector('[data-ghost-primitive="point"]')).toBeTruthy()
    expect(ghostGroup?.querySelector('[data-ghost-primitive="segment"]')).toBeTruthy()

    // 验证画布正上方浮现了确认横幅胶囊
    const banner = screen.getByRole("region", { name: "AI 草稿预览" })
    expect(banner).toBeTruthy()
    expect(banner.textContent).toContain("AI 草稿预览：包含 2 个图元")
    expect(screen.getByRole("button", { name: "✓ 确认写入 (Enter)" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "✕ 放弃草稿 (Esc)" })).toBeTruthy()
  })

  it("支持通过横幅按钮及键盘快捷键（Enter 确认 / Esc 放弃）确认或打回草稿", () => {
    const document = createEmptyDocument("conics")
    useSceneStore.setState({
      document,
      workspaceDocuments: { [document.workspace]: document },
      history: [],
      future: [],
      error: null
    })

    const candidateDoc = createEmptyDocument("conics")
    candidateDoc.primitives = [
      { id: "ghost-pt-2", type: "point", x: 1, y: 1, label: "B" }
    ]

    const conversationId = "conv-test-keys"
    const testConv = {
      id: conversationId,
      title: "按键测试",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      binding: { projectId: "local", documentId: document.metadata.id, workspace: "conics" as const, conversationId },
      facts: [],
      messages: [
        { id: "m-user-1", role: "user" as const, text: "构建点 B", createdAt: Date.now() },
        {
          id: "m-assistant-1",
          role: "assistant" as const,
          text: "已生成点 B 草稿",
          createdAt: Date.now(),
          runId: "run-test-keys",
          draft: {
            draftId: "draft-keys",
            draftVersion: 1,
            previewHash: "h-keys",
            stageCount: 1,
            undoesInOneStep: true
          }
        }
      ]
    }

    useAgentStore.setState({
      conversations: [testConv],
      activeConversationId: conversationId,
      activeConversation: testConv
    })

    vi.spyOn(agentRunner, "getActiveDraftCandidate").mockReturnValue({
      candidate: candidateDoc,
      runId: "run-test-keys",
      draftId: "draft-keys"
    })

    const confirmSpy = vi.spyOn(agentRunner, "confirm").mockImplementation(() => ({ status: "committed" }))
    const discardSpy = vi.spyOn(agentRunner, "discard").mockImplementation(() => true)

    const view = render(<App />)

    // 1. 点击确认按钮
    const confirmBtn = screen.getByRole("button", { name: "✓ 确认写入 (Enter)" })
    fireEvent.click(confirmBtn)
    expect(confirmSpy).toHaveBeenCalledWith("run-test-keys")

    // 2. 点击放弃按钮
    const discardBtn = screen.getByRole("button", { name: "✕ 放弃草稿 (Esc)" })
    fireEvent.click(discardBtn)
    expect(discardSpy).toHaveBeenCalledWith("run-test-keys")

    // 3. 键盘按 Enter 确认
    fireEvent.keyDown(window, { key: "Enter" })
    expect(confirmSpy).toHaveBeenCalledTimes(2)

    // 4. 键盘按 Escape 放弃
    fireEvent.keyDown(window, { key: "Escape" })
    expect(discardSpy).toHaveBeenCalledTimes(2)

    view.unmount()
  })
})
