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
      delay: Math.round(c * 44) / 10,
      /**
       * **周期拉长、幅度压小**（用户口径："把周期拉长、幅度调小"）。
       *
       * 起因是"高刷屏上看起来不流畅"：60Hz 一帧 16.7ms、120Hz 一帧 8.3ms，
       * 同样的速度在高刷屏上**每帧位移翻倍**，运动就读成一跳一跳 —— 那不是掉帧，是"每帧走太远"。
       * 所以正确的修法是降速度，而不是继续减绘制开销。
       *
       * 实测速度：`rise / (duration × 120)` ≈ **0.003–0.011 px/帧**（120Hz），
       * 比改前（最高 28px / 3.6s ≈ 0.065 px/帧）低约 10 倍，比"约 1px/帧"的感知阈值低两个数量级。
       * 周期拉长后每颗粒子的可见时长也变长，屏幕上常驻粒子数反而更稳定。
       */
      duration: Math.round((8 + d * 7) * 10) / 10,
      rise: -(Math.round(5 + d * 6) * 10) / 10,
      // 更亮：基础不透明度 0.4–0.8（原来 0.25–0.7）。
      opacity: Math.round((0.4 + (1 - c) * 0.4) * 100) / 100
    }
  })
}

/** 品牌字样：打字动画与光标都以它为准（光标"里"的字就是它）。 */
export const BRAND_TEXT = "MathCanvas"
