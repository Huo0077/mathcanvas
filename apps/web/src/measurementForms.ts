import type { Measurement3 } from "@draw/dsl"
import { exactFormOf } from "@draw/geometry-kernel"

/**
 * 读数的"精确 / 近似形式"后缀 —— **唯一的格式化出处**。
 *
 * 用户口径（2026-09-19）："这个近似不那么好用，手稍微偏一偏分数就没了，我们不需要那么精确，
 * 我们要将数据往常见整数和分数上面靠。"＋"坐标是整数或分数时，能够准确计算时，还是保留精度。"
 *
 * 落在哪一层由内核的 `exactFormOf` 决定（精确层不带 `≈`、吸附层带 `≈`、都不中给两位小数）；
 * 这里只管"怎么把形式挂到读数上"：
 *
 * - 平面画布的常驻数字（`planarMeasurementVisuals`）
 * - 立体几何的画布标注（`measurementVisuals`）
 * - 右侧属性栏的测量卡片（`PropertiesBar`）
 *
 * 三处共用这一份。历史上"度量名 → 中文"曾有三份副本（见 `measurementLabels.ts` 的注释），
 * 数值转换面板本来会成为第四份；这次从第一行就只留一份。
 */

/** 精确 / 近似形式本身（`2/3`、`≈ 2/3`、`π/2`、`√2`）；没有值得展示的形式时返回 `null`。 */
export function measurementFormText(measurement: Measurement3): string | null {
  /**
   * 退化 / 数据不足 / 值非有限：**一个数字都不挂**。这与"常驻数字不画假数字"是同一条纪律。
   * `exactFormOf` 对非有限输入返回"未识别"，所以这里拦一道不是防御性编程，而是语义要求。
   */
  if (measurement.status !== "valid" || measurement.value === undefined || !Number.isFinite(measurement.value)) return null
  const reading = exactFormOf(measurement.value)
  if (reading.form.kind === "unrecognised") return null
  /**
   * 整数的**精确**形式与 3 位小数的读数说的是同一件事（`5.000` 就是 5），挂上去只是噪声。
   * 但"吸附上来的整数"要留（`2.9999` → `≈ 3` 是**别人看不出来的信息**）。
   */
  if (reading.form.kind === "integer" && reading.certainty === "exact") return null
  return reading.form.text
}

/** 读数后缀：可用时是 ` · π/2`（带前导空格），否则是空串，调用方直接拼接即可。 */
export function measurementFormSuffix(measurement: Measurement3): string {
  const form = measurementFormText(measurement)
  return form === null ? "" : ` · ${form}`
}

export interface TrigValueDisplay {
  numeric: string
  exact: string | null
  display: string
}

export interface AngleTrigValues {
  degrees: number
  degreesText: string
  sin: TrigValueDisplay
  cos: TrigValueDisplay
}

function clampTrigComponent(value: number): number {
  if (Math.abs(value) < 1e-12) return 0
  if (Math.abs(value - 1) < 1e-12) return 1
  if (Math.abs(value + 1) < 1e-12) return -1
  return value
}

function formatTrigComponent(raw: number): TrigValueDisplay {
  const value = clampTrigComponent(raw)
  const numeric = value.toFixed(4)
  const abs = Math.abs(value)
  const reading = exactFormOf(abs)
  let exact: string | null = null
  if (reading.form.kind === "integer" && reading.certainty === "exact") {
    exact = value < 0 && abs > 0 ? `-${reading.form.text}` : reading.form.text
  } else if (reading.form.kind !== "unrecognised" && reading.form.kind !== "integer") {
    if (value < 0) {
      exact = reading.form.text.startsWith("≈ ") ? `≈ -${reading.form.text.slice(2)}` : `-${reading.form.text}`
    } else {
      exact = reading.form.text
    }
  } else if (reading.form.kind === "integer") {
    exact = value < 0 ? `≈ -${reading.form.text.replace(/^≈\s*/, "")}` : reading.form.text
  }
  const display = exact ? (exact === numeric || /^(-?0|-?1)$/.test(exact) ? exact : `${numeric} (${exact})`) : numeric
  return { numeric, exact, display }
}

/** 计算有效角度 / 二面角的度数与正弦、余弦显示（兼容精确分式/根式形式）。 */
export function angleTrigValues(measurement: Measurement3): AngleTrigValues | null {
  const isAngle = measurement.metric === "angle" || measurement.metric === "dihedral" || measurement.unit === "rad"
  if (!isAngle || measurement.status !== "valid" || measurement.value === undefined || !Number.isFinite(measurement.value)) {
    return null
  }
  const rad = measurement.value
  const degrees = (rad * 180) / Math.PI
  return {
    degrees,
    degreesText: `${degrees.toFixed(2)}°`,
    sin: formatTrigComponent(Math.sin(rad)),
    cos: formatTrigComponent(Math.cos(rad))
  }
}

/** 角度读数的紧凑正弦/余弦附加串（用于画布标签与左侧测量列表）。 */
export function angleTrigCompactText(measurement: Measurement3): string {
  const trig = angleTrigValues(measurement)
  if (!trig) return ""
  const sinShort = trig.sin.exact && !trig.sin.exact.startsWith("≈ ") ? trig.sin.exact : trig.sin.numeric
  const cosShort = trig.cos.exact && !trig.cos.exact.startsWith("≈ ") ? trig.cos.exact : trig.cos.numeric
  return `${trig.degrees.toFixed(1)}° · sin=${sinShort} · cos=${cosShort}`
}
