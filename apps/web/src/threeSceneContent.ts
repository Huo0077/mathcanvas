import * as THREE from "three"

import type { IntersectionFacePrimitive, IntersectionPoint3Primitive, IntersectionSolidPrimitive, Plane3Primitive, Point3Primitive, Polyhedron3Primitive, SectionPrimitive } from "@draw/dsl"
import { unfoldPolyhedron3 } from "@draw/geometry-kernel"
import { resolveDihedralMarker3, resolvePolyhedronTopology, sectionSourceVertices } from "@draw/scene-graph"
import { measurementVisualsForDocument, resolveMeasurementVisual } from "./measurementVisuals"
import { isUserVisiblePrimitive } from "./primitiveVisibility"
import { GRID_MAJOR_EVERY, GRID_MIN_RADIUS } from "./sceneGrid"
import { buildGridGeometry, GRID_MAJOR_COLOR, GRID_MINOR_COLOR } from "./threeGrid"
import { createContentSigner } from "./sceneContentSignature"
import { contentBounds, contentRadiusExcluding } from "./threeCamera"
import type { ThreeSceneGridHolder } from "./threeSceneGrid"
import type { ThreeScenePreview } from "./threeScenePreview"
import type { ThreeSceneEffectDeps } from "./threeSceneEffect"
import { rotationHandleGeometry, rotationHandleTarget } from "./threeDrag"
import { templateTopologyOwners } from "./threePicking"
import { createPlane3Mesh, createSectionMesh, createIntersectionSolidGroup, createIntersectionFaceGroup, createIntersectionPointGroup, createUnfoldNetGroup, createDihedralMarkerGroup, createPlanePatch, createRotationHandles, createTrackRadiusHandle, createSolidGroup, buildPointDrivenObject, disposeObject, createPreviewGroup, hasDrawablePreview, createCurveLoops3, createRimCircles3, visibleSolids } from "./threePrimitives"
import { curveToleranceFor, toleranceBucket } from "./conicSampling"
import { collectRimCircles, rimChordEdgeIds } from "./rimCircles"
import { defaultStrokeFor } from "./primitiveStyle"

/**
 * **内容同步**（从 `threeSceneEffect.ts` 里按阶段切出来的第六块，评审方案 2）：按内容签名把文档
 * **增量**地画成场景对象，并把这一轮的读数写成 `data-scene-*`（e2e 与排查都读它）。
 *
 * ## 它为什么能整块搬走
 *
 * 这是本效应里最大的一块（约 500 行），但它**读写的跨阶段共享量全是"稳定容器"**：就地 `clear` /
 * `push` / `copy` 再填，绝不整体重新赋值 —— 于是别处持有的引用永远有效（这条口径是切相机那一块时
 * 定下的，见 `threeSceneEffect` 的头注释）。写出去的只有三类：这些容器、若干 ref、
 * 以及 `sceneShell.dataset` 上的读数。**没有一处跨模块的 `let` 重新赋值**，所以搬动是安全的。
 *
 * ## 两条容易踩的口径
 *
 * 1. `alive` 与 `order` **刻意分开**：顺序只能由"实际构造的顺序"决定，而 `alive` 必须**提前**登记
 *    平面片 / 预览 / 背景坐标系这些"后面才加进来"的 key —— 否则释放过期对象时会把它们当成过期删掉、
 *    这一轮再重建一次（实测：每次同步都重建栅格与坐标轴）。
 * 2. **签名没变就沿用**（`keepContent`）：`build` 是惰性的，沿用的时候**不许**构造，否则省下的只是
 *    内存拷贝、白算的还是白算。展开动画过去每帧重建整场（内容签名里带 `unfoldProgress`），
 *    现在每帧只重建那张展开网。
 *
 * ## 搬动口径
 *
 * 下面这些行在旧位置逐字未改，只整体跟着走（搬走后比对过"新位置的每一行都能在旧位置找到"）；
 * 唯一的例外是 `contentRecords` 那两行：旧位置有一句属于 `syncCounts` 的说明被粘在了上一行行尾，
 * 这里把它放回它该在的那一行（只动注释的换行，未动代码）。
 */

/**
 * 从一个"稳定容器"数组里移除某个值（**移除全部出现的同一个引用**，顺序不变）。
 *
 * 为什么不是 `list = list.filter(...)`：这些数组现在是**跨阶段共享的稳定容器**（内容同步就地
 * push / 清空），重新赋值会让别处持有的引用立刻过期。这里用就地 `splice` 复现 `filter` 的语义。
 */
function dropFrom<T>(list: T[], value: T) {
  for (let index = list.length - 1; index >= 0; index -= 1) if (list[index] === value) list.splice(index, 1)
}

/**
 * 圆类实体的边界圆（"真圆"）用的颜色：与其它曲线同源，改一处即可（`primitiveStyle` 是真源）。
 */
const RIM_CURVE_COLOR = defaultStrokeFor({ id: "rim-curve", type: "edge3", pointIds: ["rim-a", "rim-b"] })

