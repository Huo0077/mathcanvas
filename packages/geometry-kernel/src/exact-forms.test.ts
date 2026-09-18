import { describe, expect, it } from "vitest"

import { exactFormOf } from "./exact-forms"

/**
 * 把测量出来的浮点数还原成精确形式（用户口径："能够识别到图中的小数，并且在功能内输出分数形式，
 * 无理数也能输出"）。
 *
 * 2026-09-19 口径调整（用户反馈："这个近似不那么好用，手稍微偏一偏分数就没了，我们不需要那么精确，
 * 我们要将数据往常见整数和分数上面靠"＋"坐标是整数或分数时，能够准确计算时，还是保留精度"）：
 *
 * 1. **精确层不动**：紧容差（相对 1e-9 / 绝对 1e-12）命中整数 / 分母 ≤ 64 的分数 / π 的有理倍数 /
 *    根式 ⇒ 文本不带 `≈`。手输的 `0.0625` 仍是 `1/16`、`0.66` 仍是 `33/50` —— 能准确算就保留精度。
 * 2. **吸附层重写**：紧容差不中时，不再用"输入自身十进制末位的半个单位"（拖动出来的全精度浮点
 *    容差近似为 0，于是 2/3 立刻掉成 `≈ 0.67`），也不再取"分母 ≤ 64 里最接近的有理数"（那会给出
 *    `33/50`、`20/29` 甚至 `(11-4√7)/5`）。现在只在**常见形式**里找：整数、分母 ∈ {2,3,4,5,6,8,10,12}
 *    的既约分数、π 的有理倍数、简单根式；常量族容差 0.3%、常见分数族容差 2%。
 * 3. **兜底不变**：都不中才给两位小数（`≈ 0.64`），**不再出现"未识别"这句话**。
 */
describe("exact form recognition: 精确层（能准确算就保留精度）", () => {
  it("recognises integers and fractions", () => {
    expect(exactFormOf(3).form).toMatchObject({ kind: "integer", text: "3" })
    expect(exactFormOf(0.75).form).toMatchObject({ kind: "rational", text: "3/4" })
    expect(exactFormOf(-3.5).form).toMatchObject({ kind: "rational", text: "-7/2" })
    expect(exactFormOf(1 / 3).form).toMatchObject({ kind: "rational", text: "1/3" })
    // 浮点误差的经典例子：0.1 + 0.2 = 0.30000000000000004 ⇒ 仍然是 3/10。
    expect(exactFormOf(0.1 + 0.2).form).toMatchObject({ kind: "rational", text: "3/10" })
  })

  it("keeps the exact fraction of a typed decimal, however uncommon it looks", () => {
    // 用户口径："坐标是整数或分数时，能够准确计算时，还是保留精度。"
    // 0.0625 就是 1/16、0.66 就是 33/50 —— 精确层不参与"往常见值靠"，1/16 不该被压成 ≈。
    expect(exactFormOf(0.0625).form).toMatchObject({ kind: "rational", text: "1/16" })
    expect(exactFormOf(0.0625).certainty).toBe("exact")
    expect(exactFormOf(0.66).form).toMatchObject({ kind: "rational", text: "33/50" })
    expect(exactFormOf(0.66).certainty).toBe("exact")
  })

  it("reports the residual of an exact hit", () => {
    const reading = exactFormOf(0.75)
    expect(reading.value).toBeCloseTo(0.75, 12)
    expect(Math.abs(reading.residual!)).toBeLessThanOrEqual(1e-9)
  })

  it("refuses non-finite input instead of inventing a form", () => {
    expect(exactFormOf(Number.NaN).form.kind).toBe("unrecognised")
    expect(exactFormOf(Number.POSITIVE_INFINITY).form.kind).toBe("unrecognised")
    expect(exactFormOf(Number.NaN).residual).toBeNull()
  })

  it("keeps an exact match marked exact, without the approximation sign", () => {
    for (const value of [0.75, 1 / 3, Math.PI / 6, Math.SQRT2]) {
      expect({ value, certainty: exactFormOf(value).certainty }).toMatchObject({ value, certainty: "exact" })
      expect(exactFormOf(value).form.text.startsWith("≈")).toBe(false)
    }
  })
})

