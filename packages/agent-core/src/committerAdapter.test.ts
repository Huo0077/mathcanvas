import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"
import { describe, expect, it, vi } from "vitest"

import { createCommitterAdapter, type DraftStoreLike, type HostBridgeLike } from "./committerAdapter"
import type { ConsentToken } from "./coordinatorPorts"
import type { DocumentHandle, RunContext } from "./contracts"

/**
 * Task 2.4 的接线：把协调器的 `CommitterPort` 接到 G0.5 的 `DraftStore` + `HostBridge`。
 *
 * 这里的重点是**暂存不写文档、提交必须带同意**，以及"失败原因不被合并"。
 * 用假存储与假 HostBridge（形状与真实那两个一致）来驱动，因为真实的 `DraftStore`
 * 在 `apps/web`（agent-core 不能依赖它）。
 */
const consent: ConsentToken = { kind: "user_consent", nonce: "nonce-1", previewHash: "preview-1" }
const signal = new AbortController().signal

function document(primitives: unknown[] = []): GeometryDocument {
  return { ...createEmptyDocument("geometry3d"), primitives } as unknown as GeometryDocument
}

function handleFor(value: GeometryDocument): DocumentHandle {
  // 手写 agent-core 契约里的句柄形状：`DocumentHandle` 在两侧同名但是两个类型，
  // 跨包赋值会被拒（这本身是有用的信号 —— 见 `docs/project-progress.md` 的接线记录）。
  return { projectId: "project-1", documentId: value.metadata.id, workspace: value.workspace as DocumentHandle["workspace"], epoch: `epoch:${value.metadata.id}`, generation: value.revision, contentHash: contentFingerprint(value) }
}

function run(): RunContext {
  return { runId: "run-1", conversationId: "c-1", promptMessageId: "m-1", target: handleFor(document()), sources: [], textProfileId: "p-1", capabilityRevision: "rev", policyRevision: "policy" }
}

const actions = [{ actionId: "solid.create_template", actionKey: "c", factIds: [], inputs: {} }] as never

/** 记账式假草稿存储：形状与 `apps/web/src/agent/draftStore.ts` 的 `DraftStore` 一致。 */
function makeDrafts(overrides: Partial<DraftStoreLike> = {}, onStaged?: (version: number) => void): DraftStoreLike & { stagedWith: { draftId: string; version: number }[] } {
  let version = 1
  const stagedWith: { draftId: string; version: number }[] = []
  const base: DraftStoreLike & { stagedWith: typeof stagedWith } = {
    stagedWith,
    create: vi.fn(() => ({ draftId: "draft_1", draftVersion: version })),
    stage: vi.fn((_draftId: string, _actions: readonly unknown[], expected: number) => {
      stagedWith.push({ draftId: _draftId, version: expected })
      if (expected !== version) return { ok: false as const, reason: "stale_draft_version" as const, detail: `at ${version}` }
      version += 1
      // 真实系统里"草稿版本推进"与"HostBridge 读到新版本"是同一次写入的两面。
      onStaged?.(version)
      return { ok: true as const, preview: { draftVersion: version, previewHash: `preview-${version}` } }
    }),
    assertFresh: vi.fn(() => ({ ok: true as const })),
    ...overrides
  }
  return base
}

/**
 * 记账式假 `HostBridge`。
 *
 * `preview` 必须**反映真实版本**：真实的 `HostBridge.preview` 从草稿存储里读当前版本，
 * 而适配器正是靠它决定"这次暂存期望的版本号"。第一版我把它写成恒返回 1（一个**过期**的替身），
 * 于是第二次暂存必然被判 `stale_draft_version` —— 又一次"替身与生产代码不一致"的例子，
 * 而这次不一致的表现是**测试失败**（比替身太宽松那种更好抓）。
 */
type HostDouble = HostBridgeLike & { commits: unknown[]; setVersion: (next: number) => void }

function makeHost(overrides: Partial<HostBridgeLike> = {}): HostDouble {
  const commits: unknown[] = []
  let version = 1
  return {
    commits,
    setVersion: (next: number) => { version = next },
    preview: vi.fn(() => ({ ok: true as const, artifact: { draftVersion: version, previewHash: `preview-${version}` } })),
    requestConsent: vi.fn(() => ({ ok: true as const, record: { nonce: "nonce-1" } })),
    commit: vi.fn((_draftId: string, token: unknown) => {
      commits.push(token)
      return { ok: true as const, receipt: { changed: true, draftId: "draft_1" } }
    }),
    ...overrides
  }
}

