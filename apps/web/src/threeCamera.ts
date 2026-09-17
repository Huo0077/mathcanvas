import * as THREE from "three"

/**
 * 3D 视图的相机与取景数学。
 *
 * 从 `threeScene.tsx` 抽出来的（那份文件 1900+ 行，组件与纯函数混在一起）：
 * 好处有两个——这些函数本来就和 React 无关，独立成模块后可以直接单测；
 * 组件的导出也不再混着"一堆纯函数"，`react-refresh/only-export-components` 的告警随之消失。
 *
 * 约定：**世界 Z 轴朝上**（`applyCameraState` 是唯一决定朝上的地方），
 * 相机状态用方位角 / 仰角 / 距离 / 视点中心的轨道参数表示，坐标一律由它派生。
 */

export interface CameraState {
  azimuth: number
  elevation: number
  distance: number
  target: { x: number; y: number; z: number }
}

export function createCameraState(): CameraState {
  return { azimuth: 45, elevation: 30, distance: 16, target: { x: 0, y: 0, z: 0 } }
}

export function rotateCameraState(state: CameraState, azimuthDelta: number, elevationDelta: number): CameraState {
  return { ...state, azimuth: state.azimuth + azimuthDelta, elevation: Math.max(-85, Math.min(85, state.elevation + elevationDelta)) }
}

/**
 * 相机拖动模式：Ctrl/Cmd = 沿视线前后平移，中键 / Shift / 平移模式 = 屏幕平面平移，其余 = 旋转。
 *
 * 修饰键必须取**每一次移动事件**的状态，不能只读 pointerdown 那一刻的快照：
 * 用户"先按住左键、再想起按 Shift"是最自然的顺序，快照语义下 Shift 完全不生效
 * （实测的交互缺陷）。反过来，拖动中松开 Shift 就立刻回到旋转，与画布上其它修饰键一致。
 */
export function cameraDragMode(event: { button: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, panMode: boolean): "depth-pan" | "screen-pan" | "rotate" {
  if (event.ctrlKey || event.metaKey) return "depth-pan"
  if (event.button === 1 || event.shiftKey || panMode) return "screen-pan"
  return "rotate"
}

/** How far the orbit centre may travel from the figure, as a multiple of the figure's radius. */
const PAN_RANGE_FACTOR = 3
/** Orbit-centre limit used before the scene has any geometry to anchor to. */
const EMPTY_BOUNDS_PAN_LIMIT = 12

/**
 * The camera's own axes for an orbit state: screen-right, screen-up and the view axis (camera -> target).
 * Panning along these instead of the world axes is what makes the figure track the pointer after the camera
 * has been turned, and `forward` is the axis that brings a figure which is off-centre in depth to the middle.
 *
 * Free dragging shares it: `right`/`up` are the screen plane a dragged figure has to follow.
 */
export function cameraBasis(state: CameraState): { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 } {
  const azimuth = state.azimuth * Math.PI / 180
  const elevation = state.elevation * Math.PI / 180
  // Matches applyCameraState: Z is the up axis, so elevation tilts the camera towards +Z.
  const forward = new THREE.Vector3(-Math.cos(elevation) * Math.cos(azimuth), -Math.cos(elevation) * Math.sin(azimuth), -Math.sin(elevation))
  const right = new THREE.Vector3(-Math.sin(azimuth), Math.cos(azimuth), 0)
  return { right, up: new THREE.Vector3().crossVectors(right, forward), forward }
}

/** Move the orbit centre by distances measured along the camera's own right, up and forward axes. */
export function panCameraState(state: CameraState, right: number, up: number, forward = 0): CameraState {
  const basis = cameraBasis(state)
  return {
    ...state,
    target: {
      x: state.target.x + basis.right.x * right + basis.up.x * up + basis.forward.x * forward,
      y: state.target.y + basis.right.y * right + basis.up.y * up + basis.forward.y * forward,
      z: state.target.z + basis.right.z * right + basis.up.z * up + basis.forward.z * forward
    }
  }
}

/** Keep the orbit centre near the figure, so a drag can never lose the geometry off screen. */
export function clampCameraTarget(target: CameraState["target"], bounds: THREE.Box3): CameraState["target"] {
  if (bounds.isEmpty()) {
    const clamp = (value: number) => Math.max(-EMPTY_BOUNDS_PAN_LIMIT, Math.min(EMPTY_BOUNDS_PAN_LIMIT, value))
    return { x: clamp(target.x), y: clamp(target.y), z: clamp(target.z) }
  }
  const centre = bounds.getCenter(new THREE.Vector3())
  const limit = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.5) * PAN_RANGE_FACTOR
  const clamp = (value: number, origin: number) => Math.max(origin - limit, Math.min(origin + limit, value))
  return { x: clamp(target.x, centre.x), y: clamp(target.y, centre.y), z: clamp(target.z, centre.z) }
}