/**
 * 这一组是本次改动的核心：**拖动出来的值**（全是全精度浮点，十进制末位没有意义）也要能认出
 * 常见的整数与分数，而不是掉回两位小数。
 */
describe("exact form recognition: 吸附层（往常见整数与分数靠）", () => {
  it("recovers a common fraction from a hand-dragged value", () => {
    for (const [input, text] of [
      // 0.667023 是拖动出来的全精度浮点：旧实现按"十进制末位的半个单位"给容差（5e-7），2/3 差 4.6e-4 ⇒ 直接被拒。
      [0.667023, "≈ 2/3"],
      [0.6666, "≈ 2/3"],
      // 差 1.25% 也认（用户选的带宽 B：手"稍微偏一偏"远不止 0.1%）。
      // 这里必须是**拖动出来的全精度值** —— 字面的 0.68 会被精确层认成 17/25，那正是
      // "坐标是整数或分数时能准确计算就保留精度"（见上面精确层那一组）。
      [0.6751, "≈ 2/3"],
      [0.334, "≈ 1/3"],
      [0.5032, "≈ 1/2"],
      [2.9999, "≈ 3"],
      [2.998, "≈ 3"],
      [0.0834, "≈ 1/12"],
      [0.69, "≈ 7/10"],
      [0.51, "≈ 1/2"]
    ] as const) {
      const reading = exactFormOf(input)
      expect({ input, text: reading.form.text, certainty: reading.certainty }).toMatchObject({ input, text, certainty: "approximate" })
      expect(reading.form.text.startsWith("≈")).toBe(true)
    }
  })

  it("recovers the named constants the two canvases actually produce", () => {
    // 常量认得更紧（0.3%），但它们本来就是这个画布的高频结论：对角线、圆、60° 角。
    for (const [input, text] of [[1.41421, "≈ √2"], [0.866, "≈ √3/2"], [3.1416, "≈ π"], [1.5708, "≈ π/2"]] as const) {
      const reading = exactFormOf(input)
      expect({ input, text: reading.form.text, kind: reading.form.kind }).toMatchObject({ input, text, kind: reading.form.text.startsWith("≈ π") ? "pi-multiple" : "surd" })
    }
  })

  it("never invents a form outside the common set", () => {
    // 旧松层实测给过 0.69 → 20/29、0.51 → 25/49、0.0834 → (11-4√7)/5、2.998 → (5+4√39)/10。
    // 这些"数学上更近、教学上没用"的形式现在一个都不许出现：候选集只有整数、常见分母的分数、
    // π 的有理倍数和简单根式。
    const forbidden = [/\/29\b/, /\/49\b/, /\/50\b/, /√7\b/, /√39\b/]
    for (const input of [0.69, 0.51, 0.0834, 2.998, 0.667023, 0.6751]) {
      for (const pattern of forbidden) expect(exactFormOf(input).form.text).not.toMatch(pattern)
    }
    // 命中必须是**常见分母**：整数或 {2,3,4,5,6,8,10,12}。
    const commonDenominators = new Set([2, 3, 4, 5, 6, 8, 10, 12])
    for (const input of [0.667023, 0.6751, 0.334, 0.5032, 2.9999, 0.0834, 0.69, 0.51]) {
      const text = exactFormOf(input).form.text
      expect(text.startsWith("≈ "), `${input} ⇒ ${text}`).toBe(true)
      const body = text.slice(2)
      if (body.includes("/")) {
        expect(commonDenominators.has(Number(body.split("/")[1])), `${input} ⇒ ${text}`).toBe(true)
      } else {
        expect(Number.isInteger(Number(body)), `${input} ⇒ ${text}`).toBe(true)
      }
    }
  })

  it("falls back to two decimals when nothing common is close", () => {
    // 0.6435 离最近的常见分数（5/8 = 0.625）差 2.9%、离最近的简单根式（√7 − 2）差 0.36% —— 两族都不中。
    expect(exactFormOf(0.6435).form).toMatchObject({ kind: "unrecognised", text: "≈ 0.64" })
    expect(exactFormOf(0.6435).certainty).toBe("approximate")
    expect(exactFormOf(0.6435).residual!).toBeCloseTo(0.0035, 6)
    // 带宽是有边界的：0.6815 离 2/3 有 2.2%，超出 2% 的带就落回两位小数，而不是"什么都认"。
    expect(exactFormOf(0.6815).form).toMatchObject({ kind: "unrecognised", text: "≈ 0.68" })
  })

  it("no longer swallows e into a common fraction", () => {
    // 这一条曾经**如实记录代价**：e = 2.71828… 既不是常见分数也不在常量窄带里，
    // 于是被吸到 27/10（差 0.67%）。用户随后要求"e 也需要有"，e 因此进了常量族
    //（见下面「e 的整数倍」那一组）；这条用例反过来钉住那个旧代价不再出现。
    expect(exactFormOf(Math.E).form).not.toMatchObject({ kind: "rational", text: "≈ 27/10" })
    expect(exactFormOf(Math.E).form.text).not.toContain("未识别")
  })
})

