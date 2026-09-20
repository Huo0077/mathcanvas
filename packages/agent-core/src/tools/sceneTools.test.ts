import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import type { DocumentHandle } from "../contracts"
import { createSceneObservation, type SceneDocumentSnapshot } from "../sceneObservation"
import { createSceneTools } from "./sceneTools"

/**
 * Task 2.4 Step 2 点名的几条：**ambiguous label resolution**、**missing source document**。
 */
function document(workspace: GeometryDocument["workspace"], primitives: unknown[]): GeometryDocument {
  return { ...createEmptyDocument(workspace), primitives } as unknown as GeometryDocument
}

function snapshot(value: GeometryDocument, id = value.metadata.id): SceneDocumentSnapshot {
  const handle: DocumentHandle = { projectId: "p", documentId: id, workspace: value.workspace as DocumentHandle["workspace"], epoch: `epoch:${id}`, generation: value.revision, contentHash: contentFingerprint(value) }
  return { handle, document: value }
}

const duplicated = document("conics", [
  { id: "point-1", type: "point", x: 0, y: 0, label: "点 A" },
  { id: "point-2", type: "point", x: 1, y: 0, label: "点 A" },
  { id: "point-3", type: "point", x: 2, y: 0, label: "点 B" }
])

describe("observation tools", () => {
  it("returns the document id in the summary so two documents stay distinguishable", () => {
    const tools = createSceneTools(createSceneObservation([snapshot(duplicated)]))

    const result = tools.inspect(duplicated.metadata.id)

    expect(result.status).toBe("warning") // 因为标签重名，状态降为警告
    expect(result.summary).toContain(duplicated.metadata.id)
    expect(result.payload).toHaveLength(3)
  })

  it("turns a missing document into a typed error with a next action", () => {
    const tools = createSceneTools(createSceneObservation([snapshot(duplicated)]))

    const result = tools.inspect("doc-not-in-scope")

    expect(result.status).toBe("error")
    expect(result.diagnostics[0].code).toBe("document_not_in_context")
    // 只说"失败了"会让模型重复同一次调用；必须给出下一步。
    expect(result.next_actions.length).toBeGreaterThan(0)
  })

  it("points at search when describe is given unknown ids", () => {
    const tools = createSceneTools(createSceneObservation([snapshot(duplicated)]))

    const result = tools.describeEntities(duplicated.metadata.id, ["point-gone"])

    expect(result.status).toBe("error")
    expect(result.diagnostics[0].code).toBe("entity_not_found")
    expect(result.next_actions.join(" ")).toContain("search_entities")
  })
})

describe("ambiguous labels are never guessed", () => {
  it("returns every candidate instead of picking one", () => {
    const tools = createSceneTools(createSceneObservation([snapshot(duplicated)]))

    const result = tools.resolveLabel(duplicated.metadata.id, "点 A")

    expect(result.status).toBe("warning")
    expect(result.payload).toBeNull()
    const diagnostic = result.diagnostics.find((entry) => entry.code === "ambiguous_label")
    expect(diagnostic).toBeTruthy()
    // 候选必须**列全**：只说"有重名"没法消歧。
    expect(diagnostic?.message).toContain("point-1")
    expect(diagnostic?.message).toContain("point-2")
    expect(result.next_actions.join(" ")).toContain("ask the user")
  })

  it("resolves a label that is unique", () => {
    const tools = createSceneTools(createSceneObservation([snapshot(duplicated)]))

    const result = tools.resolveLabel(duplicated.metadata.id, "点 B")

    expect(result.status).toBe("success")
    expect(result.payload).toMatchObject({ entityId: "point-3" })
  })

  it("reports an unknown label as not found rather than as ambiguous", () => {
    const tools = createSceneTools(createSceneObservation([snapshot(duplicated)]))

    const result = tools.resolveLabel(duplicated.metadata.id, "点 Z")

    expect(result.status).toBe("error")
    expect(result.diagnostics[0].code).toBe("entity_not_found")
  })

  it("keeps document failures distinct from label failures", () => {
    // 缺文档与"标签找不到"是两回事：前者要检查作用域，后者要换一个名字。
    const tools = createSceneTools(createSceneObservation([snapshot(duplicated)]))

    const result = tools.resolveLabel("doc-not-in-scope", "点 A")

    expect(result.diagnostics[0].code).toBe("document_not_in_context")
    expect(result.next_actions.join(" ")).toContain("scoped")
  })

  it("does not treat an empty label as a match for everything", () => {
    const tools = createSceneTools(createSceneObservation([snapshot(duplicated)]))

    const result = tools.resolveLabel(duplicated.metadata.id, "   ")

    expect(result.status).toBe("error")
    expect(result.payload).toBeNull()
  })
})
