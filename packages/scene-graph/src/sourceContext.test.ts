import { createEmptyDocument } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"
import { describe, expect, it } from "vitest"

import { createDocumentHandle, resolveSourceEntity, type SourceContext } from "./sourceContext"

/**
 * Task 0.6：**作用域来源上下文**。
 *
 * 要固化的真实缺陷：投影结果里的 `ProjectedPrimitive` 只带 `sourceId`（如 `point3-1`），
 * **没有 `documentId`** —— 于是 CAD 布局文档与几何文档里一旦出现同名 id，
 * 显示、选择、标注、导出都无法说清"这个点来自哪一份文档"。
 * 名称不是 ID，跨文档对象只能作为**已授权读取来源**（设计规格 §6）。
 */
describe("scoped source context", () => {
  function sourceDocuments() {
    const layout = createEmptyDocument("cad")
    const geometry = createEmptyDocument("geometry3d")
    // 模板实体必须带**真实物化拓扑**：`cube-1-point-1` 这类子 id 是它生成出来的，
    // 只写一个 `{type:"cube"}` 是查不到的（第一版测试就是这么写错的）。
    const cube = { id: "cube-1", type: "cube" as const, origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } }
    const built = buildSolidTemplate(cube)
    // 两份文档里放**同名** id：这正是"必须保持可区分"的用例。
    geometry.primitives = [
      { id: "point3-1", type: "point3", position: { x: 1, y: 2, z: 3 }, label: "空间点" },
      cube,
      ...built.primitives
    ]
    layout.primitives = [{ id: "point3-1", type: "point3", position: { x: 9, y: 9, z: 9 }, label: "图纸里的同名点" }]
    return { layout, geometry }
  }

  it("keeps same-name ids in two documents distinct", () => {
    const { layout, geometry } = sourceDocuments()
    const context: SourceContext = { layout: createDocumentHandle(layout, "project-1"), geometry: createDocumentHandle(geometry, "project-1"), viewId: "front" }

    const fromGeometry = resolveSourceEntity(context, { documentId: geometry.metadata.id, entityId: "point3-1" }, { layout, geometry })
    const fromLayout = resolveSourceEntity(context, { documentId: layout.metadata.id, entityId: "point3-1" }, { layout, geometry })

    expect(fromGeometry.ok).toBe(true)
    expect(fromLayout.ok).toBe(true)
    if (fromGeometry.ok && fromLayout.ok) {
      // 同名但不同源：几何与位置都必须来自各自的文档。
      expect(fromGeometry.entity.kind).toBe("primitive")
      expect(fromLayout.entity.kind).toBe("primitive")
      if (fromGeometry.entity.kind === "primitive" && fromLayout.entity.kind === "primitive") {
        expect(fromGeometry.entity.primitive).toMatchObject({ position: { x: 1, y: 2, z: 3 } })
        expect(fromLayout.entity.primitive).toMatchObject({ position: { x: 9, y: 9, z: 9 } })
      }
      expect(fromGeometry.handle.documentId).not.toBe(fromLayout.handle.documentId)
    }
  })

  it("resolves a generated topology child to its owning solid", () => {
    const { layout, geometry } = sourceDocuments()
    const context: SourceContext = { layout: createDocumentHandle(layout, "project-1"), geometry: createDocumentHandle(geometry, "project-1") }

    // `cube-1-point-1` 这类顶点是模板物化出来的：单独查不到，但必须能追溯到所属实体。
    const child = resolveSourceEntity(context, { documentId: geometry.metadata.id, entityId: "cube-1-point-1" }, { layout, geometry })

    expect(child.ok).toBe(true)
    if (child.ok && child.entity.kind === "generated") {
      expect(child.entity.ownerId).toBe("cube-1")
      expect(child.entity.childId).toBe("cube-1-point-1")
    }
  })

  it("rejects an entity that is not in the scoped context, with a reason", () => {
    const { layout, geometry } = sourceDocuments()
    const context: SourceContext = { layout: createDocumentHandle(layout, "project-1"), geometry: createDocumentHandle(geometry, "project-1") }

    // 一个不在上下文里的文档 id：不能"静默回退到当前文档"。
    const foreign = resolveSourceEntity(context, { documentId: "some-other-document", entityId: "point3-1" }, { layout, geometry })
    expect(foreign.ok).toBe(false)
    if (!foreign.ok) expect(foreign.reason).toBe("document_not_in_context")

    const missing = resolveSourceEntity(context, { documentId: geometry.metadata.id, entityId: "ghost" }, { layout, geometry })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.reason).toBe("entity_not_found")
  })

  it("treats a stale content hash as unavailable instead of falling back silently", () => {
    const { layout, geometry } = sourceDocuments()
    const context: SourceContext = { layout: createDocumentHandle(layout, "project-1"), geometry: createDocumentHandle(geometry, "project-1") }

    // 文档在拿到句柄之后被改过：句柄的内容哈希不再匹配，来源必须被判为不可用。
    const edited = { ...geometry, primitives: [...geometry.primitives, { id: "point3-2", type: "point3" as const, position: { x: 0, y: 0, z: 0 } }] }
    const stale = resolveSourceEntity(context, { documentId: geometry.metadata.id, entityId: "point3-1" }, { layout, geometry: edited })

    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.reason).toBe("stale_source")
  })

  it("produces a stable handle for the same content", () => {
    const document = createEmptyDocument("geometry3d")
    const first = createDocumentHandle(document, "project-1")
    const second = createDocumentHandle(document, "project-1")

    expect(first.contentHash).toBe(second.contentHash)
    expect(first.workspace).toBe("geometry3d")
    expect(first.documentId).toBe(document.metadata.id)
  })
})
