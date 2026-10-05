import type { Locator, Page } from "@playwright/test"

/**
 * 从页面读数把世界坐标投影成客户端像素坐标。
 *
 * e2e 里凡是"点画布上某个已知几何位置"的用例都该用它：写死的像素偏移（例如"中心上方 20px"）
 * 会随画布尺寸与比例失效——实测过一次：把 3D 画布改成填满网格行之后，同一个 20px 偏移就点不中了。
 *
 * ## 为什么投影**之前**必须等相机停稳（2026-10-05 补的那一刀）
 *
 * 这一刀不是洁癖，是这条抖动追出来的：**四次观测到的 e2e 抖动，四次都是同一个断言**
 * ——`data-preview-hovering` 期望 `"true"`、实收 `"false"`（5 秒轮询超时），
 * 而失败那一刻场景读数里 `data-preview-count="1"`（预览在）、`data-scene-syncs="5"`。
 * 也就是说：**预览在，指针却不在它上面。**
 *
 * 机制：自动取景（`animateToFit`，约 250ms）在 rAF 里**逐帧插值整份相机状态**。
 * 这个函数原来一上来就读 `data-camera-*`，如果那时动画还没跑完，读到的是**中途**的方位角/距离；
 * 等 `page.mouse.move` 真正执行时相机已经又动过了，于是"投影出来的屏幕点"不再对应那个世界点
 * —— 而预览的命中区只有那圈**边界虚线**，差一点就是空。指针事件**不会再发一次**，
 * 所以属性会一直停在 `false`；产品侧的"悬停自愈"（`refreshPreviewHover`）也救不回来，
 * 因为它按最后指针位置重算，而那个位置本身就是错的。
 *
 * 判据**不看动画时长、不写死 sleep**：只看相机读数**连续两次一致**
 * —— 与 `three-orbit-tracks.spec.ts` / `three-intersection-previews.spec.ts` 的 `settleCamera`、
 * `geometry3d.spec.ts` 的 `settledTarget` 同一套口径（那里修的是同一类竞态）。
 *
 * **为什么放在这个函数里、而不是各个 spec 里**：这一类坑已经咬过两次（上一次是
 * `geometry3d.spec.ts:277`），而"每个调用点自己记得先 settle"正是它复发的原因。
 * 代价是每个用例的第一次投影多等一次采样间隔。
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

interface CameraReading {
  azimuth: number
  elevation: number
  distance: number
  target: Vec3
}

/** 相机四个读数的原始字串。按**字串**比较，避免浮点相等判断带来的"假停稳"。 */
async function cameraSignature(scene: Locator): Promise<string> {
  return [
    await scene.getAttribute("data-camera-azimuth"),
    await scene.getAttribute("data-camera-elevation"),
    await scene.getAttribute("data-camera-distance"),
    await scene.getAttribute("data-camera-target")
  ].join("|")
}

/** 等相机**停稳**（连续两次读数一致）再投影；判据不依赖动画时长。 */
async function settleCamera(scene: Locator): Promise<void> {
  let previous = ""
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await cameraSignature(scene)
    if (current === previous) return
    previous = current
    await scene.page().waitForTimeout(120)
  }
}

/** 与组件里 `applyCameraState` 同一套约定：Z 朝上，视线由方位角 / 仰角决定，垂直视角 42°。 */
export async function projectWorldPoint(page: Page, point: Vec3): Promise<{ x: number; y: number }> {
  const scene = page.locator("[data-3d-scene]")
  await settleCamera(scene)

  const camera: CameraReading = {
    azimuth: Number(await scene.getAttribute("data-camera-azimuth")),
    elevation: Number(await scene.getAttribute("data-camera-elevation")),
    distance: Number(await scene.getAttribute("data-camera-distance")),
    target: parseTriple((await scene.getAttribute("data-camera-target")) ?? "")
  }
  // 画布盒子在 settle **之后**读：settle 期间布局若变了，早读到的那个盒子就是旧的。
  const box = (await page.locator("[data-3d-scene] canvas").boundingBox())!
  const aspect = box.width / box.height

  const elevation = (camera.elevation * Math.PI) / 180
  const azimuth = (camera.azimuth * Math.PI) / 180
  const horizontal = camera.distance * Math.cos(elevation)
  const eye: Vec3 = {
    x: camera.target.x + horizontal * Math.cos(azimuth),
    y: camera.target.y + horizontal * Math.sin(azimuth),
    z: camera.target.z + camera.distance * Math.sin(elevation)
  }
  const forward = normalize(subtract(camera.target, eye))
  const right = normalize(cross(forward, { x: 0, y: 0, z: 1 }))
  const up = cross(right, forward)

  const offset = subtract(point, eye)
  const depth = dot(offset, forward)
  const tanVertical = Math.tan((42 * Math.PI) / 360)
  const ndcX = dot(offset, right) / (depth * tanVertical * aspect)
  const ndcY = dot(offset, up) / (depth * tanVertical)

  return { x: box.x + (ndcX * 0.5 + 0.5) * box.width, y: box.y + (0.5 - ndcY * 0.5) * box.height }
}

function parseTriple(text: string): Vec3 {
  const [x, y, z] = text.split(",").map(Number)
  return { x, y, z }
}

const subtract = (first: Vec3, second: Vec3): Vec3 => ({ x: first.x - second.x, y: first.y - second.y, z: first.z - second.z })
const dot = (first: Vec3, second: Vec3) => first.x * second.x + first.y * second.y + first.z * second.z
const cross = (first: Vec3, second: Vec3): Vec3 => ({ x: first.y * second.z - first.z * second.y, y: first.z * second.x - first.x * second.z, z: first.x * second.y - first.y * second.x })
function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}
