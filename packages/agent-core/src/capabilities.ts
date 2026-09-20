import type { PrimitiveSpec, Workspace } from "@draw/dsl"
import type { DomainOperation } from "@draw/scene-graph"

/**
 * **能力注册表**：Agent 能做什么、不能做什么的单一事实来源。
 *
 * 计划（`docs/superpowers/plans/2026-09-18-desktop-agent-implementation-plan.md` Task 0.1）的硬要求：
 * 把当前 **42 个图元类型**与 **38 个 `DomainOperation` 变体**全部映射到"可用处理器"或**显式阻止状态**。
 *
 * 三条纪律：
 * 1. 可用性**只能来自这张签入的描述符表**，不许从模型回答或界面标签里推断；
 * 2. 没有行动处理器的类型写成 `temporarily_unavailable`，**不许装作可用**（计划 Global Constraints）；
 * 3. 两个方向的漂移都在**编译期**被拦住（见下面两处 `satisfies`），不靠"记得同步"。
 */

export const CAPABILITY_STATUSES = ["available", "unsupported", "legacy_readonly", "temporarily_unavailable", "diagnosis_only"] as const

export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number]

export interface CapabilityDescriptor {
  id: string
  status: CapabilityStatus
  workspaces: Workspace[]
  preconditions: string[]
  /** 覆盖它的测试，供后续"能力—测试"对账。 */
  testIds: string[]
  registryRevision: string
}

export interface CapabilityRegistry {
  capabilities: CapabilityDescriptor[]
  byId: Record<string, CapabilityDescriptor>
  /** 每个图元类型 → 它的能力（42 个键，一个不少）。 */
  byPrimitiveType: Record<string, CapabilityDescriptor>
  /** 每个操作变体 → 负责它的能力（38 个键，一个不少）。 */
  byOperation: Record<string, CapabilityDescriptor>
}

/** 注册表修订号：描述符表语义变化时递增，Agent 把它写进 run 记录以便事后对账。 */
export const CAPABILITY_REGISTRY_REVISION = "2026-09-19.1"

const PLANAR: Workspace[] = ["conics"]
const SOLID: Workspace[] = ["geometry3d"]

const CORE_TESTS = ["packages/agent-core/src/capabilities.test.ts"]

function describeCapability(id: string, status: CapabilityStatus, workspaces: Workspace[], preconditions: string[], testIds: string[] = CORE_TESTS): CapabilityDescriptor {
  return { id, status, workspaces, preconditions, testIds, registryRevision: CAPABILITY_REGISTRY_REVISION }
}

/**
 * 每个图元类型一条能力记录。**42 个键一个不能少**。
 *
 * 计划 Step 4 点名的阻止项就落在这里：`intersectionSolid` → `legacy_readonly`；
 * 内核物化的拓扑（`edge3` / `face3` / `polyhedron3`）→ `temporarily_unavailable`（没有 action handler）。
 */
