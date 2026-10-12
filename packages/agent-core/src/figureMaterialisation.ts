import type { FigureIntent } from "./figureIntent"

/**
 * **缺宿主时的安全物化**（Task 7，2026-10-12）。
 *
 * ## 这一层只做一件事：判"能不能替模型补一个宿主"
 *
 * 现场：题面点了 `B`、`C`、`D`，而模型交的计划**根本没有声明那个平面四边形**
 *（图上只有 `A`、`E`、`F`、`P`）。`withWitnessCoordinates` 要求**恰好一笔宿主动作在场**才能替换坐标，
 * 所以那一族**永远接不进去** —— 内核把坐标造出来了也落不了盘。补宿主就是补这一笔。
 *
 * ## 为什么"判"要单独一层，而且必须是纯函数
 *
 * 补宿主是**无中生有**：系统替模型造一笔它没写过的动作。计划原话是
 * "**先校验形状/名字的唯一性，再生成宿主**……禁止为凑宿主填随机坐标后在核验器前跳过检查"。
 * 所以：
 *
 * - **不产坐标**。这一层的产物里**一个数字都没有** —— 坐标归内核构造器，
 *   而构造器有自己的失败分类（欠定 / 矛盾 / 不支持 / 超时）。在这里编一组"看起来能过"的坐标，
 *   等于把核验器变成橡皮图章。
 * - **判据全部在动手之前**：名字唯一、环合法、点名都在题面里、没有既有宿主抢名字、没有读不懂的题设。
 * - **纯函数**：同样的输入说同样的话，不碰文档、不读时钟、不看随机数。所以它可以被逐条钉住。
 *
 * ## 拒得具体，而不是笼统说"不行"
 *
 * 每个拒绝码对应一种**不同的处置**：`competing_rings` 要回去问用户是哪一只四边形；
 * `name_conflict` 说明计划里有东西已经占了这个名字；`unverified_conditions` 说明题设还没读全 ——
 * 这些都不该被压成同一句话（"失败"），否则用户与下一次修复都不知道该改什么。
 */

export const FIGURE_MATERIALISATION_VERSION = 1 as const

/**
 * **从原话的形状从句读出来的候选环。**
 *
 * 这一层**不自己从条件里推顺序** —— 环的顺序只有认得出"四边形 ABCD"那种形状从句的那一层知道
 *（`specForPrompt` / 解析器）。推出来的顺序会让 `A-B-C-D` 变成 `A-B-D-C`，
 * 而那是一个**自交**的四边形：坐标照样算得出来，图却画错了。
 */
export interface CandidateRing {
  /** 原话里的形状名（"四边形"/"三角形"…），只用于诊断文案。 */
  shape: string
  /** 环上的点名，**按原话顺序**。 */
  names: string[]
  /** `false` 就是**开放的面**（翻折片、四边形片）—— 首批只物化这一种。 */
  closed: boolean
  /** 这条环是从哪几条条件来的（可追溯；空数组表示"由形状从句直接给出"）。 */
  sourceClauseIds: string[]
}

/** 既有动作的最小投影（只读；这一层不去看动作的其余字段）。 */
export interface ExistingHost {
  actionId: string
  vertexNames?: readonly string[]
}

export type MaterialisationRefusalCode =
  | "no_named_ring"
  | "competing_rings"
  | "not_a_planar_ring"
  | "name_conflict"
  | "existing_host"
  | "unverified_conditions"
  /** 闭合物体的物化**不在首批范围**（`solid.create_polyhedron` 要面环，判据比开放面严格得多）。 */
  | "closed_ring_not_supported"

export type MaterialisationDecision =
  | {
      status: "materialise"
      /** **笔动作的骨架**：只有名字与拓扑，**没有坐标**（见文件头）。 */
      action: { actionId: "solid.create_face"; vertexNames: string[]; closed: false }
      sourceClauseIds: string[]
    }
  | { status: "refused"; code: MaterialisationRefusalCode; detail: string }

export interface PlanFigureMaterialisationInput {
  intent: FigureIntent
  /** 形状从句给出的候选环。**两个以上就是"两个竞争四边形"** —— 那时不猜。 */
  candidates: readonly CandidateRing[]
  /** 计划里已有的动作（只读投影）。 */
  existingHosts: readonly ExistingHost[]
}

function refuse(code: MaterialisationRefusalCode, detail: string): MaterialisationDecision {
  return { status: "refused", code, detail }
}

