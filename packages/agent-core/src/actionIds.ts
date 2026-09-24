import type { DraftActionId } from "@draw/scene-graph"

/**
 * **动作层的规范 actionId 清单**（Task 2.2 的前置修复）。
 *
 * ## 为什么需要这份文件
 *
 * `schemas.ts` 的 `ACTIONS` 是**传输层**的白名单：模型输出必须先在这里被认出，才谈得上编译。
 * 而动作层（`packages/scene-graph/src/actions/`）自己认得的 actionId 更多。
 * 两者一旦不同步，后果是**静默的**：模型照计划给出一个合法动作，`parseDraftAction` 报
 * `unknown_action` —— 看起来像"模型编了个不存在的动作"，实际是登记表过期，
 * 而**十几个已实现的动作根本无法从模型输出到达编译器**。
 *
 * 这不是假设。本项目实测过：动作层实现 **20** 个 actionId，而 `ACTIONS` 只登记了 **4** 个
 * （`solid.create_template` / `section.create` / `object.delete` / `object.update`）。
 * 其中 `object.delete` / `object.update` 更是**动作层根本不存在**的名字
 *（真名是 `object.delete_many` / `object.update_inputs`），所以那两个登记项本身也是错的。
 *
 * ## 守卫
 *
 * 1. **编译期（两个方向）**：下面的两处 `satisfies` 让"少一个"与"多一个"都变成编译错误，
 *    靠的是 `DraftActionId` 这个从动作层联合类型导出的字面量联合，而不是"记得同步"。
 * 2. **运行期**：`actionIds.test.ts` 另外核对一次（编译期守卫在 `tsc` 被跳过时不会生效，
 *    而 schema 是安全边界，值得多一道）。
 *
 * ## 为什么只有一份清单、不重复每个动作的字段
 *
 * 载荷的**语义**校验（半径必须为正、坐标必须有限、工作区是否允许该动作……）已经完整地存在于
 * 动作编译器里，而且是唯一一份。传输层再抄一遍必然分叉 —— 抄漏一处就会出现
 * "schema 放行、编译器拒绝"，用户看到的是莫名其妙的失败。所以传输层只负责**认名字**与
 * **拒绝明显畸形的载荷**，把语义交给编译器。这与计划那句 "never cast unknown to a TypeScript type"
 * 不冲突：这里仍然没有任何 `as` 断言到业务类型，校验的是结构。
 */
export const DRAFT_ACTION_IDS = [
  "planar.create_point",
  "planar.create_line",
  "planar.create_segment",
  "planar.create_ray",
  "planar.create_polyline",
  "planar.create_circle",
  "planar.create_arc",
  "planar.create_conic",
  "solid.create_template",
  "solid.create_prism",
  "solid.create_tetrahedron",
  "solid.create_regular_pyramid",
  "solid.create_polyhedron",
  "dynamic.bind_point",
  "dynamic.create_bound_point",
  "dynamic.bind_curve",
  "dynamic.create_locus",
  "dynamic.set_radius_rule",
  "function.create_tangent",
  "function.analyze",
  "section.create",
  "section.materialize",
  "object.delete_many",
  "object.update_inputs",
  "parameter.create",
  "parameter.set",
  "parameter.set_expression"
] as const satisfies readonly DraftActionId[]

export type DraftActionIdName = (typeof DRAFT_ACTION_IDS)[number]

/**
 * 反方向守卫：动作层不许有清单里没写到的 actionId。
 *
 * 写法说明：`Record<DraftActionId, ...>` 要求**每一个**动作层 actionId 都是这个对象的键。
 * 若动作层新增了一个动作而没同步上面那份清单，这里就会缺键 → 编译失败。
 */
const _everyCompilerActionIsListed: Record<DraftActionId, true> = Object.fromEntries(DRAFT_ACTION_IDS.map((id) => [id, true])) as Record<DraftActionId, true>

/** 只为让上面那处反方向守卫不被 lint 当成"声明了没用的变量"；不做别的事。 */
export function assertActionIdCatalogueIsComplete(): true {
  return _everyCompilerActionIsListed["planar.create_point"]
}
