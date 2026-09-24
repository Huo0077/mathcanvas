import type { GeometryDocument } from "@draw/dsl"

/**
 * **文档 id 与自动标签的分配**（从 `App.tsx` 拆出）。
 *
 * 这一族回答的是同一个问题：**用户按下"新建 X"时，这个对象该叫什么**。
 * 它们此前是 `App.tsx` 里的九个模块级函数，`useSceneStore.getState()` 被拿来当类型用 ——
 * 于是这段规则既进不了别的模块，也没法单独测。
 *
 * ## 为什么它值得一个文件（也是评审方案 1 的一条主线）
 *
 * 同一个问题在仓库里有**两套实现**，而且历史上真的因为漂移出过故障：
 * 手工路径（这里）扫已有 id 取下一个空位；Agent 路径用 `@draw/scene-graph` 的
 * `createIdAllocator`。动作层的分配器曾经"只会数数、不知道文档里已经有什么" ——
 * 画布上已有 `solid-1` 时，Agent 新建的第一个立体又被发成 `solid-1`，
 * `validatePatch` 判 `duplicate object id`，整轮运行以 `compile_failed` 结束
 * （真实现场：账本 `run-6-mubf109e`）。修法就是让分配器也接受"已占用集合"。
 *
 * 所以这两套的**语义必须一致**：都是"从 1 开始找第一个没被占用的号"。
 * 搬到这里之后，它们至少各自可测；将来要合并成一处，也有了明确的落点。
 *
 * ## 一条刻意的边界
 *
 * 这里**只**决定"叫什么"，不创建对象、不碰 store。分配与写入分开，是为了让
 * "id 规则"本身可以被直接断言（造一份文档、问它下一个 id 是什么）。
 */

/** 某类对象在文档里的下一个可用 id。 */
function nextIndexedId(prefix: string, taken: Iterable<string | undefined>): string {
  const used = new Set(taken)
  let index = 1
  while (used.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

export function nextPrimitiveId(document: GeometryDocument, prefix: string): string {
  return nextIndexedId(prefix, document.primitives.map((primitive) => primitive.id))
}

export function nextGroupId(document: GeometryDocument): string {
  return nextIndexedId("group", document.groups.map((group) => group.id))
}

export function nextAnnotationId(document: GeometryDocument): string {
  return nextIndexedId("annotation", document.annotations.map((annotation) => annotation.id))
}

export function nextEngineeringAnnotationId(document: GeometryDocument): string {
  return nextIndexedId("engineering-annotation", (document.engineeringAnnotations ?? []).map((annotation) => annotation.id))
}

export function nextMeasurementId(document: GeometryDocument): string {
  return nextIndexedId("measurement3", document.measurements.map((measurement) => measurement.id))
}

/**
 * Planar points use the classroom labels A…Z; after Z the counter falls back to a running number so a
 * long construction never reuses a label. Existing documents keep whatever labels they already stored.
 */
export function nextPointLabel(document: GeometryDocument): string {
  return nextPointLikeLabel(document, "point")
}

export function nextPoint3Label(document: GeometryDocument): string {
  return nextPointLikeLabel(document, "point3")
}

/**
 * 平面点与空间点的标签规则**逐字相同**（A…Z，用尽后退成 `P<个数+1>`），只是看的是不同的图元类型。
 * 合成一处：两份实现漂移的下场是"平面点在 Z 之后叫 P27、空间点叫别的"，而用户看不出为什么。
 */
function nextPointLikeLabel(document: GeometryDocument, type: "point" | "point3"): string {
  const points = document.primitives.filter((primitive) => primitive.type === type)
  const usedLabels = new Set(points.map((primitive) => primitive.label))
  for (let index = 0; index < 26; index += 1) {
    const label = String.fromCharCode(65 + index)
    if (!usedLabels.has(label)) return label
  }
  return `P${points.length + 1}`
}

/**
 * 焦点是不是在一个"正在输入文字"的控件里。
 *
 * `Boolean(...)` 那一层不是装饰：`isContentEditable` 在 jsdom 与部分 WebView 里是 `undefined`
 * 而不是 `false`，于是整个表达式会返回 `undefined` —— 而签名声明的是 `boolean`。
 * 调用方一旦写 `=== false` 判断"不在输入框里"，那个分支就永远不会命中（实测被用例抓出来）。
 * 返回类型上写着 `boolean`，就必须真的只返回 `true` / `false`。
 */
export function isTextEditingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && Boolean(target.isContentEditable))
}

/** Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y redo — unless a text field owns the keystroke. */
export function historyShortcut(event: KeyboardEvent): "undo" | "redo" | null {
  /**
   * `altKey` 与"焦点在输入框里"两条都必须挡住：少了前者，Alt+Ctrl+Z（某些布局上的输入法组合）
   * 会触发撤销；少了后者，用户在一个数值输入框里按 Ctrl+Z 会**撤销整篇文档的改动**，
   * 而不是他刚打进去的那几个字符 —— 那是会让人丢掉工作的那种 bug。
   */
  if (!(event.ctrlKey || event.metaKey) || event.altKey || isTextEditingTarget(event.target)) return null
  const key = event.key.toLowerCase()
  if (key === "z") return event.shiftKey ? "redo" : "undo"
  return key === "y" ? "redo" : null
}