export function planFigureMaterialisation(input: PlanFigureMaterialisationInput): MaterialisationDecision {
  const { intent, candidates, existingHosts } = input

  // ---- 环本身：先要有一个，而且只能有一个 ----
  if (candidates.length === 0) {
    return refuse("no_named_ring", "题面里没有读出一个可以物化的环（形状从句缺失或点名对不上），不替它造一个。")
  }
  if (candidates.length > 1) {
    const described = candidates.map((ring) => `${ring.shape}${ring.names.join("")}`).join("、")
    return refuse("competing_rings", `题面里读出了 ${candidates.length} 个候选环（${described}），不猜是哪一个 —— 猜错会把图整个画成另一只。`)
  }

  const ring = candidates[0]!
  if (ring.closed) {
    return refuse("closed_ring_not_supported", `闭合物体（${ring.shape}${ring.names.join("")}）的物化不在首批范围：它要面环，判据比开放面严格得多，本层不猜面环。`)
  }

  // ---- 环的合法性：名字互异、至少三个、而且**每一个都在题面里出现过** ----
  const names = [...ring.names]
  if (new Set(names).size !== names.length) {
    return refuse("not_a_planar_ring", `环上的点名有重复（${names.join("、")}）—— 重复的点名会让核验器的点名表指到同一个点。`)
  }
  if (names.length < 3) {
    return refuse("not_a_planar_ring", `环上只有 ${names.length} 个点名，连不成一张面。`)
  }
  const known = new Set(intent.objects.map((object) => object.name))
  const unknown = names.filter((name) => !known.has(name))
  if (unknown.length > 0) {
    return refuse("not_a_planar_ring", `点名 ${unknown.join("、")} 不在题面点到的名字里 —— 编出来的点会让核验器去核一条题面没有的条件。`)
  }

  // ---- 计划这边：既有的宿主不许与环抢名字，也不许"另有一只图形" ----
  for (const host of existingHosts) {
    const declared = host.vertexNames ?? []
    const clash = declared.filter((name) => names.includes(name))
    if (clash.length > 0) {
      return refuse("name_conflict", `计划里的 ${host.actionId} 已经用了点名 ${clash.join("、")} —— 再补一个环会让同一个名字指到两个不同的点。`)
    }
  }
  if (existingHosts.length > 0) {
    return refuse("existing_host", `计划里已经声明了宿主（${existingHosts.map((host) => host.actionId).join("、")}），这一份有自己的图形，不再补一个。`)
  }

  // ---- 题设：**只要还有一条没读懂就不造**（"已有条件能认"是这一层的前提） ----
  if (intent.unverified.length > 0) {
    return refuse("unverified_conditions", `还有 ${intent.unverified.length} 条题设没读懂（${intent.unverified.map((entry) => entry.sourceText).join("、")}）—— 在没读全的题面上造结构，等于替题面补了它没说的话。`)
  }

  return {
    status: "materialise",
    action: { actionId: "solid.create_face", vertexNames: names, closed: false },
    sourceClauseIds: [...ring.sourceClauseIds]
  }
}

// ---------------------------------------------------------------- 窄适配

/** 顶点坐标的形状（与 `@draw/geometry-kernel` 的 `Vector3` 同形；这里只做只读搬运）。 */
export interface Vector3Like {
  x: number
  y: number
  z: number
}

/**
 * **物化出来的宿主动作**：一笔真正能交给 `compilePlan` 的 `solid.create_face`。
 *
 * `factIds` 是空数组：这一笔**不是**从任何已确认事实推出来的，而是系统按题面条件补的 ——
 * 编一个事实 id 会让账本里出现"用户确认过这件事"的假记录。
 */
export interface MaterialisedHostAction {
  actionId: "solid.create_face"
  actionKey: string
  factIds: string[]
  inputs: { alias: string; vertices: Vector3Like[]; vertexNames: string[] }
}

export type HostAdaptationRefusalCode =
  | "not_materialised"
  | "ring_name_order_mismatch"
  | "candidate_shape_mismatch"

export type HostAdaptation =
  | { ok: true; action: MaterialisedHostAction }
  | { ok: false; code: HostAdaptationRefusalCode; detail: string }

/**
 * **窄适配**：把"能造"这个判断变成一笔真正的动作。
 *
 * ## 只认一件事：题面那个环与内核构造出来的候选**是不是同一个环**
 *
 * - 点名**逐个同序**相同（不是"集合相同"）：`A,B,D,C` 与 `A,B,C,D` 虽然点集一样，
 *   画出来却是**另一只四边形** —— 很可能是自交的那一只，而它照样能通过坐标核验
 *  （核验器量的是条件，不是"这两只面是不是同一个"）。所以顺序不同一律拒。
 * - 顶点数与点名数相等（多一个顶点就没有名字去指它）。
 *
 * ## 坐标**原样取内核构造的那一份**
 *
 * 这一层一个数字都不自己算：内核的候选是按题面条件**核验过**的（`searchWitness` 的
 * `verified_instance`），在这里编一组"看起来能过"的坐标等于把核验器变成橡皮图章
 *（计划原话："禁止为凑宿主填随机坐标后在核验器前跳过检查"）。
 */
export function materialisedHostAction(
  decision: MaterialisationDecision,
  candidate: { names: readonly string[]; vertices: readonly Vector3Like[] },
  alias: string
): HostAdaptation {
  if (decision.status !== "materialise") {
    return { ok: false, code: "not_materialised", detail: `这一份判断的结果是「不造」（${decision.code}），窄适配没有东西可适配。` }
  }
  if (candidate.vertices.length !== candidate.names.length) {
    return {
      ok: false,
      code: "candidate_shape_mismatch",
      detail: `候选给了 ${candidate.names.length} 个点名却有 ${candidate.vertices.length} 个顶点 —— 多出来的顶点没有名字去指它，不接。`
    }
  }
  const ring = decision.action.vertexNames
  const sameOrder = candidate.names.length === ring.length && ring.every((name, index) => candidate.names[index] === name)
  if (!sameOrder) {
    return {
      ok: false,
      code: "ring_name_order_mismatch",
      detail: `题面点的环是 ${ring.join("")}，而构造出来的候选点是 ${candidate.names.join("")} —— 名字对不上或顺序不同，那不一定是同一只四边形（顺序不同时很可能是自交的那一只），不接。`
    }
  }
  return {
    ok: true,
    action: {
      actionId: "solid.create_face",
      actionKey: alias,
      factIds: [],
      inputs: {
        alias,
        vertices: candidate.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y, z: vertex.z })),
        vertexNames: [...ring]
      }
    }
  }
}
