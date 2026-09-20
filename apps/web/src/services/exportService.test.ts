import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { resolveProjectedDrawing } from "../projectionVisuals"
import { describe, expect, it } from "vitest"

import { buildExportPlan } from "./exportService"

/**
 * Task 0.6 Step 4：**导出预检**（ExportPlan）。
 *
 * 计划要的是"在产出文件**之前**就说清损失"：不支持的来源类型、3D 直接导出、WinAnsi 字符丢失、
 * 不可投影拓扑，全都要显式列出来，而不是等用户拿到一个悄悄缺内容的文件。
 */
function spatialDocument(extra: GeometryDocument["primitives"] = []): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  document.primitives = [
    { id: "point3-1", type: "point3", position: { x: 1, y: 2, z: 3 }, label: "B" },
    { id: "point3-2", type: "point3", position: { x: 4, y: 0, z: 0 }, label: "端点" },
    ...extra
  ]
  return document
}

function firstDrawing(document: GeometryDocument) {
  return resolveProjectedDrawing(document, "front")
}

describe("export preflight", () => {
  it("counts what will actually be projected and names its sources", () => {
    const document = spatialDocument()
    const plan = buildExportPlan({ drawings: [firstDrawing(document)], format: "svg", sourceDocument: document, layoutDocumentId: "layout-1", geometryDocumentId: document.metadata.id })

    expect(plan.supported).toBe(true)
    expect(plan.projectedEntityCount).toBeGreaterThan(0)
    // 计划要求"返回**真实**的投影 id"，而不是只给一个总数。
    expect(plan.projectedEntityIds).toContain("point3-1")
    expect(plan.sourceDocuments).toEqual(["layout-1", document.metadata.id])
  })

  it("marks sources whose type cannot be exported instead of dropping them silently", () => {
    const document = spatialDocument([
      { id: "conn-1", type: "connection", kind: "segment", startPointId: "point3-1", endPointId: "point3-2" },
      { id: "iset-1", type: "intersectionSet", objectA: "point3-1", objectB: "point3-2", points: [] }
    ])
    const plan = buildExportPlan({ drawings: [firstDrawing(document)], format: "dxf", sourceDocument: document, layoutDocumentId: "layout-1", geometryDocumentId: document.metadata.id })

    const omittedIds = plan.omitted.map((entry) => entry.sourceId)
    expect(omittedIds).toContain("conn-1")
    expect(omittedIds).toContain("iset-1")
    expect(plan.omitted[0].reason).toContain("not supported")
    expect(plan.supported).toBe(false)
  })

  it("reports characters that WinAnsi cannot carry and asks for acceptance", () => {
    const document = spatialDocument([{ id: "point3-3", type: "point3", position: { x: 0, y: 0, z: 0 }, label: "中文标签" }])
    const plan = buildExportPlan({ drawings: [firstDrawing(document)], format: "dxf", sourceDocument: document, layoutDocumentId: "layout-1", geometryDocumentId: document.metadata.id })

    expect(plan.fontLoss.length).toBeGreaterThan(0)
    // 按内容查找而不是按下标：损失的顺序跟随文档顺序，钉下标号会让用例对无关改动敏感。
    const loss = plan.fontLoss.find((entry) => entry.original === "中文标签")
    expect(loss).toBeDefined()
    expect(loss?.substituted).not.toBe("中文标签")
    // WinAnsi 装不下中文：替换结果里不该再有中文字符。
    expect(loss?.substituted).toMatch(/^\?+$/)
    expect(plan.requiresUserAcceptance).toBe(true)
  })

  it("refuses a direct 3D raster export instead of pretending it works", () => {
    const document = spatialDocument()
    const plan = buildExportPlan({ drawings: [firstDrawing(document)], format: "png", sourceDocument: document, layoutDocumentId: "layout-1", geometryDocumentId: document.metadata.id })

    expect(plan.supported).toBe(false)
    expect(plan.blockedReasons.join(" ")).toContain("3D")
  })
})
