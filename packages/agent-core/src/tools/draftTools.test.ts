import { describe, expect, it, vi } from "vitest"

import type { DocumentHandle } from "../contracts"
import { createDraftTools, type DraftHandle, type DraftStorePort, type DraftStageOutcome } from "./draftTools"

/**
 * Task 2.4 Step 1/2 里属于草稿工具的部分：
 * - 有效动作**只产生草稿**；
 * - 非法动作**不改草稿版本**；
 * - 结果里**不许有假的 `changed: true`**（每个写类结果都只引用草稿工件）。
 */
const target: DocumentHandle = { projectId: "p", documentId: "doc-1", workspace: "geometry3d", epoch: "epoch:doc-1", generation: 1, contentHash: "hash-1" }

const validAction = { actionId: "solid.create_template", actionKey: "c", factIds: [], inputs: { alias: "c", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 4, z: 4 } } } as never

/** 一个**记账式**的假草稿存储：记录每次调用，并按脚本返回结果。 */
function makePort(overrides: Partial<DraftStorePort> = {}): { port: DraftStorePort; calls: string[]; versionOf: () => number } {
  let version = 1
  const calls: string[] = []
  const port: DraftStorePort = {
    create: vi.fn(() => {
      calls.push("create")
      return { draftId: "draft_1", draftVersion: version, previewHash: "preview-1" }
    }),
    // `stage` / `preflight` 返回 `Promise`（方案 3：编译可以交给几何 Worker）。
    stage: vi.fn(async (draftId: string, _actions: readonly never[], expected: number): Promise<DraftStageOutcome> => {
      calls.push(`stage:${expected}`)
      if (expected !== version) return { ok: false, diagnostics: [{ code: "stale_draft_version", message: `at ${version}` }], unchanged: true }
      version += 1
      return { ok: true, diagnostics: [], handle: { draftId, draftVersion: version, previewHash: `preview-${version}` }, unchanged: false }
    }),
    preflight: vi.fn(async () => ({ ok: true, diagnostics: [] })),
    discard: vi.fn(() => true),
    ...overrides
  }
  return { port, calls, versionOf: () => version }
}

describe("draft.create", () => {
  it("returns a draft artifact and never claims the document changed", () => {
    const { port } = makePort()
    const result = createDraftTools(port).create(target)

    expect(result.status).toBe("success")
    // 关键：写类结果只引用**草稿工件**，payload 里没有任何"新文档"或 `changed: true`。
    expect(result.artifacts).toEqual([{ kind: "draft", id: "draft_1", draftVersion: 1, previewHash: "preview-1" }])
    expect(JSON.stringify(result)).not.toContain("changed")
  })
})

describe("draft.stage_actions", () => {
  it("stages a valid action and reports the new draft version", async () => {
    const { port, versionOf } = makePort()
    const tools = createDraftTools(port)
    const created = tools.create(target)

    const result = await tools.stageActions(created.payload.draftId, 1, [validAction])

    expect(result.status).toBe("success")
    expect(versionOf()).toBe(2)
    expect(result.artifacts[0]).toMatchObject({ kind: "draft", draftVersion: 2 })
    expect(result.payload?.draftVersion).toBe(2)
  })

  it("leaves the draft version untouched when the compiler refuses", async () => {
    // Step 1 的另一半：非法动作**不改草稿版本**。
    const stage = vi.fn(async () => ({ ok: false, diagnostics: [{ code: "unsupported_action", message: "no handler for planar.create_dragon" }], unchanged: true }))
    const { port, versionOf } = makePort({ stage })
    const tools = createDraftTools(port)

    const result = await tools.stageActions("draft_1", 1, [validAction])

    expect(result.status).toBe("error")
    expect(versionOf()).toBe(1)
    expect(result.payload).toBeNull()
    // 诊断要原样带出动作层的原因码，而不是笼统的"失败了"。
    expect(result.diagnostics[0].code).toBe("unsupported_action")
    // 并且要给出下一步，否则模型会重复同一笔动作。
    expect(result.next_actions.length).toBeGreaterThan(0)
  })

  it("flags a failure that mutated the draft anyway", async () => {
    // 若底层在失败时改了草稿，这必须被报出来：否则模型会以为"部分生效"而继续往上叠。
    const stage = vi.fn(async () => ({ ok: false, diagnostics: [], detail: "boom", unchanged: false }))
    const { port } = makePort({ stage })
    const result = await createDraftTools(port).stageActions("draft_1", 1, [validAction])

    expect(result.diagnostics.some((entry) => entry.code === "draft_mutated_on_failure")).toBe(true)
  })

  it("refuses an empty batch instead of staging nothing successfully", async () => {
    const { port, calls } = makePort()
    const result = await createDraftTools(port).stageActions("draft_1", 1, [])

    expect(result.status).toBe("warning")
    expect(result.diagnostics[0].code).toBe("empty_batch")
    // 空批次根本不该到存储层。
    expect(calls).not.toContain("stage:1")
  })

  it("surfaces a stale version instead of merging", async () => {
    // 拿旧版本号再来 = 调用方看的是上一轮的预览。合并等于把用户看过的预览悄悄换掉。
    const { port } = makePort()
    const result = await createDraftTools(port).stageActions("draft_1", 0, [validAction])

    expect(result.status).toBe("error")
    expect(result.diagnostics[0].code).toBe("stale_draft_version")
  })
})

