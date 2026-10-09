import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "../diagramObligations"
import { attemptAutomaticProof, type AutomaticProofRequest, type ProofChannel, type ProofChannelResult } from "./automaticProof"

/**
 * **产品侧自动调用**（V2 GREEN 缺口③）：一条作图题 claim 走到"要不要去调 Lean、拿到了什么"。
 *
 * 这一层的判据全部用**假通道**（CI 上没有 Lean，更没有 7.5 GB 的 mathlib），
 * 真的去起进程那条路是桌面命令自己的事（`apps/desktop/src-tauri/src/proof/`，那边另有 9 条 Rust 用例）。
 *
 * ## 这一层要守住的三件事
 *
 * 1. **没开旗 / 没正文 / 前提指不出出处 ⇒ 连通道都不碰**（不是"跑了再拒"，是**根本不跑**）；
 * 2. **通道怎么坏都不许把状态升上去**（不可用 / 超时 / 报 `sorry` / 直接抛 —— 一律停在原地）；
 * 3. **它绝不阻塞作图**：这个函数**不抛**，最坏情况是一个如实的结局对象。
 */
function fakeChannel(results: ProofChannelResult[]): { channel: ProofChannel; calls: { source: string; timeoutMs: number }[] } {
  const calls: { source: string; timeoutMs: number }[] = []
  let index = 0
  const channel: ProofChannel = async (request) => {
    calls.push({ source: request.source, timeoutMs: request.timeoutMs })
    const value = results[Math.min(index, results.length - 1)]
    index += 1
    return value ?? { outcome: "exited", exitCode: 0, stdout: "", stderr: "", durationMs: 1, detail: "" }
  }
  return { channel, calls }
}

const OK_STDOUT = "'draw_line_plane_perpendicular_goal' depends on axioms: [propext, Classical.choice, Quot.sound]\n"
const SORRY_STDOUT = "'draw_line_plane_perpendicular_goal' depends on axioms: [propext, sorryAx, Classical.choice, Quot.sound]\n"

/** 一道题面**真的给了**判定定理那两条前提的题。 */
function request(overrides: Partial<AutomaticProofRequest> = {}): AutomaticProofRequest {
  const obligations = parseDiagramObligations("在三棱锥 P-ABC 中，PA ⊥ AB，PA ⊥ AC，求证 PA ⊥ 平面 ABC")
  return {
    base: "verified_instance",
    claimId: "claim-auto",
    prompt: "在三棱锥 P-ABC 中，PA ⊥ AB，PA ⊥ AC，求证 PA ⊥ 平面 ABC",
    claimSourceText: "PA ⊥ 平面 ABC",
    assumptions: [],
    goal: {
      goalKind: "linePlanePerpendicular",
      line: { first: "P", second: "A" },
      planeLines: [
        { first: "A", second: "B" },
        { first: "A", second: "C" }
      ]
    },
    obligations,
    proof: "rw [Submodule.mem_orthogonal']\n  intro y hy\n  sorry",
    flagEnabled: true,
    backendVersion: "Lean 4.34.1 (测试用字符串)",
    channel: fakeChannel([]).channel,
    ...overrides
  }
}

