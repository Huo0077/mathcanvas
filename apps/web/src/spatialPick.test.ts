import * as THREE from "three"
import { describe, expect, it } from "vitest"

import type { Vector3 } from "@draw/dsl"

import { resolveSpatialAnchor, type SpatialPickResult, type WorkPlane } from "./spatialPick"
import type { RaycastHit3 } from "./threePicking"

const ray = new THREE.Ray(new THREE.Vector3(2, 3, 10), new THREE.Vector3(0, 0, -1))

function hit(kind: RaycastHit3["kind"], position = { x: 4, y: 5, z: 6 }): RaycastHit3 {
  return { kind, primitiveId: "point-1", depth: 4, worldPoint: position }
}

/** 取落点；拿到 `reason` 时**报错**而不是静默返回 undefined —— 否则断言会变成空断言。 */
function positionOf(result: SpatialPickResult): Vector3 {
  if (!("position" in result)) throw new Error(`期望一个落点，实际是拒绝：${result.reason}`)
  return result.position
}

describe("3D spatial placement", () => {
  it("uses the precise position of an existing point rather than the work plane", () => {
    expect(resolveSpatialAnchor(hit("point"), ray, "xy")).toEqual({ position: { x: 4, y: 5, z: 6 }, pointId: "point-1", source: "point" })
  })

  it("places an empty click on the visible XY plane z=0", () => {
    expect(resolveSpatialAnchor(null, ray, "xy")).toEqual({ position: { x: 2, y: 3, z: 0 }, source: "work-plane" })
  })

  it("supports XZ and YZ planes without guessing depth", () => {
    const towardY = new THREE.Ray(new THREE.Vector3(2, 10, 4), new THREE.Vector3(0, -1, 0))
    expect(resolveSpatialAnchor(null, towardY, "xz")).toEqual({ position: { x: 2, y: 0, z: 4 }, source: "work-plane" })
    const towardX = new THREE.Ray(new THREE.Vector3(10, 3, 4), new THREE.Vector3(-1, 0, 0))
    expect(resolveSpatialAnchor(null, towardX, "yz")).toEqual({ position: { x: 0, y: 3, z: 4 }, source: "work-plane" })
  })

  it("refuses nearly parallel or backwards rays instead of creating an arbitrary point", () => {
    const parallel = new THREE.Ray(new THREE.Vector3(1, 2, 5), new THREE.Vector3(1, 0, -1e-11).normalize())
    expect(resolveSpatialAnchor(null, parallel, "xy")).toEqual({ reason: "当前视角无法确定工作平面的落点，请旋转视角或切换工作平面" })
    const away = new THREE.Ray(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, 1))
    expect(resolveSpatialAnchor(null, away, "xy")).toHaveProperty("reason")
  })

  it("never binds a new point to a face merely because a ray hit its display mesh", () => {
    expect(resolveSpatialAnchor(hit("face"), ray, "xy")).toEqual({ position: { x: 4, y: 5, z: 6 }, source: "face" })
  })

  it("snaps to a displayed spatial line without binding an invented point", () => {
    expect(resolveSpatialAnchor(hit("line"), ray, "xy")).toEqual({ position: { x: 4, y: 5, z: 6 }, source: "edge" })
  })
  it("supports a selected face work plane using its geometric plane", () => {
    const selectedFace: WorkPlane = { normal: { x: 0, y: 0, z: 1 }, constant: -3 }
    expect(resolveSpatialAnchor(null, ray, selectedFace)).toEqual({ position: { x: 2, y: 3, z: 3 }, source: "work-plane" })
  })

  /**
   * 相机斜视：射线不再垂直打在工作平面上，落点必须**精确**是射线与该平面的交点。
   * 这条钉的是"斜着看时落点还在该在的地方"，而不是"能用就行"——写死像素偏移的用例正是因此失效过。
   */
  it("lands an oblique camera ray exactly on the work plane", () => {
    const oblique = new THREE.Ray(new THREE.Vector3(0, 0, 10), new THREE.Vector3(1, 1, -1).normalize())
    const onZ0 = positionOf(resolveSpatialAnchor(null, oblique, "xy"))
    expect(onZ0.x).toBeCloseTo(10, 9)
    expect(onZ0.y).toBeCloseTo(10, 9)
    expect(onZ0.z).toBeCloseTo(0, 12)

    // 换一张已选面（z = 3）：同一个斜射线的落点必须落在**那张面**上。
    const onSelectedFace = positionOf(resolveSpatialAnchor(null, oblique, { normal: { x: 0, y: 0, z: 1 }, constant: -3 }))
    expect(onSelectedFace.x).toBeCloseTo(7, 9)
    expect(onSelectedFace.y).toBeCloseTo(7, 9)
    expect(onSelectedFace.z).toBeCloseTo(3, 12)
  })

  /**
   * 面背侧：命中点落在工作平面**后面**时，落点必须是命中点本身，不能"按工作平面重新猜一个深度"。
   * `RaycastHit3` 不带朝向，所以这里能断言的就是这条性质：命中优先于工作平面，且不做二次投影。
   */
  it("keeps a back-side face hit at the hit point instead of re-projecting it", () => {
    const behindThePlane = hit("face", { x: 1, y: 2, z: -4 })
    const anchor = resolveSpatialAnchor(behindThePlane, ray, "xy")

    expect(anchor).toEqual({ position: { x: 1, y: 2, z: -4 }, source: "face" })
    // 关键判据：它**不是**这条射线与 z = 0 的交点（那是 (2, 3, 0)）—— 否则就是替用户猜了深度。
    expect(positionOf(anchor)).not.toEqual({ x: 2, y: 3, z: 0 })
  })

  /**
   * 距离容差：视线与工作平面**近乎平行**时没有有意义的落点。
   * 阈值是 `1e-8`（`spatialPick.ts` 的判据），这条把阈值两侧的行为都钉住：低于就拒绝，
   * 高于才接受——而接受时落点会远得离谱，那正是阈值存在的理由。
   */
  it("draws the line at the near-parallel tolerance instead of guessing a far point", () => {
    const towardPlane = (z: number) => new THREE.Ray(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, z).normalize())

    // 1e-9 < 1e-8：几乎平行，如实拒绝，不把落点扔到百万单位之外
    expect(resolveSpatialAnchor(null, towardPlane(-1e-9), "xy")).toHaveProperty("reason")

    // 1e-6 > 1e-8：接受；落点仍在平面上（y = 0），但 x 会远大于 1e5
    const accepted = positionOf(resolveSpatialAnchor(null, towardPlane(-1e-6), "xy"))
    expect(accepted.y).toBeCloseTo(0, 12)
    expect(accepted.x).toBeGreaterThan(1e5)
  })

  /**
   * 重叠点：两个空间点坐标完全重合时，"复用哪一个"只能由**命中本身**决定。
   * 这条钉住"身份来自命中，不来自坐标反查"——否则重合点会被静默换成一个用户没点的那一个。
   */
  it("takes the point identity from the hit, not from a coordinate lookup", () => {
    const coincident = { x: 1, y: 2, z: 3 }
    const second: RaycastHit3 = { kind: "point", primitiveId: "point-2", depth: 4, worldPoint: coincident }

    expect(resolveSpatialAnchor(second, ray, "xy")).toEqual({ position: coincident, pointId: "point-2", source: "point" })
  })
})