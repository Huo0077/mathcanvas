import { createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"
import { compilePlan, planOf, type PlanEnvelope } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

import { createDraftStore } from "../draftStore"
import { createLocalPlanner } from "../localPlanner"
import { readSolidReport, writeSolidReport } from "../../../../../scripts/solid-eval/report-files.mjs"

/**
 * **40 条离线验收 / 泛化评测**（2026-11-01）。
 *
 * 题单在运行前固定：`test-fixtures/explicit-solid-acceptance/cases.json`。
 * 本文件只负责执行与独立回代，不把产品解析器或产品自己的 `passed` 当作唯一判据。
 *
 * 四类分母都保留：合法 16、缺信息 8、矛盾/不支持 8、人为错误计划 8。失败项不从分母删除；
 * 本轮不调用付费模型。
 */

interface Vec3 { x: number; y: number; z: number }
interface GeometryExpectation {
  kind: "sphere" | "prism"
  center?: Vec3
  radius?: number
  baseEdge?: number
  height?: number
  /** 底面边数（题面显式写了三 / 四 / 六 / 正 N 时）。 */
  sides?: number
  /** 底面是否是正多边形（各边相等 + 顶点共圆）。 */
  regular?: boolean
  /** `true` = 直棱柱；`false` = 斜棱柱；缺省 = 题面没要求。 */
  upright?: boolean
}
interface AcceptanceCase {
  id: string
  category: "legal" | "missing" | "invalid" | "wrong_plan"
  request: string
  prompt: string
  allowedTerminals: readonly ("plan" | "clarification" | "rejected")[]
  mustSatisfy: string
  geometry?: GeometryExpectation
  requireVerification?: boolean
  defaults?: { allowed: boolean; disclosure: readonly string[] }
  clarificationContains?: string
  plan?: unknown
}

interface CaseFile {
  version: number
  suite: string
  notice?: string
  cases: readonly AcceptanceCase[]
}

interface AcceptanceManifest {
  version: number
  suite: string
  notice?: string
  suites: readonly { name: string; file: string; expected: number }[]
}

type LoadedCase = AcceptanceCase & { suite: string }

interface GeometryFact { name: string; status: "passed" | "failed"; detail: string }
interface GeometryResult { status: "passed" | "failed" | "not_applicable"; facts: GeometryFact[] }

type Terminal = "plan" | "clarification" | "rejected" | "accepted" | "error"

interface CaseReport {
  id: string
  suite: string
  category: AcceptanceCase["category"]
  request: string
  prompt: string
  allowedTerminals: readonly string[]
  terminal: Terminal
  passed: boolean
  reason: string | null
  planKind: string | null
  compiledOk: boolean | null
  stagedOk: boolean | null
  verificationStatus: string | null
  independent: GeometryResult
  disclosureOk: boolean | null
  disclosureMissing: string[]
  disclosureText: string
  questions: string[]
  candidatePrimitives: number
  error: string | null
}

declare const process: { env: Record<string, string | undefined> }
const env = process.env
const REPORT_DIR = env.MATHCANVAS_EXPLICIT_ACCEPTANCE_REPORT
const CASES_FILE = env.MATHCANVAS_EXPLICIT_ACCEPTANCE_CASES
const REVISION = env.MATHCANVAS_EXPLICIT_ACCEPTANCE_REVISION ?? "unknown"

if (!REPORT_DIR?.trim()) throw new Error("Use scripts/explicit-solid-acceptance/runner.mjs — it selects a report directory")
if (!CASES_FILE?.trim()) throw new Error("Use scripts/explicit-solid-acceptance/runner.mjs — it selects the fixed case file")

const manifest = await readSolidReport(CASES_FILE) as AcceptanceManifest
if (manifest.version !== 1 || !Array.isArray(manifest.suites) || manifest.suites.length === 0) {
  throw new Error(`invalid acceptance manifest: ${JSON.stringify(manifest).slice(0, 160)}`)
}
const caseDir = CASES_FILE.slice(0, Math.max(CASES_FILE.lastIndexOf("/"), CASES_FILE.lastIndexOf("\\")) + 1)
const loadedCases: LoadedCase[] = []
for (const suiteEntry of manifest.suites) {
  const suite = await readSolidReport(`${caseDir}${suiteEntry.file}`) as CaseFile
  if (suite.version !== 1 || !Array.isArray(suite.cases) || suite.cases.length !== suiteEntry.expected) {
    throw new Error(`suite ${suiteEntry.name} must contain ${suiteEntry.expected} cases`)
  }
  loadedCases.push(...suite.cases.map((entry) => ({ ...entry, suite: suiteEntry.name })))
}
if (loadedCases.length !== manifest.suites.reduce((total, suiteEntry) => total + suiteEntry.expected, 0)) {
  throw new Error("manifest and loaded case counts disagree")
}

const subtract = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)
const near = (actual: number, expected: number): boolean => Math.abs(actual - expected) <= 1e-6 * Math.max(1, Math.abs(expected))

