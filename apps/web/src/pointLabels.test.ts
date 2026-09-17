import { describe, expect, it } from "vitest"
import * as THREE from "three"

import { applyCameraState, createCameraState } from "./threeCamera"
import { pointLabelPlacements } from "./pointLabels"

/**
 * 点标注（画布上的 A/B/C… 字母）的屏幕位置。
 *
 * 用户实测反馈："现在圆柱上的点又不跟着动了。"
 * 点手柄是画布对象、跟着临时偏移走了，但标注此前按**文档坐标**投影——拖动期间文档不提交，
 * 于是手把实体拖走了、字母还钉在原处。这条用例把"跟着对象走"钉住。
 */
describe("point labels", () => {
  const camera = (() => {
    const instance = new THREE.PerspectiveCamera(42, 1, 0.1, 1000)
    applyCameraState(instance, createCameraState())
    instance.updateMatrixWorld(true)
    return instance
  })()
  const size = { width: 800, height: 600 }

  it("projects the object's live world position, not the document's stored coordinates", () => {
    const point = { id: "point-1", position: { x: 1, y: 0, z: 0 }, label: "A" }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    handle.position.set(1, 0, 0)
    // 拖动中的临时偏移：对象已经在 (3,0,0)，文档里还是 (1,0,0)。
    handle.position.x = 3

    const [withObject] = pointLabelPlacements([point], () => handle, camera, size)
    const [withoutObject] = pointLabelPlacements([point], () => null, camera, size)

    // 标注跟着对象走：与"把文档坐标换成 (3,0,0)"得到的位置一致，而不是停在 (1,0,0) 那一处。
    const [expected] = pointLabelPlacements([{ ...point, position: { x: 3, y: 0, z: 0 } }], () => null, camera, size)
    expect(withObject.left).toBeCloseTo(expected.left, 9)
    expect(withObject.top).toBeCloseTo(expected.top, 9)
    // 没有对象时如实退回文档坐标（宁可按旧位置画，也不画到别处去）。
    expect(withoutObject.left).not.toBeCloseTo(withObject.left, 3)
    expect(withoutObject.dataset).toEqual({ pointLabel: "A", pointId: "point-1" })
  })

  it("keeps every label on its own point when several are projected in one batch", () => {
    // 三个点各带自己的手柄：内部复用同一个 scratch 向量时，绝不能把上一份坐标带进下一份。
    const points = [
      { id: "point-1", position: { x: -2, y: 0, z: 0 }, label: "A" },
      { id: "point-2", position: { x: 0, y: -2, z: 0 }, label: "B" },
      { id: "point-3", position: { x: 2, y: 0, z: 0 }, label: "C" }
    ]
    const objects = points.map((point) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2))
      // 每份对象都在文档坐标上再加一个自己的偏移。
      mesh.position.set(point.position.x + 1, point.position.y, point.position.z)
      return mesh
    })

    const placements = pointLabelPlacements(points, (id) => objects[points.findIndex((point) => point.id === id)], camera, size)
    for (const [index, point] of points.entries()) {
      const [expected] = pointLabelPlacements([{ ...point, position: { x: point.position.x + 1, y: point.position.y, z: point.position.z } }], () => null, camera, size)
      expect(placements[index].left).toBeCloseTo(expected.left, 9)
      expect(placements[index].top).toBeCloseTo(expected.top, 9)
    }
    // 三个标注互不重合（若带错了坐标，就会有两个落在同一处）。
    expect(new Set(placements.map((placement) => `${placement.left.toFixed(3)},${placement.top.toFixed(3)}`)).size).toBe(3)
  })
})
