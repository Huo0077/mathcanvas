import type { GeometryDocument } from "@draw/dsl"
import { canonicalPointName } from "@draw/geometry-kernel"

import { ACTIONS, type ActionId } from "./actionRegistry"
import { readFoldTransformations } from "./figureIntent"
import { normalizeGeometryPrompt } from "./latexNormalisation"
import { parseObligationWithLegacy, type ObligationIR } from "./obligationIR"
import { parseShapeClause } from "./solver/shapeGrammar"

export type DrawingEntityKind =
  | "point"
  | "segment"
  | "line"
  | "ray"
  | "polygon"
  | "solid"
  | "conic"
  | "circle"
  | "function"
  | "tangent"
  | "focus"
  | "fold_state"

export interface DrawingIntentSourceRef {
  sourceText: string
  start: number
  end: number
}

export interface DrawingIntentNode {
  nodeId: string
  outputEntityId: string
  outputKind: DrawingEntityKind
  operator: string
  dependencyIds: string[]
  hostEntityId?: string
  requiredHostKind?: DrawingEntityKind | readonly DrawingEntityKind[]
  scopeId: string
  stateId: string
  foldPhase?: "pre_fold" | "post_fold"
  required?: boolean
  mustDisplay?: boolean
  sourceRefs: DrawingIntentSourceRef[]
}

export interface DrawingIntentDiagnostic {
  code:
    | "cyclic_dependency"
    | "duplicate_node_id"
    | "duplicate_entity_id"
    | "unsupported_operator"
    | "missing_host"
    | "wrong_host_kind"
    | "pre_fold_host_violation"
    | "cross_scope_violation"
    | "missing_entity"
    | "isolated_label_without_primitive"
    | "auxiliary_object_hidden"
  nodeId?: string
  entityId?: string
  reason: string
}

export type CompiledDrawingDagResult =
  | {
      ok: true
      executionOrder: DrawingIntentNode[]
      nodeById: ReadonlyMap<string, DrawingIntentNode>
    }
  | {
      ok: false
      diagnostics: DrawingIntentDiagnostic[]
      failedNodeIds: string[]
    }

export interface MaterializedIntentAudit {
  ok: boolean
  presentEntityIds: string[]
  diagnostics: DrawingIntentDiagnostic[]
}

interface CompoundOperatorSpec {
  outputKind: DrawingEntityKind
  requiredHostKinds?: readonly DrawingEntityKind[]
  isFoldTransition?: boolean
}

export const SUPPORTED_COMPOUND_OPERATORS: Record<string, CompoundOperatorSpec> = {
  "solve.conic_focus": { outputKind: "focus", requiredHostKinds: ["conic"] },
  "solve.segment_ratio_point": { outputKind: "point", requiredHostKinds: ["segment"] },
  "solve.line_intersection": { outputKind: "point" },
  "solve.fold_transform": { outputKind: "point", isFoldTransition: true },
  "ds.conic_from_equation_or_properties": { outputKind: "conic" },
  "ds.function_curve_and_tangent": { outputKind: "function" },
  "ds.planar_point_on_host": { outputKind: "point" },
  "ds.planar_line_or_segment": { outputKind: "line" },
  "ds.solid_base_and_prism_or_pyramid": { outputKind: "solid" },
  "ds.solid_point_on_edge_or_face": { outputKind: "point" },
  "ds.solid_fold_along_hinge": { outputKind: "solid", isFoldTransition: true },
  "ds.infeasible_disclosure": { outputKind: "point" }
}

const FOLD_TRANSITION_OPERATORS = new Set([
  "solid.fold",
  ...Object.entries(SUPPORTED_COMPOUND_OPERATORS)
    .filter(([, spec]) => spec.isFoldTransition)
    .map(([op]) => op)
])

const NON_MATERIAL_LABEL_TYPES = new Set(["label", "text", "annotation", "comment"])
const REAL_GEOMETRIC_TYPES = new Set([
  "point", "point3", "line", "line3", "segment", "segment3", "ray",
  "polyline", "polygon", "polyhedron3", "sphere3", "cone3", "cylinder3", "prism3", "pyramid3",
  "ellipse", "hyperbola", "parabola", "circle", "arc", "function", "tangent"
])

export function isSupportedDrawingOperator(operator: string): boolean {
  return Object.prototype.hasOwnProperty.call(ACTIONS, operator)
    || Object.prototype.hasOwnProperty.call(SUPPORTED_COMPOUND_OPERATORS, operator)
}

