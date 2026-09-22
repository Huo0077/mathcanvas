import { readFileSync, readdirSync } from "node:fs"
import { basename, join } from "node:path"

import { expect, test } from "@playwright/test"

import { projectWorldPoint } from "./helpers/projection"

/**
 * **斜棱柱在真实浏览器里的完整链路**（Solid/Prism 切片 Task 5）。
 *
 * 这一条用例守的是本切片最外层的三件事：
 * 1. 一句话 → 真实协调器 → 传输校验 → 动作编译 → 草稿预览 → 用户确认 → 文档里真的多了一只棱柱；
 * 2. 棱柱**按向量拉伸**出来（斜的），而且能被整体拖走（子对象跟着走，不是各走各的）；
 * 3. 它能被剖切：`section.create` 认的"实体"包含棱柱的多面体拓扑。
 *
 * 规划器用的是**本地确定性规划器**（没有接入模型服务时的那条路径），所以这条用例不依赖任何网络。
 */

/** 画布上出现的对象数量：对象列表是唯一稳定可断言的抓手（3D 画布是 WebGL，没有 DOM 图元）。 */
function objectRows(page: import("@playwright/test").Page) {
  return page.locator(".algebra-panel .object-row")
}

async function sendPrompt(page: import("@playwright/test").Page, prompt: string) {
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

/** 走一遍"一句话 → 确认提交"，返回确认面板上报告的"会新增多少个对象"。 */
async function draftAndConfirmPrism(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await sendPrompt(page, "画一个斜棱柱")

  const draft = page.getByRole("region", { name: "确认改动" })
  await expect(draft).toBeVisible()
  await expect(draft).toContainText("确认之后会发生什么")
  // 一只四棱柱：8 顶点 + 12 棱 + 6 面 + 1 实体 = 27 个对象，**一笔动作**全部落地。
  await expect(draft).toContainText(/会新增 27 个对象/)
  await draft.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
}

/** `data-content-bounds` 的格式：`x,y,z size x,y,z`。 */
function parseBounds(bounds: string | null): number[] {
  const [centre, size] = (bounds ?? "").split(" size ")
  const values = [...(centre ?? "").split(","), ...(size ?? "").split(",")].map(Number)
  return values.length === 6 && values.every(Number.isFinite) ? values : Array<number>(6).fill(Number.NaN)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
})

/**
 * 棱柱是**斜**的：包围盒里 x 方向的跨度必须比 y 方向**大一个水平偏移**，而 y 方向又比高度大。
 *
 * 为什么不写死 5 / 4.5：`data-content-bounds` 是**画布上所有东西**的包围盒（含顶点手柄那点半径），
 * 会被渲染尺寸抬高一个零点几；而这些读数的小数位是 `.toFixed(2)` 出来的（见 `threeScene.tsx`）。
 * 写死具体数字会把"棱柱是斜的"这条性质绑在画笔尺寸上 —— 断言的应该是那个偏移本身。
 */
function expectObliqueExtents(bounds: number[]) {
  expect(bounds[3]).toBeGreaterThan(4.9)
  expect(bounds[3]).toBeLessThan(5.6)
  expect(bounds[4]).toBeGreaterThan(4.4)
  expect(bounds[4]).toBeLessThan(5.0)
  // 高度 3 是几何本身给的：斜面是水平偏移，不会把高度撑开。
  expect(bounds[5]).toBeGreaterThan(2.9)
  expect(bounds[5]).toBeLessThan(3.2)
  // 斜的关键判据：x 跨度比 y 跨度大出那个水平偏移，而 y 跨度又比高度大。
  expect(bounds[3] - bounds[4]).toBeGreaterThan(0.3)
  expect(bounds[4] - bounds[5]).toBeGreaterThan(1.2)
}

test("creates an oblique prism from one sentence and confirms only after the user says so", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  // 确认之前，画布上什么都没有：草稿是隔离的（规格 §1.2）。
  await expect(objectRows(page)).toHaveCount(0)

  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await sendPrompt(page, "画一个斜棱柱")

  const draft = page.getByRole("region", { name: "确认改动" })
  await expect(draft).toBeVisible()
  await expect(draft).toContainText(/会新增 27 个对象/)
  // 界面上不打印候选文档内容（历史缺陷：确认面板里印过整份 primitives）。
  await expect(draft).not.toContainText("basePolygon")

  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(objectRows(page)).toHaveCount(0)

  // 确认 → 真的落盘。
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await draft.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()

  /**
   * 对象列表把一只实体收成**一行**（顶点 / 棱 / 面是它的可展开子树），所以这里数的是
   * "棱柱这一行在不在"，而"几何到底有几个对象"由 3D 场景的读数回答（WebGL 画布没有 DOM 图元）。
   */
  await expect.poll(() => objectRows(page).count()).toBe(1)
  await expect(objectRows(page).first()).toContainText("solid-1")

  /**
   * 棱柱是**斜**的：顶点在 z 方向跨 3，而 `z=3` 那一层的水平位置被向量 (1, 0.5, 3) 整个挪过。
   * 包围盒尺寸因此是"底面 4×4 + 水平偏移"与高度 3 —— 直棱柱不会有那个偏移。
   */
  const scene = page.locator("[data-3d-scene]")
  expectObliqueExtents(parseBounds(await scene.getAttribute("data-content-bounds")))
})

