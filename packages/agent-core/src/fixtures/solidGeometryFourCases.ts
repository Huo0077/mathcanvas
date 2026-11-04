/**
 * **11 月 5 日四道立体几何题**（实施计划 T1 的固定题面与独立 oracle）。
 *
 * 见 [修复设计](../../../../docs/superpowers/specs/2026-11-05-solid-geometry-four-cases-design.md) §3
 * 与 [实施计划](../../../../docs/superpowers/plans/2026-11-05-solid-geometry-four-cases.md) T1。
 *
 * ## 纪律（逐条对应计划 §Global Constraints）
 *
 * - **原题一字不改**：`ORIGINAL_CASES` 里的题面就是报告里那四段（只做排版归一：下标写成 `A₁`）。
 *   Case 4 的歧义**保留**——"沿 AC 折起"没有说 `D → P`，也没有说目标里的 `CD` 是折前还是折后。
 * - **修订版单独一份**（`REVISED_CASE_4`）：`D → P`、`CD` 指折前线段。**不覆盖原题**。
 * - **oracle 不来自被测构造器**：下面每个坐标都是人工解析推导（设计 §3）后手抄进来的，
 *   测试只拿它做独立核对，绝不导入生产代码去生成期望值。
 * - 生产代码**不导入本文件**（它只被测试与证据脚本使用）。
 *
 * ## 为什么坐标允许整体平移 / 旋转 / 镜像
 *
 * 设计 §3 明说：这些是**参考见证**，不是产品必须采用的朝向。所以断言不能逐点比坐标，
 * 只能比**不变量**：长度、角度、共面、垂直、平行、距离、二面角 —— 这些在刚体变换下不变。
 * 本文件因此只提供坐标作为 oracle 的**来源记录**，测试要自己从候选坐标量出这些量。
 */

import type { Vector3 } from "@draw/geometry-kernel"

/** 一道题的固定题面（`kind` 区分原题与明确修订版）。 */
export interface SolidGeometryCase {
  /** 稳定 id，用于证据文档与失败信息（**不参与任何生产判断**）。 */
  id: string
  /** 面向读者的短标签。 */
  label: string
  kind: "original" | "revised"
  /** 题面全文（只做排版归一，不改题意）。 */
  prompt: string
  /**
   * 原题里**已知有歧义**时，这里写明是哪个词、缺哪一句解释。
   * `null` = 题面本身没有这一层歧义。
   */
  ambiguity: string | null
  /** 独立人工推导的参考坐标（设计 §3）。测试不得用它生成产品期望值，只用于交叉核对不变量。 */
  reference: {
    points: Record<string, Vector3>
    /** 人工算好的目标量值；T7 才启用。 */
    goals: readonly { id: string; statement: string; value: number | null; holds: boolean }[]
  }
}

/**
 * **Case 1：直角梯形底四棱锥，侧棱垂直底面。**
 *
 * 参考：A=(0,0,0)、B=(2,0,0)、C=(1,2,0)、D=(0,2,0)、P=(0,0,2)、E=(1,0,1)。
 * 底面 AB∥CD、AD⊥AB、AB=AD=PA=2、CD=1；E 为 PB 中点。
 */
export const CASE_1: SolidGeometryCase = {
  id: "case-1-right-trapezoid-pyramid",
  label: "Case 1：直角梯形底四棱锥（PA⊥底面）",
  kind: "original",
  prompt:
    "如图，在四棱锥P-ABCD中，底面ABCD为直角梯形，AB∥CD，AD⊥AB，PA⊥底面ABCD，PA=AB=AD=2，CD=1。点E为棱PB的中点。" +
    "求证：AE⊥平面PBC；求直线PC与平面ADE所成角的正弦值。",
  ambiguity: null,
  reference: {
    points: {
      A: { x: 0, y: 0, z: 0 },
      B: { x: 2, y: 0, z: 0 },
      C: { x: 1, y: 2, z: 0 },
      D: { x: 0, y: 2, z: 0 },
      P: { x: 0, y: 0, z: 2 },
      E: { x: 1, y: 0, z: 1 }
    },
    goals: [
      /**
       * `AE·BC = (1,0,1)·(-1,2,0) = -1 ≠ 0`：**这条待证结论是假的**。
       * 设计 §3 要求"正确草稿与错误结论诊断并存"，不许为了证明它去改图。
       */
      { id: "case-1-goal-1", statement: "AE⊥平面PBC", value: null, holds: false },
      /** 直线 PC 与平面 ADE 夹角的正弦：`6/(3√8) = 1/√2`。 */
      { id: "case-1-goal-2", statement: "sin∠(PC, 平面ADE)", value: Math.SQRT1_2, holds: true }
    ]
  }
}