function sameOrChildScope(dependentScope: string, parentScope: string): boolean {
  if (dependentScope === parentScope) return true
  if (parentScope === "shared") return true
  return false
}

export function compileConstructionDag(nodes: readonly DrawingIntentNode[]): CompiledDrawingDagResult {
  const diagnostics: DrawingIntentDiagnostic[] = []
  const failedNodeIds = new Set<string>()
  const nodeById = new Map<string, DrawingIntentNode>()
  const nodeByEntityKey = new Map<string, DrawingIntentNode>()
  const entityToNode = new Map<string, DrawingIntentNode>()

  for (const node of nodes) {
    if (nodeById.has(node.nodeId)) {
      diagnostics.push({
        code: "duplicate_node_id",
        nodeId: node.nodeId,
        entityId: node.outputEntityId,
        reason: `构造 DAG 中存在重复节点 ID "${node.nodeId}"。`
      })
      failedNodeIds.add(node.nodeId)
    } else {
      nodeById.set(node.nodeId, node)
    }

    const entityKey = `${node.scopeId}\u0000${node.stateId}\u0000${node.outputEntityId}`
    if (nodeByEntityKey.has(entityKey)) {
      diagnostics.push({
        code: "duplicate_entity_id",
        nodeId: node.nodeId,
        entityId: node.outputEntityId,
        reason: `作用域 "${node.scopeId}" / 状态 "${node.stateId}" 中存在重复实体 ID "${node.outputEntityId}"。`
      })
      failedNodeIds.add(node.nodeId)
    } else {
      nodeByEntityKey.set(entityKey, node)
    }
    if (!entityToNode.has(node.outputEntityId)) {
      entityToNode.set(node.outputEntityId, node)
    }

    if (!isSupportedDrawingOperator(node.operator)) {
      diagnostics.push({
        code: "unsupported_operator",
        nodeId: node.nodeId,
        entityId: node.outputEntityId,
        reason: `节点 "${node.nodeId}" 使用了未注册算子 "${node.operator}"（不得绕过能力表）。`
      })
      failedNodeIds.add(node.nodeId)
    }
  }

  const dependents = new Map<string, string[]>()
  const inDegree = new Map<string, number>()
  for (const node of nodes) {
    dependents.set(node.nodeId, [])
    inDegree.set(node.nodeId, 0)
  }

  for (const node of nodes) {
    const depSet = new Set<string>(node.dependencyIds)
    const resolveHost = (hostId: string): DrawingIntentNode | undefined => nodeById.get(hostId) ?? entityToNode.get(hostId)

    if (node.hostEntityId !== undefined) {
      const hostNode = resolveHost(node.hostEntityId)
      if (!hostNode) {
        diagnostics.push({
          code: "missing_host",
          nodeId: node.nodeId,
          entityId: node.outputEntityId,
          reason: `节点 "${node.nodeId}" 指定的宿主 "${node.hostEntityId}" 不存在。`
        })
        failedNodeIds.add(node.nodeId)
      } else {
        depSet.add(hostNode.nodeId)
        const expectedHosts = node.requiredHostKind === undefined
          ? SUPPORTED_COMPOUND_OPERATORS[node.operator]?.requiredHostKinds
          : Array.isArray(node.requiredHostKind)
            ? node.requiredHostKind
            : [node.requiredHostKind]
        if (expectedHosts && !expectedHosts.includes(hostNode.outputKind)) {
          diagnostics.push({
            code: "wrong_host_kind",
            nodeId: node.nodeId,
            entityId: node.outputEntityId,
            reason: `节点 "${node.nodeId}" 的宿主 "${hostNode.outputEntityId}" 类型为 "${hostNode.outputKind}"，不满足 "${expectedHosts.join("/")}"。`
          })
          failedNodeIds.add(node.nodeId)
        }
      }
    }

    for (const depRef of depSet) {
      const depNode = nodeById.get(depRef) ?? entityToNode.get(depRef)
      if (!depNode) {
        diagnostics.push({
          code: "missing_host",
          nodeId: node.nodeId,
          entityId: node.outputEntityId,
          reason: `节点 "${node.nodeId}" 的依赖 "${depRef}" 不存在。`
        })
        failedNodeIds.add(node.nodeId)
        continue
      }

      if (!sameOrChildScope(node.scopeId, depNode.scopeId)) {
        diagnostics.push({
          code: "cross_scope_violation",
          nodeId: node.nodeId,
          entityId: node.outputEntityId,
          reason: `节点 "${node.nodeId}"（scope=${node.scopeId}）禁止跨问依赖 "${depNode.outputEntityId}"（scope=${depNode.scopeId}）。`
        })
        failedNodeIds.add(node.nodeId)
      }

      if (
        node.foldPhase === "post_fold"
        && depNode.foldPhase === "pre_fold"
        && !FOLD_TRANSITION_OPERATORS.has(node.operator)
      ) {
        diagnostics.push({
          code: "pre_fold_host_violation",
          nodeId: node.nodeId,
          entityId: node.outputEntityId,
          reason: `折后节点 "${node.nodeId}"（state=${node.stateId}）直接引用了折前对象 "${depNode.outputEntityId}"（state=${depNode.stateId}）作宿主，缺少 solid.fold 状态迁移。`
        })
        failedNodeIds.add(node.nodeId)
      }

      if (nodeById.has(node.nodeId) && nodeById.has(depNode.nodeId)) {
        dependents.get(depNode.nodeId)!.push(node.nodeId)
        inDegree.set(node.nodeId, (inDegree.get(node.nodeId) ?? 0) + 1)
      }
    }
  }

  // Deterministic Kahn's topological sort
  const queue = nodes
    .filter((node) => (inDegree.get(node.nodeId) ?? 0) === 0 && nodeById.has(node.nodeId))
    .map((node) => node.nodeId)
    .sort()
  const orderedIds: string[] = []
  const visited = new Set<string>()

  while (queue.length > 0) {
    const currentId = queue.shift()!
    if (visited.has(currentId)) continue
    visited.add(currentId)
    orderedIds.push(currentId)
    const nextList = dependents.get(currentId) ?? []
    for (const nextId of nextList) {
      const deg = (inDegree.get(nextId) ?? 0) - 1
      inDegree.set(nextId, deg)
      if (deg === 0) {
        queue.push(nextId)
        queue.sort()
      }
    }
  }

  if (orderedIds.length < nodeById.size) {
    const cycleIds = [...nodeById.keys()].filter((id) => !visited.has(id)).sort()
    diagnostics.push({
      code: "cyclic_dependency",
      nodeId: cycleIds[0],
      reason: `构造 DAG 存在循环依赖（涉及节点：${cycleIds.join("、")}）。`
    })
    for (const id of cycleIds) failedNodeIds.add(id)
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics, failedNodeIds: [...failedNodeIds] }
  }

  return {
    ok: true,
    executionOrder: orderedIds.map((id) => nodeById.get(id)!),
    nodeById
  }
}

