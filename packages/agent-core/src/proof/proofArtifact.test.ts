import { describe, expect, it } from "vitest"

import type { ClaimEvidenceStatus } from "../claimEvidence"
import { evidenceStatusWithProof, proofInputHash, verifyProofArtifact, PROOF_ARTIFACT_VERSION, WIRED_PROOF_BACKENDS, type ProofExpectation } from "./proofArtifact"

/**
 * **N5 第一步的 RED**（实施计划 Phase N5）：
 * "`verified_instance` / `sampled` 不能生成 `formally_proved`；伪造 / 缺字段 / 版本不匹配的
 * artifact 一律拒绝"。
 *
 * 这个文件的用例一半是**正例的反面**：每一条"该被拒"的旁边都有"合格的产物必须真的能通过" ——
 * 一个什么都拒的校验器同样能让上面那句判据成立，所以"合格的要放行"必须被钉住。
 */

const EXPECTATION: ProofExpectation = {
  claimId: "claim-1",
  inputHash: proofInputHash({ prompt: "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD", claimSourceText: "PA ⊥ BD" }),
  // 这条 goal 属于**首批**里能表达的那一类（见 proofGoals.ts）。
  goalKind: "perpendicular"
}

/**
 * 测试里**假装接上**的后端。生产默认是**空**的（`WIRED_PROOF_BACKENDS`）——
 * 那正是"今天谁也别想升到 `formally_proved`"这条不变量的落点，所以它单独有用例钉着。
 */
const WIRED: readonly string[] = ["lean4"]
const check = (value: unknown, expectation: ProofExpectation = EXPECTATION) => verifyProofArtifact(value, expectation, { wiredBackends: WIRED })
const upgraded = (base: ClaimEvidenceStatus, expectation: ProofExpectation, artifacts: readonly unknown[]) =>
  evidenceStatusWithProof(base, expectation, artifacts, { wiredBackends: WIRED })
function artifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: PROOF_ARTIFACT_VERSION,
    claimId: EXPECTATION.claimId,
    inputHash: EXPECTATION.inputHash,
    backend: { name: "lean4", version: "4.0.0" },
    proof: "theorem pa_perp_bd : ... := by simp",
    result: { status: "verified", detail: "kernel accepted" },
    ...overrides
  }
}

