import { decodeProblemImage, type ProblemImage } from "./problemImageFiles"
import type { ImageBox, ProblemImageReading } from "./problemImageReader"

type Raster = Pick<ImageData, "width" | "height" | "data">
type Rule = { position: number; start: number; end: number }

/** Get long dark rules on each scanline and merge their stroke thickness. */
function scanRules({ width, height, data }: Raster, horizontal: boolean): Rule[] {
  const extent = horizontal ? width : height
  const scanlines = horizontal ? height : width
  const minimum = Math.max(20, extent * 0.07)
  type Stroke = Rule & { first: number }
  const rules: Stroke[] = []
  let previous: Stroke[] = []
  for (let position = 0; position < scanlines; position += 1) {
    let start = -1
    const current: Stroke[] = []
    for (let offset = 0; offset <= extent; offset += 1) {
      const index = (horizontal ? position * width + offset : offset * width + position) * 4
      if (offset < extent && data[index] + data[index + 1] + data[index + 2] < 400) {
        if (start < 0) start = offset
      } else if (start >= 0) {
        if (offset - start >= minimum) {
          const stroke = previous.find(rule => Math.abs(rule.start - start) <= 3 && Math.abs(rule.end - offset) <= 3)
          if (stroke) {
            stroke.position = (stroke.first + position) / 2
            current.push(stroke)
          } else {
            const rule = { position, start, end: offset, first: position }
            rules.push(rule)
            current.push(rule)
          }
        }
        start = -1
      }
    }
    previous = current
  }
  return rules.sort((a, b) => a.position - b.position)
}

function evenlySpaced(rules: readonly Rule[]): boolean {
  const step = (rules[rules.length - 1].position - rules[0].position) / (rules.length - 1)
  return step >= 6 && rules.every((rule, index) => Math.abs(rule.position - rules[0].position - index * step) <= Math.max(2, step * 0.16))
}

/** Accept a single grid whose horizontal and vertical rules agree at the border. */
export function locateGrid(raster: Raster, rows: number, columns: number): { x: number[]; y: number[] } | null {
  const horizontal = scanRules(raster, true)
  const vertical = scanRules(raster, false)
  let grid: { x: number[]; y: number[] } | null = null
  for (const first of horizontal) {
    const tolerance = Math.max(3, (first.end - first.start) * 0.02)
    const rowRules = horizontal.filter(rule => rule.position >= first.position
      && Math.abs(rule.start - first.start) <= tolerance && Math.abs(rule.end - first.end) <= tolerance).slice(0, rows + 1)
    if (rowRules.length !== rows + 1 || !evenlySpaced(rowRules)) continue
    const bottom = rowRules[rows].position
    const columnRules = vertical.filter(rule => rule.position >= first.start - tolerance && rule.position <= first.end + tolerance
      && Math.abs(rule.start - first.position) <= tolerance && Math.abs(rule.end - bottom) <= tolerance)
    if (columnRules.length !== columns + 1 || !evenlySpaced(columnRules)
      || Math.abs(columnRules[0].position - first.start) > tolerance
      || Math.abs(columnRules[columns].position - first.end) > tolerance) continue
    if (grid) return null
    grid = {
      x: columnRules.map(rule => rule.position / raster.width),
      y: rowRules.map(rule => rule.position / raster.height)
    }
  }
  return grid
}

async function gridFromImage(image: ProblemImage, rows: number, columns: number) {
  const bitmap = await decodeProblemImage(image)
  try {
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) return null
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return locateGrid(context.getImageData(0, 0, canvas.width, canvas.height), rows, columns)
  } finally {
    bitmap.close()
  }
}

function separates(groups: readonly number[][]): boolean {
  return groups.every((group, index) => index === 0 || Math.min(...group) > Math.max(...groups[index - 1]))
}

export async function alignGridReadings(reading: ProblemImageReading, images: readonly ProblemImage[]): Promise<ProblemImageReading> {
  const dimensions = /(\d{1,2})\s*(?:[×*xX]|\\times)\s*(\d{1,2})\s*(?:的\s*)?(?:方格表|网格表|数字方格)/.exec(reading.problem.normalize("NFKC").replace(/\$/g, ""))
  if (!dimensions) return reading
  const [rows, columns] = dimensions.slice(1).map(Number)
  if (rows < 2 || columns < 2 || rows * columns > 40) return reading

  const cells = reading.diagram.flatMap((item, index) => /^[+−-]?\d+(?:\.\d+)?$/.test(item.text.normalize("NFKC").replace(/\$/g, "").trim())
    ? [{ item, index }] : [])
  if (!cells.length) return reading
  // Model positions may give relative order, but do not expose them as pixel locations.
  const diagram = [...reading.diagram]
  for (const { item, index } of cells) diagram[index] = { ...item, box: null }
  const result = { ...reading, diagram }
  const imageIndex = (cells[0].item.image ?? 0) - 1
  if (cells.length !== rows * columns || !images[imageIndex]) return result
  const positioned = cells.flatMap(cell => {
    const { box, image } = cell.item
    return box && image === imageIndex + 1 ? [{ ...cell, x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2 }] : []
  }).sort((a, b) => a.y - b.y)
  if (positioned.length !== cells.length) return result
  const byRow = Array.from({ length: rows }, (_, row) => positioned.slice(row * columns, (row + 1) * columns).sort((a, b) => a.x - b.x))
  if (!separates(byRow.map(row => row.map(cell => cell.y)))
    || !separates(Array.from({ length: columns }, (_, column) => byRow.map(row => row[column].x)))) return result

  const grid = await gridFromImage(images[imageIndex], rows, columns).catch(() => null)
  byRow.forEach((row, r) => row.forEach(({ item, index }, c) => {
    const box: ImageBox | null = grid ? [grid.x[c], grid.y[r], grid.x[c + 1], grid.y[r + 1]] : null
    diagram[index] = { ...item, text: `第 ${r + 1} 行第 ${c + 1} 列：${item.text}`, box }
  }))
  return result
}
