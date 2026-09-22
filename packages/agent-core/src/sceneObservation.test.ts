import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { buildPrism, buildSolidTemplate, createBuilderContext } from "@draw/geometry-kernel"
import { contentFingerprint } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import type { DocumentHandle } from "./contracts"
import { createSceneObservation, DEFAULT_DERIVED_STATUS_LIMIT, DEFAULT_ENVELOPE_LIMIT, MAX_DERIVED_STATUS_LIMIT, MAX_ENVELOPE_LIMIT, type SceneDocumentSnapshot } from "./sceneObservation"

/**
 * Task 2.2 Step 1 点名的场景，逐条落在这里：
 * document scoping、duplicate labels、hidden tessellation omission、stale summary rejection、pagination。
 *
 * 这些不是"工具的礼貌"，而是**模型看错的来源**：一份没标明文档来源的合并列表、
 * 一个重名标签、一批内部近似顶点，都会让模型对着不存在的东西下判断。
 */
function handleFor(document: GeometryDocument, id = document.metadata.id): DocumentHandle {
  // `DocumentHandle.workspace` 只收三个 Agent 工作区；夹具文档可能落在别的（例如 calculus）。
  return { projectId: "p", documentId: id, workspace: document.workspace as DocumentHandle["workspace"], epoch: `epoch:${id}`, generation: document.revision, contentHash: contentHash(document) }
}

/** 与句柄里 `contentHash` 的**同一份**规则（`createDocumentHandle` 用的就是它）。 */
function contentHash(document: GeometryDocument): string {
  return contentFingerprint(document)
}

function snapshot(document: GeometryDocument, id?: string): SceneDocumentSnapshot {
  return { handle: handleFor(document, id), document }
}

/**
 * 夹具只喂观察逻辑，不需要通过整份文档的 schema 校验（`validateDocument` 另有测试）。
 * 用一次显式断言把"我知道这些图元字段不全"写在类型层，而不是给每个夹具补全无关字段。
 */
function docWith(workspace: GeometryDocument["workspace"], primitives: unknown[]): GeometryDocument {
  return { ...createEmptyDocument(workspace), primitives } as unknown as GeometryDocument
}

const layout = { ...createEmptyDocument("cad"), primitives: [{ id: "point3-1", type: "point3" as const, position: { x: 0, y: 0, z: 0 }, label: "点 A" }] }
const spatial = { ...createEmptyDocument("geometry3d"), primitives: [{ id: "point3-1", type: "point3" as const, position: { x: 9, y: 9, z: 9 }, label: "空间点 A" }] }

describe("scene observation scoping", () => {
  it("resolves the same id differently per document instead of merging them", () => {
    // 两份文档都有 point3-1：这正是 `SourceContext` 要解决的场景。合并列表会让模型说错文档的事。
    const observation = createSceneObservation([snapshot(layout), snapshot(spatial)])

    const inLayout = observation.inspect(layout.metadata.id)
    const inSpatial = observation.inspect(spatial.metadata.id)

    expect(inLayout.ok).toBe(true)
    expect(inSpatial.ok).toBe(true)
    if (!inLayout.ok || !inSpatial.ok) throw new Error("expected both documents to resolve")
    expect(inLayout.result.payload[0].label).toBe("点 A")
    expect(inSpatial.result.payload[0].label).toBe("空间点 A")
    expect(inLayout.result.payload[0].documentId).not.toBe(inSpatial.result.payload[0].documentId)
  })

  it("refuses a document that is not part of the observation", () => {
    const observation = createSceneObservation([snapshot(layout)])

    const result = observation.inspect("doc-nowhere")

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("document_not_in_context")
  })

  it("rejects a stale snapshot instead of answering from the current content", () => {
    // 句柄是旧的、内容已经变了 → 必须报过期，绝不静默按当前内容回答。
    const stale = { handle: handleFor(layout), document: { ...layout, primitives: [...layout.primitives, { id: "point3-2", type: "point3" as const, position: { x: 1, y: 0, z: 0 } }] } }
    const observation = createSceneObservation([stale])

    const result = observation.inspect(layout.metadata.id)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("stale_source")
  })
})

