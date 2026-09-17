import { expect, test, type Page } from "@playwright/test"

/**
 * 用户报告：把点的坐标设到 20 左右，点就跑到画面外看不见了。
 *
 * 根因不是渲染，而是**没有任何东西重新构图**——旧实现只在"文档 id 变化"（打开文件 /
 * 切换工作区）时取景，编辑出来的远处图元永远留在视野外。区块二加的 `outOfView` 触发
 * 正是为它。
 *
 * 这条用例刻意自证：先关掉自动取景，用页面读数算出"内容真的在视锥外"；
 * 再打开开关，证明同样的读数变成"全部在视锥内"。只看相机数字变化是不够的，
 * 要证明的是**点确实回到画面里**。
 */
test("brings a point set to x = 20 back inside the view", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()
  await page.getByRole("button", { name: "添加空间点" }).click()

  const scene = page.locator("[data-3d-scene]")
  const toggleAutoFit = () => page.evaluate(() => (document.querySelector('button[aria-label="自动取景"]') as HTMLButtonElement).click())

  // 先关掉自动取景：这样"点跑到视野外"会稳定复现，而不是被修复掩盖。
  await toggleAutoFit()
  await expect(scene).toHaveAttribute("data-autofit", "false")

  const xField = page.getByRole("spinbutton", { name: "坐标 X" })
  await xField.fill("20")
  await xField.blur()

  const aspect = await canvasAspect(page)
  const far = await readView(page)
  // 关掉开关时它就该在视野外——这正是用户看到的现象。
  expect(worstNdc(far.bounds, far.camera, aspect)).toBeGreaterThan(1)

  // 打开自动取景：内容越界是允许重置视角的条件，点必须回到画面里。
  // 取景有约 250ms 的缓出过渡，所以轮询等它稳定下来，而不是立刻读一次数字。
  await toggleAutoFit()
  await expect(scene).toHaveAttribute("data-autofit", "true")
  await expect(scene).toHaveAttribute("data-camera-fit", "1")
  await expect
    .poll(async () => {
      const view = await readView(page)
      return worstNdc(view.bounds, view.camera, aspect)
    }, { timeout: 4000 })
    .toBeLessThanOrEqual(1)

  const near = await readView(page)
  // 相机确实往内容那边挪了（而不是原地不变）。
  expect(near.camera.target.x).toBeGreaterThan(5)
})

interface Vec3 {
  x: number
  y: number
  z: number
}
interface View {
  bounds: { centre: Vec3; size: Vec3 }
  camera: { azimuth: number; elevation: number; distance: number; target: Vec3 }
}

async function canvasAspect(page: Page): Promise<number> {
  const box = (await page.locator("[data-3d-scene] canvas").boundingBox())!
  return box.width / box.height
}

async function readView(page: Page): Promise<View> {
  const scene = page.locator("[data-3d-scene]")
  const bounds = parseBounds((await scene.getAttribute("data-content-bounds")) ?? "")
  const camera = {
    distance: Number(await scene.getAttribute("data-camera-distance")),
    target: parseTriple((await scene.getAttribute("data-camera-target")) ?? ""),
    azimuth: Number(await scene.getAttribute("data-camera-azimuth")),
    elevation: Number(await scene.getAttribute("data-camera-elevation"))
  }
  return { bounds, camera }
}

function parseTriple(text: string): Vec3 {
  const [x, y, z] = text.split(",").map(Number)
  return { x, y, z }
}

function parseBounds(text: string) {
  const match = text.match(/^(-?[\d.]+),(-?[\d.]+),(-?[\d.]+) size ([\d.]+),([\d.]+),([\d.]+)$/)
  if (!match) throw new Error(`unreadable content bounds: ${text}`)
  const values = match.slice(1).map(Number)
  return { centre: { x: values[0], y: values[1], z: values[2] }, size: { x: values[3], y: values[4], z: values[5] } }
}

/**
 * 用页面读数重算"内容最坏的那个角落在 NDC 的哪个位置"（与组件里 applyCameraState 同一套
 * 基向量约定：Z 朝上、视线由方位角与仰角决定）。> 1 表示跑到视锥外。
 */
function worstNdc(bounds: { centre: Vec3; size: Vec3 }, camera: View["camera"], aspect: number): number {
  const elevation = (camera.elevation * Math.PI) / 180
  const azimuth = (camera.azimuth * Math.PI) / 180
  const horizontal = camera.distance * Math.cos(elevation)
  const position: Vec3 = {
    x: camera.target.x + horizontal * Math.cos(azimuth),
    y: camera.target.y + horizontal * Math.sin(azimuth),
    z: camera.target.z + camera.distance * Math.sin(elevation)
  }
  const forward = normalize({ x: camera.target.x - position.x, y: camera.target.y - position.y, z: camera.target.z - position.z })
  const right = normalize(cross(forward, { x: 0, y: 0, z: 1 }))
  const up = cross(right, forward)
  const tanVertical = Math.tan((42 * Math.PI) / 360)
  const half = { x: bounds.size.x / 2, y: bounds.size.y / 2, z: bounds.size.z / 2 }
  let worst = 0
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const corner: Vec3 = { x: bounds.centre.x + sx * half.x, y: bounds.centre.y + sy * half.y, z: bounds.centre.z + sz * half.z }
        const offset = { x: corner.x - position.x, y: corner.y - position.y, z: corner.z - position.z }
        const depth = dot(offset, forward)
        if (depth <= 0) return Number.POSITIVE_INFINITY
        worst = Math.max(worst, Math.abs(dot(offset, up)) / (depth * tanVertical), Math.abs(dot(offset, right)) / (depth * tanVertical * aspect))
      }
    }
  }
  return worst
}

const dot = (first: Vec3, second: Vec3) => first.x * second.x + first.y * second.y + first.z * second.z
const cross = (first: Vec3, second: Vec3): Vec3 => ({ x: first.y * second.z - first.z * second.y, y: first.z * second.x - first.x * second.z, z: first.x * second.y - first.y * second.x })
function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}
