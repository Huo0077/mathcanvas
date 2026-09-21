import { afterEach, describe, expect, it } from "vitest"

import {
  base64ToBytes,
  bytesToBase64,
  collectAttachments,
  exportPackage,
  importPackage,
  putAttachment,
  readAttachment,
  suggestedPackageName,
  withPackageExtension
} from "./projectPackageClient"

/**
 * **项目包客户端**（Task 1.6 Step 4/5 的前端那一半）。
 *
 * 这几条命令在 Rust 侧都已有判据（`repository_package` 29 例 + `project_repository` 19 例），
 * 所以这里要钉住的**不是**"包里有什么"，而是前端这一层的三件事：
 * 1. **发出去的形状对不对**（参数名错一个，命令在真机上是"缺参数"失败）；
 * 2. **附件哈希是我们算的**，而且算的是**原始字节**（Rust 会拿它校验落盘的字节）；
 * 3. **"在浏览器里"与"IPC 失败"分开报** —— 前者是正常状态，后者要给原因。
 */
const internalsKey = "__TAURI_INTERNALS__"

function installInvoke(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
  Object.defineProperty(globalThis, internalsKey, { configurable: true, writable: true, value: { invoke } })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, internalsKey)
})

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

describe("base64 与文件名的两条纯函数", () => {
  it("按字节往返，不经过字符串", () => {
    // 用手写实现而不是 `btoa`：后者只吃 latin1 字符串，二进制附件走它必然被改写。
    expect(bytesToBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("iVBORw==")
    expect([...base64ToBytes("iVBORw==")]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect([...base64ToBytes(bytesToBase64(new Uint8Array([0, 1, 2, 253, 254, 255])))]) .toEqual([0, 1, 2, 253, 254, 255])
    // Rust 侧的解码器会跳过换行与填充符，所以带换行的输入也要认。
    expect([...base64ToBytes("iVBO\nRw==")]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it("导出目的地补上扩展名，但不覆盖用户已经写对的那一个", () => {
    expect(withPackageExtension("D:\\图纸\\demo")).toBe("D:\\图纸\\demo.mcanvas")
    expect(withPackageExtension("D:\\图纸\\demo.mcanvas")).toBe("D:\\图纸\\demo.mcanvas")
    // 从 `.mgeo` 的思维过来的人会写 `.mgeo`：替换比追加（`demo.mgeo.mcanvas`）更符合意图。
    expect(withPackageExtension("D:\\图纸\\demo.mgeo")).toBe("D:\\图纸\\demo.mcanvas")
    // 大小写不敏感地认，但**不**改写用户的大小写。
    expect(withPackageExtension("D:\\图纸\\demo.MCANVAS")).toBe("D:\\图纸\\demo.MCANVAS")
  })

  it("建议的文件名里不留路径分隔符与空格", () => {
    expect(suggestedPackageName("平面 图形")).toBe("平面-图形.mcanvas")
    expect(suggestedPackageName("a/b\\c:d")).toBe("a-b-c-d.mcanvas")
    expect(suggestedPackageName("   ")).toBe("mathcanvas-project.mcanvas")
  })
})

describe("附件", () => {
  it("哈希由前端按**原始字节**算出来，并随字节一起发出去", async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = []
    installInvoke(async (command, args) => {
      calls.push({ command, args })
      return { contentHash: (args as { contentHash: string }).contentHash, byteSize: 3 }
    })

    const result = await putAttachment({ projectId: "local", documentId: "doc-1", generation: 7, mediaType: "image/png", bytes: new TextEncoder().encode("abc") })

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe("put_attachment")
    expect(calls[0].args).toEqual({
      projectId: "local",
      documentId: "doc-1",
      generation: 7,
      mediaType: "image/png",
      // FIPS 180-4 里 `abc` 的那条公开向量：哈希对不对不需要相信这份实现。
      contentHash: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      base64Bytes: "YWJj"
    })
    if (result.ok) expect(result.value.byteSize).toBe(3)
  })

  it("二进制附件不会被当成字符串改写", async () => {
    let sent = ""
    installInvoke(async (_command, args) => {
      sent = (args as { base64Bytes: string }).base64Bytes
      return { contentHash: "x", byteSize: 4 }
    })

    await putAttachment({ projectId: "local", documentId: "doc-1", generation: 1, mediaType: "image/png", bytes: PNG })

    expect(sent).toBe("iVBORw==")
  })

  it("读回来的字节与写进去的一样，找不到时是 null 而不是错误", async () => {
    // 替身**按参数**回答（不是按调用顺序）：这样"哈希真的被传下去了"也被钉住。
    installInvoke(async (command, args) => (command === "read_attachment" && (args as { contentHash?: string }).contentHash === "hash-1" ? "iVBORw==" : null))

    const found = await readAttachment("hash-1")
    const missing = await readAttachment("hash-2")

    expect(found.ok && found.value && [...found.value]).toEqual([0x89, 0x50, 0x4e, 0x47])
    // 缺失是**结果**（Rust 侧刻意回 null），不是失败 —— 混成一句"读附件失败"会让界面没法区分。
    expect(missing.ok && missing.value).toBeNull()
  })

  it("回收孤儿附件把返回的哈希列表原样交出来", async () => {
    installInvoke(async () => ["hash-a", "hash-b"])

    const result = await collectAttachments()

    expect(result.ok && result.value).toEqual(["hash-a", "hash-b"])
  })
})

describe("导出与导入", () => {
  it("导出把文档正文、附件哈希与目的地一起交给 Rust 侧", async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = []
    installInvoke(async (command, args) => {
      calls.push({ command, args })
      return { destination: "D:\\out\\demo.mcanvas", byteSize: 2048, documentCount: 1, attachmentCount: 2 }
    })

    const result = await exportPackage({
      projectId: "local",
      documents: [{ documentId: "doc-1", epoch: "epoch:doc-1", generation: 7, content: "{\"metadata\":{}}" }],
      attachments: ["hash-a", "hash-b"],
      destination: "D:\\out\\demo"
    })

    expect(calls[0].command).toBe("export_package")
    expect(calls[0].args).toEqual({
      projectId: "local",
      documents: [{ documentId: "doc-1", epoch: "epoch:doc-1", generation: 7, content: "{\"metadata\":{}}" }],
      attachments: ["hash-a", "hash-b"],
      // 补扩展名在这里做，而不是让用户自己去想（Rust 侧写的**就是**这个路径）。
      destination: "D:\\out\\demo.mcanvas"
    })
    expect(result.ok && result.value.attachmentCount).toBe(2)
  })

  it("导入带上路径、项目与新的 epoch，并把缺失来源如实带回来", async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = []
    installInvoke(async (command, args) => {
      calls.push({ command, args })
      return { projectId: "local", schemaVersion: "0.1", documents: ["doc-1"], attachmentCount: 1, missingSources: ["source-9"] }
    })

    const result = await importPackage({ path: "D:\\in\\demo.mcanvas", projectId: "local", epoch: "epoch:import-1" })

    expect(calls[0].command).toBe("import_package")
    expect(calls[0].args).toEqual({ path: "D:\\in\\demo.mcanvas", projectId: "local", epoch: "epoch:import-1" })
    // 来源缺失**不拒绝整包**（那是 Rust 侧的判据），所以这里如实往下传。
    expect(result.ok && result.value.missingSources).toEqual(["source-9"])
  })
})

describe("两种失败分开说", () => {
  it("在浏览器里跑是正常状态，不是错误", async () => {
    const attachment = await putAttachment({ projectId: "local", documentId: "doc-1", generation: 1, mediaType: "image/png", bytes: PNG })
    const exported = await exportPackage({ projectId: "local", documents: [], attachments: [], destination: "D:\\out\\demo" })

    expect(attachment.ok).toBe(false)
    if (!attachment.ok) {
      expect(attachment.code).toBe("no_desktop_shell")
      expect(attachment.detail).toContain("browser")
    }
    expect(exported.ok).toBe(false)
    if (!exported.ok) expect(exported.code).toBe("no_desktop_shell")
  })

  it("IPC 真的失败时把原因带出来", async () => {
    installInvoke(async () => { throw new Error("the project repository is not initialised") })

    const result = await importPackage({ path: "D:\\in\\demo.mcanvas", projectId: "local", epoch: "e" })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("ipc_failed")
      expect(result.detail).toContain("repository")
    }
  })
})
