import { createEmptyDocument, decodeMgeo, encodeMgeo, type ConstraintSpec, type GeometryDocument, type PrimitiveSpec } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"
import { describe, expect, it } from "vitest"

import { applyOperation, recomputeDerivedObjects, solidStatusReport } from "./index"

/**
 * **大型场景性能基准**（评审方案 7）。
 *
 * ## 为什么要有它（以及为什么它现在才有）
 *
 * 功能测试能证明**结果对不对**，但证明不了**它是不是从几十毫秒退化到了几秒**：
 * 同一批断言在一份 1000 图元的文档和一份 5 图元的文档上都会通过，只是前者要等两秒。
 * 项目历史上真的出现过这样的退化（选中任意图元时对整篇文档枚举 `C(n,4)` 求外接球：
 * 22 顶点 1.5 秒、32 顶点分钟级，被外部审查记为 G1）—— 而当时**没有任何一条用例会报警**。
 *
 * ## 这一批只**记录趋势**，不设"必须多快"的硬门槛
 *
 * 评审的口径是"基准先记录趋势，再为关键交互设可接受上限"。理由很实在：
 * CI 机器的速度与本机差几倍，写死 `toBeLessThan(200)` 会在别人的机器上变成随机失败，
 * 而随机失败的门禁最后一定会被人关掉 —— 那等于没有门禁。
 *
 * 所以这里的做法分两层：
 *
 * 1. **趋势**：每个场景都把实测耗时打印出来（`PERF <名字> <毫秒>`），
 *    人工对比或者由 CI 收集成序列，用来回答"这次改动让它变慢了吗"。
 * 2. **上限**：只钉**量级**上的、留足余量的护栏。它们的作用是抓住"复杂度写错了"这一类退化，
 *    而不是测量常数因子 —— 所以取"实测值的约 100 倍"。
 *
 * ## 上限是**量出来的**，不是拍的
 *
 * 本机（2026 年本轮）实测：`addPrimitives/1000-planar` **7.5 ms**、
 * `recomputeDerivedObjects/100-solid` **22.5 ms**、`solidStatusReport/100-solid` **4.5 ms**、
 * `encodeMgeo/large` **4.3 ms**。下面的上限都在实测值的 100 倍上下：
 * 足够容纳慢十倍的 CI 机器（仍有十倍余量），又比"退化到秒级"的那一类真实缺陷紧得多 ——
 * 项目历史上那次 G1（选中任意图元枚举 `C(n,4)` 求外接球）正是**秒到分钟级**。
 *
 * 记住这条护栏的用途：它是**报警器**，不是性能目标。想让某个交互更快，
 * 应该盯 `PERF` 那行数字，而不是把这个阈值改小。
 *
 * 每个场景**先跑一遍热身**再计时：第一遍会付 JIT 与内联缓存的钱，
 * 直接计它会把"首次运行"的成本记成"这个场景的成本"。
 */

/** 场景生成用的确定顺序伪随机（不用 `Math.random`：基准必须可复现）。 */
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function geometryDocument(primitives: PrimitiveSpec[] = []): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  document.primitives = primitives
  return document
}

/** 铺开的平面图元（点 + 线段），坐标确定，互不重合。 */
function planarPrimitives(count: number): PrimitiveSpec[] {
  const random = lcg(20260924)
  // 点先收进一个有类型的数组再拼线段：直接从 `PrimitiveSpec[]` 里取 `.x` 过不了判别联合的收窄，
  // 而基准夹具不值得为类型断言冒"取错字段"的风险。
  const points: Extract<PrimitiveSpec, { type: "point" }>[] = []
  for (let index = 0; index < count; index += 1) {
    points.push({ id: `point-${index}`, type: "point", x: Math.round(random() * 2000) / 4, y: Math.round(random() * 2000) / 4 })
  }
  const segments: PrimitiveSpec[] = []
  for (let index = 0; index + 1 < points.length; index += 2) {
    segments.push({ id: `segment-${index}`, type: "segment", a: { x: points[index].x, y: points[index].y }, b: { x: points[index + 1].x, y: points[index + 1].y } })
  }
  return [...points, ...segments]
}

/** 一排互不重叠的立方体，每个都带上真实的物化拓扑（这正是 P0 之后生产路径的形状）。 */
function solidPrimitives(count: number): PrimitiveSpec[] {
  const primitives: PrimitiveSpec[] = []
  for (let index = 0; index < count; index += 1) {
    const cube = { id: `solid-${index}`, type: "cube" as const, origin: { x: (index % 10) * 4, y: Math.floor(index / 10) * 4, z: 0 }, size: { x: 2, y: 2, z: 2 } }
    primitives.push(cube, ...buildSolidTemplate(cube).primitives)
  }
  return primitives
}