describe("committer adapter staging", () => {
  it("creates one draft per run and reuses it across stages", async () => {
    // 每次阶段调用都新建草稿 → `commit` 提交的是用户没看过的预览。
    const host = makeHost()
    // `onStaged` 把草稿版本同步给 HostBridge —— 真实系统里这是同一次写入的两面。
    const drafts = makeDrafts({}, (version) => host.setVersion(version))
    const adapter = createCommitterAdapter({ drafts, host, live: () => ({ handle: handleFor(document()), document: document() }) })

    const first = await adapter.stage({ run: run(), actionCount: 1, actions, signal })
    const second = await adapter.stage({ run: run(), actionCount: 1, actions, signal })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(drafts.create).toHaveBeenCalledTimes(1)
    expect(adapter.draftIdFor()).toBe("draft_1")
  })

  it("reports a stale base document as stale_draft instead of rebuilding silently", async () => {
    // 手工编辑过基础文档：重建草稿等于把用户看过的预览换掉。
    const drafts = makeDrafts({ assertFresh: vi.fn(() => ({ ok: false as const, reason: "stale_source" as const, detail: "the document changed" })) })
    const adapter = createCommitterAdapter({ drafts, host: makeHost(), live: () => ({ handle: handleFor(document()), document: document() }) })

    const result = await adapter.stage({ run: run(), actionCount: 1, actions, signal })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("stale_draft")
      expect(result.detail).toContain("changed")
    }
    expect(drafts.stage).not.toHaveBeenCalled()
  })

  it("keeps stale_draft_version distinct from stale_draft", async () => {
    // 两种过期的处置不同：一个是"重读预览"，一个是"重看文档"。合并会让协调器选错分支。
    const drafts = makeDrafts()
    const adapter = createCommitterAdapter({ drafts, host: makeHost({ preview: () => ({ ok: false as const, reason: "unknown_draft" as const }) }), live: () => ({ handle: handleFor(document()), document: document() }) })

    // 第一次 stage 会以版本 1 建立草稿并把内部版本推到 2；第二次仍从 preview 拿到 unknown → 用版本 1 → 撞上 stale。
    await adapter.stage({ run: run(), actionCount: 1, actions, signal })
    const second = await adapter.stage({ run: run(), actionCount: 1, actions, signal })

    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe("stale_draft_version")
  })

  it("reports a compiler refusal with its diagnostics", async () => {
    const drafts = makeDrafts({ stage: vi.fn(() => ({ ok: false as const, reason: "compile_failed" as const, diagnostics: [{ code: "unsupported_action", message: "no handler" }] })) })
    const adapter = createCommitterAdapter({ drafts, host: makeHost(), live: () => ({ handle: handleFor(document()), document: document() }) })

    const result = await adapter.stage({ run: run(), actionCount: 1, actions, signal })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("compile_failed")
      expect(result.detail).toContain("unsupported_action")
    }
  })

  /**
   * **编译器的修复请求必须穿过适配器**（Agent DSL 切片 Task 4 的接线）。
   *
   * 适配器是协调器与草稿存储之间唯一的一段代码。它此前只映射 `reason` 与 `detail`，
   * 于是 `compilePlan` 那份结构化修复请求（`code`/`path`/`allowedChanges`）在
   * **这一层就被丢掉了** —— 协调器手里根本没有可发回模型的请求。
   */
  it("passes the compiler's repair request, diagnostics and assumptions through", async () => {
    const repair = { reason: "schema_invalid", errors: [{ code: "degenerate_prism", path: "envelope.actions[0].inputs.basePolygon", detail: "zero vector" }], allowedChanges: ["envelope.actions[0].inputs.basePolygon"], attempt: 1 }
    const planDiagnostics = [{ stage: "geometry_validation" as const, code: "degenerate_prism", path: "envelope.actions[0].inputs.basePolygon", detail: "zero vector", severity: "error" as const }]
    const assumptions = [{ id: "prism:vector", text: "拉伸向量未指定", kind: "safe_default" as const, value: { x: 0, y: 0, z: 3 }, overridable: true }]
    const drafts = makeDrafts({ stage: vi.fn(() => ({ ok: false as const, reason: "compile_failed" as const, diagnostics: [{ code: "degenerate_prism", message: "geometry_validation" }], repair, planDiagnostics, assumptions })) })
    const adapter = createCommitterAdapter({ drafts, host: makeHost(), live: () => ({ handle: handleFor(document()), document: document() }) })

    const result = await adapter.stage({ run: run(), actionCount: 1, actions, signal })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.repair).toEqual(repair)
      expect(result.planDiagnostics).toEqual(planDiagnostics)
      expect(result.assumptions).toEqual(assumptions)
    }
  })

  it("refuses to stage when there is no active document", async () => {
    const adapter = createCommitterAdapter({ drafts: makeDrafts(), host: makeHost(), live: () => null })

    const result = await adapter.stage({ run: run(), actionCount: 1, actions, signal })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("unsupported")
  })
})

