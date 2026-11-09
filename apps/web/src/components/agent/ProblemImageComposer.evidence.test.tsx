import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { createAgentConversation, useAgentStore } from "../../agentStore"
import { ProblemImageComposer } from "./ProblemImageComposer"

/**
 * **W4：宿主自动定向补读与附件身份（2026-11-09）**。
 *
 * 生产入口（UI）必须做到两件事，且都不许靠模型自述：
 * ① 只有「图1」的体积题会**自动**按缺口补读一次，读数回到核对列表；
 * ② 发送给 Agent 的题面带着附件身份（attachmentId + sha256）与未解决缺口，
 *    这样宿主之后才能让旧证据失效，也才能在缺口没消时按「未完成」交付。
 */

const mocks = vi.hoisted(() => ({
  read: vi.fn(), prepare: vi.fn(), readers: vi.fn(), crop: vi.fn()
}))

vi.mock("../../services/problemImageFiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/problemImageFiles")>()),
  prepareProblemImage: mocks.prepare,
  cropProblemImage: mocks.crop
}))
vi.mock("../../services/problemImageGrid", () => ({ alignGridReadings: async (reading: unknown) => reading }))
vi.mock("../../services/problemImageReader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/problemImageReader")>()),
  readProblemImages: mocks.read, listImageReaders: mocks.readers
}))

const SHA = "11".repeat(32)

beforeEach(() => {
  vi.stubGlobal("crypto", {
    subtle: { digest: async () => new Uint8Array(32).fill(0x11).buffer },
    randomUUID: () => "test-uuid"
  })
  const conversation = createAgentConversation()
  useAgentStore.setState({ conversations: [conversation], activeConversation: conversation, activeConversationId: conversation.id, pendingReplyId: null })
  mocks.prepare.mockResolvedValue({ name: "exam.png", png: "aGVsbG8=" })
  mocks.crop.mockResolvedValue({ name: "exam.png", png: "aGVsbG8=" })
  mocks.readers.mockResolvedValue({ activeId: "vision", profiles: [{ id: "vision", revision: 1, networkPolicy: "cloud" }] })
  mocks.read.mockReset()
})

it("re-reads the missing dimensions of a volume problem and sends attachment identity", async () => {
  const onSend = vi.fn(async (_prompt: string) => true)
  mocks.read
    .mockResolvedValueOnce({ problem: "如图，求该几何体的体积。", diagram: [{ text: "图1", image: 1, box: null }], uncertainties: [] })
    .mockResolvedValueOnce({ problem: "", diagram: [{ text: "底面边长 4", image: 1, box: [0.1, 0.1, 0.4, 0.4] }, { text: "高 3", image: 1, box: [0.5, 0.5, 0.9, 0.9] }], uncertainties: [] })

  render(<ProblemImageComposer initialOpen draft={{ value: "", onChange: () => {} }} onSend={onSend} busy={false} />)
  fireEvent.change(screen.getByLabelText("选择题图文件"), { target: { files: [new File(["x"], "exam.png", { type: "image/png" })] } })
  await waitFor(() => expect(screen.getByRole("button", { name: "识别题图" }).hasAttribute("disabled")).toBe(false))
  fireEvent.click(screen.getByRole("button", { name: "识别题图" }))

  await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.getByText(/定向重读 1 次/)).toBeTruthy())
  expect(screen.queryByText("图证据缺口")).toBeNull()

  fireEvent.click(screen.getByRole("button", { name: "发送给 Agent" }))
  await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
  const sent = onSend.mock.calls[0]![0]
  expect(sent).toContain('"version":2')
  expect(sent).toContain('"attachmentId":"image-1"')
  expect(sent).toContain(`"sha256":"${SHA}"`)
  expect(sent).toContain('"rereads":1')
  expect(sent).toContain('"target":"volume"')
})

it("keeps an unresolved dimension gap visible and sends it as required", async () => {
  const onSend = vi.fn(async (_prompt: string) => true)
  mocks.read.mockResolvedValue({ problem: "如图，求该几何体的体积。", diagram: [{ text: "图1", image: 1, box: null }], uncertainties: [] })

  render(<ProblemImageComposer initialOpen draft={{ value: "", onChange: () => {} }} onSend={onSend} busy={false} />)
  fireEvent.change(screen.getByLabelText("选择题图文件"), { target: { files: [new File(["x"], "exam.png", { type: "image/png" })] } })
  await waitFor(() => expect(screen.getByRole("button", { name: "识别题图" }).hasAttribute("disabled")).toBe(false))
  fireEvent.click(screen.getByRole("button", { name: "识别题图" }))

  await waitFor(() => expect(screen.getByText("图证据缺口")).toBeTruthy())
  expect(screen.getByText(/体积目标没有任何可核验的数值尺寸/)).toBeTruthy()

  fireEvent.click(screen.getByRole("button", { name: "发送给 Agent" }))
  await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
  const sent = onSend.mock.calls[0]![0]
  expect(sent).toContain("missing_dimension")
  expect(sent).toContain('"required":true')
})
