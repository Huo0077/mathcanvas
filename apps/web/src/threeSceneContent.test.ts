import { describe, expect, it } from "vitest"
import * as THREE from "three"

import { createEmptyDocument, type GeometryDocument, type Point3Primitive, type PrimitiveSpec } from "@draw/dsl"
import { applyCameraState, createCameraState } from "./threeCamera"
import { createThreeSceneContent, type ThreeSceneContentDeps } from "./threeSceneContent"

/**
 * **内容同步**（`./threeSceneContent`）的增量行为。
 *
 * 这一块过去整块住在挂载期效应里，**没法单独测** —— 只能靠 `geometry3d-*` 那组 e2e 从整页外面看。
 * 切成"工厂 + deps"之后，它第一次可以直接喂一份文档进去，问它"你到底重建了什么"：
 * 每个读数都由它自己写在 `sceneShell.dataset` 上（`sceneCreated` / `sceneReused` / `sceneRemoved` /
 * `sceneCreatedKeys`），所以断言读的是**它自己的口径**，不是测试替它算的。
 *
 * 这里钉住的都是"重建粒度"这一类不变式 —— 它们是这 500 行里最容易悄悄走样的地方：
 * 1. 同一份内容第二次同步要**沿用**（不是重建）；
 * 2. 只改一个图元时，**只有那一个**重建（栅格与坐标轴不许跟着重建）；
 * 3. 图元被删掉时旧记录要收掉、计数如实；
 * 4. `refreshPrimitiveObject` 与整场同步共用一张记录表，所以不会把同一个图元画成两个对象。
 */

const POINT: Point3Primitive = { id: "point3-a", type: "point3", position: { x: 1, y: 2, z: 3 }, binding: { kind: "free" } }

/** 一个**可转**对象（模板实体）：选中它的那一刻，正是"三个环该不该出现"的分水岭。 */
const CUBE: PrimitiveSpec = { id: "cube-1", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }

/** 一个**自带圆心与半径**的轨道圆：它的半径手柄与三色环是两件事，要能分别断言。 */
const ORBIT: PrimitiveSpec = { id: "orbit-1", type: "circle3", center: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 }

/** 场景里真正画出来的三色环（按"哪根轴"认，不按组认：组本身也挂同一个 visualRole）。 */
function ringsOnCanvas(scene: THREE.Scene): THREE.Object3D[] {
  const found: THREE.Object3D[] = []
  scene.traverse((object) => { if (typeof object.userData.rotationAxis === "string") found.push(object) })
  return found
}

function radiusHandlesOnCanvas(scene: THREE.Scene): THREE.Object3D[] {
  const found: THREE.Object3D[] = []
  // 只数那个**小球**：`createTrackRadiusHandle` 把同一个 role 挂在组与小球上（虚线半径是另一个 role）。
  scene.traverse((object) => { if (object.userData.visualRole === "track-radius-handle" && object.type === "Mesh") found.push(object) })
  return found
}

function documentWith(primitives: PrimitiveSpec[]): GeometryDocument {
  return { ...createEmptyDocument("geometry3d"), primitives }
}

/** 一个"只有一份文档"的最小运行时：场景 + 相机 + 一个 div 当 `sceneShell`（读数写在它的 dataset 上）。 */
function harness(primitives: PrimitiveSpec[] = [POINT]) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(42, 800 / 600, 0.1, 1000)
  applyCameraState(camera, createCameraState())
  camera.updateMatrixWorld(true)
  const sceneShell = document.createElement("div")
  const documentRef: { current: GeometryDocument } = { current: documentWith(primitives) }
  const deps: ThreeSceneContentDeps = {
    documentRef,
    selectedIdsRef: { current: [] },
    displayFlagsRef: { current: { showHiddenEdges: true, showNormals: false, transparentFaces: false, showRotationHandles: false, unfoldProgress: 0 } },
    previewsRef: { current: [] },
    previewHoverKeyRef: { current: null },
    previewHoverRef: { current: undefined },
    curveToleranceBucketRef: { current: 0.25 },
    circleRadiusPreviewRef: { current: null },
    rotationHandleRef: { current: null },
    trackRadiusHandleRef: { current: null },
    sceneSyncsRef: { current: 0 },
    cameraStateRef: { current: createCameraState() },
    scene,
    camera,
    sceneShell,
    viewportSize: () => ({ width: 800, height: 600 }),
    syncPointHandleScales: () => {},
    pointHandles: [],
    visiblePointLabels: [],
    measurementVisuals: [],
    previewGroups: new Map(),
    previewByKey: new Map(),
    sceneBounds: new THREE.Box3(),
    points: new Map(),
    topologyOwners: new Map(),
    objectIndex: new Map(),
    grid: { helper: null, majorHelper: null, axes: null, radius: 0 }
  }
  const content = createThreeSceneContent(deps)
  /** 场景里所有挂着这个图元 id 的对象（同一个图元可能挂在"组 + 子对象"两层）。 */
  const objectsOf = (id: string) => {
    const found: THREE.Object3D[] = []
    scene.traverse((object) => { if (object.userData.primitiveId === id) found.push(object) })
    return found
  }
  return { ...content, deps, scene, sceneShell, objectsOf }
}

