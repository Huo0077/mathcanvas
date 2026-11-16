import { canonicalPointName } from "@draw/geometry-kernel"

import type { ClaimRole, GeometryObligation, Judgeability } from "./claimEvidence"
import type { DiagramObligationSet } from "./diagramObligations"
import { sha256Hex } from "./hashing"
import {
  mapNormalizedRangeToOriginal,
  normalizeGeometryPromptWithSourceMap,
  type MappedPrompt,
  type SourceMapSegment
} from "./latexNormalisation"
import { readNamedFold, type NamedFoldTransition } from "./namedFold"
import { SHARED_SCOPE_ID, parseSubquestionScopeId, subquestionScopeId } from "./numberedProblem"
import { buildObligationIR, parseObligationWithLegacy, type ObligationIR } from "./obligationIR"
import { mapEditedRangeToOriginal, type NormalisationApplication } from "./promptNormalization"

export const PROBLEM_CONTRACT_SCHEMA_VERSION = "problem-contract.v1"

export interface SourceRef {
  documentHash: string
  start: number
  end: number
  coordinateSpace: "original-utf16"
}

export interface Scope {
  id: string
  parentId?: string
  kind: "shared" | "subquestion" | "branch"
  number?: number
  source?: SourceRef
}

export interface EntityBinding {
  entityId: string
  scopeId: string
  stateId: string
  label: string
  canonicalLabel: string
  aliases: readonly string[]
  primitiveIds: readonly string[]
  sources: readonly SourceRef[]
  derivedFromEntityId?: string
}

export type EntityResolutionResult =
  | { status: "resolved"; entity: EntityBinding }
  | { status: "ambiguous"; reason: "entity_alias_cross_state"; candidates: readonly EntityBinding[] }
  | { status: "missing" }

export interface ContractObligation {
  id: string
  scopeId: string
  stateId: string
  role: ClaimRole
  kind: string
  sourceText: string
  judgeability: Judgeability
  origin: "problem"
  provenance: readonly SourceRef[]
  targets: readonly string[]
  obligation: GeometryObligation
}

export interface ProposedAddition {
  id: string
  scopeId: string
  text: string
  origin: "proposed" | "derived" | "free_choice"
  status: "derived" | "free_choice" | "rejected_unjustified"
  promotedToGiven: false
  derivedFromIds?: readonly string[]
  reason?: string
}

export interface ContractUnverified {
  id: string
  scopeId: string
  sourceText: string
  reason: string
  source?: SourceRef
}

export interface ContractCoverage {
  scopeId: string
  status: "complete" | "partial" | "blocked"
  requiredObligationIds: readonly string[]
  judgedObligationIds: readonly string[]
  unresolvedSource: readonly SourceRef[]
  missingEntityIds: readonly string[]
  reason?: string
}

export interface ProblemContract {
  schemaVersion: typeof PROBLEM_CONTRACT_SCHEMA_VERSION
  source: {
    rawPrompt: string
    rawHash: string
    normalizedPrompt: string
    normalizedHash: string
    sourceMap: readonly SourceMapSegment[]
    selectedScopeId?: string
  }
  scopes: readonly Scope[]
  entities: readonly EntityBinding[]
  obligations: readonly ContractObligation[]
  proposedAdditions: readonly ProposedAddition[]
  unverified: readonly ContractUnverified[]
  coverage: ContractCoverage
  ir: ObligationIR
  legacy: DiagramObligationSet
}

export interface BuildProblemContractInput {
  prompt: string
  selectedPart?: number
  selectedScopeId?: string
  spatialPointConditions?: boolean
  normalisationApplication?: Pick<NormalisationApplication, "text" | "sourceMap">
  legacy?: DiagramObligationSet
  ir?: ObligationIR
}

