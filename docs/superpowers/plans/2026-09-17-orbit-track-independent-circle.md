# 轨道圆：独立空间圆 + 画布缩放（实施计划）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `circle3` 从"引用一个点当圆心"改成**自带圆心坐标的独立空间圆**，并让它在画布上能拖本体平移、拖半径手柄缩放、拖三色环旋转。

**Architecture:** 先改数据模型的字段（`centerId` → `center`）并补一条加载时迁移，再把 `circle3` 在场景图里从"点驱动对象"重分类为"自带几何的对象"（平移改 `center`、旋转改 `normal`、圆心点不再被引用保护），最后在画布上加一个半径手柄与一条"拖动中不改文档"的预览链路。每片的门禁都必须绿：类型改了却不改调用点会直接编译不过，所以**模型与全部调用点必须在同一片里**。

**Tech Stack:** TypeScript + npm workspaces（`packages/dsl`、`packages/geometry-kernel`、`packages/scene-graph`、`apps/web`）、React 19 + three.js 0.186、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-17-orbit-track-independent-circle-design.md`（本计划从该 spec 推导，执行者两份都要读）

## Global Constraints

- 不新增任何运行时依赖。
- `packages/*` 的模型层**不许 import three.js**（three.js 只在 `apps/web` 里出现）。
- `.mgeo` 的 `schemaVersion` 保持 `"0.1"`，不强制升级用户文件；迁移在**反序列化时**做。
- 迁移必须发生在 `validateDocument` **之前**（`decodeMgeo` 对不合法文档是 `throw`，顺序反了旧文件会打不开）。
- 半径下限与属性栏一致：**0.01**；法向必须非零、坐标必须有限。
- 每个切片先写失败用例（RED，**贴真实失败输出**）再实现（GREEN）；每片跑全套门禁：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run lint`（0 error）、`npm run build --workspace @draw/web`、`npx playwright test`。
- 每片更新 `docs/project-progress.md` + `docs/feature-catalog.md`（必要时 README 基线），数字一律实测后回填；提交并推送，`git rev-parse HEAD` 与 `git ls-remote origin refs/heads/main` 两端核对。
- 仓库文件一律用编辑工具改（不要走 PowerShell 文本管道）；提交信息不带工具署名。

---

## 文件结构（谁负责什么）

| 文件 | 职责 |
| --- | --- |
| `packages/dsl/src/types.ts` | `Circle3Primitive` 的字段：`centerId` → `center` |
| `packages/dsl/src/schema.ts` | `circle3` 的校验：圆心有限、法向非零、半径正 |
| `packages/dsl/src/codec.ts` | 旧文档归一化 `withCircleTrackCenter`（校验前） |
| `packages/geometry-kernel/src/quadrics.ts` | `conic3FromCircle3(primitive)`：不再需要点表 |
| `packages/geometry-kernel/src/hosts3.ts` | `host3FromPrimitive` 的 `circle3` 分支读 `center` |
| `packages/scene-graph/src/operations.ts` | 平移 / 旋转 / 依赖 / `managedPointIds` / `isFreeDraggable3` |
| `packages/scene-graph/src/patches.ts` | 删掉 `circle3.centerId` 的引用保护 |
| `apps/web/src/threePrimitives.ts` | `createCircle3Line`（去掉点表）+ 半径手柄与虚线半径 |
| `apps/web/src/threeDrag.ts` | 轨道的环几何 + 半径拖动的纯数学 |
| `apps/web/src/threeScene.tsx` | 手柄的创建 / 命中 / 拖动预览 / 提交 / 读数 |
| `apps/web/src/components/PropertiesBar.tsx` | 圆心 X/Y/Z 变成可编辑字段 |
| `apps/web/src/App.tsx` | 创建入口：取一次坐标就脱钩 |
| `apps/web/src/persistence/exporters.ts` | 几何摘要里 `centerId` → `center` |

---

## Slice 1：圆自带圆心（模型 + 全部调用点 + 旧文档迁移）**（已完成，提交 `5f9f1f5` 前的本地工作）**

**交付物**：`circle3` 不再引用点——拖圆心点圆不动、拖圆才移动圆、圆心点可以删；检查器能改圆心；旧 `.mgeo` 与 localStorage 草稿照常打开。

**实测结果**：RED 三条全部真跑出来（`Invalid geometry document: circle3 geometry is invalid` / `expected false to be true` / `Cannot read properties of null (reading 'center')`）；实现后单测 **121 文件 / 1427 用例**、lint 0 error / 14 warning、Playwright **105/105**。**顺带修掉一个真缺陷**：`circleConic3` 会把零法向兜成 +z，`conic3FromCircle3` 现在显式挡住它。**一处流程失误**：改 `patches.test.ts` 时用 PowerShell 文本替换把中文注释写坏了，已 `git checkout` 还原并用编辑工具重做。

**Files:**
- Modify: `packages/dsl/src/types.ts:165-171`、`packages/dsl/src/schema.ts:298-300`、`packages/dsl/src/codec.ts:79-113`
- Modify: `packages/geometry-kernel/src/quadrics.ts:491-494`、`packages/geometry-kernel/src/hosts3.ts:520-521`
- Modify: `packages/scene-graph/src/operations.ts:265-275, 295-317, 324-333, 351-370, 430-440`、`packages/scene-graph/src/patches.ts:108-119`
- Modify: `apps/web/src/App.tsx:806-833`、`apps/web/src/components/PropertiesBar.tsx:355-358, 670-685`、`apps/web/src/threePrimitives.ts:379-390, 907`、`apps/web/src/threeDrag.ts:240-255`、`apps/web/src/projectionVisuals.ts:206, 291-300`、`apps/web/src/persistence/exporters.ts:128`
- Test: `packages/dsl/src/codec.test.ts`、`packages/dsl/src/schema.test.ts`（若无则新建）、`packages/geometry-kernel/src/quadrics.test.ts`、`packages/geometry-kernel/src/hosts3.test.ts`、`packages/geometry-kernel/src/measurements3d.test.ts`、`packages/scene-graph/src/operations.test.ts`、`packages/scene-graph/src/patches.test.ts`、`apps/web/src/App.test.tsx`、`apps/web/src/pointHostOptions.test.ts`、`apps/web/src/projectionVisuals.test.ts`、`apps/web/src/spatialTools.test.ts`、`apps/web/src/threeRotation.test.ts`、`apps/web/src/threeScene.test.ts`
- Test（新）: `e2e/three-orbit-track-independent.spec.ts`

**Interfaces:**
- Produces（后一片要用）：
  - `Circle3Primitive = { id: string; type: "circle3"; center: Vector3; normal: Vector3; radius: number }`
  - `conic3FromCircle3(primitive: Extract<PrimitiveSpec, { type: "circle3" }>): Conic3 | null`（**不再有点表参数**）
  - `createCircle3Line(primitive, tolerance: number, selected: boolean): THREE.Line | null`
- Consumes：`circleHost3(center, normal, radius)`（既有，签名不变）

- [ ] **Step 1: 改类型与校验，先让编译失败暴露全部调用点**

```ts
// packages/dsl/src/types.ts
export interface Circle3Primitive extends PrimitivePresentation {
  id: string
  type: "circle3"
  /** 圆心坐标**自己存**：圆是独立对象，不再引用任何点。 */
  center: Vector3
  normal: Vector3
  radius: number
}
```

```ts
// packages/dsl/src/schema.ts（替换原 centerId 那一条）
if (type === "circle3") {
  if (!isFiniteVector3(value.center) || !isNonZeroVector3(value.normal) || !isFiniteNumber(value.radius) || value.radius <= 0) errors.push("circle3 geometry is invalid")
}
```

- [ ] **Step 2: 写 RED 用例（先跑，贴真实失败输出）**

`packages/scene-graph/src/operations.test.ts`（把原来那条"平移圆轨道 = 移动圆心点"换成下面这条）：

```ts
it("moves a circle track by moving its own centre, and leaves points alone", () => {
  const document = createEmptyDocument("geometry3d")
  document.primitives = [
    { id: "p-centre", type: "point3", position: { x: 1, y: 2, z: 3 }, binding: { kind: "free" } },
    { id: "orbit-1", type: "circle3", center: { x: 1, y: 2, z: 3 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 }
  ]
  const moved = commitPatch(document, { op: "translatePrimitive3", id: "orbit-1", delta: { x: 0, y: -1, z: 4 } })
  expect(moved.changed).toBe(true)
  expect((moved.document.primitives.find((p) => p.id === "orbit-1") as { center: Vector3 }).center).toEqual({ x: 1, y: 1, z: 7 })
  // 圆不再引用任何点：拖圆不会动点。
  expect(positionOf(moved.document, "p-centre")).toEqual({ x: 1, y: 2, z: 3 })
})

it("lets the former centre point be deleted, because the track no longer references it", () => {
  const document = createEmptyDocument("geometry3d")
  document.primitives = [
    { id: "p-centre", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } },
    { id: "orbit-1", type: "circle3", center: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 }
  ]
  const deleted = commitPatch(document, { op: "deleteObject", id: "p-centre" })
  expect(deleted.changed).toBe(true)
  expect(deleted.document.primitives.some((p) => p.id === "orbit-1")).toBe(true)
})

