/**
 * `DomainOperation` 变体名的**唯一真值列表**（运行时）。
 *
 * 与 `@draw/dsl` 的 `PRIMITIVE_TYPE_NAMES` 同一个理由：`DomainOperation` 是类型联合，
 * 运行时枚举不出来，而 Agent 的能力注册表必须逐个说明"这个操作可不可用"。
 *
 * 漂移防护同 `primitiveTypeNames`：`satisfies readonly DomainOperation["op"][]` 保证这里不会多出
 * 不存在的操作名，`capabilities.ts` 的 `Record<DomainOperation["op"], ...>` 保证不会漏掉新增的操作。
 */
import type { DomainOperation } from "./operations"

export const DOMAIN_OPERATION_NAMES = [
  "addPrimitive",
  "addPrimitives",
  "updatePrimitive",
  "toggleLock",
  "setParameter",
  "deleteParameter",
  "setParameterExpression",
  "addAnnotation",
  "deleteAnnotation",
  "addEngineeringAnnotation",
  "deleteEngineeringAnnotation",
  "addConstraint",
  "deleteConstraint",
  "addMeasurement",
  "deleteMeasurement",
  "deleteObject",
  "deleteObjects",
  "toggleVisibility",
  "createGroup",
  "deleteGroup",
  "alignPrimitives",
  "setPrimitivesLocked",
  "setPrimitivesVisible",
  "setPrimitivesStyle",
  "addLayer",
  "updateLayer",
  "deleteLayer",
  "setActiveLayer",
  "addDrawingSheet",
  "updateDrawingSheet",
  "addDrawingView",
  "updateDrawingView",
  "deleteDrawingView",
  "translatePrimitive",
  "translatePrimitive3",
  "rotatePrimitive3",
  "moveSectionPlane",
  "rotateSectionPlane",
  "setSectionPlane"
] as const satisfies readonly DomainOperation["op"][]

/** 运行时用的操作变体名。 */
export type DomainOperationName = (typeof DOMAIN_OPERATION_NAMES)[number]

/**
 * **唯一的运行时操作守卫**（计划 Task 0.3 点名要求），校验与 Agent 适配器共用它。
 *
 * 为什么必须存在：`validatePatch` 是逐条 `if (operation.op === "...")` 检查的，
 * 一个没被任何分支覆盖的 op 会**绕过全部校验**并返回 valid —— 模型或旧版客户端塞一个
 * 形状像操作、名字不认识的对象进来就能走到执行路径。这道守卫把"不认识 = 拒绝"变成前置条件。
 *
 * 放在本文件而不是 `operations.ts`：真值列表 `DOMAIN_OPERATION_NAMES` 在这里，
 * 而 `patches.ts` 要用它；放进 `operations.ts` 会与这里形成循环导入。
 */
export function isDomainOperation(value: unknown): value is DomainOperation {
  return typeof value === "object" && value !== null && typeof (value as { op?: unknown }).op === "string" && (DOMAIN_OPERATION_NAMES as readonly string[]).includes((value as { op: string }).op)
}