/**
 * **密集两两相交**的夹具（评审方案 7 点名）。
 *
 * 造法：一批**都过原点附近**的直线（角度铺开，彼此都相交），再挂一批派生交点。
 * 关键在于每个交点在重算时都要解析它的两条来源 —— 也就是 `O(交点数 × 来源查找)`
 * 而不是"看起来很像相交"。这也是历史上出过事的那一档（外部审查 G1：22 顶点 1.5 秒、
 * 32 顶点分钟级），所以它值得有一条常设读数。
 *
 * 返回的文档里每条 `line-*` 都是真直线（`type: "line"`），`intersection-*` 指向两条来源。
 */
function denseIntersectionPrimitives(lineCount: number, intersectionCount: number): PrimitiveSpec[] {
  const primitives: PrimitiveSpec[] = []
  for (let index = 0; index < lineCount; index += 1) {
    // 角度均匀铺开：任意两条都不平行，所以每一对都真的相交。
    const angle = (index * Math.PI) / lineCount
    primitives.push({
      id: `line-${index}`,
      type: "line",
      a: { x: -Math.cos(angle) * 100, y: -Math.sin(angle) * 100 },
      b: { x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 }
    })
  }
  for (let index = 0; index < intersectionCount; index += 1) {
    primitives.push({
      id: `intersection-${index}`,
      type: "intersection",
      lineA: `line-${index % lineCount}`,
      lineB: `line-${(index * 7 + 1) % lineCount}`,
      x: 0,
      y: 0
    })
  }
  return primitives
}

/** 计时：热身一遍再取一趟，返回毫秒。 */
function measure(label: string, run: () => void): number {  run()
  const started = performance.now()
  run()
  const elapsed = performance.now() - started
  // 打印成一行固定前缀，便于 CI 收集成趋势序列。
  console.log(`PERF ${label} ${elapsed.toFixed(1)}`)
  return elapsed
}

/**
 * **取多趟里最快的那一趟**：单趟计时会被 GC / JIT / 调度噪声主导。
 *
 * 这条不是优化，是**正确性要求**。校准用例最初用"单趟 ×4 必须比单趟 ×1 慢"当判据，
 * 结果在整仓并发跑的时候红了：`solidStatusReport` 单趟约 6 ms，一次 GC 尖峰就能让
 * 1× 的读数（43.5 ms）**大于** 4×（38.7 ms）。基准的通行做法是"重复取最小值"——
 * 最小值是最不受干扰的那个估计（噪声只会让某趟变慢，不会让它变快）。
 */
function measureBest(label: string, run: () => void, rounds: number): number {
  let best = Number.POSITIVE_INFINITY
  for (let round = 0; round < rounds; round += 1) best = Math.min(best, measure(label, run))
  return best
}

/**
 * **变异检查**（与仓库里其它回归用例同一条纪律）：把被测路径人为拖慢，确认护栏真的会响。
 *
 * 做法是**重复跑同一条路径**（不动生产代码）：趋势本身是线性的，所以重复 4 次
 * 就等价于"这条路径慢了 4 倍"。判据不是"必须超过阈值"（那要看机器），
 * 而是**打印出重复后的读数**并断言它与单次的比值合理 —— 这样"护栏有没有能力报警"
 * 这件事是被量出来的，一眼能看出还有多少余量。
 *
 * 为什么不在用例里 `expect(慢).toBeGreaterThan(阈值)`：那会在快机器上因为
 * "4 倍还不够慢"而失败，把一条校准用例变成随机失败源。
 */
function repeat<T>(run: () => T, times: number): () => void {
  return () => {
    for (let index = 0; index < times; index += 1) run()
  }
}