const PRIMITIVE_CAPABILITIES = {
  point: describeCapability("create-planar-point", "available", PLANAR, ["workspace is conics", "coordinates are finite"]),
  line: describeCapability("create-planar-line", "available", PLANAR, ["workspace is conics", "two distinct points"]),
  segment: describeCapability("create-planar-segment", "available", PLANAR, ["workspace is conics", "two distinct points"]),
  ray: describeCapability("create-planar-ray", "available", PLANAR, ["workspace is conics", "two distinct points"]),
  polyline: describeCapability("create-planar-polyline", "available", PLANAR, ["workspace is conics", "at least two points"]),
  circle: describeCapability("create-planar-circle", "available", PLANAR, ["workspace is conics", "radius is positive and finite"]),
  arc: describeCapability("create-planar-arc", "available", PLANAR, ["workspace is conics", "radius is positive", "start and end angle differ"]),
  parabola: describeCapability("create-conic-parabola", "available", PLANAR, ["workspace is conics", "focal parameter is positive"]),
  ellipse: describeCapability("create-conic-ellipse", "available", PLANAR, ["workspace is conics", "both radii are positive"]),
  hyperbola: describeCapability("create-conic-hyperbola", "available", PLANAR, ["workspace is conics", "both radii are positive"]),
  function: describeCapability("create-function-graph", "available", PLANAR, ["workspace is conics", "expression parses", "domain is bounded"]),
  derivative: describeCapability("create-function-derivative", "available", PLANAR, ["source function exists"]),
  tangent: describeCapability("create-curve-tangent", "available", PLANAR, ["a source curve or point is selected"]),
  normal: describeCapability("create-curve-normal", "available", PLANAR, ["a source curve or point is selected"]),
  secant: describeCapability("create-curve-secant", "available", PLANAR, ["two distinct points on the source"]),
  integral: describeCapability("create-function-integral", "available", PLANAR, ["source function exists", "domain is bounded"]),
  analysisSet: describeCapability("create-analysis-set", "available", PLANAR, ["source function exists"]),
  locus: describeCapability("create-dynamic-point-locus", "available", PLANAR, ["the point is bound to a path"]),
  connection: describeCapability("create-point-connection", "available", PLANAR, ["two or three selected points"]),
  intersection: describeCapability("create-line-intersection", "available", PLANAR, ["two lines that are not parallel"]),
  lineCircleIntersection: describeCapability("create-line-circle-intersection", "available", PLANAR, ["one line and one circle"]),
  circleIntersection: describeCapability("create-circle-circle-intersection", "available", PLANAR, ["two circles"]),
  curveIntersection: describeCapability("create-curve-intersection", "available", PLANAR, ["two sampled curves"]),
  intersectionSet: describeCapability("create-intersection-set", "available", PLANAR, ["two sampled objects"]),
  point3: describeCapability("create-spatial-point", "available", SOLID, ["workspace is geometry3d", "coordinates are finite"], [...CORE_TESTS, "e2e/geometry3d.spec.ts"]),
  line3: describeCapability("create-spatial-line", "available", SOLID, ["two distinct spatial points"]),
  segment3: describeCapability("create-spatial-segment", "available", SOLID, ["two distinct spatial points"]),
  ray3: describeCapability("create-spatial-ray", "available", SOLID, ["two distinct spatial points"]),
  plane3: describeCapability("create-spatial-plane", "available", SOLID, ["three non-collinear points"]),
  circle3: describeCapability("create-spatial-circle-track", "available", SOLID, ["one to three selected points"], [...CORE_TESTS, "e2e/three-orbit-tracks.spec.ts"]),
  cube: describeCapability("create-solid-cube", "available", SOLID, ["workspace is geometry3d"]),
  pyramid: describeCapability("create-solid-pyramid", "available", SOLID, ["workspace is geometry3d"]),
  cylinder: describeCapability("create-solid-cylinder", "available", SOLID, ["workspace is geometry3d"]),
  cone: describeCapability("create-solid-cone", "available", SOLID, ["workspace is geometry3d"]),
  section: describeCapability("create-section-plane", "available", SOLID, ["exactly one solid is selected"], [...CORE_TESTS, "e2e/geometry3d-section.spec.ts"]),
  intersectionLine: describeCapability("create-intersection-line", "available", SOLID, ["two intersecting solids"]),
  intersectionFace: describeCapability("create-intersection-face", "available", SOLID, ["two solids sharing a face patch"]),
  intersectionPoint3: describeCapability("create-intersection-point-3d", "available", SOLID, ["two objects meeting at a point"]),
  edge3: describeCapability("generated-solid-edge", "temporarily_unavailable", SOLID, ["no action handler: edges are materialised by the kernel"]),
  face3: describeCapability("generated-solid-face", "temporarily_unavailable", SOLID, ["no action handler: faces are materialised by the kernel"]),
  polyhedron3: describeCapability("generated-solid-topology", "temporarily_unavailable", SOLID, ["no action handler: topology is materialised by the kernel"]),
  intersectionSolid: describeCapability("legacy-intersection-solid", "legacy_readonly", SOLID, ["legacy documents only: read and render, never create"])
} satisfies Record<PrimitiveSpec["type"], CapabilityDescriptor>

/**
 * 操作 → 能力归属。**38 个键一个不能少**（`Record<DomainOperation["op"], …>` 强制），
 * 于是"新增了操作却忘了定义它可不可用"会直接编译失败。
 */
const OPERATION_CAPABILITIES = {
  addPrimitive: "create-primitive",
  addPrimitives: "create-primitive",
  updatePrimitive: "modify-primitive",
  toggleLock: "modify-primitive",
  setParameter: "modify-primitive",
  deleteParameter: "modify-primitive",
  setParameterExpression: "modify-primitive",
  addAnnotation: "annotation-authoring",
  deleteAnnotation: "annotation-authoring",
  addEngineeringAnnotation: "engineering-annotation",
  deleteEngineeringAnnotation: "engineering-annotation",
  addConstraint: "constraint-authoring",
  deleteConstraint: "constraint-authoring",
  addMeasurement: "measurement-authoring",
  deleteMeasurement: "measurement-authoring",
  deleteObject: "delete-object",
  deleteObjects: "batch-delete",
  toggleVisibility: "set-visibility",
  createGroup: "grouping",
  deleteGroup: "grouping",
  alignPrimitives: "align-primitives",
  setPrimitivesLocked: "batch-primitive-flags",
  setPrimitivesVisible: "batch-primitive-flags",
  setPrimitivesStyle: "batch-primitive-style",
  addLayer: "cad-layer-authoring",
  updateLayer: "cad-layer-authoring",
  deleteLayer: "cad-layer-authoring",
  setActiveLayer: "cad-layer-authoring",
  addDrawingSheet: "cad-drawing-authoring",
  updateDrawingSheet: "cad-drawing-authoring",
  addDrawingView: "cad-drawing-authoring",
  updateDrawingView: "cad-drawing-authoring",
  deleteDrawingView: "cad-drawing-authoring",
  translatePrimitive: "transform-primitive",
  translatePrimitive3: "transform-primitive",
  rotatePrimitive3: "transform-primitive",
  moveSectionPlane: "section-plane-control",
  rotateSectionPlane: "section-plane-control",
  setSectionPlane: "section-plane-control"
} satisfies Record<DomainOperation["op"], string>