const POINT_TOKEN_RE = /[A-Z](?:[′'’´ʹʼ`]|[₁₂₃₄₅₆]|(?<!\d)[1-6](?!\d)){0,2}/g

function toOriginalRef(
  rawPrompt: string,
  rawHash: string,
  mapped: MappedPrompt,
  start: number,
  end: number,
  normalisationApplication?: Pick<NormalisationApplication, "sourceMap">
): SourceRef {
  if (rawPrompt.length === 0 || (start === 0 && end === 0)) {
    return { documentHash: rawHash, start: 0, end: 0, coordinateSpace: "original-utf16" }
  }
  const inEffective = mapNormalizedRangeToOriginal(mapped, start, end)
  const inRaw = normalisationApplication === undefined
    ? inEffective
    : mapEditedRangeToOriginal(normalisationApplication, inEffective.start, inEffective.end)
  return {
    documentHash: rawHash,
    start: Math.max(0, Math.min(rawPrompt.length, inRaw.start)),
    end: Math.max(0, Math.min(rawPrompt.length, inRaw.end)),
    coordinateSpace: "original-utf16"
  }
}

function collectEntityBindings(
  rawPrompt: string,
  rawHash: string,
  mapped: MappedPrompt,
  scopes: readonly Scope[],
  ir: ObligationIR,
  foldTransition: NamedFoldTransition | null,
  normalisationApplication?: Pick<NormalisationApplication, "sourceMap">
): EntityBinding[] {
  const byKey = new Map<string, EntityBinding>()

  const upsert = (input: {
    rawLabel: string
    canonical: string
    scopeId: string
    stateId: string
    source?: SourceRef
    derivedFromEntityId?: string
  }): void => {
    const entityId = `${input.canonical}@${input.stateId}`
    const mapKey = `${input.scopeId}::${entityId}`
    const existing = byKey.get(mapKey)
    if (existing !== undefined) {
      const aliases = existing.aliases.includes(input.rawLabel) ? existing.aliases : [...existing.aliases, input.rawLabel]
      const sources = input.source === undefined ? existing.sources : [...existing.sources, input.source]
      byKey.set(mapKey, {
        ...existing,
        aliases,
        sources,
        ...(existing.derivedFromEntityId === undefined && input.derivedFromEntityId !== undefined
          ? { derivedFromEntityId: input.derivedFromEntityId }
          : {})
      })
      return
    }
    byKey.set(mapKey, {
      entityId,
      scopeId: input.scopeId,
      stateId: input.stateId,
      label: input.canonical,
      canonicalLabel: input.canonical,
      aliases: [input.rawLabel],
      primitiveIds: [],
      sources: input.source === undefined ? [] : [input.source],
      ...(input.derivedFromEntityId === undefined ? {} : { derivedFromEntityId: input.derivedFromEntityId })
    })
  }

  // Extract raw spelling variants (e.g. A1 and A₁) directly from the raw prompt for alias fidelity.
  for (const match of rawPrompt.matchAll(POINT_TOKEN_RE)) {
    const rawLabel = match[0]
    const canonical = canonicalPointName(rawLabel)
    const start = match.index
    const end = start + rawLabel.length
    const matchingScope = scopes.find((scope) =>
      scope.kind === "subquestion" && scope.source !== undefined && start >= scope.source.start && end <= scope.source.end
    )
    upsert({
      rawLabel,
      canonical,
      scopeId: matchingScope?.id ?? SHARED_SCOPE_ID,
      stateId: "s0",
      source: { documentHash: rawHash, start, end, coordinateSpace: "original-utf16" }
    })
  }

  for (const obligation of ir.obligations) {
    const scopeId = obligation.scopeId ?? SHARED_SCOPE_ID
    const stateId = obligation.stateId ?? "s0"
    const source = toOriginalRef(rawPrompt, rawHash, mapped, obligation.start, obligation.end, normalisationApplication)
    for (const target of obligation.targets) {
      const canonical = canonicalPointName(target)
      upsert({ rawLabel: target, canonical, scopeId, stateId, source })
    }
  }

  if (foldTransition !== null) {
    const foldSource = toOriginalRef(
      rawPrompt,
      rawHash,
      mapped,
      foldTransition.source.start,
      foldTransition.source.end,
      normalisationApplication
    )
    for (const ref of foldTransition.flap.before) {
      upsert({
        rawLabel: ref.displayName,
        canonical: canonicalPointName(ref.displayName),
        scopeId: SHARED_SCOPE_ID,
        stateId: foldTransition.from,
        source: foldSource
      })
    }
    const postApex = foldTransition.apex.after
    const preApex = foldTransition.apex.before
    upsert({
      rawLabel: postApex.displayName,
      canonical: canonicalPointName(postApex.displayName),
      scopeId: SHARED_SCOPE_ID,
      stateId: foldTransition.to,
      source: foldSource,
      derivedFromEntityId: `${canonicalPointName(preApex.displayName)}@${foldTransition.from}`
    })
    for (const ref of foldTransition.hinge.after) {
      upsert({
        rawLabel: ref.displayName,
        canonical: canonicalPointName(ref.displayName),
        scopeId: SHARED_SCOPE_ID,
        stateId: foldTransition.to,
        source: foldSource
      })
    }
  }

  return [...byKey.values()]
}

export function buildProblemContract(input: BuildProblemContractInput): ProblemContract {
  const effectiveSource = input.normalisationApplication?.text ?? input.prompt
  const rawHash = sha256Hex(input.prompt)
  const mapped = normalizeGeometryPromptWithSourceMap(effectiveSource)
  const normalizedHash = sha256Hex(mapped.normalized)

  let legacy: DiagramObligationSet
  let ir: ObligationIR
  if (input.legacy !== undefined && input.ir !== undefined) {
    legacy = input.legacy
    ir = input.ir
  } else if (input.ir !== undefined) {
    ir = input.ir
    legacy = input.legacy ?? {
      givens: [],
      goals: [],
      freeChoices: [],
      unverified: ir.unverified.map(({ sourceText, reason }) => ({ sourceText, reason }))
    }
  } else if (input.legacy !== undefined) {
    legacy = input.legacy
    ir = buildObligationIR(legacy)
  } else {
    const parsed = parseObligationWithLegacy(effectiveSource, {
      spatialPointConditions: input.spatialPointConditions,
      selectedPart: input.selectedPart,
      selectedScopeId: input.selectedScopeId
    })
    legacy = parsed.legacy
    ir = parsed.ir
  }

  const scopes: Scope[] = (ir.scopes ?? [{ id: SHARED_SCOPE_ID, kind: "shared" as const }]).map((scope) => {
    if (scope.kind === "subquestion" && scope.start !== undefined && scope.end !== undefined) {
      return {
        id: scope.id,
        parentId: scope.parentId ?? SHARED_SCOPE_ID,
        kind: "subquestion",
        ...(scope.number === undefined ? {} : { number: scope.number }),
        source: toOriginalRef(input.prompt, rawHash, mapped, scope.start, scope.end, input.normalisationApplication)
      }
    }
    return { id: scope.id, kind: scope.kind }
  })

  const foldRead = readNamedFold(mapped.normalized)
  const foldTransition = foldRead.status === "ok" ? foldRead.transition : null

  const entities = collectEntityBindings(
    input.prompt,
    rawHash,
    mapped,
    scopes,
    ir,
    foldTransition,
    input.normalisationApplication
  )

  const selectedScopeId = input.selectedScopeId
    ?? (input.selectedPart !== undefined ? subquestionScopeId(input.selectedPart) : undefined)
    ?? ir.selectedScopeId
    ?? (scopes.some((scope) => scope.kind === "subquestion") ? SHARED_SCOPE_ID : SHARED_SCOPE_ID)

  const obligations: ContractObligation[] = ir.obligations.map((obligation) => ({
    id: obligation.id,
    scopeId: obligation.scopeId ?? SHARED_SCOPE_ID,
    stateId: obligation.stateId ?? "s0",
    role: obligation.role,
    kind: obligation.kind,
    sourceText: obligation.sourceText,
    judgeability: obligation.judgeability,
    origin: "problem",
    provenance: [toOriginalRef(input.prompt, rawHash, mapped, obligation.start, obligation.end, input.normalisationApplication)],
    targets: [...obligation.targets],
    obligation
  }))

  const unverified: ContractUnverified[] = ir.unverified.map((entry, index) => ({
    id: `unverified-${index}`,
    scopeId: entry.scopeId ?? SHARED_SCOPE_ID,
    sourceText: entry.sourceText,
    reason: entry.reason
  }))

  const activePartNumber = parseSubquestionScopeId(selectedScopeId)
  const activeScopeMatch = (scopeId: string): boolean => {
    if (activePartNumber !== null) {
      return scopeId === SHARED_SCOPE_ID || scopeId === selectedScopeId
    }
    return scopeId === SHARED_SCOPE_ID || scopeId === "scope_blocker"
  }

  const activeGivens = obligations.filter((item) => item.role === "given" && activeScopeMatch(item.scopeId))
  const requiredObligationIds = activeGivens.map((item) => item.id)
  const judgedObligationIds = activeGivens.filter((item) => item.judgeability === "supported").map((item) => item.id)
  const hasMultiSubquestions = scopes.some((scope) => scope.kind === "subquestion")
  const hasBlocker = unverified.some((entry) => entry.scopeId === "scope_blocker")
  const activeUnverified = unverified.filter((entry) => activeScopeMatch(entry.scopeId) || (entry.scopeId === "scope_blocker" && hasBlocker))
  const missingProvenance = input.prompt.length === 0 && obligations.some((item) => item.provenance.every((ref) => ref.start === 0 && ref.end === 0))

  let coverageStatus: ContractCoverage["status"] = "complete"
  let coverageReason: string | undefined
  if (missingProvenance) {
    coverageStatus = "blocked"
    coverageReason = "手工或旧版契约缺少原文来源（provenance），不能签署完整证书。"
  } else if (hasMultiSubquestions && (selectedScopeId === SHARED_SCOPE_ID || input.selectedScopeId === SHARED_SCOPE_ID) && hasBlocker) {
    coverageStatus = "partial"
    coverageReason = "仅构建公共题设（shared）作用域，小问专用条件未覆盖，整体状态为部分完成（partial）。"
  } else if (activeUnverified.length > 0 || judgedObligationIds.length < requiredObligationIds.length || requiredObligationIds.length === 0) {
    coverageStatus = "blocked"
    coverageReason = activeUnverified[0]?.reason ?? "存在尚未解析或不可判定的必要条件，或题设条件集合为空。"
  }

  const unresolvedSource = activeGivens
    .filter((item) => item.judgeability !== "supported")
    .flatMap((item) => item.provenance)

  return {
    schemaVersion: PROBLEM_CONTRACT_SCHEMA_VERSION,
    source: {
      rawPrompt: input.prompt,
      rawHash,
      normalizedPrompt: mapped.normalized,
      normalizedHash,
      sourceMap: mapped.segments,
      ...(selectedScopeId === undefined ? {} : { selectedScopeId })
    },
    scopes,
    entities,
    obligations,
    proposedAdditions: [],
    unverified,
    coverage: {
      scopeId: selectedScopeId,
      status: coverageStatus,
      requiredObligationIds,
      judgedObligationIds,
      unresolvedSource,
      missingEntityIds: [],
      ...(coverageReason === undefined ? {} : { reason: coverageReason })
    },
    ir,
    legacy
  }
}

export function resolveEntityBinding(
  contract: Pick<ProblemContract, "entities">,
  query: { name: string; scopeId: string; stateId?: string }
): EntityResolutionResult {
  const canonical = canonicalPointName(query.name)
  const visibleScopes = query.scopeId === SHARED_SCOPE_ID ? [SHARED_SCOPE_ID] : [query.scopeId, SHARED_SCOPE_ID]
  const scopedMatches = contract.entities.filter((entity) =>
    visibleScopes.includes(entity.scopeId)
    && (entity.canonicalLabel === canonical || entity.aliases.some((alias) => canonicalPointName(alias) === canonical))
  )

  const deduped = new Map<string, EntityBinding>()
  for (const entity of scopedMatches) {
    // Subquestion scope binding takes precedence over shared for identical entityId.
    const existing = deduped.get(entity.entityId)
    if (existing === undefined || entity.scopeId === query.scopeId) {
      deduped.set(entity.entityId, entity)
    }
  }
  const matches = [...deduped.values()]
  if (matches.length === 0) return { status: "missing" }

  if (query.stateId !== undefined) {
    const exact = matches.find((entity) => entity.stateId === query.stateId)
    return exact === undefined ? { status: "missing" } : { status: "resolved", entity: exact }
  }

  const distinctStates = new Set(matches.map((entity) => entity.stateId))
  if (distinctStates.size > 1) {
    return {
      status: "ambiguous",
      reason: "entity_alias_cross_state",
      candidates: [...matches].sort((left, right) => left.stateId.localeCompare(right.stateId))
    }
  }
  return { status: "resolved", entity: matches[0]! }
}

export function recordModelProposal(
  contract: ProblemContract,
  proposal: {
    text: string
    kind: "free_choice" | "derived" | "proposed"
    scopeId: string
    derivedFromIds?: readonly string[]
  }
): ProblemContract {
  const id = `proposal-${contract.proposedAdditions.length}`
  const validProblemIds = new Set(
    contract.obligations
      .filter((item) => item.role === "given" && (item.scopeId === SHARED_SCOPE_ID || item.scopeId === proposal.scopeId))
      .map((item) => item.id)
  )

  let nextEntry: ProposedAddition
  if (proposal.kind === "free_choice") {
    nextEntry = {
      id,
      scopeId: proposal.scopeId,
      text: proposal.text,
      origin: "free_choice",
      status: "free_choice",
      promotedToGiven: false,
      reason: "模型补充的自由参数/取点选择，仅作当前视图选值，不作为原题硬前提。"
    }
  } else if (
    proposal.kind === "derived"
    && proposal.derivedFromIds !== undefined
    && proposal.derivedFromIds.length > 0
    && proposal.derivedFromIds.every((ref) => validProblemIds.has(ref))
  ) {
    nextEntry = {
      id,
      scopeId: proposal.scopeId,
      text: proposal.text,
      origin: "derived",
      status: "derived",
      promotedToGiven: false,
      derivedFromIds: [...proposal.derivedFromIds],
      reason: "已绑定原题已知前提的推导结论，保留推导出处而不覆盖原题设。"
    }
  } else {
    nextEntry = {
      id,
      scopeId: proposal.scopeId,
      text: proposal.text,
      origin: "proposed",
      status: "rejected_unjustified",
      promotedToGiven: false,
      reason: "未给出原题前提推导链，禁止把模型自选参数（如 a=2）升级为原题给定条件。"
    }
  }

  return {
    ...contract,
    proposedAdditions: [...contract.proposedAdditions, nextEntry]
  }
}

export function isContractStale(
  contract: Pick<ProblemContract, "source">,
  currentPrompt: string,
  currentSelectedScopeId?: string
): boolean {
  if (sha256Hex(currentPrompt) !== contract.source.rawHash) return true
  if (currentSelectedScopeId !== undefined && contract.source.selectedScopeId !== currentSelectedScopeId) return true
  return false
}

export { mapNormalizedRangeToOriginal, normalizeGeometryPromptWithSourceMap }
