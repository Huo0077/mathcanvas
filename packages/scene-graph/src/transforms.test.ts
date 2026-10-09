import { describe, expect, it } from "vitest"

import type { Point3Primitive, PrimitiveSpec } from "@draw/dsl"

import { isFreeDraggable3 } from "./transforms"

/**
 * **谁能被"自由拖动"**（S5 拖动那一半挖出来的洞）。
 *
 * 这个判断此前**全仓没有一条用例**，而它是拖动路径的第一道门；本批补上，因为派生球那一处
 * 正好反过来：**派生球的几何是宿主算出来的**（`derivedFrom`），拖它必然被下一次重算覆盖掉。
 * 把它当"可自由拖动"的后果很具体 —— 见 `apps/web/src/threeSceneInteraction.ts` 的拖动分支：
 * 用户按下时命中的是**包住宿主的那只球**，而它其实拖不动，于是"拖宿主"这条操作路径看起来
 * 像"这一版不支持"（仓库里为此记了三次失败尝试）。
 */

const point = (id: string, binding?: Point3Primitive["binding"]): Point3Primitive =>
  ({ id, type: "point3", position: { x: 0, y: 0, z: 0 }, ...(binding === undefined ? {} : { binding }) }) as Point3Primitive

const sphere = (derived: boolean): PrimitiveSpec =>
  ({
    id: "sphere-1",
    type: "sphere",
    center: { x: 0, y: 0, z: 0 },
    radius: 2,
    ...(derived ? { derivedFrom: { kind: "circumsphere", solidId: "solid-1" } } : {})
  }) as unknown as PrimitiveSpec

describe("isFreeDraggable3", () => {
  it("**派生球不可自由拖动**：它的球心与半径由宿主算出来，拖它只会被重算覆盖", () => {
    expect(isFreeDraggable3(sphere(true), new Map())).toBe(false)
  })

  it("自己带几何的球仍可拖动（球心 + 半径是它自己的）—— 别把这条判据扩大化", () => {
    expect(isFreeDraggable3(sphere(false), new Map())).toBe(true)
  })

  it("顶点全自由的棱柱可拖动（这是宿主能被抓住的前提）", () => {
    const points = new Map<string, Point3Primitive>([point("p1", { kind: "free" }), point("p2", { kind: "free" })].map((entry) => [entry.id, entry]))
    const solid = { id: "solid-1", type: "polyhedron3", vertexIds: ["p1", "p2"], edgeIds: [], faceIds: [] } as unknown as PrimitiveSpec
    expect(isFreeDraggable3(solid, points)).toBe(true)
  })

  it("顶点被绑定的棱柱不可拖动（拖它会把实体扯散）", () => {
    const points = new Map<string, Point3Primitive>([point("p1", { kind: "free" }), point("p2", { kind: "onHost", hostId: "solid-9" } as never)].map((entry) => [entry.id, entry]))
    const solid = { id: "solid-1", type: "polyhedron3", vertexIds: ["p1", "p2"], edgeIds: [], faceIds: [] } as unknown as PrimitiveSpec
    expect(isFreeDraggable3(solid, points)).toBe(false)
  })
})