export interface ThreeSceneContentDeps {
  documentRef: ThreeSceneEffectDeps["documentRef"]
  selectedIdsRef: ThreeSceneEffectDeps["selectedIdsRef"]
  displayFlagsRef: ThreeSceneEffectDeps["displayFlagsRef"]
  previewsRef: ThreeSceneEffectDeps["previewsRef"]
  previewHoverKeyRef: ThreeSceneEffectDeps["previewHoverKeyRef"]
  previewHoverRef: ThreeSceneEffectDeps["previewHoverRef"]
  curveToleranceBucketRef: ThreeSceneEffectDeps["curveToleranceBucketRef"]
  circleRadiusPreviewRef: ThreeSceneEffectDeps["circleRadiusPreviewRef"]
  rotationHandleRef: ThreeSceneEffectDeps["rotationHandleRef"]
  trackRadiusHandleRef: ThreeSceneEffectDeps["trackRadiusHandleRef"]
  sceneSyncsRef: ThreeSceneEffectDeps["sceneSyncsRef"]
  cameraStateRef: ThreeSceneEffectDeps["cameraStateRef"]
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  sceneShell: HTMLDivElement | null
  viewportSize: () => { width: number; height: number }
  /**
   * 把点手柄按屏幕尺寸缩放。它住在 `./threeSceneRender` 里，所以那个工厂要先于本工厂调用 ——
   * 内容同步必须**先**缩放手柄再算包围盒与面片尺寸，否则同一份内容会算出偏小的包围盒
   *（实测：三点建平面 7.02 vs 7.11）。
   */
  syncPointHandleScales: () => void
  /** 下面这批是**跨阶段共享的稳定容器**（内容同步就地清空再填，别处长期持有）。 */
  pointHandles: THREE.Mesh[]
  visiblePointLabels: Point3Primitive[]
  measurementVisuals: NonNullable<ReturnType<typeof resolveMeasurementVisual>>[]
  previewGroups: Map<string, THREE.Group>
  previewByKey: Map<string, ThreeScenePreview>
  sceneBounds: THREE.Box3
  points: Map<string, Point3Primitive>
  topologyOwners: Map<string, string>
  objectIndex: Map<string, THREE.Object3D>
  grid: ThreeSceneGridHolder
}

/**
 * 建"内容同步"这一阶段：整场同步（`syncContent`）与"只重建一个点驱动对象"
 * （`refreshPrimitiveObject`，拖动绑定点时用）。
 *
 * 两者共用同一张记录表（`contentRecords`），所以拖完之后的整场同步不会把它当成"没见过的对象"再建一次。
 */
