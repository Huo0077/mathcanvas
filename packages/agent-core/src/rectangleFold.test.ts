import { describe, expect, it } from "vitest"

import {
  buildRectangleFold,
  evaluateLength,
  evaluatePerpendicular,
  readRectangleFold,
  verifyRectangleFold
} from "./rectangleFold"
import { readNamedFold, uniqueFoldDisplayName } from "./namedFold"

/**
 * **A3（2026-10-26）：矩形沿对角线折起 + 同名点状态**。
 *
 * 这一组用用户案例与它的变体钉住四件事：
 * 1. 两种语序（折痕在前 / 图形在前）读出**同一份**状态变换，折前折后同名点分开；
 * 2. 折角未知时**不默认 90°**，而是提出具体澄清；
 * 3. 折前矩形判据、折后刚性与平面垂直**分别**核验；
 * 4. 假目标（BD⊥AC）在题设下**不成立** —— 给残差，不硬证。
 */
const USER_CASE = "矩形 ABCD 中，AB=4，BC=2，沿对角线 AC 把 △ABC 折起，使平面 ABC ⊥ 平面 ACD。"

describe("A3 同名点的状态分离", () => {
  it("两种语序读出同一份变换，折前/折后同名点各自有状态", () => {
    const first = readNamedFold("沿对角线 AC 把 △ABC 折起，使平面 ABC ⊥ 平面 ACD。")
    const second = readNamedFold("将 △ABC 沿 AC 折起，使平面 ABC ⊥ 平面 ACD。")

    expect(first.status).toBe("ok")
    expect(second.status).toBe("ok")
    if (first.status !== "ok" || second.status !== "ok") return
    expect(first.transition.syntax).toBe("hinge-first")
    expect(second.transition.syntax).toBe("face-first")
    // 同一个折痕、同一个动点、同一句原文语义 —— 语序不该改变结论。
    expect(first.hingeNames).toEqual(["A", "C"])
    expect(second.hingeNames).toEqual(["A", "C"])
    expect(first.apex).toBe("B")
    expect(second.apex).toBe("B")

    const transition = first.transition
    // **同名点分成两个状态**：显示名都是 B，内部 id 不同。
    expect(transition.apex.before).toMatchObject({ entityId: "B@s0", stateId: "s0", displayName: "B" })
    expect(transition.apex.after).toMatchObject({ entityId: "B@s1", stateId: "s1", displayName: "B" })
    expect(transition.displayPostName).toBe("B")
    expect(transition.explicitPostName).toBe(false)
    expect(transition.internalPostName).toBe("B@s1")
    // 折痕两点在两个状态里都在（位置不动）。
    expect(transition.hinge.before.map((ref) => ref.entityId)).toEqual(["A@s0", "C@s0"])
    expect(transition.hinge.after.map((ref) => ref.entityId)).toEqual(["A@s1", "C@s1"])
    // 没有折角就是**未知**，不许自己补一个 90°。
    expect(transition.angle.kind).toBe("unknown")
  })

  it("显式改名：折后点名被识别，内部状态仍然分开", () => {
    const read = readNamedFold("将 △ABC 沿 AC 折起至 △AB′C，且平面 AB′C ⊥ 平面 ACD。")
    expect(read.status).toBe("ok")
    if (read.status !== "ok") return

    expect(read.transition.displayPostName).toBe("B′")
    expect(read.transition.explicitPostName).toBe(true)
    expect(read.transition.apex.before.entityId).toBe("B@s0")
    expect(read.transition.apex.after.entityId).toBe("B′@s1")
  })

  it("内部生成的新名字避开题面里已有的 B′、B′′、B₁", () => {
    expect(uniqueFoldDisplayName("矩形 ABCD 与点 B′", "B")).toBe("B′′")
    expect(uniqueFoldDisplayName("矩形 ABCD 与点 B′、B′′", "B")).toBe("B₁")
    expect(uniqueFoldDisplayName("矩形 ABCD 与点 B′、B′′、B₁", "B")).toBe("B₂")
    expect(uniqueFoldDisplayName("矩形 ABCD", "B")).toBe("B′")
  })

  it("折痕不在折片上 ⇒ 明确拒绝（不产出半对的一条）", () => {
    const read = readNamedFold("将 △ABC 沿 BD 折起。")
    expect(read.status).toBe("invalid")
    if (read.status === "invalid") expect(read.reason).toContain("折痕")
  })
})

