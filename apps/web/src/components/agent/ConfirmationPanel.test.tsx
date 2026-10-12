import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { AgentDraftView } from "../../agentStore"
import type { DiagramCheck } from "@draw/agent-core"
import { proofScopeOf } from "@draw/agent-core"
import { ConfirmationPanel } from "./ConfirmationPanel"
import { countDeltas } from "./confirmationCounts"

/**
 * Task 2.5 Step 4 点名的六样东西，逐条在这里：精确计数、假设、来源与目标、近似、
 * 删除/锁定警告、一步撤销声明。
 */
function draft(overrides: Partial<AgentDraftView> = {}): AgentDraftView {
  return {
    draftId: "draft_1",
    draftVersion: 2,
    previewHash: "hash-abc",
    stageCount: 1,
    undoesInOneStep: true,
    baseCounts: { user: 0, hidden: 0, derived: 0, internal: 0, total: 0 },
    counts: { user: 1, hidden: 0, derived: 0, internal: 0, total: 1 },
    ...overrides
  }
}

describe("exact counts", () => {
  it("shows only the categories that actually change", () => {
    // 一份没有变化的清单会把真正需要注意的那一行埋掉。
    const rows = countDeltas(draft())

    expect(rows.map((row) => row.label)).toEqual(["可编辑对象"])
  })

  it("renders the before and after numbers for a change", () => {
    render(<ConfirmationPanel draft={draft()} />)

    const row = globalThis.document.querySelector('tr[data-changed="added"]')!
    expect(row.textContent).toContain("可编辑对象")
    expect(row.textContent).toContain("0")
    expect(row.textContent).toContain("1")
  })

  it("says how many objects the change adds or removes in total", () => {
    render(<ConfirmationPanel draft={draft()} />)
    expect(screen.getByText(/会新增 1 个对象/)).toBeTruthy()
  })

  it("distinguishes internal detail from editable objects", () => {
    // 内部近似细节在文档里但画布上不画；混进"可编辑"会让用户以为确认后画布上多出几十个点。
    render(<ConfirmationPanel draft={draft({
      baseCounts: { user: 1, hidden: 0, derived: 0, internal: 0, total: 1 },
      counts: { user: 1, hidden: 0, derived: 0, internal: 48, total: 49 }
    })} />)

    const body = globalThis.document.querySelector(".agent-confirmation-counts")!.textContent ?? ""
    expect(body).toContain("内部细节")
    expect(body).toContain("画布与对象列表都不显示")
    expect(body).toContain("48")
  })

  it("counts hidden objects separately so the user knows they will not appear", () => {
    render(<ConfirmationPanel draft={draft({
      counts: { user: 1, hidden: 2, derived: 0, internal: 0, total: 3 }
    })} />)

    expect(globalThis.document.querySelector(".agent-confirmation-counts")!.textContent).toContain("画布上看不见")
  })

  it("admits when the counts are missing instead of inventing a scale", () => {
    render(<ConfirmationPanel draft={draft({ counts: undefined, baseCounts: undefined })} />)

    expect(screen.getByText(/无法核对/)).toBeTruthy()
  })
})

describe("deletion warning", () => {
  it("warns loudly when the change removes existing objects", () => {
    render(<ConfirmationPanel draft={draft({
      baseCounts: { user: 3, hidden: 0, derived: 0, internal: 0, total: 3 },
      counts: { user: 1, hidden: 0, derived: 0, internal: 0, total: 1 }
    })} />)

    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("删除 2 个")
    // 要说明恢复手段，否则用户不知道代价。
    expect(alert.textContent).toContain("撤销")
  })

  it("does not cry wolf when nothing is removed", () => {
    render(<ConfirmationPanel draft={draft()} />)

    expect(screen.queryByRole("alert")).toBeNull()
  })
})

describe("target, sources and the preview fingerprint", () => {
  it("names the document being changed so the user can check it", () => {
    render(<ConfirmationPanel draft={draft()} targetDocumentId="doc-layout" sourceDocumentIds={["doc-geometry"]} />)

    expect(screen.getByText("doc-layout")).toBeTruthy()
    expect(screen.getByText("doc-geometry")).toBeTruthy()
  })

  it("does not print the preview hash, because today it is the whole document", () => {
    /**
     * 第一个版本把 `draft.previewHash` 直接打在界面上，而那个字段当前是**整份候选文档的
     * 规范 JSON**（`draftStore` 用 `contentFingerprint`，它返回 JSON 字符串而不是哈希）。
     * 于是确认面板里出现一长串文档内容，界面上还多出一份用户几何数据的副本 ——
     * 是 e2e 把它读出来才发现的。
     *
     * **显示一份"看起来像指纹、其实是全文"的东西比不显示更糟**，所以在 `draftStore`
     * 改用真正的哈希（`canonicalContentHash`）之前，这里不显示它。
     */
    render(<ConfirmationPanel draft={draft()} />)

    expect(screen.queryByText("hash-abc")).toBeNull()
    expect(screen.queryByText("预览指纹")).toBeNull()
  })
})

