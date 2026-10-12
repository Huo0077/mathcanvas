import { describe, expect, it } from "vitest"

import {
  DEFAULT_LAYOUT_THRESHOLDS,
  diagnoseLayout,
  evidenceIdentityProblem,
  layoutVerificationReport,
  overlapRatio,
  renderEvidenceStaleness,
  screenshotForProvider,
  visibleRatio,
  type LayoutBox,
  type RenderEvidence,
  type Viewport
} from "./renderEvidence"

/**
 * **渲染证据与本地布局诊断**（Phase 4 / Task 4.1 + 4.2）。
 *
 * 这一组用例的判据是计划里那句阶段门槛：
 * "**至少有一个纯本地视觉/布局验证路径，不依赖 provider vision 才能发现明显布局错误。**"
 *
 * 所以每个"明显布局错误"都要有一条用例，而且它们**一条模型都没用到**。
 */

const viewport: Viewport = { width: 1000, height: 800 }
const object = (id: string, x: number, y: number, width: number, height: number): LayoutBox => ({ id, kind: "object", x, y, width, height })
const label = (id: string, x: number, y: number, width: number, height: number): LayoutBox => ({ id, kind: "label", x, y, width, height })
/** 两个可辨认的内容哈希（`canonicalContentHash` 的形状：64 位小写十六进制）。 */
const HASH_A = "a".repeat(64)
const HASH_B = "b".repeat(64)

describe("local layout diagnostics", () => {
  it("reports an empty canvas when no drawable object is in the viewport", () => {
    expect(diagnoseLayout(viewport, []).map((entry) => entry.code)).toEqual(["empty_canvas"])
    // 只有标签不算有内容：那正是"看起来画了、其实什么都没有"的样子。
    expect(diagnoseLayout(viewport, [label("L", 10, 10, 40, 12)]).map((entry) => entry.code)).toEqual(["empty_canvas"])
  })

  it("reports an object that is entirely outside the viewport as an error", () => {
    const diagnostics = diagnoseLayout(viewport, [object("cube-1", 2000, 2000, 100, 100)])

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ code: "clipped_object", severity: "error", objectIds: ["cube-1"] })
    expect(diagnostics[0].detail).toContain("entirely outside")
  })

  it("reports a partially clipped object as a warning with the actual ratio", () => {
    // 一半在视口外（x 从 950 到 1050，视口宽 1000）。
    const diagnostics = diagnoseLayout(viewport, [object("cube-1", 950, 100, 100, 100)])

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].code).toBe("clipped_object")
    expect(diagnostics[0].severity).toBe("warning")
    expect(diagnostics[0].detail).toContain("50%")
  })

  it("reports overlapping labels and names both of them", () => {
    const diagnostics = diagnoseLayout(viewport, [
      object("cube-1", 100, 100, 200, 200),
      label("A", 300, 300, 60, 20),
      label("B", 305, 302, 60, 20)
    ])

    const overlap = diagnostics.find((entry) => entry.code === "label_overlap")
    expect(overlap).toBeDefined()
    expect(overlap?.objectIds).toEqual(["A", "B"])
    expect(overlap?.severity).toBe("warning")
  })

  it("does not report labels that merely sit near each other", () => {
    // 保守判据：不乱报警，否则用户会学会忽略这个检查器。
    const diagnostics = diagnoseLayout(viewport, [
      object("cube-1", 100, 100, 200, 200),
      label("A", 300, 300, 60, 20),
      label("B", 400, 300, 60, 20)
    ])

    expect(diagnostics).toEqual([])
  })

  it("does not flag objects occluding each other, because that is normal in 3D", () => {
    // 图形互相压住是正常的（3D 必然有遮挡）；只有**标签**叠在一起才看不清。
    const diagnostics = diagnoseLayout(viewport, [object("cube-1", 100, 100, 200, 200), object("cube-2", 150, 150, 200, 200)])

    expect(diagnostics).toEqual([])
  })

  it("refuses to judge anything when the viewport itself is degenerate", () => {
    /**
     * 视口是 0×0 时，后面每一条判定都没有意义。如实说这一条，
     * 而不是报一堆下游噪声（"所有对象都出界了"是假的：是没有视口）。
     */
    const diagnostics = diagnoseLayout({ width: 0, height: 0 }, [object("cube-1", 0, 0, 10, 10)])

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].code).toBe("degenerate_viewport")
  })

  it("measures visible ratio and overlap ratio directly", () => {
    expect(visibleRatio(object("a", 0, 0, 100, 100), viewport)).toBe(1)
    expect(visibleRatio(object("a", 950, 0, 100, 100), viewport)).toBeCloseTo(0.5, 5)
    expect(visibleRatio(object("a", 1000, 0, 100, 100), viewport)).toBe(0)
    expect(overlapRatio(object("a", 0, 0, 100, 100), object("b", 50, 50, 100, 100))).toBeCloseTo(0.25, 5)
  })
})

