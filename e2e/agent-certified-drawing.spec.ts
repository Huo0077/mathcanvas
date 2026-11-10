import { expect, test, type Page } from "@playwright/test"
import { commandButton } from "./command-menu"

/** Frozen development regressions, NOT a blind holdout or a provider success-rate denominator. */
const CASES = [
  { id: "case-1", prompt: "如图，在四棱锥P-ABCD中，底面ABCD为直角梯形，AB∥CD，AD⊥AB，PA⊥底面ABCD，PA=AB=AD=2，CD=1。点E为棱PB的中点。求证：AE⊥平面PBC；求直线PC与平面ADE所成角的正弦值。", givens: ["AB∥CD", "AD⊥AB", "CD=1", "E为棱PB的中点"] },
  { id: "case-2", prompt: "如图，在正三棱柱ABC-A₁B₁C₁中，底面边长AB=2，侧棱长AA₁=3。点D为棱AC的中点，点E在棱BB₁上，且BE=1。证明：A₁C∥平面B₁DE；求二面角A-DE-B₁的余弦值。", givens: ["AB=2", "AA₁=3", "D为棱AC的中点", "BE=1"] },
  { id: "case-3", prompt: "如图，在四棱锥P-ABCD中，底面ABCD是边长为2的菱形，∠BAD=60°，AC与BD相交于点O。PO⊥平面ABCD，PO=√3。点M为棱PC的中点。证明：PA∥平面BDM；求点A到平面PBD的距离。", givens: ["底面ABCD是边长为2的菱形", "∠BAD=60°", "PO=√3", "M为棱PC的中点"] },
  { id: "case-4-original", prompt: "如图，在直角梯形ABCD中，AB∥CD，AD⊥AB，AB=2，AD=CD=1。将△ACD沿AC折起成△PAC，使得平面PAC⊥平面ABC。点M为PB的中点。证明：AP⊥CD；求二面角P-AB-C的大小。", givens: ["AB∥CD", "AD⊥AB", "AB=2", "M为PB的中点"] }
] as const

async function ask(page: Page, prompt: string) {
  await page.addInitScript(() => localStorage.clear())
  await page.goto("/")
  await page.getByRole("button", { name: "Agent 工作区" }).click()
  await page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
  await page.getByRole("button", { name: "发送" }).click()
}

type Vec3 = { x: number; y: number; z: number }
async function committedPoints(page: Page): Promise<Record<string, Vec3>> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("mathcanvas:draft:geometry3d")
    if (!raw) throw new Error("missing committed 3D document")
    const parsed = JSON.parse(raw) as { document?: { primitives?: { type: string; label?: string; position?: Vec3 }[] } }
    return Object.fromEntries((parsed.document?.primitives ?? []).filter(item => item.type === "point3" && item.label && item.position)
      .map(item => [item.label!, item.position!]))
  })
}
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const norm = (a: Vec3) => Math.hypot(a.x, a.y, a.z)
const parallelError = (a: Vec3, b: Vec3) => norm(cross(a, b)) / (norm(a) * norm(b))
const perpendicularError = (a: Vec3, b: Vec3) => Math.abs(dot(a, b)) / (norm(a) * norm(b))