const CAD_WORKSPACE: Workspace[] = ["cad"]

/** 不是"某类图元"而是"一类操作"的能力（文档级 / 跨图元）。 */
const OPERATION_ONLY_CAPABILITIES: CapabilityDescriptor[] = [
  describeCapability("create-primitive", "available", [...PLANAR, ...SOLID, ...CAD_WORKSPACE], ["target document workspace matches the capability workspaces"]),
  describeCapability("modify-primitive", "available", [...PLANAR, ...SOLID, ...CAD_WORKSPACE], ["target primitive exists"]),
  describeCapability("delete-object", "available", [...PLANAR, ...SOLID, ...CAD_WORKSPACE], ["target primitive is not locked"]),
  describeCapability("set-visibility", "available", [...PLANAR, ...SOLID, ...CAD_WORKSPACE], ["target primitive exists"]),
  describeCapability("batch-delete", "available", [...PLANAR, ...SOLID, ...CAD_WORKSPACE], ["the whole batch is validated as one union", "no member of the batch is locked"]),
  describeCapability("grouping", "available", [...PLANAR, ...SOLID], ["members are selected and unlocked"]),
  describeCapability("align-primitives", "available", [...PLANAR, ...SOLID], ["at least two selected primitives"]),
  describeCapability("batch-primitive-flags", "available", [...PLANAR, ...SOLID, ...CAD_WORKSPACE], ["at least one selected primitive"]),
  describeCapability("batch-primitive-style", "available", [...PLANAR, ...SOLID, ...CAD_WORKSPACE], ["at least one selected primitive"]),
  describeCapability("annotation-authoring", "available", [...PLANAR, ...SOLID], ["target primitive exists"]),
  describeCapability("engineering-annotation", "available", CAD_WORKSPACE, ["a drawing view with measurable sources exists"]),
  describeCapability("constraint-authoring", "available", [...PLANAR, ...SOLID], ["targets exist in the same document"]),
  describeCapability("measurement-authoring", "available", [...PLANAR, ...SOLID], ["sources are valid for the requested metric"]),
  describeCapability("cad-layer-authoring", "available", CAD_WORKSPACE, ["workspace is cad"]),
  describeCapability("cad-drawing-authoring", "available", CAD_WORKSPACE, ["workspace is cad", "the sheet exists"]),
  describeCapability("transform-primitive", "available", [...PLANAR, ...SOLID], ["target primitive is not locked", "delta or angle is finite"]),
  describeCapability("section-plane-control", "available", SOLID, ["a section primitive exists"])
]

/** 计划 Step 4 点名的**显式阻止**：三维约束只能诊断、不做求解。 */
const DIAGNOSIS_CAPABILITIES: CapabilityDescriptor[] = [
  describeCapability("diagnose-constraints-3d", "diagnosis_only", SOLID, ["diagnosis reads residuals only; solving 3D constraints is out of scope"])
]

/** 计划 Step 4 点名的**显式阻止**：3D 没有直接的 SVG / PNG 导出。 */
const UNSUPPORTED_EXPORT_CAPABILITIES: CapabilityDescriptor[] = [
  describeCapability("export-svg-3d", "unsupported", SOLID, ["3D scenes are not exported as SVG; use CAD projections instead"]),
  describeCapability("export-png-3d", "unsupported", SOLID, ["3D scenes are not exported as PNG; use the CAD sheet instead"])
]

export function getCapabilityRegistry(): CapabilityRegistry {
  const byPrimitiveType: Record<string, CapabilityDescriptor> = { ...PRIMITIVE_CAPABILITIES }

  const byOperation: Record<string, CapabilityDescriptor> = {}
  for (const descriptor of OPERATION_ONLY_CAPABILITIES) {
    for (const [operation, capabilityId] of Object.entries(OPERATION_CAPABILITIES)) {
      if (capabilityId === descriptor.id) byOperation[operation] = descriptor
    }
  }

  // 计划要求：每个操作都要么有处理器、要么显式阻止。漏掉的在这里直接抛，而不是静默留空。
  const unmappedOperations = Object.keys(OPERATION_CAPABILITIES).filter((operation) => byOperation[operation] === undefined)
  if (unmappedOperations.length > 0) {
    throw new Error(`capability registry: operations without a capability: ${unmappedOperations.join(", ")}`)
  }

  const capabilities = [...Object.values(PRIMITIVE_CAPABILITIES), ...OPERATION_ONLY_CAPABILITIES, ...DIAGNOSIS_CAPABILITIES, ...UNSUPPORTED_EXPORT_CAPABILITIES]
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id))

  const byId: Record<string, CapabilityDescriptor> = {}
  for (const descriptor of capabilities) byId[descriptor.id] = descriptor

  return { capabilities, byId, byPrimitiveType, byOperation }
}
