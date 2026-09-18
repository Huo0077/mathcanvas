import { describe, expect, it } from "vitest"

import type { PrimitiveSpec } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

import { parsePointHostValue, pointHostOptions, pointHostValue } from "./pointHostOptions"

/**
 * 「宿主绑定」下拉要列什么、选中后绑成哪一种。
 *
 * 用户要求："动点的约束应该可以在立方体内"——所以实体除了"侧面"之外还要有"实体内"这一项；
 * 而同一个圆柱既能绑侧面、也能绑内部，光用图元 id 当 option 值就分不开了，
 * 于是值编码成 `<模式>:<id>`。这里把"列什么 / 值怎么编 / 绑成哪种"钉住。
 */
const cube = (): PrimitiveSpec[] => {
  const primitive = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 }, label: "立方体 A" }
  return [primitive, ...buildSolidTemplate(primitive).primitives]
}

const cylinder = (): PrimitiveSpec[] => {
  const primitive = { id: "cyl-a", type: "cylinder" as const, center: { x: 0, y: 0, z: -1 }, radius: 1.5, height: 2, segments: 48, label: "圆柱 A" }
  return [primitive, ...buildSolidTemplate(primitive).primitives]
}

describe("point host options", () => {
  it("offers a cube as a volume host", () => {
    const options = pointHostOptions(cube())
    const volume = options.filter((option) => option.mode === "solid")
    expect(volume).toHaveLength(1)
    expect(volume[0].primitiveId).toBe("cube-a")
    expect(volume[0].value).toBe("solid:cube-a")
    expect(volume[0].label).toContain("实体内")
  })

  it("offers a cylinder both its lateral surface and its interior", () => {
    const options = pointHostOptions(cylinder())
    const modes = options.map((option) => option.mode)
    expect(modes).toContain("surface")
    expect(modes).toContain("solid")
    // 同一个图元两个条目：值必须不同，否则选中一个等于同时选中两个。
    const values = options.map((option) => option.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it("lists lines, edges and faces, but not the generated shadow polyhedron", () => {
    const withExtras: PrimitiveSpec[] = [...cube(), {
      id: "line-3d",
      type: "line3",
      definition: { kind: "pointDirection", pointId: "cube-a-point-1", direction: { x: 0, y: 0, z: 1 } }
    }]
    const options = pointHostOptions(withExtras)
    expect(options.some((option) => option.primitiveId === "line-3d" && option.mode === "host")).toBe(true)
    // 模板生成的**棱**照旧可以当一维宿主（"把点绑到这条棱上"是既有能力）。
    expect(options.some((option) => option.primitiveId === "cube-a-edge-15" && option.mode === "host")).toBe(true)
    // 但那个"影子"多面体不再单独列成体积宿主：实体内那一条已经代表这个立方体了。
    const volumePrimitives = options.filter((option) => option.mode === "solid").map((option) => option.primitiveId)
    expect(volumePrimitives).toEqual(["cube-a"])
  })

  it("maps a binding back to its option value and parses it again", () => {
    expect(pointHostValue({ kind: "onHost", hostId: "edge-1", parameter: 0.5 })).toBe("host:edge-1")
    expect(pointHostValue({ kind: "onFace", faceId: "face-1", uv: [0, 0] })).toBe("face:face-1")
    expect(pointHostValue({ kind: "onSurface", solidId: "cyl-a", uv: [0, 0] })).toBe("surface:cyl-a")
    expect(pointHostValue({ kind: "inSolid", solidId: "cube-a", uvw: [0.5, 0.5, 0.5] })).toBe("solid:cube-a")
    expect(pointHostValue({ kind: "free" })).toBe("")
    expect(pointHostValue(undefined)).toBe("")

    expect(parsePointHostValue("solid:cube-a")).toEqual({ mode: "solid", primitiveId: "cube-a" })
    expect(parsePointHostValue("host:edge-1")).toEqual({ mode: "host", primitiveId: "edge-1" })
    expect(parsePointHostValue("host:orbit-1")).toEqual({ mode: "host", primitiveId: "orbit-1" })
    expect(parsePointHostValue("")).toBeNull()
    expect(parsePointHostValue("nonsense")).toBeNull()
  })

  /**
   * 空间圆轨道（`circle3`）与空间面（`face3`）都要出现在"宿主绑定"下拉里——它们就是**约束轨道**：
   * 把动点绑上去，拖它就只能沿轨道滑动。名字要写清楚是"圆轨道"，不然用户认不出这是自己建的那个圈。
   */
  it("offers circle tracks and polygons as constraint tracks", () => {
    const withTracks: PrimitiveSpec[] = [
      { id: "p-c", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "orbit-1", type: "circle3", center: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, radius: 2, label: "圆轨道 1" },
      { id: "face-1", type: "face3", pointIds: ["p-c", "p-b", "p-d"], label: "空间面 1" }
    ]
    const options = pointHostOptions(withTracks)
    const orbit = options.find((option) => option.primitiveId === "orbit-1")!
    expect(orbit.mode).toBe("host")
    expect(orbit.value).toBe("host:orbit-1")
    expect(orbit.label).toContain("圆轨道")
    const polygon = options.find((option) => option.primitiveId === "face-1")!
    expect(polygon.mode).toBe("face")
    expect(polygon.value).toBe("face:face-1")
  })
})