/**
 * **e 的整数倍**（2026-09-19，用户口径："e 也需要有"）。
 *
 * 这一族的边界与 π 那一家刻意不同：π 要认到 π/12（角度的 15°、30°、45° 都是分数倍），
 * 而 e 在这个画布上没有"分数倍"的自然来源 —— 放开分母只会让更多普通值被某个怪形式认领
 *（e/12 ≈ 0.2266 的间距下，0.3% 的带会覆盖约 7% 的数轴）。所以这里只认**整数倍**：
 * `e`、`2e`、`3e`、`-e`…，间距是 e 本身，误认概率低两个数量级。
 */
describe("exact form recognition: integer multiples of e", () => {
  it("recognises e itself exactly, without the approximation sign", () => {
    expect(exactFormOf(Math.E).form).toMatchObject({ kind: "e-multiple", text: "e" })
    expect(exactFormOf(Math.E).certainty).toBe("exact")
    expect(exactFormOf(Math.E).form.text.startsWith("≈")).toBe(false)
    expect(exactFormOf(-Math.E).form).toMatchObject({ kind: "e-multiple", text: "-e" })
    expect(exactFormOf(2 * Math.E).form).toMatchObject({ kind: "e-multiple", text: "2e" })
  })

  it("snaps a hand-dragged value near e back to e", () => {
    // 2.7182 / 2.7183 都在紧容差之外、常量带（0.3%）之内 ⇒ 带 ≈。
    for (const [input, text] of [[2.7182, "≈ e"], [2.7183, "≈ e"], [5.4366, "≈ 2e"]] as const) {
      const reading = exactFormOf(input)
      expect({ input, text: reading.form.text, certainty: reading.certainty }).toMatchObject({ input, text, certainty: "approximate" })
    }
  })

  it("does not let e's family claim ordinary values", () => {
    // e 只在它自己附近发声：0.667023 仍然必须是 2/3，3 仍然是整数，0.6435 仍然落回两位小数。
    expect(exactFormOf(0.667023).form.text).toBe("≈ 2/3")
    expect(exactFormOf(3).form).toMatchObject({ kind: "integer", text: "3" })
    expect(exactFormOf(0.6435).form).toMatchObject({ kind: "unrecognised", text: "≈ 0.64" })
    // 2.5001（e 与 3e 之间的普通值）不该被吸到 e 的整数倍上：最近的 1e 差 8.7%，
    // 该赢的仍然是常见分数 5/2。
    expect(exactFormOf(2.5001).form.text).toBe("≈ 5/2")
  })
})