export function zoomCameraState(state: CameraState, factor: number): CameraState {
  return { ...state, distance: Math.max(FIT_MIN_DISTANCE, Math.min(FIT_MAX_DISTANCE, state.distance * factor)) }
}

export function resetCameraState(): CameraState {
  return createCameraState()
}

/** 自动取景与缩放共用的距离范围。旧实现夹在 `[3, 60]`，于是 1 单位的小图形永远凑不近、大图形永远框不全。 */
export const FIT_MIN_DISTANCE = 0.005
export const FIT_MAX_DISTANCE = 1e4
/** 构图安全边距：图形最多占满视锥的 70%，剩下 30% 留白。 */
export const FIT_MARGIN = 0.3
/** 自动取景的过渡时长（毫秒）。`prefersReducedMotion()` 为真时不做过渡、直接跳变。 */
export const FIT_ANIMATION_MS = 250

function clampFitDistance(value: number): number {
  if (!Number.isFinite(value)) return createCameraState().distance
  return Math.max(FIT_MIN_DISTANCE, Math.min(FIT_MAX_DISTANCE, value))
}

/** AABB 的八个角，用于投影检验与越界判定。 */
export function boxCorners(bounds: THREE.Box3): THREE.Vector3[] {
  const corners: THREE.Vector3[] = []
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z))
  return corners
}

/**
 * 用**包围盒八角在相机三轴上的投影**求距离，而不是"包围球 × 系数"。
 *
 * 对每个角点算"它要落在视锥内所需的最小距离" `|投影| / tan - 纵深`，取八个角的最大值，
 * 再除以 `1 - FIT_MARGIN` 留出安全边距。比"沿三轴各取半宽相加"更紧：后者假设最偏的角
 * 同时最靠近相机，对斜视角的盒子偏保守。长条盒（20×0.2×0.2）用包围球会被推得远远的，
 * AABB 逐角点则贴合得多——这是本次改动的意义。
 *
 * 视角角度保持不变，只挪视点中心与距离；空场景回默认视角而不是把相机压扁。
 */
export function fitCameraState(state: CameraState, bounds: THREE.Box3, camera: THREE.PerspectiveCamera): CameraState {
  if (bounds.isEmpty()) return { ...state, target: { x: 0, y: 0, z: 0 }, distance: createCameraState().distance }
  const centre = bounds.getCenter(new THREE.Vector3())
  const basis = cameraBasis(state)
  const vertical = camera.fov * Math.PI / 360
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(camera.aspect, 0.1))
  const tanVertical = Math.tan(vertical)
  const tanHorizontal = Math.tan(horizontal)
  // 逐个角点求"这个角要落在视锥内所需的最小距离"：`d ≥ |投影| / tan - 纵深`，
  // 取八个角的最大值。这比"沿三轴各取半宽再相加"更紧——后者假设最偏的角同时最靠近相机，对斜视角的盒子偏保守。
  let needed = 0
  for (const corner of boxCorners(bounds)) {
    const offset = corner.sub(centre)
    const up = offset.dot(basis.up)
    const right = offset.dot(basis.right)
    const depth = offset.dot(basis.forward)
    needed = Math.max(needed, Math.abs(up) / tanVertical - depth, Math.abs(right) / tanHorizontal - depth)
  }
  return { ...state, target: { x: centre.x, y: centre.y, z: centre.z }, distance: clampFitDistance(needed / (1 - FIT_MARGIN)) }
}

/** 图元是否已经跑到视锥之外（含纵深方向）。空包围盒不算越界。 */
export function isContentOutOfView(state: CameraState, bounds: THREE.Box3, camera: THREE.PerspectiveCamera, padding = 0): boolean {
  if (bounds.isEmpty()) return false
  const probe = camera.clone()
  applyCameraState(probe, state)
  probe.updateMatrixWorld(true)
  probe.updateProjectionMatrix()
  return boxCorners(bounds).some((corner) => {
    const projected = corner.clone().project(probe)
    if (projected.z < -1 || projected.z > 1) return true
    return Math.abs(projected.x) > 1 + padding || Math.abs(projected.y) > 1 + padding
  })
}

