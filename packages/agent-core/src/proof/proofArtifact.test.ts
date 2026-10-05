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

  it("输入指纹：同一份输入稳定，换一处就变（换 prompt / claim / goal 都算）", () => {
    const base = { prompt: "题面", claimSourceText: "结论" }

    expect(proofInputHash(base)).toBe(proofInputHash({ ...base }))
    expect(proofInputHash(base)).not.toBe(proofInputHash({ ...base, prompt: "另一句题面" }))
    expect(proofInputHash(base)).not.toBe(proofInputHash({ ...base, claimSourceText: "另一个结论" }))
    expect(proofInputHash(base)).not.toBe(proofInputHash({ ...base, goal: "目标" }))
    // 原来这里还有一条 `documentFingerprint: "doc-1"` **必须**改哈希的断言。
    // 2026-10-05 的 R51 把它反过来裁决了（不绑文档指纹）—— 判据搬到下面那一组里。
  })
})

/**
 * **R51 + R56：一份证明该绑到多细的输入**（2026-10-05 裁决，理由见 `proofInputHash` 的注释）。
 *
 * 这一组不是风格偏好，是同一个洞的两面：**绑定太松 ⇒ 过度声称 / 假有效**。
 * 少了 `assumptions` 那几条，一份"后端带着系统多给的假设证出来的"产物会被摆在一个**更弱**的
 * 命题旁边；少了 `statement` 那条，适配器把模板改弱之后旧产物**照样匹配**。
 */
describe("输入绑定（R51 假设 / R56 被证明的命题）", () => {
  const base = { prompt: "在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD", claimSourceText: "PA ⊥ BD" }

  it("**R51**：只在 assumptions 上不同的两份输入，必须得到不同的 inputHash", () => {
    expect(proofInputHash({ ...base, assumptions: ["系统替你定的假设：底面 ABCD 是正方形"] })).not.toBe(proofInputHash(base))
    expect(proofInputHash({ ...base, assumptions: ["甲"] })).not.toBe(proofInputHash({ ...base, assumptions: ["乙"] }))
  })

  it("空数组与不传**必须同哈希** —— 同一次输入不许有两个答案", () => {
    expect(proofInputHash({ ...base, assumptions: [] })).toBe(proofInputHash(base))
  })

  it("顺序不影响哈希（调用方给的顺序可能不同）", () => {
    expect(proofInputHash({ ...base, assumptions: ["甲", "乙", "丙"] })).toBe(proofInputHash({ ...base, assumptions: ["丙", "甲", "乙"] }))
  })

  it("重复项按**一条**算：同名假设出现两次与出现一次同哈希", () => {
    // 去重的理由写在 `proofInputHash` 的注释里：假设的文本就是这条假设本身，
    // 重复只可能来自"同一条被推导了两次"，让计数参与哈希只会把它变成**假过期**。
    expect(proofInputHash({ ...base, assumptions: ["甲", "甲"] })).toBe(proofInputHash({ ...base, assumptions: ["甲"] }))
  })

  it("**R56**：被证明的那条命题原文进哈希 —— 换了命题就必须失配", () => {
    expect(proofInputHash({ ...base, statement: "theorem t : PA ⟂ BD := by sorry" }))
      .not.toBe(proofInputHash({ ...base, statement: "theorem t : True := by trivial" }))
    expect(proofInputHash({ ...base, statement: "theorem t : True := by trivial" })).not.toBe(proofInputHash(base))
  })

  it("**R51 的另一半：不绑文档指纹** —— 硬塞一个坐标/标签指纹进去也不改变哈希", () => {
    // 绑坐标会把"题设下普遍成立"降级成"这一次实例的检查"，还会被改个 label / 重解选到
    // 另一组坐标刷成**假过期**。这条判据由**入参本身**落地（那个参数已经没有了），
    // 所以这里连"绕过类型硬塞"都必须无效。
    const sneaky = { ...base, documentFingerprint: "坐标与标签的那份指纹" } as unknown as Parameters<typeof proofInputHash>[0]

    expect(proofInputHash(sneaky)).toBe(proofInputHash(base))
  })
})