/**
 * 两个画布的角都统一到弧度了，所以 **π 的有理倍数**是角的读数最常见的精确形式
 *（π/2、π/3、2π/3…）。这一族只有角会用到，但它同时是"分数与无理数别打架"的试金石。
 */
describe("exact form recognition: rational multiples of pi", () => {
  it("recognises the angles a teaching canvas actually produces", () => {
    expect(exactFormOf(Math.PI).form).toMatchObject({ kind: "pi-multiple", text: "π" })
    expect(exactFormOf(Math.PI / 4).form).toMatchObject({ kind: "pi-multiple", text: "π/4" })
    expect(exactFormOf(2 * Math.PI).form).toMatchObject({ kind: "pi-multiple", text: "2π" })
    expect(exactFormOf(-3 * Math.PI / 2).form).toMatchObject({ kind: "pi-multiple", text: "-3π/2" })
    expect(exactFormOf(Math.PI / 6).form).toMatchObject({ kind: "pi-multiple", text: "π/6" })
  })

  it("does not mistake a plain fraction for a pi multiple, nor invent one", () => {
    // 0.75 必须仍是 3/4：π/4 ≈ 0.785398 差得远。
    expect(exactFormOf(0.75).form).toMatchObject({ kind: "rational", text: "3/4" })
    // 分母超过上限的 π 倍数应当如实落回两位小数（吸附层的 π 倍数分母上限仍是 12）。
    expect(exactFormOf(Math.PI / 100).form).toMatchObject({ kind: "unrecognised", text: "≈ 0.03" })
  })
})

/**
 * 二次无理数 `(a + b√n)/c` —— 用户选的是"这一层也要认"（深度 B）。
 * 课堂上的 √2、√2/2、(1+√5)/2、2+√3 都在这一族里。
 */
describe("exact form recognition: quadratic surds", () => {
  it("recognises the surds a teaching canvas produces", () => {
    expect(exactFormOf(Math.SQRT2).form).toMatchObject({ kind: "surd", text: "√2" })
    expect(exactFormOf(Math.SQRT2 / 2).form).toMatchObject({ kind: "surd", text: "√2/2" })
    expect(exactFormOf(2 + Math.sqrt(3)).form).toMatchObject({ kind: "surd", text: "2+√3" })
    expect(exactFormOf((1 + Math.sqrt(5)) / 2).form).toMatchObject({ kind: "surd", text: "(1+√5)/2" })
    expect(exactFormOf(-Math.sqrt(3) / 2).form).toMatchObject({ kind: "surd", text: "-√3/2" })
    expect(exactFormOf(3 * Math.sqrt(2)).form).toMatchObject({ kind: "surd", text: "3√2" })
  })

  it("keeps the residual inside the tight tolerance for every exact family", () => {
    for (const value of [0.75, 1 / 3, Math.PI / 4, Math.SQRT2, (1 + Math.sqrt(5)) / 2]) {
      const reading = exactFormOf(value)
      expect(reading.form.kind).not.toBe("unrecognised")
      expect(Math.abs(reading.residual!)).toBeLessThanOrEqual(Math.max(1e-12, Math.abs(value) * 1e-9))
    }
  })

  /**
   * 这个函数会在渲染路径上被**每个测量**调用（画布标注 + 属性栏）。历史教训：第一版按 n 枚举根式
   * （约 70 万个候选）实测最坏 114.9 ms。吸附层的候选集只有几十个，整条链路的耗时必须留出护栏，
   * 否则"加一族候选"会把界面拖垮而没人发现。
   */
  it("stays fast enough for the render path", () => {
    const start = performance.now()
    let sink = 0
    for (let index = 0; index < 1000; index += 1) sink += exactFormOf(0.6 + index * 0.0007).value
    const elapsed = performance.now() - start
    expect(Number.isFinite(sink)).toBe(true)
    expect(elapsed, `1000 次 exactFormOf 用了 ${elapsed.toFixed(1)} ms`).toBeLessThan(1000)
  })
})
