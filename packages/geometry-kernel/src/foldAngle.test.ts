import { describe, expect, it } from "vitest"

import { foldAnglesForTargetDistance } from "./rotation3d"

/**
 * **Task 12：从目标距离反求折角**（2026-10-12）。用户原题那一句：
 *
 * > 将三角形 AEF 沿 EF 翻折至三角形 PEF，使得 PC = 4√3。
 *
 * ## 这条 RED 挡的是什么
 *
 * 在此之前，**折角是模型自己算出来填给 `solid.fold` 的** —— 而现场是"连发 7 次、7 次死因各不相同"，
 * 其中查实的一条正是**模型在自己手算折后的坐标**。所以这一条**不给**模型猜的 P、也**不给**角，
 * 只给题面里那组**经独立回代**的 ABCD/E/F 坐标与目标距离，要求系统自己求出折角。
 *
 * 原先 `solidFoldAction.test.ts` 里"折 90° 时 PC 恰为 4√3"那条**不能冒充**这条 RED ——
 * 它是**把 90° 当输入**喂进去的（闭式旁证），而不是把 90° **求**出来。
 *
 * ## 坐标（与 `solidFoldAction.test.ts` 同一组，逐字相同）
 *
 * `A=(0,0,0)`、`E=(3,√3,0)`、`F=(4,0,0)`、`C=(9,√3,0)`；折痕方向 `EF=(1,−√3,0)`。
 * 手推的闭式：`EA ⊥ EF` ⇒ A 到折痕的垂足恰好是 `E`，`|AE| = 2√3`，
 * `|PC|² = 48 + 36·cos θ` ⇒ `PC = 4√3 ⟺ cos θ = 0 ⟺ θ = 90°`。
 */

const A = { x: 0, y: 0, z: 0 }
const E = { x: 3, y: Math.sqrt(3), z: 0 }
const F = { x: 4, y: 0, z: 0 }
const C = { x: 9, y: Math.sqrt(3), z: 0 }
/** 折痕方向（不必是单位向量 —— 求解器自己要归一化）。 */
const ALONG_EF = { x: F.x - E.x, y: F.y - E.y, z: F.z - E.z }

const TARGET_DISTANCE = 4 * Math.sqrt(3)

describe("Task 12 — 从目标距离反求折角", () => {
  it("用户那道题：求出唯一折角 90°（而不是被喂进 90°）", () => {
    const outcome = foldAnglesForTargetDistance(A, E, ALONG_EF, C, TARGET_DISTANCE)

    expect(outcome.status, JSON.stringify(outcome)).toBe("solved")
    if (outcome.status !== "solved") return
    // `cos θ = 0` 在 `(0°,180°]` 里只有一支。
    expect(outcome.degrees).toHaveLength(1)
    expect(outcome.degrees[0]).toBeCloseTo(90, 6)
  })

  it("求出来的角**真的**把距离变成 4√3** —— 用旋转自己回代，不读求解器的中间量", () => {
    const outcome = foldAnglesForTargetDistance(A, E, ALONG_EF, C, TARGET_DISTANCE)
    expect(outcome.status).toBe("solved")
    if (outcome.status !== "solved") return

    // 自己绕折痕转一遍（罗德里格斯公式，与求解器无关的第二条路径）。
    const axisLength = Math.hypot(ALONG_EF.x, ALONG_EF.y, ALONG_EF.z)
    const axis = { x: ALONG_EF.x / axisLength, y: ALONG_EF.y / axisLength, z: ALONG_EF.z / axisLength }
    const fold = (degrees: number) => {
      const radians = (degrees * Math.PI) / 180
      const v = { x: A.x - E.x, y: A.y - E.y, z: A.z - E.z }
      const cosine = Math.cos(radians)
      const sine = Math.sin(radians)
      const cross = { x: axis.y * v.z - axis.z * v.y, y: axis.z * v.x - axis.x * v.z, z: axis.x * v.y - axis.y * v.x }
      const dot = axis.x * v.x + axis.y * v.y + axis.z * v.z
      return {
        x: E.x + v.x * cosine + cross.x * sine + axis.x * dot * (1 - cosine),
        y: E.y + v.y * cosine + cross.y * sine + axis.y * dot * (1 - cosine),
        z: E.z + v.z * cosine + cross.z * sine + axis.z * dot * (1 - cosine)
      }
    }
    for (const degrees of outcome.degrees) {
      const p = fold(degrees)
      expect(Math.hypot(p.x - C.x, p.y - C.y, p.z - C.z), `${degrees}° 折出来的 PC`).toBeCloseTo(TARGET_DISTANCE, 9)
    }
  })

  it("**反向折痕**给的是同一个角（折痕方向取反不改变图形）", () => {
    const reversed = foldAnglesForTargetDistance(A, E, { x: -ALONG_EF.x, y: -ALONG_EF.y, z: -ALONG_EF.z }, C, TARGET_DISTANCE)
    expect(reversed.status).toBe("solved")
    if (reversed.status !== "solved") return
    expect(reversed.degrees[0]).toBeCloseTo(90, 6)
  })

  it("**距离够不到**要判成「证明无解」，并给出可达区间（不是「没找到」）", () => {
    const outcome = foldAnglesForTargetDistance(A, E, ALONG_EF, C, 1000)
    expect(outcome.status, JSON.stringify(outcome)).toBe("unreachable")
    if (outcome.status !== "unreachable") return
    // 可达距离区间：`|PC|² = 48 + 36·cos θ` ⇒ `PC ∈ [√12, √84]`。
    expect(outcome.minimum).toBeCloseTo(Math.sqrt(12), 6)
    expect(outcome.maximum).toBeCloseTo(Math.sqrt(84), 6)
  })

  it("**折角不在允许区间**（θ=0 才对）要与「无解」分开", () => {
    // 不折时的距离 `|AC| = √84` ⇒ 解是 θ=0°，而 `(0°,180°]` 里没有它。
    const outcome = foldAnglesForTargetDistance(A, E, ALONG_EF, C, Math.sqrt(84))
    expect(outcome.status, JSON.stringify(outcome)).toBe("outside-range")
  })

  it("**退化折痕**（待折点就在折痕上）如实说退化，不许给一个假角", () => {
    // 拿 `E` 当待折点：它到折痕的（垂直）距离是 0 ⇒ 转多少度它都不动。
    const outcome = foldAnglesForTargetDistance(E, E, ALONG_EF, C, TARGET_DISTANCE)
    expect(outcome.status, JSON.stringify(outcome)).toBe("degenerate")
  })
})