describe("scene observation hygiene", () => {
  it("reports duplicate labels instead of letting the model pick one silently", () => {
    const document = {
      ...createEmptyDocument("conics"),
      primitives: [
        { id: "point-1", type: "point" as const, x: 0, y: 0, label: "点 A" },
        { id: "point-2", type: "point" as const, x: 1, y: 0, label: "点 A" }
      ]
    }
    const observation = createSceneObservation([snapshot(document)])

    const result = observation.inspect(document.metadata.id)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a result")
    const diagnostic = result.result.diagnostics.find((entry) => entry.code === "duplicate_label")
    expect(diagnostic).toBeTruthy()
    // 诊断里要列出**具体是哪几个 id**，否则模型知道重名也没法消歧。
    expect(diagnostic?.message).toContain("point-1")
    expect(diagnostic?.message).toContain("point-2")
    expect(result.result.status).toBe("warning")
  })

  it("omits tessellation detail so a 48-segment cylinder does not look like 88 user points", () => {
    const document = docWith("geometry3d", [
      { id: "point3-user", type: "point3", position: { x: 0, y: 0, z: 0 }, label: "用户点" },
      { id: "point3-tess", type: "point3", position: { x: 1, y: 0, z: 0 }, tessellation: true },
      { id: "edge3-tess", type: "edge3", startId: "point3-user", endId: "point3-tess", tessellation: true }
    ])
    const observation = createSceneObservation([snapshot(document)])

    const result = observation.inspect(document.metadata.id)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a result")
    expect(result.result.payload.map((entity) => entity.entityId)).toEqual(["point3-user"])
  })

  it("refuses to describe a tessellation entity even when its id is known", () => {
    const document = { ...createEmptyDocument("geometry3d"), primitives: [{ id: "point3-tess", type: "point3" as const, position: { x: 1, y: 0, z: 0 }, tessellation: true }] }
    const observation = createSceneObservation([snapshot(document)])

    const result = observation.describe(document.metadata.id, ["point3-tess"])

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("entity_not_found")
  })

  it("marks hidden and locked objects instead of dropping the information", () => {
    const document = {
      ...createEmptyDocument("conics"),
      primitives: [
        { id: "point-1", type: "point" as const, x: 0, y: 0, label: "A", visible: false },
        { id: "point-2", type: "point" as const, x: 1, y: 0, label: "B", locked: true },
        { id: "ix-1", type: "intersection" as const, lineA: "point-1", lineB: "point-2", x: 0.5, y: 0, label: "交点" }
      ]
    }
    const observation = createSceneObservation([snapshot(document)])

    const result = observation.inspect(document.metadata.id)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a result")
    const byId = Object.fromEntries(result.result.payload.map((entity) => [entity.entityId, entity]))
    expect(byId["point-1"].visible).toBe(false)
    expect(byId["point-2"].locked).toBe(true)
    // 派生对象要标出来：模型不能建议"拖动这个交点"。
    expect(byId["ix-1"].derived).toBe(true)
  })
})

describe("scene observation pagination", () => {
  it("clamps the limit and says when it truncated", () => {
    const document = { ...createEmptyDocument("conics"), primitives: Array.from({ length: MAX_ENVELOPE_LIMIT + 5 }, (_, index) => ({ id: `point-${index}`, type: "point" as const, x: index, y: 0 })) }
    const observation = createSceneObservation([snapshot(document)])

    const result = observation.inspect(document.metadata.id, { limit: 999 })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a result")
    // 上限被夹紧；截断**必须说出来**，否则模型会以为"场景里就这些对象"。
    expect(result.result.payload).toHaveLength(MAX_ENVELOPE_LIMIT)
    expect(result.result.diagnostics.some((entry) => entry.code === "truncated")).toBe(true)
  })

  it("uses a sane default page size", () => {
    const document = { ...createEmptyDocument("conics"), primitives: Array.from({ length: 30 }, (_, index) => ({ id: `point-${index}`, type: "point" as const, x: index, y: 0 })) }
    const observation = createSceneObservation([snapshot(document)])

    const result = observation.inspect(document.metadata.id)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a result")
    expect(result.result.payload).toHaveLength(DEFAULT_ENVELOPE_LIMIT)
  })

  it("refuses to turn an empty search into a full dump", () => {
    const document = { ...createEmptyDocument("conics"), primitives: Array.from({ length: 30 }, (_, index) => ({ id: `point-${index}`, type: "point" as const, x: index, y: 0 })) }
    const observation = createSceneObservation([snapshot(document)])

    const result = observation.search(document.metadata.id, "   ")

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a result")
    // 空查询返回空 + 诊断：否则它就绕过了分页上限。
    expect(result.result.payload).toHaveLength(0)
    expect(result.result.diagnostics.some((entry) => entry.code === "empty_query")).toBe(true)
  })

  it("searches by label, id and kind", () => {
    const document = { ...createEmptyDocument("conics"), primitives: [
      { id: "point-1", type: "point" as const, x: 0, y: 0, label: "点 A" },
      { id: "circle-1", type: "circle" as const, center: { x: 0, y: 0 }, radius: 2, label: "圆 1" }
    ] }
    const observation = createSceneObservation([snapshot(document)])

    expect(observation.search(document.metadata.id, "点 A").ok && true).toBe(true)
    const byLabel = observation.search(document.metadata.id, "圆")
    const byKind = observation.search(document.metadata.id, "circle")
    const byId = observation.search(document.metadata.id, "point-")

    expect(byLabel.ok && byLabel.result.payload.map((entity) => entity.entityId)).toEqual(["circle-1"])
    expect(byKind.ok && byKind.result.payload.map((entity) => entity.entityId)).toEqual(["circle-1"])
    expect(byId.ok && byId.result.payload.map((entity) => entity.entityId)).toEqual(["point-1"])
  })
})