describe("layout diagnostics fold into the verification contract", () => {
  it("reports failed when something is entirely outside or the canvas is empty", () => {
    const failed = layoutVerificationReport(diagnoseLayout(viewport, [object("cube-1", 2000, 2000, 10, 10)]))
    expect(failed.status).toBe("failed")
    expect(failed.checks[0].status).toBe("failed")
    expect(failed.next_actions.length).toBeGreaterThan(0)

    const empty = layoutVerificationReport(diagnoseLayout(viewport, []))
    expect(empty.status).toBe("failed")
  })

  it("reports passed with no next_actions for a clean layout", () => {
    const report = layoutVerificationReport(diagnoseLayout(viewport, [object("cube-1", 100, 100, 300, 300)]))
    expect(report.status).toBe("passed")
    expect(report.next_actions).toEqual([])
  })

  it("keeps warnings visible without turning them into a failure", () => {
    /**
     * "能看见、但有一处小瑕疵"与"看不见"是两件事。把两者混成同一个 `failed`
     * 会让这条信号失去分辨力：用户无法再区分"得修"与"知道就行"。
     */
    const report = layoutVerificationReport(diagnoseLayout(viewport, [object("cube-1", 950, 100, 100, 100)]))

    expect(report.status).toBe("passed")
    expect(report.checks).toHaveLength(1)
    expect(report.checks[0].status).toBe("passed")
    expect(report.checks[0].detail).toContain("50%")
  })
})

describe("screenshots never reach a provider without verified vision", () => {
  const evidence: RenderEvidence = {
    mode: "vision_verified",
    runId: "run-1",
    draftId: "draft_1",
    draftVersion: 3,
    documentHash: HASH_A,
    viewport,
    boxes: [object("cube-1", 10, 10, 100, 100)],
    screenshot: { mimeType: "image/png", base64: "AAAA", width: 1000, height: 800 }
  }

  it("refuses to send a screenshot when the provider's vision is not verified", () => {
    const result = screenshotForProvider(evidence, false)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("not verified")
  })

  it("refuses structured-only evidence even when vision is verified", () => {
    // 模式与能力是两件事：有能力但这次没截图，同样不能发。
    const result = screenshotForProvider({ ...evidence, mode: "structured_only" }, true)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("structured_only")
  })

  it("refuses a screenshot with no mime type, no bytes, or no size", () => {
    expect(screenshotForProvider({ ...evidence, screenshot: { ...evidence.screenshot!, mimeType: "" } }, true).ok).toBe(false)
    expect(screenshotForProvider({ ...evidence, screenshot: { ...evidence.screenshot!, base64: "" } }, true).ok).toBe(false)
    expect(screenshotForProvider({ ...evidence, screenshot: { ...evidence.screenshot!, width: 0 } }, true).ok).toBe(false)
    expect(screenshotForProvider({ ...evidence, screenshot: { ...evidence.screenshot!, mimeType: "application/pdf" } }, true).ok).toBe(false)
    expect(screenshotForProvider({ ...evidence, screenshot: undefined }, true).ok).toBe(false)
  })

  it("sends the screenshot only when vision is verified and the artifact is complete", () => {
    const result = screenshotForProvider(evidence, true)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.screenshot.mimeType).toBe("image/png")
  })
})

