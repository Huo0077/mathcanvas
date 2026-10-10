import { parseDiagramObligations, type ProofChannelResult } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

import { attemptProofForStage } from "./automaticProofStage"

/**
 * **产品侧调用点**的判据（V2 GREEN 缺口③ 的最后一步）。
 *
 * 全部用**假通道**：CI 上没有 Lean。真的去起进程那条路由桌面命令自己负责
 *（`apps/desktop/src-tauri/src/proof/`，那边另有 9 条 Rust 用例）。
 *
 * **最要紧的三条**：旗关着时**连通道都不构造**；没有可证目标时**如实说没有**（不是失败）；
 * 浏览器里跑不了时**如实说"要桌面版"**。三条都属于"不阻塞作图"这件事。
 */
const PROMPT = "在三棱锥 P-ABC 中，PA ⊥ AB，PA ⊥ AC，求证 PA ⊥ 平面 ABC"
const OK_STDOUT = "'draw_line_plane_perpendicular_goal' depends on axioms: [propext, Classical.choice, Quot.sound]\n"

function fakeChannel(results: ProofChannelResult[]) {
  const calls: string[] = []
  let index = 0
  return {
    calls,
    channel: async (request: { source: string; timeoutMs: number }) => {
      calls.push(request.source)
      const value = results[Math.min(index, results.length - 1)]
      index += 1
      return value ?? { outcome: "exited" as const, exitCode: 0, stdout: "", stderr: "", durationMs: 1, detail: "" }
    }
  }
}

describe("产品侧调用点：跑完作图顺手证一下（旗关着就什么都不做）", () => {
  it("**旗关着 ⇒ 返回 `null`，连通道都不碰**（默认路径逐字不变就是靠这一条）", async () => {
    const { channel, calls } = fakeChannel([])
    const result = await attemptProofForStage({ prompt: PROMPT, obligations: parseDiagramObligations(PROMPT), flagEnabled: false, channel })

    // `null` 是刻意的：调用方据此**不往草稿里写任何字段**（写一个 `undefined` 都会让预览形状变）。
    expect(result).toBeNull()
    expect(calls).toEqual([])
  })

  it("**没有可证的目标句 ⇒ 如实说「没有」**（不是失败）", async () => {
    const prompt = "在三棱锥 P-ABC 中，画一个示意图"
    const { channel, calls } = fakeChannel([])
    const result = await attemptProofForStage({ prompt, obligations: parseDiagramObligations(prompt), flagEnabled: true, channel })

    expect(result?.outcome).toBe("no_goal")
    expect(result?.detail).toContain("没有可形式化的目标")
    expect(calls).toEqual([])
  })

  it("**证成了 ⇒ 记下产物绑在哪条 claim、正文是谁给的、以及系统做的选择**", async () => {
    const { channel, calls } = fakeChannel([{ outcome: "exited", exitCode: 0, stdout: OK_STDOUT, stderr: "", durationMs: 68_000, detail: "" }])
    const result = await attemptProofForStage({
      prompt: PROMPT,
      obligations: parseDiagramObligations(PROMPT),
      flagEnabled: true,
      channel,
      backendVersion: "Lean 4.34.1（实测版本串）"
    })

    expect(result?.outcome).toBe("verified")
    expect(result?.claimId).toContain("PA ⊥ 平面 ABC")
    expect(result?.proofSource).toBe("system-canonical")
    // 系统替用户做的选择（判定定理取的那两条相交线）要跟着走 —— 用户确认前要看得见。
    expect(result?.choices.join(" ")).toContain("AB")
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain("#print axioms draw_line_plane_perpendicular_goal")
  })

  /**
   * **一个已知缺口，钉在判据里而不是藏起来**（2026-10-10）：
   *
   * 适配器要求**实测的后端版本串**才产出产物（"没有版本的证明不算证明"），
   * 而桌面命令 `check_lean_proof` **今天不报 Lean 的版本** ⇒ 这条产品路径即使真的验过了，
   * 也拿不到产物、升不了证据状态。下一步是**让桌面命令把版本报回来**（跑一次 `lean --version`
   * 或读工程里的 `lean-toolchain`）；在那之前这条链"能跑、但绑不上"。
   */
  it("**没有后端版本串 ⇒ 验过了也不产出产物**（这是当前的真实状态，不是失败）", async () => {
    const { channel } = fakeChannel([{ outcome: "exited", exitCode: 0, stdout: OK_STDOUT, stderr: "", durationMs: 68_000, detail: "" }])
    const result = await attemptProofForStage({ prompt: PROMPT, obligations: parseDiagramObligations(PROMPT), flagEnabled: true, channel })

    expect(result?.outcome).toBe("rejected")
    expect(result?.claimId).toBeNull()
    // 理由要说清是**缺版本**，而不是"证明不成立"。
    expect(result?.detail).toContain("版本")
  })
  it("**版本串由桌面命令带回来 ⇒ 产物绑得上**（这才是这条产品路径修好之后的样子）", async () => {
    const { channel } = fakeChannel([
      { outcome: "exited", exitCode: 0, stdout: OK_STDOUT, stderr: "", durationMs: 68_000, detail: "", backendVersion: "Lean (version 4.35.0-rc3, commit 470d5ce1)" }
    ])
    // **注意：调用方没有给 `backendVersion`** —— 版本是从通道回来的那一个。
    const result = await attemptProofForStage({ prompt: PROMPT, obligations: parseDiagramObligations(PROMPT), flagEnabled: true, channel })

    expect(result?.outcome).toBe("verified")
    expect(result?.claimId).toContain("PA ⊥ 平面 ABC")
  })
  it("**浏览器里跑不了 ⇒ 如实说「要桌面版」**（不是错误、也不阻塞作图）", async () => {
    const { channel } = fakeChannel([{ outcome: "unavailable", exitCode: null, stdout: "", stderr: "", durationMs: 0, detail: "这个构建跑在浏览器里" }])
    const result = await attemptProofForStage({ prompt: PROMPT, obligations: parseDiagramObligations(PROMPT), flagEnabled: true, channel })

    expect(result?.outcome).toBe("toolchain_unavailable")
    expect(result?.detail).toContain("浏览器")
  })

  it("**前提指不出出处 ⇒ 停在原地**（连通道都不碰：题面没给那两条垂直时）", async () => {
    const prompt = "在四棱锥 P-ABCD 中，底面 ABCD 是正方形，求证 PA ⊥ 平面 ABCD"
    const { channel, calls } = fakeChannel([])
    const result = await attemptProofForStage({ prompt, obligations: parseDiagramObligations(prompt), flagEnabled: true, channel })

    expect(result?.outcome).toBe("premises_unresolved")
    expect(calls).toEqual([])
  })
})