describe("scene observation dependencies", () => {
  it("reports what an object depends on and what depends on it", () => {
    const document = { ...createEmptyDocument("conics"), primitives: [
      { id: "point-1", type: "point" as const, x: 0, y: 0, label: "A" },
      { id: "point-2", type: "point" as const, x: 4, y: 0, label: "B" },
      { id: "conn-1", type: "connection" as const, kind: "segment" as const, startPointId: "point-1", endPointId: "point-2", label: "AB" }
    ] }
    const observation = createSceneObservation([snapshot(document)])

    const connection = observation.dependencies(document.metadata.id, "conn-1")
    const point = observation.dependencies(document.metadata.id, "point-1")

    expect(connection.ok).toBe(true)
    expect(point.ok).toBe(true)
    if (!connection.ok || !point.ok) throw new Error("expected both to resolve")
    expect(connection.result.payload.dependsOn).toEqual(["point-1", "point-2"])
    // 依赖方向要能反向查：删点会连带删掉连线，模型必须知道。
    expect(point.result.payload.referencedBy).toEqual(["conn-1"])
  })

  it("does not mistake labels or expressions for dependencies", () => {
    const document = { ...createEmptyDocument("conics"), primitives: [
      { id: "fn-1", type: "function" as const, expression: "point-1", domain: [-1, 1] as [number, number], samples: 16, label: "point-1" }
    ] }
    const observation = createSceneObservation([snapshot(document)])

    const result = observation.dependencies(document.metadata.id, "fn-1")

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a result")
    // 表达式里的 `point-1` 是字面量、标签也是字面量 —— 都不是引用。
    expect(result.result.payload.dependsOn).toEqual([])
  })

  it("reports a missing entity as a typed failure", () => {
    const document = createEmptyDocument("conics")
    const observation = createSceneObservation([snapshot(document)])

    const result = observation.dependencies(document.metadata.id, "point-gone")

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("entity_not_found")
  })
})

/**
 * **派生立体读数进观察**（规格 §3.4 / §6.2）。
 *
 * 内核那三个求解器返回 `exact / undefined / degenerate / approximate`，但"精确"与"不存在"
 * 只有在真的被**模型看到**之后才有意义 —— 否则模型只能猜一只多面体有没有外接球，
 * 而它猜错的方式恰恰是把 `undefined` 当成一个可以用的球（规格 §10 禁止）。
 *
 * 观察层是模型看场景的**唯一**窗口，所以读数必须从 `solidStatusReport`（内核结论的生产读取）
 * 走这里出去，而不是让 Agent 侧另算一份几何语义（§6.2：schema 不重复实现几何语义）。
 * 同时它必须**有界**：一份画了几十只立体的图纸不能把提示词塞满。
 */
const DERIVED_PRISM_BASE = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }]
const DERIVED_PRISM_VECTOR = { x: 1, y: 0.5, z: 3 }

/** 一只按生产口径建出来的斜棱柱（`buildPrism` 就是 `solid.create_prism` 的内核实现）。 */
function prismFixture(id: string): { document: GeometryDocument; polyhedronId: string } {
  const built = buildPrism({ base: DERIVED_PRISM_BASE, vector: DERIVED_PRISM_VECTOR }, createBuilderContext(id))
  expect(built.diagnostics).toEqual([])
  return { document: docWith("geometry3d", built.primitives), polyhedronId: built.polyhedronId! }
}

/** 一只立方体（唯一有闭式外接球 / 内切球的常见情形）。 */
function cubeFixture(id: string): { document: GeometryDocument; polyhedronId: string } {
  const built = buildSolidTemplate({ id, type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } })
  expect(built.diagnostics).toEqual([])
  return { document: docWith("geometry3d", built.primitives), polyhedronId: built.polyhedronId! }
}

