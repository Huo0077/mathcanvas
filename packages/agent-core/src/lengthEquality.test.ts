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

/**
 * **A1（2026-10-26）：表达式边界与分数系数**。
 *
 * 这一组钉住的是"读多了 / 读少了"的两侧：
 * - `2/3 AB=CD=2` 的分数系数**必须**按 2/3 算（AB=3，不是 AB= 某个被截断的值）；
 * - `AB+CD=5`、`-AB=CD=2`、`0AB=CD=2` 这类**本层不支持的整式**必须整条落未核验，
 *   不许只读后半截（那会把一条没读懂的条件悄悄变成一条成立的条件）。
 */
describe("length expression boundaries and fraction coefficients", () => {
  function allFixed(input: string): Record<string, number> {
    const out: Record<string, number> = {}
    for (const chain of read(input)) {
      if (!chain.ok) continue
      for (const draft of chain.drafts) {
        if (draft.kind === "fixedLength") out[draft.targets.join("")] = draft.value!
      }
    }
    return out
  }

  it("reads 2/3 AB=CD=2 as AB=3, CD=2", () => {
    expect(allFixed("2/3 AB=CD=2")).toEqual({ AB: 3, CD: 2 })
    expect(allFixed("2/3AB=CD=2")).toEqual({ AB: 3, CD: 2 })
  })

  it("does not round 3 into 3.0000000000000004 for a repeating fraction", () => {
    expect(allFixed("1/3 AB=CD=2")).toEqual({ AB: 6, CD: 2 })
  })

  it("reads a fraction coefficient at every link of the chain", () => {
    expect(allFixed("1/2 AB=2/3 CD=1")).toEqual({ AB: 2, CD: 1.5 })
  })

  /**
   * **共享端点的两段比例必须带上自己的来源**（2026-10-27，§4.7 缺陷）。
   *
   * `AB=2BC=4` 与 `DE=2EA` 在语法上**一模一样**（两段共享中间那个点名），但卷面上是两件事：
   * 前者是"图上两条边的长度比"，**不**蕴含 `B` 落在 `AC` 上；后者是定比分点，`E` 就是被这个
   * 比例**定位**在 `DA` 上的那个点。判据不能靠"名字重复"去猜，只能由读取器**显式**声明。
   *
   * 判据（本层）：**链上有绝对长度锚点时**标 `splitPoint: false`（尺寸陈述），
   * **没有锚点时**标 `splitPoint: true`（定比分点）。
   */
  it("marked an anchored chain ratio AB=2BC=4 as a two-segment ratio", () => {
    const ratio = draftsOf("AB=2BC=4").find((draft) => draft.kind === "segmentRatio")
    expect(ratio?.kind === "segmentRatio" ? ratio.splitPoint : "no-ratio").toBe(false)
  })

  it("keeps an unanchored part:part ratio DE=2EA as a split point", () => {
    const ratio = draftsOf("DE=2EA").find((draft) => draft.kind === "segmentRatio")
    expect(ratio?.kind === "segmentRatio" ? ratio.splitPoint : "no-ratio").toBe(true)
  })

  it("keeps the existing AE=2/5 AD ratio as the same segmentRatio", () => {
    // 这条已有专用读取器；本层一并读时必须给出同一个 `|AE|/|AD| = 2/5`。
    const chains = read("AE=2/5 AD")
    const ratio = chains.flatMap((chain) => (chain.ok ? chain.drafts : [])).find((draft) => draft.kind === "segmentRatio")
    expect(ratio?.kind === "segmentRatio" ? ratio.value : undefined).toBeCloseTo(0.4, 12)
  })

  for (const input of ["AB+CD=5", "AB-CD=5", "-AB=CD=2", "0AB=CD=2", "AB/CD=2", "AB=CD=1e999"]) {
    it(`rejects 「${input}」 instead of reading a legal tail`, () => {
      const chains = read(input)
      expect(chains, `${input} 必须留下一条明确记录`).toHaveLength(1)
      const chain = chains[0]!
      expect(chain.ok, `${input} 不许被读成“成立的条件”`).toBe(false)
    })
  }

  it("never reads CD=2 out of an unsupported sum (no partial drafts)", () => {
    const chains = read("AB+CD=5").filter((chain) => chain.ok && chain.drafts.some((draft) => draft.kind === "fixedLength"))
    expect(chains).toEqual([])
  })

  it("still reads a chain inside a 「（即 …）」 restatement", () => {
    // 括号里那句是**重述**，不是"可以整体忽略的噪声"：里面有等式就要照读。
    expect(allFixed("设 AD=2AB=2（即 AB=BC=1, AD=2）")).toEqual({ AD: 2, AB: 1, BC: 1 })
  })

  it("reads a chain inside a plain parenthetical condition", () => {
    expect(allFixed("已知（AB=BC=2）")).toEqual({ AB: 2, BC: 2 })
  })
})
