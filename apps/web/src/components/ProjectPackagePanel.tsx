import { useState } from "react"

import { encodeMgeo, type GeometryDocument } from "@draw/dsl"

import { createDocumentRepository } from "../services/documentRepository"
import { invokeDesktop } from "../services/desktopRuntime"
import {
  collectAttachments,
  exportPackage,
  importPackage,
  putAttachment,
  suggestedPackageName
} from "../services/projectPackageClient"

/**
 * **项目包面板**（Task 1.6 Step 4/5 的界面入口）。
 *
 * ## 这一批关掉的是什么
 *
 * 附件两阶段写、`.mcanvas` 导出/导入、孤儿回收 —— 判据与命令在 Rust 侧都齐了
 * （`repository_package` 29 例 + `project_repository` 19 例），
 * 而**用户在界面上做不到任何一件**。这个面板就是那扇门。
 *
 * ## 三个如实说明（都摆在界面上，不藏在文档里）
 *
 * 1. **没有原生文件选择框**：能力清单里刻意只有 `core:default`，没有 dialog 插件，
 *    所以导出目的地是**填出来的**（填过一次就记住），导入路径也是。
 *    与其让一个不存在的选择框假装存在，不如把这一格交出去。
 * 2. **附件列表只覆盖本次会话**：Rust 侧没有"某份快照引用了哪些附件"这条列举命令
 *    （`read_document_head` 只回文档本体），所以重开应用之后界面数不出历史附件。
 *    导出时带上的是**这次附加过的那几个**。
 * 3. **导入是"换一世"**：epoch 每次都换新的，于是上一次编辑**可能还在途**的自动保存
 *    会立刻 CAS 失败 —— 否则刚导入的文档会被旧内容覆盖。
 */

export interface ProjectPackageNotice {
  kind: "info" | "error"
  text: string
}

export interface ProjectPackagePanelProps {
  document: GeometryDocument
  projectId: string
  /** 导入成功后把 `.mgeo` 正文交给宿主（与"打开 .mgeo"同一条路：换文档 + 换一世）。 */
  onImported(serialized: string): void
  /** 一句话回流（成功与失败都走它，宿主决定显示在哪）。 */
  onNotice(notice: ProjectPackageNotice): void
  onClose(): void
  /** 桌面外壳不可用时的原因（浏览器里就是它）。 */
  unavailableReason?: string
}

/** 目的地记住的键。**只记路径**，不记任何内容。 */
const DESTINATION_KEY = "mathcanvas:package-destination"

/** 把客户端的失败翻译成一句用户能照做的话。 */
function describeFailure(result: { code: string; detail: string }, action: string): ProjectPackageNotice {
  if (result.code === "no_desktop_shell") {
    return { kind: "error", text: `${action}需要桌面版（Windows 应用）；当前在浏览器里运行，本地项目库不可用。` }
  }
  return { kind: "error", text: `${action}失败：${result.detail}` }
}

interface AttachedFile {
  contentHash: string
  byteSize: number
  name: string
}

/**
 * 文件选择器的读取：拿到的是**原始字节**（哈希与 base64 都基于它）。
 *
 * 用 `FileReader` 而不是 `file.arrayBuffer()`：两者在浏览器里都在，而 `FileReader`
 * 在测试环境（jsdom）里也有实现 —— 只留一条路径，就不会出现"测试里走的是另一条代码"。
 */
function readFileBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("cannot read the selected file"))
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.readAsArrayBuffer(file)
  })
}

