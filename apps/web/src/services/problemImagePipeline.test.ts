import { describe, expect, it } from "vitest"

import type { SolveContext } from "@draw/agent-core"
import {
  auditProblemImage,
  type AttachmentHandle,
  type DiagramItemInput
} from "./problemImageEvidence"
import { applyImageAudit, orthographicViewReadings, runImageRereadCycle, toOriginalRegion } from "./problemImagePipeline"

/**
 * **W4：图像证据流水线（2026-11-09）**。
 *
 * W6 交付的是"证据能不能追到原图"，W4 要回答的是**读完之后能不能解题**：
 * ① 体积/图形选择题需要哪些字段（缺了就重读或如实说未完成）；
 * ② 重读最多 2 次，没有新信息就**停下**（不要用一个一模一样的读数烧预算）；
 * ③ 冲突保留第一次读数，用户更正优先；
 * ④ 重读改写证据后 `sourceRevision` 必须变化，旧证据因此失效。
 *
 * 这里只注入"读图"这一件事（真实实现来自 `problemImageReader`），其余全是纯函数。
 */

const shaA = "a".repeat(64)
const attachments: AttachmentHandle[] = [{ attachmentId: "att-1", sha256: shaA, conversationId: "conv-1" }]

const hash = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
  .map((byte) => byte.toString(16).padStart(2, "0")).join("")

const label: DiagramItemInput = { text: "图1", image: 1, box: null }

describe("W4 — 裁图坐标回映到原图", () => {
  it("maps a crop-local region back to the original image", () => {
    expect(toOriginalRegion({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 }, { x: 0.2, y: 0.4, width: 0.4, height: 0.2 }))
      .toEqual({ x: 0.4, y: 0.5, width: 0.2, height: 0.1 })
  })

  it("clamps within the image instead of producing an out-of-range region", () => {
    const mapped = toOriginalRegion({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 })
    expect(mapped.x + mapped.width).toBeLessThanOrEqual(1 + 1e-9)
    expect(mapped.y + mapped.height).toBeLessThanOrEqual(1 + 1e-9)
  })
})

describe("W4 — 只有定位标签的体积题必须重读", () => {
  it("re-reads once and re-audits, clearing the gap only after dimensions arrive", async () => {
    let calls = 0
    const outcome = await runImageRereadCycle({
      attachments,
      conversationId: "conv-1",
      problem: "如图，求该几何体的体积。",
      diagram: [label],
      target: "volume",
      reread: async () => {
        calls += 1
        return calls === 1
          ? [{ text: "底面边长 4", image: 1, box: [0.1, 0.1, 0.5, 0.5] }, { text: "高 3", image: 1, box: [0.5, 0.5, 0.9, 0.9] }]
          : []
      }
    })

    expect(outcome.used).toBe(1)
    expect(outcome.requests[0]?.missing).toContain("missing_dimension")
    expect(outcome.required.filter((gap) => gap.required)).toEqual([])
    expect(outcome.stopped).toBe("resolved")
    expect(outcome.audit.facts.some((fact) => /高\s*3/.test(fact.text))).toBe(true)
  })

  it("stops immediately when the reread repeats the same reading", async () => {
    let calls = 0
    const outcome = await runImageRereadCycle({
      attachments,
      conversationId: "conv-1",
      problem: "如图，求该几何体的体积。",
      diagram: [label],
      target: "volume",
      reread: async () => { calls += 1; return [label] }
    })

    expect(calls).toBe(1)
    expect(outcome.used).toBe(1)
    expect(outcome.stopped).toBe("no_change")
    expect(outcome.required.some((gap) => gap.code === "missing_dimension")).toBe(true)
  })

  it("stops at the two-attempt limit when the gap never closes", async () => {
    let calls = 0
    const outcome = await runImageRereadCycle({
      attachments,
      conversationId: "conv-1",
      problem: "如图，求该几何体的体积。",
      diagram: [label],
      target: "volume",
      reread: async () => {
        calls += 1
        return [{ text: `高 ${calls + 2}`, image: 1, box: [0.5, 0.5, 0.9, 0.9], sourceKind: "model_guess" }]
      }
    })

    expect(calls).toBe(2)
    expect(outcome.used).toBe(2)
    expect(outcome.stopped).toBe("no_change")
    expect(outcome.required.some((gap) => gap.code === "missing_dimension")).toBe(true)
  })

  it("never starts a request when the budget is already spent", async () => {
    let calls = 0
    const outcome = await runImageRereadCycle({
      attachments,
      conversationId: "conv-1",
      problem: "如图，求该几何体的体积。",
      diagram: [label],
      target: "volume",
      limit: 0,
      reread: async () => { calls += 1; return [] }
    })

    expect(calls).toBe(0)
    expect(outcome.used).toBe(0)
    expect(outcome.stopped).toBe("budget_exhausted")
  })

  it("does not let a model guess clear the gap", async () => {
    const outcome = await runImageRereadCycle({
      attachments,
      conversationId: "conv-1",
      problem: "如图，求该几何体的体积。",
      diagram: [label],
      target: "volume",
      reread: async () => [
        { text: "高 3", image: 1, box: [0.5, 0.5, 0.9, 0.9], sourceKind: "model_guess" },
        { text: "底面边长 4", image: 1, box: [0.1, 0.1, 0.5, 0.5], sourceKind: "model_guess" }
      ]
    })

    expect(outcome.required.some((gap) => gap.code === "missing_dimension")).toBe(true)
    const dimensionFacts = outcome.audit.facts.filter((fact) => /高|边长/.test(fact.text))
    expect(dimensionFacts.length).toBeGreaterThan(0)
    expect(dimensionFacts.every((fact) => fact.ref.sourceKind === "model_guess")).toBe(true)
  })

  it("keeps the first reading and records a conflict when the reread disagrees", async () => {
    const outcome = await runImageRereadCycle({
      attachments,
      conversationId: "conv-1",
      problem: "如图，求该几何体的体积。",
      diagram: [{ text: "高 3", image: 1, box: [0.5, 0.5, 0.9, 0.9] }, label],
      target: "volume",
      reread: async () => [{ text: "高 5", image: 1, box: [0.5, 0.5, 0.9, 0.9] }]
    })

    expect(outcome.conflicts[0]?.reason).toBe("visual_conflict")
    expect(outcome.audit.facts.filter((fact) => fact.ref.region.x === 0.5).map((fact) => fact.text)).toEqual(["高 3"])
  })
})