/** 相机过渡插值：`t` 夹到 `[0,1]`，所以调用方不必自己防越界。 */
export function interpolateCameraState(from: CameraState, to: CameraState, t: number): CameraState {
  const ratio = Math.min(1, Math.max(0, t))
  const mix = (first: number, second: number) => first + (second - first) * ratio
  return {
    azimuth: mix(from.azimuth, to.azimuth),
    elevation: mix(from.elevation, to.elevation),
    distance: mix(from.distance, to.distance),
    target: { x: mix(from.target.x, to.target.x), y: mix(from.target.y, to.target.y), z: mix(from.target.z, to.target.z) }
  }
}

export interface AutoFitInputs {
  enabled: boolean
  dragging: boolean
  documentChanged: boolean
  outOfView: boolean
}

/**
 * 什么时候允许自动重置视角。
 *
 * 刻意**不**包含"内容 AABB 变了就拟合"：那正是"用户一边编辑、相机一边跟着跑"的来源——
 * 实测它会毁掉 7 条既有浏览器流程（拖动实体时相机跟着实体走、移动截面时视角跳、按已知
 * 屏幕坐标点击顶点的用例全部失准）。用户的真实痛点是"图形太小/跑到视野外"，而不是
 * "编辑时视角必须回到中心"，所以策略收窄为：
 * - 换了文档（打开文件 / 切换工作区 / 恢复草稿）→ 拟合；
 * - 内容跑出视锥 → 拟合（这就是"增删后看不见新图元"的解法）；
 * - 拖动进行中、或开关关掉 → 一律不拟合。
 */
export function shouldAutoFit(inputs: AutoFitInputs): boolean {
  if (!inputs.enabled || inputs.dragging) return false
  return inputs.documentChanged || inputs.outOfView
}

/** World-space bounds of everything drawn, ignoring the grid and axes so they never drive the framing. */
export function contentBounds(scene: THREE.Object3D): THREE.Box3 {
  scene.updateMatrixWorld(true)
  const bounds = new THREE.Box3()
  for (const child of scene.children) {
    if (child.userData.excludeFromFit) continue
    bounds.expandByObject(child)
  }
  return bounds
}

/**
 * 内容半径（包围盒对角线的一半），可以排除指定对象。
 *
 * 平面片的尺寸是"按内容半径画出来的"，而它的旧对象在增量同步里会被**沿用**、仍留在场景中：
 * 把面片自己算进半径，尺寸就会一路自我膨胀（实测：手动半边长恢复自动之后 7.02 变成 36.21）。
 */
export function contentRadiusExcluding(scene: THREE.Object3D, excluded: readonly THREE.Object3D[]): number {
  scene.updateMatrixWorld(true)
  const skip = new Set(excluded)
  const bounds = new THREE.Box3()
  for (const child of scene.children) {
    if (skip.has(child) || child.userData.excludeFromFit) continue
    bounds.expandByObject(child)
  }
  return bounds.isEmpty() ? 0 : bounds.getSize(new THREE.Vector3()).length() / 2
}

/** Exported for the tests: the orbit camera is the one place the world up axis is decided. */
export function applyCameraState(camera: THREE.PerspectiveCamera, state: CameraState): void {
  const azimuth = state.azimuth * Math.PI / 180
  const elevation = state.elevation * Math.PI / 180
  const horizontal = state.distance * Math.cos(elevation)
  // Z is up, which is what a maths or engineering audience expects: at zero azimuth the camera sits on +X and
  // tilting up raises it along +Z rather than +Y.
  camera.up.set(0, 0, 1)
  camera.position.set(
    state.target.x + horizontal * Math.cos(azimuth),
    state.target.y + horizontal * Math.sin(azimuth),
    state.target.z + state.distance * Math.sin(elevation)
  )
  camera.lookAt(state.target.x, state.target.y, state.target.z)
  // 近远平面随距离缩放：固定 near 0.1 会让"0.01 单位的小模型凑近看"整块被裁掉，
  // 固定 far 1000 又会让超大模型被截断。这是"小图形框不满、大图形框不全"的另一半原因。
  const near = Math.max(state.distance * 0.01, 1e-4)
  const far = Math.max(state.distance * 100, 1000)
  if (camera.near !== near || camera.far !== far) {
    camera.near = near
    camera.far = far
    camera.updateProjectionMatrix()
  }
}
