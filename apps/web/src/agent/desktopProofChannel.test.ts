import { afterEach, describe, expect, it } from "vitest"

import { parseDiagramObligations, type AutomaticProofRequest } from "@draw/agent-core"

import { createDesktopProofChannel, normalizeProofChannelResult, runAutomaticProof } from "./desktopProofChannel"

/**
 * **产品侧接线**的判据（V2 GREEN 缺口③的第二半）。
 *
 * 不需要 Lean、不需要 mathlib、不需要真的桌面外壳：`__TAURI_INTERNALS__` 是可注入的
 *（`desktopRuntime.ts` 只认这个入口），所以两种环境都能在这里造出来。
 *
 * **最要紧的两条**：① 浏览器里**如实说跑不了**（不是抛、也不是假装）；② IPC 回包是
 * **不可信输入**，形状不对一律按失败处理 —— **绝不允许它变成"验证通过"**。
 */
const internalsKey = "__TAURI_INTERNALS__"

function installInvoke(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
  Object.defineProperty(globalThis, internalsKey, { value: { invoke }, configurable: true })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, internalsKey)
})

const REQUEST: Omit<AutomaticProofRequest, "channel"> = {
  base: "verified_instance",
  claimId: "claim-web",
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
  obligations: parseDiagramObligations("在三棱锥 P-ABC 中，PA ⊥ AB，PA ⊥ AC，求证 PA ⊥ 平面 ABC"),
  proof: "simp",
  flagEnabled: true,
  backendVersion: "Lean 4.34.1（测试）"
}

describe("桌面证明通道（web 侧接线）", () => {
  it("**浏览器里如实说跑不了**：不抛、不假装，而且**一个 IPC 都不发**", async () => {
    // 没有 `__TAURI_INTERNALS__` ⇒ 这就是浏览器。
    const result = await runAutomaticProof(REQUEST)

    expect(result.outcome).toBe("toolchain_unavailable")
    expect(result.status).toBe("verified_instance")
    expect(result.detail).toContain("桌面外壳")
  })

  it("桌面外壳里：命令名与参数**逐字固定**（`check_lean_proof` + source/timeoutMs）", async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = []
    installInvoke(async (command, args) => {
      calls.push({ command, args })
      return { outcome: "exited", exitCode: 0, stdout: "'draw_line_plane_perpendicular_goal' depends on axioms: [propext, Classical.choice, Quot.sound]\n", stderr: "", durationMs: 68_000, detail: "" }
    })

    const result = await runAutomaticProof({ ...REQUEST, timeoutMs: 123_456 })

    expect(result.outcome).toBe("verified")
    expect(result.status).toBe("formally_proved")
    expect(calls).toHaveLength(1)
    expect(calls[0]!.command).toBe("check_lean_proof")
    expect(calls[0]!.args?.timeoutMs).toBe(123_456)
    // 送出去的是**模板生成的那种源码**（桌面那边还要再查一遍形状）。
    expect(String(calls[0]!.args?.source)).toContain("#print axioms draw_line_plane_perpendicular_goal")
  })

  it("**畸形的 IPC 回包一律按失败处理**（绝不当成「验证通过」）", () => {
    const malformed = [
      undefined,
      null,
      42,
      "verified",
      [],
      { outcome: "verified" },
      { outcome: "exited", exitCode: "0", stdout: "", stderr: "", durationMs: 1 },
      { outcome: "exited", exitCode: 0, stdout: 42, stderr: "", durationMs: 1 },
      { outcome: "exited", exitCode: 0, stdout: "", stderr: "", durationMs: "快" }
    ]
    for (const raw of malformed) {
      const normalized = normalizeProofChannelResult(raw)
      expect(normalized.outcome, JSON.stringify(raw)).toBe("failed")
      expect(normalized.detail).toContain("形状不对")
    }
  })

  it("形状**对**的回包逐字段原样交回（不丢输出：判据那层要看 `#print axioms` 的原文）", () => {
    const normalized = normalizeProofChannelResult({ outcome: "timeout", exitCode: null, stdout: "半截", stderr: "错误", durationMs: 180_001, detail: "墙钟超时" })

    expect(normalized).toEqual({ outcome: "timeout", exitCode: null, stdout: "半截", stderr: "错误", durationMs: 180_001, detail: "墙钟超时" })
  })

  it("**IPC 抛了 ⇒ 失败而不是「不可用」**（外壳在、这一趟没成，是两件不同的事）", async () => {
    installInvoke(async () => {
      throw new Error("IPC 断了")
    })

    const result = await runAutomaticProof(REQUEST)

    expect(result.outcome).toBe("rejected")
    expect(result.status).toBe("verified_instance")
    expect(result.detail).toContain("IPC 断了")
  })

  it("桌面回包说「没配工具链」 ⇒ 如实照抄那句话（**「没配」不是「证不出来」**）", async () => {
    installInvoke(async () => ({ outcome: "unavailable", exitCode: null, stdout: "", stderr: "", durationMs: 0, detail: "DRAW_LEAN_LAKE 没配" }))

    const result = await runAutomaticProof(REQUEST)

    expect(result.outcome).toBe("toolchain_unavailable")
    expect(result.detail).toContain("DRAW_LEAN_LAKE")
  })

  it("`createDesktopProofChannel` 在两种环境里给出**不同的**通道（而不是同一个兜底）", async () => {
    const browser = await createDesktopProofChannel()({ source: "x", timeoutMs: 1 })
    expect(browser.outcome).toBe("unavailable")

    installInvoke(async () => ({ outcome: "exited", exitCode: 0, stdout: "", stderr: "", durationMs: 2, detail: "" }))
    const desktop = await createDesktopProofChannel()({ source: "x", timeoutMs: 1 })
    expect(desktop.outcome).toBe("exited")
  })
})
