import type { GeometryDocument } from "@draw/dsl"
import type { VerificationCheck, VerificationReport } from "@draw/agent-core"
import type { AgentTaskFixture } from "./agentTaskFixtures"

export interface AgentTaskObservation {
  phase: string
  candidate: GeometryDocument | null
}

function check(fixture: AgentTaskFixture, index: number, observation: AgentTaskObservation): VerificationCheck {
  const condition = fixture.expected.acceptance[index]
  const document = observation.candidate
  const cube = document?.primitives.find((primitive) => primitive.type === "cube")
  const fail = (detail: string): VerificationCheck => ({ id: `${fixture.id}:${index}`, status: "failed", detail })
  const pass = (detail: string): VerificationCheck => ({ id: `${fixture.id}:${index}`, status: "passed", detail })
  const unsupported = (detail: string): VerificationCheck => ({ id: `${fixture.id}:${index}`, status: "not_supported", detail })

  switch (condition.type) {
    case "primitive_exists":
      return document?.primitives.some((primitive) => primitive.type === condition.target) === condition.expected
        ? pass(`primitive existence matches ${condition.target}`) : fail(`missing expected ${condition.target}`)
    case "edge_length": {
      const expected = condition.expected
      if (typeof expected !== "number") return fail("invalid edge-length expectation")
      if (cube?.type === "cube") {
        const dimensions = [cube.size.x, cube.size.y, cube.size.z]
        return dimensions.every((dimension) => Math.abs(dimension - expected) < 1e-7)
          ? pass(`cube edges measure ${condition.expected}`) : fail(`cube dimensions ${dimensions.join(", ")} do not match ${condition.expected}`)
      }
      if (document) {
        const solids = document.primitives.filter((primitive) => primitive.type === "polyhedron3")
        if (solids.length !== 1) return fail("expected one solid with measurable edges")
        const byId = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
        const lengths = solids[0].edgeIds.map((id) => {
          const edge = byId.get(id)
          if (edge?.type !== "edge3") return null
          const a = byId.get(edge.pointIds[0])
          const b = byId.get(edge.pointIds[1])
          if (a?.type !== "point3" || b?.type !== "point3") return null
          return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z)
        })
        if (lengths.length > 0 && lengths.every((length) => length !== null && Math.abs(length - expected) < 1e-7)) {
          return pass(`every solid edge measures ${expected}`)
        }
      }
      return fail("the solid is missing edges or at least one edge has the wrong length")
    }
    case "center": {
      if (cube?.type !== "cube" || condition.expected !== "origin") return fail("the cube or center constraint is missing")
      const center = { x: cube.origin.x + cube.size.x / 2, y: cube.origin.y + cube.size.y / 2, z: cube.origin.z + cube.size.z / 2 }
      return Object.values(center).every((value) => Math.abs(value) < 1e-7)
        ? pass("actual cube center is the origin") : fail(`actual cube center is (${center.x}, ${center.y}, ${center.z})`)
    }
    case "status":
      return condition.expected === "rejected" && observation.phase === "failed" && document === null
        ? pass("invalid geometry was rejected without staging a draft") : fail("invalid geometry was staged or did not fail")
    case "clipped_objects":
    case "label_overlaps":
      return unsupported("no draft-bound render evidence is available to check this visual constraint")
    default:
      return unsupported(`no deterministic judge exists for ${condition.type}`)
  }
}

/** Judge the actual candidate, not model prose or a successful tool-call receipt. */
export function evaluateAgentTask(fixture: AgentTaskFixture, observation: AgentTaskObservation): VerificationReport {
  const checks = fixture.expected.acceptance.map((_, index) => check(fixture, index, observation))
  const status = checks.some((entry) => entry.status === "failed") ? "failed"
    : checks.some((entry) => entry.status === "not_supported") ? "not_supported" : "passed"
  return { status, checks, next_actions: status === "passed" ? [] : checks.filter((entry) => entry.status !== "passed").map((entry) => entry.detail) }
}
