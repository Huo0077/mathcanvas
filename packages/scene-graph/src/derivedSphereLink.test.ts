import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { createFace3, createPoint3, createPolyhedron3 } from "./index"
import { derivedSphereLink, staleDerivedSpheres } from "./derivedSphereLink"
import { recomputeDerivedObjects } from "./recompute"
import { solidStatusReport } from "./operations"

/**
 * **派生球还是不是它宿主的球**（S5 核验；设计 §4.1）。
 *
 * 判据是**直接几何**（设计原话："外接球核验**到各顶点等距**、内切球核验**到各面相切**"），
 * **不拿求解器的结果去比它自己算出来的球** —— 那等于没复核。三个状态各自的证据：
 * - `holds`：正常路径下**不该有任何读数**（没问题就不该多一行噪声）；
 * - `violated`：球被改过 ⇒ 直接几何当场说不成立，并**把两边的数都写出来**；
 * - `outdated`：宿主现在没有这种球了（顶点被拉走）⇒ 画面上那只是**上一次能解出来的**。
 */

function cubeDocument(): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  const corners: [string, number, number, number][] = [
    ["a", 0, 0, 0], ["b", 2, 0, 0], ["c", 2, 2, 0], ["d", 0, 2, 0],
    ["e", 0, 0, 2], ["f", 2, 0, 2], ["g", 2, 2, 2], ["h", 0, 2, 2]
  ]
  const points = corners.map(([name, x, y, z]) => createPoint3(`p-${name}`, { x, y, z }))
  const rings: string[][] = [
    ["a", "b", "c", "d"], ["e", "f", "g", "h"],
    ["a", "b", "f", "e"], ["b", "c", "g", "f"], ["c", "d", "h", "g"], ["d", "a", "e", "h"]
  ]
  const faces = rings.map((ring, index) => createFace3(`f-${index}`, ring.map((name) => `p-${name}`)))
  document.primitives = [
    ...points,
    ...faces,
    createPolyhedron3("solid-1", points.map((point) => point.id), [], faces.map((face) => face.id)),
    { id: "sphere-out", type: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 1, label: "外接球", derivedFrom: { kind: "circumsphere", solidId: "solid-1" } },
    { id: "sphere-in", type: "sphere", center: { x: 0, y: 0, z: 0 }, radius: 1, label: "内切球", derivedFrom: { kind: "insphere", solidId: "solid-1" } }
  ]
  return document
}

/** 把某只球的几何改掉（模拟"手改了球"或"重算没跑到"）。 */
function tampered(document: GeometryDocument, id: string, patch: { radius?: number; center?: { x: number; y: number; z: number } }): GeometryDocument {
  return { ...document, primitives: document.primitives.map((primitive) => primitive.id === id ? { ...primitive, ...patch } : primitive) }
}

const primitiveMapOf = (document: GeometryDocument) => new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
const sphereOf = (document: GeometryDocument, id: string) =>
  document.primitives.find((primitive) => primitive.id === id) as Extract<GeometryDocument["primitives"][number], { type: "sphere" }>

describe("derivedSphereLink", () => {
  it("says 'holds' for the host's own spheres, and stays silent in the readings", () => {
    const settled = recomputeDerivedObjects(cubeDocument())
    // 立方体（棱长 2）：外接球 `(1,1,1)`/`√3`、内切球 `(1,1,1)`/`1` —— 两只都成立。
    expect(derivedSphereLink(sphereOf(settled, "sphere-out"), primitiveMapOf(settled))).toEqual({ status: "holds" })
    expect(derivedSphereLink(sphereOf(settled, "sphere-in"), primitiveMapOf(settled))).toEqual({ status: "holds" })
    expect(staleDerivedSpheres(settled)).toEqual([])
    expect(solidStatusReport(settled).some((entry) => entry.code === "derived.sphere_stale")).toBe(false)
  })

  it("violates a sphere whose radius no longer matches the distance to the vertices", () => {
    const settled = recomputeDerivedObjects(cubeDocument())
    const broken = tampered(settled, "sphere-out", { radius: 5 })
    const stale = staleDerivedSpheres(broken)
    expect(stale).toHaveLength(1)
    expect(stale[0]!.sphereId).toBe("sphere-out")
    expect(stale[0]!.hostId).toBe("solid-1")
    expect(stale[0]!.link.status).toBe("violated")
    if (stale[0]!.link.status === "violated") {
      // 理由要**同时**说出两边（到顶点的距离、以及这只球的半径），否则用户没法判断该信谁。
      expect(stale[0]!.link.reason).toContain("1.73205")
      expect(stale[0]!.link.reason).toContain("5.00000")
    }

    const reading = solidStatusReport(broken).find((entry) => entry.code === "derived.sphere_stale")
    /**
     * **状态词是 `stale`，不是 `undefined`**（2026-10-10 裁决，S5 的那条待办）。
     *
     * 这只球**就在文档里**（`sourceId: "sphere-out"`），不成立的是"它是宿主的球"这条主张。
     * 借 `undefined` 的后果是**用户看得见的一句假话**：徽章把 `undefined` 说成"不存在"，
     * 而画面上那只球明明还在。四个求解器状态（`exact` / `approximate` / `undefined` / `degenerate`）
     * 说的是"解怎么了"，而这一条说的是"**解还在，但已经不是这只实体的解了**" —— 它是
     * **报告**自己的第五个词，不是任何求解器的返回值。
     */
    expect(reading).toMatchObject({ solidId: "solid-1", sourceId: "sphere-out", status: "stale" })
  })

  it("violates a sphere whose centre was shifted, naming the unequal distances", () => {
    const settled = recomputeDerivedObjects(cubeDocument())
    const broken = tampered(settled, "sphere-out", { center: { x: 1.5, y: 1, z: 1 } })
    const stale = staleDerivedSpheres(broken)
    expect(stale).toHaveLength(1)
    expect(stale[0]!.link.status).toBe("violated")
    if (stale[0]!.link.status === "violated") expect(stale[0]!.link.reason).toContain("距离不一致")
  })

  it("explains an outdated sphere as the last one that could be solved, rather than blaming the sphere", () => {
    const settled = recomputeDerivedObjects(cubeDocument())
    // 把一个顶点拉出去 ⇒ 这只实体**不再有外接球**；重算按口径保留上一次的几何。
    const pulled = recomputeDerivedObjects({
      ...settled,
      primitives: settled.primitives.map((primitive) => primitive.id === "p-g" ? { ...primitive, position: { x: 9, y: 9, z: 9 } } : primitive)
    })
    const stale = staleDerivedSpheres(pulled).find((entry) => entry.sphereId === "sphere-out")
    expect(stale).toBeDefined()
    expect(stale!.link.status).toBe("outdated")
    if (stale!.link.status === "outdated") expect(stale!.link.reason).toContain("上一次")
    // 而且同一次报告里"宿主有没有外接球"那条读数也要在（两句话合起来才说得清画布上的球是什么）。
    expect(solidStatusReport(pulled).some((entry) => entry.code === "derived.circumsphere" && entry.status === "undefined")).toBe(true)
  })
})
