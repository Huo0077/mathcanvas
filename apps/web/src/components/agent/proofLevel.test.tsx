import { PROOF_BACKEND_REVIEW_FIELDS, PROOF_BACKEND_REVIEWS, WIRED_PROOF_BACKENDS } from "@draw/agent-core"
import { cleanup, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { AgentDraftView } from "../../agentStore"
import { ConfirmationPanel } from "./ConfirmationPanel"

/**
 * **「证明级别」只读状态面**（N5a 的第二件事）。
 *
 * 这一档今天到底是什么状态，**文案必须由真实数据推导**（`WIRED_PROOF_BACKENDS` /
 * `PROOF_BACKEND_REVIEWS` / `PROOF_BACKEND_REVIEW_FIELDS`），不许手写一个数字、一个名字
 * 或一句结论 —— 手写的那一句在事实变了之后就是**留在界面上的谎话**，不会有任何东西提醒。
 *
 * 所以这里最要紧的两条判据是：
 * ① **注入假后端之后文案里必须出现它的名字**（把一个结论写死的实现会红）；
 * ② **审查栏契约是几栏，文案就必须说几栏**（把一个今天恰好为真的数字写死的实现会红 ——
 *    复核 I1 抓到的正是这一条：原文案写死"十栏"）。
 */

const draft: AgentDraftView = { draftId: "d-1", draftVersion: 1, previewHash: "h", stageCount: 1, undoesInOneStep: true }

function proofLevelText(container: HTMLElement): string {
  const section = container.querySelector(".agent-proof-level")
  expect(section, "确认面板里必须有「证明级别」这一节").not.toBeNull()
  return section?.textContent ?? ""
}

/**
 * 「接上了 N 个后端」这一类注入：**`reviewedCount` 必须一起给**。
 *
 * 生产里 `WIRED_PROOF_BACKENDS` 是从 `PROOF_BACKEND_REVIEWS` 里**过滤**出来的，所以
 * `wired.length > reviewedCount` 这个组合**不可能出现**；只传 `proofBackends` 会渲染出
 * "接上 1 个（交过审查记录 0 个）"那种生产上不存在的读数（复核 M2）。用例只渲染**可达**的组合。
 */
function renderWired(wired: readonly string[], reviewedCount: number) {
  return render(<ConfirmationPanel draft={draft} proofBackends={wired} proofReviewedCount={reviewedCount} />)
}

describe("证明级别：只读状态面（文案由真实数据推导）", () => {
  it("**这条会咬人**：注入一个假后端之后，文案里必须出现它的名字", () => {
    const { container } = renderWired(["fake-lean4-adapter"], 1)

    // 名字出现 ⇒ 文案是**排**出来的，不是写死的。
    expect(proofLevelText(container)).toContain("fake-lean4-adapter")
    expect(proofLevelText(container)).toContain("1 个")
  })

  it("**这条也会咬人**：审查栏契约是几栏，文案就必须说几栏（不许写死一个今天恰好为真的数字）", () => {
    // 判据必须**读常量**而不是写 "10"：把栏数常量改掉而文案没跟着变时，它要能红
    //（已用变异证明：常量加到 11 栏 + 文案冻结在旧数字 ⇒ 只红这一条）。
    expect(PROOF_BACKEND_REVIEW_FIELDS.length).toBe(10)
    /**
     * **显式注入"接上 0 个"**，而不是依赖"生产今天恰好没有后端"：
     * 2026-10-06 起生产名单是 `["lean4"]`（N5b 接了第一个后端），而"N 栏填齐"那句话
     * 只在 `wired.length === 0` 那一支渲染。这条用例要钉的是"**文案里的栏数来自契约**"，
     * 不该顺带依赖生产的接入状态（那会让它随事实变而红，且红得与主题无关）。
     */
    const { container } = renderWired([], 0)

    expect(proofLevelText(container)).toContain(`${PROOF_BACKEND_REVIEW_FIELDS.length} 栏填齐`)
  })

  it("注入两个后端、三条审查记录：数字与名字都跟着变", () => {
    const { container } = renderWired(["alpha-prover", "beta-prover"], 3)
    const text = proofLevelText(container)

    expect(text).toContain("2 个")
    expect(text).toContain("alpha-prover")
    expect(text).toContain("beta-prover")
    // 接上 2 个而审查记录有 3 条 ⇒ 多出来的那一条必须如实说成"其余的没有接上"。
    expect(text).toContain("3 个")
  })

  it("接上后端之后**不许**再说「没有接入任何形式证明后端」", () => {
    const { container } = renderWired(["fake-lean4-adapter"], 1)

    expect(proofLevelText(container)).not.toContain("没有接入任何形式证明后端")
  })

  it("接上 0 个的那一支：明确说出没有一个后端接上，并说明后果", () => {
    /**
     * **这里不再断言生产名单的值。** 原来写的是 `expect(WIRED_PROOF_BACKENDS).toEqual([])`，
     * 而 2026-10-06 起生产真的接上了 `lean4`（N5b 的第一个后端）⇒ 那句"今天恰好为真"的前提过期了。
     * 「名单恰好是什么」的**精确钉子只留一处**：`scripts/proof-spike/smoke.test.ts`
     * （与当初裁决 `proofArtifact.test.ts` 时同一条纪律：**一处字面量，不许两处各写一份**）。
     * 这一条要钉的是**"接上 0 个"那一支的文案**，所以显式注入 0 个。
     */
    const { container } = renderWired([], 0)
    const text = proofLevelText(container)

    expect(text).toContain("当前没有接入任何形式证明后端")
    // 后果必须说出来，否则"没有后端"读起来只像一句免责声明。
    expect(text).toContain("不可能升到 formally_proved")
    expect(text).toContain("一个实例的核验")
  })

  it("默认值就是包根导出的那份事实，不是组件里另写的一份", () => {
    // 显式注入真实常量 → 与不注入**逐字相同**；否则"默认值"与"包根的事实"是两回事。
    const injected = render(<ConfirmationPanel draft={draft} proofBackends={[...WIRED_PROOF_BACKENDS]} proofReviewedCount={PROOF_BACKEND_REVIEWS.length} />)
    const injectedText = proofLevelText(injected.container)
    cleanup()

    const byDefault = render(<ConfirmationPanel draft={draft} />)

    expect(proofLevelText(byDefault.container)).toBe(injectedText)
  })

  it("**今天绝不许**出现「已证明 / 证明通过」这类字样（没有 formally_proved 就不许这么说）", () => {
    // 两个分支都要查：**接上 0 个**的那一支，与"接上了"的那一支 —— 后者最容易顺手写一句
    // "形式证明通过"，而那句话只在**这一条**真的升到 formally_proved 时才成立。
    // （2026-10-06 更正：原来这里写的是"一个后端都没接的今天"——那时生产确实是空的，现在接上了 `lean4`。）
    const byDefault = render(<ConfirmationPanel draft={draft} />)
    expect(byDefault.container.querySelector(".agent-proof-level")).not.toBeNull()
    for (const forbidden of [/已证明/, /证明通过/, /形式证明通过/]) expect(screen.queryByText(forbidden)).toBeNull()
    cleanup()

    // **只渲染可达的组合**（复核 M5）：注入的"事实"必须是生产过程真能产生的形状 ——
    // `wired` 是从审查记录里**过滤**出来的，所以"接上 1 个、交过审查记录 0 条"在生产里不存在。
    renderWired(["fake-lean4-adapter"], 1)
    for (const forbidden of [/已证明/, /证明通过/, /形式证明通过/]) expect(screen.queryByText(forbidden)).toBeNull()
  })

  it("它**只是**状态：不给用户任何能点的东西", () => {
    const { container } = render(<ConfirmationPanel draft={draft} />)

    expect(container.querySelector(".agent-proof-level")?.querySelectorAll("button, a, input, [role=button]").length).toBe(0)
  })

  it("它落在**题设核验那一节之后**（用户先看这份图核了什么，再看这一档的级别）", () => {
    const { container } = render(<ConfirmationPanel draft={{ ...draft, diagramVerification: { status: "passed", sampleValues: [], checks: [{ kind: "dihedral", sourceText: "二面角", status: "passed", reason: "实测一致" }] } }} />)

    const section = container.querySelector(".agent-diagram-verification")!
    const notice = container.querySelector(".agent-proof-level")!
    // `compareDocumentPosition` 的 DOCUMENT_POSITION_FOLLOWING(4)：notice 在核验节之后。
    expect(section.compareDocumentPosition(notice) & 4).toBe(4)
  })
})