describe("draft.validate", () => {
  it("reports acceptance without creating a draft", async () => {
    const { port, calls } = makePort()
    const result = await createDraftTools(port).validate("draft_1", 1, [validAction])

    expect(result.status).toBe("success")
    expect(result.payload).toEqual({ accepted: true })
    // 只校验不落草稿。
    expect(calls.some((call) => call.startsWith("stage"))).toBe(false)
  })

  it("reports the refusal reason when the batch would fail", async () => {
    const preflight = vi.fn(async () => ({ ok: false, diagnostics: [{ code: "target_not_found", message: "no object point-9" }], detail: "no object point-9" }))
    const { port } = makePort({ preflight })
    const result = await createDraftTools(port).validate("draft_1", 1, [validAction])

    expect(result.status).toBe("error")
    expect(result.payload).toEqual({ accepted: false })
    expect(result.diagnostics[0].code).toBe("target_not_found")
  })
})

describe("draft.preview and draft.discard", () => {
  it("warns when the caller is looking at an older version", () => {
    const result = createDraftTools(makePort().port).preview("draft_1", 1, 3)

    expect(result.status).toBe("warning")
    expect(result.diagnostics[0].code).toBe("stale_draft_version")
  })

  it("accepts a preview request for the current version", () => {
    const result = createDraftTools(makePort().port).preview("draft_1", 2, 2)

    expect(result.status).toBe("success")
    expect(result.payload).toMatchObject({ draftId: "draft_1", draftVersion: 2 })
  })

  it("reports an already-gone draft as a warning, not an error", () => {
    const discard = vi.fn(() => false)
    const result = createDraftTools(makePort({ discard }).port).discard("draft_gone")

    expect(result.status).toBe("warning")
    expect(result.payload).toEqual({ discarded: false })
    expect(result.diagnostics[0].code).toBe("unknown_draft")
  })
})

describe("no tool claims the live document changed", () => {
  it("never returns a changed flag on any path", async () => {
    // 计划原文："No tool function returns a fake `changed: true`."
    const { port } = makePort()
    const tools = createDraftTools(port)
    const created: { payload: DraftHandle } = tools.create(target) as never

    /**
     * 每个入口都要看一遍"结果形状里没有 `changed`"。
     *
     * `stageActions` / `validate` 是**异步**的（编译可以被交给几何 Worker），
     * 所以这里 `await Promise.all(...)` 把两种都归一成结果值 —— 否则循环里拿到的是
     * `Promise | ToolResult` 的联合，`result.artifacts` 就成了类型错误
     *（第一版正是这样漏掉了它们）。
     */
    const results = await Promise.all([
      tools.create(target),
      tools.stageActions(created.payload.draftId, 1, [validAction]),
      tools.stageActions("draft_1", 99, [validAction]),
      tools.validate("draft_1", 1, [validAction]),
      tools.preview("draft_1", 1, 1),
      tools.discard("draft_1")
    ])

    for (const result of results) {
      expect(JSON.stringify(result)).not.toContain('"changed"')
      // 每个结果都带 artifacts 字段（可以为空数组），形状统一。
      expect(Array.isArray(result.artifacts)).toBe(true)
    }
  })
})
