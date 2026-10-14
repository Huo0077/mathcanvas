import { describe, expect, it } from "vitest"

import type { Vector3 } from "@draw/geometry-kernel"

import { parseObligationWithLegacy } from "../obligationIR"
import { searchWitness, specForPrompt } from "./witnessSearch"

/**
 * **单字母角 `∠A` 的端到端读数**（Task 11 的边界，2026-10-14）。
 *
 * 读取器那一侧已经有用例钉着"`∠A` 落成 `[前一个点名, 顶点, 后一个点名]`"；这一条钉的是
 * **落成之后真的能造出来**：题面写 `∠A=30°`（而不是 `∠BAC=30°`），搜索层要拿到
 * `verified_instance`，并且测试**自己从坐标量**那个角 —— 不读面板结论。
 *
 * 题面取的是**已被支持的那种形状**（SSA：`AB` 给一条射线、`BC` 给一个圆，内核 `ray-circle`
 * 最多两解）。**第一版我写的是 `AB=8，∠A=60°`（只有一边一角）**，实测拿到的是
 * `underdetermined-planar`：*"C：角已经点名，但缺一条定长 AC"* —— 那是本层**有意**的行为
 *（欠定不画），不是缺陷；它反过来证明**角真的被读进去并参与了推理**（否则报的会是
 * "读不出这个角"）。
 */
const PROMPT = "平面三角形ABC中，AB=8，∠A=30°，BC=4"

const givensOf = (prompt: string) =>
  parseObligationWithLegacy(prompt).ir.obligations.filter((obligation) => obligation.role === "given")

describe("单字母角 ∠A：从题面到实例", () => {
  it("`∠A=30°`（单字母）⇒ 搜到的实例真的满足 30°，由测试自己从坐标量", () => {
    const parsed = parseObligationWithLegacy(PROMPT)
    const shaped = specForPrompt(PROMPT, givensOf(PROMPT))
    expect(shaped.status, JSON.stringify(shaped)).toBe("ok")
    if (shaped.status !== "ok") return

    const result = searchWitness({ obligations: parsed.ir, shape: shaped.recognised.family, spec: shaped.spec, seed: 1, maxCandidates: 8, timeoutMs: 10_000 })
    const why = result.status === "verified_instance"
      ? "verified_instance"
      : result.status === "no_witness"
        ? result.failures.join(" / ")
        : result.reasons.join(" / ")
    expect(result.status, `今天读到的是：${why}`).toBe("verified_instance")
    if (result.status !== "verified_instance") return

    const at = new Map(result.candidate.names.map((name, index) => [name, result.candidate.vertices[index]!]))
    const must = (name: string): Vector3 => {
      const found = at.get(name)
      if (found === undefined) throw new Error(`候选里没有点名 ${name}；现有：${[...at.keys()].join("、")}`)
      return found
    }
    const subtract = (left: Vector3, right: Vector3): Vector3 => ({ x: left.x - right.x, y: left.y - right.y, z: left.z - right.z })
    const dot = (left: Vector3, right: Vector3): number => left.x * right.x + left.y * right.y + left.z * right.z
    const norm = (value: Vector3): number => Math.hypot(value.x, value.y, value.z)

    // ∠A 就是 A→B 与 A→C 两条射线的夹角（自己算，不读构造过程留下的量）。
    const a = must("A")
    const alongB = subtract(must("B"), a)
    const alongC = subtract(must("C"), a)
    const magnitudes = norm(alongB) * norm(alongC)
    expect(magnitudes).toBeGreaterThan(1e-9)
    const degrees = (Math.acos(Math.min(1, Math.max(-1, dot(alongB, alongC) / magnitudes))) * 180) / Math.PI
    expect(degrees, `自算 ∠A = ${degrees.toFixed(4)}°，题面写的是 30°`).toBeCloseTo(30, 4)
  })
})