describe("assumptions, approximation and export omissions", () => {
  it("lists the assumptions the system made", () => {
    render(<ConfirmationPanel draft={draft()} assumptions={["半径取你给的 2"]} />)

    expect(screen.getByText("系统替你做的假设")).toBeTruthy()
    expect(screen.getByText("半径取你给的 2")).toBeTruthy()
  })

  it("lists approximation notes and export omissions", () => {
    render(<ConfirmationPanel draft={draft()} approximationNotes={["圆锥曲线用折线近似"]} omittedExports={["connection 不会出现在导出文件里"]} />)

    expect(screen.getByText("近似说明")).toBeTruthy()
    expect(screen.getByText("导出会丢掉的内容")).toBeTruthy()
  })

  it("hides those sections when there is nothing to say", () => {
    render(<ConfirmationPanel draft={draft()} />)

    expect(screen.queryByText("系统替你做的假设")).toBeNull()
    expect(screen.queryByText("近似说明")).toBeNull()
    expect(screen.queryByText("导出会丢掉的内容")).toBeNull()
  })
})

describe("形式证明那一次尝试（§3-D）", () => {
  /**
   * 这一段的用途是**让"证了没有"看得见**：在这之前，`draftStore` 已经把结果压成
   * `DraftProofAttempt` 随预览回带了，但面板上没有一处显示它 —— 用户只能从别处猜。
   *
   * 三样必须摆出来：**结局**（证了 / 没证 / 这台机器跑不了）、**正文是谁给的**
   * （系统按类给的还是模型写的）、**系统替他做了哪些选择**（读了哪条目标、平面内取了哪两条相交线）。
   * 外加一句**不能省的边界**：这是题面里那一条受限目标的形式证明，**原题其余题设没有进命题**。
   */
  it("把结局、正文来源、系统替你做的选择和边界都摆出来", () => {
    render(<ConfirmationPanel draft={draft({
      proofAttempt: {
        outcome: "verified",
        detail: "内核验证通过（三个白名单公理）。",
        claimId: "draft-goal:goal-1",
        proofSource: "system-canonical",
        choices: ["平面内取第 1+2 条相交直线"],
        // Task 17/18：范围报告说这一次只是受限引理，而且有一条题面条件没进命题。
        scope: { outcome: "limited_lemma", goalSourceId: "obligation-goal-0", detail: "受限引理", outside: ["AB=2"] },
        stale: null
      }
    })} />)

    const section = screen.getByRole("region", { name: "形式证明" })
    /**
     * **"证成了"要分两档说**（Task 17/18）：`verified` + `limited_lemma` 的标题是
     * "受限引理已证（不是整道题）"，**不是**"原题完整证明" —— 这一条就是那句判据的界面形态。
     */
    expect(section.textContent).toContain("受限引理已证")
    expect(section.textContent).not.toContain("原题完整证明")
    expect(section.textContent).toContain("AB=2")
    expect(section.textContent).toContain("内核验证通过")
    expect(section.textContent).toContain("系统按这一类给出的")
    expect(section.textContent).toContain("平面内取第 1+2 条相交直线")
    expect(section.textContent).toContain("原题其余题设没有进命题")
    expect(section.getAttribute("data-proof-scope")).toBe("limited_lemma")
  })

  it("说得清'不是证不出来，是这台机器跑不了'这一类结局", () => {
    render(<ConfirmationPanel draft={draft({
      proofAttempt: {
        outcome: "toolchain_unavailable",
        detail: "这台机器上没有配置 Lean 工具链（桌面版才能跑）。",
        claimId: null,
        proofSource: null,
        choices: [],
        scope: null,
        stale: null
      }
    })} />)

    const section = screen.getByRole("region", { name: "形式证明" })
    expect(section.textContent).toContain("没跑成")
    // 库里的原话要原样显示 —— 它是用户判断"该怎么办"的唯一依据。
    expect(section.textContent).toContain("这台机器上没有配置 Lean 工具链")
  })

  /**
   * **迟到的结果过期时，界面必须说"过期"，而不是"已验证"**（Task 18）。
   *
   * 判据在草稿层（`proofAttemptStaleness` 复查实时句柄），这里钉的是**读法**：
   * 标题不出现"已验证"，`data-proof-stale` 带上原因种类，理由原样显示。
   */
  it("旧产物过期时标题与原因都说得出，绝不显示成'已验证'", () => {
    render(<ConfirmationPanel draft={draft({
      proofAttempt: {
        outcome: "stale",
        detail: "内核验证通过。【过期：改题/改图/撤销之后，这一轮的 claim 不能凭它升级。】",
        claimId: "draft-goal:goal-1",
        proofSource: "system-canonical",
        choices: [],
        scope: { outcome: "limited_lemma", goalSourceId: "obligation-goal-0", detail: "受限引理", outside: [] },
        stale: { kind: "document_changed", detail: "证明跑的是内容 aaaa…，现在这张图是 bbbb…" }
      }
    })} />)

    const section = screen.getByRole("region", { name: "形式证明" })
    expect(section.getAttribute("data-proof-stale")).toBe("document_changed")
    expect(section.textContent).toContain("过期")
    expect(section.textContent).not.toContain("已验证")
    expect(section.textContent).toContain("现在这张图是")
  })

  it("开关关着时连这一段都不存在（不是显示一句'已关闭'）", () => {
    render(<ConfirmationPanel draft={draft()} />)

    expect(screen.queryByRole("region", { name: "形式证明" })).toBeNull()
  })
})