test("moves the whole prism when it is dragged", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await draftAndConfirmPrism(page)

  const scene = page.locator("[data-3d-scene]")
  await page.getByRole("button", { name: "自由拖动" }).click()
  await expect(scene).toHaveAttribute("data-drag-mode", "true")

  // 从**实体包围盒中心**那个世界点按下：它落在棱柱自己身上，于是这一次拖动属于它。
  const before = parseBounds(await scene.getAttribute("data-content-bounds"))
  const start = await projectWorldPoint(page, { x: before[0], y: before[1], z: before[2] })
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  /**
   * 抓住的是这只棱柱的**一部分**（命中的可能是它的某个面 / 棱）：`data-drag-target` 的读数是
   * `<命中物>-><真正的拖动对象>`，而真正的拖动对象必须是实体本身 —— 子对象被单独拖走
   * 会把棱柱拆散（`templateTopologyIds` 那条纪律的棱柱版）。
   */
  await expect(scene).toHaveAttribute("data-drag-target", /->polyhedron3$/)
  await page.mouse.move(start.x + 70, start.y + 26, { steps: 6 })
  await page.mouse.up()

  // 整体平移：包围盒中心走了，尺寸一分不变（子对象跟着走，没被落在原地）。
  const after = parseBounds(await scene.getAttribute("data-content-bounds"))
  expect(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2])).toBeGreaterThan(0.2)
  expect(after[3]).toBeCloseTo(before[3], 6)
  expect(after[4]).toBeCloseTo(before[4], 6)
  expect(after[5]).toBeCloseTo(before[5], 6)

  // 一次拖动一步撤销。
  await page.keyboard.press("Control+z")
  await expect.poll(async () => {
    const restored = parseBounds(await scene.getAttribute("data-content-bounds"))
    return Math.hypot(restored[0] - before[0], restored[1] - before[1], restored[2] - before[2])
  }).toBeLessThan(0.05)
})

/**
 * **旧 `.mgeo` 夹具仍然打得开**（Solid/Prism 切片 Task 6 的第二条验收）。
 *
 * 走的是真实入口：把 e2e 目录下那批历史文件逐个交给文件输入，页面必须把它们画出来而不是报错
 * （`decodeMgeo` 对不合法文档是 `throw`，打开失败会直接显示错误横幅）。
 * 这些夹具覆盖了模板实体、点驱动的多面体、截面、CAD 图层 —— 正是"给构造描述加了 `prism` 一支
 * 之后最容易被顺手判非法"的那批文档。
 *
 * **M3（评审）：每个夹具都必须等一个"真的装进去了"的正面信号，再断言没有报错。**
 * 只断言 `role="alert"` 数量为 0 会**空过**：文件读取是异步的（`file.text().then(load)`），
 * `setInputFiles` 立刻返回，断言跑在解码之前 —— 最后一个夹具即使解不开也会通过。
 *
 * 这里的正面信号取**页面自己写回的草稿**（`localStorage["mathcanvas:draft:<workspace>"]`，
 * 见 `persistence/draftStorage.ts`）：只有 `load` 真的把这份文档装进 store、store 再存了一次草稿，
 * 那个键才会变成这只夹具的 id 列表。解码失败时它根本不会被写，轮询会超时。
 * 这条信号与工作区无关（立体 / 平面 / CAD 都走同一条持久化），也不依赖某个画布的可见性细节。
 */
