import { expect, test, type Page } from "@playwright/test"

import { SPHERE_PROMPT } from "../apps/web/src/agent/localPlanner"

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

/**
 * **从「常用立体」手工创建一个球**（Task 6 的界面那一半）。
 *
 * 判据是"预览与提交分开"这条口径：
 * ① 参数改完但**没点确认**之前，文档里**不该有球**（预览只改画面）；
 * ② 点确认之后文档里恰好是那一个球，球心 / 半径逐值等于填的；
 * ③ 半径填 0 时**如实报原因**，而且文档**一个字节都没动**（不是"写进去一半再说"）。
 */
test("creates a sphere from the common-solid wizard: preview first, one commit on confirm", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "常用立体" }).click()

  const wizard = page.getByRole("dialog", { name: "常用立体" })
  await wizard.getByRole("combobox", { name: "立体类型" }).selectOption("sphere")
  for (const [axis, value] of [["X", "1"], ["Y", "2"], ["Z", "3"]] as const) {
    await wizard.getByRole("spinbutton", { name: `球心 ${axis}` }).fill(value)
  }
  await wizard.getByRole("spinbutton", { name: "半径" }).fill("5")

  // ① 参数齐了、预览该有了，但**还没点确认** —— 文档里不该出现球。
  expect(await readSphere(page)).toBeNull()
  // 画面确实有东西了：那句"这里什么都没有"的提示必须消失（预览真的画出来了）。
  await expect(page.getByText("添加点、线或面开始探索三维空间。")).toHaveCount(0)

  // ③ 先试一个非法半径：如实报原因，且文档仍然没有球。
  await wizard.getByRole("spinbutton", { name: "半径" }).fill("0")
  await expect(wizard.getByRole("alert")).toBeVisible()
  expect(await readSphere(page)).toBeNull()

  await wizard.getByRole("spinbutton", { name: "半径" }).fill("5")
  await expect(wizard.getByRole("alert")).toHaveCount(0)

  // ② 确认：一次提交落一个球。
  await wizard.getByRole("button", { name: "确认创建" }).click()
  await expect.poll(async () => (await readSphere(page))?.radius ?? null).toBe(5)
  expect(await readSphere(page)).toEqual({ center: { x: 1, y: 2, z: 3 }, radius: 5 })
  await expect(page.locator(".algebra-panel").getByText(/^球体 \d+$/).first()).toBeVisible()
})

/**
 * **在属性栏里改球的球心与半径**（Task 6 的第三条接口）。
 *
 * 写入路径由 Task 3 打好（`updatePrimitive { center3, radius3 }`：补丁校验 + 应用分支 +
 * 一步撤销都已有用例）；这一条验的是**界面真的接上了那条路径**：
 * ① 选中球之后属性栏要有"球心"和"半径"两组字段，且读出的就是文档里的值；
 * ② 改半径会**落到文档**（不是只改画面）；
 * ③ 一次 Ctrl+Z 回到改之前 —— 与其它实体的编辑同一套撤销语义。
 */
test("edits a sphere's centre and radius from the inspector, one undo step", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
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
  await expect.poll(async () => (await readSphere(page))?.radius ?? null).toBe(5)

  // 选中它：点球心投到屏幕上的那一点。
  const projected = await projectWorldPoint(page, SPHERE.center)
  await page.mouse.click(projected.x, projected.y)

  const radiusField = page.getByRole("spinbutton", { name: "半径 3D" })
  await expect(radiusField).toHaveValue("5")
  await expect(page.getByRole("spinbutton", { name: "球心 X" })).toHaveValue("1")

  await radiusField.fill("4")
  await expect.poll(async () => (await readSphere(page))?.radius ?? null).toBe(4)

  await page.getByRole("spinbutton", { name: "球心 Y" }).fill("7")
  await expect.poll(async () => (await readSphere(page))?.center.y ?? null).toBe(7)

  // ③ 一步撤销：回到改球心之前（半径仍是 4）。
  await page.keyboard.press("Control+z")
  await expect.poll(async () => (await readSphere(page))?.center.y ?? null).toBe(2)
  expect((await readSphere(page))?.radius).toBe(4)

  // 再撤一步：回到改半径之前。
  await page.keyboard.press("Control+z")
  await expect.poll(async () => (await readSphere(page))?.radius ?? null).toBe(5)
})

/**
 * **工具栏的「创建截面」对球也能用**（Task 4 的尾巴，同时补上 Task 5 里"经界面切一刀"那条）。
 *
 * 判据是"解析"这两个字在**端到端**上也成立：过球心那一刀给出的是**大圆**，而且画布读数里
 * `data-section-exact-kind` 必须是 `circle`、`status` 必须是 `exact` —— 不是 48 边形近似。
 */