/**
 * **Case 2：正三棱柱及侧棱分点。**
 *
 * 参考：A=(0,0,0)、B=(2,0,0)、C=(1,√3,0)；A₁/B₁/C₁ = 对应底点 +(0,0,3)；
 * D=(1/2,√3/2,0)（AC 中点）、E=(2,0,1)（有向边 B→B₁ 上 t=1/3，**不是中点**）。
 */
export const CASE_2: SolidGeometryCase = {
  id: "case-2-regular-triangular-prism",
  label: "Case 2：正三棱柱 ABC-A₁B₁C₁（棱上定比分点）",
  kind: "original",
  prompt:
    "如图，在正三棱柱ABC-A₁B₁C₁中，底面边长AB=2，侧棱长AA₁=3。点D为棱AC的中点，点E在棱BB₁上，且BE=1。" +
    "证明：A₁C∥平面B₁DE；求二面角A-DE-B₁的余弦值。",
  ambiguity: null,
  reference: {
    points: {
      A: { x: 0, y: 0, z: 0 },
      B: { x: 2, y: 0, z: 0 },
      C: { x: 1, y: Math.sqrt(3), z: 0 },
      A1: { x: 0, y: 0, z: 3 },
      B1: { x: 2, y: 0, z: 3 },
      C1: { x: 1, y: Math.sqrt(3), z: 3 },
      D: { x: 0.5, y: Math.sqrt(3) / 2, z: 0 },
      E: { x: 2, y: 0, z: 1 }
    },
    goals: [
      /** `(C−A₁)·((D−B₁)×(E−B₁)) = −4√3 ≠ 0`：平行**不成立**。 */
      { id: "case-2-goal-1", statement: "A₁C∥平面B₁DE", value: null, holds: false },
      /** 平面 ADE 与 B₁DE 的法向垂直 ⇒ 二面角 A-DE-B₁ = 90°、余弦 0。 */
      { id: "case-2-goal-2", statement: "cos∠(A-DE-B₁)", value: 0, holds: true }
    ]
  }
}

/**
 * **Case 3：菱形底面、顶点投影在对角线交点。**
 *
 * 参考：A=(0,0,0)、B=(2,0,0)、D=(1,√3,0)、C=(3,√3,0)；
 * O=(3/2,√3/2,0)、P=(3/2,√3/2,√3)、M=(9/4,3√3/4,√3/2)。
 */
export const CASE_3: SolidGeometryCase = {
  id: "case-3-rhombus-pyramid",
  label: "Case 3：菱形底四棱锥（PO⊥底面，O 为对角线交点）",
  kind: "original",
  prompt:
    "如图，在四棱锥P-ABCD中，底面ABCD是边长为2的菱形，∠BAD=60°，AC与BD相交于点O。" +
    "PO⊥平面ABCD，PO=√3。点M为棱PC的中点。证明：PA∥平面BDM；求点A到平面PBD的距离。",
  ambiguity: null,
  reference: {
    points: {
      A: { x: 0, y: 0, z: 0 },
      B: { x: 2, y: 0, z: 0 },
      D: { x: 1, y: Math.sqrt(3), z: 0 },
      C: { x: 3, y: Math.sqrt(3), z: 0 },
      O: { x: 1.5, y: Math.sqrt(3) / 2, z: 0 },
      P: { x: 1.5, y: Math.sqrt(3) / 2, z: Math.sqrt(3) },
      M: { x: 2.25, y: (3 * Math.sqrt(3)) / 4, z: Math.sqrt(3) / 2 }
    },
    goals: [
      /** `PA` 在平面 BDM 内无分量且在面外 ⇒ 平行成立。 */
      { id: "case-3-goal-1", statement: "PA∥平面BDM", value: null, holds: true },
      /** A 到平面 PBD 的距离 = √3。 */
      { id: "case-3-goal-2", statement: "dist(A, 平面PBD)", value: Math.sqrt(3), holds: true }
    ]
  }
}