function newellNormal(points: readonly Vec3[]): Vec3 | null {
  let x = 0
  let y = 0
  let z = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    x += (current.y - next.y) * (current.z + next.z)
    y += (current.z - next.z) * (current.x + next.x)
    z += (current.x - next.x) * (current.y + next.y)
  }
  const normalLength = Math.hypot(x, y, z)
  return normalLength > 1e-12 ? { x: x / normalLength, y: y / normalLength, z: z / normalLength } : null
}

const SOLID_TYPES = new Set(["cube", "pyramid", "cylinder", "cone", "sphere", "polyhedron3"])

/**
 * **独立判据**：只从最终文档的图元读几何，自己做向量运算。
 * 不调用 `diagramVerification`，也不读产品报告的 `passed`。
 */
function evaluateGeometry(primitives: readonly PrimitiveSpec[], expected: GeometryExpectation | undefined): GeometryResult {
  if (expected === undefined) return { status: "not_applicable", facts: [] }
  const facts: GeometryFact[] = []
  const check = (name: string, ok: boolean, detail: string): void => {
    facts.push({ name, status: ok ? "passed" : "failed", detail })
  }
  const solids = primitives.filter((primitive) => SOLID_TYPES.has(primitive.type))
  check("only-one-solid", solids.length === 1, `最终图元里实体数量为 ${solids.length}（期望 1）`)

  if (expected.kind === "sphere") {
    const spheres = primitives.filter((primitive) => primitive.type === "sphere")
    check("one-sphere", spheres.length === 1, `最终图元里球体数量为 ${spheres.length}（期望 1）`)
    const sphere = spheres[0]
    if (sphere?.type !== "sphere") return { status: "failed", facts }
    if (expected.center !== undefined) {
      const gap = Math.max(
        Math.abs(sphere.center.x - expected.center.x),
        Math.abs(sphere.center.y - expected.center.y),
        Math.abs(sphere.center.z - expected.center.z)
      )
      check("sphere-center", gap <= 1e-9, `实测球心 (${sphere.center.x}, ${sphere.center.y}, ${sphere.center.z})；期望 (${expected.center.x}, ${expected.center.y}, ${expected.center.z})；最大偏差 ${gap}`)
    }
    if (expected.radius !== undefined) {
      check("sphere-radius", near(sphere.radius, expected.radius), `实测半径 ${sphere.radius}；期望 ${expected.radius}`)
    }
  } else {
    const prisms = primitives.filter((primitive) => primitive.type === "polyhedron3" && primitive.construction?.kind === "prism")
    check("one-prism", prisms.length === 1, `最终图元里棱柱数量为 ${prisms.length}（期望 1）`)
    const prism = prisms[0]
    if (prism?.type !== "polyhedron3" || prism.construction?.kind !== "prism") return { status: "failed", facts }
    const construction = prism.construction
    const polygon = construction.base.polygon
    const vector = construction.vector
    const normal = newellNormal(polygon)
    check("prism-base-nondegenerate", normal !== null, normal === null ? "底面法向退化" : "底面法向非退化")
    if (normal === null) return { status: "failed", facts }
    const edges = polygon.map((point, index) => length(subtract(point, polygon[(index + 1) % polygon.length]!)))
    if (expected.baseEdge !== undefined) {
      const worst = Math.max(...edges.map((edge) => Math.abs(edge - expected.baseEdge!)))
      check("prism-base-edge", edges.every((edge) => near(edge, expected.baseEdge!)), `底环各边 ${edges.map((edge) => edge.toPrecision(8)).join(", ")}；期望 ${expected.baseEdge}；最大偏差 ${worst}`)
    }
    if (expected.height !== undefined) {
      const height = Math.abs(dot(vector, normal))
      check("prism-vertical-height", near(height, expected.height), `实测两底面垂直高 ${height.toPrecision(8)}；期望 ${expected.height}；侧棱长 ${length(vector).toPrecision(8)}`)
    }
    const meanEdge = edges.reduce((sum, edge) => sum + edge, 0) / edges.length
    const equalEdges = edges.every((edge) => near(edge, meanEdge))
    const centroid = polygon.reduce((sum, point) => ({ x: sum.x + point.x / polygon.length, y: sum.y + point.y / polygon.length, z: sum.z + point.z / polygon.length }), { x: 0, y: 0, z: 0 })
    const radii = polygon.map((point) => length(subtract(point, centroid)))
    const maxRadius = Math.max(...radii)
    const concyclic = maxRadius > 0 && maxRadius - Math.min(...radii) <= 1e-6 * Math.max(1, maxRadius)
    const regular = equalEdges && concyclic
    const lateral = length(vector)
    const upright = Math.abs(Math.abs(dot(vector, normal)) - lateral) <= 1e-6 * Math.max(1, lateral)
    if (expected.sides !== undefined) {
      check("prism-sides", polygon.length === expected.sides, `实测底面边数 ${polygon.length}；期望 ${expected.sides}`)
    }
    if (expected.regular !== undefined) {
      check("prism-regular", regular === expected.regular, `实测底面 ${regular ? "是" : "不是"}正多边形（各边相等=${equalEdges}，顶点共圆=${concyclic}）；期望 ${expected.regular ? "是" : "不是"}`)
    }
    if (expected.upright !== undefined) {
      check("prism-upright", upright === expected.upright, `实测侧棱${upright ? "垂直" : "不垂直"}底面（侧棱长 ${lateral.toPrecision(8)}，垂直高 ${Math.abs(dot(vector, normal)).toPrecision(8)}）；期望${expected.upright ? "直" : "斜"}棱柱`)
    }
  }

  return { status: facts.every((fact) => fact.status === "passed") ? "passed" : "failed", facts }
}

