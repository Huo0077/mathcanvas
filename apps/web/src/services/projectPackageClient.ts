import { sha256HexBytes } from "@draw/agent-core"

import { invokeDesktop, NoDesktopShellError } from "./desktopRuntime"

/**
 * **项目包客户端**（Task 1.6 Step 4/5 的前端那一半）。
 *
 * Rust 侧的五条命令（`put_attachment` / `read_attachment` / `collect_attachments` /
 * `export_package` / `import_package`）与它们的判据**都已经在了**，缺的是"用户在界面上
 * 能不能做到"。这一层是那座桥：把命令包装成前端能用的形状，界面只跟它打交道。
 *
 * ## 三条纪律
 *
 * 1. **附件的哈希由前端按原始字节算**。`put_attachment` 会拿调用方声明的哈希去校验
 *    它落盘的字节（那正是"名字就是内容的 SHA-256"这条设计的一半），所以哈希**不是**
 *    调用方随便给的参数 —— 它由这里从字节算出来。算的是**原始字节**而不是 UTF-8 编码后的
 *    文本：一张 PNG 的 `0x89` 会被 UTF-8 编成两个字节，那样算出来的哈希与 Rust 侧永远对不上，
 *    症状是"每一次附加都失败，理由却是内容哈希不符"。
 * 2. **"在浏览器里"与"IPC 失败"分开报**。前者是**正常状态**（同一个 web 产物既要能当网页
 *    打开、也要能在 Tauri 里跑），后者才要给原因。
 * 3. **不假装成别的东西**。导出目的地由调用方给（见下），我们不猜用户想存哪 ——
 *    猜错的代价是文件出现在一个他找不到的地方，而他以为没导出成功。
 */

export type PackageFailureCode = "no_desktop_shell" | "ipc_failed"

export type PackageResult<T> =
  | { ok: true; value: T }
  /** 正常状态：这是浏览器，没有原生侧。 */
  | { ok: false; code: "no_desktop_shell"; detail: string }
  /** 真的出错了，要给原因。 */
  | { ok: false; code: "ipc_failed"; detail: string }

export interface AttachmentReport {
  contentHash: string
  byteSize: number
}

export interface PackageDocument {
  documentId: string
  epoch: string
  generation: number
  /** `.mgeo` 原文。包里的文档就是它，所以 `.mgeo` 兼容性一个字节都没改。 */
  content: string
}

export interface PackageExportReport {
  destination: string
  byteSize: number
  documentCount: number
  attachmentCount: number
}

export interface PackageImportOutcome {
  projectId: string
  schemaVersion: string
  documents: string[]
  attachmentCount: number
  /** 包里提到、但本机没有的来源（**不**因此拒绝整包）。 */
  missingSources: string[]
}

function asResult(error: unknown): { ok: false; code: PackageFailureCode; detail: string } {
  if (error instanceof NoDesktopShellError) return { ok: false, code: "no_desktop_shell", detail: error.message }
  return { ok: false, code: "ipc_failed", detail: error instanceof Error ? error.message : String(error) }
}

const BASE64_TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/**
 * 字节 → base64。**不用 `btoa`**：它只吃 latin1 字符串，而附件是二进制 ——
 * 走它就必须先把字节塞进一个字符串，那一步在各种边界值上会悄悄改写内容。
 * 二十行手写实现换一个不可能出错的转换，是划算的。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = ""
  for (let index = 0; index < bytes.length; index += 3) {
    const remaining = bytes.length - index
    const buffer = (bytes[index] << 16) | ((remaining > 1 ? bytes[index + 1] : 0) << 8) | (remaining > 2 ? bytes[index + 2] : 0)
    out += BASE64_TABLE[(buffer >> 18) & 0x3f]
    out += BASE64_TABLE[(buffer >> 12) & 0x3f]
    out += remaining > 1 ? BASE64_TABLE[(buffer >> 6) & 0x3f] : "="
    out += remaining > 2 ? BASE64_TABLE[buffer & 0x3f] : "="
  }
  return out
}

/** base64 → 字节。与 Rust 侧的解码器同一套宽容度：换行与填充符跳过。 */
export function base64ToBytes(text: string): Uint8Array {
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const character of text) {
    if (character === "\n" || character === "\r" || character === "=") continue
    const value = BASE64_TABLE.indexOf(character)
    if (value < 0) continue
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

const PACKAGE_EXTENSION = ".mcanvas"

/**
 * 给导出目的地补上 `.mcanvas`。
 *
 * 为什么在这里做而不是让用户自己写全：Rust 侧写的**就是**调用方给的那个路径，
 * 所以一个没有扩展名的目的地会变成"一个双击打不开、也没人认识的怪文件"。
 * 用户从 `.mgeo` 的思维过来会写 `.mgeo`，那时**替换**比追加（`demo.mgeo.mcanvas`）更符合意图；
 * 大小写不敏感地认，但不改写用户自己写的大小写。
 */
export function withPackageExtension(path: string): string {
  const trimmed = path.trim()
  const lowered = trimmed.toLowerCase()
  if (lowered.endsWith(PACKAGE_EXTENSION)) return trimmed
  if (lowered.endsWith(".mgeo")) return `${trimmed.slice(0, -".mgeo".length)}${PACKAGE_EXTENSION}`
  return `${trimmed}${PACKAGE_EXTENSION}`
}

/** 建议的文件名：把路径分隔符与空格换掉，空名字给一个兜底。 */
export function suggestedPackageName(documentName: string): string {
  const cleaned = documentName.trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "")
  return `${cleaned.length > 0 ? cleaned : "mathcanvas-project"}${PACKAGE_EXTENSION}`
}