describe("证明产物的校验（N5 的边界）", () => {
  it("合格的产物真的能通过 —— 否则这个校验器只是「什么都拒」", () => {
    const verification = check(artifact(), EXPECTATION)

    expect(verification.status).toBe("verified")
    expect(verification.reasons).toEqual([])
    expect(verification.artifact?.backend.name).toBe("lean4")
  })

  it("**核心判据**：没有产物时，证据状态**原样不动** —— verified_instance 与 sampled 都升不上去", () => {
    for (const base of ["verified_instance", "sampled"] as const) {
      const outcome = upgraded(base, EXPECTATION, [])

      expect(outcome.status).toBe(base)
      expect(outcome.verification.status).toBe("unsupported")
    }
  })

  it("后端自己说没证成时，状态同样原样不动，而且如实转述它的结局", () => {
    for (const status of ["failed", "unsupported", "timeout"] as const) {
      const outcome = upgraded("verified_instance", EXPECTATION, [artifact({ result: { status, detail: `backend said ${status}` } })])

      expect(outcome.status).toBe("verified_instance")
      expect(outcome.verification.status).toBe(status)
      expect(outcome.verification.reasons[0]?.code).toBe("backend-verdict")
      expect(outcome.verification.reasons[0]?.detail).toContain(status)
    }
  })

  it("产物是真 verified 且绑定一致时才升级成 formally_proved", () => {
    const outcome = upgraded("verified_instance", EXPECTATION, [artifact()])

    expect(outcome.status).toBe("formally_proved")
    expect(outcome.verification.artifact).not.toBeNull()
  })

  it("**表外目标绝不升级**：goalKind 为 null 时，再合法的产物也报 undeclared-goal", () => {
    const outcome = upgraded("verified_instance", { ...EXPECTATION, goalKind: null }, [artifact()])

    expect(outcome.status).toBe("verified_instance")
    expect(outcome.verification.status).toBe("failed")
    expect(outcome.verification.reasons[0]?.code).toBe("undeclared-goal")
  })

  it("不合格产物与「表外目标」是两句话：表内目标的坏产物报的是它自己的毛病", () => {
    const outcome = upgraded("sampled", EXPECTATION, [artifact({ version: 99 })])

    expect(outcome.verification.reasons[0]?.code).toBe("version-mismatch")
  })
  it("**生产默认一个后端都没接**：形状全合格的产物也过不去，谁也不许升到 formally_proved", () => {
    // 这条是"形状合格 ≠ 真的验过"的落点：手工编一份看起来完美的产物，它照样过不去。
    expect(WIRED_PROOF_BACKENDS).toEqual([])
    const verification = verifyProofArtifact(artifact(), EXPECTATION)

    expect(verification.status).toBe("failed")
    expect(verification.reasons[0]?.code).toBe("backend-not-wired")
    expect(verification.artifact).toBeNull()
    expect(evidenceStatusWithProof("verified_instance", EXPECTATION, [artifact()]).status).toBe("verified_instance")
  })

  it("接上一个后端之后这条路是通的 —— 这道门禁不是「什么都没接所以永远拒」", () => {
    expect(check(artifact(), EXPECTATION).status).toBe("verified")
  })

  it("后端名字要**逐字**在名单里：大小写不同也算没接", () => {
    const verification = verifyProofArtifact(artifact({ backend: { name: "Lean4", version: "1" } }), EXPECTATION, { wiredBackends: WIRED })

    expect(verification.reasons[0]?.code).toBe("backend-not-wired")
  })
  it("缺字段要拒，并点名缺了哪个", () => {
    for (const field of ["version", "claimId", "inputHash", "backend", "proof", "result"]) {
      const broken = artifact()
      delete broken[field]
      const verification = check(broken, EXPECTATION)

      expect(verification.status).toBe("failed")
      expect(verification.reasons[0]?.code).toBe("missing-field")
      expect(verification.reasons[0]?.detail).toContain(field)
      expect(verification.artifact).toBeNull()
    }
  })

  it("版本不匹配要拒 —— 不做兼容猜测", () => {
    const verification = check(artifact({ version: PROOF_ARTIFACT_VERSION + 1 }), EXPECTATION)

    expect(verification.reasons[0]?.code).toBe("version-mismatch")
  })

  it("伪造的结局词要拒（把 status 写成词表外的词）", () => {
    const verification = check(artifact({ result: { status: "proved", detail: "trust me" } }), EXPECTATION)

    expect(verification.status).toBe("failed")
    expect(verification.reasons[0]?.code).toBe("unknown-status")
  })

  it("声称 verified 却拿不出正文、或说不清是哪个后端，都要拒", () => {
    expect(check(artifact({ proof: "   " }), EXPECTATION).reasons[0]?.code).toBe("empty-proof")
    expect(check(artifact({ backend: { name: "  ", version: "1" } }), EXPECTATION).reasons[0]?.code).toBe("unnamed-backend")
  })

  it("证明的是**别的 claim** 要拒", () => {
    const verification = check(artifact({ claimId: "claim-2" }), EXPECTATION)

    expect(verification.reasons[0]?.code).toBe("claim-mismatch")
    expect(verification.reasons[0]?.detail).toContain("claim-2")
  })

  it("证明的是**别的输入**要拒 —— 这是「贴一份合格产物到别处」那条路", () => {
    const other = proofInputHash({ prompt: "另一道题", claimSourceText: "别的结论" })
    const verification = check(artifact({ inputHash: other }), EXPECTATION)

    expect(verification.reasons[0]?.code).toBe("input-mismatch")
    expect(upgraded("verified_instance", EXPECTATION, [artifact({ inputHash: other })]).status).toBe("verified_instance")
  })

  it("根本不是对象（模型给了一句话或一个数组）要拒，且**不抛**", () => {
    for (const value of ["这是一段话", 42, [], null, undefined]) {
      const verification = check(value, EXPECTATION)

      expect(verification.status).toBe("failed")
      expect(verification.artifact).toBeNull()
    }
  })

  it("多份产物里只要有一份真通过，就用那一份", () => {
    const outcome = upgraded("sampled", EXPECTATION, [
      artifact({ claimId: "claim-2" }),
      artifact(),
      artifact({ proof: "" })
    ])

    expect(outcome.status).toBe("formally_proved")
  })

  it("一份都没有通过时，带上的是**第一份**失败的原因（便于诊断）", () => {
    const outcome = upgraded("sampled", EXPECTATION, [artifact({ claimId: "claim-2" }), artifact({ version: 99 })])

    expect(outcome.status).toBe("sampled")
    expect(outcome.verification.reasons[0]?.code).toBe("claim-mismatch")
  })

  it("绝不就地改写入参", () => {
    const parsed = artifact()
    const snapshot = JSON.stringify(parsed)
    check(parsed, EXPECTATION)
    upgraded("sampled", EXPECTATION, [parsed])

    expect(JSON.stringify(parsed)).toBe(snapshot)
  })

  it("输入指纹：同一份输入稳定，换一处就变（换 prompt / claim / goal / 文档都算）", () => {
    const base = { prompt: "题面", claimSourceText: "结论" }

    expect(proofInputHash(base)).toBe(proofInputHash({ ...base }))
    expect(proofInputHash(base)).not.toBe(proofInputHash({ ...base, prompt: "另一句题面" }))
    expect(proofInputHash(base)).not.toBe(proofInputHash({ ...base, claimSourceText: "另一个结论" }))
    expect(proofInputHash(base)).not.toBe(proofInputHash({ ...base, goal: "目标" }))
    expect(proofInputHash(base)).not.toBe(proofInputHash({ ...base, documentFingerprint: "doc-1" }))
  })
})