/**
 * **Case 4（原题，歧义保留）：直角梯形沿 AC 翻折。**
 *
 * 题面写"将 △ACD 沿 AC 折起成 △PAC"，但：
 * 1. **没有说 `D → P`**（按顶点顺序读会移动铰链端点 `A`/`C` 本身，那是另一件事）；
 * 2. 目标里继续引用 `CD`——它是**折前线段**，还是折后的 `CP`？
 *
 * 所以原题的正确产品行为是**澄清**（一次性把这两点问清楚），不是"造一张自称完全符合原题的图"。
 */
export const CASE_4_ORIGINAL: SolidGeometryCase = {
  id: "case-4-folded-trapezoid-original",
  label: "Case 4（原题，含歧义）：梯形沿 AC 翻折",
  kind: "original",
  prompt:
    "如图，在直角梯形ABCD中，AB∥CD，AD⊥AB，AB=2，AD=CD=1。将△ACD沿AC折起成△PAC，使得平面PAC⊥平面ABC。" +
    "点M为PB的中点。证明：AP⊥CD；求二面角P-AB-C的大小。",
  ambiguity:
    "「将△ACD沿AC折起成△PAC」没有明说 D→P（按有序顶点读会移动铰链端点 A、C），" +
    "且目标里的 CD 没有说清是折前线段还是折后线段 CP —— 两件事都必须一次问清。",
  reference: {
    points: {
      A: { x: 0, y: 0, z: 0 },
      B: { x: 2, y: 0, z: 0 },
      C: { x: 1, y: 1, z: 0 },
      D: { x: 0, y: 1, z: 0 }
    },
    goals: []
  }
}

/**
 * **Case 4 的明确修订版**：固定 A、C，`D` 绕 `AC` 旋转 90° 得到 `P`；`CD` 指**折前线段**。
 *
 * 折前 A=(0,0,0)、B=(2,0,0)、C=(1,1,0)、D=(0,1,0)；
 * 折后 P=(1/2,1/2,±1/√2)、M=(5/4,1/4,±1/(2√2))。
 *
 * 只有这一版才建立数值验收。它**不覆盖** `CASE_4_ORIGINAL`。
 */
export const CASE_4_REVISED: SolidGeometryCase = {
  id: "case-4-folded-trapezoid-revised",
  label: "Case 4（明确修订版）：固定 AC、D→P、CD 指折前",
  kind: "revised",
  prompt:
    "如图，在直角梯形ABCD中，AB∥CD，AD⊥AB，AB=2，AD=CD=1。固定A、C，将点D绕直线AC旋转90°得到点P，" +
    "使得平面PAC⊥平面ABC，且题中引用的CD指折前线段。点M为PB的中点。" +
    "证明：AP⊥CD；求二面角P-AB-C的大小。",
  ambiguity: null,
  reference: {
    points: {
      A: { x: 0, y: 0, z: 0 },
      B: { x: 2, y: 0, z: 0 },
      C: { x: 1, y: 1, z: 0 },
      D: { x: 0, y: 1, z: 0 },
      P: { x: 0.5, y: 0.5, z: Math.SQRT1_2 },
      M: { x: 1.25, y: 0.25, z: Math.SQRT1_2 / 2 }
    },
    goals: [
      /**
       * `AP·CD_pre = (1/2,1/2,1/√2)·(-1,0,0) = -1/2 ≠ 0` —— **这条待证结论是假的**；
       * 若把 `CD` 读成折后 `CP`，`AP·CP = 1/2`，也不垂直。两种读法都假，所以这不是"歧义能救回来"的题。
       */
      { id: "case-4-goal-1", statement: "AP⊥CD", value: null, holds: false },
      /** 二面角 P-AB-C = acos(1/√3) ≈ 54.7356°（镜像分支大小相同）。 */
      { id: "case-4-goal-2", statement: "∠(P-AB-C)", value: Math.acos(1 / Math.sqrt(3)), holds: true }
    ]
  }
}

/** 四道**原题**（Case 4 保留歧义）。证据文档按这个顺序列。 */
export const ORIGINAL_CASES: readonly SolidGeometryCase[] = [CASE_1, CASE_2, CASE_3, CASE_4_ORIGINAL]

/** 需要建立数值验收的**明确修订版**（与 `ORIGINAL_CASES` 分开，互不覆盖）。 */
export const REVISED_CASES: readonly SolidGeometryCase[] = [CASE_4_REVISED]