/**
 * **存一份附件**：字节 → 哈希 → 两阶段写。
 *
 * 哈希在这里算（不是调用方给）：它要用来校验落盘的字节，让调用方传等于把"内容自验"
 * 变成一句自愿的话。算错了的后果是 Rust 侧**拒绝写入**（而不是写进一份坏数据）——
 * 那正是两阶段写要的方向。
 */
export async function putAttachment(input: { projectId: string; documentId: string; generation: number; mediaType: string; bytes: Uint8Array }): Promise<PackageResult<AttachmentReport>> {
  try {
    const contentHash = sha256HexBytes(input.bytes)
    const raw = (await invokeDesktop<unknown>("put_attachment", {
      projectId: input.projectId,
      documentId: input.documentId,
      generation: input.generation,
      contentHash,
      mediaType: input.mediaType,
      base64Bytes: bytesToBase64(input.bytes)
    })) as { contentHash?: unknown; byteSize?: unknown } | null
    return {
      ok: true,
      value: {
        contentHash: typeof raw?.contentHash === "string" ? raw.contentHash : contentHash,
        byteSize: typeof raw?.byteSize === "number" ? raw.byteSize : input.bytes.length
      }
    }
  } catch (error) {
    return asResult(error)
  }
}

/**
 * **读一份附件**。找不到时回 `null` —— 与"出错了"分开。
 *
 * 这个区分是 Rust 侧刻意做出来的（`read_attachment` 回 `Option<String>`），
 * 这里必须原样保留：混成一句"读附件失败"会让界面没法说清"这份附件不在库里"。
 */
export async function readAttachment(contentHash: string): Promise<PackageResult<Uint8Array | null>> {
  try {
    const raw = await invokeDesktop<unknown>("read_attachment", { contentHash })
    if (typeof raw !== "string" || raw.length === 0) return { ok: true, value: null }
    return { ok: true, value: base64ToBytes(raw) }
  } catch (error) {
    return asResult(error)
  }
}

/**
 * **这一版快照引用了哪些附件**。
 *
 * 引用记在**快照**上（不是 head、不是文档）：撤销回旧版本时那一版的附件必须还在，
 * 所以问法必然是"这一版引用了什么"。没有这条命令时界面只能列出**本次会话里附加过的那几个** ——
 * 重开应用就数不出来了（而那让"我上次附的图还在不在"变成一个只能靠猜的问题）。
 */
export async function readDocumentAttachments(input: { projectId: string; documentId: string; generation: number }): Promise<PackageResult<string[]>> {
  try {
    const raw = await invokeDesktop<unknown>("read_document_attachments", {
      projectId: input.projectId,
      documentId: input.documentId,
      generation: input.generation
    })
    return { ok: true, value: Array.isArray(raw) ? (raw.filter((entry) => typeof entry === "string") as string[]) : [] }
  } catch (error) {
    return asResult(error)
  }
}

/** 回收孤儿附件（两阶段的清理那一半）。返回**真的被删掉**的那些哈希。 */
export async function collectAttachments(): Promise<PackageResult<string[]>> {
  try {
    const raw = await invokeDesktop<unknown>("collect_attachments")
    return { ok: true, value: Array.isArray(raw) ? (raw.filter((entry) => typeof entry === "string") as string[]) : [] }
  } catch (error) {
    return asResult(error)
  }
}

/** **导出 `.mcanvas`**。导出是只读的：它不改仓库里的任何东西。 */
export async function exportPackage(input: { projectId: string; documents: PackageDocument[]; attachments: string[]; destination: string }): Promise<PackageResult<PackageExportReport>> {
  try {
    const destination = withPackageExtension(input.destination)
    const raw = (await invokeDesktop<unknown>("export_package", {
      projectId: input.projectId,
      documents: input.documents,
      attachments: input.attachments,
      destination
    })) as Partial<PackageExportReport> | null
    return {
      ok: true,
      value: {
        destination: typeof raw?.destination === "string" ? raw.destination : destination,
        byteSize: typeof raw?.byteSize === "number" ? raw.byteSize : 0,
        documentCount: typeof raw?.documentCount === "number" ? raw.documentCount : input.documents.length,
        attachmentCount: typeof raw?.attachmentCount === "number" ? raw.attachmentCount : input.attachments.length
      }
    }
  } catch (error) {
    return asResult(error)
  }
}

/**
 * **导入 `.mcanvas`**。
 *
 * `epoch` 由调用方给：导入是"换一世"，而在途的旧自动保存必须因此立刻 CAS 失败
 *（否则用户刚导入的文档会被上一次编辑覆盖）。epoch 只能由**知道"这是一次换文档"**的那一层生成。
 */
export async function importPackage(input: { path: string; projectId: string; epoch: string }): Promise<PackageResult<PackageImportOutcome>> {
  try {
    const raw = (await invokeDesktop<unknown>("import_package", { path: input.path, projectId: input.projectId, epoch: input.epoch })) as Partial<PackageImportOutcome> | null
    return {
      ok: true,
      value: {
        projectId: typeof raw?.projectId === "string" ? raw.projectId : input.projectId,
        schemaVersion: typeof raw?.schemaVersion === "string" ? raw.schemaVersion : "unknown",
        documents: Array.isArray(raw?.documents) ? (raw.documents.filter((entry) => typeof entry === "string") as string[]) : [],
        attachmentCount: typeof raw?.attachmentCount === "number" ? raw.attachmentCount : 0,
        missingSources: Array.isArray(raw?.missingSources) ? (raw.missingSources.filter((entry) => typeof entry === "string") as string[]) : []
      }
    }
  } catch (error) {
    return asResult(error)
  }
}