function disclosureText(plan: PlanEnvelope): string {
  if (plan.kind !== "plan") return ""
  return [plan.goal, ...(plan.assumptions ?? [])].join("\n")
}

function checkDisclosure(entry: AcceptanceCase, plan: PlanEnvelope): { ok: boolean | null; missing: string[]; text: string } {
  if (entry.defaults?.allowed !== true || entry.defaults.disclosure.length === 0) return { ok: null, missing: [], text: "" }
  const text = disclosureText(plan)
  const missing = entry.defaults.disclosure.filter((fact) => !text.includes(fact))
  return { ok: missing.length === 0, missing, text }
}

function reportFor(
  entry: LoadedCase,
  partial: Omit<CaseReport, "id" | "suite" | "category" | "request" | "prompt" | "allowedTerminals">
): CaseReport {
  return {
    id: entry.id,
    suite: entry.suite,
    category: entry.category,
    request: entry.request,
    prompt: entry.prompt,
    allowedTerminals: entry.allowedTerminals,
    ...partial
  }
}

const planner = createLocalPlanner()
const reports: CaseReport[] = []
const startedAt = new Date().toISOString()

for (const entry of loadedCases) {
  const started = Date.now()
  try {
    if (entry.category === "wrong_plan") {
      const plan = entry.plan as PlanEnvelope
      const document = createEmptyDocument("geometry3d")
      const compiled = compilePlan(plan, { document, workspace: "geometry3d", prompt: entry.prompt, conversationId: `accept-${entry.id}`, documentGeneration: document.revision })
      const store = createDraftStore()
      const draft = store.create(document)
      const staged = plan.kind === "plan" ? await store.stage(draft.draftId, plan.actions, draft.draftVersion, entry.prompt) : null
      const blocked = !compiled.ok && staged !== null && !staged.ok
      const candidate = staged?.ok === true ? staged.preview.candidate : compiled.draftDocument
      const independent = candidate === null ? { status: "not_applicable" as const, facts: [] } : evaluateGeometry(candidate.primitives, entry.geometry)
      const error = blocked ? null : `错误计划未被双侧拦截：compilePlan.ok=${compiled.ok}，DraftStore.stage.ok=${staged?.ok ?? "not-run"}`
      reports.push(reportFor(entry, {
        terminal: blocked ? "rejected" : "accepted",
        passed: blocked,
        reason: error,
        planKind: plan.kind ?? null,
        compiledOk: compiled.ok,
        stagedOk: staged?.ok ?? null,
        verificationStatus: compiled.diagramVerification?.status ?? null,
        independent,
        disclosureOk: null,
        disclosureMissing: [],
        disclosureText: "",
        questions: [],
        candidatePrimitives: candidate?.primitives.length ?? 0,
        error: null
      }))
      await writeSolidReport(`${REPORT_DIR}/case-${entry.id}.json`, reports.at(-1), [env.DEEPSEEK_API_KEY ?? ""])
      continue
    }

    const outcome = await planner.plan({ userMessage: entry.prompt } as never)
    const plan = planOf(outcome)
    if (entry.allowedTerminals.includes("clarification")) {
      const questions = plan.kind === "clarification" ? plan.questions : []
      const gotClarification = plan.kind === "clarification"
      const contains = entry.clarificationContains === undefined || questions.join(" ").includes(entry.clarificationContains)
      const passed = gotClarification && contains
      reports.push(reportFor(entry, {
        terminal: gotClarification ? "clarification" : "plan",
        passed,
        reason: passed ? null : `期望澄清（含「${entry.clarificationContains ?? ""}」），实际为 ${plan.kind}${gotClarification && !contains ? `：${questions.join(" | ")}` : ""}`,
        planKind: plan.kind,
        compiledOk: null,
        stagedOk: null,
        verificationStatus: null,
        independent: { status: "not_applicable", facts: [] },
        disclosureOk: null,
        disclosureMissing: [],
        disclosureText: disclosureText(plan),
        questions,
        candidatePrimitives: 0,
        error: null
      }))
      await writeSolidReport(`${REPORT_DIR}/case-${entry.id}.json`, reports.at(-1), [env.DEEPSEEK_API_KEY ?? ""])
      continue
    }

    if (plan.kind !== "plan") {
      reports.push(reportFor(entry, {
        terminal: plan.kind === "clarification" ? "clarification" : "error",
        passed: false,
        reason: `期望 plan，实际为 ${plan.kind}${plan.kind === "clarification" ? `：${plan.questions.join(" | ")}` : ""}`,
        planKind: plan.kind,
        compiledOk: null,
        stagedOk: null,
        verificationStatus: null,
        independent: { status: "not_applicable", facts: [] },
        disclosureOk: null,
        disclosureMissing: [],
        disclosureText: disclosureText(plan),
        questions: plan.kind === "clarification" ? plan.questions : [],
        candidatePrimitives: 0,
        error: null
      }))
      await writeSolidReport(`${REPORT_DIR}/case-${entry.id}.json`, reports.at(-1), [env.DEEPSEEK_API_KEY ?? ""])
      continue
    }

    const document = createEmptyDocument("geometry3d")
    const compiled = compilePlan(plan, { document, workspace: "geometry3d", prompt: entry.prompt, conversationId: `accept-${entry.id}`, documentGeneration: document.revision })
    const store = createDraftStore()
    const draft = store.create(document)
    const staged = await store.stage(draft.draftId, plan.actions, draft.draftVersion, entry.prompt)
    const candidate = staged.ok ? staged.preview.candidate : compiled.draftDocument
    const independent = candidate === null ? { status: "failed" as const, facts: [{ name: "candidate", status: "failed" as const, detail: "没有最终候选文档" }] } : evaluateGeometry(candidate.primitives, entry.geometry)
    const verificationStatus = staged.ok ? staged.preview.diagramVerification?.status ?? null : compiled.diagramVerification?.status ?? null
    const disclosure = checkDisclosure(entry, plan)
    const verificationOk = entry.requireVerification !== true || verificationStatus === "passed"
    const passed = compiled.ok && staged.ok && independent.status === "passed" && (disclosure.ok !== false) && verificationOk
    const reasons = [
      compiled.ok ? null : `compilePlan 拒绝：${compiled.diagnostics.map((item) => item.detail).join("; ")}`,
      staged.ok ? null : `DraftStore.stage 拒绝：${staged.ok ? "" : staged.diagnostics?.map((item) => item.message).join("; ") ?? staged.reason}`,
      independent.status === "passed" ? null : `独立几何判据失败：${independent.facts.filter((fact) => fact.status === "failed").map((fact) => `${fact.name}: ${fact.detail}`).join("; ")}`,
      disclosure.ok === false ? `默认值披露缺失：${disclosure.missing.join("、")}` : null,
      verificationOk ? null : `要求题设核验 passed，实际为 ${verificationStatus ?? "undefined"}`
    ].filter((item): item is string => item !== null)
    reports.push(reportFor(entry, {
      terminal: "plan",
      passed,
      reason: reasons.length === 0 ? null : reasons.join("；"),
      planKind: plan.kind,
      compiledOk: compiled.ok,
      stagedOk: staged.ok,
      verificationStatus,
      independent,
      disclosureOk: disclosure.ok,
      disclosureMissing: disclosure.missing,
      disclosureText: disclosure.text,
      questions: [],
      candidatePrimitives: candidate?.primitives.length ?? 0,
      error: null
    }))
    await writeSolidReport(`${REPORT_DIR}/case-${entry.id}.json`, reports.at(-1), [env.DEEPSEEK_API_KEY ?? ""])
  } catch (caught) {
    const error = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught)
    reports.push(reportFor(entry, {
      terminal: "error",
      passed: false,
      reason: error,
      planKind: null,
      compiledOk: null,
      stagedOk: null,
      verificationStatus: null,
      independent: { status: "failed", facts: [{ name: "execution", status: "failed", detail: error }] },
      disclosureOk: null,
      disclosureMissing: [],
      disclosureText: "",
      questions: [],
      candidatePrimitives: 0,
      error
    }))
    await writeSolidReport(`${REPORT_DIR}/case-${entry.id}.json`, reports.at(-1), [env.DEEPSEEK_API_KEY ?? ""])
  }
  void started
}

