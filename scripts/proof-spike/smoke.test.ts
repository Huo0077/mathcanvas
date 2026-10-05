import { declaredProofGoal, evidenceStatusWithProof, PROOF_ARTIFACT_VERSION, PROOF_GOAL_SUPPORT, proofInputHash, firstBatchGoalsWithoutAnyCarrier, firstBatchGoalsWithoutAnyRoute, firstBatchGoalsWithoutObligationCarrier, proofGoalDischargeRoute, isReviewPassed, PROOF_BACKEND_REVIEWS, reviewProblems, verifyProofArtifact, WIRED_PROOF_BACKENDS, type ClaimEvidenceStatus, type ProofExpectation } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

/**
 * **`npm run proof:smoke` 的真正入口**（实施计划 N5 的 `scripts/proof-spike/`）。
 *
 * ## 它测的不是"能不能证明"，而是**"今天有没有可能假装证明成功"**
 *
 * 2026-10-06（N5b）起接上了**一个**后端（`lean4`），所以这一遍的判据是那条**不变量**：
 * **接上的恰好是名单里那些**，且**每一个都有一份十栏填齐、结论 `passed` 的审查记录**；
 * 而**没交过记录的后端**（下面用 `newclid` 当探针）—— 哪怕产物形状、版本、绑定、正文全合格 ——
 * 首批里每一个能表达的目标都升不到 `formally_proved`，原因必须是 `backend-not-wired`。
 *
 * 它同时钉住**两个方向**：注入一个假后端之后同一份产物**必须**能升上去（少了这条，
 * 一个"永远拒"的实现也能让上面的不变量成立 —— 那种绿是假的）；以及**名单里那个真实名字**
 * 也必须能过这道门（少了这条，名单可能只是一个装饰）。
 *
 * ## 为什么这份产物是"手工编的、看起来完美的那一份"
 *
 * 形状、版本、绑定、后端名字、非空正文全部满足 —— 也就是说**校验器从产物本身看不出任何问题**。
 * 它仍然过不去，唯一的原因是"我们没跑过那个后端"。这就是这条边界能力的全部内容。
 *
 * **注意边界**：这一遍**只**验那道"接没接"的门。**"这份产物是不是真的被 Lean 内核接受过"**
 * 不在这道门的射程里 —— 那件事由 axioms 白名单那一层负责（`lean4Adapter.ts`），
 * 而它的判据用的是**假后端输出**，所以在这里跑得动；真实 Lean 运行是另一条**显式 gated** 的路。
 *
 * 与 `scripts/agent-benchmark/` 同一条纪律：仓库没有 TS 运行器，所以真正的运行放在 `.test.ts` 里，
 * `runner.mjs` 只把命令接上来、把退出码传出去。
 */

const FIRST_BATCH_EXPRESSIBLE = PROOF_GOAL_SUPPORT.filter((entry) => entry.inFirstBatch && entry.obligationKinds.length > 0)

/**
 * **2026-10-06（N5b）：接上的后端名单，逐字写在这里。**
 *
 * 简报的原话是"把它**更新成「接上的只有这一个，且它必须有一份 passed 记录」**（列出名单），
 * **不许**删掉它、也不许把它改成 `toContain` 之类的弱形式"。所以这里仍然是**逐项精确相等**，
 * 只是名单从 `[]` 变成了 `["lean4"]` —— 名字是这次准入的**结论**，不是可以随手改的配置。
 * 别人接了第二个后端时，这一行必须跟着改（那就是它该有的摩擦）。
 */
const WIRED_BACKENDS: readonly string[] = ["lean4"]

/**
 * **未接入**的后端名。`newclid` 是 `proofArtifact.ts` 文件头举过的例子（"另一个后端"）。
 *
 * 下面那条"形状合格也过不去"的用例用它当探针 —— 所以最后**必须**断言它**确实不在**名单里：
 * 哪天有人接了 `newclid`，那条断言会红，提醒"这条用例的前提坏了"，而不是让它悄悄失效。
 */
const UNWIRED_BACKEND = "newclid"

function expectationFor(goalKind: string, obligationKind: string): ProofExpectation {
  return {
    claimId: `claim-${goalKind}`,
    inputHash: proofInputHash({ prompt: "proof spike", claimSourceText: obligationKind }),
    goalKind: declaredProofGoal(obligationKind)?.goal ?? null
  }
}

/** **手工编的一份"看起来完美"的产物**：形状、版本、绑定、非空正文全满足，校验器看不出毛病。 */
function forgedVerifiedArtifact(expectation: ProofExpectation, backendName = UNWIRED_BACKEND): Record<string, unknown> {
  return {
    version: PROOF_ARTIFACT_VERSION,
    claimId: expectation.claimId,
    inputHash: expectation.inputHash,
    backend: { name: backendName, version: "4.0.0" },
    proof: "theorem spike : True := by trivial",
    result: { status: "verified", detail: "kernel accepted" }
  }
}