describe("W4 — 重读后的 sourceRevision 必须变化", () => {
  it("invalidates old evidence while keeping the problem revision", async () => {
    const context: SolveContext = {
      runId: "r1", conversationId: "conv-1", prompt: "如图，求体积。", attachments: [],
      corrections: [], sceneRevision: "scene", problemRevision: "p".repeat(64), sourceRevision: "s".repeat(64),
      understanding: { goals: [], ir: { obligations: [], conditions: [] }, unrecognizedMathGoal: false } as unknown as SolveContext["understanding"],
      unrecognizedMathGoal: false
    }
    const audit = auditProblemImage({
      attachments, conversationId: "conv-1", problem: "如图，求体积。",
      diagram: [{ text: "高 3", image: 1, box: [0.1, 0.1, 0.5, 0.5] }]
    })

    const first = await applyImageAudit(context, audit, hash)
    const again = await applyImageAudit(context, audit, hash)
    expect(first.sourceRevision).toMatch(/^[a-f0-9]{64}$/)
    expect(first.sourceRevision).toBe(again.sourceRevision)
    expect(first.sourceRevision).not.toBe(context.sourceRevision)
    expect(first.problemRevision).toBe(context.problemRevision)
    expect(first.understanding).toBe(context.understanding)

    const changed = await applyImageAudit(context, { ...audit, facts: [...audit.facts, { id: "f2", ref: audit.facts[0]!.ref, text: "底面边长 4", confidence: "high" }] }, hash)
    expect(changed.sourceRevision).not.toBe(first.sourceRevision)
  })

  it("leaves the context untouched when there is no evidence at all", async () => {
    const context = {} as SolveContext
    const empty = { facts: [], gaps: [], attachments: [] }
    const result = await applyImageAudit(context, empty, hash)
    expect(result.sourceRevision).toBe(context.sourceRevision)
  })

  it("records the requested regions so the trace can show what was re-read", async () => {
    const outcome = await runImageRereadCycle({
      attachments, conversationId: "conv-1", problem: "如图，求体积。", diagram: [label], target: "volume",
      reread: async () => [{ text: "底面边长 4", image: 1, box: [0.1, 0.1, 0.5, 0.5] }]
    })
    expect(outcome.requests[0]).toMatchObject({ attachmentId: "att-1", region: { x: 0, y: 0, width: 1, height: 1 } })
  })
})

/**
 * **W7 接线：图上的三视图读数整理成宿主可解析的规范句**。
 *
 * 体积判据只认这条规范句里的视图身份与尺寸 —— 模型散文里的"大概 4×3"不算。
 */
describe("W7 三视图读数规范化", () => {
  it("builds the canonical three-view line and deduplicates repeated labels", () => {
    const line = orthographicViewReadings([
      { text: "主视图 4×3 的矩形" }, { text: "俯视图 4×2 的矩形" }, { text: "左视图 2×3 的矩形" },
      { text: "主视图（重复）4×3" }, { text: "无关读数 AB=4" }
    ])
    expect(line).toBe("三视图读数：主视图 4×3 矩形；俯视图 4×2 矩形；左视图 2×3 矩形")
  })

  it("keeps the triangular outline marker so the pyramid family is derivable", () => {
    expect(orthographicViewReadings([{ text: "主视图 4×3 三角形" }])).toBe("三视图读数：主视图 4×3 三角形")
  })

  it("returns undefined when there is no view reading at all", () => {
    expect(orthographicViewReadings([{ text: "AB=4" }, { text: "图1" }])).toBeUndefined()
    expect(orthographicViewReadings([{ text: "主视图（位置待核对）" }])).toBeUndefined()
  })
})

it("a diagram with no localized readings schedules one bounded full-image reread", async () => {
  let calls = 0
  const outcome = await runImageRereadCycle({ attachments, conversationId: "conv-1", problem: "如图，求该几何体的体积。",
    diagram: [], target: "volume", reread: async request => { calls += 1; expect(request.region).toEqual({ x: 0, y: 0, width: 1, height: 1 }); return [] } })
  expect(calls).toBe(1)
  expect(outcome.used).toBe(1)
  expect(outcome.required.some(gap => gap.code === "missing_dimension" && gap.required)).toBe(true)
})
