/**
 * **创建会话里悬停落点的读数**（设计规格 §5.2：悬停要标出目标、世界坐标与"在哪张工作平面上"）。
 *
 * 一个字符串说完三件事，不多不少：
 *   1. **吸附到了什么**（已有点 / 棱或线 / 面 / 工作平面）——这决定"点下去会引用谁"；
 *   2. **世界坐标**（两位小数，与画布其余读数同一口径）；
 *   3. **落在哪张工作平面上** —— 只在"工作平面"这一类里说。吸附到已有点 / 棱 / 面时，
 *      位置由那个对象决定，再说一句工作平面会让人以为它参与了定位（那是假话）。
 * 被拒绝时（视线与工作面近平行、指针在画布外）**如实给原因**，不编一个落点。
 */
import type { SpatialPickResult, WorkPlane } from "./spatialPick"

const SOURCE_LABELS: Record<"point" | "edge" | "face" | "work-plane", string> = {
  point: "已有点",
  edge: "棱 / 线",
  face: "面",
  "work-plane": "工作平面"
}

/** 工作平面的名字：前三个是显式切换的坐标平面，第四个是"拿选中面当工作面"。 */
export function workPlaneLabel(workPlane: WorkPlane): string {
  if (workPlane === "xy") return "XY"
  if (workPlane === "xz") return "XZ"
  if (workPlane === "yz") return "YZ"
  return "已选面"
}

export function creationHoverReadout(result: SpatialPickResult, workPlane: WorkPlane): string {
  if (!("position" in result)) return result.reason
  const { x, y, z } = result.position
  const coordinates = `(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`
  return result.source === "work-plane"
    ? `${SOURCE_LABELS["work-plane"]} ${workPlaneLabel(workPlane)} ${coordinates}`
    : `${SOURCE_LABELS[result.source]} ${coordinates}`
}
