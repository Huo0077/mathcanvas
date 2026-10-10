import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"
import { applyNormalisation, buildNormalisationPrompt, parseNormalisationReply } from "./promptNormalization"

/**
 * **题面规范化通道的三条安全阀**（设计 `docs/superpowers/specs/2026-10-10-prompt-normalisation-design.md`）。
 *
 * 这条通道存在的理由：用户写的是课本中文（`PA⊥底面 ABCD`），解析器认不出时**原来是把活推给用户**
 *（"请改用受支持的条件表达"）。让模型来换说法是对的 —— 但**模型不能改条件**，否则它就能把题面
 * 改弱成自己能画的样子，而门禁全绿（本仓吃过最大的亏正是"一张错图静默通过"）。
 *
 * 所以这一层的判据不是"改写好不好看"，而是：**指不回原文、引入新点名、或把关系换弱 ⇒ 一律拒**。
 */
const PROMPT = "在四棱锥 P-ABCD 中，PA⊥底面 ABCD，AB⊥AD，画示意图"
const UNREAD = [{ sourceText: "PA⊥底面 ABCD", reason: "原题出现了尚未被可靠解析的几何条件，未核验。" }]

const replyWith = (clauses: { original: string; normalized: string }[]) => ({ clauses })

describe("parseNormalisationReply", () => {
  it("accepts a rewrite that quotes the original and parses into a given", () => {
    const report = parseNormalisationReply(replyWith([{ original: "PA⊥底面 ABCD", normalized: "PA⊥平面 ABCD" }]), PROMPT, UNREAD)

    expect(report.rejected).toEqual([])
    expect(report.accepted).toHaveLength(1)
    expect(report.accepted[0]).toMatchObject({ original: "PA⊥底面 ABCD", normalized: "PA⊥平面 ABCD" })
    expect(report.accepted[0].givens).toBeGreaterThanOrEqual(1)

    // 改写之后，这条题设真的能读了（未核验里不再有它）。
    const normalized = applyNormalisation(PROMPT, report.accepted)
    expect(parseDiagramObligations(normalized).unverified).toEqual([])
    expect(parseDiagramObligations(normalized).givens.length).toBeGreaterThanOrEqual(2)
  })

  it("rejects a rewrite whose `original` is not a verbatim slice of the prompt", () => {
    const report = parseNormalisationReply(replyWith([{ original: "PA ⊥ 底面ABCD", normalized: "PA⊥平面 ABCD" }]), PROMPT, UNREAD)

    expect(report.accepted).toEqual([])
    expect(report.rejected[0]?.reason).toContain("原文")
  })

  it("rejects a rewrite that invents a point the problem never mentions", () => {
    const report = parseNormalisationReply(replyWith([{ original: "PA⊥底面 ABCD", normalized: "PA⊥平面 XBCD" }]), PROMPT, UNREAD)

    expect(report.accepted).toEqual([])
    expect(report.rejected[0]?.reason).toContain("点名")
  })

  it("rejects a rewrite that weakens the relation (⊥ must not become ∥)", () => {
    const prompt = "在四棱锥 P-ABCD 中，AB⊥AD，画示意图"
    const report = parseNormalisationReply(replyWith([{ original: "AB⊥AD", normalized: "AB∥AD" }]), prompt, [{ sourceText: "AB⊥AD", reason: "未核验。" }])

    expect(report.accepted).toEqual([])
    expect(report.rejected[0]?.reason).toContain("关系")
  })

  it("rejects a rewrite that does not parse into any condition", () => {
    const report = parseNormalisationReply(replyWith([{ original: "PA⊥底面 ABCD", normalized: "这句话说的是 PA 与底面垂直" }]), PROMPT, UNREAD)

    expect(report.accepted).toEqual([])
    expect(report.rejected[0]?.reason).toContain("读不出")
  })

  it("rejects a clause the parser never complained about (nothing to fix)", () => {
    const report = parseNormalisationReply(replyWith([{ original: "AB⊥AD", normalized: "AB⊥AD" }]), PROMPT, UNREAD)

    expect(report.accepted).toEqual([])
    expect(report.rejected[0]?.reason).toContain("未核验")
  })

  it("treats a malformed reply as no rewrite at all, instead of inventing one", () => {
    expect(parseNormalisationReply("这不是 JSON", PROMPT, UNREAD).accepted).toEqual([])
    expect(parseNormalisationReply({ clauses: [{ original: 1 }] }, PROMPT, UNREAD).accepted).toEqual([])
    expect(parseNormalisationReply({ clauses: [] }, PROMPT, UNREAD)).toEqual({ accepted: [], rejected: [] })
  })
})

