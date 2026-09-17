import type { Point3Binding, PrimitiveSpec } from "@draw/dsl"

/**
 * 「宿主绑定」下拉的候选与取值编码。
 *
 * 用户要求："动点的约束应该可以在立方体内"——实体因此有**两种**宿主：表面（圆柱 / 圆锥侧面）
 * 与内部（实体内）。同一个图元会出两个条目，所以 option 的值必须把"哪一种"编进去，
 * 不能只用图元 id。抽成模块是为了让"列什么、值怎么编、绑成哪种"能直接单测。
 */
export type PointHostMode = "host" | "face" | "surface" | "solid"

export interface PointHostOption {
  /** `<模式>:<图元 id>`；直接作为 `<option value>`。 */
  value: string
  primitiveId: string
  mode: PointHostMode
  label: string
}

const MODE_LABELS: Record<PointHostMode, string> = { host: "棱", face: "面", surface: "侧面", solid: "实体内" }

/** 线 / 棱 / 面这类一维、二维宿主：值里带上更准确的类型名，用户才分得清。 */
function hostLabel(primitive: PrimitiveSpec): string {
  if (primitive.type === "line3") return "直线"
  if (primitive.type === "segment3") return "线段"
  if (primitive.type === "ray3") return "射线"
  return MODE_LABELS.host
}

/**
 * 可作为动点宿主的图元。
 *
 * 模板物化出来的"影子"多面体不单独列（它属于那个实体，实体内那一条已经代表它）；
 * 用户自己搭的点驱动多面体则可以，因为它本身就是用户认得的一个实体。
 */
export function pointHostOptions(primitives: PrimitiveSpec[]): PointHostOption[] {
  const options: PointHostOption[] = []
  for (const primitive of primitives) {
    const label = primitive.label ?? primitive.id
    if (["line3", "segment3", "ray3", "edge3"].includes(primitive.type)) {
      options.push({ value: `host:${primitive.id}`, primitiveId: primitive.id, mode: "host", label: `${label}（${hostLabel(primitive)}）` })
      continue
    }
    if (primitive.type === "face3") {
      options.push({ value: `face:${primitive.id}`, primitiveId: primitive.id, mode: "face", label: `${label}（${MODE_LABELS.face}）` })
      continue
    }
    if (primitive.type === "cylinder" || primitive.type === "cone") {
      options.push({ value: `surface:${primitive.id}`, primitiveId: primitive.id, mode: "surface", label: `${label}（${primitive.type === "cylinder" ? "圆柱" : "圆锥"}${MODE_LABELS.surface}）` })
      options.push({ value: `solid:${primitive.id}`, primitiveId: primitive.id, mode: "solid", label: `${label}（${MODE_LABELS.solid}）` })
      continue
    }
    if (primitive.type === "cube" || primitive.type === "pyramid" || (primitive.type === "polyhedron3" && primitive.construction?.kind !== "template")) {
      options.push({ value: `solid:${primitive.id}`, primitiveId: primitive.id, mode: "solid", label: `${label}（${MODE_LABELS.solid}）` })
    }
  }
  return options
}

/** 当前绑定对应哪一个下拉项；自由点与无法一一对应的绑定返回空串（显示"自由点"）。 */
export function pointHostValue(binding: Point3Binding | undefined): string {
  if (!binding) return ""
  if (binding.kind === "onHost") return `host:${binding.hostId}`
  if (binding.kind === "onFace") return `face:${binding.faceId}`
  if (binding.kind === "onSurface") return `surface:${binding.solidId}`
  if (binding.kind === "inSolid") return `solid:${binding.solidId}`
  return ""
}

export function parsePointHostValue(value: string): { mode: PointHostMode; primitiveId: string } | null {
  const separator = value.indexOf(":")
  if (separator <= 0) return null
  const mode = value.slice(0, separator)
  const primitiveId = value.slice(separator + 1)
  if (!primitiveId) return null
  if (mode !== "host" && mode !== "face" && mode !== "surface" && mode !== "solid") return null
  return { mode, primitiveId }
}
