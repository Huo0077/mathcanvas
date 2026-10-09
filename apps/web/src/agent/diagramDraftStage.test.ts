import { DEFAULT_SOLID_SIZE } from "@draw/agent-core"
import { createEmptyDocument } from "@draw/dsl"
import { createIdAllocator } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { createDraftStore } from "./draftStore"
import { compileInWorker } from "./geometryCompileStrategy"
import { createGeometryWorkerClient } from "./geometryWorkerClient"
import { matchLocalIntent } from "./localPlanner"
import { handleGeometryRequest } from "./workerRuntime"
import { inlineWorker } from "./testing/inlineWorker"

const action = { actionId: "solid.create_polyhedron", actionKey: "tetrahedron", factIds: [], inputs: {
  alias: "tetrahedron", vertexNames: ["A", "B", "C", "D"],
  vertices: [{ x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0.5, y: Math.sqrt(3) / 2, z: 0 }, { x: 1, y: 0, z: 0 }],
  faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]
} } as const

function setup() {
  const store = createDraftStore()
  const draft = store.create(createEmptyDocument("geometry3d"))
  return { store, draft }
}

describe("diagram checks on the real draft staging path", () => {
  it("stores a complete verification report next to the exact candidate being previewed", async () => {
    const { store, draft } = setup()
    const result = await store.stage(draft.draftId, [action] as never, draft.draftVersion, "在三棱锥A-BCD中，BD=2，AB=AD，画示意图")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.diagramVerification?.status).toBe("passed")
    expect(result.preview.diagramVerification?.checks).toHaveLength(2)
    expect(store.getPreview(draft.draftId)?.diagramVerification).toEqual(result.preview.diagramVerification)
  })

  it("retains the original document when a numeric given fails", async () => {
    const { store, draft } = setup()
    const result = await store.stage(draft.draftId, [action] as never, draft.draftVersion, "在三棱锥A-BCD中，BD=3，画示意图")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.diagnostics?.some((item) => item.code === "diagram_condition_failed")).toBe(true)
    expect(store.getPreview(draft.draftId)?.candidate.primitives).toEqual([])
  })

  it("does not drop a passed diagram report when a later stage changes the candidate", async () => {
    const { store, draft } = setup()
    const first = await store.stage(draft.draftId, [action] as never, draft.draftVersion, "在三棱锥A-BCD中，BD=2，画示意图")
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = await store.stage(draft.draftId, [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: {
      alias: "cube", template: "cube", origin: { x: 5, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 }
    } }], first.preview.draftVersion, "再加一个立方体")
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.preview.diagramVerification?.status).toBe("unverified")
  })
  it("produces the same diagram report through a Worker and the in-process fallback", async () => {
    const userMessage = "在三棱锥A-BCD中，BD=2，AB=AD，画示意图"
    const direct = setup()
    const directResult = await direct.store.stage(direct.draft.draftId, [action] as never, direct.draft.draftVersion, userMessage)
    expect(directResult.ok).toBe(true)
    if (!directResult.ok) return

    const client = createGeometryWorkerClient(inlineWorker((request) => handleGeometryRequest(request as never)))
    const workerStore = createDraftStore(createIdAllocator, async ({ plan, document, conversationId, draftVersion, userMessage: prompt }) =>
      compileInWorker(client, { plan, document }, { runId: "worker-run", draftId: conversationId, draftVersion, prompt }))
    const workerDraft = workerStore.create(createEmptyDocument("geometry3d"))
    try {
      const workerResult = await workerStore.stage(workerDraft.draftId, [action] as never, workerDraft.draftVersion, userMessage)
      expect(workerResult.ok).toBe(true)
      if (workerResult.ok) expect(workerResult.preview.diagramVerification).toEqual(directResult.preview.diagramVerification)
    } finally { client.dispose() }
  })
  it("keeps unsupported conditions visible, never labeling them passed", async () => {
    const { store, draft } = setup()
    const result = await store.stage(draft.draftId, [action] as never, draft.draftVersion, "在三棱锥A-BCD中，∠ABC=60°，画示意图")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.preview.diagramVerification?.status).toBe("unverified")
  })

  /**
   * Phase N1：统一 IR 必须**一路不丢**地穿过 `PlanCompiler → DraftStore → Worker`。
   *
   * `diagramDraftStage.test.ts` 已经是两条路并存、且被证明等价的那个文件，所以
   * "IR 在两条路上同形"这条判据放在这里 —— 在第一层（`compilePlan`）断言只能证明
   * 单条路正确，"Worker 那条路丢字段"照样能全绿（这个项目在 `prompt` / 假设 / 关系表上
   * 已经各踩过一次）。
   *
   * **显式打开开关**（控制器裁决 R6）：IR 是"默认关闭的新能力"，所以这里必须由调用方
   * 把 `obligationIR` 传进来，而不是靠缺省值。缺省那条路由下面一条用例守。
   */
  it("carries the unified obligation IR through PlanCompiler, DraftStore and the Worker path once it is switched on", async () => {
    const userMessage = "在三棱锥A-BCD中，BD=2，AB=AD，画示意图"
    const direct = setup()
    const directResult = await direct.store.stage(direct.draft.draftId, [action] as never, direct.draft.draftVersion, userMessage, undefined, true)
    expect(directResult.ok).toBe(true)
    if (!directResult.ok) return
    const ir = directResult.preview.diagramVerification?.obligationIR
    expect(ir?.obligations.map((item) => [item.role, item.kind, item.sourceText])).toEqual([
      ["given", "fixedLength", "BD=2"],
      ["given", "equalLength", "AB=AD"]
    ])
    expect(ir?.obligations.every((item) => item.judgeability === "supported")).toBe(true)
    // 来源区间必须能在原话上原样切回来：IR 出了编译层之后仍然可追溯。
    for (const item of ir?.obligations ?? []) expect(userMessage.slice(item.start, item.end)).toBe(item.sourceText)
    expect(direct.store.getPreview(direct.draft.draftId)?.diagramVerification?.obligationIR).toEqual(ir)

    const client = createGeometryWorkerClient(inlineWorker((request) => handleGeometryRequest(request as never)))
    const workerStore = createDraftStore(createIdAllocator, async ({ plan, document, conversationId, draftVersion, userMessage: prompt, obligationIR }) =>
      compileInWorker(client, { plan, document }, { runId: "worker-run", draftId: conversationId, draftVersion, prompt, obligationIR }))
    const workerDraft = workerStore.create(createEmptyDocument("geometry3d"))
    try {
      const workerResult = await workerStore.stage(workerDraft.draftId, [action] as never, workerDraft.draftVersion, userMessage, undefined, true)
      expect(workerResult.ok).toBe(true)
      if (workerResult.ok) expect(workerResult.preview.diagramVerification).toEqual(directResult.preview.diagramVerification)
    } finally { client.dispose() }
  })

  /**
   * **R6 的核心判据**：不传开关 = 关 = 与改动之前的报告逐字相同。
   *
   * 这条盯的是"新能力默认不生效"，而不是"IR 能不能算出来"。少了它，
   * "缺省 true + 生产调用方不传"这种**事实上的常开**会一路绿灯（正是 R6 要改掉的）。
   */
  it("leaves the diagram report exactly as before when nobody switches the IR on", async () => {
    const { store, draft } = setup()
    const result = await store.stage(draft.draftId, [action] as never, draft.draftVersion, "在三棱锥A-BCD中，BD=2，AB=AD，画示意图")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const report = result.preview.diagramVerification
    expect(report?.checks.map((item) => [item.kind, item.status, item.sourceText])).toEqual([
      ["fixedLength", "passed", "BD=2"],
      ["equalLength", "passed", "AB=AD"]
    ])
    expect(report?.sampleValues).toEqual([])
    expect(report?.status).toBe("passed")
    // 字段本身**不在**：不是"值是 undefined"，而是这份旧形状里没有它。
    expect(Object.keys(report ?? {}).sort()).toEqual(["checks", "sampleValues", "status"])
  })
})

