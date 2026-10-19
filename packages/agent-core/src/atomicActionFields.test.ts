import { describe, expect, it } from "vitest"

import { ACTIONS, declaredFieldKind } from "./actionRegistry"

/**
 * **字段复用**（2026-10-19，P2-3）：六个空间原子动作共用 `source` / `planePoints` / `label`，
 * 平移与旋转各自复用 `vector` / `angle`；字段种类不按动作另抄一份。
 */
describe("atomic action field reuse", () => {
  it("shares source and planePoints across reflection, projection and intersection", () => {
    for (const actionId of ["solid.create_reflection", "solid.create_projection"] as const) {
      const spec = ACTIONS[actionId]
      expect(declaredFieldKind(spec, "source")).toBe("string")
      expect(declaredFieldKind(spec, "planePoints")).toBe("stringList")
      expect(declaredFieldKind(spec, "label")).toBe("string")
    }
    const intersection = ACTIONS["solid.create_intersection"]
    expect(declaredFieldKind(intersection, "lineFrom")).toBe("string")
    expect(declaredFieldKind(intersection, "lineTo")).toBe("string")
    expect(declaredFieldKind(intersection, "planePoints")).toBe("stringList")
  })

  it("reuses vector and angle for translation and rotation", () => {
    expect(declaredFieldKind(ACTIONS["solid.create_translation"], "vector")).toBe("vector")
    expect(declaredFieldKind(ACTIONS["solid.create_rotation"], "angle")).toBe("number")
    expect(declaredFieldKind(ACTIONS["solid.create_rotation"], "axisFrom")).toBe("string")
    expect(declaredFieldKind(ACTIONS["solid.create_rotation"], "axisTo")).toBe("string")
  })
})
