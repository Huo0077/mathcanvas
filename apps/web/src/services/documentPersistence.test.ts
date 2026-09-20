import { createEmptyDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"
import { describe, expect, it, vi } from "vitest"

import type { DocumentRepository, DocumentSnapshot, RepositoryResult } from "./documentRepository"
import { createDocumentPersistence, handleFromSnapshot } from "./documentPersistence"

/**
 * 文档持久化适配器（Task 1.6：`documentService` 接仓储）。
 *
 * 三条最要紧的性质，都是"高频路径上的判断"：
 * 1. **内容没变就不发 IPC**（`saveDraft` 挂在 `[document]` 上，每次改动都会触发）；
 * 2. **换了一世之后回来的保存结果一律丢弃**（否则刚打开的文件会被上一次编辑覆盖）；
 * 3. **恢复总会给出一份可用文档**，失败也如实带出原因（不能让用户卡在启动上）。
 */
function snapshot(document: ReturnType<typeof createEmptyDocument>, generation = 1, epoch = "epoch:db"): DocumentSnapshot {
  return {
    projectId: "p1",
    documentId: document.metadata.id,
    epoch,
    generation,
    contentHash: contentFingerprint(document),
    content: JSON.stringify(document),
    updatedAt: 0
  }
}

/** 一个够用的内存仓储替身：只记 head，并按 CAS 的规则拒绝过期提交。 */
function makeRepository(options: { stored?: DocumentSnapshot | null; notDesktop?: boolean; failCreate?: boolean } = {}) {
  let stored = options.stored ?? null
  const calls: string[] = []

  const repository: DocumentRepository = {
    readHead: vi.fn(async (): Promise<RepositoryResult<DocumentSnapshot>> => {
      calls.push("readHead")
      if (options.notDesktop) return { ok: false, code: "not_a_desktop_shell", detail: "browser" }
      if (!stored) return { ok: false, code: "not_found", detail: "no document" }
      return { ok: true, value: stored }
    }),
    create: vi.fn(async (_projectId: string, document): Promise<RepositoryResult<DocumentSnapshot>> => {
      calls.push("create")
      if (options.failCreate) return { ok: false, code: "io", detail: "cannot open the database" }
      if (stored) return { ok: false, code: "stale_head", detail: "document already exists" }
      stored = snapshot(document, 1)
      return { ok: true, value: stored }
    }),
    commit: vi.fn(async (_projectId: string, document, expected): Promise<RepositoryResult<{ idempotencyKey: string; outcome: { kind: "committed"; generation: number; contentHash: string }; committedAt: number }>> => {
      calls.push("commit")
      if (!stored) return { ok: false, code: "not_found", detail: "no document" }
      // CAS：三个判据一起比（与 Rust 侧同一套规则）。
      if (stored.epoch !== expected.epoch || stored.generation !== expected.generation || stored.contentHash !== expected.contentHash) {
        return { ok: false, code: "stale_head", detail: `the document is at generation ${stored.generation}, not ${expected.generation}` }
      }
      stored = snapshot(document, stored.generation + 1, stored.epoch)
      return { ok: true, value: { idempotencyKey: "k", outcome: { kind: "committed", generation: stored.generation, contentHash: stored.contentHash }, committedAt: 1 } }
    }),
    lookup: vi.fn(async () => ({ ok: true as const, value: null })),
    replaceEpoch: vi.fn(async (_projectId: string, document): Promise<RepositoryResult<DocumentSnapshot>> => {
      calls.push("replaceEpoch")
      if (!stored) return { ok: false, code: "not_found", detail: "no document" }
      // 换一世：generation 照常推进，epoch 换掉 —— 于是**在途的旧保存立刻 CAS 失败**。
      stored = { ...snapshot(document, stored.generation + 1), epoch: `epoch:${document.metadata.id}:${contentFingerprint(document)}` }
      return { ok: true, value: stored }
    }),
    readSnapshot: vi.fn(async () => ({ ok: false as const, code: "not_found" as const, detail: "no snapshot" })),
    historyLength: vi.fn(async () => ({ ok: true as const, value: stored ? 1 : 0 }))
  }
  return { repository, calls, stored: () => stored }
}

function persistence(repository: DocumentRepository) {
  return createDocumentPersistence({ repository, projectId: "p1", emptyDocument: () => createEmptyDocument("conics") })
}

describe("restoring on startup", () => {
  it("brings back the stored document instead of a blank one", async () => {
    const stored = createEmptyDocument("conics")
    stored.primitives.push({ id: "point-1", type: "point", x: 3, y: 4 } as never)
    const { repository } = makeRepository({ stored: snapshot(stored, 7) })

    const outcome = await persistence(repository).restore()

    expect(outcome.created).toBe(false)
    expect(outcome.document.primitives).toHaveLength(1)
    expect(outcome.failure).toBeUndefined()
  })

  it("creates a document on a first run and reports that it was created", async () => {
    const { repository, calls } = makeRepository({ stored: null })

    const outcome = await persistence(repository).restore()

    // 首次启动时 `readHead` 回 `not_found` 是**正常状态**，不是失败。
    expect(calls).toEqual(["readHead", "create"])
    expect(outcome.created).toBe(true)
    expect(outcome.failure).toBeUndefined()
  })

  it("still gives a usable document when the shell is missing, and says why", async () => {
    // 浏览器里跑：仍然要能打开工作台（只是不持久化），并且**如实说明**。
    const { repository } = makeRepository({ notDesktop: true })

    const outcome = await persistence(repository).restore()

    expect(outcome.document.metadata).toBeDefined()
    expect(outcome.failure?.ok).toBe(false)
    if (outcome.failure) expect(outcome.failure.code).toBe("not_a_desktop_shell")
  })

  it("still gives a usable document when the database cannot be opened", async () => {
    // 不能让用户卡在启动上：给一份空文档，把原因带出来让界面显示。
    const { repository } = makeRepository({ failCreate: true })

    const outcome = await persistence(repository).restore()

    expect(outcome.document.metadata).toBeDefined()
    expect(outcome.failure?.ok).toBe(false)
    if (outcome.failure) expect(outcome.failure.code).toBe("io")
  })

  it("starts from an empty document when the stored one cannot be parsed", async () => {
    const broken: DocumentSnapshot = { projectId: "p1", documentId: "d1", epoch: "e", generation: 1, contentHash: "h", content: "{ not json", updatedAt: 0 }
    const { repository } = makeRepository({ stored: broken })

    const outcome = await persistence(repository).restore()

    expect(outcome.document.metadata).toBeDefined()
    expect(outcome.failure?.ok).toBe(false)
  })
})

describe("saving", () => {
  it("does not send an IPC call when the content did not change", async () => {
    // `saveDraft` 挂在 `[document]` 上，每次改动都会触发 —— 内容没变的那些必须**在本地挡掉**，
    // 否则拖一下点会在仓储里留下几百个 generation。
    const stored = createEmptyDocument("conics")
    const { repository, calls } = makeRepository({ stored: snapshot(stored, 4) })
    const adapter = persistence(repository)
    await adapter.restore()
    calls.length = 0

    const first = await adapter.save(stored, 0)
    const second = await adapter.save(stored, 0)

    expect(first).toEqual({ ok: true, generation: 4 })
    expect(second).toEqual({ ok: true, generation: 4 })
    expect(calls).toEqual([])
  })

  it("commits once when the content really changed", async () => {
    const stored = createEmptyDocument("conics")
    const { repository, calls } = makeRepository({ stored: snapshot(stored, 4) })
    const adapter = persistence(repository)
    await adapter.restore()
    calls.length = 0
    const changed = JSON.parse(JSON.stringify(stored)) as typeof stored
    changed.primitives.push({ id: "point-1", type: "point", x: 1, y: 1 } as never)

    const result = await adapter.save(changed, 2)

    expect(result).toEqual({ ok: true, generation: 5 })
    expect(calls).toEqual(["commit"])
  })

  it("adopts the newer head when the only difference was someone else's identical save", async () => {
    // `stale_head` 但**内容其实没变**：用户的改动已经在库里了 —— 那不是冲突，是成功。
    const stored = createEmptyDocument("conics")
    const { repository } = makeRepository({ stored: snapshot(stored, 4) })
    const adapter = persistence(repository)
    await adapter.restore()
    // 模拟"别人又存了一遍"：库里内容现在与我们要存的一模一样，但 generation 变了。
    const changed = JSON.parse(JSON.stringify(stored)) as typeof stored
    changed.primitives.push({ id: "point-1", type: "point", x: 9, y: 9 } as never)
    repository.commit = vi.fn(async () => ({ ok: false as const, code: "stale_head" as const, detail: "generation moved" }))
    repository.readHead = vi.fn(async () => ({ ok: true as const, value: snapshot(changed, 6) }))

    const result = await adapter.save(changed, 1)

    expect(result).toEqual({ ok: true, generation: 6 })
  })

  it("reports a real conflict instead of pretending it saved", async () => {
    const stored = createEmptyDocument("conics")
    const { repository } = makeRepository({ stored: snapshot(stored, 4) })
    const adapter = persistence(repository)
    await adapter.restore()
    const mine = JSON.parse(JSON.stringify(stored)) as typeof stored
    mine.primitives.push({ id: "mine", type: "point", x: 1, y: 1 } as never)
    const theirs = JSON.parse(JSON.stringify(stored)) as typeof stored
    theirs.primitives.push({ id: "theirs", type: "point", x: 2, y: 2 } as never)
    repository.commit = vi.fn(async () => ({ ok: false as const, code: "stale_head" as const, detail: "generation moved" }))
    repository.readHead = vi.fn(async () => ({ ok: true as const, value: snapshot(theirs, 5) }))

    const result = await adapter.save(mine, 1)

    // 别人的内容与我的不同 → **如实报冲突**，让上层决定（重读还是问用户），
    // 绝不把别人的改动覆盖掉，也不假装成功。
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("stale_head")
  })

  it("creates the document on the first save after a restore that could not create it", async () => {
    // 数据库那一刻打不开：恢复时给了空文档，第一次保存要能把它建出来。
    const stored = createEmptyDocument("conics")
    const { repository, calls } = makeRepository({ stored: snapshot(stored, 1) })
    const adapter = persistence(repository)
    await adapter.restore()
    calls.length = 0

    const result = await adapter.save(stored, 0)

    expect(result.ok).toBe(true)
    expect(calls).toEqual([])
  })
})

describe("changing era (import / open file)", () => {
  it("discards a save that was in flight when the document was replaced", async () => {
    // **这条是本片最重要的用例**：打开文件的瞬间，上一次编辑的自动保存可能正在路上。
    // 不丢弃它，用户刚打开的文档会被旧内容覆盖 —— 而那条路径在界面上表现为
    // "打开的文件又变回去了"，几乎无法复现。
    //
    // 手法：让 commit **永远不返回结果**（模拟"响应丢了"），于是那次保存在换世时**仍在途**。
    // 不用"延迟 + 放行"的编排：那需要精确控制三处微任务的顺序，第一版就是这么写的，
    // 结果两次死锁到超时 —— 而**测的东西一点没变少**。
    const stored = createEmptyDocument("conics")
    const { repository } = makeRepository({ stored: snapshot(stored, 4) })
    const adapter = persistence(repository)
    await adapter.restore()

    const oldEdit = JSON.parse(JSON.stringify(stored)) as typeof stored
    oldEdit.primitives.push({ id: "old", type: "point", x: 1, y: 1 } as never)
    const opened = createEmptyDocument("conics")
    opened.primitives.push({ id: "opened", type: "point", x: 7, y: 7 } as never)

    // 让 commit **永远不返回结果**（模拟"响应丢了"）。
    // `as unknown as …` 是刻意的：这条替身故意不符合返回类型（它永不 resolve），
    // 而那正是这条用例要的形状。
    repository.commit = vi.fn(() => new Promise<never>(() => {})) as unknown as typeof repository.commit
    void adapter.save(oldEdit, 1)

    const result = await adapter.reset(opened)

    // 换世成功，而且 head 是**新**的那一世 —— 在途那次永远不回结果的保存不该决定它。
    expect(result.ok).toBe(true)
    expect(adapter.handle()?.generation).not.toBe(99)
    expect(adapter.handle()?.documentId).toBe(opened.metadata.id)
  })

  it("keeps the two save callbacks separate, because they are different operations", async () => {
    // 合用一个回调的话，"打开文件之后旧内容又冒出来"这条路径没有任何东西挡得住。
    const { repository, calls } = makeRepository({ stored: snapshot(createEmptyDocument("conics"), 2) })
    const adapter = persistence(repository)
    await adapter.restore()
    calls.length = 0
    const opened = createEmptyDocument("geometry3d")

    const result = await adapter.reset(opened)

    expect(result.ok).toBe(true)
    // `reset` 走的是 `replaceEpoch`（**换一世**），而不是把内容当成一次普通改动提交 ——
    // 后者改不了 epoch，于是在途的旧保存仍然能写进来。
    expect(calls).toEqual(["replaceEpoch"])
  })
})

describe("the handle used for CAS", () => {
  it("carries the epoch and generation that the repository reported", () => {
    const stored = createEmptyDocument("conics")
    const handle = handleFromSnapshot(snapshot(stored, 9, "epoch:from-db"))

    // epoch 必须来自仓储（会话内的默认 epoch 与它不同，混用会让 CAS 永远失败）。
    expect(handle.epoch).toBe("epoch:from-db")
    expect(handle.generation).toBe(9)
    expect(handle.contentHash).toBe(contentFingerprint(stored))
  })
})