describe("A3 矩形对角线折叠的构造与核验", () => {
  it("用户案例：折后 B=(16/5, 8/5, ±4/√5)，BD²=68/5，BD=2√85/5", () => {
    const read = readRectangleFold(USER_CASE)
    expect(read.status, read.status === "unsupported" ? read.reason : "").toBe("ok")
    if (read.status !== "ok") return

    // 「平面 ABC ⊥ 平面 ACD」是**唯一**允许采用 90° 的来源，而且必须被记下来源。
    expect(read.spec.angle).toMatchObject({ kind: "given", degrees: 90, source: "explicit-perpendicular-planes" })
    expect(read.spec.hinge).toEqual(["A", "C"])
    expect(read.spec.moving).toEqual(["A", "B", "C"])
    expect(read.spec.fixed).toEqual(["A", "C", "D"])
    expect(read.spec.sides).toMatchObject({ a: 4, b: 2 })

    const built = buildRectangleFold(read.spec)
    expect(built.status).toBe("ok")
    if (built.status !== "ok") return
    const geometry = built.geometry

    expect(geometry.pre.A).toEqual({ x: 0, y: 0, z: 0 })
    expect(geometry.pre.B).toEqual({ x: 4, y: 0, z: 0 })
    expect(geometry.pre.C).toEqual({ x: 4, y: 2, z: 0 })
    expect(geometry.pre.D).toEqual({ x: 0, y: 2, z: 0 })

    const folded = geometry.post.B!
    expect(folded.x).toBeCloseTo(16 / 5, 12)
    expect(folded.y).toBeCloseTo(8 / 5, 12)
    expect(Math.abs(folded.z)).toBeCloseTo(4 / Math.sqrt(5), 12)

    const length = evaluateLength(geometry.post, ["B", "D"])
    expect(length.value ** 2).toBeCloseTo(68 / 5, 12)
    expect(length.value).toBeCloseTo((2 * Math.sqrt(85)) / 5, 12)

    // 题设（矩形 + 90° 折）确定到两个镜像分支；BD⊥AC 的判定两种分支一致。
    const other = buildRectangleFold(read.spec, { branch: -1 })
    expect(other.status).toBe("ok")
    if (other.status !== "ok") return
    expect(other.geometry.post.B!.z).toBeCloseTo(-folded.z, 12)
    for (const branch of [geometry, other.geometry]) {
      const claim = evaluatePerpendicular(branch.post, ["B", "D"], ["A", "C"])
      expect(claim.holds, claim.detail).toBe(false)
      expect(claim.residual).toBeCloseTo(12, 12)
    }
  })

  it("折前矩形与折后状态分别核验：构造本身全部通过", () => {
    const read = readRectangleFold(USER_CASE)
    if (read.status !== "ok") throw new Error("fixture")
    const built = buildRectangleFold(read.spec)
    if (built.status !== "ok") throw new Error("fixture")

    const verified = verifyRectangleFold(read.spec, { pre: built.geometry.pre, post: built.geometry.post })
    expect(verified.checks.filter((check) => check.status === "failed"), JSON.stringify(verified.checks.filter((check) => check.status === "failed"), null, 2)).toEqual([])
    expect(verified.status).toBe("passed")
    // 折前与折后的判据**分开挂状态**。
    expect(verified.checks.some((check) => check.state === 0 && check.id === "rectangle_closure")).toBe(true)
    expect(verified.checks.some((check) => check.state === 1 && check.id.startsWith("hinge_fixed_"))).toBe(true)
    expect(verified.checks.some((check) => check.state === 1 && check.id === "planes_perpendicular")).toBe(true)
  })

  it("没有折角、也没有两平面垂直 ⇒ needs_angle，绝不默认 90°", () => {
    const read = readRectangleFold("矩形 ABCD 中，AB=4，BC=2，沿对角线 AC 把 △ABC 折起。")
    expect(read.status).toBe("ok")
    if (read.status !== "ok") return
    expect(read.spec.angle).toEqual({ kind: "unknown" })

    const built = buildRectangleFold(read.spec)
    expect(built.status).toBe("needs_angle")
    if (built.status !== "needs_angle") return
    expect(built.question).toContain("折角")
    expect(built.question).not.toContain("90")
  })

  it("题面明确给了折角时按折角走，不要求平面垂直", () => {
    const read = readRectangleFold("矩形 ABCD 中，AB=4，BC=2，沿对角线 AC 把 △ABC 折起 60°。")
    expect(read.status).toBe("ok")
    if (read.status !== "ok") return
    expect(read.spec.angle).toMatchObject({ kind: "given", degrees: 60, source: "explicit-degrees" })
    const built = buildRectangleFold(read.spec)
    expect(built.status).toBe("ok")
    if (built.status !== "ok") return
    expect(built.geometry.angleDegrees).toBe(60)
    expect(verifyRectangleFold(read.spec, { pre: built.geometry.pre, post: built.geometry.post }).status).toBe("passed")
  })

  it("改名 + 改尺寸 + 换另一条对角线，同一套判据都成立", () => {
    const renamed = "矩形 PQRS 中，PQ=6，QR=3，沿对角线 PR 把 △PQR 折起，使平面 PQR ⊥ 平面 PRS。"
    const readRenamed = readRectangleFold(renamed)
    expect(readRenamed.status, readRenamed.status === "unsupported" ? readRenamed.reason : "").toBe("ok")
    if (readRenamed.status !== "ok") return
    const builtRenamed = buildRectangleFold(readRenamed.spec)
    expect(builtRenamed.status).toBe("ok")
    if (builtRenamed.status === "ok") {
      expect(builtRenamed.geometry.pre.Q).toEqual({ x: 6, y: 0, z: 0 })
      expect(builtRenamed.geometry.post.Q!.x).toBeCloseTo(24 / 5, 12)
      expect(builtRenamed.geometry.post.Q!.y).toBeCloseTo(12 / 5, 12)
      expect(Math.abs(builtRenamed.geometry.post.Q!.z)).toBeCloseTo(6 / Math.sqrt(5), 12)
      expect(verifyRectangleFold(readRenamed.spec, { pre: builtRenamed.geometry.pre, post: builtRenamed.geometry.post }).status).toBe("passed")
    }

    // 另一条对角线：折的是 △BCD。
    const otherDiagonal = "矩形 ABCD 中，AB=4，BC=2，沿对角线 BD 把 △BCD 折起，使平面 BCD ⊥ 平面 ABD。"
    const readOther = readRectangleFold(otherDiagonal)
    expect(readOther.status, readOther.status === "unsupported" ? readOther.reason : "").toBe("ok")
    if (readOther.status !== "ok") return
    expect(readOther.spec.hinge).toEqual(["B", "D"])
    expect(readOther.spec.moving).toEqual(["B", "C", "D"])
    expect(readOther.spec.apex).toBe("C")
    const builtOther = buildRectangleFold(readOther.spec)
    expect(builtOther.status).toBe("ok")
    if (builtOther.status !== "ok") return
    const verified = verifyRectangleFold(readOther.spec, { pre: builtOther.geometry.pre, post: builtOther.geometry.post })
    expect(verified.status, JSON.stringify(verified.checks.filter((check) => check.status === "failed"))).toBe("passed")
    expect(builtOther.geometry.post.C!.z).not.toBe(0)
  })

  it("缺少另一条边 ⇒ 明确说缺什么，不猜", () => {
    const read = readRectangleFold("矩形 ABCD 中，AB=4，沿对角线 AC 把 △ABC 折起，使平面 ABC ⊥ 平面 ACD。")
    expect(read.status).toBe("unsupported")
    if (read.status === "unsupported") expect(read.reason).toContain("BC")
  })

  /**
   * **"比例 + 一条边"也要定得出矩形**（2026-10-27，探针 §11.5 缺口②）。
   *
   * 卷面上常见 `AB:BC=2:1，AB=4` 这种写法：给了比例又给了一条边，另一条边**唯一确定**。
   * 旧读取器只认"逐条给长度"，于是整句被判 `缺少边 BC` ⇒ 题做不了。
   * 判据：比例的两段必须是**环上相邻的一对边**（对边等价），比值按 `|前|/|后|` 折算。
   */
  it("比例 + 一条边 ⇒ 另一条边由比例确定（AB:BC=2:1，AB=4 ⇒ BC=2）", () => {
    const read = readRectangleFold("矩形 ABCD 中，AB:BC=2:1，AB=4，沿对角线 AC 把 △ABC 折起，使平面 ABC ⊥ 平面 ACD。")
    expect(read.status).toBe("ok")
    if (read.status === "ok") expect(read.spec.sides).toMatchObject({ a: 4, b: 2 })
  })

  it("比例方向反过来同样成立（AB:BC=1:2，AB=4 ⇒ BC=8）", () => {
    const read = readRectangleFold("矩形 ABCD 中，AB:BC=1:2，AB=4，沿对角线 AC 把 △ABC 折起，使平面 ABC ⊥ 平面 ACD。")
    expect(read.status).toBe("ok")
    if (read.status === "ok") expect(read.spec.sides).toMatchObject({ a: 4, b: 8 })
  })

  it("比例用对边写（AB:CD=2:1）不据此定另一条边 —— 那时缺的信息仍然缺", () => {
    // `AB:CD` 是**两条对边**之比：矩形的对边本来相等，这条比例只说明"1 = 1"，定不出 BC。
    const read = readRectangleFold("矩形 ABCD 中，AB:CD=2:1，AB=4，沿对角线 AC 把 △ABC 折起，使平面 ABC ⊥ 平面 ACD。")
    expect(read.status).toBe("unsupported")
    if (read.status === "unsupported") expect(read.reason).toContain("BC")
  })

  it("折痕不是对角线 ⇒ 明确拒绝", () => {
    const read = readRectangleFold("矩形 ABCD 中，AB=4，BC=2，将 △ABC 沿 AB 折起。")
    expect(read.status).toBe("unsupported")
    if (read.status === "unsupported") expect(read.reason).toContain("对角线")
  })

  it("垂直关系说的不是折痕两侧的平面 ⇒ 不据此取 90°", () => {
    const read = readRectangleFold("矩形 ABCD 中，AB=4，BC=2，沿对角线 AC 把 △ABC 折起，使平面 ABC ⊥ 平面 PQR。")
    expect(read.status).toBe("unsupported")
    if (read.status === "unsupported") expect(read.reason).toContain("折痕两侧")
  })
})