describe("buildNormalisationPrompt", () => {
  it("hands the model exactly the clauses we could not read, and forbids changing the conditions", () => {
    const built = buildNormalisationPrompt(PROMPT, UNREAD)

    expect(built.user).toContain("PA⊥底面 ABCD")
    expect(built.system).toContain("不许")
    expect(built.system).toContain("原文")
  })
})

/**
 * **编译期接线**：模型把改写**随计划一起**交回来（不额外多一次往返），编译器拿它去解析题设。
 *
 * 用的是一组**已知合法**的四面体坐标（既有用例里那组），并把 `AD:AB=1` 改写成 `AD=AB` ——
 * 前者解析器读不出（今天仍读不出），后者能读、而且在那组坐标下**真的成立**（|AD| = |AB| = √2）。
 */
describe("编译期接线", () => {
  const PROMPT = "在三棱锥 A-BCD中，AD:AB=1，画示意图"
  const VERTICES = [{ x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }]
  const FACES = [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]
  const planWith = (normalisations: unknown) => ({
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "画示意图",
    factIds: [],
    ...(normalisations === undefined ? {} : { normalisations }),
    actions: [{ actionId: "solid.create_polyhedron", actionKey: "solid", factIds: [], inputs: { alias: "solid", vertices: VERTICES, faces: FACES, vertexNames: ["A", "B", "C", "D"] } }]
  }) as unknown as PlanEnvelope
  const compile = (plan: PlanEnvelope) => compilePlan(plan, { document: createEmptyDocument("geometry3d"), prompt: PROMPT, conversationId: "normalisation", documentGeneration: 0 })

  it("读不懂的那条，在改写成标准写法之后**真的被核验了**", () => {
    // 先钉住上游：这条写法今天确实读不出来。
    expect(parseDiagramObligations(PROMPT).unverified.some((entry) => entry.sourceText.includes("AD:AB=1"))).toBe(true)

    const result = compile(planWith([{ original: "AD:AB=1", normalized: "AD=AB" }]))

    expect(result.promptNormalisation?.accepted).toHaveLength(1)
    expect(result.diagramVerification?.checks.every((check) => check.kind !== "unparsed")).toBe(true)
    expect(result.diagramVerification?.status).toBe("passed")
  })

  it("**没有改写时行为一字不变**：那条照样是「未核验」", () => {
    const result = compile(planWith(undefined))

    expect(result.promptNormalisation).toBeUndefined()
    expect(result.diagramVerification?.checks.some((check) => check.kind === "unparsed")).toBe(true)
  })

  it("**模型编造条件时改写被丢掉**：题面照旧读不懂，绝不因此放行", () => {
    const result = compile(planWith([{ original: "AD:AB=1", normalized: "AX=AB" }]))

    // `X` 不在原文里 ⇒ 这一条被拒；报告如实留着它，而题设那一条仍然是未核验。
    expect(result.promptNormalisation?.accepted).toEqual([])
    expect(result.promptNormalisation?.rejected[0]?.reason).toContain("点名")
    expect(result.diagramVerification?.checks.some((check) => check.kind === "unparsed")).toBe(true)
  })
})