describe("render evidence identity", () => {
  it("rejects evidence that is not bound to a run, a draft and a draft version", () => {
    // 证据绑不上草稿时，"用户确认的是不是他看过的那一份"又变成猜想。
    expect(evidenceIdentityProblem({ runId: "", draftId: "d", draftVersion: 1, documentHash: HASH_A })).toContain("runId")
    expect(evidenceIdentityProblem({ runId: "r", draftId: "", draftVersion: 1, documentHash: HASH_A })).toContain("draftId")
    expect(evidenceIdentityProblem({ runId: "r", draftId: "d", draftVersion: 0, documentHash: HASH_A })).toContain("draftVersion")
    expect(evidenceIdentityProblem({ runId: "r", draftId: "d", draftVersion: 1.5, documentHash: HASH_A })).toContain("draftVersion")
    expect(evidenceIdentityProblem({ runId: "r", draftId: "d", draftVersion: 1, documentHash: HASH_A })).toBeNull()
  })

  /**
   * **证据还要绑"哪一版内容"**（Task 16）。
   *
   * 只有 `draftVersion` 时，"这份截图是哪份文档的"仍然答不出来：**改题**与**撤销**
   * 都会让版本号往前走一格，而"改的是不是这张图上那些东西"要靠**内容哈希**才说得清。
   * 所以哈希是**必填**，而且格式不对（不是 64 位十六进制）也要当场拒。
   */
  it("rejects evidence that is not bound to a document content hash", () => {
    expect(evidenceIdentityProblem({ runId: "r", draftId: "d", draftVersion: 1, documentHash: "" })).toContain("documentHash")
    expect(evidenceIdentityProblem({ runId: "r", draftId: "d", draftVersion: 1, documentHash: "deadbeef" })).toContain("documentHash")
    expect(evidenceIdentityProblem({ runId: "r", draftId: "d", draftVersion: 1, documentHash: HASH_A })).toBeNull()
  })

  it("exposes the default thresholds it judges with", () => {
    // 阈值必须是可读的常数，而不是散在判据里的字面量（否则没法解释"为什么这条没报"）。
    expect(DEFAULT_LAYOUT_THRESHOLDS.minVisibleAreaRatio).toBeGreaterThan(0)
    expect(DEFAULT_LAYOUT_THRESHOLDS.labelOverlapRatio).toBeGreaterThan(0)
  })
})

/**
 * **旧图证据"过期"的判据**（Task 16）。
 *
 * 计划退出条件：**"改题或撤销后旧图证据 stale"**。这一组钉四件事：
 *
 * ① 判据看的是**内容哈希**，不是版本号 —— 版本往前走但内容没变（暂存了同一份图）时，
 *    旧证据**依然新鲜**。拿版本号当判据会把"什么都没改"报成过期，那种噪声会让用户
 *    学会忽略这条提示（与 `diagnoseLayout` 刻意保守是同一条理由）。
 * ② 内容变了（`document_changed`）与**换了另一份草稿**（`draft_replaced`）分开说：
 *    前者是"改题 / 撤销"，后者是"切文档"，用户要做的事不一样。
 * ③ 理由里必须能看见**两个哈希的前缀** —— 否则用户不知道该拿哪一份去比。
 * ④ **带截图也不改变结论**：截图是"看过的样子"，不是"现在的内容"。
 */
describe("render evidence staleness", () => {
  const evidence = { draftId: "draft_1", draftVersion: 3, documentHash: HASH_A, screenshot: { mimeType: "image/png", base64: "AAAA", width: 10, height: 10 } }

  it("treats a newer draft version with the same content as fresh", () => {
    const verdict = renderEvidenceStaleness(evidence, { draftId: "draft_1", documentHash: HASH_A })
    expect(verdict.stale).toBe(false)
    expect(verdict.kind).toBe("fresh")
  })

  it("goes stale when the document content changes, and names both hashes", () => {
    const verdict = renderEvidenceStaleness(evidence, { draftId: "draft_1", documentHash: HASH_B })
    expect(verdict).toMatchObject({ stale: true, kind: "document_changed" })
    // 判别联合要先收窄再读 `detail`（`tsc` 会抓，vitest 不会）。
    if (!verdict.stale) throw new Error("改题/撤销之后这份证据必须过期")
    expect(verdict.detail).toContain(HASH_A.slice(0, 12))
    expect(verdict.detail).toContain(HASH_B.slice(0, 12))
  })

  it("goes stale when another draft is on screen now", () => {
    const verdict = renderEvidenceStaleness(evidence, { draftId: "draft_2", documentHash: HASH_B })
    expect(verdict.stale).toBe(true)
    expect(verdict.kind).toBe("draft_replaced")
  })

  it("stays stale even when the old evidence carries a screenshot", () => {
    // "截图不能替代条件回代"的另一种形态：截图也不能让旧图证据变新鲜。
    const withShot = { ...evidence, screenshot: { mimeType: "image/png", base64: "AAAABBBB", width: 800, height: 600 } }
    expect(renderEvidenceStaleness(withShot, { draftId: "draft_1", documentHash: HASH_B }).stale).toBe(true)
  })
})
