import { describe, expect, it } from "vitest"

import { createEmptyDocument, type ConstraintSpec, type GeometryDocument, type PrimitiveSpec } from "@draw/dsl"

import { planConstrainedDrag3 } from "./constrainedDrag3"

/**
 * **拖动一个空间点时保持约束**（N3 的接线层）。
 *
 * 这里钉的是**四种出口的判据**，不是数字本身：`passthrough`（这一批不管）/ `noop`（约束把拖动
 * 完全抵消了）/ `refused`（拖到这里满足不了）/ `commit`（一次事务写下去）。
 *
 * 场景：`plane-abc` 是 z = 0 平面，`p = (2,3,0)` **就在这个平面上**。
 */
function scene(extra: PrimitiveSpec[] = []): PrimitiveSpec[] {
  return [
    { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } },
    { id: "b", type: "point3", position: { x: 1, y: 0, z: 0 } },
    { id: "c", type: "point3", position: { x: 0, y: 1, z: 0 } },
    { id: "p", type: "point3", position: { x: 2, y: 3, z: 0 } },
    { id: "plane-abc", type: "plane3", definition: { kind: "throughPoints", pointIds: ["a", "b", "c"] } },
    ...extra
  ]
}

function documentWith(primitives: PrimitiveSpec[], constraints: ConstraintSpec[] = []): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  document.primitives = primitives
  document.constraints = constraints
  return document
}

const ON_PLANE: ConstraintSpec[] = [{ id: "on-plane", type: "pointOnPlane", targets: ["p", "plane-abc"] }]

describe("约束拖动：四种出口", () => {
  it("开关关着只回答 passthrough —— 这是「旧路径逐字回归」的实现方式", () => {
    const outcome = planConstrainedDrag3({
      document: documentWith(scene(), ON_PLANE),
      draggedId: "p",
      delta: { x: 1, y: 0, z: 0 },
      enabled: false
    })

    expect(outcome.kind).toBe("passthrough")
    if (outcome.kind === "passthrough") expect(outcome.reason).toContain("关闭")
  })

  it("没有空间约束：没东西要保，交给旧路径", () => {
    const outcome = planConstrainedDrag3({ document: documentWith(scene()), draggedId: "p", delta: { x: 1, y: 0, z: 0 }, enabled: true })

    expect(outcome.kind).toBe("passthrough")
  })

  it("被拖对象不是空间点（例如平面）也交给旧路径", () => {
    const outcome = planConstrainedDrag3({
      document: documentWith(scene(), ON_PLANE),
      draggedId: "plane-abc",
      delta: { x: 1, y: 0, z: 0 },
      enabled: true
    })

    expect(outcome.kind).toBe("passthrough")
  })

  it("绑定点交给旧路径：它的坐标由宿主参数算出，投影改它只会让文档自相矛盾", () => {
    const withLine: PrimitiveSpec[] = [...scene(), { id: "line-ab", type: "line3", definition: { kind: "throughPoints", pointIds: ["a", "b"] } }]
    const bound: PrimitiveSpec[] = withLine.map((primitive) => primitive.id === "p" && primitive.type === "point3"
      ? { ...primitive, binding: { kind: "onLine" as const, lineId: "line-ab", parameter: 0.5 } }
      : primitive)
    const outcome = planConstrainedDrag3({
      document: documentWith(bound, ON_PLANE),
      draggedId: "p",
      delta: { x: 1, y: 0, z: 0 },
      enabled: true
    })

    expect(outcome.kind).toBe("passthrough")
    if (outcome.kind === "passthrough") expect(outcome.reason).toContain("绑定点")
  })

  it("锁定对象交给旧路径（旧路径会如实拒绝它，不在这里另判一遍）", () => {
    const locked: PrimitiveSpec[] = scene().map((primitive) => primitive.id === "p" ? { ...primitive, locked: true } : primitive)
    const outcome = planConstrainedDrag3({
      document: documentWith(locked, ON_PLANE),
      draggedId: "p",
      delta: { x: 1, y: 0, z: 0 },
      enabled: true
    })

    expect(outcome.kind).toBe("passthrough")
  })
})

