import { expect, test, type Page } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

/**
 * **解析球在画布上的实机验收**（实施计划 Task 5）。
 *
 * ## 为什么这份用例要"先建个立方体再把图元换掉"
 *
 * 球**还没有手工入口**（那是 Task 6），所以测试没法从界面把球点出来。而手搓一份完整
 * `GeometryDocument` 塞进草稿很脆（图层、元数据、图纸字段都得对，错一个就"恢复失败"，
 * 看起来像产品坏了其实是夹具坏了）。所以这里借应用**自己的**入口落一份合法草稿，
 * 只把 `primitives` 换成球 —— 文档的其余字段由应用保证。
 *
 * ## 判据
 *
 * 1. 种子文档刷新后**球还在**，且球心 / 半径逐值不变（Task 1 的持久化 + Task 5 的渲染都不许动它）；
 * 2. 轨道相机（拖动）只改视角：`data-camera-azimuth` 必须真的变了，而**文档里存的 C/r 一个字节都不许变**
 *    —— 这正是 spec 说的"渲染网格永远不是数学来源"；
 * 3. 球在对象树里以"球体"被认出来（Task 1 登记的检查器名字真的接上了）。
 *
 * ## 这份用例**不**覆盖什么（免得被读成全绿）
 *
 * - "没有密集可选中经纬线"由单元用例钉住（`apps/web/src/threeSphere.test.ts`：组里一条 `LineSegments` 都没有），
 *   浏览器里没有可读的读数能观察它；
 * - "切点可见"要先把球切一刀，而截面按钮的球分支是 Task 4 的尾巴，还没接；
 * - 画布上"点球面选中它"由 `pickKind` 的单元用例覆盖（`sphere → "solid"`）。
 */

const DRAFT_KEY = "mathcanvas:draft:geometry3d"
const SPHERE = { id: "sphere-1", type: "sphere", label: "球体 1", center: { x: 1, y: 2, z: 3 }, radius: 5 }

interface DraftEnvelope {
  document: { primitives: unknown[] }
}

async function readPrimitiveCount(page: Page): Promise<number> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as DraftEnvelope).document.primitives.length : 0
  }, DRAFT_KEY)
}

/** 草稿里那颗球（没有 / 不是球都返回 `null`）。 */
async function readSphere(page: Page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const primitive = (JSON.parse(raw) as { document: { primitives: { type: string; center?: { x: number; y: number; z: number }; radius?: number }[] } }).document.primitives.find((candidate) => candidate.type === "sphere")
    return primitive?.center && primitive.radius !== undefined ? { center: primitive.center, radius: primitive.radius } : null
  }, DRAFT_KEY)
}

test.beforeEach(async ({ page }) => {
  // 只清一次：`addInitScript` 每次导航都会重跑，无条件清空会把 `page.reload()` 正要验的那份草稿抹掉。
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("e2e-sphere-cleared") === null) {
      window.localStorage.clear()
      window.sessionStorage.setItem("e2e-sphere-cleared", "1")
    }
  })
})

test("keeps an analytic sphere through reload and a camera orbit, and names it in the inspector", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  // 借应用自己的入口落一份**合法**草稿，再把图元换成球。
  await page.getByRole("button", { name: "添加立方体" }).click()
  await expect.poll(async () => readPrimitiveCount(page)).toBeGreaterThan(0)

  await page.evaluate(({ key, sphere }) => {
    const raw = window.localStorage.getItem(key)
    if (!raw) throw new Error("应用还没有写出 3D 草稿")
    const envelope = JSON.parse(raw) as DraftEnvelope
    envelope.document.primitives = [sphere]
    window.localStorage.setItem(key, JSON.stringify(envelope))
  }, { key: DRAFT_KEY, sphere: SPHERE })

  await page.reload()
  // 1. 刷新之后球还在，C/r 逐值不变。
  await expect.poll(async () => (await readSphere(page))?.radius ?? null).toBe(5)
  expect(await readSphere(page)).toEqual({ center: SPHERE.center, radius: SPHERE.radius })

  const scene = page.locator("[data-3d-scene]")
  await expect(scene).toBeVisible()

  // 3. 球在对象树里以"球体"被认出来。
  await expect(page.locator(".algebra-panel").getByText("球体 1").first()).toBeVisible()

  /**
   * 3.5 **画布不许再说"这里什么都没有"**。
   *
   * 这条是视觉验收抓出来的真缺陷：`threeScene.tsx` 的 `hasGeometry` 是一张**硬编码类型名单**，
   * 漏了 `sphere` —— 于是一份只含球的文档被当成空图纸，球画在中间、上面却压着
   * "添加点、线或面开始探索三维空间。"。单元用例全绿也照样漏，因为只有真看一眼那一帧才看得见。
   */
  await expect(page.getByText("添加点、线或面开始探索三维空间。")).toHaveCount(0)

  /**
   * 4. **画布上真的画出来了**（这条是"渲染"唯一的实机证据）。
   *
   * 前面那些断言都只读文档 —— 就算球一个像素都没画，它们照样绿。所以这里走**拾取**这条真链路：
   * 刚刷新时什么都没选中（快捷操作条不可见），在球心投影处点一下之后必须选中了某个东西。
   * 球没画出来，这一点就命不中任何物体，断言当场红。
   */
  const quickActions = page.locator(".inspector-quick-actions")
  await expect(quickActions).toBeHidden()
  const projected = await projectWorldPoint(page, SPHERE.center)
  await page.mouse.click(projected.x, projected.y)
  await expect(quickActions).toBeVisible()

  // 5. 轨道相机真的转了，而文档里存的 C/r 一个字节都没变。
  const azimuthBefore = Number(await scene.getAttribute("data-camera-azimuth"))
  const box = (await page.locator("[data-3d-scene] canvas").boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 130, box.y + box.height / 2 + 35, { steps: 8 })
  await page.mouse.up()

  // 先确认真的转了 —— 否则"C/r 没变"可能只是因为压根没动相机。
  await expect.poll(async () => Number(await scene.getAttribute("data-camera-azimuth"))).not.toBeCloseTo(azimuthBefore, 1)
  expect(await readSphere(page)).toEqual({ center: SPHERE.center, radius: SPHERE.radius })
})
