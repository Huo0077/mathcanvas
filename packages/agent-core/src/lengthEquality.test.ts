import { describe, expect, it } from "vitest"

import { parseLengthChains } from "./lengthEquality"

/**
 * **长度连等表达式**（2026-10-26 修复）：`AD=AB=2CD=2` 这类混合连等必须**整条**读对。
 *
 * 这一组只测确定性解析器本身；产品链路（parser → compile → draft → Worker）另有集成用例。
 */
function read(input: string) {
  return parseLengthChains(input)
}

function draftsOf(input: string) {
  const chains = read(input)
  expect(chains, `${input} 应当被识别为一条链`).toHaveLength(1)
  const chain = chains[0]!
  expect(chain.ok, `${input} 应当解析成功：${chain.ok ? "" : chain.reason}`).toBe(true)
  return chain.ok ? chain.drafts : []
}

function fixedOf(input: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const draft of draftsOf(input)) {
    if (draft.kind === "fixedLength") out[draft.targets.join("")] = draft.value!
  }
  return out
}

describe("length equality chains", () => {
  it("reads AD=AB=2CD=2 as AD=2, AB=2, CD=1", () => {
    expect(fixedOf("AD=AB=2CD=2")).toEqual({ AD: 2, AB: 2, CD: 1 })
  })

  it("reads AD=AB=2CD=4 as AD=4, AB=4, CD=2 (never AD=2)", () => {
    expect(fixedOf("AD=AB=2CD=4")).toEqual({ AD: 4, AB: 4, CD: 2 })
  })

  it("reads AD=AB=2CD=2EF=4 as AD=4, AB=4, CD=2, EF=2", () => {
    expect(fixedOf("AD=AB=2CD=2EF=4")).toEqual({ AD: 4, AB: 4, CD: 2, EF: 2 })
  })

  it("reads 2AB=3CD=6 as AB=3, CD=2", () => {
    expect(fixedOf("2AB=3CD=6")).toEqual({ AB: 3, CD: 2 })
  })

  it("keeps the old AD=2AB=2 capability: AD=2, AB=1", () => {
    expect(fixedOf("AD=2AB=2")).toEqual({ AD: 2, AB: 1 })
  })

  it("keeps PA=PD=√5 and PA=PD=2√5 as radicals, not 2", () => {
    expect(fixedOf("PA=PD=√5")).toEqual({ PA: Math.sqrt(5), PD: Math.sqrt(5) })
    expect(fixedOf("PA=PD=2√5")).toEqual({ PA: 2 * Math.sqrt(5), PD: 2 * Math.sqrt(5) })
  })

  it("treats a LaTeX radical as the same number", () => {
    expect(fixedOf("PA=PD=2\\sqrt{5}")).toEqual({ PA: 2 * Math.sqrt(5), PD: 2 * Math.sqrt(5) })
  })

  it("keeps primes and subscripts as distinct point names", () => {
    const drafts = draftsOf("AB=AA₁=2")
    expect(drafts.some((draft) => draft.kind === "fixedLength" && draft.targets.join("") === "AA₁")).toBe(true)
  })

  it("produces equalLength / ratio when no absolute value anchors the chain", () => {
    const drafts = draftsOf("AB=AC=2BC")
    expect(drafts.some((draft) => draft.kind === "equalLength" && draft.targets.join("") === "ABAC")).toBe(true)
    const ratio = drafts.find((draft) => draft.kind === "segmentRatio" && draft.targets.join("") === "ACBC")
    expect(ratio?.kind === "segmentRatio" ? ratio.value : undefined).toBe(2)
    // 没有绝对锚点时**不许**猜长度
    expect(drafts.some((draft) => draft.kind === "fixedLength")).toBe(false)
  })

  it("rejects non-positive lengths instead of degrading to equalLength", () => {
    for (const input of ["AB=AC=0", "AB=AC=-2"]) {
      const chains = read(input)
      expect(chains).toHaveLength(1)
      expect(chains[0]!.ok, `${input} 必须被拒绝`).toBe(false)
      if (!chains[0]!.ok) expect(chains[0]!.sourceText).toContain("AB=AC")
    }
  })

  it("rejects a dangling chain instead of partially reading it", () => {
    const chains = read("AD=AB=2CD=")
    expect(chains).toHaveLength(1)
    expect(chains[0]!.ok).toBe(false)
  })

  it("does not treat a single length or a non-segment equality as a chain", () => {
    expect(read("AB=2")).toEqual([])
    expect(read("∠ABC=60°")).toEqual([])
    expect(read("AE:AD=2:5")).toEqual([])
  })
})