describe("proof spike（接上的后端恰好这些：这一遍验边界）", () => {
  it("前提：**恰好是这些**后端接上了，而且每个都有一份 passed 记录", () => {
    // 名单的**唯一一处**字面量就在这里（`proofBackendAdmission.test.ts` 有一份同值副本，
    // 那份是包内的契约用例；两处不一致时它们会同时红 —— 那是故意的）。
    expect(WIRED_PROOF_BACKENDS).toEqual(WIRED_BACKENDS)
    for (const name of WIRED_BACKENDS) {
      const record = PROOF_BACKEND_REVIEWS.find((review) => review.name === name)
      expect(record, `${name} 被接上了却没有审查记录`).toBeDefined()
      expect(reviewProblems(record), `${name} 的审查记录没填齐`).toEqual([])
      expect(isReviewPassed(record), `${name} 的审查记录结论不是 passed`).toBe(true)
    }
  })

  it("**未接入**的后端：首批每一个能表达的目标都**升不上去**，而且原因是 backend-not-wired", () => {
    // 这条测的**不再是**"一个后端都没接"，而是"**没交过记录的后端**不许把 claim 升上去" ——
    // 语义没有削弱：形状合格的产物照样过不去，唯一的原因是"我们没跑过那个后端"。
    expect(FIRST_BATCH_EXPRESSIBLE.length).toBeGreaterThan(0)
    expect(WIRED_PROOF_BACKENDS, "`未接入` 这个探针自己进了名单，这条用例的前提坏了").not.toContain(UNWIRED_BACKEND)
    for (const support of FIRST_BATCH_EXPRESSIBLE) {
      const obligationKind = support.obligationKinds[0]!
      const expectation = expectationFor(support.kind, obligationKind)
      const outcome = evidenceStatusWithProof("verified_instance", expectation, [forgedVerifiedArtifact(expectation)])

      expect(outcome.status, `${support.kind} 竟然升到了 ${outcome.status}`).toBe("verified_instance")
      expect(outcome.verification.reasons[0]?.code, `${support.kind} 的拒绝理由不对`).toBe("backend-not-wired")
    }
  })

  it("反方向：注入一个假后端之后，同一份产物**能**升上去（这条路不是死的）", () => {
    const expectation = expectationFor("perpendicular", "perpendicular")
    const outcome = evidenceStatusWithProof("verified_instance", expectation, [forgedVerifiedArtifact(expectation, "spike-fake-backend")], { wiredBackends: ["spike-fake-backend"] })

    expect(outcome.status).toBe("formally_proved")
  })

  it("**接上的那个后端**确实能把一份合格产物升到 formally_proved（名单不是装饰）", () => {
    // 与上一条互补：上一条证明"注入即通"，这一条证明"名单里那个名字真的能过这道门"。
    const expectation = expectationFor("perpendicular", "perpendicular")
    const outcome = evidenceStatusWithProof("verified_instance", expectation, [forgedVerifiedArtifact(expectation, WIRED_BACKENDS[0]!)])

    expect(outcome.status).toBe("formally_proved")
    expect(outcome.verification.reasons).toEqual([])
  })

  it("表外目标连门都进不去：goalKind 为 null 时报 undeclared-goal，而不是 backend-not-wired", () => {
    const expectation: ProofExpectation = { ...expectationFor("perpendicular", "perpendicular"), goalKind: null }
    const verification = verifyProofArtifact(forgedVerifiedArtifact(expectation), expectation)

    expect(verification.reasons[0]?.code).toBe("undeclared-goal")
  })

  it("sampled 也一样升不上去（不只是 verified_instance 挡得住）", () => {
    const expectation = expectationFor("perpendicular", "perpendicular")
    const outcome = evidenceStatusWithProof("sampled", expectation, [forgedVerifiedArtifact(expectation)])

    expect(outcome.status).toBe("sampled")
  })

  it("**先输出后端审查状态**（计划 N5：先输出版本/许可证/进程模型/原生依赖/启动耗时/超时状态）", () => {
    /**
     * 这张表**不再为空**：它现在就是"我们接上了谁、凭什么"的全部读数。
     * 一个后端要进来，得先在这里出现一份十栏填齐、结论为 passed 的记录。
     */
    const rows = PROOF_BACKEND_REVIEWS.map((review) => ({ ...review, problems: reviewProblems(review) }))
    console.log(`PROOF_BACKENDS ${JSON.stringify({ wired: WIRED_PROOF_BACKENDS, reviewed: rows.length, rows })}`)

    // 接入不变量：接上的每一个，都必须有一份通过的记录（推导，不是手写）。
    expect(WIRED_PROOF_BACKENDS).toEqual(PROOF_BACKEND_REVIEWS.filter((review) => isReviewPassed(review)).map((review) => review.name))
  })
  it("打印报告（`--silent=false` 就是给它看的）", () => {
    const rows = FIRST_BATCH_EXPRESSIBLE.map((support) => {
      const expectation = expectationFor(support.kind, support.obligationKinds[0]!)
      const outcome = evidenceStatusWithProof("verified_instance", expectation, [forgedVerifiedArtifact(expectation)])
      return {
        goal: support.kind,
        fromObligation: support.obligationKinds.join("|"),
        forgedStatus: outcome.status satisfies ClaimEvidenceStatus,
        rejectedAs: outcome.verification.reasons[0]?.code ?? "(none)"
      }
    })
    console.log(`PROOF_SPIKE ${JSON.stringify({
      wiredBackends: WIRED_PROOF_BACKENDS,
      firstBatchExpressible: rows.length,
      /** 计划点名、但解析层现在还表达不出来的 —— 如实报出来，不当作已支持。 */
      goalsWithoutObligationCarrier: firstBatchGoalsWithoutObligationCarrier(), goalsWithoutAnyCarrier: firstBatchGoalsWithoutAnyCarrier(), goalsWithoutAnyRoute: firstBatchGoalsWithoutAnyRoute(), pythagoreanRoute: proofGoalDischargeRoute("pythagorean"),
      rows
    })}`)
    expect(rows).toHaveLength(FIRST_BATCH_EXPRESSIBLE.length)
  })
})