const midpointError = (a: Vec3, b: Vec3, mid: Vec3) => Math.hypot(mid.x - (a.x + b.x) / 2, mid.y - (a.y + b.y) / 2, mid.z - (a.z + b.z) / 2)
function independentGivenCheck(id: string, points: Record<string, Vec3>) {
  const at = (name: string) => { const point = points[name]; if (!point) throw Error("missing point " + name); return point }
  if (id === "case-1") {
    expect(distance(at("P"), at("A"))).toBeCloseTo(2, 6)
    expect(distance(at("A"), at("B"))).toBeCloseTo(2, 6)
    expect(distance(at("A"), at("D"))).toBeCloseTo(2, 6)
    expect(distance(at("C"), at("D"))).toBeCloseTo(1, 6)
    expect(midpointError(at("P"), at("B"), at("E"))).toBeLessThan(1e-6)
    expect(parallelError(sub(at("B"), at("A")), sub(at("D"), at("C")))).toBeLessThan(1e-6)
    expect(perpendicularError(sub(at("D"), at("A")), sub(at("B"), at("A")))).toBeLessThan(1e-6)
    expect(perpendicularError(sub(at("P"), at("A")), sub(at("B"), at("A")))).toBeLessThan(1e-6)
    expect(perpendicularError(sub(at("P"), at("A")), sub(at("D"), at("A")))).toBeLessThan(1e-6)
  } else if (id === "case-2") {
    expect(distance(at("A"), at("B"))).toBeCloseTo(2, 6)
    expect(distance(at("A"), at("A₁"))).toBeCloseTo(3, 6)
    expect(midpointError(at("A"), at("C"), at("D"))).toBeLessThan(1e-6)
    expect(distance(at("B"), at("E"))).toBeCloseTo(1, 6)
    expect(distance(at("B"), at("C"))).toBeCloseTo(2, 6)
    expect(distance(at("C"), at("A"))).toBeCloseTo(2, 6)
    expect(parallelError(sub(at("B₁"), at("B")), sub(at("A₁"), at("A")))).toBeLessThan(1e-6)
    expect(perpendicularError(sub(at("A₁"), at("A")), sub(at("B"), at("A")))).toBeLessThan(1e-6)
    expect(perpendicularError(sub(at("A₁"), at("A")), sub(at("C"), at("A")))).toBeLessThan(1e-6)
    expect(parallelError(sub(at("E"), at("B")), sub(at("B₁"), at("B")))).toBeLessThan(1e-6)
  } else if (id === "case-3") {
    expect(distance(at("A"), at("B"))).toBeCloseTo(2, 6)
    expect(distance(at("P"), at("O"))).toBeCloseTo(Math.sqrt(3), 6)
    expect(midpointError(at("P"), at("C"), at("M"))).toBeLessThan(1e-6)
    expect(midpointError(at("A"), at("C"), at("O"))).toBeLessThan(1e-6)
    expect(midpointError(at("B"), at("D"), at("O"))).toBeLessThan(1e-6)
    for (const [first, last] of [["B", "C"], ["C", "D"], ["D", "A"]]) expect(distance(at(first!), at(last!))).toBeCloseTo(2, 6)
    expect(dot(sub(at("B"), at("A")), sub(at("D"), at("A"))) / (distance(at("A"), at("B")) * distance(at("A"), at("D")))).toBeCloseTo(0.5, 6)
    expect(perpendicularError(sub(at("P"), at("O")), sub(at("B"), at("A")))).toBeLessThan(1e-6)
    expect(perpendicularError(sub(at("P"), at("O")), sub(at("D"), at("A")))).toBeLessThan(1e-6)
  } else if (id === "case-4-original") {
    expect(distance(at("A"), at("B"))).toBeCloseTo(2, 6)
    expect(distance(at("A"), at("D"))).toBeCloseTo(1, 6)
    expect(distance(at("C"), at("D"))).toBeCloseTo(1, 6)
    expect(midpointError(at("P"), at("B"), at("M"))).toBeLessThan(1e-6)
    expect(parallelError(sub(at("B"), at("A")), sub(at("D"), at("C")))).toBeLessThan(1e-6)
    expect(perpendicularError(sub(at("D"), at("A")), sub(at("B"), at("A")))).toBeLessThan(1e-6)
    expect(distance(at("A"), at("P"))).toBeCloseTo(distance(at("A"), at("D")), 6)
    expect(distance(at("C"), at("P"))).toBeCloseTo(distance(at("C"), at("D")), 6)
    const fixedNormal = cross(sub(at("B"), at("A")), sub(at("C"), at("A")))
    const foldedNormal = cross(sub(at("P"), at("A")), sub(at("C"), at("A")))
    expect(perpendicularError(fixedNormal, foldedNormal)).toBeLessThan(1e-6)
  }
}

test.describe("W5 host-certified drawing boundary (deterministic development fixtures)", () => {
  for (const entry of CASES) {
    test(entry.id + " exposes source-bound givens, commits once, then undoes once", async ({ page }) => {
      await ask(page, entry.prompt + "请画题设示意图。")
      const status = page.getByRole("region", { name: "运行状态" }).locator(".agent-run-state")
      await expect(status).toHaveText("等待你确认")
      const verification = page.getByRole("region", { name: "题设核验" })
      await expect(verification).toHaveAttribute("data-status", "passed")
      await expect(verification).toHaveAttribute("data-proof-scope", "figure-instance")
      await expect(verification).toHaveAttribute("data-universal-claims", "not-proven")
      for (const source of entry.givens) await expect(verification).toContainText(source)
      await expect(verification.locator("li")).not.toHaveCount(0)
      await expect(verification).not.toContainText("未核验 1")
      const confirm = page.getByRole("button", { name: "确认并提交" })
      await expect(confirm).toBeEnabled()
      await confirm.click()
      await expect(status).toHaveText("已提交")
      await expect(confirm).toHaveCount(0)
      await page.getByRole("button", { name: "返回画布" }).click()
      const objects = page.locator(".algebra-panel .object-row")
      await expect.poll(() => objects.count()).toBeGreaterThan(0)
      independentGivenCheck(entry.id, await committedPoints(page))
      await page.keyboard.press("Control+z")
      await expect(objects).toHaveCount(0)
    })
  }


  test("editing the live scene expires the pending certificate and hides confirmation", async ({ page }) => {
    await ask(page, CASES[0].prompt + "请画题设示意图。")
    await expect(page.getByRole("button", { name: "确认并提交" })).toBeEnabled()
    await page.getByRole("button", { name: "返回画布" }).click()
    // The draft banner overlaps this ribbon button visually; keyboard activation still exercises the real UI.
    await (await commandButton(page, "添加空间点")).focus()
    await page.keyboard.press("Space")
    await expect(page.locator(".algebra-panel .object-row")).toHaveCount(1)
    await page.getByRole("button", { name: "Agent 工作区" }).click()
    await expect(page.getByRole("button", { name: "确认并提交" })).toHaveCount(0)
    await expect(page.getByRole("region", { name: "题设核验" })).toContainText("已过期")
    await page.getByRole("button", { name: "返回画布" }).click()
    await expect(page.locator(".algebra-panel .object-row")).toHaveCount(1)
  })

  test("extra inconsistent given cannot create a confirmable draft or mutate the scene", async ({ page }) => {
    await ask(page, CASES[0].prompt + "且 CD=9。请画题设示意图。")
    await expect(page.getByRole("region", { name: "运行状态" }).locator(".agent-run-state")).toHaveText("没有完成")
    await expect(page.getByRole("button", { name: "确认并提交" })).toHaveCount(0)
    await page.getByRole("button", { name: "返回画布" }).click()
    await expect(page.locator(".algebra-panel .object-row")).toHaveCount(0)
  })
})
