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
    displayFlagsRef: { current: { showHiddenEdges: true, showNormals: false, transparentFaces: false, unfoldProgress: 0 } },
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