describe("committer adapter commit", () => {
  it("passes the consent token through to the host without inspecting it", async () => {
    // 同意凭据在协调器里是不透明的；检查它是 `HostBridge` 的职责，再看一遍只会造出第二个真相。
    const host = makeHost()
    const adapter = createCommitterAdapter({ drafts: makeDrafts(), host, live: () => ({ handle: handleFor(document()), document: document() }) })
    await adapter.stage({ run: run(), actionCount: 1, actions, signal })

    const result = await adapter.commit({ run: run(), actionCount: 1, actions, signal, consent })

    expect(result.status).toBe("committed")
    expect(host.commits).toEqual([consent])
  })

  /**
   * **`changed: false` 的替身形状必须与真 `HostBridge` 一致**（外部审查 A1）。
   *
   * 这条用例一直绿，而生产里 `no_change` 从来没出现过 —— 因为真的 `HostBridge`
   * 把"无需改动"发在**失败**通道上（`{ ok: false, reason: "no_change" }`），
   * 那个 `reason` 落进下面那句通用拒绝，于是协调器的 `no_change → completed` 成了死代码。
   * 也就是说：**替身替真身撒了谎**，用例测的是一个生产不会出现的输入。
   *
   * 现在两半各自被钉住了：真 `HostBridge` 那一半在
   * `apps/web/src/agent/hostBridge.test.ts`（"reports a commit that changes nothing as a
   * success, not a failure"），形状就是这里 stub 的这一份；这一半钉适配器的映射。
   * 改动任一侧的形状，另一侧就会红。
   */
  it("maps a no-change commit to no_change rather than a failure", async () => {
    const host = makeHost({ commit: vi.fn(() => ({ ok: true as const, receipt: { changed: false, draftId: "draft_1" } })) })
    const adapter = createCommitterAdapter({ drafts: makeDrafts(), host, live: () => ({ handle: handleFor(document()), document: document() }) })
    await adapter.stage({ run: run(), actionCount: 1, actions, signal })

    const result = await adapter.commit({ run: run(), actionCount: 1, actions, signal, consent })

    expect(result.status).toBe("no_change")
  })

  it("keeps stale_source distinct from a plain rejection", async () => {
    const host = makeHost({ commit: vi.fn(() => ({ ok: false as const, reason: "stale_source", detail: "the head moved" })) })
    const adapter = createCommitterAdapter({ drafts: makeDrafts(), host, live: () => ({ handle: handleFor(document()), document: document() }) })
    await adapter.stage({ run: run(), actionCount: 1, actions, signal })

    const result = await adapter.commit({ run: run(), actionCount: 1, actions, signal, consent })

    expect(result.status).toBe("stale_source")
    expect(result.detail).toContain("moved")
  })

  it("surfaces a missing consent as a rejection with the reason", async () => {
    const host = makeHost({ commit: vi.fn(() => ({ ok: false as const, reason: "missing_consent" })) })
    const adapter = createCommitterAdapter({ drafts: makeDrafts(), host, live: () => ({ handle: handleFor(document()), document: document() }) })
    await adapter.stage({ run: run(), actionCount: 1, actions, signal })

    const result = await adapter.commit({ run: run(), actionCount: 1, actions, signal, consent })

    expect(result.status).toBe("rejected")
    expect(result.detail).toContain("missing_consent")
  })

  it("refuses to commit when nothing was staged", async () => {
    const adapter = createCommitterAdapter({ drafts: makeDrafts(), host: makeHost(), live: () => ({ handle: handleFor(document()), document: document() }) })

    const result = await adapter.commit({ run: run(), actionCount: 1, actions, signal, consent })

    expect(result.status).toBe("rejected")
    expect(result.detail).toContain("no draft")
  })

  it("never returns committed without the host having accepted", async () => {
    const host = makeHost({ commit: vi.fn(() => ({ ok: false as const, reason: "consumed_consent" })) })
    const adapter = createCommitterAdapter({ drafts: makeDrafts(), host, live: () => ({ handle: handleFor(document()), document: document() }) })
    await adapter.stage({ run: run(), actionCount: 1, actions, signal })

    const result = await adapter.commit({ run: run(), actionCount: 1, actions, signal, consent })

    expect(result.status).not.toBe("committed")
  })
})

describe("handle helper", () => {
  it("derives the same content hash the rest of the system uses", () => {
    const value = document([{ id: "point3-1", type: "point3", position: { x: 1, y: 2, z: 3 } }])

    expect(handleFor(value).contentHash).toBe(contentFingerprint(value))
  })
})