const byCategory = (category: AcceptanceCase["category"]) => reports.filter((report) => report.category === category)
const summary = {
  suite: manifest.suite,
  mode: "offline",
  revision: REVISION,
  startedAt,
  notice: manifest.notice,
  cases: reports,
  suites: Object.fromEntries(manifest.suites.map((suiteEntry) => {
    const suiteReports = reports.filter((report) => report.suite === suiteEntry.name)
    return [suiteEntry.name, {
      total: suiteReports.length,
      passed: suiteReports.filter((report) => report.passed).length,
      rate: suiteReports.length === 0 ? 0 : suiteReports.filter((report) => report.passed).length / suiteReports.length
    }]
  })),
  categories: {
    legal: {
      total: byCategory("legal").length,
      passed: byCategory("legal").filter((report) => report.passed).length,
      rate: byCategory("legal").filter((report) => report.passed).length / byCategory("legal").length
    },
    missing: {
      total: byCategory("missing").length,
      passed: byCategory("missing").filter((report) => report.passed).length,
      rate: byCategory("missing").filter((report) => report.passed).length / byCategory("missing").length
    },
    invalid: {
      total: byCategory("invalid").length,
      passed: byCategory("invalid").filter((report) => report.passed).length,
      rate: byCategory("invalid").filter((report) => report.passed).length / byCategory("invalid").length
    },
    wrongPlan: {
      total: byCategory("wrong_plan").length,
      blocked: byCategory("wrong_plan").filter((report) => report.passed).length,
      rate: byCategory("wrong_plan").filter((report) => report.passed).length / byCategory("wrong_plan").length,
      compilerAccepted: byCategory("wrong_plan").filter((report) => report.compiledOk === true).length,
      draftAccepted: byCategory("wrong_plan").filter((report) => report.stagedOk === true).length
    }
  },
  wrongFigureAccepted: reports.filter((report) => report.passed === false && (report.compiledOk === true || report.stagedOk === true)).length,
  acceptedErrorIds: reports.filter((report) => report.passed === false && (report.compiledOk === true || report.stagedOk === true)).map((report) => report.id),
  totals: {
    cases: reports.length,
    ran: reports.length,
    passed: reports.filter((report) => report.passed).length
  },
  notRun: [],
  incomplete: 0,
  costUsd: null,
  costKnown: false,
  notes: [
    "自编离线验收题单，未经独立人工复核；不是真实模型盲测，也不代表真实 provider 成功率。",
    "独立判据只读最终候选文档的图元并自行计算球心/半径、底边/垂直高、底面边数、正多边形条件与直/斜关系，不读产品 passed 作为唯一判据。",
    "错误图被当作成功：**所有类别**中，失败项只要在 compilePlan 或 DraftStore.stage 任一侧通过就计入，不只统计 wrong_plan。",
    "未执行数为 0；所有题都跑过。"
  ]
}

