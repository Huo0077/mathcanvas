import { expect, test } from "@playwright/test"

/**
 * **Task 13（2026-10-12）：原用户那道题，从输入到真实画布。**
 *
 * 逐字就是现场那一句（"连发 7 次、7 次死因各不相同"）：
 * > 平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。点E在AD上，且AE:AD=2:5；
 * > 点F在AB上，且AF:AB=1:2。将三角形AEF沿EF翻折至三角形PEF，使得PC=4√3。
 *
 * ## 这条 e2e 真正要证的是什么
 *
 * 夹具把**折角填成 30°（错的）**，而题面里**根本没有折角** —— 所以浏览器里
 * "题设核验 `passed`"就只可能是因为 **Task 12 的折角反求**按 `PC=4√3` 把角算出来并换掉了它。
 * 于是这一条同时钉住三段链路：**四边形五条条件**（真坐标）→ **`E`/`F` 定比分点** →
 * **折角反求**，最后落到真实草稿上。
 *
 * 判据一律**自己从落盘坐标算**，不读面板结论（拿系统自己的判断证明系统自己等于没证）。
 */

const USER_FOLD = [
  "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。",
  "点E在AD上，且AE:AD=2:5；点F在AB上，且AF:AB=1:2。",
  "将三角形AEF沿EF翻折至三角形PEF，使得PC=4√3。"
].join("")

async function openAgent(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "传统工作区" }).click()
  await page.getByRole("button", { name: "跳转到立体几何" }).click()
  await page.getByRole("button", { name: "Agent 工作区" }).click()
}

interface Vec3 { x: number; y: number; z: number }

async function namedPoints(page: import("@playwright/test").Page): Promise<Record<string, Vec3>> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("mathcanvas:draft:geometry3d")
    if (!raw) throw new Error("提交之后草稿仍然为空")
    const parsed = JSON.parse(raw) as { document?: { primitives?: unknown[] } }
    const primitives = (parsed.document?.primitives ?? []) as { type: string; label?: string; position?: Vec3 }[]
    const points: Record<string, Vec3> = {}
    for (const primitive of primitives) {
      if (primitive.type !== "point3") continue
      if (typeof primitive.label !== "string" || !/^[A-Z]$/.test(primitive.label)) continue
      if (!primitive.position) continue
      points[primitive.label] = primitive.position
    }
    return points
  })
}

const distance = (left: Vec3, right: Vec3): number => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test("draws the user's folded quadrilateral from the sentence alone, and PC=4√3 holds on the committed figure", async ({ page }) => {
  await openAgent(page)
  await page.getByRole("textbox", { name: "对话输入" }).fill(USER_FOLD)
  await page.getByRole("button", { name: "发送" }).click()

  const panel = page.getByRole("region", { name: "确认改动" }).last()
  await expect(panel).toBeVisible({ timeout: 30000 })
  // ① 核验真的跑了，而且**题面那几条**都进了核验（不是"整句读不懂"）。
  const verification = panel.getByRole("region", { name: "题设核验" })
  await expect(verification).toHaveAttribute("data-status", "passed")
  for (const clause of ["AB=8", "AD=5√3", "∠BAD=30°", "∠ADC=90°", "CD=3", "AE:AD=2:5", "AF:AB=1:2", "PC=4√3"]) {
    await expect(verification).toContainText(clause)
  }
  // ② 折角是**求出来的**，必须说给用户听（题面没给过它）。
  await expect(panel.locator(".agent-assumptions")).toContainText("反求")

  await panel.getByRole("button", { name: "确认并提交" }).click()
  await expect(page.getByText("已提交")).toBeVisible()
  await page.getByRole("button", { name: "返回画布" }).click()
  await expect(page.locator("[data-3d-scene]")).toBeVisible()

  const points = await namedPoints(page)
  // 七个点名：A B C D E F P。
  expect(Object.keys(points).sort()).toEqual(["A", "B", "C", "D", "E", "F", "P"])
  const { A, B, C, D, E, F, P } = points as Record<string, Vec3>

  // ③ **八条题设逐条自算**（不读面板结论）。
  expect(distance(A, B), "AB").toBeCloseTo(8, 6)
  expect(distance(A, D), "AD").toBeCloseTo(5 * Math.sqrt(3), 6)
  expect(distance(C, D), "CD").toBeCloseTo(3, 6)
  expect(distance(A, E) / distance(A, D), "AE:AD").toBeCloseTo(2 / 5, 6)
  expect(distance(A, F) / distance(A, B), "AF:AB").toBeCloseTo(1 / 2, 6)
  // 折角求出来之后 `PC` 必须真的是 `4√3`（这是那条反求的**唯一**判据）。
  expect(distance(P, C), "PC").toBeCloseTo(4 * Math.sqrt(3), 6)

  const angle = (vertex: Vec3, first: Vec3, second: Vec3): number => {
    const u = { x: first.x - vertex.x, y: first.y - vertex.y, z: first.z - vertex.z }
    const v = { x: second.x - vertex.x, y: second.y - vertex.y, z: second.z - vertex.z }
    const cosine = (u.x * v.x + u.y * v.y + u.z * v.z) / (Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z))
    return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI
  }
  expect(angle(A, B, D), "∠BAD").toBeCloseTo(30, 4)
  expect(angle(D, A, C), "∠ADC").toBeCloseTo(90, 4)

  // ④ 折是**刚体**的：折痕上的 E、F 一点没动，`|PE| = |AE|`（折前那条边）。
  expect(distance(P, E), "|PE| = |AE|").toBeCloseTo(distance(A, E), 6)
  expect(distance(P, F), "|PF| = |AF|").toBeCloseTo(distance(A, F), 6)

  // ⑤ **一步撤销**回到提交前（图上没有这些点了）。
  await page.keyboard.press("Control+z")
  await expect.poll(async () => Object.keys(await namedPoints(page)).length).toBe(0)

  await page.screenshot({ path: "test-results/task13-user-fold.png" })
})