describe("A3 篡改候选几何必须被逐条挡下", () => {
  function fixture() {
    const read = readRectangleFold(USER_CASE)
    if (read.status !== "ok") throw new Error("fixture")
    const built = buildRectangleFold(read.spec)
    if (built.status !== "ok") throw new Error("fixture")
    return { spec: read.spec, geometry: built.geometry }
  }

  it("挪折后点（沿折痕方向） ⇒ 刚性失败（刚体运动不许改两点距离）", () => {
    const { spec, geometry } = fixture()
    const post = { ...geometry.post, B: { ...geometry.post.B!, z: geometry.post.B!.z + 0.1 } }
    const verified = verifyRectangleFold(spec, { pre: geometry.pre, post })
    expect(verified.status).toBe("failed")
    const failed = verified.checks.filter((check) => check.status === "failed").map((check) => check.id)
    expect(failed).toContain("flap_rigid_A")
    expect(failed).toContain("flap_rigid_C")
  })

  it("把折后点挪到折角不对的位置 ⇒ fold_angle_matches 失败", () => {
    const { spec, geometry } = fixture()
    const post = { ...geometry.post, B: { ...geometry.post.B!, x: geometry.post.B!.x + 0.2 } }
    const verified = verifyRectangleFold(spec, { pre: geometry.pre, post })
    expect(verified.status).toBe("failed")
    expect(verified.checks.filter((check) => check.status === "failed").map((check) => check.id)).toContain("fold_angle_matches")
  })

  it("挪折痕端点 ⇒ hinge_fixed 失败（折痕不是刚体之外的例外）", () => {
    const { spec, geometry } = fixture()
    const post = { ...geometry.post, A: { x: 0.001, y: 0, z: 0 } }
    const verified = verifyRectangleFold(spec, { pre: geometry.pre, post })
    expect(verified.status).toBe("failed")
    expect(verified.checks.filter((check) => check.status === "failed").map((check) => check.id)).toContain("hinge_fixed_A")
  })

  it("折前四边形不闭合/不直角 ⇒ 矩形判据失败", () => {
    const { spec, geometry } = fixture()
    const pre = { ...geometry.pre, D: { x: 0.5, y: 2, z: 0 } }
    const verified = verifyRectangleFold(spec, { pre, post: geometry.post })
    expect(verified.status).toBe("failed")
    const failed = verified.checks.filter((check) => check.status === "failed").map((check) => check.id)
    expect(failed.some((id) => id.startsWith("rectangle_"))).toBe(true)
  })

  it("根本没折（折后=折前） ⇒ 折角对不上，也不会被当成合法草稿", () => {
    const { spec, geometry } = fixture()
    const post = { ...geometry.pre }
    const verified = verifyRectangleFold(spec, { pre: geometry.pre, post })
    expect(verified.status).toBe("failed")
    expect(verified.checks.filter((check) => check.status === "failed").map((check) => check.id)).toContain("fold_angle_matches")
  })
})

describe("A3 假目标：BD⊥AC 在该题设下不成立", () => {
  it("给残差而不是硬证", () => {
    const read = readRectangleFold(USER_CASE)
    if (read.status !== "ok") throw new Error("fixture")
    const built = buildRectangleFold(read.spec)
    if (built.status !== "ok") throw new Error("fixture")

    const claim = evaluatePerpendicular(built.geometry.post, ["B", "D"], ["A", "C"])
    expect(claim.holds).toBe(false)
    expect(claim.residual).toBeCloseTo(12, 12)
    expect(claim.detail).toContain("不垂直")
  })
})
