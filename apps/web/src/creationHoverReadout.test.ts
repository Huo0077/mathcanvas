import { describe, expect, it } from "vitest"

import { creationHoverReadout, workPlaneLabel } from "./creationHoverReadout"

/**
 * 悬停读数：**说清"点下去会引用谁 / 落在哪"**，且不编造信息。
 * 判据取整串字符串（读数就是一个字符串，逐字比对才守得住格式与小数位）。
 */
describe("the creation hover readout", () => {
  it("names what was snapped to together with its world coordinates", () => {
    expect(creationHoverReadout({ position: { x: 1, y: 2.006, z: -0.5 }, source: "point", pointId: "p1" }, "xy")).toBe("已有点 (1.00, 2.01, -0.50)")
    expect(creationHoverReadout({ position: { x: 0, y: 0, z: 0 }, source: "edge" }, "xy")).toBe("棱 / 线 (0.00, 0.00, 0.00)")
    expect(creationHoverReadout({ position: { x: 3, y: 4, z: 5 }, source: "face" }, "xz")).toBe("面 (3.00, 4.00, 5.00)")
  })

  it("says which work plane an empty click landed on, including a selected face", () => {
    expect(creationHoverReadout({ position: { x: 1, y: 0, z: 2 }, source: "work-plane" }, "xz")).toBe("工作平面 XZ (1.00, 0.00, 2.00)")
    // 吸附到对象时**不提**工作平面：位置由那个对象决定，说了会让人以为它参与了定位
    expect(creationHoverReadout({ position: { x: 1, y: 2, z: 3 }, source: "point", pointId: "p1" }, "yz")).toBe("已有点 (1.00, 2.00, 3.00)")
  })

  it("labels the four work planes, and treats a plane object as '已选面'", () => {
    expect(workPlaneLabel("xy")).toBe("XY")
    expect(workPlaneLabel("xz")).toBe("XZ")
    expect(workPlaneLabel("yz")).toBe("YZ")
    expect(workPlaneLabel({ normal: { x: 0, y: 0, z: 1 }, constant: -3 })).toBe("已选面")
    expect(creationHoverReadout({ position: { x: 0, y: 0, z: 3 }, source: "work-plane" }, { normal: { x: 0, y: 0, z: 1 }, constant: -3 })).toBe("工作平面 已选面 (0.00, 0.00, 3.00)")
  })

  it("reports the refusal reason instead of inventing a position", () => {
    expect(creationHoverReadout({ reason: "当前视角无法确定工作平面的落点，请旋转视角或切换工作平面" }, "xy")).toBe("当前视角无法确定工作平面的落点，请旋转视角或切换工作平面")
    expect(creationHoverReadout({ reason: "请在画布内选择位置" }, "xy")).toBe("请在画布内选择位置")
  })
})
