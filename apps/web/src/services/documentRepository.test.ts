import { createEmptyDocument } from "@draw/dsl"
import { contentFingerprint, createDocumentHandle } from "@draw/scene-graph"
import { describe, expect, it, vi } from "vitest"

import { classifyRepositoryError, createDocumentRepository, documentFromSnapshot, idempotencyKey } from "./documentRepository"

/**
 * 项目仓储客户端（Task 1.6 前端一半）。
 *
 * 最要紧的三条：
 * 1. **内容哈希在前端算**（由 `contentFingerprint` 决定，不在 Rust 里再实现一遍）；
 * 2. **幂等键是纯函数** —— 同一件事重算得到同一把键；
 * 3. **失败分成能照做的类别** —— "去装桌面版" 与 "别人改过了，重新读一遍" 是两件事。
 */
function document(workspace: "conics" | "geometry3d" = "conics") {
  return createEmptyDocument(workspace)
}

describe("the repository client", () => {
  it("sends the content and the fingerprint the scene-graph computed", async () => {
    const calls: { command: string; args: Record<string, unknown> }[] = []
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args: args ?? {} })
      return { projectId: "p1", documentId: "d1", epoch: "epoch:d1", generation: 1, contentHash: "h", content: "{}", updatedAt: 0 }
    })
    const repository = createDocumentRepository(invoke)
    const candidate = document()

    await repository.create("p1", candidate)

    expect(calls[0].command).toBe("create_document")
    // 哈希必须与 `contentFingerprint` 逐字一致 —— 在 Rust 里再实现一遍必然分叉，
    // 而分叉的后果是"同一份文档有两个哈希"，CAS 永远失败。
    expect(calls[0].args.contentHash).toBe(contentFingerprint(candidate))
    expect(calls[0].args.documentId).toBe(candidate.metadata.id)
  })

  it("passes all three CAS criteria from the handle", async () => {
    const calls: { command: string; args: Record<string, unknown> }[] = []
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args: args ?? {} })
      return { idempotencyKey: "k", outcome: { kind: "committed", generation: 2, contentHash: "h2" }, committedAt: 1 }
    })
    const repository = createDocumentRepository(invoke)
    const candidate = document()
    const handle = createDocumentHandle(candidate, "p1", "epoch:d1")

    await repository.commit("p1", candidate, handle, 3)

    // 三个判据都要**显式**送过去：只送 generation 会漏掉"同版号换内容"与换过文档的情形。
    expect(calls[0].args.expectedEpoch).toBe(handle.epoch)
    expect(calls[0].args.expectedGeneration).toBe(handle.generation)
    expect(calls[0].args.expectedContentHash).toBe(handle.contentHash)
    expect(calls[0].args.actions).toBe(3)
  })

  it("derives a stable idempotency key from the document and its content", () => {
    // 判据是"**这次提交是什么**"，不是"什么时候发的" ——
    // 带时间戳的键会让重试变成一次新提交，而幂等键的全部价值就在于让重试**不是**新提交。
    const first = idempotencyKey("d1", "hash-a")
    const second = idempotencyKey("d1", "hash-a")

    expect(first).toBe(second)
    expect(idempotencyKey("d1", "hash-b")).not.toBe(first)
    expect(first).toContain("hash-a")
  })

  it("sends that same key when the same commit is retried", async () => {
    const keys: unknown[] = []
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      keys.push(args?.idempotencyKey)
      return { idempotencyKey: "k", outcome: { kind: "committed", generation: 2, contentHash: "h" }, committedAt: 1 }
    })
    const repository = createDocumentRepository(invoke)
    const candidate = document()
    const handle = createDocumentHandle(candidate, "p1", "epoch:d1")

    await repository.commit("p1", candidate, handle, 1)
    await repository.commit("p1", candidate, handle, 1)

    expect(keys[0]).toBe(keys[1])
  })
})

describe("failures are split into actionable categories", () => {
  it("tells a browser apart from a real failure", () => {
    const error = new Error("no desktop shell is available for read_document_head")
    error.name = "NoDesktopShellError"

    const failure = classifyRepositoryError(error)

    expect(failure.ok).toBe(false)
    if (!failure.ok) {
      expect(failure.code).toBe("not_a_desktop_shell")
      expect(failure.detail).toContain("桌面版")
    }
  })

  it("separates a stale head from a missing document", () => {
    // "别人改过了，重新读一遍" 与 "这份文档还不存在（第一次保存）" 是两件不同的事 ——
    // 混成一句"保存失败"会让用户去重试一件永远不会成功的事。
    const stale = classifyRepositoryError(new Error("the document is at generation 5, not 3; reload before saving"))
    const missing = classifyRepositoryError(new Error("no document d1 in project p1"))

    expect(stale.ok).toBe(false)
    expect(missing.ok).toBe(false)
    if (!stale.ok) expect(stale.code).toBe("stale_head")
    if (!missing.ok) expect(missing.code).toBe("not_found")
  })

  it("separates an idempotency conflict, because retrying it will never help", () => {
    const conflict = classifyRepositoryError(new Error("idempotency key d1@h was already used for d1@2 (h2), but this request carries h3"))

    expect(conflict.ok).toBe(false)
    if (!conflict.ok) expect(conflict.code).toBe("idempotency_conflict")
  })

  it("returns the failure instead of throwing", async () => {
    const invoke = vi.fn(async () => { throw new Error("cannot open C:\\…\\projects.db: permission denied") })
    const repository = createDocumentRepository(invoke)

    const result = await repository.readHead("p1", "d1")

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("io")
  })
})

describe("restoring a document from a snapshot", () => {
  it("gives back the document that was stored", () => {
    const original = document("geometry3d")
    const snapshot = { projectId: "p1", documentId: original.metadata.id, epoch: "e", generation: 4, contentHash: "h", content: JSON.stringify(original), updatedAt: 0 }

    const restored = documentFromSnapshot(snapshot)

    expect(restored?.metadata.id).toBe(original.metadata.id)
    expect(restored?.workspace).toBe("geometry3d")
  })

  it("returns null for a snapshot whose content is not a document", () => {
    // 坏内容要**如实回 null**，而不是抛异常把整条恢复路径打断。
    expect(documentFromSnapshot({ projectId: "p", documentId: "d", epoch: "e", generation: 1, contentHash: "h", content: "{ not json", updatedAt: 0 })).toBeNull()
    expect(documentFromSnapshot({ projectId: "p", documentId: "d", epoch: "e", generation: 1, contentHash: "h", content: "{\"nope\":1}", updatedAt: 0 })).toBeNull()
  })
})