describe("约束拖动：提交的那一支", () => {
  it("斜着把平面上的点拖出去：它**贴回平面上**，其余不变，一次事务里只有一个操作", () => {
    const outcome = planConstrainedDrag3({
      document: documentWith(scene(), ON_PLANE),
      draggedId: "p",
      delta: { x: 1, y: 2, z: 5 },
      enabled: true
    })

    expect(outcome.kind).toBe("commit")
    if (outcome.kind !== "commit") return
    // 暖启动把 p 放到 (3,5,5)，投影把它拉回平面 ⇒ (3,5,0)：**不在指针正下方，但满足约束**。
    expect(outcome.operations).toEqual([{ op: "updatePrimitive", id: "p", patch: { position3: { x: 3, y: 5, z: 0 } } }])
    expect(outcome.note).toContain("已按约束调整 1 个点")
  })

  it("沿平面法向拖：约束把这次拖动**完全抵消**，如实报 noop 而不是提交空事务", () => {
    const outcome = planConstrainedDrag3({
      document: documentWith(scene(), ON_PLANE),
      draggedId: "p",
      delta: { x: 0, y: 0, z: 5 },
      enabled: true
    })

    expect(outcome.kind).toBe("noop")
  })

  it("冗余约束不阻止提交，但要在提示里说出来", () => {
    const pair: PrimitiveSpec[] = [
      { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "q", type: "point3", position: { x: 3, y: 0, z: 0 } }
    ]
    const constraints: ConstraintSpec[] = [
      { id: "len-1", type: "fixedDistance", targets: ["a", "q"], value: 2 },
      { id: "len-2", type: "fixedDistance", targets: ["a", "q"], value: 2 }
    ]
    const outcome = planConstrainedDrag3({ document: documentWith(pair, constraints), draggedId: "q", delta: { x: 1, y: 0, z: 0 }, enabled: true })

    expect(outcome.kind).toBe("commit")
    if (outcome.kind !== "commit") return
    expect(outcome.note).toContain("冗余")
    expect(outcome.operations).toEqual([{ op: "updatePrimitive", id: "q", patch: { position3: { x: 2, y: 0, z: 0 } } }])
  })
})

describe("约束拖动：拒绝的那一支", () => {
  it("矛盾的两条定长约束：拒绝，并说清「没能同时满足」—— 不说「无解」", () => {
    const pair: PrimitiveSpec[] = [
      { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "q", type: "point3", position: { x: 3, y: 0, z: 0 } }
    ]
    const constraints: ConstraintSpec[] = [
      { id: "len-2", type: "fixedDistance", targets: ["a", "q"], value: 2 },
      { id: "len-3", type: "fixedDistance", targets: ["a", "q"], value: 3 }
    ]
    const outcome = planConstrainedDrag3({ document: documentWith(pair, constraints), draggedId: "q", delta: { x: 1, y: 0, z: 0 }, enabled: true })

    expect(outcome.kind).toBe("refused")
    if (outcome.kind !== "refused") return
    expect(outcome.reason).toContain("没能同时满足")
    expect(outcome.reason).toContain("不等于")
  })

  it("平面的定义点被锁定不影响：p 自己能动，就把它拉回平面（锚点只管不许动的点）", () => {
    const locked: PrimitiveSpec[] = scene().map((primitive) => primitive.id === "a" || primitive.id === "b" || primitive.id === "c"
      ? { ...primitive, locked: true }
      : primitive)
    // plane-abc 的三个定义点都被锁定 ⇒ 投影改不了平面，而 p 要落在这个平面上。
    const outcome = planConstrainedDrag3({
      document: documentWith(locked, ON_PLANE),
      draggedId: "p",
      delta: { x: 1, y: 0, z: 5 },
      enabled: true
    })

    // p 自己能动，所以投影能把它拉回平面 —— 这条**不该**被拒。
    expect(outcome.kind).toBe("commit")
  })
})

describe("约束拖动：绝不改写入参", () => {
  it("求解过程不会就地改写调用方的文档", () => {
    const document = documentWith(scene(), ON_PLANE)
    const snapshot = JSON.stringify(document)
    planConstrainedDrag3({ document, draggedId: "p", delta: { x: 1, y: 2, z: 5 }, enabled: true })

    expect(JSON.stringify(document)).toBe(snapshot)
  })
})
