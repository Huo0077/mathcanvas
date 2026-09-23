import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { createDocumentHandle } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { migrateLegacySolids } from "../solidTemplates"
import { createDraftStore } from "./draftStore"

/**
 * Task 0.7 Step 4：**草稿隔离**。
 *
 * 计划要守的：候选文档在内存里克隆与校验，草稿只保留 draft id + 预览产物，
 * **任何草稿操作都不更新 `useSceneStore`**；consent 与预览哈希绑定、且一次性。
 */
function baseDocument(): GeometryDocument {
  return createEmptyDocument("conics")
}

/** 画布上已经有一个手工/上一轮建好的立方体 `solid-1`（现场里就是这个形状）。 */
function baseWithCube(): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  document.primitives = [{ id: "solid-1", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 }, label: "立方体" }] as never
  return document
}

describe("isolated drafts", () => {
  /**
   * **用户原话必须一路走到审计**（Fix round 1 / C3；规格 §6.3/§8.2）。
   *
   * 三条判据都只看 `compilePlan` 的 `context.prompt`：`isInvariantRequest`（"任意/恒定/定值"
   * 必须保留符号参数）、`infer_from_facts`（从用户原话里读数字）、`verifyPlan` 的
   * "采样不是证明"声明。第一版的生产调用点**都不传它**，于是这三条在真实管线里恒不生效 ——
   * 机制是死的，只有提示词在兜。这里的用例从 `DraftStore.stage` 这条**生产入口**出发。
   */
  it("carries the user's words into the audit so an invariant request asks instead of inventing", () => {
    const store = createDraftStore()
    const base = createEmptyDocument("geometry3d")
    const record = store.create(base)

    const staged = store.stage(record.draftId, [{
      actionId: "solid.create_prism",
      actionKey: "prism",
      factIds: [],
      // 底面与向量都缺：题目说"任意"时**不该**替它取特值。
      inputs: { alias: "prism" }
    }] as unknown as Parameters<typeof store.stage>[1], record.draftVersion, "画一个任意棱柱")

    expect(staged.ok).toBe(false)
    if (!staged.ok) {
      expect(staged.reason).toBe("compile_failed")
      expect(staged.diagnostics?.map((entry) => entry.code)).toContain("needs_concrete_value")
    }
    // 没有半份草稿：候选文档一个图元都没多。
    expect(store.getPreview(record.draftId)?.candidate.primitives).toHaveLength(0)
  })

  it("reads a stated size out of the user's words on the production path", () => {
    const store = createDraftStore()
    const record = store.create(createEmptyDocument("geometry3d"))

    const staged = store.stage(record.draftId, [{
      actionId: "solid.create_template",
      actionKey: "cylinder",
      factIds: [],
      // 高度没给 → `infer_from_facts` 应当从原话里的"高 5"读出来。
      inputs: { alias: "c", template: "cylinder", origin: { x: 0, y: 0, z: 0 }, radius: 2 }
    }], record.draftVersion, "画一个半径 2、高 5 的圆柱")

    expect(staged.ok).toBe(true)
    const cylinder = store.getPreview(record.draftId)?.candidate.primitives.find((primitive) => primitive.type === "cylinder")
    expect(cylinder).toMatchObject({ height: 5 })
  })

  it("commits a pyramid with the base-and-height geometry the document schema expects", () => {
    const store = createDraftStore()
    const record = store.create(createEmptyDocument("geometry3d"))

    const staged = store.stage(record.draftId, [{
      actionId: "solid.create_template",
      actionKey: "pyramid",
      factIds: [],
      inputs: { alias: "p", template: "pyramid", origin: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 3, z: 3 } }
    }], record.draftVersion, "画一个正四棱锥，底面边长 3、高 3")

    // 用户现场：这一条曾经以 `commit_rejected: … pyramid geometry is invalid` 失败，整轮 run_failed。
    // 断言里带上诊断本身：失败时不用再跑一遍才看得到"为什么"。
    expect(staged.ok, staged.ok ? "staged" : `${staged.reason}: ${(staged.diagnostics ?? []).map((entry) => entry.message).join(" / ")}`).toBe(true)
    const pyramid = store.getPreview(record.draftId)?.candidate.primitives.find((primitive) => primitive.type === "pyramid")
    // 棱锥的几何是 `baseCenter` + `baseSize` + `height`（DSL schema / 内核 / 手工添加棱锥三处一致），
    // 不是立方体那套 `origin` + `size`；形状写错时 `validateDocument` 会当场拒掉这条提交。
    expect(pyramid).toMatchObject({ type: "pyramid", baseCenter: { x: 0, y: 0, z: 0 }, baseSize: { x: 3, y: 3 }, height: 3 })
  })

  /**
   * **正四面体**（用户口径："画一个正四面体 ABCD，棱长为 3"）。
   *
   * 走的是**生产路径**：动作 → 编译器 → `validateDocument` → 候选文档。它落进文档的形状必须是
   * 一只 `fromPoints` 多面体 + 四个顶点 / 六条棱 / 四个面（这正是 `validateDocument` 认的形状），
   * 而顶点标签就是用户嘴里的 A / B / C / D。
   */
  it("commits a tetrahedron with the four-vertex geometry the document schema expects", () => {
    const store = createDraftStore()
    const record = store.create(createEmptyDocument("geometry3d"))

    const staged = store.stage(record.draftId, [{
      actionId: "solid.create_tetrahedron",
      actionKey: "tetrahedron",
      factIds: [],
      inputs: { alias: "t", baseCenter: { x: 0, y: 0, z: 0 }, edge: 3 }
    }], record.draftVersion, "画一个正四面体 ABCD，棱长为 3")

    // 断言里带上诊断本身：失败时不用再跑一遍才看得到"为什么"。
    expect(staged.ok, staged.ok ? "staged" : `${staged.reason}: ${(staged.diagnostics ?? []).map((entry) => entry.message).join(" / ")}`).toBe(true)
    const primitives = store.getPreview(record.draftId)?.candidate.primitives ?? []
    const vertices = primitives.filter((primitive) => primitive.type === "point3")
    expect(vertices.map((primitive) => (primitive.type === "point3" ? primitive.label : undefined))).toEqual(["A", "B", "C", "D"])
    expect(primitives.filter((primitive) => primitive.type === "edge3")).toHaveLength(6)
    expect(primitives.filter((primitive) => primitive.type === "face3")).toHaveLength(4)
    // 构造是 `fromPoints`（不是 `template`）：模板迁移因此不会把它当成自己的子对象去改名。
    expect(primitives.find((primitive) => primitive.type === "polyhedron3")).toMatchObject({ construction: { kind: "fromPoints" } })
  })

  it("keeps a draft candidate in memory and never touches the live document", () => {
    const store = createDraftStore()
    const base = baseDocument()
    const record = store.create(base)

    const staged = store.stage(record.draftId, [{ actionId: "planar.create_point", actionKey: "a", factIds: [], inputs: { alias: "p", points: [{ x: 1, y: 2 }] } }], record.draftVersion)

    expect(staged.ok).toBe(true)
    // 关键隔离断言：候选文档里有新点，**基础文档一个字节都没变**。
    const preview = store.getPreview(record.draftId)
    expect(preview?.candidate.primitives).toHaveLength(1)
    expect(base.primitives).toHaveLength(0)
  })

  it("reports a stale draft version instead of overwriting newer staged work", () => {
    const store = createDraftStore()
    const record = store.create(baseDocument())
    store.stage(record.draftId, [{ actionId: "planar.create_point", actionKey: "a", factIds: [], inputs: { alias: "p", points: [{ x: 0, y: 0 }] } }], record.draftVersion)

    // 用**旧版本号**再暂存一次：必须被拒，否则会把新staged 的内容覆盖掉。
    const stale = store.stage(record.draftId, [{ actionId: "planar.create_point", actionKey: "b", factIds: [], inputs: { alias: "q", points: [{ x: 5, y: 5 }] } }], record.draftVersion)

    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.reason).toBe("stale_draft_version")
    expect(store.getPreview(record.draftId)?.candidate.primitives).toHaveLength(1)
  })

  it("invalidates a draft when its base handle no longer matches the live document", () => {
    const store = createDraftStore()
    const base = baseDocument()
    const record = store.create(base, createDocumentHandle(base, "project-1"))

    const stale = store.assertFresh(record.draftId, createDocumentHandle({ ...base, revision: base.revision + 1 }, "project-1"))
    expect(stale.ok).toBe(false)

    store.invalidate(record.draftId, "manual edit")
    expect(store.getPreview(record.draftId)).toBeNull()
  })

  it("refuses to stage an action the compiler rejects, and keeps the draft untouched", () => {
    const store = createDraftStore()
    const record = store.create(baseDocument())

    // 退化线：编译器给诊断 → 草稿不该被改成"半成品"。
    const staged = store.stage(record.draftId, [{ actionId: "planar.create_line", actionKey: "l", factIds: [], inputs: { alias: "l", points: [{ x: 1, y: 1 }, { x: 1, y: 1 }] } }], record.draftVersion)

    expect(staged.ok).toBe(false)
    if (!staged.ok) expect(staged.diagnostics?.[0]?.code).toBe("degenerate_line")
    expect(store.getPreview(record.draftId)?.candidate.primitives).toHaveLength(0)
  })

  /**
   * **编译失败必须把编译器的那一份修复请求交出去**（Agent DSL 切片 Task 4 的接线）。
   *
   * `compilePlan` 一直返回 `{reason, errors(code/path/detail), allowedChanges, attempt}`，
   * 而 `stage` 此前只回一句话（`detail`）—— 协调器于是收不到"允许改哪几处"，
   * 只能自己拿解析错误另造一份（或干脆不再问模型）。这里钉住：**编译器的那一份原样带出**，
   * 连同它的逐层诊断与失败前补出来的假设。
   */
  it("hands the compiler's repair request back on a compile failure", () => {
    const store = createDraftStore()
    const record = store.create(createEmptyDocument("geometry3d"))

    const staged = store.stage(record.draftId, [
      // 动作 0：`vector` 缺失 → 审计回填安全默认（这是"修复请求要带上的假设"）。
      { actionId: "solid.create_prism", actionKey: "prism", factIds: [], inputs: { alias: "prism", basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 1, y: 2, z: 0 }] } },
      // 动作 1：零向量 → 几何语义校验这一层拒。
      { actionId: "solid.create_prism", actionKey: "degenerate", factIds: [], inputs: { alias: "degenerate", basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 1, y: 2, z: 0 }], vector: { x: 0, y: 0, z: 0 } } }
    ] as unknown as Parameters<typeof store.stage>[1], record.draftVersion)

    expect(staged.ok).toBe(false)
    if (staged.ok) return
    expect(staged.reason).toBe("compile_failed")
    expect(staged.repair).toBeDefined()
    expect(staged.repair?.attempt).toBe(1)
    expect(staged.repair?.allowedChanges).toEqual(["envelope.actions[1].inputs.basePolygon"])
    expect(staged.repair?.errors[0]).toMatchObject({ code: "degenerate_prism", path: "envelope.actions[1].inputs.basePolygon" })
    // 逐层诊断（层 + 原因码 + 路径）也要在，而不是被压成一句 detail。
    expect(staged.planDiagnostics?.some((entry) => entry.stage === "geometry_validation" && entry.code === "degenerate_prism" && entry.path === "envelope.actions[1].inputs.basePolygon")).toBe(true)
    // 失败前补出来的假设必须一起带走（"系统替你定了什么"不能丢）。
    expect(staged.assumptions?.map((assumption) => assumption.path)).toContain("envelope.actions[0].inputs.vector")
    // 草稿依然没有半成品。
    expect(store.getPreview(record.draftId)?.candidate.primitives).toHaveLength(0)
  })

  /**
   * **真实现场**（2026-09-21）：画布上已经有一个手工建的立方体 `solid-1`，
   * 随后用户让 Agent 建一个直四棱柱，模型出了一个 `solid.create_template` 动作 ——
   * 分配器从 1 开始数，又发了 `solid-1`，`validatePatch` 判 `duplicate object id`，
   * 运行以 `compile_failed: duplicate object id` 结束（账本 `run-6-mubf109e`）。
   *
   * 手工路径（`App.tsx` 的 `nextPrimitiveId`）**一直是**扫已有 id 取下一个空位的；
   * 只有动作层的分配器不知道文档里有什么 —— 两份实现漂移，Agent 侧就成了必然失败。
   */
  it("stages onto a document that already holds an object of the same kind", () => {
    const store = createDraftStore()
    const base = baseWithCube()
    const record = store.create(base)

    const staged = store.stage(record.draftId, [{ actionId: "solid.create_template", actionKey: "prism", factIds: [], inputs: { alias: "prism", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 3, z: 3 } } }], record.draftVersion)

    expect(staged.ok).toBe(true)
    const ids = store.getPreview(record.draftId)?.candidate.primitives.map((primitive) => primitive.id)
    // 新对象必须另起一个没被占用的 id，而且**已有对象还在**。
    expect(ids).toEqual(["solid-1", "solid-2"])
  })

  /**
   * **恢复之后的文档也必须能起草**（2026-09-21 的第二个真实故障）。
   *
   * 应用启动时会 `migrateLegacySolids`（打开文件 / 恢复草稿都走它），物化出来的子对象带着
   * `style: undefined` / `label: undefined`。此前的规范化哈希把 `undefined` 当垃圾抛出去，
   * 于是"画布上有一个立方体"就成了 Agent 的**必然失败**：
   * `Error: canonicalContentHash: unsupported value of type undefined`（账本里是 `run_failed`）。
   */
  it("stages onto a document that came back from a restore (materialized children)", () => {
    const store = createDraftStore()
    const restored = migrateLegacySolids(baseWithCube())
    const record = store.create(restored)

    const staged = store.stage(record.draftId, [{ actionId: "solid.create_template", actionKey: "second", factIds: [], inputs: { alias: "second", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 3, z: 3 } } }], record.draftVersion)

    expect(staged.ok).toBe(true)
    // 已有的立方体（以及它的子对象）一个都不能丢，新对象另起一个 id。
    const ids = store.getPreview(record.draftId)?.candidate.primitives.map((primitive) => primitive.id) ?? []
    expect(ids).toContain("solid-1")
    expect(ids).toContain("solid-2")
  })

  it("binds a preview hash to the exact staged content", () => {    const store = createDraftStore()
    const record = store.create(baseDocument())
    const before = store.getPreview(record.draftId)!.previewHash

    store.stage(record.draftId, [{ actionId: "planar.create_point", actionKey: "a", factIds: [], inputs: { alias: "p", points: [{ x: 3, y: 4 }] } }], record.draftVersion)
    const after = store.getPreview(record.draftId)!.previewHash

    // 预览哈希必须随内容变化 —— 它是 consent 的绑定对象。
    expect(after).not.toBe(before)
  })

  /**
   * 2026-09-21 修掉的真实缺陷：`previewHash` 曾经填的是 `contentFingerprint(候选文档)`，
   * 而那个函数返回的是**整份候选文档的规范化 JSON 字符串**，不是哈希。
   *
   * 后果有两条，第二条才是真正被用户看到的：
   * 1. 契约里写的是"哈希"（`ConsentRecord.previewHash`、`DraftPreview.previewHash`），
   *    实现给的是一份全文；
   * 2. 确认面板第一版把这个字段直接渲染出来，于是**整份候选文档被打在界面上**
   *    （`ConfirmationPanel.tsx` 里记着这次发现），而这违反"草稿在界面里只是视图"。
   *
   * 这里钉住的是**形状**：64 位十六进制 SHA-256（`canonicalContentHash`），
   * 且**不含**大括号 —— 只要有人把它换回某种"文档字符串"，这两条断言就会红。
   */
  it("binds the preview to a real SHA-256 hash, not to the document's JSON text", () => {
    const store = createDraftStore()
    const record = store.create(baseDocument())
    store.stage(record.draftId, [{ actionId: "planar.create_point", actionKey: "a", factIds: [], inputs: { alias: "p", points: [{ x: 3, y: 4 }] } }], record.draftVersion)

    const previewHash = store.getPreview(record.draftId)!.previewHash

    expect(previewHash).toMatch(/^[0-9a-f]{64}$/)
    expect(previewHash).not.toContain("{")
  })
})