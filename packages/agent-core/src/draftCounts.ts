import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"

import { isDerivedPrimitive, isTessellationPrimitive } from "./derivedPrimitives"

/**
 * **草稿预览的对象计数**（Task 0.8 Step 4 / Task 2.5 Step 4）。
 *
 * 计划要求预览与确认面板都如实显示"用户 / 派生 / 内部"三类各多少。这三类不是三种装饰，而是
 * **用户能不能编辑**的三档：
 * - `user`：用户在画布上直接建的对象（可拖、可删、可选中）；
 * - `derived`：由别的对象算出来的对象（交点、交线、连线……）—— 拖不动，删掉来源它就没了；
 * - `internal`：圆类实体的多边形近似细节（细分顶点与母线）—— 文档里有、画布不画、列表不列。
 *
 * 三档的判据**只有一处**：`isTessellationPrimitive` 与 `isDerivedPrimitive`（都在
 * `derivedPrimitives.ts`）。画布、对象树、预览、确认面板都取同一份，而不是各写一遍
 * `type === "..."` 的清单 —— 那种清单一定会慢慢分叉。
 *
 * 隐藏对象单独计数而不是并入 `user`：预览要说清"确认之后你能看见几个"，
 * 而一个"用户建了但被隐藏"的对象如果算进可见数，用户会以为确认后画布上会多出东西。
 *
 * **这个文件从 `apps/web/src/agent/` 移到这里**：确认面板（`ConfirmationPanel`）也要算同样的数，
 * 而它要给的是"这次会多出/少掉多少"（候选 vs 基础两份文档）。放在 `agent-core` 里，
 * 宿主侧（`hostBridge.preview`）与界面侧用的是**同一个函数**，不会各算一套。
 */

export interface DraftObjectCounts {
  /** 用户可直接编辑的对象（可见）。 */
  user: number
  /** 隐藏的用户对象：文档里有，确认后画布上看不见。 */
  hidden: number
  /** 由别的对象算出来的对象。 */
  derived: number
  /** 圆类实体多边形近似的内部细节（细分顶点与母线）。 */
  internal: number
  /** 文档里的图元总数，供预览做"改动大小"的说明。 */
  total: number
}

/** 与 `apps/web/src/primitiveVisibility.ts` 同一判据（agent-core 不能依赖 app 包）。 */
function isVisible(primitive: PrimitiveSpec): boolean {
  return primitive.visible !== false
}

/**
 * 统计一份候选文档。**派生且隐藏**的对象算 `derived` 而不是 `hidden`：
 * 分类问的是"它是什么"，隐藏只是一个开关；把两者混在一起会让"有多少个我改不了的对象"失真。
 */
export function countDraftObjects(document: GeometryDocument): DraftObjectCounts {
  let user = 0
  let hidden = 0
  let derived = 0
  let internal = 0
  for (const primitive of document.primitives) {
    if (isTessellationPrimitive(primitive)) {
      internal += 1
      continue
    }
    if (isDerivedPrimitive(primitive)) {
      derived += 1
      continue
    }
    if (isVisible(primitive)) user += 1
    else hidden += 1
  }
  return { user, hidden, derived, internal, total: document.primitives.length }
}