it("turns a circle track's normal without moving its centre", () => {
  const rotated = commitPatch(trackDocument(), { op: "rotatePrimitive3", id: "orbit-1", axis: "z", degrees: 90 })
  const track = rotated.document.primitives.find((p) => p.id === "orbit-1") as { center: Vector3; normal: Vector3 }
  expect(track.center).toEqual({ x: 1, y: 2, z: 3 })
  expect(track.normal.y).toBeCloseTo(1, 12)
})
```

`packages/dsl/src/codec.test.ts`：

```ts
it("migrates a legacy circle track that referenced a point", () => {
  const legacy = JSON.stringify({ schemaVersion: "0.1", workspace: "geometry3d", primitives: [
    { id: "point-a", type: "point3", position: { x: 1, y: 2, z: 3 } },
    { id: "orbit-1", type: "circle3", centerId: "point-a", normal: { x: 0, y: 0, z: 1 }, radius: 2 }
  ] })
  const document = decodeMgeo(legacy)
  const track = document.primitives.find((p) => p.id === "orbit-1") as { center?: Vector3; centerId?: string }
  expect(track.center).toEqual({ x: 1, y: 2, z: 3 })
  expect("centerId" in track).toBe(false)
  // 幂等：再解一次不变。
  expect(decodeMgeo(encodeMgeo(document)).primitives.find((p) => p.id === "orbit-1")).toMatchObject({ center: { x: 1, y: 2, z: 3 } })
})