/**
 * **N2 子任务 2c：见证搜索开关一路穿过 `PlanCompiler → DraftStore → Worker`**（裁决 R11 / R37）。
 *
 * 与 N1 的 IR 那条合在同一个文件、同一套理由：这里是"两条编译路并存且被证明等价"的那一份，
 * 而"开关在 Worker 那条路上丢没丢"只有**两条路跑同一份输入**时才看得出来
 * （`prompt` / 假设 / 关系表在这个项目里都各丢过一次）。
 *
 * 这里还钉住 R37② 的一件具体事：草稿那一层的再核验必须对着**真的被物化的那份计划**。
 * 救回路径会替换多面体的坐标**与点名**，所以拿模型的原始动作去重算，报告的结论就会与
 * 候选图不符 —— 救回来的图会被显示成"未核验"甚至"失败"（下面那条两条路等价的用例
 * 用模型的点名顺序 `P,A,B,C,D` 与候选的点名顺序 `A,B,C,D,P` 恰好不同来盯住它）。
 */
describe("the witness-search switch on the real draft staging path", () => {
  /** 用户报障那道四棱锥：P 偏出垂足，模型给的坐标不满足题设。 */
  const SKEWED_PYRAMID = { actionId: "solid.create_polyhedron", actionKey: "pyramid", factIds: [], inputs: {
    alias: "pyramid", vertexNames: ["P", "A", "B", "C", "D"],
    vertices: [{ x: 1, y: 0, z: 4 }, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }],
    faces: [[1, 2, 3, 4], [0, 2, 1], [0, 3, 2], [0, 4, 3], [0, 1, 4]]
  } } as const
  const PYRAMID_PROMPT = "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，BC ∥ AD，AB ⊥ AD，画出这个四棱锥"

  /** 候选文档里那只多面体的顶点坐标（顺序与物化动作的 `vertices` 一致）。 */
  function verticesOf(document: { primitives: readonly { id: string; type: string }[] }): { x: number; y: number; z: number }[] {
    const solid = document.primitives.find((primitive) => primitive.type === "polyhedron3") as { vertexIds: string[] } | undefined
    if (!solid) throw new Error("候选文档里没有多面体")
    return solid.vertexIds.map((id) => {
      const vertex = document.primitives.find((primitive) => primitive.id === id) as { type: string; position: { x: number; y: number; z: number } } | undefined
      if (vertex?.type !== "point3") throw new Error(`顶点 ${id} 不在候选文档里`)
      return vertex.position
    })
  }

  it("keeps the failing candidate and the empty draft when nobody switches the search on", async () => {
    const { store, draft } = setup()

    const result = await store.stage(draft.draftId, [SKEWED_PYRAMID] as never, draft.draftVersion, PYRAMID_PROMPT)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.diagnostics?.some((item) => item.code === "diagram_condition_failed")).toBe(true)
    expect(store.getPreview(draft.draftId)?.candidate.primitives).toEqual([])
  })

  it("rescues the draft and reports the verification the compiler really performed", async () => {
    const { store, draft } = setup()

    const result = await store.stage(draft.draftId, [SKEWED_PYRAMID] as never, draft.draftVersion, PYRAMID_PROMPT, undefined, undefined, true)

    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) return
    /**
     * 草稿层的报告必须与编译层同一份结论。少了"对着被物化的计划重算"这一步，
     * 模型点名的顺序（`P,A,B,C,D`）会套到候选的点名顺序（`A,B,C,D,P`）上 ——
     * 于是这条会变成 `failed` 或 `unverified`，而图明明是对的。
     */
    expect(result.preview.diagramVerification?.status).toBe("passed")
    // "这几个数是系统选的"必须在草稿带的假设里（它就是确认面板上那一列）。
    expect(result.preview.completionAssumptions.map((item) => item.text).join(" ")).toContain("系统自选")
    /**
     * 候选里的 P 在垂足 A 正上方；模型那组（P 偏在 x = 1、z = 4）不许留在草稿里。
     *
     * 顶点顺序是**模型声明的点名顺序**（`P,A,B,C,D`）：救回只换坐标，不重排下标 ——
     * 计划里的 `relations` 用 `v0`、`v1`… 引用顶点，重排会让它们指到别的点上。
     */
    const vertices = verticesOf(result.preview.candidate)
    expect(vertices[0]?.z).toBeGreaterThan(0)
    for (const base of vertices.slice(1)) expect(base?.z).toBeCloseTo(0, 9)
    expect(Math.abs((vertices[0]?.x ?? Number.NaN) - (vertices[1]?.x ?? Number.NaN))).toBeLessThan(1e-9)
    expect(Math.abs((vertices[0]?.y ?? Number.NaN) - (vertices[1]?.y ?? Number.NaN))).toBeLessThan(1e-9)
  })

  /**
   * **S3.4：题面驱动的直棱柱必须能暂存成功，而且关系真的被核验过。**
   *
   * 它此前到不了确认面板，根因在**关系抽取**这一层：抽取器的点名块字母表不含 `′`，
   * 于是 `AA′` 被切成 `AA` ⇒ 读成**自己到自己**的退化线段 ⇒ `AA′ ⊥ 平面ABC` 的 targets
   * 成了 `v0,v0,…`、残差算不出来 ⇒ 判 `relation_not_satisfied`（一次**失败**，不是"未核验"）
   * ⇒ 编译失败 ⇒ 协调器把那唯一一次修复交给模型，而这条关系是**系统从原话抽的**、
   * `envelope.relations` 只是个投影 ⇒ 模型改不动 ⇒ 运行失败 ⇒ 面板永不出现。
   *
   * 这条用例把整条链钉在**产品那一侧**（本地规划器 → 真实暂存路径），
   * 而不是只钉抽取器的一个返回值。
   */
  it("stages the prism sentence and reports a passed relation check instead of a degenerate segment", async () => {
    const { store, draft } = setup()
    const prompt = "在三棱柱ABC-A′B′C′中，AA′⊥平面ABC，画出这个三棱柱"
    const intent = matchLocalIntent(prompt, { enableFreeApex: true })
    expect(intent, "这句题面必须由本地规划器认领").not.toBeNull()
    const envelope = intent!.build({ prompt, size: DEFAULT_SOLID_SIZE })
    expect(envelope.kind).toBe("plan")
    if (envelope.kind !== "plan") return

    // 与运行时同一条口径：`obligationIR` 关、见证搜索开（界面上那个开关就是它）。
    const result = await store.stage(draft.draftId, envelope.actions as never, draft.draftVersion, prompt, envelope.relations, false, true)

    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (result.ok) {
      expect(result.preview.diagramVerification?.status).toBe("passed")
      // 侧棱⊥底面是真的被核验过，不是"没有关系可验"的空报告。
      expect(result.preview.diagramVerification?.checks.some((check) => check.kind === "perpendicular")).toBe(true)
    }
  })

  /**
   * **模型一个点名都没给**（R37① 点名的"点名不可靠"那一半）。
   *
   * 第一遍的核验结论是 `unverified`（`candidatePoints` 缺点名表就返回 `null`）—— 计划本身
   * 是放行的，但图从未被核验过。救回路径这时要把候选的点名补上，于是：
   * ① 草稿层的再核验必须对着 `materialisedActions`（带点名的那一份），否则它拿到的
   *    还是没有点名表的动作，结论会退回 `unverified`（编译器说通过、草稿层说未核验）；
   * ② 计划里若有 `v0`、`v1`… 的下标关系，就不许猜顺序 —— 这条用例刻意**不带** relations，
   *    所以补点名是安全的（另一半由 `planCompiler.test.ts` 的替换纪律守）。
   */
  it("rescues a candidate that declared no vertex names, and keeps the draft-layer report truthful", async () => {
    const { store, draft } = setup()
    const nameless = { actionId: "solid.create_polyhedron", actionKey: "pyramid", factIds: [], inputs: {
      alias: "pyramid",
      vertices: [{ x: 1, y: 0, z: 4 }, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }],
      faces: [[1, 2, 3, 4], [0, 2, 1], [0, 3, 2], [0, 4, 3], [0, 1, 4]]
    } } as const

    const result = await store.stage(draft.draftId, [nameless] as never, draft.draftVersion, PYRAMID_PROMPT, undefined, undefined, true)

    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) return
    expect(result.preview.diagramVerification?.status).toBe("passed")
    expect(result.preview.completionAssumptions.map((item) => item.text).join(" ")).toContain("系统自选")
  })

  it("produces the same rescued draft and report through the Worker and the in-process path", async () => {
    const direct = setup()
    const directResult = await direct.store.stage(direct.draft.draftId, [SKEWED_PYRAMID] as never, direct.draft.draftVersion, PYRAMID_PROMPT, undefined, undefined, true)
    expect(directResult.ok, JSON.stringify(directResult)).toBe(true)
    if (!directResult.ok) return

    const client = createGeometryWorkerClient(inlineWorker((request) => handleGeometryRequest(request as never)))
    const workerStore = createDraftStore(createIdAllocator, async ({ plan, document, conversationId, draftVersion, userMessage: prompt, witnessSearch }) =>
      compileInWorker(client, { plan, document }, { runId: "worker-run", draftId: conversationId, draftVersion, prompt, witnessSearch }))
    const workerDraft = workerStore.create(createEmptyDocument("geometry3d"))
    try {
      const workerResult = await workerStore.stage(workerDraft.draftId, [SKEWED_PYRAMID] as never, workerDraft.draftVersion, PYRAMID_PROMPT, undefined, undefined, true)
      expect(workerResult.ok, JSON.stringify(workerResult)).toBe(true)
      if (!workerResult.ok) return
      expect(workerResult.preview.diagramVerification).toEqual(directResult.preview.diagramVerification)
      expect(workerResult.preview.completionAssumptions).toEqual(directResult.preview.completionAssumptions)
      /**
       * 候选图形本身必须逐字相同 —— 比的是 `primitives`（图元 id / 类型 / 坐标 / 构造），
       * 而不是整份文档：两条路各自 `createEmptyDocument` 一次，文档 id 与时间戳天然不同，
       * 拿整份文档比只会得到一条与行为无关的假失败。
       */
      expect(workerResult.preview.candidate.primitives).toEqual(directResult.preview.candidate.primitives)
    } finally { client.dispose() }
  })

  it("leaves the failing candidate alone through the Worker too when the switch is off", async () => {
    const client = createGeometryWorkerClient(inlineWorker((request) => handleGeometryRequest(request as never)))
    const workerStore = createDraftStore(createIdAllocator, async ({ plan, document, conversationId, draftVersion, userMessage: prompt, witnessSearch }) =>
      compileInWorker(client, { plan, document }, { runId: "worker-run", draftId: conversationId, draftVersion, prompt, witnessSearch }))
    const workerDraft = workerStore.create(createEmptyDocument("geometry3d"))
    try {
      const result = await workerStore.stage(workerDraft.draftId, [SKEWED_PYRAMID] as never, workerDraft.draftVersion, PYRAMID_PROMPT)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.diagnostics?.some((item) => item.code === "diagram_condition_failed")).toBe(true)
      expect(workerStore.getPreview(workerDraft.draftId)?.candidate.primitives).toEqual([])
    } finally { client.dispose() }
  })
})


