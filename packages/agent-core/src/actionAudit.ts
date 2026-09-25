import type { ParseError, RepairRequest } from "./contracts"
import { ACTIONS, type ActionAuditDescription, type ActionSpec, type ActionId } from "./actionRegistry"

/**
 * **动作的分类与审计说明**（从 `schemas.ts` 拆出，评审方案 2）。
 *
 * 四件事在这里：哪些动作"登记了但还不支持"（以及为什么）、哪些是可用的、每个动作对界面与审计
 * 该说什么、以及**修复请求**怎么生成（解析失败时交给模型的下一步提示）。它们全是**读登记表**得出的，
 * 没有任何自己的规则 —— 所以"新增一个动作要在这里补什么"是可以逐条检查的。
 */

export const UNSUPPORTED_ACTION_IDS: Readonly<Record<string, string>> = {
  "derived.create_sphere": "球体是派生量：内核能解外接球/内切球（solveCircumsphere3 / solveInsphere3），但 DSL 还没有承载球的图元与重算路径。",
  "derived.create_circumsphere": "外接球是派生量：内核能解（solveCircumsphere3），但还没有承载它的图元与重算路径。",
  "derived.create_insphere": "内切球是派生量：内核能解（solveInsphere3），但还没有承载它的图元与重算路径。",
  "derived.create_triangle_center": "三角形五心是派生量：内核有纯函数（triangleCenter2），但还没有派生点特征与重算路径。",
  "derived.create_triangle_circle": "三角形的内切圆/外接圆目前只能作为派生圆规则存在，还没有独立动作。"
}

/** 这个名字是不是"认得出但目前承载不了"。 */
export function unsupportedActionReason(actionId: string): string | null {
  return UNSUPPORTED_ACTION_IDS[actionId] ?? null
}

/** 这个名字是不是登记在册的动作。 */
export function isRegisteredActionId(value: string): boolean {
  return value in ACTIONS
}

/**
 * **给模型看的动作形状**：只列调用方允许的那几个动作，字段白名单与固定取值都取自上面那张表。
 *
 * 为什么从这里生成、而不是在提示词里手写一份：**校验读的就是这张表**。两处各写一份必然分叉，
 * 而分叉的表现是"模型按提示词填了、校验却拒了" —— 第一次真实运行正是这样
 *（模型产出了 `solid.create_template`，`template` 填了别的值，报 `invalid_template`）。
 */
export function describeActions(actionIds?: readonly string[]): { actionId: string; inputs: readonly string[]; enums: Record<string, readonly string[]> }[] {
  return (Object.keys(ACTIONS) as ActionId[])
    .filter((actionId) => !actionIds || actionIds.includes(actionId))
    .map((actionId) => {
      const spec: ActionSpec = ACTIONS[actionId]
      return { actionId, inputs: spec.inputFields, enums: spec.enumValues ?? {} }
    })
}

/** 一个动作的**审计说明**：必填字段 + 引用字段 + 每个字段缺失时的默认策略（规格 §6.2）。 */
function auditDescription(actionId: ActionId, spec: ActionSpec): ActionAuditDescription {
  return {
    actionId,
    requiresAlias: spec.requiresAlias,
    inputs: spec.inputFields,
    enums: spec.enumValues ?? {},
    // 引用字段从这里出去（Fix round 1 / M4）：编译器的引用解析表由它生成，不再有第二份。
    references: (spec.references ?? []).map((reference) => ({ ...reference })),
    required: spec.required ?? [],
    defaults: Object.entries(spec.defaults ?? {}).map(([field, policy]) => ({
      field,
      policy: policy.policy,
      ...(policy.value === undefined ? {} : { value: policy.value }),
      ...(policy.reason === undefined ? {} : { reason: policy.reason }),
      ...(policy.question === undefined ? {} : { question: policy.question }),
      ...(policy.infer === undefined ? {} : { infer: policy.infer }),
      ...(policy.appliesWhen === undefined ? {} : { appliesWhen: policy.appliesWhen })
    }))
  }
}

/** 单个动作的审计说明；未登记的名字返回 `null`（审计据此走 unknown/unsupported 分支，**不编**一份出来）。 */
export function auditEntryFor(actionId: string): ActionAuditDescription | null {
  if (!(actionId in ACTIONS)) return null
  return auditDescription(actionId as ActionId, ACTIONS[actionId as ActionId])
}

/**
 * **默认策略表**：给提示词与审计共用的那一份。
 *
 * 为什么由这里生成而不是在提示词里手写：提示词要告诉模型"缺哪个字段会怎样"，
 * 而**校验与补全读的是同一张表**。两处各写一份必然分叉，症状是"模型按提示词省略了、
 * 结果被问了一遍"或者反过来。
 */
export function describeDefaultPolicies(actionIds?: readonly string[]): ActionAuditDescription[] {
  return (Object.keys(ACTIONS) as ActionId[])
    .filter((actionId) => !actionIds || actionIds.includes(actionId))
    .map((actionId) => auditDescription(actionId, ACTIONS[actionId]))
}

/**
 * 把解析错误整理成**一次性修复请求**（计划 Task 4 + 规格 §7）。
 *
 * 只带 `reason` / `errors`（路径 + 原因码）/ `allowedChanges`（从错误路径去重而来）。
 *
 * `attempt` **不夹上限**（Fix round 1 / M7）：以前夹成恒等于 1，调用方永远分不清"第一次"与
 * "第三次"，于是"超出上限就拒绝再修"这条判据在调用方一侧根本无法实现。上限由
 * `MAX_REPAIR_ATTEMPTS` 表达，调用方自己比。
 */
export function repairRequestFor(errors: readonly ParseError[], attempt: number, reason = "schema_invalid"): RepairRequest {
  return {
    reason,
    errors: errors.map((error) => ({ code: error.code, path: error.path, detail: error.detail })),
    allowedChanges: [...new Set(errors.map((error) => error.path))],
    attempt: Math.max(1, Math.trunc(attempt))
  }
}
