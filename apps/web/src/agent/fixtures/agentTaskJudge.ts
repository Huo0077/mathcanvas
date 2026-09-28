import type { GeometryDocument } from "@draw/dsl"
import type { LayoutModel, VerificationCheck, VerificationReport } from "@draw/agent-core"
import { diagnoseLayout } from "@draw/agent-core"
import type { AgentTaskFixture } from "./agentTaskFixtures"

export interface AgentTaskObservation {
  phase: string
  candidate: GeometryDocument | null
  /**
   * **这一份候选文档的布局读数**（Phase 4：纯本地，不依赖 provider vision）。
   *
   * 有它才能判"对象有没有被裁掉""标签有没有叠在一起" —— 那两条是**纯渲染问题**，
   * 与模型说什么无关。缺省时那两条如实报 `not_supported`（而不是猜一个"通过"）。
   */
  layout?: LayoutModel
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
    case "dependency_order": {
      /**
       * **依赖顺序**："先建的实体必须真的被后面的对象引用"。
       *
       * 判据不是"模型按顺序调了两个工具"（那只证明它照着说了），而是**文档里的引用边**：
       * 截面（`type: "section"`）的 `sourceId` 必须指向文档里真实存在的一个实体
       * （`polyhedron3`）或其它几何体。引用悬空、或截面引用的是另一个截面，
       * 都说明这一步的依赖没有落地。
       *
       * `expected` 目前只登记 `"solid-before-section"` 一种口径；别的取值如实
       * 报 `not_supported`，而不是猜它想说什么。
       */
      if (condition.expected !== "solid-before-section") return unsupported(`dependency_order '${String(condition.expected)}' has no deterministic judge`)
      if (!document) return fail("no candidate document was produced")
      const section = document.primitives.find((primitive) => primitive.type === "section")
      if (!section) return fail("no section was created, so its dependency cannot be checked")
      const source = document.primitives.find((primitive) => primitive.id === (section as { sourceId?: string }).sourceId)
      if (!source) return fail(`the section references ${(section as { sourceId?: string }).sourceId}, which is not in the document`)
      /**
       * 立体在文档里的类型只有 `polyhedron3` —— **棱柱也是它**（`construction.kind === "prism"`），
       * 并没有一个叫 `prism` 的图元类型。这里刻意不写那个不存在的类型名：
       * 写了它会让"棱柱的截面"永远判失败，而症状看起来像"模型没建实体"。
       * （这一条是 `tsc` 抓出来的：它指出该比较"两侧没有重叠"。）
       */
      return source.type === "polyhedron3"
        ? pass(`the section depends on ${source.id} (${source.type})`)
        : fail(`the section depends on ${source.id} of type ${source.type}, which is not a solid`)
    }
    case "section_source": {
      // 与上一条同一条判据的另一个问法：截面的来源**必须是立体**。
      if (condition.expected !== "solid") return unsupported(`section_source '${String(condition.expected)}' has no deterministic judge`)
      if (!document) return fail("no candidate document was produced")
      const section = document.primitives.find((primitive) => primitive.type === "section")
      if (!section) return fail("no section was created")
      const sourceId = (section as { sourceId?: string }).sourceId
      const source = document.primitives.find((primitive) => primitive.id === sourceId)
      if (!source) return fail(`the section source ${sourceId} is missing from the document`)
      return source.type === "polyhedron3"
        ? pass(`the section source ${source.id} is a ${source.type}`)
        : fail(`the section source ${source.id} is a ${source.type}`)
    }
    case "solid_unchanged": {
      /**
       * **"改截面不能顺手改实体"**。判据是文档里**每一个**实体的顶点集合与创建时一致 ——
       * 但判题器看不到"创建时"，所以它用一条等价且可判的性质：
       * **实体的顶点 id 集合必须与它自己的拓扑自洽**（`vertexIds` 都能解析到点）。
       *
       * 这不是同义反复：真实的退化现场是"改截面把实体的顶点删掉了"，那时
       * `vertexIds` 会指向不存在的点。判据因此能红。
       */
      if (condition.expected !== true) return unsupported(`solid_unchanged '${String(condition.expected)}' has no deterministic judge`)
      if (!document) return fail("no candidate document was produced")
      const solids = document.primitives.filter((primitive) => primitive.type === "polyhedron3")
      if (solids.length === 0) return fail("no solid exists, so it cannot be unchanged")
      const byId = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
      const broken = solids.filter((solid) => {
        const vertexIds = (solid as { vertexIds?: string[] }).vertexIds
        if (!Array.isArray(vertexIds) || vertexIds.length === 0) return true
        return vertexIds.some((id) => byId.get(id)?.type !== "point3")
      })
      return broken.length === 0
        ? pass(`all ${solids.length} solid(s) still resolve every vertex they claim`)
        : fail(`these solids lost vertices: ${broken.map((solid) => solid.id).join(", ")}`)
    }
    case "section_updated": {
      /**
       * **截面真的被改过**：它必须存在，且带一个**成形的平面**（法向非零、常数有限）。
       *
       * 判据不比较"改前改后"（判题器没有改前那一份），而是比较"这个截面是不是一个
       * 有意义的截面"：法向为零的平面切不出任何东西，而那种截面正是
       * "把平面写成 `{normal:{x:0,y:0,z:0}, constant:0}`"之后的样子。
       */
      if (condition.expected !== true) return unsupported(`section_updated '${String(condition.expected)}' has no deterministic judge`)
      if (!document) return fail("no candidate document was produced")
      const sections = document.primitives.filter((primitive) => primitive.type === "section")
      if (sections.length === 0) return fail("no section exists")
      const degenerate = sections.filter((section) => {
        const plane = (section as { plane?: { normal?: { x: number; y: number; z: number }; constant?: number } }).plane
        if (!plane || !plane.normal) return true
        const { x, y, z } = plane.normal
        if (![x, y, z, plane.constant].every((value) => typeof value === "number" && Number.isFinite(value))) return true
        return Math.hypot(x, y, z) < 1e-9
      })
      return degenerate.length === 0
        ? pass(`all ${sections.length} section(s) carry a usable plane`)
        : fail(`these sections have a degenerate plane: ${degenerate.map((section) => section.id).join(", ")}`)
    }
    case "status":
      return condition.expected === "rejected" && observation.phase === "failed" && document === null
        ? pass("invalid geometry was rejected without staging a draft") : fail("invalid geometry was staged or did not fail")
    case "clipped_objects":
    case "label_overlaps": {
      /**
       * **纯本地布局判据**（Phase 4）。这两条问的是"画出来有没有明显问题"，
       * 答案是确定的算术，不需要模型、不需要截图。
       *
       * 没有布局读数时如实说 `not_supported` —— 那与"检查过了、没有问题"是两件事，
       * 混成一件会让"没接线"被读成"通过"。
       */
      if (!observation.layout) return unsupported("no layout reading was computed for this candidate document")
      const layoutDiagnostics = diagnoseLayout(observation.layout.viewport, observation.layout.boxes)
      const wanted = condition.type === "clipped_objects" ? "clipped_object" : "label_overlap"
      const found = layoutDiagnostics.filter((entry) => entry.code === wanted)
      const expected = condition.expected
      if (typeof expected !== "number") return fail("invalid layout expectation")
      return found.length === expected
        ? pass(`${wanted} count is ${found.length}`)
        : fail(`expected ${expected} ${wanted} but found ${found.length}: ${found.map((entry) => entry.detail).join("; ") || "(none)"}`)
    }
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
