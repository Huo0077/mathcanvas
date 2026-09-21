import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { ProjectPackagePanel } from "./ProjectPackagePanel"

/**
 * **项目包面板**（Task 1.6 Step 4/5 的界面入口）。
 *
 * 这一批要关掉的缺口是"命令都在、判据都在、**用户在界面上做不到**"。
 * 所以这一组用例钉的是三件事：
 * 1. **导出真的把文档正文与目的地发出去了**，而且目的地补了 `.mcanvas`；
 * 2. **附件的哈希由界面按原始字节算**（Rust 侧会拿它校验落盘的字节）；
 * 3. **在浏览器里如实说"需要桌面版"**，而不是给一句含糊的失败。
 *
 * 替身换的是 IPC 那一层；组件里的顺序、状态、文案全部是真的。
 */
const internalsKey = "__TAURI_INTERNALS__"

interface FakeOptions {
  head?: { generation: number; epoch: string; content: string } | null
  importResult?: Record<string, unknown>
  exportResult?: Record<string, unknown>
  /** 这一版快照引用了哪些附件（`read_document_attachments` 的返回）。 */
  referenced?: string[]
}

function makeClient(options: FakeOptions = {}) {
  const calls: { command: string; args?: Record<string, unknown> }[] = []
  const invoke = async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args })
    switch (command) {
      case "read_document_head":
        if (!options.head) throw new Error("no such document")
        return { projectId: "local", documentId: "doc-1", epoch: options.head.epoch, generation: options.head.generation, contentHash: "hash", content: options.head.content, updatedAt: 1 }
      case "read_document_attachments":
        // 列举那一半：**引用记在快照上**，所以这里也要 `generation`。
        return (options.referenced ?? []).filter(() => (args as { generation: number }).generation > 0)
      case "put_attachment":
        return { contentHash: (args as { contentHash: string }).contentHash, byteSize: 3 }
      case "export_package":
        return options.exportResult ?? { destination: (args as { destination: string }).destination, byteSize: 4096, documentCount: 1, attachmentCount: ((args as { attachments: string[] }).attachments ?? []).length }
      case "import_package":
        return options.importResult ?? { projectId: "local", schemaVersion: "0.1", documents: ["doc-1"], attachmentCount: 1, missingSources: [] }
      case "collect_attachments":
        return ["orphan-1"]
      default:
        return null
    }
  }
  Object.defineProperty(globalThis, internalsKey, { configurable: true, writable: true, value: { invoke } })
  return calls
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(globalThis, internalsKey)
  localStorage.clear()
})

function panel(overrides: Partial<Parameters<typeof ProjectPackagePanel>[0]> = {}) {
  const onImported = vi.fn()
  const onNotice = vi.fn()
  const onClose = vi.fn()
  render(<ProjectPackagePanel document={document} projectId="local" onImported={onImported} onNotice={onNotice} onClose={onClose} {...overrides} />)
  return { onImported, onNotice, onClose }
}

/**
 * 面板与断言共用**同一份**文档实例。
 *
 * `createEmptyDocument` 每次调用都生成一个新的 `metadata.id`，所以"断言里再造一份"
 * 会拿两个不同的 id 去比 —— 那条用例会以"id 不一样"的形式红，而它想验证的其实是别的。
 */
const document = createEmptyDocument("conics")

describe("导出 .mcanvas", () => {
  it("把文档正文与目的地一起发出去，并把目的地补上扩展名", async () => {
    const calls = makeClient({ head: { generation: 7, epoch: "epoch:doc-1", content: "{}" } })
    panel()

    fireEvent.change(screen.getByLabelText("导出到"), { target: { value: "D:\\out\\demo" } })
    fireEvent.click(screen.getByRole("button", { name: "导出 .mcanvas" }))

    await waitFor(() => expect(calls.some((call) => call.command === "export_package")).toBe(true))
    const exported = calls.find((call) => call.command === "export_package")!
    expect(exported.args!.destination).toBe("D:\\out\\demo.mcanvas")
    expect((exported.args!.documents as { documentId: string; content: string }[])[0].documentId).toBe(document.metadata.id)
    // 导出之后**如实报出结果**：写到哪、多大、几份文档几个附件。
    await screen.findByText(/已导出到 D:\\out\\demo\.mcanvas/)
  })

  it("把目的地记下来，下次打开就是它", async () => {
    makeClient({ head: { generation: 7, epoch: "epoch:doc-1", content: "{}" } })
    panel()

    fireEvent.change(screen.getByLabelText("导出到"), { target: { value: "D:\\out\\demo" } })
    fireEvent.click(screen.getByRole("button", { name: "导出 .mcanvas" }))
    await waitFor(() => expect(localStorage.getItem("mathcanvas:package-destination")).toBe("D:\\out\\demo.mcanvas"))
  })
})

