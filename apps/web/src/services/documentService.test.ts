import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { createDocumentHandle } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { createDocumentService, type DocumentPort } from "./documentService"

/**
 * Task 0.7：**Compare-and-Swap 写入服务**。
 *
 * 要守住的四件事（计划 Step 1 点名）：
 * 1. 过期的 generation 永远不能写进去；
 * 2. epoch 被替换之后旧授权失效；
 * 3. **撤销之后的同内容 ABA**：内容看起来回来了，但"那一版授权"不该复活；
 * 4. 一次成功的提交流程完整可用。
 */

/** 测试用的文档端口：真实应用里它是 zustand store，测试里是一个可预期的假实现。 */
interface TestPort extends DocumentPort {
  document: GeometryDocument
  replacements: GeometryDocument[]
  currentEpoch: string | undefined
}

function createPort(initial: GeometryDocument): TestPort {
  // `currentEpoch` 必须是**可变字段**（测试里要模拟"导入产生新 epoch"），
  // 所以显式声明类型而不是从 `undefined as string | undefined` 推。
  const port: TestPort = {
    document: initial,
    replacements: [],
    currentEpoch: undefined,
    current: () => ({ workspace: port.document.workspace, document: port.document }),
    epoch: () => port.currentEpoch,
    replace: (candidate: GeometryDocument) => {
      port.replacements.push(candidate)
      port.document = candidate
    }
  }
  return port
}

describe("document service commit", () => {
  it("accepts a commit whose expected generation still matches", () => {
    const base = createEmptyDocument("conics")
    const port = createPort(base)
    const service = createDocumentService(port)
    const handle = createDocumentHandle(base, "project-1")

    const candidate: GeometryDocument = { ...base, primitives: [{ id: "point-1", type: "point", x: 1, y: 1 }] }
    const receipt = service.commit(candidate, handle)

    expect(receipt.ok).toBe(true)
    expect(port.replacements).toHaveLength(1)
    expect(port.document.primitives).toHaveLength(1)
  })

  it("refuses a stale generation and never touches the live document", () => {
    const base = createEmptyDocument("conics")
    const port = createPort(base)
    const service = createDocumentService(port)
    const staleHandle = createDocumentHandle(base, "project-1")

    // 用户在这份句柄之后又改了一次（模拟"预览期间手工编辑"）。
    const edited: GeometryDocument = { ...base, primitives: [{ id: "point-9", type: "point", x: 0, y: 0 }], revision: base.revision + 1 }
    port.document = edited

    const candidate: GeometryDocument = { ...base, primitives: [{ id: "point-1", type: "point", x: 1, y: 1 }] }
    const receipt = service.commit(candidate, staleHandle)

    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe("stale_generation")
    // 关键断言：过期候选**从不调用**真实替换。
    expect(port.replacements).toHaveLength(0)
    expect(port.document.primitives).toHaveLength(1)
  })

  it("refuses a commit after the epoch changed, even when the content hash matches again", () => {
    const base = createEmptyDocument("conics")
    const port = createPort(base)
    const service = createDocumentService(port)
    const handle = createDocumentHandle(base, "project-1")

    // 导入/替换产生新 epoch：**同一份文档 id、内容整体换过**，旧授权一律作废。
    port.currentEpoch = "epoch:reimported"

    const receipt = service.commit({ ...base, primitives: [{ id: "point-1", type: "point", x: 1, y: 1 }] }, handle)

    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe("stale_epoch")
    expect(port.replacements).toHaveLength(0)
  })

  it("refuses a same-content ABA candidate after an undo", () => {
    const base = createEmptyDocument("conics")
    const withPoint: GeometryDocument = { ...base, primitives: [{ id: "point-1", type: "point", x: 1, y: 1 }], revision: base.revision + 1 }
    const port = createPort(withPoint)
    const service = createDocumentService(port)
    // 句柄取自"有那个点"的那一刻。
    const handle = createDocumentHandle(withPoint, "project-1")

    // 用户撤销回到没有点的状态 —— 内容与句柄不同，但**同一份文档 id**。
    port.document = base

    // 一个内容与句柄相同的候选（"内容又回来了"）：ABA 场景。
    const receipt = service.commit({ ...withPoint }, handle)

    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(["stale_generation", "stale_content"]).toContain(receipt.reason)
    expect(port.replacements).toHaveLength(0)
  })

  it("refuses a candidate that does not belong to the handle's document", () => {
    const base = createEmptyDocument("conics")
    const port = createPort(base)
    const service = createDocumentService(port)
    const handle = createDocumentHandle(base, "project-1")

    const foreign: GeometryDocument = { ...base, metadata: { ...base.metadata, id: "another-document" } }
    const receipt = service.commit(foreign, handle)

    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe("document_mismatch")
    expect(port.replacements).toHaveLength(0)
  })
})