await writeSolidReport(`${REPORT_DIR}/summary.json`, summary, [env.DEEPSEEK_API_KEY ?? ""])

describe("explicit solid 54-case offline acceptance", () => {
  it("ran every fixed case and recorded a machine-readable report", () => {
    expect(reports).toHaveLength(54)
    expect(summary.totals.ran).toBe(54)
  })

  it("meets the pre-registered category thresholds", () => {
    expect(summary.suites["baseline-40"].passed, JSON.stringify(reports.filter((report) => report.suite === "baseline-40" && !report.passed), null, 2)).toBe(40)
    expect(summary.suites["external-review"].passed, JSON.stringify(reports.filter((report) => report.suite === "external-review" && !report.passed), null, 2)).toBe(14)
    expect(summary.categories.legal.passed, JSON.stringify(reports.filter((report) => report.category === "legal" && !report.passed), null, 2)).toBe(22)
    expect(summary.categories.missing.passed, JSON.stringify(reports.filter((report) => report.category === "missing" && !report.passed), null, 2)).toBe(10)
    expect(summary.categories.invalid.passed, JSON.stringify(reports.filter((report) => report.category === "invalid" && !report.passed), null, 2)).toBe(14)
    expect(summary.categories.wrongPlan.blocked, JSON.stringify(reports.filter((report) => report.category === "wrong_plan" && !report.passed), null, 2)).toBe(8)
    expect(summary.wrongFigureAccepted).toBe(0)
  })
})