describe("one-undo statement and actions", () => {
  it("states the exact one-undo promise", () => {
    render(<ConfirmationPanel draft={draft()} />)

    expect(screen.getByText(/只占一步撤销/)).toBeTruthy()
  })

  it("says so when a change would take more than one undo step", () => {
    render(<ConfirmationPanel draft={draft({ undoesInOneStep: false })} />)

    expect(screen.getByText(/多步撤销/)).toBeTruthy()
  })

  it("reports confirm and discard without doing them itself", () => {
    const onConfirm = vi.fn()
    const onDiscard = vi.fn()
    render(<ConfirmationPanel draft={draft()} onConfirm={onConfirm} onDiscard={onDiscard} />)

    screen.getByRole("button", { name: "确认并提交" }).click()
    screen.getByRole("button", { name: "丢弃草稿" }).click()

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it("renders no buttons when the host did not supply handlers", () => {
    // 没有回调时不该给出按不动的按钮。
    render(<ConfirmationPanel draft={draft()} />)

    expect(screen.queryByRole("button", { name: "确认并提交" })).toBeNull()
    expect(screen.queryByRole("button", { name: "丢弃草稿" })).toBeNull()
  })
})

/**
 * **题设核验那一条怎么念给用户**（2026-10-12 裁决 A）。
 *
 * 现场那句话是 `PA ⊥ 平面 ABCD：不满足。实测 0.24254，题设要求 0。` —— 末尾的 0
 * **不是题面里的数字**，它是"这一类条件要求偏差归零"。改法只在**面板**这一层：
 * 编译器输出与黄金样本一个字不动（那句 reason 被 `planCompiler4707b64.golden.json` 逐字钉着）。
 */
describe("题设核验的失败文案（裁决 A：面板侧改）", () => {
  const verify = (checks: DiagramCheck[]): AgentDraftView =>
    draft({ diagramVerification: { status: "failed", checks, sampleValues: [], ...proofScopeOf({}) } })

  it("把「题设要求 0」换成读得懂的一句，并且旧句式不再出现", () => {
    const { container } = render(
      <ConfirmationPanel
        draft={verify([
          { kind: "perpendicular", sourceText: "PA ⊥ 平面 ABCD", status: "failed", reason: "实测 0.24254，题设要求 0。", expected: 0, actual: 0.24253562503633297 }
        ])}
      />
    )

    expect(container.textContent).toContain("实测偏差 0.24254（这一类条件要求偏差归零）。")
    // 这条断言才是这次改动的目的：用户**读不到**那句机器味的文案了。
    expect(container.textContent).not.toContain("题设要求 0")
  })

  it("带 detail 的那几族**原样透传** —— 那句里有别处没有的信息（哪根轴反了、切点画在哪）", () => {
    const conicReason = "实测 椭圆 x²/4+y²/9=1；题设要求 椭圆 x²/9+y²/4=1。最大偏差 5.0000，容差 1.0000e-6。"
    const { container } = render(
      <ConfirmationPanel
        draft={verify([
          { kind: "perpendicular", sourceText: "椭圆 x²/9+y²/4=1", status: "failed", reason: conicReason, expected: 0, actual: 5 }
        ])}
      />
    )

    expect(container.textContent).toContain(conicReason)
  })

  it("通过那一档也照旧（它的 reason 本来就是人话）", () => {
    const { container } = render(
      <ConfirmationPanel
        draft={verify([{ kind: "parallel", sourceText: "BC ∥ AD", status: "passed", reason: "已按候选图坐标核验。", expected: 0, actual: 0 }])}
      />
    )

    expect(container.textContent).toContain("已按候选图坐标核验。")
  })
})
