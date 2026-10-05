/**
 * **一组数值行的秩**（Gram–Schmidt，带绝对阈值）—— 线性代数里唯一一处实现。
 *
 * ## 为什么要"秩"而不是"条数"
 *
 * 重复的、或者能由别的约束推出来的约束**不会各减一格**自由度。把它们按条数算进去，
 * "过约束"就会被误报成"自由度 −1"（`constraintIR.test.ts` 有一条重复定长约束的用例盯着它）。
 * 判据在约束层与拖动层是同一件事，所以这个函数只有一份。
 *
 * ## 阈值为什么是绝对的
 *
 * 它只用在"单位方向还剩多长"上：调用方喂进来的雅可比行本身就已经是**归一化过的残差**
 * 的导数（内核的残差函数自己会归一 —— 长度差 / 比例 / 夹角 / 法向点积），
 * 所以分量与坐标尺度无关。这里若再按参数尺度缩放，大坐标文档会把"近相关的行"判成独立，
 * 秩被高估 —— 那正好是"过约束"漏报的方向。
 */

export interface RowRankReport {
  /** 独立行的条数（= 秩）。 */
  rank: number
  /**
   * **没有增加秩**的那些行的下标（按输入顺序）。
   *
   * 一行是"依赖行"有两个来源，而这个函数**不区分**它们 —— 那是调用方的语义：
   * 重复声明、能被别行线性组合出来、或者干脆是零行（这条约束对任何可动坐标都不敏感）。
   * 三者都意味着**这行没有多压掉一个方向**，所以都如实列进来。
   * 零行也算依赖行（第 0 行若是零行，它同样进这个列表）。
   */
  dependentIndices: number[]
}

/**
 * @param rows 行等长的数值矩阵。长度不一致时**抛异常**：那是调用方的形状错误，
 *   静默按较短的长度对齐会让秩算出一个看不出来的错数。
 * @param threshold 绝对阈值；缺省 `1e-8`。
 */
export function rankRows(rows: readonly (readonly number[])[], threshold = 1e-8): RowRankReport {
  const basis: number[][] = []
  const dependentIndices: number[] = []
  const expected = rows[0]?.length
  for (const [index, row] of rows.entries()) {
    if (expected !== undefined && row.length !== expected) {
      throw new Error(`rankRows: 第 ${index} 行有 ${row.length} 个分量，与第 0 行的 ${expected} 个不一致`)
    }
    const remaining = [...row]
    for (const kept of basis) {
      let projection = 0
      for (let position = 0; position < remaining.length; position += 1) projection += kept[position] * remaining[position]
      for (let position = 0; position < remaining.length; position += 1) remaining[position] -= projection * kept[position]
    }
    let squared = 0
    for (const value of remaining) squared += value * value
    const norm = Math.sqrt(squared)
    if (norm > threshold) basis.push(remaining.map((value) => value / norm))
    else dependentIndices.push(index)
  }
  return { rank: basis.length, dependentIndices }
}
