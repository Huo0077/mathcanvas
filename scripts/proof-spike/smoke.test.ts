import { declaredProofGoal, evidenceStatusWithProof, PROOF_ARTIFACT_VERSION, PROOF_GOAL_SUPPORT, proofInputHash, firstBatchGoalsWithoutAnyCarrier, firstBatchGoalsWithoutObligationCarrier, isReviewPassed, PROOF_BACKEND_REVIEWS, reviewProblems, verifyProofArtifact, WIRED_PROOF_BACKENDS, type ClaimEvidenceStatus, type ProofExpectation } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

/**
 * **`npm run proof:smoke` 的真正入口**（实施计划 N5 的 `scripts/proof-spike/`）。
 *
 * ## 它测的不是"能不能证明"，而是**"今天有没有可能假装证明成功"**
 *
 * 现在一个后端都没接，所以这一遍的判据是那条**不变量**：
 * **首批里每一个能表达的目标，都升不到 `formally_proved`** —— 而且原因必须是
 * `backend-not-wired`（"这个后端没接进这个构建"），不是别的什么。
 *
 * 它同时钉住**反方向**：注入一个假后端之后，同一份产物**必须**能升上去。
 * 少了这一条，一个"永远拒"的实现也能让上面的不变量成立 —— 那种绿是假的。
 *
 * ## 为什么这份产物是"手工编的、看起来完美的那一份"
 *
 * 形状、版本、绑定、后端名字、非空正文全部满足 —— 也就是说**校验器从产物本身看不出任何问题**。
 * 它仍然过不去，唯一的原因是"我们没跑过那个后端"。这就是这条边界能力的全部内容。
 *
 * 与 `scripts/agent-benchmark/` 同一条纪律：仓库没有 TS 运行器，所以真正的运行放在 `.test.ts` 里，
 * `runner.mjs` 只把命令接上来、把退出码传出去。
 */

const FIRST_BATCH_EXPRESSIBLE = PROOF_GOAL_SUPPORT.filter((entry) => entry.inFirstBatch && entry.obligationKinds.length > 0)

function expectationFor(goalKind: string, obligationKind: string): ProofExpectation {
  return {
    claimId: `claim-${goalKind}`,
    inputHash: proofInputHash({ prompt: "proof spike", claimSourceText: obligationKind }),
    goalKind: declaredProofGoal(obligationKind)?.goal ?? null
  }
}

/** **手工编的一份"看起来完美"的产物**：校验器从它身上看不出任何毛病。 */
function forgedVerifiedArtifact(expectation: ProofExpectation): Record<string, unknown> {
  return {
    version: PROOF_ARTIFACT_VERSION,
    claimId: expectation.claimId,
    inputHash: expectation.inputHash,
    backend: { name: "lean4", version: "4.0.0" },
    proof: "theorem spike : True := by trivial",
    result: { status: "verified", detail: "kernel accepted" }
  }
}

describe("proof spike（一个后端都没接：这一遍只验边界）", () => {
  it("前提：这个构建里**没有任何后端接上**", () => {
    expect(WIRED_PROOF_BACKENDS).toEqual([])
  })

  it("首批每一个能表达的目标都**升不上去**，而且原因是 backend-not-wired", () => {
    expect(FIRST_BATCH_EXPRESSIBLE.length).toBeGreaterThan(0)
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
    const outcome = evidenceStatusWithProof("verified_instance", expectation, [forgedVerifiedArtifact(expectation)], { wiredBackends: ["lean4"] })

    expect(outcome.status).toBe("formally_proved")
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
     * 今天没有任何后端，所以这张表**是空的** —— 而空表本身就是要输出的读数：
     * "没有审查记录 ⇒ 没有接入 ⇒ 谁也升不到 `formally_proved`" 是**同一件事的三种说法**。
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
      goalsWithoutObligationCarrier: firstBatchGoalsWithoutObligationCarrier(), goalsWithoutAnyCarrier: firstBatchGoalsWithoutAnyCarrier(),
      rows
    })}`)
    expect(rows).toHaveLength(FIRST_BATCH_EXPRESSIBLE.length)
  })
})