it("drops only the track whose centre point is missing, keeping the rest of the file loadable", () => {
  const legacy = JSON.stringify({ schemaVersion: "0.1", workspace: "geometry3d", primitives: [
    { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } },
    { id: "orbit-broken", type: "circle3", centerId: "gone", normal: { x: 0, y: 0, z: 1 }, radius: 2 }
  ] })
  const document = decodeMgeo(legacy)
  expect(document.primitives.map((p) => p.id)).toEqual(["point-a"])
})
```

`apps/web/src/threeRotation.test.ts`（守"环不会静默消失"这个坑）：

```ts
it("still gives a circle track its rotation rings after the model change", () => {
  const spec = rotationHandleGeometry(trackDocument(), "orbit-1")!
  expect(spec.center.x).toBeCloseTo(1, 12)
  expect(spec.center.y).toBeCloseTo(2, 12)
  expect(spec.radius).toBeGreaterThan(2)
})
```

- [ ] **Step 3: 跑用例确认全是红的**

Run: `npx.cmd vitest run packages/scene-graph/src/operations.test.ts packages/dsl/src/codec.test.ts apps/web/src/threeRotation.test.ts`
Expected: 编译/断言失败（`center` 不是 `Circle3Primitive` 的字段；`rotationHandleGeometry` 对轨道返回 `null`）

- [ ] **Step 4: 内核两处改成读 `center`**

```ts
// packages/geometry-kernel/src/quadrics.ts（签名去掉 points；返回值语义不变）
export function conic3FromCircle3(primitive: Extract<PrimitiveSpec, { type: "circle3" }>): Conic3 | null {
  if (!isFiniteVector(primitive.center) || !isFiniteVector(primitive.normal) || !(primitive.radius > 0)) return null
  return circleConic3(primitive.center, primitive.normal, primitive.radius)
}
```

```ts
// packages/geometry-kernel/src/hosts3.ts（circle3 分支）
if (primitive.type === "circle3") return circleHost3(primitive.center, primitive.normal, primitive.radius)
```

- [ ] **Step 5: codec 加迁移（**必须在校验之前**）**

```ts
/**
 * 旧文档的 `circle3` 存的是 `centerId`（引用一个点当圆心）。圆改成自带圆心之后，这里在校验**之前**
 * 把坐标搬过来：顺序反了旧文件会因为"字段不合法"直接打不开（`decodeMgeo` 对不合法文档是 throw）。
 * 引用的点不存在时**丢掉这一条轨道**——宁可少一条，也不能让整份文件打不开。
 */
