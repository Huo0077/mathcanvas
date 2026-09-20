import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { countDraftObjects } from "./draftCounts"

/**
 * Task 2.5 Step 4 要求确认面板给出"**exact changed IDs/counts**、assumptions、source/target、
 * approximation、deletion/lock warnings、one-undo statement"。
 *
 * 这些数字必须来自**真实候选文档**（宿主侧的 `DraftStore`），而不是界面自己估的：
 * 界面估出来的数字与真正要落盘的东西一旦不一致，用户就是在确认一件他没看见的事。
 * 这个文件确认 `countDraftObjects` 能被用来产出那份数字（它本来就在草稿预览里用）。
 */
describe("counts for the confirmation panel", () => {
  it("reports how many objects the candidate would add", () => {
    const base = createEmptyDocument("geometry3d")
    const candidate = {
      ...base,
      primitives: [{ id: "cube-1", type: "cube" as const, origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 }, label: "立方体 1" }]
    }

    const before = countDraftObjects(base)
    const after = countDraftObjects(candidate)

    // 面片要给出的是"对比基础文档多了什么"，所以两个数都要有。
    expect(after.total - before.total).toBe(1)
    expect(after.user).toBe(1)
  })

  it("counts derived and internal objects separately so the panel can warn about them", () => {
    const candidate = {
      ...createEmptyDocument("geometry3d"),
      primitives: [
        { id: "point3-1", type: "point3" as const, position: { x: 0, y: 0, z: 0 }, label: "A" },
        { id: "point3-tess", type: "point3" as const, position: { x: 1, y: 0, z: 0 }, tessellation: true }
      ]
    }

    const counts = countDraftObjects(candidate)

    // "用户能编辑的只有一个"与"文档里有两个对象"是两件不同的事，面板要都说出来。
    expect(counts.user).toBe(1)
    expect(counts.internal).toBe(1)
    expect(counts.total).toBe(2)
  })
})
