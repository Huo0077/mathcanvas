/**
 * 顶栏品牌旁的**动态粒子**。
 *
 * 用户口径："把动态粒子效果加入到 MathCanvas 一栏，光标中的文字就是 MathCanvas"。
 *
 * 两件事都在这里定：
 * 1. 粒子位置与节奏是**纯函数**（确定性、可测），组件只把结果写成 CSS 变量或行内样式；
 *    `Math.random()` 会让每次刷新都不一样，也让"粒子到底有没有渲染出来"没法断言。
 * 2. 粒子只是装饰 —— 它落在品牌两侧的留白里，不参与任何交互，也不该盖住文字。
 */

export interface BrandParticle {
  /** 相对粒子舞台的百分比坐标。 */
  left: number
  top: number
  /** 粒径（px）。 */
  size: number
  /** 动画延迟与单次周期（秒）。 */
  delay: number
  duration: number
  /** 上浮的位移（px，负值向上）。 */
  rise: number
  /** 基础不透明度：越小的粒子越淡，避免读成"脏点"。 */
  opacity: number
}

/**
 * 生成一组粒子。
 *
 * 用整数哈希加黄金比取模来散布位置：不用 `Math.random`，同一组输入永远得到同一组粒子
 * （截图对比与用例断言才有意义）。`count` 故意保持个位数 —— 品牌只有 9 个字母宽，
 * 粒子一多就从"科技感"变成"噪点"。
 */
export function brandParticles(count = 20, seed = 7): BrandParticle[] {
  const golden = 0.6180339887498949
  return Array.from({ length: count }, (_, index) => {
    const a = ((index + 1) * golden * seed) % 1
    const b = ((index + 1) * 0.4142135623 * seed) % 1
    const c = ((index + 1) * 0.7320508075 * seed) % 1
    const d = ((index + 1) * 0.2360679775 * seed) % 1
    return {
      left: Math.round(a * 1000) / 10,
      top: Math.round(18 + b * 64),
      // 颗粒更大：原来 1.4–3.6px 在深色底上几乎看不见（用户口径"让粒子效果更清晰"）。
      size: Math.round((2.4 + c * 2.4) * 10) / 10,
      delay: Math.round(c * 30) / 10,
      // 周期更短（3.6–7.4s，原来 5.5–11.5s）：浮动更容易被眼睛捕捉到，也就是"更流畅"。
      duration: Math.round((3.6 + d * 3.8) * 10) / 10,
      rise: -Math.round(8 + d * 20),
      // 更亮：基础不透明度 0.4–0.8（原来 0.25–0.7）。
      opacity: Math.round((0.4 + (1 - c) * 0.4) * 100) / 100
    }
  })
}

/** 品牌字样：打字动画与光标都以它为准（光标"里"的字就是它）。 */
export const BRAND_TEXT = "MathCanvas"
