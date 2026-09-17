import type { Page } from "@playwright/test"

/**
 * 从页面读数把世界坐标投影成客户端像素坐标。
 *
 * e2e 里凡是"点画布上某个已知几何位置"的用例都该用它：写死的像素偏移（例如"中心上方 20px"）
 * 会随画布尺寸与比例失效——实测过一次：把 3D 画布改成填满网格行之后，同一个 20px 偏移就点不中了。
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

/** 与组件里 `applyCameraState` 同一套约定：Z 朝上，视线由方位角/仰角决定，垂直视角 42°。 */
export async function projectWorldPoint(page: Page, point: Vec3): Promise<{ x: number; y: number }> {
  const scene = page.locator("[data-3d-scene]")
  const camera: CameraReading = {
    azimuth: Number(await scene.getAttribute("data-camera-azimuth")),
    elevation: Number(await scene.getAttribute("data-camera-elevation")),
    distance: Number(await scene.getAttribute("data-camera-distance")),
    target: parseTriple((await scene.getAttribute("data-camera-target")) ?? "")
  }
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
