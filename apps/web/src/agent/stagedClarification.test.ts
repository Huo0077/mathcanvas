import { createEmptyDocument } from "@draw/dsl"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createDraftStore, type StageResult, type StagedCompileResult } from "./draftStore"
import { createWorkerCompileStrategy, resetGeometryWorkerForTests } from "./geometryWorkerHost"
import { inlineWorker } from "./testing/inlineWorker"

/**
 * **A4（2026-10-26）：澄清 / 空结果不许被包装成"成功暂存"**。
 *
 * 这一组钉的是**现场文档**，不只是错误文案：
 * - `ok: true` 但 `draftDocument: null` 的编译结果（空操作）**不是**一份有效草稿；
 * - 编译期给出的数学澄清（`questions`）必须原样到达界面，不能因为"没有 diagnostics"丢掉，
 *   也不能被改成传输错误；
 * - in-process 与生产 Worker 两条路对同一份计划给出同一结局；
 * - 失败之后草稿的候选内容与版本**一个字节都没动**。
 */
const PROMPT = "画一个圆柱。"

/** 圆柱**没给半径**（schema 标成 ask_user）⇒ 编译期正好产出一条数学澄清。 */
const CLARIFY_ACTIONS = [
  { actionId: "solid.create_template", actionKey: "c", factIds: [], inputs: { alias: "c", template: "cylinder", origin: { x: 0, y: 0, z: 0 } } }
]

beforeEach(() => {
  resetGeometryWorkerForTests()
})

afterEach(() => {
  resetGeometryWorkerForTests()
})

function emptySuccessWith(draftDocument: StagedCompileResult["draftDocument"], questions: StagedCompileResult["questions"]): StagedCompileResult {
  return { ok: true, draftDocument, operations: [], diagnostics: [], questions, assumptions: [] }
}

describe("A4 澄清与空结果", () => {
  it("`ok: true` + `draftDocument: null` + 澄清 ⇒ 失败、问题保留、草稿不动", async () => {
    const question = { id: "q1", text: "底面半径是多少？", reason: "半径不能替你定。", path: "envelope.actions[0].inputs.radius" }
    const store = createDraftStore(undefined, () => emptySuccessWith(null, [question]))
    const record = store.create(createEmptyDocument("geometry3d"))
    const before = store.getPreview(record.draftId)!

    const staged = await store.stage(record.draftId, CLARIFY_ACTIONS as never, record.draftVersion, PROMPT)

    expect(staged.ok, "空结果被包装成了成功暂存").toBe(false)
    if (staged.ok) return
    expect(staged.reason).toBe("compile_failed")
    // **保留数学澄清**：不是"传输错误"，也不是笼统的"没有可编译动作"。
    expect(staged.diagnostics?.map((entry) => entry.code)).toContain("needs_more_information")
    expect(staged.diagnostics?.map((entry) => entry.message).join(" ")).toContain("底面半径")
    // 现场文档一个字节都没动：版本没推进、候选内容没变。
    const after = store.getPreview(record.draftId)!
    expect(after.draftVersion).toBe(before.draftVersion)
    expect(after.previewHash).toBe(before.previewHash)
    expect(after.candidate.primitives).toEqual([])
    expect(after.stageCount).toBe(0)
  })

  it("`ok: true` + `draftDocument: null` + 没有澄清 ⇒ 仍失败，且草稿不动", async () => {
    const store = createDraftStore(undefined, () => emptySuccessWith(null, []))
    const record = store.create(createEmptyDocument("geometry3d"))
    const before = store.getPreview(record.draftId)!

    const staged = await store.stage(record.draftId, CLARIFY_ACTIONS as never, record.draftVersion, PROMPT)

    expect(staged.ok).toBe(false)
    if (staged.ok) return
    expect(staged.reason).toBe("compile_failed")
    const after = store.getPreview(record.draftId)!
    expect(after.previewHash).toBe(before.previewHash)
    expect(after.draftVersion).toBe(before.draftVersion)
  })

  it("两条编译路（in-process / 生产 Worker）对同一份计划的结局一致，且都保留澄清", async () => {
    const { handleGeometryRequest } = await import("./workerRuntime")
    const inProcess = createDraftStore()
    const worker = createDraftStore(undefined, createWorkerCompileStrategy("run-a4", () => inlineWorker((request) => handleGeometryRequest(request as never))))

    const stagedOf = async (store: ReturnType<typeof createDraftStore>): Promise<{ staged: StageResult; hash: string; version: number }> => {
      const record = store.create(createEmptyDocument("geometry3d"))
      const before = store.getPreview(record.draftId)!
      const staged = await store.stage(record.draftId, CLARIFY_ACTIONS as never, record.draftVersion, PROMPT)
      const after = store.getPreview(record.draftId)!
      return { staged, hash: `${before.previewHash}->${after.previewHash}`, version: after.draftVersion }
    }
    const viaProcess = await stagedOf(inProcess)
    const viaWorker = await stagedOf(worker)

    expect(viaProcess.staged.ok).toBe(false)
    expect(viaWorker.staged.ok).toBe(false)
    const codes = (result: StageResult): string[] =>
      (result.ok ? [] : result.diagnostics?.map((entry) => entry.code) ?? []).sort()
    // 两条路**同一条原因码**，一层都不能少。
    expect(codes(viaWorker.staged)).toEqual(codes(viaProcess.staged))
    expect(codes(viaProcess.staged)).toContain("unsafe_omission")
    // 澄清的问题正文（"半径"）必须到达界面 —— 无论走哪条路。
    const text = (result: StageResult): string => (result.ok ? "" : result.diagnostics?.map((entry) => entry.message).join(" ") ?? "")
    expect(text(viaWorker.staged)).toContain("半径")
    expect(text(viaProcess.staged)).toContain("半径")
    // 失败没有改动现场文档：前后哈希相同、版本没有推进。
    expect(viaProcess.hash.split("->")[0]).toBe(viaProcess.hash.split("->")[1])
    expect(viaWorker.hash.split("->")[0]).toBe(viaWorker.hash.split("->")[1])
    expect(viaWorker.version).toBe(viaProcess.version)
  })
})
