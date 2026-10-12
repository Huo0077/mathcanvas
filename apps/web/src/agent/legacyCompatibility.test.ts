import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "@draw/agent-core"
import { createEmptyDocument } from "@draw/dsl"
import { createDocumentHandle } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { planWorkspaces } from "./agentRunner"
import { createDraftStore } from "./draftStore"

/**
 * **Task 1：旧功能兼容基线**（`docs/superpowers/plans/2026-10-11-four-family-agent-upgrade-progress.md`）。
 *
 * ## 这份文件为什么存在，以及它**不**做什么
 *
 * Task 2–21 会动共享合同（动作菜单、预算账本、图形意图、物化、Worker 版本、草稿过期判据）。
 * 那些改动每一条都可能在**旧路径**上留下静默回归，而旧路径的既有用例散在十几个文件里、
 * 各自只盯自己那一格。这里只钉**新旧合同之间那道缝**：新机制引入了什么、旧行为必须因此
 * 保持什么。**它不是旧测试的副本** —— 已经有人守着的合同（`.mgeo` 点名往返、
 * `proofExport` 关旗时预览里没有 `proofAttempt`、`dynamic.*` + 宿主的工作区集合、
 * 任何动作族都不路由到已退役的 `calculus`）在这份文件里**刻意不重复**，
 * 它们由各自的原文件守（`packages/dsl/src/codec.test.ts`、`draftStore.test.ts:366`、
 * `agentRuntime.test.ts:844`、`planWorkspaces.test.ts`）。
 *
 * 两条缝是 2026-10-11 那两批修复**自己带出来**的，而当时都没有用例盯住
 * （见下面各自的说明）。这个文件把它们钉死：新判据的值由谁产生、旧承诺还剩哪一半没被守住。
 */
function planWith(...actionIds: readonly string[]): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "兼容基线用例",
    factIds: [],
    actions: actionIds.map((actionId) => ({ actionId, actionKey: "a", factIds: [], inputs: {} }))
  } as never
}