function withCircleTrackCenter(primitives: unknown): unknown {
  if (!Array.isArray(primitives)) return primitives
  const positions = new Map<string, unknown>()
  for (const primitive of primitives) {
    const point = primitive as { id?: unknown; type?: unknown; position?: unknown } | null
    if (point && typeof point === "object" && point.type === "point3" && typeof point.id === "string") positions.set(point.id, point.position)
  }
  const migrated: unknown[] = []
  for (const primitive of primitives) {
    const track = primitive as { type?: unknown; centerId?: unknown; center?: unknown } | null
    if (!track || typeof track !== "object" || track.type !== "circle3" || track.center !== undefined) { migrated.push(primitive); continue }
    const center = typeof track.centerId === "string" ? positions.get(track.centerId) : undefined
    if (center === undefined) continue
    const { centerId: _legacy, ...rest } = track as Record<string, unknown>
    migrated.push({ ...rest, center })
  }
  return migrated
}
```

接线（`decodeMgeo` 里 `primitives` 那一行）：`primitives: withCircleTrackCenter(withSectionClassification((rawCandidate as { primitives?: unknown }).primitives))`

- [ ] **Step 6: 场景图重分类（自带几何对象）**

```ts
// operations.ts
if (primitive.type === "circle3") return { primitive: { ...primitive, center: shiftedPoint(primitive.center, delta) }, movedIds: [primitive.id] }   // translatePrimitive3
if (primitive.type === "circle3") return true                                                                                                        // isFreeDraggable3（在点驱动名单之前判断）
// managedPointIds：删掉 circle3 那一行；primitiveDependencies：删掉 dependencies.push(primitive.centerId)
// rotatePrimitive3：在"模板实体"分支之后加
if (primitive.type === "circle3") {
  const target = pivot ?? primitive.center
  return { primitive: { ...primitive, center: rotatePointAboutAxis3(primitive.center, target, axis, radians), normal: rotateVectorAboutAxis3(primitive.normal, axis, radians) }, movedPoints: [] }
}
```

```ts
// packages/scene-graph/src/patches.ts：isReferenced 里删掉这一条（圆不再引用点）
|| (primitive.type === "circle3" && primitive.centerId === id)   // ← 删除
```

- [ ] **Step 7: web 侧调用点**

- `threePrimitives.createCircle3Line(primitive, tolerance, selected)`：用 `conic3FromCircle3(primitive)`；失败返回 `null`（原样）。
- `threeDrag.rotationHandleGeometry`：在点驱动兜底之前加
  ```ts
  if (primitive.type === "circle3") return { center: new THREE.Vector3(primitive.center.x, primitive.center.y, primitive.center.z), radius: handleRadius(primitive.radius) }
  ```
- `projectionVisuals`：`resolveProjectedDrawing` 里读 `primitive.center`；删掉 `missing point3 reference` 那条诊断与它的用例。
- `App.addCircle3Track`：`center: { ...center.position }`（不再写 `centerId`）；指令文案补"建完与这些点无关"。
- `PropertiesBar`：`圆心 X/Y/Z` 改成 `CoordinateField`（写 `{ center3: { ...selectedCircle3.center, [axis]: next } }`）；删掉"圆心跟着那个空间点走"那句，改成"圆心、半径、法向都是这条轨道自己的几何"。
- 新增场景图补丁字段 `center3`（`PrimitiveUpdatePatch`）与它的校验：只允许 `circle3`、必须有限向量。**注意**：圆柱/圆锥已有同名的 `center3` 含义（那是它们自己的中心），所以校验写成"属于 `["cylinder","cone","circle3"]` 之一，且类型必须与图元匹配"。
- `exporters.ts:128`：摘要写 `{ center, normal, radius }`。

- [ ] **Step 8: 跑用例，全绿**

Run: `npx.cmd vitest run packages packages/scene-graph apps/web/src`（或分 workspace 跑）
Expected: 全绿

- [ ] **Step 9: 新 e2e：点不动、圆能删、圆自己走**

`e2e/three-orbit-track-independent.spec.ts`：
1. 建两个空间点 A(0,0,0)、B(3,0,0) → 建轨道（半径 3）；
2. 开「自由拖动」，把圆**本体**从画布拖走 ⇒ 断言 A、B 的「坐标 X/Y/Z」**一个字都没变**，而 `data-content-bounds` 的中心变了；
3. 选中 A 点 → 点「快速删除对象」⇒ **成功**（A 从对象列表消失），轨道仍在；
4. 检查器把圆心 X 填成 `2` ⇒ `data-content-bounds` 跟着移动（圆真的走了）。

- [ ] **Step 10: 门禁 + 文档 + 提交**

Run: `npm.cmd run typecheck` / `npm.cmd test` / `npm.cmd run lint` / `npm run build --workspace @draw/web` / `npx playwright test`
Expected: typecheck 0 error；单测全绿；lint 0 error / 14 warning（基线）；构建通过；Playwright 比上一轮 **+1**

更新 `docs/project-progress.md`（新一节「轨道圆改成独立对象」）+ `docs/feature-catalog.md`（「约束轨道」条目改写：圆自带圆心、点只沿圆滑动）+ README 对应条目，然后：

```bash
git add -A
git commit -F .git/COMMIT_MSG_TRACK_MODEL.txt
git push origin main
```

---

## Slice 2：画布上的半径手柄（缩放）**（已完成）**

**实测结果**：RED 三条（`(0 , circleRadiusHandlePoint) is not a function` 等）→ 实现后又抓到 `expected 10 to be null`：three 的 `Ray.intersectPlane` 在"平行且共面"时返回**射线原点**，于是相机落在圆平面里会读出一个假半径；`trackRadiusAt` 与上一轮的 `rotationAngleAt` 都改成自己挡平行。浏览器两条用例（拖着时读数已变 + 绑定点落在新圆周 + 一步撤销；没抓手柄时半径不动）通过；单测 **121 文件 / 1430 用例**、Playwright **107/107**、lint 0 error / 14 warning。**一处认知修正**：宿主参数 0 对法向 +z 的圆落在 **−y**（不是 +x），所以画布额外交出 `data-track-handle` 让测试不猜。

**Files:**
- Modify: `apps/web/src/threeDrag.ts`（新增 `trackRadiusAt`）、`apps/web/src/threePrimitives.ts`（新增 `createTrackRadiusHandle`）、`apps/web/src/threeScene.tsx`（手柄创建 / 命中 / 预览 / 提交 / 读书数）
- Test: `apps/web/src/threeRotation.test.ts`（手柄位置与缩放数学）、`e2e/three-orbit-track-handles.spec.ts`（新）

**Interfaces:**
- Produces：
  - `circleRadiusHandlePoint(center: Vector3, normal: Vector3, radius: number): THREE.Vector3`（= `circleHost3(...).evaluate({ u: 0 })`）
  - `trackRadiusAt(camera, center: THREE.Vector3, normal: THREE.Vector3, normalizedPoint: { x: number; y: number }): number | null`
  - `createTrackRadiusHandle(center: Vector3, normal: Vector3, radius: number, tolerance: number): THREE.Object3D | null`
- Consumes：Slice 1 的 `Circle3Primitive.center`、既有 `refreshPrimitiveObject(id)`、`circleHost3`

- [ ] **Step 1: RED — 手柄位置与缩放数学**

```ts
it("puts the radius handle where the host parameter 0 is, not at some invented direction", () => {
  const center = { x: 1, y: 2, z: 3 }
  const handle = circleRadiusHandlePoint(center, { x: 0, y: 0, z: 1 }, 2)
  const host = circleHost3(center, { x: 0, y: 0, z: 1 }, 2)!
  const atZero = host.evaluate({ u: 0 })
  expect(handle.x).toBeCloseTo(atZero.x, 12)
  expect(handle.y).toBeCloseTo(atZero.y, 12)
  expect(handle.z).toBeCloseTo(atZero.z, 12)
})

