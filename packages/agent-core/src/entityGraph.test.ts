import { describe, expect, it } from "vitest"
import {
  createEntityGraph,
  declareEntityNode,
  parseEntityGraph,
  resolveEntityScopeAccess,
  serializeEntityGraph,
  transitionEntityStatus
} from "./entityGraph"

describe("entityGraph (Task F3 entity dependency & scope inheritance graph)", () => {
  it("declares, derives, transitions, serializes, and replays entities with sourceRefs and candidateHash", () => {
    let graph = createEntityGraph()
    graph = declareEntityNode(graph, {
      id: "C",
      kind: "conic",
      label: "C",
      scopeId: "shared",
      stateId: "shared",
      sourceRefs: [{ sourceText: "椭圆 C", start: 0, end: 4 }]
    })
    graph = declareEntityNode(graph, {
      id: "F1",
      kind: "focus",
      label: "F₁",
      scopeId: "(1)",
      stateId: "shared",
      hostEntityId: "C",
      sourceRefs: [{ sourceText: "左焦点 F₁", start: 5, end: 11 }]
    })
    graph = transitionEntityStatus(graph, "C", "resolved", { candidateHash: "cand-sha-1" })

    const json = serializeEntityGraph(graph)
    const replayed = parseEntityGraph(json)
    expect(replayed.ok).toBe(true)
    if (!replayed.ok) return
    expect(replayed.value.nodes.C?.status).toBe("resolved")
    expect(replayed.value.nodes.C?.candidateHash).toBe("cand-sha-1")
    expect(replayed.value.nodes.F1?.hostEntityId).toBe("C")
  })

  it("distinguishes shared/parent scope inheritance from unlinked cross-scope violation and repairable placeholders", () => {
    let graph = createEntityGraph()
    graph = declareEntityNode(graph, {
      id: "P",
      kind: "point",
      scopeId: "shared",
      stateId: "shared",
      sourceRefs: [{ sourceText: "点 P", start: 0, end: 3 }]
    })
    graph = declareEntityNode(graph, {
      id: "M",
      kind: "point",
      scopeId: "(1)",
      stateId: "shared",
      sourceRefs: [{ sourceText: "第(1)问动点 M", start: 10, end: 20 }]
    })

    const subqs = [
      { id: "(1)", dependsOn: ["shared"] },
      { id: "(2)", dependsOn: ["shared"] }
    ]

    // Shared -> child scope is accepted immediately.
    const sharedAccess = resolveEntityScopeAccess(graph, {
      entityId: "P",
      consumerScopeId: "(2)",
      subquestions: subqs
    })
    expect(sharedAccess.status).toBe("accepted")

    // Unlinked (1) -> (2) cross-scope without dependsOn is blocked unless an explicit parent link exists.
    const crossScopeBlocked = resolveEntityScopeAccess(graph, {
      entityId: "M",
      consumerScopeId: "(2)",
      subquestions: subqs
    })
    expect(crossScopeBlocked.status).toBe("blocked")

    // Undeclared entity referenced with sourceText can yield a repairable placeholder (never silently valid!).
    const undeclaredPlaceholder = resolveEntityScopeAccess(graph, {
      entityId: "Q",
      consumerScopeId: "(1)",
      subquestions: subqs,
      sourceRefs: [{ sourceText: "交点 Q", start: 21, end: 25 }]
    })
    expect(undeclaredPlaceholder.status).toBe("repairable")
  })
})
