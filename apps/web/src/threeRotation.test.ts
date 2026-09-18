import { describe, expect, it } from "vitest"
import * as THREE from "three"

import { createEmptyDocument, type GeometryDocument, type PrimitiveSpec } from "@draw/dsl"
import { buildSolidTemplate, circleHost3 } from "@draw/geometry-kernel"

import {
  advanceRotationDrag,
  applyRotationSkew,
  beginRotationDrag,
  circleRadiusHandlePoint,
  hasRotationMovement,
  rotationAngleAt,
  rotationDragDegrees,
  rotationHandleAxisAt,
  rotationHandleGeometry,
  rotationHandleTarget,
  shortestAngleDelta,
  trackRadiusAt,
  trackRadiusHandleHit
} from "./threeDrag"
import { createRotationHandles, createTrackRadiusHandle } from "./threePrimitives"

/**
 * 画布旋转手柄（slice 4）：三色环、绕世界轴的拖动角度、15° 吸附、拖动期间的临时旋转。
 *
 * 用户口径："我希望能给立体图形增加旋转功能，就像我想要一个横着的圆柱，可以在图中拖着圆柱旋转。"
 *
 * 这里全是**纯函数**层面的断言：指针位置 → 绕轴角度、量化、临时旋转矩阵应用。
 * 组件那一层只负责把事件接到这些函数上（`threeScene.tsx`），所以"命中环才开会话""量化到 15°""没有位移不提交"
 * 都能在这里用数字说清楚，而不是靠肉眼看画布。
 */

/** 与 `applyCameraState` 同一套约定：Z 朝上、仰角/方位角决定视线；这里按世界坐标摆一台相机即可。 */
function cameraAt(position: THREE.Vector3, target = new THREE.Vector3()): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000)
  camera.up.set(0, 0, 1)
  camera.position.copy(position)
  camera.lookAt(target)
  camera.updateMatrixWorld(true)
  return camera
}

/** 世界点 → 组件里 `pointFromEvent` 用的归一化指针坐标（x 向右、y 向下）。 */
function pointerAt(world: THREE.Vector3, camera: THREE.Camera) {
  const ndc = world.clone().project(camera)
  return { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2 }
}

const document3d = (primitives: PrimitiveSpec[]): GeometryDocument => ({ ...createEmptyDocument("geometry3d"), primitives })