describe("scene observation derived solid readings", () => {
  it("carries the kernel's status and its reason instead of letting the model guess", () => {
    const { document, polyhedronId } = prismFixture("solid-1")
    const observation = createSceneObservation([snapshot(document)])

    const result = observation.derivedStatuses(document.metadata.id)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a result")
    const circumsphere = result.result.payload.find((entry) => entry.entityId === polyhedronId && entry.code === "derived.circumsphere")
    const insphere = result.result.payload.find((entry) => entry.entityId === polyhedronId && entry.code === "derived.insphere")
    // 斜棱柱：一般多面体不一定有外接球 / 内切球，两个都如实报 `undefined`。
    expect(circumsphere?.status).toBe("undefined")
    expect(insphere?.status).toBe("undefined")
    // 原因要跟着一起出去：只给状态码，模型还是不知道为什么"没有球"。
    expect(circumsphere?.message).toContain("外接球")
    expect(insphere?.message).toContain("内切球")
  })

  it("reports an exact reading as exact, so exact and undefined stay distinguishable", () => {
    const { document, polyhedronId } = cubeFixture("cube-1")
    const observation = createSceneObservation([snapshot(document)])

    const result = observation.derivedStatuses(document.metadata.id)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a result")
    const readings = result.result.payload.filter((entry) => entry.entityId === polyhedronId)
    expect(readings.map((entry) => entry.status)).toEqual(["exact", "exact"])
    // `exact` 也要带结论（半径 / 球心），否则模型只能说"有外接球"而说不出是哪一个。
    expect(readings[0]?.message).toMatch(/半径/)
  })

  /**
   * **截面读数要说清自己是哪一刀**（Fix round 1 / M1）。
   *
   * 只带 `entityId`（= 截面的 `sourceId`）时，同一只实体上的两条截面产出两条一模一样的
   * 读数：模型读不出"这个 polygon 是哪条截面的"。`sourceId` 是那条截面图元自己的 id。
   */
  it("says which section each section reading came from", () => {
    const { document, polyhedronId } = prismFixture("solid-1")
    document.primitives = [
      ...document.primitives,
      { id: "section-1", type: "section", sourceId: polyhedronId, plane: { normal: { x: 0, y: 0, z: 1 }, constant: -1.5 }, points: [], classification: "none", status: "undefined" },
      { id: "section-2", type: "section", sourceId: polyhedronId, plane: { normal: { x: 0, y: 0, z: 1 }, constant: -0.5 }, points: [], classification: "none", status: "undefined" }
    ]
    const observation = createSceneObservation([snapshot(document)])

    const result = observation.derivedStatuses(document.metadata.id)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a result")
    const sections = result.result.payload.filter((entry) => entry.code === "derived.section")
    expect(sections.map((entry) => entry.sourceId)).toEqual(["section-1", "section-2"])
    // 球体读数没有"哪条截面"可言：这个字段对它们保持缺省。
    expect(result.result.payload.find((entry) => entry.code === "derived.circumsphere")?.sourceId).toBeUndefined()
  })

  it("bounds the readings and says when it truncated", () => {    const cubes = Array.from({ length: 4 }, (_, index) => cubeFixture(`cube-${index + 1}`))
    const document = docWith("geometry3d", cubes.flatMap((cube) => cube.document.primitives))
    const observation = createSceneObservation([snapshot(document)])

    const result = observation.derivedStatuses(document.metadata.id, { derived: 3 })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a result")
    expect(result.result.payload).toHaveLength(3)
    // 截断**必须说出来**：否则模型会以为"这只立体的派生读数就这些"。
    expect(result.result.diagnostics.some((entry) => entry.code === "truncated")).toBe(true)
  })

  it("clamps an oversized request to the hard limit and uses a sane default", () => {
    const cubes = Array.from({ length: 20 }, (_, index) => cubeFixture(`cube-${index + 1}`))
    const document = docWith("geometry3d", cubes.flatMap((cube) => cube.document.primitives))
    const observation = createSceneObservation([snapshot(document)])

    const clamped = observation.derivedStatuses(document.metadata.id, { derived: 9_999 })
    const byDefault = observation.derivedStatuses(document.metadata.id)

    expect(clamped.ok && clamped.result.payload).toHaveLength(MAX_DERIVED_STATUS_LIMIT)
    expect(byDefault.ok && byDefault.result.payload).toHaveLength(DEFAULT_DERIVED_STATUS_LIMIT)
  })

  it("says nothing about a document with no solid in it", () => {
    const document = docWith("conics", [{ id: "point-1", type: "point", x: 0, y: 0 }])
    const observation = createSceneObservation([snapshot(document)])

    const result = observation.derivedStatuses(document.metadata.id)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected a result")
    expect(result.result.payload).toEqual([])
    expect(result.result.diagnostics).toEqual([])
  })

  it("refuses a stale snapshot instead of reporting readings for the current content", () => {
    const { document } = prismFixture("solid-1")
    const stale = { handle: handleFor(document, "doc-prism"), document: { ...document, primitives: [...document.primitives, { id: "point3-extra", type: "point3" as const, position: { x: 1, y: 0, z: 0 } }] } }
    const observation = createSceneObservation([stale])

    const result = observation.derivedStatuses("doc-prism")

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("stale_source")
  })
})
