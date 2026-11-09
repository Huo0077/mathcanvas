import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { createAgentConversation, useAgentStore } from "../../agentStore"
import { claimSolveSession, type SolveSession } from "../../services/solveSession"
import { ProblemImageComposer } from "./ProblemImageComposer"

const mocks = vi.hoisted(() => ({
  read: vi.fn(), prepare: vi.fn(), readers: vi.fn()
}))
vi.mock("../../services/problemImageFiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/problemImageFiles")>()),
  prepareProblemImage: mocks.prepare
}))
vi.mock("../../services/problemImageGrid", () => ({ alignGridReadings: async (reading: unknown) => reading }))
vi.mock("../../services/problemImageReader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/problemImageReader")>()),
  readProblemImages: mocks.read, listImageReaders: mocks.readers
}))

beforeEach(() => {
  const conversation = createAgentConversation()
  useAgentStore.setState({ conversations: [conversation], activeConversation: conversation, activeConversationId: conversation.id, pendingReplyId: null })
  mocks.prepare.mockResolvedValue({ name: "exam.png", png: "aGVsbG8=" })
  mocks.readers.mockResolvedValue({ activeId: "vision", profiles: [{ id: "vision", revision: 1, networkPolicy: "cloud" }] })
  mocks.read.mockImplementation(async (_reader: unknown, _images: unknown, _id: unknown, _signal: unknown, _region: unknown, session: SolveSession) => {
    const reservation = session.reserve("vision", 25, 50)
    expect(reservation).not.toBeNull()
    session.settle(reservation!.id, { inputTokens: 20, outputTokens: 30 })
    return { problem: "求 AB 的长度。", diagram: [], uncertainties: [] }
  })
})

it("hands the real composer vision ledger to the submitted prompt exactly once", async () => {
  let claimed: SolveSession | null = null
  const onSend = vi.fn(async (prompt: string) => {
    claimed = claimSolveSession(useAgentStore.getState().activeConversation!.id, prompt)
    return true
  })
  render(<ProblemImageComposer initialOpen draft={{ value: "", onChange: () => {} }} onSend={onSend} busy={false} />)
  fireEvent.change(screen.getByLabelText("选择题图文件"), { target: { files: [new File(["x"], "exam.png", { type: "image/png" })] } })
  await waitFor(() => expect(screen.getByRole("button", { name: "识别题图" }).hasAttribute("disabled")).toBe(false))
  fireEvent.click(screen.getByRole("button", { name: "识别题图" }))
  await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.getByRole("button", { name: "发送给 Agent" }).hasAttribute("disabled")).toBe(false))
  fireEvent.click(screen.getByRole("button", { name: "发送给 Agent" }))
  await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
  expect(claimed).not.toBeNull()
  expect((claimed as SolveSession | null)?.snapshot()).toMatchObject({ requests: 1, inputTokens: 20, outputTokens: 30 })
  expect(claimSolveSession(useAgentStore.getState().activeConversation!.id, onSend.mock.calls[0]![0])).toBeNull()
})


it("does not leave a claimable paid lease when sending a recognized image is refused", async () => {
  const onSend = vi.fn(async (_prompt: string) => false)
  render(<ProblemImageComposer initialOpen draft={{ value: "", onChange: () => {} }} onSend={onSend} busy={false} />)
  fireEvent.change(screen.getByLabelText("选择题图文件"), { target: { files: [new File(["x"], "exam.png", { type: "image/png" })] } })
  await waitFor(() => expect(screen.getByRole("button", { name: "识别题图" }).hasAttribute("disabled")).toBe(false))
  fireEvent.click(screen.getByRole("button", { name: "识别题图" }))
  await waitFor(() => expect(screen.getByRole("button", { name: "发送给 Agent" }).hasAttribute("disabled")).toBe(false))
  fireEvent.click(screen.getByRole("button", { name: "发送给 Agent" }))
  await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("未能发送"))
  expect(claimSolveSession(useAgentStore.getState().activeConversation!.id, onSend.mock.calls[0]![0])).toBeNull()
})