describe("legacy compatibility: the staleness kind its consumer policy reads", () => {
  /**
   * ## 缝在哪
   *
   * 2026-10-11 现场批次把"草稿为什么过期"从一句给人读的 `detail` 改成了**结构化判据**
   * `FreshnessKind`，因为两条处置完全相反：`epoch`（换了一份文档）与 `generation` / `content`
   * （同一份文档被改过）。
   *
   * ## 为什么当时没人发现它没有被钉住
   *
   * 读这个值的那条策略在 `packages/agent-core/src/committerAdapter.ts:163`：
   * **`runSwitchedWorkspace === true && freshness.kind === "epoch"` 两条同时成立才重建草稿**，
   * 否则如实 `stale_draft`。而 `committerAdapter.test.ts` 的用例**自己 mock 出**
   * `assertFresh` 的返回值（`kind: "epoch"` / `kind: "generation"` 都是手写的）——
   * 也就是说：**策略那一半有判据，产生这个值的那一半没有**。
   * `draftStore.assertFresh` 自己的用例只钉了 `stale.ok === false`（`draftStore.test.ts:150`），
   * 没问过 `kind` 是什么。
   *
   * 后果是双向的、而且都是用户看得见的：
   * - 把 `epoch` 错标成 `generation` ⇒ 修复轮换工作区**又**以 `stale_draft` 失败（现场那个病复发）；
   * - 把 `generation` 错标成 `epoch` ⇒ **用户自己**改文档/导入文件时草稿被**静默重建**，
   *   而那正是"不静默重建"这条纪律要挡住的事。
   *
   * 四类过期在这条用例里各自取值，**任何一次合并或改标都会让对应那一行真红**。
   */
  it("names all four ways a draft goes stale, each distinct, so a rebuild cannot widen by mislabelling", () => {
    const store = createDraftStore()
    const base = createEmptyDocument("conics")
    const handle = createDocumentHandle(base, "project-1")
    const record = store.create(base, handle)

    // 基准：文档一个字节都没动 ⇒ 新鲜。
    expect(store.assertFresh(record.draftId, handle)).toEqual({ ok: true })

    // 同一份文档被**改过**（手工编辑 / 撤销）⇒ generation。**这一条绝不能被当成"可重建"**。
    const edited = store.assertFresh(record.draftId, createDocumentHandle({ ...base, revision: base.revision + 1 }, "project-1"))
    expect(edited).toMatchObject({ ok: false, reason: "stale_source", kind: "generation" })

    // 版本号没动、内容动了（同一世里内容被换掉）⇒ content，**不是** epoch。
    const contentChanged = store.assertFresh(record.draftId, createDocumentHandle({
      ...base, primitives: [{ id: "point-1", type: "point", x: 1, y: 2, label: "A" }]
    } as never, "project-1"))
    expect(contentChanged).toMatchObject({ ok: false, reason: "stale_source", kind: "content" })

    // **换了一份文档**（导入 / 打开文件 / Agent 自己切工作区）⇒ epoch。只有它 + "这一轮自己换的"才允许重建。
    const replaced = store.assertFresh(record.draftId, createDocumentHandle({
      ...base, metadata: { ...base.metadata, id: "doc-imported" }
    }, "project-1"))
    expect(replaced).toMatchObject({ ok: false, reason: "stale_source", kind: "epoch" })

    // 显式丢弃（预检探针 / 用户丢弃）⇒ invalidated。
    store.invalidate(record.draftId, "preflight probe")
    expect(store.assertFresh(record.draftId, handle)).toMatchObject({ ok: false, reason: "stale_source", kind: "invalidated" })

    /**
     * 四个词是**四种处置**，不是一个布尔。把任意两个合并（或让某一类退回 `undefined`）
     * 都会让上面某一行红 —— 这一行把"它们互相不同"单独说清，免得将来有人用
     * "反正都是 stale_source"把其中两类并掉。
     */
    const kinds = [edited, contentChanged, replaced].map((result) => (result.ok ? "ok" : result.kind))
    expect(new Set(kinds).size).toBe(kinds.length)
  })
})

describe("legacy compatibility: neutral actions do not move the user's workspace", () => {
  /**
   * ## 缝在哪
   *
   * 2026-10-10 用户自测报的是"平面与立体不主动区分"：一道圆锥曲线题被画在**立体几何**工作区里。
   * 根因是 `dynamic.*` 这些**中性**动作自己投了一票 `geometry3d`，而 `prepareWorkspaceFor` 三维优先。
   * 修法是让工作区只由**宿主**动作（`planar.*` / `solid.*` / `section.*` / `function.*`）决定。
   *
   * ## 为什么还有一格没被守住
   *
   * `planWorkspaces.test.ts` 钉住了"**有宿主时**集合是对的"（真夹具 `conicInvariantPlan` ⇒ `["conics"]`），
   * 而 `planWorkspaces` 的文档注释还承诺了另一半：**返回空数组表示"这次不需要切"**
   *（只有 `dynamic.*` / `parameter.*` 这类中性动作时，**不动**用户的工作区，比替他猜一个更诚实）。
   * 那一半从来没有用例 —— 而它正是"用户自己挑的工作区不被 Agent 挪走"这条旧承诺。
   */
  it("asks for no switch at all when every action is neutral", () => {
    expect(planWorkspaces(planWith("dynamic.create_bound_point", "dynamic.create_locus"))).toEqual([])
    expect(planWorkspaces(planWith("parameter.create", "parameter.set"))).toEqual([])
  })

  it("still follows the host action, so the neutrality above is not 'always empty'", () => {
    // 中性动作**不投票**，但**宿主**那一票照旧算数 —— 上面那条不是"这个函数永远返回空"。
    expect(planWorkspaces(planWith("dynamic.create_bound_point", "solid.create_prism"))).toEqual(["geometry3d"])
    expect(planWorkspaces(planWith("parameter.create", "planar.create_point"))).toEqual(["conics"])
  })
})