describe("rotation handle geometry", () => {
  const cube = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
  const cubeDocument = () => document3d([cube, ...buildSolidTemplate(cube).primitives])

  it("puts the rings on a template solid's own centre, wide enough to enclose it", () => {
    const spec = rotationHandleGeometry(cubeDocument(), "cube-1")!
    expect(spec.center.x).toBeCloseTo(0, 12)
    expect(spec.center.y).toBeCloseTo(0, 12)
    expect(spec.center.z).toBeCloseTo(0, 12)
    // 环必须把实体圈在里面（不然手柄会插进图形里、也不好抓），但也不能大到离题。
    const reach = Math.sqrt(3)
    expect(spec.radius).toBeGreaterThan(reach)
    expect(spec.radius).toBeLessThan(reach * 2)
  })

  it("uses a circle track's own centre and radius for its rotation rings", () => {
    /**
     * 这条守的是一个**会静默消失**的坑：轨道圆改成"自带圆心"之后，它在场景图里不再拥有任何点，
     * 而 `rotationHandleGeometry` 原本对 `circle3` 走的是"取它拥有的点的形心"那条路——
     * 那条路会返回 `null`，于是选中轨道时三个旋转环**一个都不出现**，用户完全不知道为什么转不了。
     * 所以它必须有自己的一支：环心 = 圆自己的圆心、reach = 半径。
     */
    const track = document3d([
      { id: "p-c", type: "point3", position: { x: -5, y: -5, z: -5 }, binding: { kind: "free" } },
      { id: "orbit-1", type: "circle3", center: { x: 1, y: 2, z: 3 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 }
    ])
    const spec = rotationHandleGeometry(track, "orbit-1")!
    expect(spec.center.x).toBeCloseTo(1, 12)
    expect(spec.center.y).toBeCloseTo(2, 12)
    expect(spec.center.z).toBeCloseTo(3, 12)
    expect(spec.radius).toBeGreaterThan(2)
    // 与"被引用点"无关：那个点在哪都不影响环（轨道已经不引用它了）。
    expect(rotationHandleTarget(track, ["orbit-1"])).toBe("orbit-1")
  })

  it("uses a circle track's centre and a face's centroid", () => {
    const track = document3d([
      { id: "p-c", type: "point3", position: { x: 1, y: 2, z: 3 }, binding: { kind: "free" } },
      { id: "orbit-1", type: "circle3", center: { x: 1, y: 2, z: 3 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 }
    ])
    expect(rotationHandleGeometry(track, "orbit-1")!.center).toMatchObject({ x: 1, y: 2, z: 3 })
    expect(rotationHandleGeometry(track, "orbit-1")!.radius).toBeGreaterThan(2)

    const face = document3d([
      { id: "p-a", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "p-b", type: "point3", position: { x: 2, y: 0, z: 0 }, binding: { kind: "free" } },
      { id: "p-c", type: "point3", position: { x: 0, y: 2, z: 0 }, binding: { kind: "free" } },
      { id: "face-abc", type: "face3", pointIds: ["p-a", "p-b", "p-c"] }
    ])
    const spec = rotationHandleGeometry(face, "face-abc")!
    expect(spec.center.x).toBeCloseTo(2 / 3, 12)
    expect(spec.center.y).toBeCloseTo(2 / 3, 12)
    expect(spec.center.z).toBeCloseTo(0, 12)
    expect(spec.radius).toBeGreaterThan(Math.hypot(2 / 3, 2 / 3))
  })

  it("offers no rings for an object that cannot be turned", () => {
    const document = cubeDocument()
    const generated = (document.primitives.find((primitive) => primitive.type === "polyhedron3") as { id: string }).id

    // 孤立的空间点没有朝向、物化拓扑不许单独动、缺 id 与锁定对象同样不给手柄。
    expect(rotationHandleGeometry(document, "missing")).toBeNull()
    expect(rotationHandleGeometry(document, generated)).toBeNull()
    expect(rotationHandleGeometry(document3d([{ id: "p-0", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } }]), "p-0")).toBeNull()
    const locked: GeometryDocument = { ...document, primitives: document.primitives.map((primitive) => primitive.id === "cube-1" ? { ...primitive, locked: true } : primitive) }
    expect(rotationHandleGeometry(locked, "cube-1")).toBeNull()
  })

  it("draws them only for exactly one selected turnable object", () => {
    const document = cubeDocument()
    expect(rotationHandleTarget(document, ["cube-1"])).toBe("cube-1")
    // 多选时不知道"绕谁转"，所以不给手柄；选到不可转的对象也不给。
    const generated = (document.primitives.find((primitive) => primitive.type === "polyhedron3") as { id: string }).id
    expect(rotationHandleTarget(document, ["cube-1", generated])).toBeNull()
    expect(rotationHandleTarget(document, [])).toBeNull()
    const point = document.primitives.find((primitive) => primitive.type === "point3")!
    expect(rotationHandleTarget(document, [point.id])).toBeNull()
  })
})

describe("rotation handles", () => {
  it("marks the three world-axis rings as handles that never drive the framing", () => {
    const group = createRotationHandles({ x: 0, y: 0, z: 0 }, 2)!
    expect(group.userData.visualRole).toBe("rotation-handle")
    // 手柄不是图形内容：让它参与"适应视图"会把取景撑大。
    expect(group.userData.excludeFromFit).toBe(true)
    expect(group.children.map((child) => child.userData.rotationAxis).sort()).toEqual(["x", "y", "z"])
    for (const child of group.children) expect(child.userData.visualRole).toBe("rotation-handle")
  })

  it("picks the ring under the pointer and nothing in the middle", () => {
    const group = createRotationHandles({ x: 0, y: 0, z: 0 }, 2)!
    const scene = new THREE.Scene()
    scene.add(group)
    /**
     * 相机故意不落在任何坐标轴上：正对着 Z 轴看时，X / Y 两个环是**侧着**的，
     * 它们正好穿过画面中心——那时"指针在圆心"与"指针在环上"是同一件事，这条用例就分辨不出东西了。
     */
    const camera = cameraAt(new THREE.Vector3(6, 4, 7))
    const on = (world: THREE.Vector3) => rotationHandleAxisAt(group, camera, pointerAt(world, camera))

    // 三个环两两相交于 ±2 单位轴点，所以取各自 45° 处那一点，命中是唯一的。
    expect(on(new THREE.Vector3(Math.SQRT2, Math.SQRT2, 0))).toBe("z")
    expect(on(new THREE.Vector3(0, Math.SQRT2, Math.SQRT2))).toBe("x")
    expect(on(new THREE.Vector3(Math.SQRT2, 0, Math.SQRT2))).toBe("y")
    // 圆心的指针不在任何环上 ⇒ 不开旋转会话（否则拖动图形本体也会转起来）。
    expect(on(new THREE.Vector3(0, 0, 0))).toBeNull()
    // 环外的空处同样不给轴。
    expect(on(new THREE.Vector3(6, 0, 0))).toBeNull()
  })
})

describe("rotation drag session", () => {
  const center = new THREE.Vector3(0, 0, 0)
  /**
   * 相机不能正对着某个轴摆：那样"看着某个环"时视线与该环所在平面**平行**，射线与平面没有唯一交点，
   * 角度就没有定义（`rotationAngleAt` 会如实返回 `null`）。真实视角本来也是斜的。
   */
  const camera = cameraAt(new THREE.Vector3(6, 4, 7))
  const angleAt = (world: THREE.Vector3, axis: "x" | "y" | "z" = "z") => rotationAngleAt(camera, center, axis, pointerAt(world, camera))!

  it("measures the angle about the world axis, zero along that axis's own reference", () => {
    /**
     * 参考基按右手循环取：轴 X 用 (ŷ, ẑ)、Y 用 (ẑ, x̂)、Z 用 (x̂, ŷ)，`v = axis × u`。
     * 于是"把 ŷ 转到 ẑ"就是绕 X 的 +90°——与 `composeEuler3` 的右手法则完全一致，
     * 拖动方向与属性栏读数的符号才不会相反。
     */
    expect(angleAt(new THREE.Vector3(1, 0, 0))).toBeCloseTo(0, 9)
    expect(angleAt(new THREE.Vector3(0, 1, 0))).toBeCloseTo(Math.PI / 2, 9)
    // 正好在 −u 上时 atan2 的 ±π 只差一个零的符号，两种都算对。
    expect(Math.abs(angleAt(new THREE.Vector3(-1, 0, 0)))).toBeCloseTo(Math.PI, 9)

    expect(angleAt(new THREE.Vector3(0, 1, 0), "x")).toBeCloseTo(0, 9)
    expect(angleAt(new THREE.Vector3(0, 0, 1), "x")).toBeCloseTo(Math.PI / 2, 9)
    expect(angleAt(new THREE.Vector3(0, 0, 1), "y")).toBeCloseTo(0, 9)
    expect(angleAt(new THREE.Vector3(1, 0, 0), "y")).toBeCloseTo(Math.PI / 2, 9)
    /**
     * 相机正好**落在环所在的平面里**（这里是 z = 0）时，视线与该平面平行、指针位置没有唯一含义。
     * three 的 `intersectPlane` 对这种"平行且共面"的情形返回的是**射线原点**，若直接用就会读出一个
     * 凭空的角度（实测半径那一路就是这样读出了 10）——所以两处都自己挡平行，返回 `null`。
     */
    const inPlane = cameraAt(new THREE.Vector3(10, 0, 0))
    expect(rotationAngleAt(inPlane, center, "z", pointerAt(new THREE.Vector3(1, 1, 0), inPlane))).toBeNull()
  })

  it("takes the shortest way round when the angle crosses ±π", () => {
    expect(shortestAngleDelta(3.0, -3.0)).toBeCloseTo(2 * Math.PI - 6, 9)
    expect(shortestAngleDelta(-3.0, 3.0)).toBeCloseTo(6 - 2 * Math.PI, 9)
    expect(shortestAngleDelta(0.1, 0.4)).toBeCloseTo(0.3, 12)
  })

  it("snaps the accumulated angle to 15° steps, and not at all with Alt held", () => {
    const snap = (15 * Math.PI) / 180
    let state = beginRotationDrag("z", center, 0)
    const push = (degrees: number, snapRadians: number | null = snap) => {
      const advanced = advanceRotationDrag(state, (degrees * Math.PI) / 180, snapRadians)
      state = advanced.state
      return { stepDegrees: (advanced.step * 180) / Math.PI, degrees: rotationDragDegrees(advanced.state), radians: advanced.radians }
    }

    // 20° → 吸附到 15°；40° → 45°（累计值吸附，不是每步增量各自吸附，否则会一路累积到偏）。
    expect(push(20).degrees).toBeCloseTo(15, 9)
    expect(push(40).degrees).toBeCloseTo(45, 9)
    // Alt：不量化，如实跟着指针。
    expect(push(52, null).degrees).toBeCloseTo(52, 9)
    // 松手前的最后一步可以从 52° 回到吸附值 45°（每一步都按当前累计值重算）。
    expect(push(50).degrees).toBeCloseTo(45, 9)
    // 这一步画进画面的增量就是"新的吸附值 − 已经画上的值"，不是累计值本身。
    expect(push(50).stepDegrees).toBeCloseTo(0, 9)
    expect(push(76).degrees).toBeCloseTo(75, 9)
    expect((state.applied * 180) / Math.PI).toBeCloseTo(75, 9)
  })

  it("keeps accumulating instead of jumping a whole turn at the ±π seam", () => {
    // 从 171.9° 按下、拖到 −171.9°：这是往前走了 16.2°，不是倒退 −343.8°。
    const advanced = advanceRotationDrag(beginRotationDrag("z", center, 3.0), -3.0, null)
    expect(rotationDragDegrees(advanced.state)).toBeCloseTo(((2 * Math.PI - 6) * 180) / Math.PI, 9)
    expect(Math.abs(rotationDragDegrees(advanced.state))).toBeLessThan(30)
    // 再跨一次缝也不会累积成"退回去"：继续往前。
    const further = advanceRotationDrag(advanced.state, -2.9, null)
    expect(rotationDragDegrees(further.state)).toBeGreaterThan(rotationDragDegrees(advanced.state))
  })

  it("reports no movement until the pointer actually turns the object", () => {
    const state = beginRotationDrag("z", center, 0)
    expect(hasRotationMovement(state)).toBe(false)
    // 2° 的抖动吸附回 0°：不算"转过了"，抬手不该提交（否则一次误触就多一步撤销）。
    const nudged = advanceRotationDrag(state, (2 * Math.PI) / 180, (15 * Math.PI) / 180)
    expect(hasRotationMovement(nudged.state)).toBe(false)
    expect(hasRotationMovement(advanceRotationDrag(state, (20 * Math.PI) / 180, (15 * Math.PI) / 180).state)).toBe(true)
  })
})

describe("track radius handle (scaling)", () => {
  const centre = new THREE.Vector3(1, 2, 3)
  const normal = new THREE.Vector3(0, 0, 1)

  /**
   * 半径手柄落在**宿主参数 0** 处：与"绑上去的动点参数 0"是同一个点。
   * 这样"拖手柄"和"点在圆上的哪儿"说的是同一套参数，不另写一份基（也就不会两处漂移）。
   */
  it("puts the handle exactly where the host says parameter 0 is", () => {
    const handle = circleRadiusHandlePoint(centre, normal, 2)
    const atZero = circleHost3({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 1 }, 2)!.evaluate({ u: 0 })
    expect(handle.x).toBeCloseTo(atZero.x, 12)
    expect(handle.y).toBeCloseTo(atZero.y, 12)
    expect(handle.z).toBeCloseTo(atZero.z, 12)
    // 它就在圆周上（离圆心正好一个半径）。
    expect(handle.distanceTo(centre)).toBeCloseTo(2, 12)
  })

  it("reads a dragged radius off the circle's own plane, with a floor and no guessing", () => {
    const camera = cameraAt(new THREE.Vector3(6, 4, 7))
    const onRim = pointerAt(new THREE.Vector3(3, 0, 0), camera)
    // 指针落在圆周上 ⇒ 半径就是到圆心的距离（圆在 z=0 平面里，圆心在原点）。
    expect(trackRadiusAt(camera, new THREE.Vector3(0, 0, 0), normal, onRim)).toBeCloseTo(3, 6)
    // 指针落在圆心 ⇒ 夹到下限 0.01（零半径的圆是退化图形，属性栏的下限也是 0.01）。
    expect(trackRadiusAt(camera, new THREE.Vector3(0, 0, 0), normal, pointerAt(new THREE.Vector3(0, 0, 0), camera))).toBeCloseTo(0.01, 9)
    // 视线与圆所在平面平行（正对着圆看）⇒ 没有唯一交点，不猜：返回 null。
    const edgeOn = cameraAt(new THREE.Vector3(0, 10, 0))
    expect(trackRadiusAt(edgeOn, new THREE.Vector3(0, 0, 0), normal, { x: 0.5, y: 0.5 })).toBeNull()
    // 零法向同样不猜。
    expect(trackRadiusAt(camera, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0), onRim)).toBeNull()
  })

  it("only starts a scale session when the pointer is actually on the handle", () => {
    const handle = createTrackRadiusHandle({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 2)!
    const scene = new THREE.Scene()
    scene.add(handle)
    const camera = cameraAt(new THREE.Vector3(6, 4, 7))
    const onHandle = circleRadiusHandlePoint({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 2)

    expect(trackRadiusHandleHit(handle, camera, pointerAt(onHandle, camera))).toBe(true)
    // 圆心与远处都不算命中：没抓住手柄时行为必须一字不变（仍走平移 / 选择）。
    expect(trackRadiusHandleHit(handle, camera, pointerAt(new THREE.Vector3(0, 0, 0), camera))).toBe(false)
    expect(trackRadiusHandleHit(handle, camera, pointerAt(new THREE.Vector3(9, 9, 0), camera))).toBe(false)
    // 手柄不是图形内容：不参与取景，也不该挂 primitiveId 以外的东西。
    expect(handle.userData.excludeFromFit).toBe(true)
    expect(handle.userData.visualRole).toBe("track-radius-handle")
  })
})

describe("temporary rotation while dragging", () => {
  const meshAt = (x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    mesh.position.set(x, y, z)
    return mesh
  }

  it("turns a family member about the pivot and hands it back exactly on release", () => {
    const scene = new THREE.Scene()
    const mesh = meshAt(2, 0, 0)
    mesh.userData.primitiveId = "obj-1"
    const other = meshAt(5, 0, 0)
    other.userData.primitiveId = "obj-2"
    scene.add(mesh, other)

    applyRotationSkew(scene, new Set(["obj-1"]), new THREE.Vector3(0, 0, 0), "z", Math.PI / 2)

    expect(mesh.position.x).toBeCloseTo(0, 9)
    expect(mesh.position.y).toBeCloseTo(2, 9)
    // 朝向也跟着转：只挪位置画出来会"位置对了、姿态没转"。
    const axisX = new THREE.Vector3(1, 0, 0).applyQuaternion(mesh.quaternion)
    expect(axisX.y).toBeCloseTo(1, 9)
    // 不在拖动族里的对象一动不动。
    expect(other.position.toArray()).toEqual([5, 0, 0])

    // 抬手：同一根轴、同一个枢轴转回去，画面原样交还给文档（否则提交后会再转一次）。
    applyRotationSkew(scene, new Set(["obj-1"]), new THREE.Vector3(0, 0, 0), "z", -Math.PI / 2)
    expect(mesh.position.x).toBeCloseTo(2, 9)
    expect(mesh.position.y).toBeCloseTo(0, 9)
    const restored = new THREE.Vector3(1, 0, 0).applyQuaternion(mesh.quaternion)
    expect(restored.x).toBeCloseTo(1, 9)

    scene.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose() } })
  })

  it("turns a group and its child exactly once, even when both carry the same id", () => {
    /**
     * 边界圆是"组 + 每圈线"两层都挂着同一个 `primitiveId`（`createRimCircles3`）。位移那条路踩过一次坑：
     * 两层各加一次 ⇒ 圆以两倍速度飞出去。旋转这边同样是"按 id 遍历"，所以规则也必须只落在最外层那一层：
     * 组转了会带着子树一起转，子对象再转一次就是两倍角度。
     */
    const scene = new THREE.Scene()
    const group = new THREE.Group()
    group.userData.primitiveId = "rim-1"
    const child = meshAt(2, 0, 0)
    child.userData.primitiveId = "rim-1"
    group.add(child)
    scene.add(group)
    scene.updateMatrixWorld(true)
    const before = child.getWorldPosition(new THREE.Vector3())

    applyRotationSkew(scene, new Set(["rim-1"]), new THREE.Vector3(0, 0, 0), "z", Math.PI / 2)

    // 世界坐标恰好是"原来的点绕 Z 转 90°"：x → y，转两次会变成 (−2, 0, 0)。
    const after = child.getWorldPosition(new THREE.Vector3())
    expect(after.x).toBeCloseTo(-before.y, 9)
    expect(after.y).toBeCloseTo(before.x, 9)

    scene.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose() } })
  })
})