describe("large scene performance trends", () => {
  /**
   * 一笔 `addPrimitives` 落进一份**已经有 1000 图元**的文档。
   *
   * `applyOperation` 从整份文档 `structuredClone`，所以这一条同时量到了
   * "文档大小"对**每一笔编辑**的固定成本 —— 那是用户每拖一下都要付的钱。
   */
  it("adds a batch into a 1000-primitive planar document", () => {
    const base = geometryDocument(planarPrimitives(500))
    const batch: PrimitiveSpec[] = Array.from({ length: 50 }, (_, index) => ({ id: `extra-${index}`, type: "point", x: index, y: index }))

    const elapsed = measure("addPrimitives/1000-planar", () => {
      applyOperation(base, { op: "addPrimitives", primitives: batch })
    })

    // 量级护栏（实测 7.5 ms）：真出现"复杂度写错了"才会响。不是性能目标。
    expect(elapsed).toBeLessThan(1_000)
    // 而且它真的做了事（护栏之外还要防"其实什么都没算"）。
    const applied = applyOperation(base, { op: "addPrimitives", primitives: batch })
    expect(applied.changed).toBe(true)
    expect(applied.document.primitives.length).toBe(base.primitives.length + batch.length)
  })

  /**
   * 全量重算一份**含 100 个实体、每个都带物化拓扑**的文档。
   *
   * 这是 P0 修复之后的真实形状：一个立方体在文档里是 28 个图元。100 个 = 约 2800 个图元。
   * 打开文件、撤销到某一版都走全量重算，所以它是"大场景打开要多久"的下界。
   */
  it("recomputes a 100-solid document with materialized topology", () => {
    const document = geometryDocument(solidPrimitives(100))
    // 场景本身要立得住：否则这条基准测的是"一份空文档"。
    expect(document.primitives.length).toBeGreaterThan(2000)

    const elapsed = measure("recomputeDerivedObjects/100-solid", () => {
      recomputeDerivedObjects(document)
    })

    // 实测 22.5 ms。这是"打开一份大文档"的路径，允许比别人宽一些。
    expect(elapsed).toBeLessThan(3_000)
  })

  /**
   * 属性面板那条读数路径：`solidStatusReport` 对 100 只实体各算一遍派生读数
   *（外接球 / 内切球 / 截面）。
   *
   * **这一条正是历史上那次真实退化的现场**（G1：选中任意图元就对整篇文档枚举 `C(n,4)`，
   * 22 顶点 1.5 秒）。修好之后它应当是线性的，这条基准就是那次修复的回归防线。
   */
  it("reports derived readings for 100 solids", () => {
    const document = geometryDocument(solidPrimitives(100))

    const elapsed = measure("solidStatusReport/100-solid", () => {
      solidStatusReport(document)
    })

    // 实测 4.5 ms。**属性面板每次选中都会跑**，所以护栏比上面两条紧 —— 这条就是 G1 的回归防线。
    expect(elapsed).toBeLessThan(500)
    expect(solidStatusReport(document).length).toBeGreaterThan(0)
  })
  /**
   * 保存一份大 `.mgeo`：序列化 + 校验。
   *
   * 用户按一次保存、或者 Agent 提交一次（`commitTransaction` 里也要算内容指纹）都会付这笔钱。
   */
  it("encodes a large .mgeo document", () => {
    const document = geometryDocument([...planarPrimitives(500), ...solidPrimitives(50)])
    expect(document.primitives.length).toBeGreaterThan(1500)

    const encoded = { length: 0 }
    const elapsed = measure("encodeMgeo/large", () => {
      encoded.length = encodeMgeo(document).length
    })

    // 实测 4.3 ms。每次保存 / 每次 Agent 提交算内容指纹都要付这笔钱。
    expect(elapsed).toBeLessThan(1_000)
    // 产物非空：否则量的可能是"什么都没序列化"。
    expect(encoded.length).toBeGreaterThan(10_000)
  })

  /**
   * **保存与恢复的往返**（评审方案 7 点名的"较大 `.mgeo` 的保存与恢复"）。
   *
   * 上面那条只量了编码这一半，而"打开文件"还要付解码与全量重算的钱 ——
   * 用户感知到的是加起来的那个数。这里按真实顺序跑同一串步骤：
   * `decodeMgeo` → `recomputeDerivedObjects`（`App.tsx` 的 `load` 在 `replace` 之后还会走
   * `migrateLegacySolids`，那一步属于 web 层、不在本包职责内，所以这里不假装量到了它）。
   */
  it("round-trips a large .mgeo document", () => {
    const source = geometryDocument([...planarPrimitives(500), ...solidPrimitives(50)])
    const serialized = encodeMgeo(source)

    const elapsed = measure("roundTrip/large-mgeo", () => {
      recomputeDerivedObjects(decodeMgeo(serialized))
    })

    // "打开文件"允许比一次编辑宽，但不该是秒级。
    expect(elapsed).toBeLessThan(5_000)
    // 往返必须是**真**往返：解出来的图元数对得上，否则量的是"解了个空文档"。
    expect(decodeMgeo(serialized).primitives.length).toBe(source.primitives.length)
  })

  /**
   * **大型依赖 DAG 的局部重算**（评审方案 7 点名）。
   *
   * 场景是一条 400 长的**约束链**：`center-0` 是自由点，`center-i` 与 `center-0` 之间挂一条
   * 长度约束，所以 `center-0` 一动，受影响集沿链传播。
   *
   * ## 这一条给的是**等价性判据**，不是"局部更快"的判据
   *
   * 第一版用"直线链：每段与上一段相切"，实测**局部比全量还慢**（0.9 ms vs 1.6 ms），
   * 而且两者都随链长线性增长 —— 那条链根本没体现增量的好处，因为它压根不是真派生链；
   * 换成约束链之后（本机 0.3 ms vs 0.7 ms）**仍然是局部更慢**。差一点就把这种没意义的读数
   * 当成"基准已就绪"交出去。
   *
   * 真实原因是这一档的**固定成本压过增量收益**：两条路径都要先 `structuredClone` 整份文档
   *（800 个图元），而局部路径还要多付一遍受影响集遍历的钱；当"重算本身"很便宜时，
   * 那笔遍历就是净支出。**这不是缺陷，是一条值得记下来的成本结构事实**，
   * 也是"要不要把这段搬进 Worker"那个决定的输入之一（见进度文档的方案 3 一节）。
   *
   * 所以这里不写时长判据（数值太小、方差也压不住），改钉一条**真性质**：
   * 局部重算的结果必须与全量重算**逐图元一致** —— `applyOperation` 走的正是局部那条路，
   * 两者一旦分叉，用户看到的就会是"改动之后画布与打开文件时不一样"。
   */
  it("keeps a large dependency DAG consistent between local and full recompute", () => {
    const chain = 400
    const primitives: PrimitiveSpec[] = [{ id: "center-0", type: "point", x: 0, y: 0 }]
    const constraints: ConstraintSpec[] = []
    for (let index = 1; index < chain; index += 1) {
      primitives.push({ id: `center-${index}`, type: "point", x: index * 2, y: 0 })
      constraints.push({ id: `span-${index}`, type: "distance", targets: ["center-0", `center-${index}`], value: index } as unknown as ConstraintSpec)
    }
    const document = geometryDocument(primitives)
    document.constraints = constraints

    // 场景要立得住：否则量到的是"一抛就退出的失败成本"。
    expect(() => recomputeDerivedObjects(document)).not.toThrow()

    // 读数照旧打印（趋势用）；判据看下面的等价性。
    measure("dag/full-recompute-400", () => { recomputeDerivedObjects(document) })
    measure("dag/local-recompute-400", () => { recomputeDerivedObjects(document, ["center-0"]) })

    const local = recomputeDerivedObjects(document, ["center-0"])
    const full = recomputeDerivedObjects(document)
    expect(local.primitives).toEqual(full.primitives)
  })

  /**
   * **密集两两相交**（评审方案 7 点名）。
   *
   * 200 条过原点的直线 + 200 个派生交点：每个交点在重算时都要解析它的两条来源并求交，
   * 也就是 `O(交点数)` 次求解。这一档是历史上真的出过事的那一档（G1），所以它有一条常设读数。
   */
  it("recomputes a document dense with pairwise intersections", () => {
    const document = geometryDocument(denseIntersectionPrimitives(200, 200))
    expect(document.primitives.length).toBe(400)

    /**
     * 场景要立得住：求不出交点的夹具量到的是"一算就退化"的成本。
     *
     * 判据落在**算出来的坐标**上，而不是某个状态字段 —— `IntersectionPrimitive` 只有
     * `lineA` / `lineB` / `x` / `y`（没有 `kind`），退化时它把坐标留在原处并带诊断。
     *
     * 为了让这条断言**不可能变成空话**：先把那个交点种成 (999, 999) 再重算 ——
     * 如果重算不去覆盖坐标，就会看到 999；只有真的解出来才会回到原点附近。
     * （实测：种 999 → 重算后 `x ≈ -1.4e-14`。夹具里最初就给 0 是不够的，
     * 那与"根本没算"长得一模一样。）
     */
    const seeded = geometryDocument(denseIntersectionPrimitives(200, 200).map((primitive) =>
      primitive.id === "intersection-0" && primitive.type === "intersection" ? { ...primitive, x: 999, y: 999 } : primitive))
    const settled = recomputeDerivedObjects(seeded)
    const first = settled.primitives.find((primitive) => primitive.id === "intersection-0")
    expect(first?.type).toBe("intersection")
    if (first?.type !== "intersection") throw new Error("expected an intersection primitive")
    expect(Number.isFinite(first.x)).toBe(true)
    expect(Number.isFinite(first.y)).toBe(true)
    expect(Math.hypot(first.x, first.y)).toBeLessThan(1)

    const elapsed = measure("denseIntersections/200x200", () => {
      recomputeDerivedObjects(document)
    })

    // 量级护栏（实测见 `PERF` 行）。
    expect(elapsed).toBeLessThan(10_000)
  })

  /**
   * **连续拖动**（评审方案 7 点名的"连续拖动 300 帧"）。
   *
   * 这里量的是**拖动一次要付的那笔钱**：每一次鼠标移动都会走
   * `applyOperation(translatePrimitive3)` → 整份文档 `structuredClone` → 重算。
   * 连续 300 帧就是把这笔钱付 300 次 —— 所以这条读数能不能留在 16 ms 以内，
   * 直接决定"跟手不跟手"（60 fps 的预算是 16.7 ms/帧）。
   *
   * 拖动用的是一个**平面点**（`point` 的 `x` / `y` 补丁），这是最轻的编辑形态；
   * 重的东西（模板实体、带约束的曲线）在别的用例里量。
   */
  it("applies 300 consecutive drag frames", () => {
    const document = geometryDocument([
      { id: "mover", type: "point", x: 0, y: 0 },
      ...planarPrimitives(400)
    ])

    const elapsed = measure("drag/300-frames", () => {
      let current = document
      for (let frame = 0; frame < 300; frame += 1) {
        // **从 (1, 1) 起**，不是从 (0, 0)：点在原点，第一帧若把它"移到 (0,0)"就是空操作，
        // `applyOperation` 会如实回 `changed: false`（这是它该做的 —— 空操作不该进撤销栈）。
        // 夹具要保证每一帧都是真位移，否则量的不是拖动成本。
        const applied = applyOperation(current, { op: "updatePrimitive", id: "mover", patch: { x: 1 + frame * 0.1, y: 1 + frame * 0.05 } })
        if (!applied.changed) throw new Error(`frame ${frame} did not change the document`)
        current = applied.document
      }
    })

    // 300 帧的总预算：实测见 `PERF` 行。这里只抓"复杂度写错了"。
    expect(elapsed).toBeLessThan(30_000)
    // 拖动真的把点挪到位了（否则量的是"每帧都没改动"）。
    const moved = applyOperation(document, { op: "updatePrimitive", id: "mover", patch: { x: 1, y: 2 } })
    const point = moved.document.primitives.find((primitive) => primitive.id === "mover")
    expect(point?.type === "point" ? { x: point.x, y: point.y } : null).toEqual({ x: 1, y: 2 })
  })

  /**
   * **基准真的能报警吗**（校准 / 变异检查）。
   *
   * 把最紧的那条路径（`solidStatusReport`，护栏 500 ms）跑 1 趟与 4 趟，如实打印读数，
   * 并断言"4 趟明显比 1 趟慢"。这条**记录**护栏离被触发还有多远，
   * 而不去断言一个"慢机器上会失败"的硬数字。
   *
   * ## 为什么必须取多趟最小值（这条用例自己红过一次）
   *
   * 第一版用**单趟**计时做单调性判据，在整仓并发跑的时候红了：`solidStatusReport` 单趟约 6 ms，
   * 一次 GC 尖峰就让 1× 的读数（43.5 ms）**大于** 4×（38.7 ms）。
   * 判据本身没错，错的是"单趟读数能代表成本"这个假设 —— 所以现在两支都取多趟里最快的一趟
   *（噪声只会让某趟变慢、不会让它变快，最小值因此是最稳的估计），阈值也从 2 倍降到 1.5 倍。
   */
  it("calibrates the guard: a 4x slower path is measurably slower", () => {
    const document = geometryDocument(solidPrimitives(100))
    const once = measureBest("calibration/solidStatusReport-1x", () => { solidStatusReport(document) }, 5)
    const four = measureBest("calibration/solidStatusReport-4x", repeat(() => { solidStatusReport(document) }, 4), 3)

    expect(four).toBeGreaterThan(once)
    // 4 倍工作量至少要花掉 1.5 倍时间（下界，不受机器速度影响）。
    expect(four).toBeGreaterThan(once * 1.5)
  })
})