export function createThreeSceneContent({ documentRef, selectedIdsRef, displayFlagsRef, previewsRef, previewHoverKeyRef, previewHoverRef, curveToleranceBucketRef, circleRadiusPreviewRef, rotationHandleRef, trackRadiusHandleRef, sceneSyncsRef, cameraStateRef, scene, camera, sceneShell, viewportSize, syncPointHandleScales, pointHandles, visiblePointLabels, measurementVisuals, previewGroups, previewByKey, sceneBounds, points, topologyOwners, objectIndex, grid
 }: ThreeSceneContentDeps) {
    /**
     * 内容对象的记录表：key → { 对象, 签名 }。
     *
     * 以前这里是 `contentObjects: Object3D[]` + `clearContent()`：每次同步全清全建。
     * 现在按签名增量（`sceneContentPlan.ts` 定的规则）：签名没变就**沿用原对象**，
     * 只重建真的变了的那几个。展开动画过去每帧重建整场（内容签名里带 `unfoldProgress`），
     * 现在每帧只重建那张展开网。
     */
    const contentRecords = new Map<string, { object: THREE.Object3D; signature: string }>()
    /** 本次同步的重建/沿用/释放计数，写成 `data-scene-*` 读数（e2e 与排查都读它）。 */
    let syncCounts = { created: 0, reused: 0, removed: 0 }
    /** 本次同步重建了哪些 key：排查"为什么这个对象被重建了"时，比只数个数有用得多。 */
    let createdKeys: string[] = []
    /**
     * 取一个内容对象：签名没变就沿用原来的（连场景图里的位置都不动），否则重建它。
     * `build` 是惰性的——沿用的时候**不许**构造，否则省下的只是内存拷贝、白算的还是白算。
     */
    const keepContent = (key: string, signature: string, build: () => THREE.Object3D | null, alive: Set<string>, order: string[]): THREE.Object3D | null => {
      alive.add(key)
      if (!order.includes(key)) order.push(key)
      const previous = contentRecords.get(key)
      if (previous && previous.signature === signature) {
        syncCounts.reused += 1
        return previous.object
      }
      if (previous) {
        scene.remove(previous.object)
        disposeObject(previous.object)
        contentRecords.delete(key)
      }
      const object = build()
      if (!object) {
        // 这次没有这个对象（例如平面片退化）：算作释放，别把它记成"重建了一个"。
        if (previous) syncCounts.removed += 1
        return null
      }
      syncCounts.created += 1
      createdKeys.push(key)
      scene.add(object)
      contentRecords.set(key, { object, signature })
      return object
    }
    const syncContent = () => {
    sceneSyncsRef.current += 1
    /**
     * 本次同步"活着"的 key（`alive`）与它们在场景里的顺序（`order`）。
     *
     * 两者刻意分开：顺序只能由"实际构造的顺序"决定，而 `alive` 需要**提前**把
     * 平面片 / 预览 / 背景坐标系这些"后面才加进来"的 key 登记进去——否则释放过期对象时
     * 会把它们当成过期删掉、这一轮再重建一次（实测：每次同步都重建栅格与坐标轴）。
     */
    const alive = new Set<string>()
    const order: string[] = []
    syncCounts = { created: 0, reused: 0, removed: 0 }
    createdKeys = []
    pointHandles.length = 0
    visiblePointLabels.length = 0
    measurementVisuals.length = 0
    /** 解析曲线（真圆 / 圆锥曲线）的画布读数：个数与总段数。 */
    let exactCurveCount = 0
    let exactCurveSegments = 0
    /** 圆类实体的边界圆（真圆）条数。 */
    let rimCurveCount = 0
    /** 已创建交面的填充三角形总数（曲面区域按屏幕误差细分：放大时它会长大）。 */
    let faceTriangles = 0
    previewGroups.clear()
    previewByKey.clear()
    objectIndex.clear()
    if (sceneShell) sceneShell.dataset.sceneSyncs = String(sceneSyncsRef.current)
    const document = documentRef.current
    const selectedIds = selectedIdsRef.current
    const { showHiddenEdges, showNormals, transparentFaces, unfoldProgress } = displayFlagsRef.current
    const signer = createContentSigner(document)
    /**
     * 曲线的屏幕误差容差（世界单位）：`0.5px × 世界单位每像素`，再量化成 2 的幂档做**滞回**——
     * 相机连续缩放时容差每帧都变，直接当签名会让曲线每帧重新采样；量化后跨过一档才重建。
     */
    // 档位经 ref 读（渲染器只建一次，这里是同一个闭包）；还没算过时按当前相机现算一次。
    const bucket = curveToleranceBucketRef.current
    const curveTolerance = bucket > 0 ? bucket : curveToleranceFor(camera, cameraStateRef.current.distance, viewportSize().height)
    const curveToleranceFlag = `tol:${toleranceBucket(curveTolerance)}`
    /**
     * 圆类实体的**边界圆**：解析圆按屏幕误差细分来画，落在圆上的那些可见棱（弦）不再逐段画——
     * 它们仍留在文档里（对象列表、拾取、面片要用），被选中时照旧画出来（选择反馈不能消失）。
     */
    const rimCircles = collectRimCircles(document)
    const rimChordIds = rimChordEdgeIds(document)
    points.clear()
    for (const primitive of document.primitives) if (primitive.type === "point3") points.set(primitive.id, primitive)
    topologyOwners.clear()
    for (const [id, owner] of templateTopologyOwners(document)) topologyOwners.set(id, owner)

    const unfoldedPolyhedra = unfoldProgress > 0.001
      ? document.primitives.filter((primitive): primitive is Polyhedron3Primitive => primitive.type === "polyhedron3" && primitive.visible !== false)
      : []
    const unfoldedChildIds = new Set(unfoldedPolyhedra.flatMap((polyhedron) => [...polyhedron.edgeIds, ...polyhedron.faceIds]))
    document.primitives.filter(isUserVisiblePrimitive).forEach((primitive) => {
      if (unfoldedChildIds.has(primitive.id)) return
      const selected = selectedIds.includes(primitive.id)
      // 边界圆上的弦由解析圆代替绘制（选中时例外：选择反馈必须看得见）。
      if (!selected && rimChordIds.has(primitive.id)) return
      // 空间圆的细分数跟着缩放走，所以它要把容差档写进签名（其余图元与缩放无关）。
      const flags = primitive.type === "circle3" ? `sel:${selected};${curveToleranceFlag}` : `sel:${selected}`
      const object = keepContent(`point:${primitive.id}`, signer.of(primitive.id, flags), () => buildPointDrivenObject(primitive, points, selected, curveTolerance), alive, order)
      if (!object) return
      if (primitive.type === "point3") pointHandles.push(object as THREE.Mesh)
      if (typeof object.userData.segmentCount === "number") {
        exactCurveCount += 1
        exactCurveSegments += object.userData.segmentCount
      }
      objectIndex.set(primitive.id, object)
    })

    visibleSolids(document).forEach((primitive) => {
      const selected = selectedIds.includes(primitive.id)
      const flags = `sel:${selected};hidden:${showHiddenEdges};normals:${showNormals};transparent:${transparentFaces};unfold:${unfoldProgress > 0.001 ? unfoldProgress.toFixed(4) : "0"}`
      keepContent(`solid:${primitive.id}`, signer.of(primitive.id, flags), () => createSolidGroup(primitive, selected, { showHiddenEdges, showNormals, transparentFaces, unfoldProgress }), alive, order)
    })
    rimCircles.forEach((entry) => {
      const selected = selectedIds.includes(entry.id)
      const group = keepContent(`rim:${entry.id}`, signer.of(entry.id, `rims:${entry.circles.length};${curveToleranceFlag}`), () => createRimCircles3(entry.id, entry.circles, curveTolerance, selected, RIM_CURVE_COLOR), alive, order)
      if (!group || typeof group.userData.segmentCount !== "number") return
      rimCurveCount += group.children.length
      exactCurveCount += 1
      exactCurveSegments += group.userData.segmentCount
    })
    document.primitives.filter((primitive): primitive is SectionPrimitive => primitive.type === "section" && primitive.visible !== false).forEach((primitive) => {
      const selected = selectedIds.includes(primitive.id)
      // 面片尺寸取自来源实体的**物化拓扑**：拓扑变了面片也得跟着重算，所以把拓扑签名一并带上。
      const topology = signer.topologyOf(primitive.sourceId)
      /**
       * 源是圆柱 / 圆锥时文档里带着**精确**圆锥曲线片段环（`section.exact`）：填充照旧用多边形
       *（面积与拾取要它），但边界改画真曲线，否则同一圈会出现两套边界——一套是弦、一套是真曲线。
       */
      const exactLoops = primitive.exact && primitive.exact.loops.length > 0 ? primitive.exact.loops : null
      const mesh = keepContent(`section:${primitive.id}`, signer.of(primitive.id, `topo:${topology};boundary:${exactLoops ? "exact" : "polygon"}`), () => createSectionMesh(primitive, { omitBoundary: Boolean(exactLoops) }), alive, order)
      if (!mesh) return
      if (exactLoops) {
        const curve = keepContent(`section-exact:${primitive.id}`, signer.of(primitive.id, `exact:${primitive.exact?.kind ?? "none"};${curveToleranceFlag}`), () => createCurveLoops3(primitive.id, exactLoops, curveTolerance, selected), alive, order)
        if (curve && typeof curve.userData.segmentCount === "number") {
          exactCurveCount += 1
          exactCurveSegments += curve.userData.segmentCount
        }
      }
      // 选中截面时把剖切面本身也画出来：只看到一圈交线的话，"刀口在哪、往哪边挪"都无从判断。
      if (!selected) return
      keepContent(`section-plane:${primitive.id}`, signer.of(primitive.id, `plane;topo:${topology}`), () => {
        const patch = createPlanePatch(primitive.plane, sectionSourceVertices(document, primitive.sourceId), { color: "#f97316", opacity: 0.1 })
        if (!patch) return null
        // 剖切面片只是"刀口在哪"的指示物，不能参与拾取：它又大又正对相机，否则点击/拖动都会命中它
        // 而不是截面本身（实测：拖它会平移面片，截面却没动）。
        patch.traverse((child) => { child.raycast = () => undefined })
        patch.userData.visualRole = "section-plane"
        return patch
      }, alive, order)
    })
    // 已持久化的截线：虚线，与"预览"用同一种视觉语言，但颜色更深、实心可选中。
    document.primitives.filter((primitive) => primitive.type === "intersectionLine" && primitive.visible !== false).forEach((primitive) => {
      if (primitive.type !== "intersectionLine") return
      keepContent(`intersection-line:${primitive.id}`, signer.of(primitive.id), () => {
        const points = primitive.segments.flatMap((segment) => [new THREE.Vector3(segment.a.x, segment.a.y, segment.a.z), new THREE.Vector3(segment.b.x, segment.b.y, segment.b.z)])
        if (points.length < 2) return null
        const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: primitive.style?.stroke ?? "#dc2626", dashSize: 0.3, gapSize: 0.2 }))
        line.computeLineDistances()
        line.userData.primitiveId = primitive.id
        line.userData.primitiveType = primitive.type
        line.userData.visualRole = "intersection-line"
        return line
      }, alive, order)
    })
    // 已创建的交面：**一个支撑曲面区域**（填色可改，曲面区域按环向条带填充）；已创建的交点：交线的拐点。
    document.primitives.filter((primitive): primitive is IntersectionFacePrimitive => primitive.type === "intersectionFace" && primitive.visible !== false).forEach((primitive) => {
      const selected = selectedIds.includes(primitive.id)
      /**
       * 文档里带着解析边界（`exactLoops`：圆柱 / 圆锥区域的两圈圆弧）时，边界画成**真曲线**；
       * 带着解析曲面（`surface`）时，填充也按屏幕误差细分并吸回真正的曲面上（画成光滑曲面）。
       * 两者都要跟着缩放走——容差档必须进签名，否则放大后还是旧的细分。
       */
      const analyticBoundary = Boolean(primitive.exactLoops && primitive.exactLoops.length > 0)
      const analyticSurface = primitive.surface !== undefined
      const flags = `sel:${selected};boundary:${analyticBoundary || analyticSurface ? `exact;${curveToleranceFlag}` : "polygon"}`
      const face = keepContent(`intersection-face:${primitive.id}`, signer.of(primitive.id, flags), () => createIntersectionFaceGroup(primitive, selected, curveTolerance), alive, order)
      if (face && typeof face.userData.segmentCount === "number") {
        exactCurveCount += 1
        exactCurveSegments += face.userData.segmentCount
      }
      if (face && typeof face.userData.triangleCount === "number") faceTriangles += face.userData.triangleCount
    })
    document.primitives.filter((primitive): primitive is IntersectionPoint3Primitive => primitive.type === "intersectionPoint3" && primitive.visible !== false).forEach((primitive) => {
      const marker = keepContent(`intersection-point:${primitive.id}`, signer.of(primitive.id, `sel:${selectedIds.includes(primitive.id)}`), () => createIntersectionPointGroup(primitive, selectedIds.includes(primitive.id)), alive, order)
      // 与空间点手柄一起按屏幕尺寸缩放：远看近看都一样大、都好点。
      if (marker instanceof THREE.Mesh) pointHandles.push(marker)
    })
    // 已创建的交面（整体）：布尔交集的多面体表面（旧文档里可能存在，仍然要画得出来）。
    document.primitives.filter((primitive): primitive is IntersectionSolidPrimitive => primitive.type === "intersectionSolid" && primitive.visible !== false).forEach((primitive) => {
      keepContent(`intersection-solid:${primitive.id}`, signer.of(primitive.id, `sel:${selectedIds.includes(primitive.id)}`), () => createIntersectionSolidGroup(primitive, selectedIds.includes(primitive.id)), alive, order)
    })
    let unfoldFaceCount = 0
    unfoldedPolyhedra.forEach((polyhedron) => {
      const topology = resolvePolyhedronTopology(document, polyhedron.id)
      if (!topology) return
      const layout = unfoldPolyhedron3(topology.vertices, topology.faces, unfoldProgress, topology.rootFaceId)
      if (layout.status !== "ok") return
      keepContent(`unfold:${polyhedron.id}`, signer.of(polyhedron.id, `unfold:${unfoldProgress.toFixed(4)};sel:${selectedIds.includes(polyhedron.id)}`), () => createUnfoldNetGroup(polyhedron.id, layout, selectedIds.includes(polyhedron.id)), alive, order)
      unfoldFaceCount += layout.faces.length
    })
    // 3D point labels: an HTML overlay above the canvas, so the classroom names A/B/C stay readable at any zoom.
    // The overlay never receives pointer events, so picking still goes through the renderer.
    visiblePointLabels.length = 0
    visiblePointLabels.push(...document.primitives.filter((primitive): primitive is Point3Primitive => primitive.type === "point3" && isUserVisiblePrimitive(primitive)))
    let dihedralMarkerCount = 0
    let planeCount = 0
    document.measurements
      .filter((measurement) => measurement.metric === "dihedral" && measurement.status === "valid" && measurement.sourceIds.some((id) => selectedIds.includes(id)))
      .forEach((measurement) => {
        const marker = resolveDihedralMarker3(document, measurement.id)
        if (!marker) return
        const allSelected = measurement.sourceIds.every((id) => selectedIds.includes(id))
        keepContent(`dihedral:${measurement.id}`, signer.ofReferences(measurement.sourceIds, `dihedral:${JSON.stringify(measurement)};sel:${allSelected}`), () => createDihedralMarkerGroup(marker, allSelected), alive, order)
        dihedralMarkerCount += 1
      })
    /**
     * 测量数字**常驻画布**：不再要求"来源被选中"。
     *
     * 用户口径："我希望数学测量的结果能在图中浮现一个数字，而不是非要去看右侧属性栏（这一点无论是平面几何
     * 还是立体几何都要优化）。" `resolveMeasurementVisual` 自己就会挡住"退化 / 数据不足 / 值非有限"的情况，
     * 所以这里不再额外过滤——**不画假数字**这条规则在那一层（有单测）。
     *
     * 但**辅助线与二面角标记仍按选中显示**：那是引导线，几十条一起铺会把画布刷满，
     * 而数字本身才是用户要的东西。
     */
    measurementVisuals.length = 0
    measurementVisuals.push(...measurementVisualsForDocument(document))
    measurementVisuals.filter((visual) => visual.kind === "label" && visual.sourceIds.some((id) => selectedIds.includes(id))).forEach((visual) => {
      const measurement = document.measurements.find((candidate) => candidate.id === visual.id)
      const signature = signer.ofReferences(measurement?.sourceIds ?? [], `visual:${JSON.stringify(visual)}`)
      visual.segments.forEach((segment, index) => {
        keepContent(`measurement-helper:${visual.id}:${index}`, signature, () => {
          const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(segment.start.x, segment.start.y, segment.start.z), new THREE.Vector3(segment.end.x, segment.end.y, segment.end.z)])
          const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#604fda", transparent: true, opacity: 0.75 }))
          line.userData.measurementId = visual.id
          line.userData.visualRole = "measurement-helper"
          return line
        }, alive, order)
      })
    })
    /**
     * 旋转手柄（三色环）：选中**恰好一个**可转对象时出现。
     *
     * 登记在释放循环之前，所以"取消选中 / 换了对象"时旧环会被正常释放；
     * 环本身带 `excludeFromFit` 且不挂 `primitiveId`，既不参与取景，也不会被偏移 / 临时旋转那些按 id 遍历的逻辑碰到。
     */
    const rotationTargetId = rotationHandleTarget(document, selectedIds)
    const rotationGeometry = rotationTargetId ? rotationHandleGeometry(document, rotationTargetId) : null
    const rotationGroup = rotationGeometry
      ? keepContent(
        "rotation-handles",
        `target:${rotationTargetId};c:${rotationGeometry.center.x.toFixed(4)},${rotationGeometry.center.y.toFixed(4)},${rotationGeometry.center.z.toFixed(4)};r:${rotationGeometry.radius.toFixed(4)}`,
        () => createRotationHandles(rotationGeometry.center, rotationGeometry.radius),
        alive,
        order
      ) as THREE.Group | null
      : null
    rotationHandleRef.current = rotationGroup && rotationTargetId && rotationGeometry
      ? { id: rotationTargetId, center: rotationGeometry.center.clone(), radius: rotationGeometry.radius, group: rotationGroup }
      : null

    /**
     * **半径手柄**（缩放）：选中恰好一个轨道圆时出现，画在圆周上（宿主参数 0 处）并带一条虚线半径。
     * 与旋转环同样的登记时机（释放循环之前），所以取消选中 / 换对象时它会被正常释放。
     */
    const trackPrimitive = rotationTargetId ? document.primitives.find((primitive) => primitive.id === rotationTargetId) : undefined
    const track = trackPrimitive?.type === "circle3" ? trackPrimitive : null
    const trackRadiusGroup = track
      ? keepContent(
        "track-radius-handle",
        `target:${track.id};c:${track.center.x.toFixed(4)},${track.center.y.toFixed(4)},${track.center.z.toFixed(4)};n:${track.normal.x.toFixed(4)},${track.normal.y.toFixed(4)},${track.normal.z.toFixed(4)};r:${track.radius.toFixed(4)}`,
        () => createTrackRadiusHandle(track.center, track.normal, track.radius),
        alive,
        order
      ) as THREE.Group | null
      : null
    trackRadiusHandleRef.current = trackRadiusGroup && track
      ? { id: track.id, radius: track.radius, group: trackRadiusGroup, point: (trackRadiusGroup.userData.handlePoint as THREE.Vector3 | undefined) ?? new THREE.Vector3() }
      : null

    /**
     * 先登记"后面几个阶段才会加进来"的 key，再释放过期对象。
     *
     * 顺序很关键：沿用的对象还留在场景里，而"上一份文档"的残留对象如果拖到后面才释放，
     * 就会参与 `contentBounds` 的计算——实测打开新文件时相机取景会偏（target 0.48 而不是 0.50）。
     * 但平面片 / 预览 / 背景坐标系要到下面几步才加进来，不先登记就会被误删再重建
     *（实测：每次同步都重建栅格与坐标轴）。
     */
    alive.add("static:grid")
    alive.add("static:grid-major")
    alive.add("static:axes")
    for (const item of previewsRef.current) {
      if (hasDrawablePreview(item)) alive.add(`preview:${item.key}`)
    }
    for (const primitive of document.primitives) {
      if (primitive.type === "plane3" && primitive.visible !== false) alive.add(`plane:${primitive.id}`)
    }
    for (const [key, record] of contentRecords) {
      if (alive.has(key)) continue
      scene.remove(record.object)
      disposeObject(record.object)
      contentRecords.delete(key)
      syncCounts.removed += 1
    }
    // Planes are drawn last: their patch is sized from the figure they belong to, so the figure must exist first.
    /**
     * 先把手柄按屏幕尺寸缩放**再**算包围盒：手柄的世界半径取决于相机距离，而
     * 内容包围盒（相机取景）与面片自动尺寸都把它算在内。刚建出来的手柄还是初始尺寸，
     * 不先缩放就会在同一份内容上算出偏小的包围盒（实测：三点建平面 7.02 vs 7.11）。
     */
    syncPointHandleScales()
    // 面片尺寸要排除平面片自身：旧面片在"沿用"时还在场景里，算进去会自我膨胀
    //（实测：手动半边长恢复自动之后，7.02 变成了 36.21）。
    const contentRadius = contentRadiusExcluding(scene, [...contentRecords].filter(([key]) => key.startsWith("plane:")).map(([, record]) => record.object))
    const planeHalfSize = Math.max(Math.min(contentRadius * 1.6, 60), 1.2)
    document.primitives.filter((primitive): primitive is Plane3Primitive => primitive.type === "plane3" && primitive.visible !== false).forEach((primitive) => {
      const plane = keepContent(`plane:${primitive.id}`, signer.of(primitive.id, `sel:${selectedIds.includes(primitive.id)};half:${planeHalfSize.toFixed(3)}`), () => createPlane3Mesh(primitive, points, selectedIds.includes(primitive.id), planeHalfSize), alive, order)
      if (!plane) return
      planeCount += 1
    })
    /**
     * 预览层最后加入：盖在实体之上，但仍用虚线 / 半透明表达"还没创建"。
     * 每一份预览按自己的 key 增量同步——改了其中一个实体，只有与它相关的那几份重建。
     */
    const previews = previewsRef.current.filter(hasDrawablePreview)
    for (const item of previews) {
      /**
       * 曲面交面的预览也要跟着缩放走：它的填充按屏幕误差吸到真正的曲面上，容差档必须进签名。
       * 平面区域没有 `surface`，不进签名——否则每次缩放都会白重建一遍全部预览。
       */
      const smoothPreview = item.surface !== undefined
      const flags = `kind:${item.kind};${smoothPreview ? `tol:${toleranceBucket(curveTolerance)};` : ""}${JSON.stringify(item)}`
      const group = keepContent(`preview:${item.key}`, flags, () => createPreviewGroup(item, previewHoverKeyRef.current === item.key, (hovering) => previewHoverRef.current?.(hovering, item), curveTolerance), alive, order)
      if (!group) continue
      previewGroups.set(item.key, group as THREE.Group)
      previewByKey.set(item.key, item)
    }
    // 悬停的那一份可能已经不存在了（来源被删 / 挪开）：清掉高亮状态，别让读数指向空气。
    if (previewHoverKeyRef.current && !previewGroups.has(previewHoverKeyRef.current)) previewHoverKeyRef.current = null
    if (sceneShell) {
      const focused = previews.find((item) => item.focused) ?? null
      sceneShell.dataset.intersectionPreview = focused ? focused.kind : "none"
      sceneShell.dataset.previewCount = String(previews.length)
      sceneShell.dataset.previewFaceCount = String(previews.filter((item) => item.kind === "face").length)
      sceneShell.dataset.previewPointCount = String(previews.filter((item) => item.kind === "point").length)
      sceneShell.dataset.previewLineCount = String(previews.filter((item) => item.kind === "intersection").length)
      sceneShell.dataset.previewKeys = previews.map((item) => item.key).join(",")
      sceneShell.dataset.previewHoverKey = previewHoverKeyRef.current ?? ""
      sceneShell.dataset.unfoldFaces = String(unfoldFaceCount)
      sceneShell.dataset.unfoldProgress = unfoldProgress.toFixed(2)
      sceneShell.dataset.dihedralMarkers = String(dihedralMarkerCount)
      sceneShell.dataset.planeCount = String(planeCount)
      sceneShell.dataset.measurementLabelCount = String(measurementVisuals.length)
      // 常驻测量数字的条数（`data-measurement-labels` 是这一条的正式名字，`…LabelCount` 保留给旧断言）。
      sceneShell.dataset.measurementLabels = String(measurementVisuals.length)
      // 剖切面的读数：剖面有没有真的动、动到哪，靠这几个数看，不靠肉眼。
      const sections = document.primitives.filter((primitive): primitive is SectionPrimitive => primitive.type === "section")
      const firstSection = sections[0]
      sceneShell.dataset.sectionCount = String(sections.length)
      sceneShell.dataset.sectionPlaneConstant = firstSection ? firstSection.plane.constant.toFixed(3) : ""
      sceneShell.dataset.sectionPlaneNormal = firstSection ? `${firstSection.plane.normal.x.toFixed(3)},${firstSection.plane.normal.y.toFixed(3)},${firstSection.plane.normal.z.toFixed(3)}` : ""
      sceneShell.dataset.sectionPointCount = firstSection ? String(firstSection.points.length) : ""
      // 解析曲线的读数：截面是不是真圆、真曲线的细分点有多少——"放大不看出棱"靠这两个数断言。
      sceneShell.dataset.sectionExactKind = firstSection?.exact?.kind ?? ""
      sceneShell.dataset.sectionExactStatus = firstSection?.status ?? ""
      sceneShell.dataset.exactCurves = String(exactCurveCount)
      sceneShell.dataset.exactCurveSegments = String(exactCurveSegments)
      sceneShell.dataset.rimCurves = String(rimCurveCount)
      // 交面填充的三角形总数：曲面区域按屏幕误差细分，放大时它必须变大（"曲面不是由几个三角形拼的"）。
      sceneShell.dataset.faceTriangles = String(faceTriangles)
      /**
       * 旋转手柄的读数：有几个环、环心与半径（e2e 要靠这两个数算出"环上某个世界点"再拖它，
       * 而不是写死像素偏移），以及本次拖动正在绕哪根轴、转了多少度。
       */
      sceneShell.dataset.rotationHandles = String(rotationGroup?.children.length ?? 0)
      sceneShell.dataset.rotationHandlePivot = rotationGeometry
        ? `${rotationGeometry.center.x.toFixed(3)},${rotationGeometry.center.y.toFixed(3)},${rotationGeometry.center.z.toFixed(3)}`
        : ""
      sceneShell.dataset.rotationHandleRadius = rotationGeometry ? rotationGeometry.radius.toFixed(3) : ""
      /** 轨道圆半径读数：拖动期间给**预览值**，所以 e2e 能断言"拖着的时候半径已经变了"。 */
      sceneShell.dataset.trackRadius = track
        ? (circleRadiusPreviewRef.current?.id === track.id ? circleRadiusPreviewRef.current.radius : track.radius).toFixed(4)
        : ""
      /**
       * 半径手柄的**世界坐标**。宿主参数 0 落在哪个方向由 `circleHost3` 自己的帧决定
       * （法向 +z 时它是 −y，不是 +x），所以 e2e 不该去猜——把这个点交出来，与旋转环交出
       * `data-rotation-handle-pivot` 是同一个理由。
       */
      const handlePoint = trackRadiusHandleRef.current?.point
      sceneShell.dataset.trackHandle = handlePoint ? `${handlePoint.x.toFixed(3)},${handlePoint.y.toFixed(3)},${handlePoint.z.toFixed(3)}` : ""
    }

    sceneBounds.copy(contentBounds(scene))
    if (sceneShell) {
      const size = sceneBounds.getSize(new THREE.Vector3())
      const centre = sceneBounds.getCenter(new THREE.Vector3())
      sceneShell.dataset.contentBounds = sceneBounds.isEmpty() ? "empty" : `${centre.x.toFixed(2)},${centre.y.toFixed(2)},${centre.z.toFixed(2)} size ${size.x.toFixed(2)},${size.y.toFixed(2)},${size.z.toFixed(2)}`
    }
    // Grid and axes follow the figure, but the grid's **cell is always one world unit**:
    // 用户要求"网格大小要严格对应一比一"，所以缩放的只是覆盖范围，不是格边长。
    /** 背景坐标系：1 单位细线 + 每 10 格主线；两者都只在覆盖半径跨档时换一份几何。 */
    grid.helper = keepContent("static:grid", "grid", () => {
      const grid = new THREE.LineSegments(
        buildGridGeometry(GRID_MIN_RADIUS, { skipMultiplesOf: GRID_MAJOR_EVERY }),
        new THREE.LineBasicMaterial({ color: GRID_MINOR_COLOR, transparent: true })
      )
      grid.userData.excludeFromFit = true
      return grid
    }, alive, order) as THREE.LineSegments | null
    grid.majorHelper = keepContent("static:grid-major", "grid-major", () => {
      const major = new THREE.LineSegments(
        buildGridGeometry(GRID_MIN_RADIUS, { every: GRID_MAJOR_EVERY }),
        new THREE.LineBasicMaterial({ color: GRID_MAJOR_COLOR, transparent: true })
      )
      major.userData.excludeFromFit = true
      return major
    }, alive, order) as THREE.LineSegments | null
    // grid.axes already draws X/Y/Z along the world axes, so blue points up once Z is the vertical axis.
    grid.axes = keepContent("static:axes", "axes", () => {
      const axes = new THREE.AxesHelper(1)
      axes.userData.excludeFromFit = true
      return axes
    }, alive, order) as THREE.AxesHelper | null

    /**
     * 内容顺序必须跟着本次同步的顺序走：被沿用的对象还停在原来的位置，新对象却追加在末尾。
     * 顺序乱了会让透明面的叠加次序与同一射线上的命中排序跟着变，所以只在真的不一致时才重排。
     * 这里同时补一次过期对象的清理：上面"先登记后释放"是为包围盒服务的，
     * 若某个已登记的 key 最终没能构造出对象（例如平面片退化），它的旧记录要在这里收掉。
     */
    for (const [key, record] of contentRecords) {
      if (alive.has(key)) continue
      scene.remove(record.object)
      disposeObject(record.object)
      contentRecords.delete(key)
      syncCounts.removed += 1
    }
    const desired = order.flatMap((key) => {
      const record = contentRecords.get(key)
      return record ? [record.object] : []
    })
    const orderMatches = scene.children.length === desired.length && desired.every((object, index) => scene.children[index] === object)
    if (!orderMatches) {
      for (const object of desired) scene.remove(object)
      for (const object of desired) scene.add(object)
    }
    if (sceneShell) {
      sceneShell.dataset.sceneCreated = String(syncCounts.created)
      sceneShell.dataset.sceneReused = String(syncCounts.reused)
      sceneShell.dataset.sceneRemoved = String(syncCounts.removed)
      sceneShell.dataset.sceneContent = String(contentRecords.size)
      sceneShell.dataset.sceneCreatedKeys = createdKeys.join(",")
    }
    }
    /**
     * 只重建**一个**点驱动对象：拖动绑定点时用它让下游实时跟随。
     * 位置已经在 `points` 里按新参数写好，所以这里不需要重建整场、也不进撤销历史。
     * 走的是与整场同步同一张记录表，所以拖完之后的整场同步不会把它当成"没见过的对象"再建一次。
     */
    const refreshPrimitiveObject = (id: string) => {
      const found = documentRef.current.primitives.find((candidate) => candidate.id === id)
      if (!found) return
      /**
       * 缩放预览：拖动期间文档不提交，所以半径从 `circleRadiusPreviewRef` 取。
       * 只影响这一个对象的**画面**，`documentRef.current` 一个字都不动（抬手才提交）。
       */
      const preview = circleRadiusPreviewRef.current
      const primitive = preview && preview.id === id && found.type === "circle3" ? { ...found, radius: preview.radius } : found
      const previous = objectIndex.get(id)
      const selected = selectedIdsRef.current.includes(id)
      const tolerance = curveToleranceBucketRef.current > 0
        ? curveToleranceBucketRef.current
        : curveToleranceFor(camera, cameraStateRef.current.distance, viewportSize().height)
      const replacement = buildPointDrivenObject(primitive, points, selected, tolerance)
      if (previous) {
        scene.remove(previous)
        disposeObject(previous)
        if (previous instanceof THREE.Mesh) dropFrom(pointHandles, previous)
      }
      if (!replacement) {
        contentRecords.delete(`point:${id}`)
        objectIndex.delete(id)
        return
      }
      scene.add(replacement)
      contentRecords.set(`point:${id}`, { object: replacement, signature: createContentSigner(documentRef.current).of(id, `sel:${selected}`) })
      objectIndex.set(id, replacement)
      if (replacement instanceof THREE.Mesh && primitive.type === "point3") pointHandles.push(replacement)
    }
    return { syncContent, refreshPrimitiveObject }
}