test("opens every shipped .mgeo fixture and actually loads it", async ({ page }) => {
  const directory = join(process.cwd(), "e2e", "fixtures")
  const fixtures = readdirSync(directory).filter((name) => name.endsWith(".mgeo"))
  // 数与内容都对一遍：目录里少一个文件也不该让这条静默变松。
  // 14 = 12 只既有夹具 + `reactive-dynamic-objects.mgeo` + `reactive-section.mgeo`（Reactive DAG 切片新增）。
  expect(fixtures.length).toBe(14)

  await page.goto("/")
  const fileInput = page.locator('input[aria-label="加载 .mgeo 文件"]')
  const scene = page.locator("[data-3d-scene]")

  for (const name of fixtures) {
    const serialized = readFileSync(join(directory, name), "utf8")
    const parsed = JSON.parse(serialized) as { document: { workspace: string; primitives: { id: string }[] } }
    const workspace = parsed.document.workspace
    const expectedIds = parsed.document.primitives.map((primitive) => primitive.id)

    /**
     * 工作区先切到位：切工作区本身也会写回草稿（那正是这个信号的载体），
     * 所以"目标工作区的那份草稿等于这只夹具"只可能由**这次加载**造成。
     */
    await page.getByRole("button", { name: workspace === "geometry3d" ? "跳转到立体几何" : workspace === "cad" ? "跳转到工程制图" : "跳转到平面几何" }).click()

    await fileInput.setInputFiles({ name: basename(name), mimeType: "application/json", buffer: Buffer.from(serialized) })

    /**
     * 正面信号：页面自己写回的草稿**以这只夹具的 id 列表开头，顺序一致**。
     *
     * 为什么是"开头"而不是"全等"：打开走的是 `migrateLegacySolids(decodeMgeo(...))`
     * （`App.tsx` 的 `load`），它会把模板实体的子对象**物化并追加**到文档末尾。
     * 所以落库的 id 列表 = 夹具自己的图元（原序）＋迁移补出来的子对象。
     * 这个"多出来的尾巴"本身就是证据：它证明这份文件真的被解码、迁移、装进 store 又存了回来。
     */
    const readSavedIds = (key: string) => page.evaluate((storageKey) => {
      const stored = window.localStorage.getItem(storageKey)
      if (!stored) return [] as string[]
      try {
        const parsedDraft = JSON.parse(stored) as { document?: { primitives?: { id: string }[] } }
        return (parsedDraft.document?.primitives ?? []).map((primitive) => primitive.id)
      } catch {
        return [] as string[]
      }
    }, key)

    await expect.poll(async () => (await readSavedIds(`mathcanvas:draft:${workspace}`)).slice(0, expectedIds.length), { message: `${name} must be the document the page is holding` }).toEqual(expectedIds)

    // 它还得真的画出来：立体几何看 3D 场景里有没有内容，其它工作区看对象列表有没有行。
    if (workspace === "geometry3d") await expect(scene).not.toHaveAttribute("data-content-bounds", "empty")
    else await expect.poll(() => page.locator(".algebra-panel .object-row").count(), { message: `${name} must leave rows on the canvas` }).toBeGreaterThan(0)

    // 正面的加载信号到手之后，才轮到"没有报错"这条断言。
    await expect(page.getByRole("alert"), `loading ${name} must not show an error`).toHaveCount(0)
  }
})

/**
 * 上一条用例的**负控**：把一个解不开的 `.mgeo` 交给同一个入口，页面必须报错。
 *
 * 没有这一条，"夹具都打得开"就无从证明不是空过 —— 只要那条用例的信号是假的，
 * 它对着**任何**输入（包括垃圾）都会绿。这里把"坏输入必须留下错误"钉住，
 * 于是上一条的"好输入没有错误"才有了意义（评审 M3 要求的正是这一点）。
 */
test("refuses an unreadable .mgeo instead of pretending it loaded", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  await page.locator('input[aria-label="加载 .mgeo 文件"]').setInputFiles({
    name: "broken.mgeo",
    mimeType: "application/json",
    // 结构合法但图元非法：`decodeMgeo` 会在 `validateDocument` 这一步抛错。
    buffer: Buffer.from(JSON.stringify({ format: "mgeo", formatVersion: "0.1", document: { schemaVersion: "0.1", revision: 0, workspace: "geometry3d", coordinateSystems: ["cartesian-3d"], parameters: {}, primitives: [{ id: "point-1", type: "point3", position: { x: 1, y: 2, z: Number.NaN } }], groups: [], constraints: [], dynamics: [], annotations: [], measurements: [], metadata: { id: "doc-broken", name: "Broken", createdAt: "2026-09-21T00:00:00.000Z", updatedAt: "2026-09-21T00:00:00.000Z" } } }))
  })

  // 报错必须真的出现（这条是上一条"没有报错"断言的对照）。
  await expect(page.getByRole("alert")).toBeVisible()
  // 而且坏文档**没有**被写回草稿：页面手里仍然是那份空文档。
  await expect.poll(async () => page.evaluate(() => {
    const stored = window.localStorage.getItem("mathcanvas:draft:geometry3d")
    if (!stored) return -1
    const parsedDraft = JSON.parse(stored) as { document?: { primitives?: unknown[] } }
    return parsedDraft.document?.primitives?.length ?? -1
  })).toBe(0)
})

test("cuts a section through the oblique prism", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await draftAndConfirmPrism(page)

  const scene = page.locator("[data-3d-scene]")
  // 提交之后没有自动选中任何对象（Agent 只改文档、不动选择），所以先点对象列表里的那一行。
  await objectRows(page).first().click()
  await expect(objectRows(page).first()).toHaveClass(/selected/)
  await page.getByRole("button", { name: "创建截面" }).click()
  await expect(scene).toHaveAttribute("data-section-count", "1")
  // 默认刀口是水平的、过实体中心的，四棱柱的截面是四边形。
  await expect(scene).toHaveAttribute("data-section-point-count", "4")

  // 把刀口摆斜 45°：仍然切得出多边形（截面不是空的、也没退化成一条棱）。
  for (let step = 0; step < 3; step += 1) await page.getByRole("button", { name: "绕 X 轴旋转剖切面 +15°" }).click()
  const normal = (await scene.getAttribute("data-section-plane-normal"))!.split(",").map(Number)
  expect(Math.abs(normal[1])).toBeCloseTo(Math.sin(Math.PI / 4), 2)
  expect(normal[2]).toBeCloseTo(Math.cos(Math.PI / 4), 2)
  await expect.poll(async () => Number(await scene.getAttribute("data-section-point-count"))).toBeGreaterThanOrEqual(3)
})