test("cuts the selected sphere from the toolbar and records an exact circle", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
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
  await expect.poll(async () => (await readSphere(page))?.radius ?? null).toBe(5)

  // 选中球：点球心投到屏幕上的那一点。
  const projected = await projectWorldPoint(page, SPHERE.center)
  await page.mouse.click(projected.x, projected.y)

  const sectionButton = page.getByRole("button", { name: "创建截面" })
  // 按钮**可用**本身就是一条判据：`canCreateSection` 与 `addSection` 共用 `solidTypes`，
  // 名单里没有球时这里会是 disabled（点了也什么都不发生）。
  await expect(sectionButton).toBeEnabled()
  await sectionButton.click()

  const scene = page.locator("[data-3d-scene]")
  await expect(scene).toHaveAttribute("data-section-count", "1")
  // 一刀过球心 ⇒ 大圆；而且是**解析**结论，不是折线拟合。
  await expect(scene).toHaveAttribute("data-section-exact-kind", "circle")
  await expect(scene).toHaveAttribute("data-section-exact-status", "exact")
  // 球没有端面：整条交圆都在，所以采样点是一整圈而不是几段弧。
  await expect.poll(async () => Number(await scene.getAttribute("data-section-point-count"))).toBeGreaterThan(2)
})

/**
 * **球参与的布尔交：一个预览都不给**（spec §5「不支持项」那一行：球-球 / 球-实体要**明确拒绝**）。
 *
 * 文档层的拒绝由 `sphereSection.test.ts` 钉住（`commitPatch` 返回 `changed=false` + `unsupported`）；
 * 这一条验的是**界面这一侧不自作主张**：球与立方体的组合不该冒出"点一下就建交面"的虚线预览。
 *
 * **反向对照是必须的**：少了它，"预览数恒为 0"（比如预览功能压根没开）也能让断言变绿 ——
 * 所以同一份用例里先证明"两个立方体**有**预览"，再证明"球参与时**没有**"。
 */
test("offers no Boolean intersection preview when a sphere is involved, but does for two solids", async ({ page }) => {
  const seed = async (primitives: unknown[]) => {
    await page.evaluate(({ key, primitives }) => {
      const raw = window.localStorage.getItem(key)
      if (!raw) throw new Error("应用还没有写出 3D 草稿")
      const envelope = JSON.parse(raw) as DraftEnvelope
      envelope.document.primitives = primitives as DraftEnvelope["document"]["primitives"]
      window.localStorage.setItem(key, JSON.stringify(envelope))
    }, { key: DRAFT_KEY, primitives })
    await page.reload()
  }

  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()
  await expect.poll(async () => readPrimitiveCount(page)).toBeGreaterThan(0)

  const scene = page.locator("[data-3d-scene]")
  const previewCount = async () => Number(await scene.getAttribute("data-preview-count"))
  const outerCube = { id: "cube-1", type: "cube", origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
  const innerCube = { id: "cube-2", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }

  // 反向对照：两个实体相交时**有**预览（证明这条链是通的，不是"功能没开"）。
  await seed([outerCube, innerCube])
  await expect.poll(previewCount).toBeGreaterThan(0)

  // 球参与时一个都不给 —— 而不是给一个假的。
  await seed([SPHERE, outerCube])
  await expect(scene).toHaveAttribute("data-preview-count", "0")
  // 文档也没被改动：还是那两个图元（建模失败不留半成品）。
  expect(await readPrimitiveCount(page)).toBe(2)
})

/**
 * **一句话造球**（球体切片 Task 8 的端到端那一半）。
 *
 * 浏览器里没有模型服务，规划器用的是**确定性本地规划器**；但一旦产出了计划，下游
 *（传输校验 → 动作编译 → 隔离草稿 → 用户确认 → 原子落盘 → 撤销）与真实模型走的是**同一条**。
 * 这条用例要的正是那条链路：**一句话 → 一份停在确认的草稿 → 确认 → 文档真的多了一只球 → 一步撤销**。
 */
test("drafts a sphere from one sentence and commits it in one undo step", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await expect(page.locator(".algebra-panel .object-row")).toHaveCount(0)

  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await page.getByRole("textbox", { name: "对话输入" }).fill(SPHERE_PROMPT)
  await page.getByRole("button", { name: "发送" }).click()

  // ① 停在确认：一份真正的草稿，而不是一句"已完成"。球是解析体，只新增**一个**对象。
  const draft = page.getByRole("region", { name: "确认改动" }).last()
  await expect(draft).toBeVisible()
  await expect(draft).toContainText(/会新增 1 个对象/)

  // ② 确认之前真文档一个字节都没变。
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator(".algebra-panel .object-row")).toHaveCount(0)

  // ③ 确认 → 落盘 → 对象树里出现那只球（**一个**对象行）。
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await draft.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  // 按**行数**断言而不是按显示名：这条链路和棱柱那条一样**不写 label**（那是手工入口的习惯），
  // 所以对象行显示的是 id 而不是"球体" —— 拿名字断言会把"名字从哪来"这件事无关地绑进来。
  await expect.poll(async () => page.locator(".algebra-panel .object-row").count()).toBe(1)
  // 一句话造出来的球确实在文档里（半径来自原话里的 5）。
  await expect.poll(async () => (await readSphere(page))?.radius ?? null).toBe(5)

  // ④ 整批只占**一步**撤销。
  await page.keyboard.press("Control+z")
  await expect.poll(async () => page.locator(".algebra-panel .object-row").count()).toBe(0)
  expect(await readSphere(page)).toBeNull()
})

