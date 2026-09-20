import { createEmptyDocument } from "@draw/dsl"
import { compileActions } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION } from "./contracts"
import { parsePlanEnvelope } from "./schemas"
import type { IdAllocator } from "@draw/scene-graph"
import type { ActionContext } from "@draw/scene-graph"

/**
 * **传输层 → 动作层的接缝**。
 *
 * 这个文件存在的理由是一次真实的、被两侧测试各自绕开的缺陷：
 *
 * - `schemas.ts` 把既有对象的引用规范化成 `{ scope:"scene", ref:{ documentId, entityId } }`，
 *   并且**只**接受这一种写法；
 * - 动作层的 `SceneReference` 是扁平的 `{ documentId, entityId }`
 *   （`packages/scene-graph/src/actions/types.ts`），编译器读的是 `inputs.target.documentId`。
 *
 * 结果是 `object.update_inputs` / `dynamic.bind_point` / `dynamic.bind_curve`
 * 三个动作**不存在任何一种能同时通过校验并被正确编译的输入**：
 * - 传输层唯一接受的形状 → 编译器读到 `documentId === undefined` → `cross_document_reference`；
 * - 编译器真正需要的形状 → 传输层判 `unscoped_reference`。
 *
 * 为什么此前没被发现：`actions*.test.ts` 只喂**扁平**形状给编译器，
 * `schemas.test.ts` 只喂 **scoped** 形状给解析器 —— 没有任何一条用例
 * 让"**已经过校验的计划**"真的流进编译器。单测全绿，缝是空的。
 *
 * 本文件的纪律：**只用已校验的输出**（`parsePlanEnvelope(...).value`），
 * 不手写动作字面量、不 `as` 动作类型 —— 这样两边的形状一旦再次分叉，这里必红。
 */

function makeAllocator(): IdAllocator {
  const known = new Map<string, string>()
  let counter = 0
  return {
    allocate(kind, alias) {
      const key = `${kind}:${alias}`
      const existing = known.get(key)
      if (existing) return existing
      counter += 1
      const id = `${kind}-${counter}`
      known.set(key, id)
      return id
    }
  }
}

function contextWith(document = createEmptyDocument("conics")): ActionContext {
  return { targetDocument: document, targetWorkspace: document.workspace, orderedSelection: [], capabilityRevision: "test.1", idAllocator: makeAllocator() }
}

/** 一个平面文档：一个点 + 一条圆，够 `object.update_inputs` 与 `dynamic.bind_curve` 用。 */
function planarDocument() {
  const document = createEmptyDocument("conics")
  document.primitives = [
    { id: "point-1", type: "point", x: 1, y: 1 },
    { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 }
  ]
  return document
}

/** 解析必须成功；失败时把真实错误打出来，避免把"解析失败"误当成"编译失败"。 */
function parsedActions(envelope: unknown) {
  const parsed = parsePlanEnvelope(envelope)
  if (!parsed.ok) throw new Error(`envelope was rejected: ${JSON.stringify(parsed.errors)}`)
  if (parsed.value.kind !== "plan") throw new Error(`expected a plan, got ${parsed.value.kind}`)
  return parsed.value.actions
}

describe("transport → action compiler seam", () => {
  it("renames a scene object from a validated plan instead of reporting a cross-document reference", () => {
    const document = planarDocument()
    const documentId = document.metadata.id
    const actions = parsedActions({
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "把点 A 改名为 B",
      factIds: [],
      actions: [{
        actionId: "object.update_inputs",
        actionKey: "rename",
        factIds: [],
        inputs: { target: { scope: "scene", ref: { documentId, entityId: "point-1" } }, patch: { label: "B" } }
      }]
    })

    const result = compileActions(document, actions, contextWith(document))

    expect(result.diagnostics).toEqual([])
    expect(result.operations).toEqual([{ op: "updatePrimitive", id: "point-1", patch: { label: "B" } }])
  })

  it("binds a scene point to a path from a validated plan", () => {
    const document = planarDocument()
    const documentId = document.metadata.id
    const actions = parsedActions({
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "把点绑到圆上",
      factIds: [],
      actions: [{
        actionId: "dynamic.bind_curve",
        actionKey: "bind",
        factIds: [],
        inputs: { target: { scope: "scene", ref: { documentId, entityId: "point-1" } }, pathId: "circle-1", parameter: 0.5 }
      }]
    })

    const result = compileActions(document, actions, contextWith(document))

    expect(result.diagnostics).toEqual([])
    expect(result.operations).toHaveLength(1)
    expect(result.operations[0]).toMatchObject({ op: "updatePrimitive", id: "point-1" })
  })

  it("still refuses a reference that points at another document", () => {
    const document = planarDocument()
    const actions = parsedActions({
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "改别的文档里的对象",
      factIds: [],
      actions: [{
        actionId: "object.update_inputs",
        actionKey: "rename",
        factIds: [],
        inputs: { target: { scope: "scene", ref: { documentId: "some-other-document", entityId: "point-1" } }, patch: { label: "B" } }
      }]
    })

    const result = compileActions(document, actions, contextWith(document))

    expect(result.operations).toEqual([])
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(["cross_document_reference"])
  })
})
