import { describe, expect, it } from "vitest"

import { previewBeatsPick } from "./threePicking"

/**
 * "指针落在预览上时，这一次点击算创建图元还是算选中几何？"
 *
 * 用户的模型是**看到什么就创建什么**（交线、交面一直在画布上，点一下就建），所以指针确实落在预览
 * 绘制出来的几何上时，预览应当赢。唯一的例外是**顶点手柄**：它是可拖的交互控件，被一块交面盖住时
 * 用户仍然是在抓手柄（实测回归：点顶点手柄变成了创建截线）。
 *
 * 棱则要看指针到底**瞄准了谁**：粗拾取的棱命中是"按像素容差"给的，指针可以离那条棱好几个像素
 * 却仍然算命中它——实测就发生在交面正中央：射线擦过一条棱，于是"点一下创建交面"完全没反应。
 * 所以棱只有**确实在指针下**（离射线极近）时才赢。
 */
const tolerance = 0.1

describe("预览与几何拾取的取舍", () => {
  it("lets the preview win over a surface, and when nothing else was hit", () => {
    expect(previewBeatsPick({ hitKind: "face", hitDistanceToRay: 0, tolerance, sectionInFront: false })).toBe(true)
    expect(previewBeatsPick({ hitKind: "solid", hitDistanceToRay: 0, tolerance, sectionInFront: false })).toBe(true)
    expect(previewBeatsPick({ hitKind: null, hitDistanceToRay: Number.POSITIVE_INFINITY, tolerance, sectionInFront: false })).toBe(true)
  })

  it("keeps vertex handles first, because they are the thing the user drags", () => {
    expect(previewBeatsPick({ hitKind: "point", hitDistanceToRay: 0, tolerance, sectionInFront: false })).toBe(false)
    // 截面预览是例外：它的边界落在实体内部，不抢就永远点不到（既有行为）。
    expect(previewBeatsPick({ hitKind: "point", hitDistanceToRay: 0, tolerance, sectionInFront: true })).toBe(true)
  })

  it("lets an edge win only when the pointer is really on it", () => {
    // 指针正压在棱上：用户要的是这条棱。
    expect(previewBeatsPick({ hitKind: "edge", hitDistanceToRay: 0, tolerance, sectionInFront: false })).toBe(false)
    expect(previewBeatsPick({ hitKind: "edge", hitDistanceToRay: tolerance * 0.1, tolerance, sectionInFront: false })).toBe(false)
    // 只是"在容差内擦过"（实测：点交面正中，射线与一条棱相距约 0.6 个容差）：预览赢。
    expect(previewBeatsPick({ hitKind: "edge", hitDistanceToRay: tolerance * 0.6, tolerance, sectionInFront: false })).toBe(true)
    expect(previewBeatsPick({ hitKind: "line", hitDistanceToRay: tolerance, tolerance, sectionInFront: false })).toBe(true)
  })
})
