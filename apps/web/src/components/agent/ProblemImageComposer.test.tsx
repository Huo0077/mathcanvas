// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { sha256HexBytes } from "@draw/agent-core"
import { splitImagePrompt } from "../../services/problemImagePrompt"
import * as problemImageFiles from "../../services/problemImageFiles"
import * as problemImageReader from "../../services/problemImageReader"
import { ProblemImageComposer } from "./ProblemImageComposer"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it("R07-B composer requires confirmation for disguised relations, blocks duplicate IDs, and clears confirmations on edit", async () => {
  vi.spyOn(problemImageFiles, "prepareProblemImage").mockResolvedValue({ name: "q.png", png: "iVBORw0KGgo=" })
  vi.spyOn(problemImageReader, "listImageReaders").mockResolvedValue({
    activeId: "vision",
    profiles: [{
      id: "vision",
      name: "读图模型",
      modelId: "vision-test",
      providerKind: "openai_compatible",
      baseUrl: "http://127.0.0.1:8000",
      authKind: "none",
      hasCredential: false,
      capabilities: ["vision"],
      networkPolicy: "local",
      revision: 1
    } as never]
  })
  vi.spyOn(problemImageReader, "readProblemImages").mockResolvedValue({
    problem: "如图，四棱锥 P-ABCD。",
    diagram: [
      { id: "rel-1", kind: "label", text: "AB∥CD", image: 1, box: [0.1, 0.2, 0.3, 0.4] },
      { id: "dup", text: "PA⊥BD", image: 1, box: null },
      { id: "dup", text: "BC=3", image: 1, box: null },
      { text: "高度 2", image: 1, box: null }
    ],
    uncertainties: []
  })

  const sentPayloads: string[] = []
  const onSend = vi.fn(async (text: string) => {
    sentPayloads.push(text)
    return false
  })

  render(<ProblemImageComposer initialOpen busy={false} draft={{ value: "", onChange: () => {} }} onSend={onSend} />)
  await waitFor(() => expect(screen.getByRole("button", { name: "识别题图" })).toBeDefined())

  const fileInput = screen.getByLabelText("选择题图文件") as HTMLInputElement
  const file = new File(["png"], "q.png", { type: "image/png" })
  fireEvent.change(fileInput, { target: { files: [file] } })

  await waitFor(() => expect((screen.getByRole("button", { name: "识别题图" }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole("button", { name: "识别题图" }))

  const relationCheckbox = await screen.findByRole("checkbox", { name: "确认并发送线条：AB∥CD" }) as HTMLInputElement
  expect(relationCheckbox.checked).toBe(false)
  expect(screen.getAllByText("（观察编号重复，暂不可发送）")).toHaveLength(2)

  // Unconfirmed send includes only whitelisted scalar ("高度 2"), excluding AB∥CD and duplicate IDs.
  fireEvent.click(screen.getByRole("button", { name: "发送给 Agent" }))
  await waitFor(() => expect(sentPayloads).toHaveLength(1))
  expect(splitImagePrompt(sentPayloads[0]).imageEvidence?.diagram.map(item => item.text)).toEqual(["高度 2"])
  expect(splitImagePrompt(sentPayloads[0]).imageEvidence?.imageHashes).toEqual([
    sha256HexBytes(Uint8Array.from(atob("iVBORw0KGgo="), character => character.charCodeAt(0)))
  ])

  // Confirm relation, then edit the problem text -> old confirmation must be cleared.
  fireEvent.click(relationCheckbox)
  expect(relationCheckbox.checked).toBe(true)
  const textbox = screen.getByRole("textbox", { name: "识别的题干" }) as HTMLTextAreaElement
  fireEvent.change(textbox, { target: { value: "如图，四棱锥 P-ABCD 中 PA=4。" } })
  expect(relationCheckbox.checked).toBe(false)

  fireEvent.click(screen.getByRole("button", { name: "发送给 Agent" }))
  await waitFor(() => expect(sentPayloads).toHaveLength(2))
  expect(splitImagePrompt(sentPayloads[1]).imageEvidence?.diagram.map(item => item.text)).toEqual(["高度 2"])

  // Re-confirm after editing -> passes with updated revision proof.
  fireEvent.click(relationCheckbox)
  fireEvent.click(screen.getByRole("button", { name: "发送给 Agent" }))
  await waitFor(() => expect(sentPayloads).toHaveLength(3))
  expect(splitImagePrompt(sentPayloads[2]).imageEvidence?.diagram.map(item => item.text)).toEqual(["AB∥CD", "高度 2"])
})