export function ProjectPackagePanel({ document, projectId, onImported, onNotice, onClose, unavailableReason }: ProjectPackagePanelProps) {
  const [destination, setDestination] = useState(() => localStorage.getItem(DESTINATION_KEY) ?? suggestedPackageName(document.metadata.name))
  const [importPath, setImportPath] = useState("")
  const [attachments, setAttachments] = useState<AttachedFile[]>([])
  const [status, setStatus] = useState<ProjectPackageNotice | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const repository = createDocumentRepository((command, args) => invokeDesktop(command, args))

  function report(notice: ProjectPackageNotice) {
    setStatus(notice)
    onNotice(notice)
  }

  /** 仓储里的 head。附件挂在**快照**上，所以没有 head 就没有可挂的地方。 */
  async function readHead() {
    return repository.readHead(projectId, document.metadata.id)
  }

  async function exportCurrent() {
    setBusy("export")
    try {
      const head = await readHead()
      const result = await exportPackage({
        projectId,
        documents: [{
          documentId: document.metadata.id,
          // epoch 只是包里的来源信息；没有 head 时给一个能读懂的兜底，而不是留空。
          epoch: head.ok ? head.value.epoch : `epoch:${document.metadata.id}`,
          generation: head.ok ? head.value.generation : 0,
          content: encodeMgeo(document)
        }],
        attachments: attachments.map((attachment) => attachment.contentHash),
        destination
      })
      if (!result.ok) { report(describeFailure(result, "导出项目包")); return }
      localStorage.setItem(DESTINATION_KEY, result.value.destination)
      setDestination(result.value.destination)
      report({ kind: "info", text: `已导出到 ${result.value.destination}（${result.value.byteSize} 字节，${result.value.documentCount} 份文档，${result.value.attachmentCount} 个附件）` })
    } finally {
      setBusy(null)
    }
  }

  async function importFrom() {
    const path = importPath.trim()
    if (path.length === 0) { report({ kind: "error", text: "先填写项目包的完整路径（例如 D:\\图纸\\demo.mcanvas）。" }); return }
    setBusy("import")
    try {
      /**
       * **每次导入换一个新的 epoch**。导入是"换一世"：换掉 epoch 之后，在途的旧自动保存
       * 一律 CAS 失败。用时间戳而不是固定串，是因为连续导入两次不同的包必须是两世。
       */
      const result = await importPackage({ path, projectId, epoch: `epoch:import-${Date.now().toString(36)}` })
      if (!result.ok) { report(describeFailure(result, "导入项目包")); return }

      const documentId = result.value.documents[0]
      if (documentId) {
        // 导入写进的是库，正文要**读回来**才能装进工作区（命令只回包的结构，不回正文）。
        const reloaded = await readHead()
        if (reloaded.ok) onImported(reloaded.value.content)
        else report({ kind: "error", text: `包里的文档已写进项目库，但读回正文失败：${reloaded.detail}` })
      }
      if (result.value.missingSources.length > 0) {
        // 来源缺失**不拒绝整包**（那是 Rust 侧的判据），但用户必须看见少了什么。
        report({ kind: "error", text: `已导入 ${result.value.documents.length} 份文档（${result.value.attachmentCount} 个附件），但来源缺失：${result.value.missingSources.join("、")}` })
        return
      }
      report({ kind: "info", text: `已导入 ${result.value.documents.length} 份文档（${result.value.attachmentCount} 个附件）` })
    } finally {
      setBusy(null)
    }
  }

  async function attach(file: File) {
    setBusy("attach")
    try {
      const head = await readHead()
      if (!head.ok) {
        // 不拿一个假的 generation 去写：附件真的会挂在一版**不存在**的快照上。
        report({ kind: "error", text: `这份文档还没有在项目库里落过盘（自动保存一次之后再来）；附件挂在快照上，没有快照就没有可挂的地方。${head.code === "not_a_desktop_shell" ? "当前在浏览器里运行。" : ""}` })
        return
      }
      const bytes = await readFileBytes(file)
      const result = await putAttachment({
        projectId,
        documentId: document.metadata.id,
        generation: head.value.generation,
        mediaType: file.type.length > 0 ? file.type : "application/octet-stream",
        bytes
      })
      if (!result.ok) { report(describeFailure(result, "附加文件")); return }
      setAttachments((current) => [...current, { contentHash: result.value.contentHash, byteSize: result.value.byteSize, name: file.name }])
      report({ kind: "info", text: `已附加 ${file.name}（${result.value.byteSize} 字节）` })
    } finally {
      setBusy(null)
    }
  }

  async function collect() {
    setBusy("collect")
    try {
      const result = await collectAttachments()
      if (!result.ok) { report(describeFailure(result, "回收孤儿附件")); return }
      report({ kind: "info", text: result.value.length > 0 ? `回收了 ${result.value.length} 个没有被任何快照引用的附件` : "没有可回收的孤儿附件" })
    } finally {
      setBusy(null)
    }
  }

  return <section className="project-package" role="dialog" aria-label="项目包">
    <header className="project-package-header">
      <h2>项目包</h2>
      <button type="button" onClick={onClose} aria-label="关闭项目包面板">×</button>
    </header>
    {unavailableReason && <p role="note" className="project-package-note">{unavailableReason}</p>}

    <div className="project-package-section">
      <h3>导出 .mcanvas</h3>
      <label htmlFor="package-destination">导出目的地</label>
      <input id="package-destination" aria-label="导出到" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="D:\\图纸\\demo.mcanvas" />
      <button type="button" onClick={() => void exportCurrent()} disabled={busy !== null}>导出 .mcanvas</button>
      <p className="project-package-hint">没有原生文件选择框（能力清单里只有 core:default），所以这一格要自己填；填过一次会记住。包里装的是 .mgeo 原文与附件，永远没有密钥。</p>
    </div>

    <div className="project-package-section">
      <h3>导入 .mcanvas</h3>
      <label htmlFor="package-path">项目包路径</label>
      <input id="package-path" aria-label="项目包路径" value={importPath} onChange={(event) => setImportPath(event.target.value)} placeholder="D:\\图纸\\demo.mcanvas" />
      <button type="button" onClick={() => void importFrom()} disabled={busy !== null}>导入 .mcanvas</button>
      <p className="project-package-hint">导入会换一世（新的 epoch）：在途的旧自动保存立刻失效，所以刚导入的内容不会被上一次编辑覆盖。</p>
    </div>

    <div className="project-package-section">
      <h3>附件</h3>
      <input type="file" aria-label="选择附件" onChange={(event) => { const file = event.target.files?.[0]; if (file) void attach(file); event.target.value = "" }} />
      <button type="button" onClick={() => void collect()} disabled={busy !== null}>回收孤儿附件</button>
      {attachments.length > 0
        ? <ul className="project-package-attachments">{attachments.map((attachment) => <li key={attachment.contentHash}>{attachment.name} · {attachment.byteSize} 字节 · <code>{attachment.contentHash.slice(0, 12)}…</code></li>)}</ul>
        : <p className="project-package-hint">本次会话还没有附加过文件。</p>}
      <p className="project-package-hint">附件的名字就是内容的哈希（同一份只存一次、随时能自验）。列表只覆盖本次会话：Rust 侧还没有"某份快照引用了哪些附件"的列举命令，所以重开应用之后界面数不出历史附件。</p>
    </div>

    {status && <p role="status" className="project-package-status" data-kind={status.kind}>{status.text}</p>}
  </section>
}
