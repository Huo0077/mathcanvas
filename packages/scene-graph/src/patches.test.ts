import { createEmptyDocument, decodeMgeo, encodeMgeo, validateDocument, type GeometryDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { applyOperation, isDomainOperation } from "./operations"
import { commitPatch, validatePatch } from "./patches"
import { compileSolidPrism } from "./actions"

/**
 * Task 0.3：堵住 **unknown-operation** 与 **false-change** 两个洞。
 *
 * 前者是真实安全缺口：`validatePatch` 逐条 `if (operation.op === "...")` 检查，
 * 一个**没被任何分支覆盖**的 op 会绕过全部校验、直接返回 valid —— 模型或旧版本客户端
 * 塞一个 `{op:"explodeEverything"}` 进来就能进到执行路径。
 * 后者是账本问题：没有语义变化的操作不该把 revision 推高（否则撤销栈里全是空步）。
 */
describe("domain operation runtime guard", () => {
  it("rejects an unknown operation even when TypeScript was bypassed", () => {
    const document = createEmptyDocument("conics")
    const smuggled = { op: "explodeEverything", id: "point-1" } as unknown as Parameters<typeof validatePatch>[1]

    const validation = validatePatch(document, smuggled)

    expect(validation.valid).toBe(false)
    // `PatchValidationResult` 是判别联合：先收窄再读 errors（tsc 会拦住直接访问）。
    if (!validation.valid) {
      expect(validation.errors.join(", ")).toContain("unknown operation")
    } else {
      throw new Error("expected the unknown operation to be rejected")
    }
  })

  it("exposes one guard that both validation and adapters share", () => {
    expect(isDomainOperation({ op: "addPrimitive", primitive: { id: "p1", type: "point", x: 0, y: 0 } })).toBe(true)
    expect(isDomainOperation({ op: "deleteObject", id: "p1" })).toBe(true)
    expect(isDomainOperation({ op: "explodeEverything" })).toBe(false)
    expect(isDomainOperation(null)).toBe(false)
    expect(isDomainOperation("addPrimitive")).toBe(false)
    expect(isDomainOperation({})).toBe(false)
  })
})

describe("no-op input must not advance the revision", () => {
  it("reports unchanged for a visibility update that changes nothing", () => {
    const document = createEmptyDocument("conics")
    const added = commitPatch(document, { op: "addPrimitive", primitive: { id: "point-1", type: "point", x: 0, y: 0, visible: false } })
    expect(added.changed).toBe(true)
    const revisionAfterAdd = added.document.revision

    // 已经是 false，再设一次 false：语义没有变化。
    const unchanged = commitPatch(added.document, { op: "toggleVisibility", id: "point-1", visible: false })

    expect(unchanged.changed).toBe(false)
    expect(unchanged.document.revision).toBe(revisionAfterAdd)
  })

  it("still reports a real visibility flip as changed", () => {
    const document = createEmptyDocument("conics")
    const added = commitPatch(document, { op: "addPrimitive", primitive: { id: "point-1", type: "point", x: 0, y: 0, visible: false } })
    const flipped = commitPatch(added.document, { op: "toggleVisibility", id: "point-1", visible: true })

    expect(flipped.changed).toBe(true)
    expect(flipped.document.revision).toBeGreaterThan(added.document.revision)
  })

  it("keeps applyOperation honest about semantic change", () => {
    const document = createEmptyDocument("conics")
    const added = applyOperation(document, { op: "addPrimitive", primitive: { id: "point-1", type: "point", x: 0, y: 0 } })
    const revisionAfterAdd = added.document.revision
    const noop = applyOperation(added.document, { op: "toggleVisibility", id: "point-1", visible: true })

    // 本来就是可见的：再"设为可见"不该被算成一次改动。
    expect(noop.changed).toBe(false)
    expect(noop.document.revision).toBe(revisionAfterAdd)
  })
})

/**
 * **旧文档必须继续能打开**（Solid/Prism 切片 Task 3 的第三条约束）。
 *
 * 新增 `prism` 构造不能把 `template` / `fromPoints` / `fromFaces` 这三种既有形状变成"非法"：
 * 用户的 `.mgeo` 文件里全是它们。这条用例同时钉住两件事：
 * 1. 三种旧构造的文档仍然通过校验、能编解码往返；
 * 2. 新建的棱柱**不写出 `undefined` 值的外观键** —— `JSON.stringify` 会丢键，
 *    内存里留着 `label: undefined` 就等于"内存文档"与"磁盘文档"不是同一份数据
 *    （规范化哈希曾因此整轮失败：`unsupported value of type undefined`）。
 */
describe("solid construction compatibility", () => {
  const legacyDocument = (construction: unknown): GeometryDocument => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "point-b", type: "point3", position: { x: 1, y: 0, z: 0 } },
      { id: "point-c", type: "point3", position: { x: 0, y: 1, z: 0 } },
      { id: "point-d", type: "point3", position: { x: 0, y: 0, z: 1 } },
      { id: "edge-ab", type: "edge3", pointIds: ["point-a", "point-b"] },
      { id: "edge-ac", type: "edge3", pointIds: ["point-a", "point-c"] },
      { id: "edge-ad", type: "edge3", pointIds: ["point-a", "point-d"] },
      { id: "edge-bc", type: "edge3", pointIds: ["point-b", "point-c"] },
      { id: "edge-bd", type: "edge3", pointIds: ["point-b", "point-d"] },
      { id: "edge-cd", type: "edge3", pointIds: ["point-c", "point-d"] },
      { id: "face-abc", type: "face3", pointIds: ["point-a", "point-b", "point-c"], edgeIds: ["edge-ab", "edge-bc", "edge-ac"] },
      { id: "face-abd", type: "face3", pointIds: ["point-a", "point-b", "point-d"], edgeIds: ["edge-ab", "edge-bd", "edge-ad"] },
      { id: "face-acd", type: "face3", pointIds: ["point-a", "point-c", "point-d"], edgeIds: ["edge-ac", "edge-cd", "edge-ad"] },
      { id: "face-bcd", type: "face3", pointIds: ["point-b", "point-c", "point-d"], edgeIds: ["edge-bc", "edge-cd", "edge-bd"] },
      {
        id: "solid-1",
        type: "polyhedron3",
        vertexIds: ["point-a", "point-b", "point-c", "point-d"],
        edgeIds: ["edge-ab", "edge-ac", "edge-ad", "edge-bc", "edge-bd", "edge-cd"],
        faceIds: ["face-abc", "face-abd", "face-acd", "face-bcd"],
        construction: construction as never
      }
    ]
    return document
  }

  it("keeps template, from-points and from-faces constructions readable and round-trippable", () => {
    const constructions = [
      { kind: "fromPoints", sourceIds: ["point-a", "point-b", "point-c", "point-d"] },
      { kind: "fromFaces", sourceIds: ["face-abc", "face-abd", "face-acd", "face-bcd"], sourceId: "solid-1" }
    ]

    for (const construction of constructions) {
      const document = legacyDocument(construction)
      expect(validateDocument(document)).toEqual({ valid: true })
      expect(decodeMgeo(encodeMgeo(document)).primitives).toEqual(document.primitives)
    }

    // `template` 的 `sourceIds` 必须指向真实存在的图元，所以直接引用那四个点。
    const templateDocument = legacyDocument({ kind: "template", templateId: "cube", sourceIds: ["point-a", "point-b", "point-c", "point-d"] })
    expect(validateDocument(templateDocument)).toEqual({ valid: true })
    expect(decodeMgeo(encodeMgeo(templateDocument)).primitives).toEqual(templateDocument.primitives)
  })

  it("writes no undefined presentation keys when a prism solid is created", () => {
    const result = compileSolidPrism("solid-1", [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }], { x: 0, y: 0, z: 2 })
    expect(result.diagnostics).toEqual([])

    /**
     * 先查**内存里**的对象：`JSON.stringify` 会丢 `undefined` 值的键，所以"往返之后相等"证明不了
     * 内存里没有这种键 —— 而规范化哈希正是拿内存对象算的（它就是因此抛的
     * `unsupported value of type undefined`）。
     */
    for (const primitive of result.primitives) {
      for (const [key, value] of Object.entries(primitive)) {
        expect(value === undefined, `${primitive.id}.${key} must not be present with an undefined value`).toBe(false)
      }
    }

    // 再确认它确实是一份能存回去的文档（`encodeMgeo` 内部会整份校验）。
    const document = createEmptyDocument("geometry3d")
    document.primitives = result.primitives
    expect(decodeMgeo(encodeMgeo(document)).primitives).toEqual(result.primitives)
  })
})