describe("incremental scene content sync", () => {
  it("draws a primitive on the first sync and records what it created", () => {
    const { syncContent, sceneShell, deps, objectsOf } = harness()

    syncContent()

    expect(objectsOf("point3-a")).toHaveLength(1)
    expect(deps.objectIndex.get("point3-a")).toBe(objectsOf("point3-a")[0])
    expect(sceneShell.dataset.sceneCreatedKeys).toContain("point:point3-a")
    /** 一份"只有一个点"的文档仍有 4 条内容记录：那个点 + 栅格 / 主栅格 / 坐标轴这三个静态对象。 */
    expect(sceneShell.dataset.sceneCreatedKeys).toContain("static:grid")
    expect(sceneShell.dataset.sceneCreatedKeys).toContain("static:grid-major")
    expect(sceneShell.dataset.sceneCreatedKeys).toContain("static:axes")
    expect(sceneShell.dataset.sceneContent).toBe("4")
    expect(sceneShell.dataset.sceneSyncs).toBe("1")
  })

  it("reuses every object when nothing changed, instead of rebuilding the scene", () => {
    const { syncContent, sceneShell, objectsOf } = harness()
    syncContent()
    const first = objectsOf("point3-a")[0]

    // 换一份**内容相同**的文档对象：签名是按内容算的，所以这里必须全部沿用。
    syncContent()

    expect(objectsOf("point3-a")).toHaveLength(1)
    expect(objectsOf("point3-a")[0]).toBe(first)
    expect(sceneShell.dataset.sceneCreated).toBe("0")
    expect(sceneShell.dataset.sceneReused).not.toBe("0")
    expect(sceneShell.dataset.sceneCreatedKeys).toBe("")
  })

  it("rebuilds only the primitive that changed and leaves the grid alone", () => {
    const { syncContent, sceneShell, deps, objectsOf } = harness()
    syncContent()
    const first = objectsOf("point3-a")[0]

    deps.documentRef.current = documentWith([{ ...POINT, position: { x: 5, y: 0, z: 0 } }])
    syncContent()

    expect(sceneShell.dataset.sceneCreatedKeys).toContain("point:point3-a")
    /**
     * 栅格与坐标轴**不许**跟着重建 —— 这正是 `alive` 要提前登记它们的原因
     *（它们是在内容之后才加进场景的，登记晚了就会被当成"过期对象"删掉、下一轮再建一次；
     * 实测症状：每次同步都重建栅格与坐标轴）。
     */
    expect(sceneShell.dataset.sceneCreatedKeys).not.toContain("static:grid")
    expect(sceneShell.dataset.sceneCreatedKeys).not.toContain("static:axes")
    expect(objectsOf("point3-a")).toHaveLength(1)
    expect(objectsOf("point3-a")[0]).not.toBe(first)
  })

  it("releases the record of a deleted primitive and reports it", () => {
    const { syncContent, sceneShell, deps, objectsOf } = harness()
    syncContent()

    deps.documentRef.current = documentWith([])
    syncContent()

    expect(sceneShell.dataset.sceneRemoved).toBe("1")
    /** 图元那条记录收掉了，三个静态对象（栅格 / 主栅格 / 坐标轴）照旧留着。 */
    expect(sceneShell.dataset.sceneContent).toBe("3")
    expect(sceneShell.dataset.sceneCreated).toBe("0")
    expect(deps.objectIndex.has("point3-a")).toBe(false)
    expect(objectsOf("point3-a")).toHaveLength(0)
  })

  it("rebuilds one point-driven object in place, drawing it where the live points map says", () => {
    const { syncContent, refreshPrimitiveObject, deps, objectsOf } = harness()
    syncContent()

    // 拖动期间文档不提交：新坐标只写在 `points` 表里（这正是"拖到哪儿看得见"的那条口径）。
    deps.points.set("point3-a", { ...POINT, position: { x: 9, y: 9, z: 9 } })
    refreshPrimitiveObject("point3-a")

    expect(deps.documentRef.current.primitives[0]).toMatchObject({ position: { x: 1, y: 2, z: 3 } })
    expect(objectsOf("point3-a")).toHaveLength(1)
    expect(objectsOf("point3-a")[0].position.toArray()).toEqual([9, 9, 9])
  })

  it("does not draw a second copy when a full sync follows an in-place rebuild", () => {
    const { syncContent, refreshPrimitiveObject, deps, objectsOf } = harness()
    syncContent()

    deps.points.set("point3-a", { ...POINT, position: { x: 9, y: 9, z: 9 } })
    refreshPrimitiveObject("point3-a")
    syncContent()

    /** 走的是同一张记录表：旧对象被释放、只留一个 —— 不是"没见过的对象"再建一个。 */
    expect(objectsOf("point3-a")).toHaveLength(1)
  })
})