describe("附件", () => {
  it("哈希按原始字节算，并把这份附件交给导出", async () => {
    const calls = makeClient({ head: { generation: 7, epoch: "epoch:doc-1", content: "{}" } })
    panel()

    const file = new File([new Uint8Array([0x61, 0x62, 0x63])], "abc.png", { type: "image/png" })
    fireEvent.change(screen.getByLabelText("选择附件"), { target: { files: [file] } })

    // 状态行与附件列表里都会出现文件名，所以按**状态行**取（`getByText` 会因多个匹配而报错）。
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("abc.png"))
    const put = calls.find((call) => call.command === "put_attachment")!
    // FIPS 180-4 里 `abc` 的那条公开向量。
    expect(put.args!.contentHash).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    expect(put.args!.generation).toBe(7)
    expect(put.args!.base64Bytes).toBe("YWJj")

    fireEvent.change(screen.getByLabelText("导出到"), { target: { value: "D:\\out\\demo" } })
    fireEvent.click(screen.getByRole("button", { name: "导出 .mcanvas" }))
    await waitFor(() => expect(calls.some((call) => call.command === "export_package")).toBe(true))
    expect(calls.find((call) => call.command === "export_package")!.args!.attachments).toEqual(["ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"])
  })

  it("打开面板就从项目库读出这一版引用的附件，并把它带进导出", async () => {
    // 这一条关掉的是"列表只覆盖本次会话"那个限制：引用记在**快照**上，
    // 而列出它的命令在此之前不存在 —— 于是重开应用之后界面数不出历史附件。
    const stored = "b1946ac92492d2347c6235b4d2611184ba5b1e1b6c8b0f1f4f1d3a4b5c6d7e8f"
    const calls = makeClient({ head: { generation: 9, epoch: "epoch:doc-1", content: "{}" }, referenced: [stored] })
    panel()

    await waitFor(() => expect(calls.some((call) => call.command === "read_document_attachments")).toBe(true))
    // 读的时候必须带 `generation`：问的是"这一版引用了什么"，不是"这份文档一共有什么"。
    expect(calls.find((call) => call.command === "read_document_attachments")!.args).toMatchObject({ generation: 9 })
    await screen.findByText((content) => content.includes(stored.slice(0, 12)))

    fireEvent.change(screen.getByLabelText("导出到"), { target: { value: "D:\\out\\demo" } })
    fireEvent.click(screen.getByRole("button", { name: "导出 .mcanvas" }))

    await waitFor(() => expect(calls.some((call) => call.command === "export_package")).toBe(true))
    expect(calls.find((call) => call.command === "export_package")!.args!.attachments).toEqual([stored])
  })

  it("文档还没落过盘时如实说明，而不是拿一个假的 generation 去写", async () => {
    const calls = makeClient({ head: null })
    panel()

    const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" })
    fireEvent.change(screen.getByLabelText("选择附件"), { target: { files: [file] } })

    await screen.findByText(/还没有在项目库里落过盘/)
    expect(calls.some((call) => call.command === "put_attachment")).toBe(false)
  })
})

describe("导入 .mcanvas", () => {
  it("导入之后从仓储读回正文，并交给宿主装进工作区", async () => {
    const calls = makeClient({ head: { generation: 3, epoch: "epoch:import-1", content: "{}" }, importResult: { projectId: "local", schemaVersion: "0.1", documents: ["doc-1"], attachmentCount: 2, missingSources: ["source-9"] } })
    const { onImported, onNotice } = panel()

    fireEvent.change(screen.getByLabelText("项目包路径"), { target: { value: "D:\\in\\demo.mcanvas" } })
    fireEvent.click(screen.getByRole("button", { name: "导入 .mcanvas" }))

    await waitFor(() => expect(onImported).toHaveBeenCalledWith("{}"))
    expect(calls.find((call) => call.command === "import_package")!.args).toMatchObject({ path: "D:\\in\\demo.mcanvas", projectId: "local" })
    // 缺失来源**不拒绝整包**，但要如实说出来。
    expect(onNotice).toHaveBeenCalledWith(expect.objectContaining({ kind: "error", text: expect.stringContaining("source-9") }))
  })
})

describe("在浏览器里", () => {
  it("如实说需要桌面版，而不是一句含糊的失败", async () => {
    panel()

    fireEvent.change(screen.getByLabelText("导出到"), { target: { value: "D:\\out\\demo" } })
    fireEvent.click(screen.getByRole("button", { name: "导出 .mcanvas" }))

    await screen.findByText(/需要桌面版/)
  })
})