describe("V0a real draft and Worker boundaries", () => {
  const action = { actionId: "solid.create_polyhedron", actionKey: "free-apex", factIds: [], inputs: {
    alias: "free-apex", vertexNames: ["D", "A", "B", "C"],
    vertices: [{ x: 1, y: 0, z: 2 }, { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 1, y: 2, z: 0 }],
    faces: [[1, 2, 3], [0, 2, 1], [0, 3, 2], [0, 1, 3]]
  } } as const
  const prompt = "在三棱锥D-ABC中，AD⊥平面ABC，自由点D，画示意图"

  it("stages the same genuinely reverified free-apex diagram in-process and through the Worker", async () => {
    const direct = setup()
    const first = await direct.store.stage(direct.draft.draftId, [action] as never, direct.draft.draftVersion, prompt, undefined, true, true)
    expect(first.ok, JSON.stringify(first)).toBe(true)
    if (!first.ok) return
    expect(first.preview.diagramVerification?.status).toBe("passed")
    expect(first.preview.diagramVerification?.sampleValues.join(" ")).toContain("自由点 D")
    expect(first.preview.completionAssumptions.map((item) => item.text).join(" ")).toContain("系统自选")
    expect(first.preview.candidate.primitives.some((item) => item.type === "polyhedron3")).toBe(true)

    const client = createGeometryWorkerClient(inlineWorker((request) => handleGeometryRequest(request as never)))
    const store = createDraftStore(createIdAllocator, async ({ plan, document, conversationId, draftVersion, userMessage, obligationIR, witnessSearch }) =>
      compileInWorker(client, { plan, document }, { runId: "worker-run", draftId: conversationId, draftVersion, prompt: userMessage, obligationIR, witnessSearch }))
    const secondDraft = store.create(createEmptyDocument("geometry3d"))
    try {
      const second = await store.stage(secondDraft.draftId, [action] as never, secondDraft.draftVersion, prompt, undefined, true, true)
      expect(second.ok, JSON.stringify(second)).toBe(true)
      if (!second.ok) return
      expect(second.preview.diagramVerification).toEqual(first.preview.diagramVerification)
      expect(second.preview.candidate.primitives).toEqual(first.preview.candidate.primitives)
    } finally { client.dispose() }
  })

  it("does not stage a solid that is perpendicular but contradicts named original coordinates", async () => {
    const { store, draft } = setup()
    const wrong = { ...action, inputs: { ...action.inputs, vertices: [
      { x: 1, y: 0, z: 2 }, { x: 1, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 1, y: 2, z: 0 }
    ] } }
    const input = "在三棱锥D-ABC中，A=(0,0,0)，B=(3,0,0)，C=(1,2,0)，AD⊥平面ABC，画示意图"
    const result = await store.stage(draft.draftId, [wrong] as never, draft.draftVersion, input, undefined, true, true)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.diagnostics?.some((item) => item.code === "diagram_condition_failed" && item.message.includes("A=(0,0,0)"))).toBe(true)
    expect(store.getPreview(draft.draftId)?.candidate.primitives).toEqual([])
  })
})