it("reads a dragged radius off the circle's own plane, with a floor and no guessing", () => {
  const camera = cameraAt(new THREE.Vector3(6, 4, 7))
  const center = new THREE.Vector3(0, 0, 0)
  const normal = new THREE.Vector3(0, 0, 1)
  // 指针落在圆周上 (3,0,0) 的屏幕位置 ⇒ 半径 3
  expect(trackRadiusAt(camera, center, normal, pointerAt(new THREE.Vector3(3, 0, 0), camera))).toBeCloseTo(3, 6)
  // 指针落在圆心 ⇒ 夹到下限 0.01，而不是 0（零半径的圆是退化图形）
  expect(trackRadiusAt(camera, center, normal, pointerAt(center, camera))).toBeCloseTo(0.01, 9)
  // 视线与圆所在平面平行 ⇒ 不猜，返回 null
  const edgeOn = cameraAt(new THREE.Vector3(0, 10, 0))
  expect(trackRadiusAt(edgeOn, center, normal, { x: 0.5, y: 0.5 })).toBeNull()
})
```

- [ ] **Step 2: 跑用例确认是红的**

Run: `npx.cmd vitest run apps/web/src/threeRotation.test.ts`
Expected: `(0 , circleRadiusHandlePoint) is not a function`、`(0 , trackRadiusAt) is not a function`

- [ ] **Step 3: 实现纯函数**

```ts
// threeDrag.ts
/** 半径手柄落在**宿主参数 0** 处：与绑上去的动点参数 0 是同一个点，不另写一套基。 */
export function circleRadiusHandlePoint(center: Vector3, normal: Vector3, radius: number): THREE.Vector3 {
  const host = circleHost3(center, normal, radius)
  const point = host ? host.evaluate({ u: 0 }) : center
  return new THREE.Vector3(point.x, point.y, point.z)
}

