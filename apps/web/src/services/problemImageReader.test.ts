import { expect, it } from "vitest"
import { parseProblemImageReading } from "./problemImageReader"

it("rejects evidence that cannot be mapped to the submitted images", () => {
  const reading = {
    problem: "求 AC。",
    diagram: [{ text: "角 A 有直角标记", image: 2, box: [0.1, 0.1, 0.4, 0.4] }],
    uncertainties: []
  }
  expect(parseProblemImageReading(JSON.stringify(reading), 1)).toBeNull()
  expect(parseProblemImageReading(JSON.stringify(reading), 2)).toEqual(reading)
  reading.diagram[0].box = [0.4, 0.1, 0.1, 0.4]
  expect(parseProblemImageReading(JSON.stringify(reading), 2)).toBeNull()
})
