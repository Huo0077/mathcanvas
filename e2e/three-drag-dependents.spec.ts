import { createEmptyDocument, encodeMgeo } from "@draw/dsl"
import { expect, test, type Page } from "@playwright/test"
import { buildSolidTemplate } from "@draw/geometry-kernel"
import { recomputeDerivedObjects } from "@draw/scene-graph"
import { projectWorldPoint } from "./helpers/projection"

async function labelPosition(page: Page, id: string) {
  return page.locator(`.three-point-label[data-point-id="${id}"]`).evaluate(element => ({
    x: parseFloat((element as HTMLElement).style.left),
    y: parseFloat((element as HTMLElement).style.top)
  }))
}

for (const kind of ["line", "segment", "ray"] as const) {
  test(`live ${kind} dependencies follow the endpoint before mouse release`, async ({ page }, testInfo) => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "a", type: "point3", label: "A", position: { x: 0, y: 0, z: 0 } },
      { id: "b", type: "point3", label: "B", position: { x: 5, y: 3, z: 0 } },
      kind === "line"
        ? { id: "track", type: "line3", definition: { kind: "throughPoints", pointIds: ["a", "b"] } }
        : kind === "ray"
          ? { id: "track", type: "ray3", originId: "a", throughId: "b" }
          : { id: "track", type: "segment3", pointIds: ["a", "b"] },
      { id: "c", type: "point3", label: "C", position: { x: 2.5, y: 1.5, z: 0 }, binding: { kind: "onHost", hostId: "track", parameter: 0.5 } },
      { id: "next", type: "segment3", pointIds: ["c", "b"] },
      { id: "d", type: "point3", label: "D", position: { x: 3.75, y: 2.25, z: 0 }, binding: { kind: "onHost", hostId: "next", parameter: 0.5 } }
    ]
    await page.goto("/")
    await page.getByLabel("加载 .mgeo 文件").setInputFiles({ name: "live-follow.mgeo", mimeType: "application/json", buffer: Buffer.from(encodeMgeo(document)) })
    const start = await projectWorldPoint(page, { x: 0, y: 0, z: 0 })
    const before = await labelPosition(page, "c")
    const beforeD = await labelPosition(page, "d")
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + 80, start.y - 30, { steps: 12 })
    const during = await labelPosition(page, "c")
    const duringD = await labelPosition(page, "d")
    expect(Math.hypot(during.x - before.x, during.y - before.y)).toBeGreaterThan(8)
    expect(Math.hypot(duringD.x - beforeD.x, duringD.y - beforeD.y)).toBeGreaterThan(3)
    await page.screenshot({ path: testInfo.outputPath("before-release.png") })
    await page.mouse.up()
    await expect.poll(() => labelPosition(page, "c")).toEqual(during)
    await expect.poll(() => labelPosition(page, "d")).toEqual(duringD)
    await page.getByRole("button", { name: "撤销", exact: true }).click()
    await expect.poll(() => labelPosition(page, "c")).toEqual(before)
    await expect.poll(() => labelPosition(page, "d")).toEqual(beforeD)
  })
}


for (const kind of ["face", "cube", "cylinder", "cone"] as const) {
  test(`live ${kind} dependencies update before release and undo once`, async ({ page }) => {
    let document = createEmptyDocument("geometry3d")
    let startWorld: { x: number; y: number; z: number }
    if (kind === "face") {
      document.primitives = [
        { id: "a", type: "point3", label: "A", position: { x: 0, y: 0, z: 0 } },
        { id: "b", type: "point3", position: { x: 5, y: 0, z: 0 } },
        { id: "e", type: "point3", position: { x: 0, y: 5, z: 0 } },
        { id: "face", type: "face3", pointIds: ["a", "b", "e"] },
        { id: "c", type: "point3", label: "C", position: { x: 1, y: 1, z: 0 }, binding: { kind: "onFace", faceId: "face", uv: [1, 1] } }
      ]
      startWorld = { x: 0, y: 0, z: 0 }
    } else {
      const solid = kind === "cube"
        ? { id: "solid", type: kind, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
        : { id: "solid", type: kind, center: { x: 0, y: 0, z: -2 }, radius: 2, height: 4, segments: 16 }
      document.primitives = [solid, ...buildSolidTemplate(solid).primitives,
        { id: "c", type: "point3", label: "C", position: { x: 0, y: 0, z: 0 }, binding: { kind: "inSolid", solidId: "solid", uvw: [0.4, 0.6, 0.5] } }
      ]
      startWorld = kind === "cube" ? { x: 0.7, y: 2, z: 0.3 } : { x: 1.3, y: kind === "cone" ? 0.7 : 1.5, z: -1.1 }
    }
    document.primitives.push(
      { id: "fixed", type: "point3", position: { x: 4, y: 3, z: 3 } },
      { id: "next", type: "segment3", pointIds: ["c", "fixed"] },
      { id: "d", type: "point3", label: "D", position: { x: 0, y: 0, z: 0 }, binding: { kind: "onHost", hostId: "next", parameter: 0.5 } }
    )
    document = recomputeDerivedObjects(document)
    await page.goto("/")
    await page.getByLabel("\u52a0\u8f7d .mgeo \u6587\u4ef6").setInputFiles({ name: "live-solid.mgeo", mimeType: "application/json", buffer: Buffer.from(encodeMgeo(document)) })
    if (kind !== "face") await page.getByRole("button", { name: "\u81ea\u7531\u62d6\u52a8" }).click()
    const start = await projectWorldPoint(page, startWorld)
    const before = await labelPosition(page, "c"), beforeD = await labelPosition(page, "d")
    const errors: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    if (kind !== "face") await expect(page.locator("[data-3d-scene]")).toHaveAttribute("data-drag-target", new RegExp(`->${kind}$`))
    await page.mouse.move(start.x + 70, start.y - 25, { steps: 10 })
    const during = await labelPosition(page, "c"), duringD = await labelPosition(page, "d")
    expect(Math.hypot(during.x - before.x, during.y - before.y)).toBeGreaterThan(4)
    expect(Math.hypot(duringD.x - beforeD.x, duringD.y - beforeD.y)).toBeGreaterThan(2)
    await page.mouse.up()
    await expect.poll(() => labelPosition(page, "c")).toEqual(during)
    await expect.poll(() => labelPosition(page, "d")).toEqual(duringD)
    await page.getByRole("button", { name: "\u64a4\u9500", exact: true }).click()
    await expect.poll(() => labelPosition(page, "c")).toEqual(before)
    await expect.poll(() => labelPosition(page, "d")).toEqual(beforeD)
    expect(errors).toEqual([])
  })
}