/** 指针射线与圆所在平面求交 ⇒ 交点到圆心的距离；平行时返回 null；下限 0.01 与属性栏一致。 */
export function trackRadiusAt(camera: THREE.Camera, center: THREE.Vector3, normal: THREE.Vector3, normalizedPoint: { x: number; y: number }): number | null {
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(normalizedPoint.x * 2 - 1, -(normalizedPoint.y * 2 - 1)), camera)
  const planeNormal = new THREE.Vector3(normal.x, normal.y, normal.z).normalize()
  if (!Number.isFinite(planeNormal.length()) || planeNormal.length() < 1e-9) return null
  const hit = raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, center), new THREE.Vector3())
  if (!hit) return null
  return Math.max(0.01, hit.distanceTo(center))
}
```

- [ ] **Step 4: 手柄对象（小球 + 虚线半径）**

`threePrimitives.createTrackRadiusHandle(center, normal, radius, tolerance)`：`userData.visualRole = "track-radius-handle"`、`userData.primitiveId = 轨道 id`（调用方设）、`excludeFromFit = true`；一个 `SphereGeometry` 小球（半径与点手柄同一套屏幕尺度）加一条 `LineDashedMaterial` 的圆心→手柄线段（`computeLineDistances()`）。几何退化（半径 ≤ 0）返回 `null`。

- [ ] **Step 5: 接进 threeScene**

- 内容同步：选中**恰好一个**未锁定轨道时创建手柄，读数 `data-track-radius`（无轨道时 `""`）；
- `pointerdown`：在**环之前**先判手柄（手柄压在圆周上、更具体）→ 命中就进缩放会话，不需要「自由拖动」；
- `pointermove`：算 `trackRadiusAt` → 写 `circleRadiusPreviewRef` → ①`refreshPrimitiveObject(轨道 id)`（用 `{ ...primitive, radius: 预览 }` 重建圆）②绑在该轨道上的点用 `circleHost3(…, 预览半径)` 按当前宿主参数重算并重建（沿用拖绑定点那条路）③手柄移到新圆周、三色环按 `handleRadius` 的比例整体缩放（比例用构建时的环半径算，避免逐帧累积）；
- `pointerup`：清预览 → 半径真的变了才提交 `{ op: "updatePrimitive", id, patch: { radius3 } }`（一步撤销），然后重建场景。

- [ ] **Step 6: e2e（一条主链路）**

`e2e/three-orbit-track-handles.spec.ts`：建轨道（A、B）→ 绑一个点上去（宿主下拉选「圆轨道」）→ ①拖**半径手柄**：拖动中 `data-track-radius` 已变、抬手后半径提交（属性栏读数一致），且**绑定的点落在新圆周上**（到圆心距离 = 新半径，残差 ≈ 0）→ ②拖 **X 环**到 90°：朝向读数变、圆心不动 → ③再拖圆本体：A、B 不动。

- [ ] **Step 7: 门禁 + 文档 + 提交**

同 Slice 1 的五条命令；Playwright 再 **+1**；更新三份文档，提交（`COMMIT_MSG_TRACK_HANDLE.txt`）并推送、两端核对 SHA。

---

## Slice 3：文档收尾

- [ ] `docs/project-progress.md`：本轮条目补齐三片的 RED/证据/门禁数字与如实边界（悬空引用丢一条轨道、半径下限 0.01、不做吸附、`face3` 不在本轮）。
- [ ] `docs/feature-catalog.md`：把「约束轨道」条目改写为"圆自带圆心 + 点沿圆滑动 + 画布缩放/旋转"；顺手更正旧表述（"圆心跟着那个空间点走"）。
- [ ] `README.md`：三维几何一节里圆轨道那条改写，验证基线数字更新。
- [ ] 本 spec 与本计划的状态行改成"已交付"。

---

## Self-Review

**1. Spec coverage**：§3 模型 → Slice 1 Step 1；§4 迁移 → Slice 1 Step 5；§5 内核 → Slice 1 Step 4；§6 场景图 → Slice 1 Step 6（含 `isReferenced`）；§7 画布（手柄 / 优先级 / 预览 / 读数）→ Slice 2；§8 检查器 → Slice 1 Step 7；§9 创建入口 → Slice 1 Step 7；§10 退化 → Slice 2 Step 1（下限与平行）与 Slice 1 Step 7（校验）；§11 测试 → 两片的 RED 与 e2e。无缺口。

**2. Placeholder scan**：无 TBD / TODO；每个 Step 都给了真实代码或真实命令与断言。

**3. Type consistency**：`conic3FromCircle3(primitive)` 在 Slice 1 定稿并被 `createCircle3Line` 消费；`center` 字段在 Slice 1 全链路统一；Slice 2 的三个新函数（`circleRadiusHandlePoint` / `trackRadiusAt` / `createTrackRadiusHandle`）在 Step 3-4 定义、Step 5-6 消费，签名一致；`circleRadiusPreviewRef` 只在 Slice 2 内部使用，不跨片。