export interface DeriveDrawingIntentInput {
  prompt: string
  obligations?: ObligationIR
  selectedPart?: number
  requiredEntityIds?: readonly string[]
}

export function deriveRequiredDrawingIntent(input: DeriveDrawingIntentInput): { nodes: DrawingIntentNode[]; requiredEntityIds: string[] } {
  const normalized = normalizeGeometryPrompt(input.prompt)
  const ir = input.obligations ?? parseObligationWithLegacy(normalized, {
    ...(input.selectedPart === undefined ? {} : { selectedPart: input.selectedPart })
  }).ir
  const shape = parseShapeClause(normalized)
  const folds = readFoldTransformations(normalized)
  const nodes: DrawingIntentNode[] = []
  const addedEntityKeys = new Set<string>()

  const pushNode = (node: DrawingIntentNode): void => {
    const key = `${node.scopeId}\u0000${node.stateId}\u0000${node.outputEntityId}`
    if (addedEntityKeys.has(key)) return
    addedEntityKeys.add(key)
    nodes.push(node)
  }

  const foldedApexSet = new Set(folds.map((f) => f.apex))
  const postFoldTargets = new Set(folds.map((f) => f.apexAs))

  // 1. Base vertices from shape clause (s0)
  if (shape) {
    const allBase = [...shape.base, ...(shape.top ?? []), ...(shape.apex ? [shape.apex] : [])]
    for (const v of allBase) {
      const name = canonicalPointName(v)
      pushNode({
        nodeId: `pt:${name}@s0`,
        outputEntityId: name,
        outputKind: "point",
        operator: "solid.create_point",
        dependencyIds: [],
        scopeId: "shared",
        stateId: "s0",
        foldPhase: foldedApexSet.has(name) ? "pre_fold" : undefined,
        required: true,
        mustDisplay: true,
        sourceRefs: []
      })
    }
  }

  // 2. Proportion / bound edge points (e.g. AE=2/5 AD, AF=1/2 AB, midpoint)
  for (const ob of ir.obligations) {
    if (ob.role !== "given") continue
    const scopeId = ob.scopeId ?? "shared"
    const sourceRef: DrawingIntentSourceRef = { sourceText: ob.sourceText, start: ob.start, end: ob.end }

    if (ob.kind === "segmentRatio" || ob.kind === "midpoint" || ob.kind === "pointOnSegment") {
      let hostPoint: string | null = null
      let segA: string | null = null
      let segB: string | null = null
      if (ob.kind === "midpoint" || ob.kind === "pointOnSegment") {
        ;[hostPoint, segA, segB] = ob.targets
      } else if (ob.targets.length === 4) {
        const [a, b, c, d] = ob.targets
        if (a === c) {
          hostPoint = b!
          segA = a!
          segB = d!
        } else if (b === c) {
          hostPoint = b!
          segA = a!
          segB = d!
        }
      }
      if (hostPoint && segA && segB && !postFoldTargets.has(hostPoint)) {
        const hostNameA = canonicalPointName(segA)
        const hostNameB = canonicalPointName(segB)
        const boundName = canonicalPointName(hostPoint)
        for (const endName of [hostNameA, hostNameB]) {
          pushNode({
            nodeId: `pt:${endName}@s0`,
            outputEntityId: endName,
            outputKind: "point",
            operator: "solid.create_point",
            dependencyIds: [],
            scopeId: "shared",
            stateId: "s0",
            foldPhase: foldedApexSet.has(endName) ? "pre_fold" : undefined,
            required: true,
            mustDisplay: true,
            sourceRefs: []
          })
        }
        const edgeId = `seg:${hostNameA}${hostNameB}`
        pushNode({
          nodeId: edgeId,
          outputEntityId: edgeId,
          outputKind: "segment",
          operator: "solid.create_segment",
          dependencyIds: [`pt:${hostNameA}@s0`, `pt:${hostNameB}@s0`],
          scopeId: "shared",
          stateId: "s0",
          required: false,
          sourceRefs: [sourceRef]
        })
        pushNode({
          nodeId: `pt:${boundName}@s0`,
          outputEntityId: boundName,
          outputKind: "point",
          operator: "dynamic.create_bound_point",
          dependencyIds: [edgeId],
          hostEntityId: edgeId,
          requiredHostKind: "segment",
          scopeId,
          stateId: "s0",
          required: true,
          mustDisplay: true,
          sourceRefs: [sourceRef]
        })
      }
    }

    if (ob.kind === "conicAxes" || ob.kind === "symbolicConic") {
      const conicId = ob.geometry?.entityLabel ?? ob.geometry?.symbolicConic?.entityLabel ?? "C"
      const isCircle = ob.geometry?.conic?.kind === "circle"
      pushNode({
        nodeId: `conic:${conicId}@${scopeId}`,
        outputEntityId: conicId,
        outputKind: isCircle ? "circle" : "conic",
        operator: isCircle ? "planar.create_circle" : "planar.create_conic",
        dependencyIds: [],
        scopeId,
        stateId: "s0",
        required: true,
        mustDisplay: true,
        sourceRefs: [sourceRef]
      })
    }

    if (ob.kind === "pointOnConic" && ob.targets[0]) {
      const pt = canonicalPointName(ob.targets[0])
      const hostConic = ob.geometry?.entityLabel ?? "C"
      pushNode({
        nodeId: `conic:${hostConic}@shared`,
        outputEntityId: hostConic,
        outputKind: "conic",
        operator: "planar.create_conic",
        dependencyIds: [],
        scopeId: "shared",
        stateId: "s0",
        required: true,
        mustDisplay: true,
        sourceRefs: []
      })
      pushNode({
        nodeId: `pt:${pt}@${scopeId}`,
        outputEntityId: pt,
        outputKind: "point",
        operator: "dynamic.bind_point",
        dependencyIds: [`conic:${hostConic}@shared`],
        hostEntityId: `conic:${hostConic}@shared`,
        requiredHostKind: "conic",
        scopeId,
        stateId: "s0",
        required: true,
        mustDisplay: true,
        sourceRefs: [sourceRef]
      })
    }

    if (ob.kind === "functionGraph") {
      pushNode({
        nodeId: `fn:main@${scopeId}`,
        outputEntityId: "f",
        outputKind: "function",
        operator: "function.create_graph",
        dependencyIds: [],
        scopeId,
        stateId: "s0",
        required: true,
        mustDisplay: true,
        sourceRefs: [sourceRef]
      })
    }
  }

  // 3. Fold transitions (s0 -> s1)
  for (const fold of folds) {
    const preApex = canonicalPointName(fold.apex)
    const postApex = canonicalPointName(fold.apexAs)
    const hingeA = canonicalPointName(fold.hinge.from)
    const hingeB = canonicalPointName(fold.hinge.to)
    for (const prePt of [preApex, hingeA, hingeB]) {
      pushNode({
        nodeId: `pt:${prePt}@s0`,
        outputEntityId: prePt,
        outputKind: "point",
        operator: "solid.create_point",
        dependencyIds: [],
        scopeId: "shared",
        stateId: "s0",
        foldPhase: prePt === preApex ? "pre_fold" : undefined,
        required: true,
        mustDisplay: true,
        sourceRefs: []
      })
    }
    pushNode({
      nodeId: `pt:${postApex}@s1`,
      outputEntityId: postApex,
      outputKind: "point",
      operator: "solid.fold",
      dependencyIds: [`pt:${preApex}@s0`, `pt:${hingeA}@s0`, `pt:${hingeB}@s0`],
      scopeId: "shared",
      stateId: "s1",
      foldPhase: "post_fold",
      required: true,
      mustDisplay: true,
      sourceRefs: fold.sourceText ? [{ sourceText: fold.sourceText, start: 0, end: fold.sourceText.length }] : []
    })
  }

  // 4. Conic foci & points explicitly bound on named curves (e.g. F₁, F₂, M(2,2√5/5) 为 C 上一点, P 为 C 上一点)
  const mainConicNode = nodes.find((n) => n.outputKind === "conic")
  if (mainConicNode) {
    if (/焦点|F[₁₂12]|F_\{?[12]\}?/.test(normalized)) {
      for (const focusLabel of ["F₁", "F₂"]) {
        pushNode({
          nodeId: `focus:${focusLabel}@shared`,
          outputEntityId: focusLabel,
          outputKind: "focus",
          operator: "solve.conic_focus",
          dependencyIds: [mainConicNode.nodeId],
          hostEntityId: mainConicNode.nodeId,
          requiredHostKind: "conic",
          scopeId: "shared",
          stateId: "s0",
          required: true,
          mustDisplay: true,
          sourceRefs: []
        })
      }
    }
    const curvePointRegex = /([A-Z][0-9′'₁₂₃₄₅₆₇₈₉]*)\s*(?:\([^)]+\))?\s*(?:是|为|在)\s*(?:(?:椭圆|双曲线|抛物线|圆|曲线)\s*)?([A-Z])\s*上(?:一点|任意一点|的点|动点)/g
    for (const match of normalized.matchAll(curvePointRegex)) {
      const pt = canonicalPointName(match[1]!)
      const curveLabel = match[2]!
      const host = nodes.find((n) => n.outputKind === "conic" && n.outputEntityId === curveLabel)
      if (!host) continue
      pushNode({
        nodeId: `pt:${pt}@shared`,
        outputEntityId: pt,
        outputKind: "point",
        operator: "dynamic.bind_point",
        dependencyIds: [host.nodeId],
        hostEntityId: host.nodeId,
        requiredHostKind: "conic",
        scopeId: "shared",
        stateId: "s0",
        required: true,
        mustDisplay: true,
        sourceRefs: [{ sourceText: match[0], start: match.index, end: match.index + match[0].length }]
      })
    }
  }

  // 5. Ensure explicit contract requiredEntityIds are represented if omitted above
  const existingEntityIds = new Set(nodes.map((n) => canonicalPointName(n.outputEntityId)))
  for (const rawId of input.requiredEntityIds ?? []) {
    const id = canonicalPointName(rawId)
    if (existingEntityIds.has(id)) continue
    existingEntityIds.add(id)
    const depConic = mainConicNode && /[₁₂]/.test(id) ? [mainConicNode.nodeId] : []
    pushNode({
      nodeId: `req:${id}@shared`,
      outputEntityId: id,
      outputKind: /[₁₂]/.test(id) && mainConicNode ? "focus" : "point",
      operator: /[₁₂]/.test(id) && mainConicNode ? "solve.conic_focus" : "planar.create_point",
      dependencyIds: depConic,
      ...(depConic.length === 1 ? { hostEntityId: depConic[0], requiredHostKind: "conic" as const } : {}),
      scopeId: "shared",
      stateId: postFoldTargets.has(id) ? "s1" : "s0",
      required: true,
      mustDisplay: true,
      sourceRefs: []
    })
  }

  const requiredIds = [...new Set(nodes.filter((n) => n.required !== false).map((n) => n.outputEntityId))]
  return { nodes, requiredEntityIds: requiredIds }
}

export function collectDependentSubgraph(
  executionOrder: readonly DrawingIntentNode[],
  changedEntityIds: readonly string[]
): string[] {
  const dirtyEntities = new Set(changedEntityIds)
  const dirtyNodes = new Set<string>()
  const impactedEntities: string[] = []

  for (const node of executionOrder) {
    const hostHit = node.hostEntityId !== undefined && (dirtyEntities.has(node.hostEntityId) || dirtyNodes.has(node.hostEntityId))
    const depHit = node.dependencyIds.some((dep) => dirtyNodes.has(dep) || dirtyEntities.has(dep))
    if (dirtyEntities.has(node.outputEntityId) || dirtyNodes.has(node.nodeId) || hostHit || depHit) {
      dirtyNodes.add(node.nodeId)
      dirtyEntities.add(node.outputEntityId)
      if (!impactedEntities.includes(node.outputEntityId)) impactedEntities.push(node.outputEntityId)
    }
  }
  return impactedEntities
}

export function auditMaterializedIntent(
  executionOrder: readonly DrawingIntentNode[],
  document: GeometryDocument,
  entityBindings: Record<string, string> = {}
): MaterializedIntentAudit {
  const diagnostics: DrawingIntentDiagnostic[] = []
  const presentEntityIds: string[] = []

  const normalizeEntityName = (value: unknown): string | undefined => {
    if (typeof value !== "string" || value.trim().length === 0) return undefined
    const stripped = value.trim().replace(/^(?:椭圆|双曲线|抛物线|圆|曲线)\s*/, "")
    return canonicalPointName(stripped)
  }

  for (const node of executionOrder) {
    if (node.required === false) continue
    const targetName = normalizeEntityName(node.outputEntityId)
    const boundId = entityBindings[node.outputEntityId] ?? (targetName ? entityBindings[targetName] : undefined)

    const matchingPrimitives = document.primitives.filter((primitive) => {
      if (boundId !== undefined && primitive.id === boundId) return true
      const rawLabel = (primitive as { label?: unknown }).label
      const normLabel = normalizeEntityName(rawLabel)
      if (normLabel !== undefined && targetName !== undefined && normLabel === targetName) return true
      // For vertex arrays inside polyhedron3 / polygon? Check explicit vertex point/point3 primitives first!
      return false
    })

    const realMatches = matchingPrimitives.filter((primitive) => REAL_GEOMETRIC_TYPES.has(primitive.type))
    const labelOnlyMatches = matchingPrimitives.filter((primitive) => NON_MATERIAL_LABEL_TYPES.has(primitive.type))

    if (realMatches.length === 0) {
      if (labelOnlyMatches.length > 0) {
        diagnostics.push({
          code: "isolated_label_without_primitive",
          nodeId: node.nodeId,
          entityId: node.outputEntityId,
          reason: `必需对象 "${node.outputEntityId}" 仅有孤立标注文本（type=${labelOnlyMatches[0]!.type}），没有对应真实几何图元。`
        })
      } else {
        diagnostics.push({
          code: "missing_entity",
          nodeId: node.nodeId,
          entityId: node.outputEntityId,
          reason: `必需对象 "${node.outputEntityId}"（算子 ${node.operator}）在候选图中缺失。`
        })
      }
      continue
    }

    const visibleMatch = realMatches.find((primitive) => (primitive as { visible?: unknown }).visible !== false)
    if (!visibleMatch && node.mustDisplay !== false) {
      diagnostics.push({
        code: "auxiliary_object_hidden",
        nodeId: node.nodeId,
        entityId: node.outputEntityId,
        reason: `必需对象 "${node.outputEntityId}" 存在但被设为隐藏（visible: false），未真实显示。`
      })
      continue
    }

    presentEntityIds.push(node.outputEntityId)
  }

  return {
    ok: diagnostics.length === 0,
    presentEntityIds,
    diagnostics
  }
}
