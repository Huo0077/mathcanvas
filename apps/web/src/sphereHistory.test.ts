import { beforeEach, describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { useSceneStore } from "./store"

/**
 * 球的**一步撤销 / 重做**（实施计划 Task 3 的 test 清单里点名的一条）。
 *
 * 判据不是"undo 函数被调到了"，而是三件事：
 * ① 改半径 = **一步**撤销（撤销一次回到改之前，而不是退回"还没有球"）；
 * ② 撤销之后球**还在**（编辑的历史与创建的历史是两笔）；
 * ③ **被拒绝的编辑不压历史** —— 否则一次误操作会凭空多出一步"撤销"，用户按 Ctrl+Z 时
 *    会觉得"怎么按了没反应"（这是项目里已经写在别处的同一条口径）。
 */

const sphere = () => {
  const primitive = useSceneStore.getState().document.primitives.find((candidate) => candidate.id === "sphere-1")
  if (primitive?.type !== "sphere") throw new Error("expected the sphere in the document")
  return primitive
}

const sphereCount = () => useSceneStore.getState().document.primitives.filter((candidate) => candidate.type === "sphere").length

describe("sphere edits are one undo step each", () => {
  beforeEach(() => {
    localStorage.clear()
    useSceneStore.setState({ document: createEmptyDocument("geometry3d"), history: [], future: [], error: null })
  })

  function createSphere() {
    useSceneStore.getState().apply({ op: "addPrimitive", primitive: { id: "sphere-1", type: "sphere", center: { x: 1, y: 2, z: 3 }, radius: 5 } })
    expect(sphereCount()).toBe(1)
  }

  it("undoes a radius edit in one step and redoes it", () => {
    createSphere()
    useSceneStore.getState().apply({ op: "updatePrimitive", id: "sphere-1", patch: { radius3: 4 } })
    expect(sphere().radius).toBe(4)

    useSceneStore.getState().undo()

    // 一步撤销 = 回到"改之前"，不是"退回没有球"；而且球心一个字都没变。
    expect(sphere().radius).toBe(5)
    expect(sphere().center).toEqual({ x: 1, y: 2, z: 3 })
    expect(sphereCount()).toBe(1)

    useSceneStore.getState().redo()
    expect(sphere().radius).toBe(4)
  })

  it("undoes a centre move separately from the radius edit", () => {
    createSphere()
    useSceneStore.getState().apply({ op: "updatePrimitive", id: "sphere-1", patch: { radius3: 4 } })
    useSceneStore.getState().apply({ op: "updatePrimitive", id: "sphere-1", patch: { center3: { x: 3, y: 2, z: 3 } } })
    expect(sphere()).toMatchObject({ radius: 4, center: { x: 3, y: 2, z: 3 } })

    useSceneStore.getState().undo()
    expect(sphere()).toMatchObject({ radius: 4, center: { x: 1, y: 2, z: 3 } })

    useSceneStore.getState().undo()
    expect(sphere()).toMatchObject({ radius: 5, center: { x: 1, y: 2, z: 3 } })
  })

  it("keeps a rejected edit out of the history, so the next Ctrl+Z is not a no-op", () => {
    createSphere()
    const before = useSceneStore.getState().history.length

    useSceneStore.getState().apply({ op: "updatePrimitive", id: "sphere-1", patch: { radius3: 0 } })

    expect(useSceneStore.getState().error).toBeTruthy()
    expect(sphere().radius).toBe(5)
    // **没有**多出一笔历史：否则用户按 Ctrl+Z 只会"撤销掉一次什么都没发生的操作"。
    expect(useSceneStore.getState().history).toHaveLength(before)
  })
})