/**
 * **相切与空集在浏览器里也说得清**（spec §5「解析截面」那一行点名 z=8 / z=9 两例）。
 *
 * ## 为什么这条能用"整数步"精确走到相切
 *
 * `sectionPlaneThroughSource` 对球默认给的是**过球心**的平面（球心 z=3 ⇒ `constant = -3`，大圆）；
 * 而方向键在「自由拖动」开着、且选中的是截面时按**整整 1 个单位**沿法向平移
 *（`threeSceneEffect.ts`，按住 Shift 才是 0.2）。于是五次 `ArrowUp` 把常数送到 **-8** ——
 * 球心到平面的距离正好等于半径 5，**精确相切**；再一次就是 **-9**（距离 6 > 5），空集。
 *
 * 整数步 + 整数球心，让"相切"这个测度为零的状态在浏览器里也能**稳定**走到 ——
 * 这也是它当初被我判成"验不了"时漏掉的一点。
 *
 * ## 那一次失败的做法（留档，免得重走）
 *
 * 更早的写法是把球 + 截面**直接种进草稿**再读读数，**实测走不通**：种下去的截面**不会被重算**
 *（连正圆那档都读不出 `kind`），因为**恢复路径信任保存下来的派生字段**、不会为手写草稿重跑
 * `recomputeDerivedObjects`。所以这条改成**让应用自己算**：工具栏切一刀 → 方向键挪刀口。
 */
test("walks a sphere section from an exact circle to a tangent point and then to empty", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
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
  await expect.poll(async () => (await readSphere(page))?.radius ?? null).toBe(5)

  // 选中球并从工具栏切一刀：默认过球心 ⇒ 大圆。
  const projected = await projectWorldPoint(page, SPHERE.center)
  await page.mouse.click(projected.x, projected.y)
  await page.getByRole("button", { name: "创建截面" }).click()

  const scene = page.locator("[data-3d-scene]")
  await expect(scene).toHaveAttribute("data-section-count", "1")
  await expect(scene).toHaveAttribute("data-section-exact-kind", "circle")
  await expect(scene).toHaveAttribute("data-section-plane-constant", "-3.000")

  /**
   * 方向键只在「自由拖动」开着、且选中的是截面时生效。切完那一刀应用已经把截面选上了，
   * 这里只要开模式 —— 不需要再点画布（点画布反而会把选择改掉）。
   */
  await page.getByRole("button", { name: "自由拖动" }).click()

  const step = async (times: number) => { for (let index = 0; index < times; index += 1) await page.keyboard.press("ArrowUp") }

  // 五次 × 1 单位：常数 -3 → **-8**，距离 = 半径 5 ⇒ 精确相切 ⇒ 一个可见点。
  await step(5)
  await expect(scene).toHaveAttribute("data-section-plane-constant", "-8.000")
  await expect(scene).toHaveAttribute("data-section-exact-kind", "point")
  await expect(scene).toHaveAttribute("data-section-exact-status", "exact")
  await expect(scene).toHaveAttribute("data-section-point-count", "1")

  // 再一次：**-9**，距离 6 > 5 ⇒ 空集，而且**不留上一刀那个点**。
  await step(1)
  await expect(scene).toHaveAttribute("data-section-plane-constant", "-9.000")
  await expect(scene).toHaveAttribute("data-section-exact-kind", "empty")
  await expect(scene).toHaveAttribute("data-section-point-count", "0")
})