/**
 * 旋转手柄（三色环）的**视图开关**。
 *
 * 用户口径："把这个太空环删掉" —— 截图里选中一个正方体时，三个环糊在图上，把图面挡住了。
 * 环本身还要留着（拖动旋转是唯一的拖转入口），所以做成**默认关的显示开关**：
 * 关着的时候画布上不建环、`rotationHandleRef` 为空（指针逻辑自然回到"没抓到环"的原行为），
 * 打开才出现。这一组钉住的正是"默认关 / 开得起来 / 收得回去"，以及**半径手柄不受牵连**。
 */
describe("rotation handle view switch", () => {
  it("keeps the three rings off the canvas while the switch is off", () => {
    const { syncContent, sceneShell, deps, scene } = harness([CUBE])
    deps.selectedIdsRef.current = ["cube-1"]

    syncContent()

    // 条件本身是满足的（恰好选中一个可转对象）；关着开关就不许出现环。
    expect(ringsOnCanvas(scene)).toHaveLength(0)
    expect(deps.rotationHandleRef.current).toBeNull()
    expect(sceneShell.dataset.rotationHandles).toBe("0")
    expect(sceneShell.dataset.rotationHandlePivot).toBe("")
  })

  it("draws them once the switch is on, and takes them away when it goes back off", () => {
    const { syncContent, sceneShell, deps, scene } = harness([CUBE])
    deps.selectedIdsRef.current = ["cube-1"]
    syncContent()

    deps.displayFlagsRef.current = { ...deps.displayFlagsRef.current, showRotationHandles: true }
    syncContent()

    expect(ringsOnCanvas(scene)).toHaveLength(3)
    expect(deps.rotationHandleRef.current?.id).toBe("cube-1")
    expect(sceneShell.dataset.rotationHandles).toBe("3")
    expect(sceneShell.dataset.rotationHandlePivot).not.toBe("")

    deps.displayFlagsRef.current = { ...deps.displayFlagsRef.current, showRotationHandles: false }
    syncContent()

    expect(ringsOnCanvas(scene)).toHaveLength(0)
    expect(deps.rotationHandleRef.current).toBeNull()
    expect(sceneShell.dataset.rotationHandles).toBe("0")
    /** 收起来的环算"被释放"，不是"重建失败"：读数如实。 */
    expect(sceneShell.dataset.sceneRemoved).toBe("1")
  })

  it("still offers the radius handle of an orbit track while the rings are off", () => {
    const { syncContent, deps, scene } = harness([ORBIT])
    deps.selectedIdsRef.current = ["orbit-1"]

    syncContent()

    /** 半径手柄是**缩放**的唯一入口、也不挡图面：环的开关不该把它一起关掉。 */
    expect(radiusHandlesOnCanvas(scene)).toHaveLength(1)
    expect(deps.trackRadiusHandleRef.current?.id).toBe("orbit-1")
    expect(ringsOnCanvas(scene)).toHaveLength(0)
  })
})
