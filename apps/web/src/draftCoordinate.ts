import type { DraftPoint } from "./drafting"

/**
 * 命令行/动态输入的解析：这是「画得准」的最后一段路——拖得再准也不如直接敲数字。
 *
 * 支持 AutoCAD 的三种写法：
 * - 绝对坐标 `12,34`（也接受空格分隔与全角逗号，中文输入法下不用切输入法）
 * - 相对坐标 `@10,5`（相对上一个落点）
 * - 极坐标 `@10<90`（相对上一个落点，距离 10、角度 90°）
 *
 * 相对/极坐标**必须有基点**：没有基点时报错，而不是悄悄按原点算。
 */
export type DraftCoordinateResult = { ok: true; point: DraftPoint } | { ok: false; error: string }

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/

function parseNumber(raw: string): number | null {
  const text = raw.trim()
  if (!NUMBER.test(text)) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/** 全角逗号/分号也当分隔符，容忍中文输入法。 */
function splitPair(input: string): [string, string] | null {
  const parts = input.split(/[,，]/)
  if (parts.length !== 2) return null
  return [parts[0], parts[1]]
}

export function parseDraftCoordinate(input: string, context: { last?: DraftPoint | null } = {}): DraftCoordinateResult {
  const text = input.trim().replace(/\s+/g, " ")
  if (!text) return { ok: false, error: "请输入坐标，例如 10,20 或 @10,5" }
  const relative = text.startsWith("@")
  if (relative && !context.last) return { ok: false, error: "相对/极坐标需要先有一个基点" }
  const body = relative ? text.slice(1) : text
  if (!body) return { ok: false, error: "坐标不完整，例如 @10,5" }
  const origin = context.last ?? { x: 0, y: 0 }

  if (body.includes("<")) {
    const [distanceRaw, angleRaw] = body.split("<")
    const distance = parseNumber(distanceRaw.replace(",", ""))
    const angle = parseNumber(angleRaw)
    if (distance === null || angle === null) return { ok: false, error: "极坐标格式应为 @距离<角度，例如 @20<45" }
    if (distance <= 0) return { ok: false, error: "极坐标的距离要大于 0" }
    const radians = (angle * Math.PI) / 180
    return { ok: true, point: { x: origin.x + distance * Math.cos(radians), y: origin.y + distance * Math.sin(radians) } }
  }

  const pair = splitPair(body) ?? (body.includes(" ") ? (body.split(" ") as [string, string]) : null)
  if (!pair || pair.length !== 2) return { ok: false, error: "坐标格式应为 x,y，例如 10,20" }
  const x = parseNumber(pair[0])
  const y = parseNumber(pair[1])
  if (x === null || y === null) return { ok: false, error: "坐标必须是数字，例如 10,20" }
  return { ok: true, point: relative ? { x: origin.x + x, y: origin.y + y } : { x, y } }
}

export type DraftNumberResult = { ok: true; value: number } | { ok: false; error: string }

/** 动态输入的长度字段：必须是正数。 */
export function parseDraftDistance(input: string): DraftNumberResult {
  const value = parseNumber(input)
  if (value === null) return { ok: false, error: "长度必须是数字" }
  if (value <= 0) return { ok: false, error: "长度要大于 0" }
  return { ok: true, value }
}

/** 动态输入的角度字段：任意有限角度，归一化到 0–360。 */
export function parseDraftAngle(input: string): DraftNumberResult {
  const value = parseNumber(input)
  if (value === null) return { ok: false, error: "角度必须是数字" }
  return { ok: true, value: ((value % 360) + 360) % 360 }
}

/** 只改长度、保留当前方向（指针压在锚点上时退回 +x，避免除零）。 */
export function applyDistance(anchor: DraftPoint, pointer: DraftPoint, distance: number): DraftPoint {
  const delta = { x: pointer.x - anchor.x, y: pointer.y - anchor.y }
  const length = Math.hypot(delta.x, delta.y)
  if (length < 1e-9) return { x: anchor.x + distance, y: anchor.y }
  return { x: anchor.x + (delta.x / length) * distance, y: anchor.y + (delta.y / length) * distance }
}

/** 只改角度、保留当前长度。 */
export function applyAngle(anchor: DraftPoint, pointer: DraftPoint, angleDegrees: number): DraftPoint {
  const distance = Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y)
  const radians = (angleDegrees * Math.PI) / 180
  return { x: anchor.x + distance * Math.cos(radians), y: anchor.y + distance * Math.sin(radians) }
}

/** 读数用的紧凑格式：最多三位小数，整数不带小数点。 */
export function formatDraftCoordinate(point: DraftPoint): string {
  const round = (value: number) => Number(value.toFixed(3))
  return `${round(point.x)}, ${round(point.y)}`
}
