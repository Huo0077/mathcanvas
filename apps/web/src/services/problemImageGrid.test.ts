import { expect, it } from "vitest"
import { alignGridReadings, locateGrid } from "./problemImageGrid"

it("locates the cells from the intersection of visible rules and rejects ambiguous grids", () => {
  const width = 200
  const height = 100
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  const put = (x: number, y: number) => data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3)
  const draw = (offset: number) => {
    for (const y of [24, 36, 48]) for (let x = 10 + offset; x <= 46 + offset; x += 1) put(x, y)
    for (const x of [10, 22, 34, 46]) for (let y = 24; y <= 48; y += 1) put(x + offset, y)
  }
  draw(0)
  expect(locateGrid({ width, height, data }, 2, 3)).toEqual({ x: [0.05, 0.11, 0.17, 0.23], y: [0.24, 0.36, 0.48] })
  draw(80)
  expect(locateGrid({ width, height, data }, 2, 3)).toBeNull()
})

it("keeps relative cell order and discards unverified boxes when pixel decoding fails", async () => {
  const diagram = [1, 2, 3, 4].map((value, index) => {
    const x = 0.25 + (index % 2) * 0.2
    const y = 0.25 + Math.floor(index / 2) * 0.2
    return { text: String(value), image: 1, box: [x, y, x + 0.1, y + 0.1] as [number, number, number, number] }
  })
  const result = await alignGridReadings({ problem: "读下图的 2×2 方格表。", diagram, uncertainties: [] }, [{ name: "test", png: "!" }])
  expect(result.diagram.map(({ text, box }) => [text, box])).toEqual([
    ["第 1 行第 1 列：1", null], ["第 1 行第 2 列：2", null], ["第 2 行第 1 列：3", null], ["第 2 行第 2 列：4", null]
  ])
})