describe("产品侧自动调用：先问该不该跑，再看跑出来什么", () => {
  it("**旗关着 ⇒ 连通道都不碰**（这是默认路径：证明不参与普通作图）", async () => {
    const { channel, calls } = fakeChannel([])
    const result = await attemptAutomaticProof(request({ flagEnabled: false, channel }))

    expect(result.outcome).toBe("flag_off")
    expect(result.status).toBe("verified_instance")
    expect(result.artifact).toBeNull()
    expect(calls).toEqual([])
  })

  it("**没有正文 ⇒ 不跑**（跑一个空证明没有意义，也不该白花几分钟）", async () => {
    const { channel, calls } = fakeChannel([])
    const result = await attemptAutomaticProof(request({ proof: "   ", channel }))

    expect(result.outcome).toBe("no_proof_body")
    expect(calls).toEqual([])
  })

  it("**前提指不出出处 ⇒ 不跑**，而且要说清是哪一条前提没有着落", async () => {
    const { channel, calls } = fakeChannel([])
    const obligations = parseDiagramObligations("在四棱锥 P-ABCD 中，底面 ABCD 是正方形，求证 PA ⊥ 平面 ABCD")
    const result = await attemptAutomaticProof(request({ obligations, channel }))

    // **先钉住上游那件事**：解析层会跳过「求证」从句 —— 这一句在题面里是**目标**，不是给定。
    // 少了这条性质，前提桥就会拿目标的结论当自己的前提（循环证明），而那是静默的。
    expect(obligations.givens).toEqual([])

    expect(result.outcome).toBe("premises_unresolved")
    expect(result.status).toBe("verified_instance")
    // 拒绝理由要点名那条**凭空编的**前提（就是原来被模板偷偷塞进去的那一条）。
    expect(result.detail).toContain("PA ⊥ AB")
    expect(calls).toEqual([])
  })

  it("**性质定理那一类也走得通**（两类都在覆盖范围里，都会真的去跑）", async () => {
    const { channel, calls } = fakeChannel([{ outcome: "exited", exitCode: 0, stdout: "", stderr: "", durationMs: 5, detail: "" }])
    const result = await attemptAutomaticProof(
      request({
        channel,
        goal: { goalKind: "perpendicular", lineA: { first: "P", second: "A" }, planePoints: ["A", "B", "C"], lineB: { first: "B", second: "D" } },
        obligations: parseDiagramObligations("在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，求证 PA ⊥ BD")
      })
    )

    expect(result.outcome).not.toBe("goal_unsupported")
    expect(calls).toHaveLength(1)
    // 走的是**性质定理**那个模板（定理名不同 ⇒ 报告不能互相冒充）。
    expect(calls[0]!.source).toContain("#print axioms draw_perpendicular_goal")
  })

  it("**表外目标类 ⇒ 不跑**（今天的类型进不来，所以这条是防「以后有人放宽类型」的兜底）", async () => {
    const { channel, calls } = fakeChannel([])
    const result = await attemptAutomaticProof(
      // 故意把类型捅破：模拟"以后有人把别的目标类接进来，却忘了适配器不覆盖它"。
      request({ channel, goal: { goalKind: "equalLength" } as unknown as AutomaticProofRequest["goal"] })
    )

    expect(result.outcome).toBe("goal_unsupported")
    expect(result.status).toBe("verified_instance")
    expect(calls).toEqual([])
  })

  it("**通道送来的源码是模板生成的那种**（不是随手拼的字符串）", async () => {
    const { channel, calls } = fakeChannel([{ outcome: "exited", exitCode: 0, stdout: OK_STDOUT, stderr: "", durationMs: 12, detail: "" }])
    await attemptAutomaticProof(request({ channel }))

    expect(calls).toHaveLength(1)
    const source = calls[0]!.source
    // 生成标记 + 唯一允许的 import + 白名单定理名（桌面命令的形状检查认的就是这三样）。
    expect(source).toContain("由 @draw/agent-core 的 Lean 4 适配器生成")
    expect(source).toContain("import Mathlib.Analysis.InnerProductSpace.Orthogonal")
    expect(source).toContain("#print axioms draw_line_plane_perpendicular_goal")
    // 正文原样照抄（正文对不对由内核说，不由这一层说）。
    expect(source).toContain("rw [Submodule.mem_orthogonal']")
  })

  it("**真报告 ⇒ 升到 `formally_proved`，产物绑在这条 claim 上**", async () => {
    const { channel } = fakeChannel([{ outcome: "exited", exitCode: 0, stdout: OK_STDOUT, stderr: "", durationMs: 68_000, detail: "" }])
    const result = await attemptAutomaticProof(request({ channel }))

    expect(result.outcome).toBe("verified")
    expect(result.status).toBe("formally_proved")
    expect(result.artifact?.claimId).toBe("claim-auto")
    expect(result.artifact?.result.status).toBe("verified")
    // 而且**产物确实过了校验器**（不是"刚生成的所以肯定行"）。
    expect(result.verified).toBe(true)
  })

  it("**`sorry` 的报告 ⇒ 停在原地**（`exit=0` 不算数）", async () => {
    const { channel } = fakeChannel([{ outcome: "exited", exitCode: 0, stdout: SORRY_STDOUT, stderr: "", durationMs: 68_000, detail: "" }])
    const result = await attemptAutomaticProof(request({ channel }))

    expect(result.outcome).toBe("rejected")
    expect(result.status).toBe("verified_instance")
    expect(result.artifact).toBeNull()
  })

  it("**工具链没配 ⇒ `toolchain_unavailable`**（「没配」与「证不出来」要分开报）", async () => {
    const { channel } = fakeChannel([
      { outcome: "unavailable", exitCode: null, stdout: "", stderr: "", durationMs: 0, detail: "DRAW_LEAN_LAKE 没配" }
    ])
    const result = await attemptAutomaticProof(request({ channel }))

    expect(result.outcome).toBe("toolchain_unavailable")
    expect(result.status).toBe("verified_instance")
    expect(result.detail).toContain("DRAW_LEAN_LAKE")
  })

  it("**超时 ⇒ `timeout`**，绝不把被杀掉的那次算通过", async () => {
    const { channel } = fakeChannel([{ outcome: "timeout", exitCode: null, stdout: "半截输出", stderr: "", durationMs: 180_000, detail: "墙钟超时" }])
    const result = await attemptAutomaticProof(request({ channel }))

    expect(result.outcome).toBe("timeout")
    expect(result.status).toBe("verified_instance")
    expect(result.artifact).toBeNull()
  })

  it("**通道自己抛了 ⇒ `internal_error`，状态照旧**（最坏情况也不许变成「证过了」）", async () => {
    const channel: ProofChannel = async () => {
      throw new Error("IPC 断了")
    }
    const result = await attemptAutomaticProof(request({ channel }))

    expect(result.outcome).toBe("internal_error")
    expect(result.status).toBe("verified_instance")
    expect(result.detail).toContain("IPC 断了")
  })
})
