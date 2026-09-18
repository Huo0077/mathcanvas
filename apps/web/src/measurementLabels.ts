import type { Measurement3 } from "@draw/dsl"

/**
 * 度量名 → 中文。**只在这里定义一次**。
 *
 * 之前这个映射有三份副本：平面画布的常驻数字（`planarMeasurementVisuals`）、右侧对象列表
 * （`components/AlgebraView`）、立体几何的画布标注（`measurementVisuals`）。于是"加一个度量名"
 * 要改三处，漏一处就只在某一块界面上显示成英文 key —— 这正是本仓库"名单副本漂移"的老毛病
 *（可求交类型名单曾经有五份副本，切线因此到处都不能求交）。数值转换面板本来会成为第四份。
 */
export const MEASUREMENT_METRIC_LABELS: Record<Measurement3["metric"], string> = {
  length: "长度",
  distance: "距离",
  angle: "角度",
  area: "面积",
  volume: "体积",
  perimeter: "周长",
  radius: "半径",
  dihedral: "二面角"
}

/** 二面角有内角 / 外角两种说法，其余直接查表。 */
export function measurementMetricLabel(measurement: Measurement3): string {
  if (measurement.metric !== "dihedral") return MEASUREMENT_METRIC_LABELS[measurement.metric]
  return measurement.dihedralKind === "exterior" ? "二面角外角" : "二面角内角"
}
