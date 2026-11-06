/**
 * **真实考试题入口的 LaTeX 归一化**（2026-10-19，任务 P5-1）。
 *
 * 题面解析器只认中文与 Unicode 符号，不认 `$...$`、`\triangle`、`\sqrt`。以前的做法是
 * 让评测脚本自己洗一遍；产品路径没有这一步，于是原始 LaTeX 题面能编译、条件却大多
 * 显示“未核验”。这里把“洗题面”收成一个纯函数，解析入口统一调用。
 *
 * **边界**：只做常见命令与 OCR 错字的确定性替换，不猜题意、不补条件；未知命令原样保留。
 * 纯文本题面逐字返回（不清洗空格），避免无谓地改动原文与 span。
 */

const LATEX_MARKER = /[$\\]/

const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉"

function lowerMathGroups(source: string, inFunction: boolean): string {
  // Lower the innermost complete commands first. An unreadable group is
  // retained for the verifier to reject instead of losing its braces.
  const groupOperand = (operand: string) => /^(?:√?\d+(?:\.\d+)?|π|[A-Za-z])$/.test(operand.trim())
    ? operand.trim()
    : `(${operand})`
  let text = source
  for (let depth = 0; depth < 32; depth += 1) {
    const next = text
      .replace(/\\sqrt\s*\{([^{}]+)\}/g, (_match, radicand: string) =>
        /^\d+(?:\.\d+)?$/.test(radicand.trim()) ? `√${radicand.trim()}` : `√(${radicand})`)
      .replace(/\\(?:[dt]?frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, (_match, numerator: string, denominator: string) => {
        const fraction = `${groupOperand(numerator)}/${groupOperand(denominator)}`
        return inFunction ? `(${fraction})` : fraction
      })
    if (next === text) break
    text = next
  }
  return text
}

/** 等长替换：只修字形，不移动 span（P5-2）。 */
function fixOcrText(text: string): string {
  return text
    .replace(/棱雉|棱椎/g, "棱锥")
    .replace(/圆雉|圆椎/g, "圆锥")
}

/**
 * 把“等边三角形边长为 N”展开成三条边，把 `PA=PB=2` 展开成两条独立条件。
 * 这是**语法展开**，不猜题意；只在解析/核验内部用，原文与 span 保持不变时不要调用。
 */
export function expandExamShorthand(text: string): string {
  return text
    .replace(/△?([A-Z])([A-Z])([A-Z])是边长为([0-9.]+)的等边三角形/g, "$1$2=$4，$1$3=$4，$2$3=$4")
    // 连等（`PA=PB=2`）**不再在这里改写**（2026-10-26）：这个正则只认"纯线段 + 值"，
    // 遇到 `AD=AB=2CD=2` 会从 `AB` 开始吃，把 AD 改成 2、把乘数当整条等式的值。
    // 连等由 `lengthEquality.ts` 整条确定性解析，各阶段共用同一份语义。
    .replace(/([0-9])\s*[.。]\s*(?=[\u4e00-\u9fff])/g, "$1，")
    .replace(/(^|[，,；;。.])\s*若/g, "$1")
}

export function normalizeGeometryPrompt(prompt: string): string {
  if (!LATEX_MARKER.test(prompt)) return fixOcrText(prompt)

  let text = prompt.replace(/\$|\\[()[\]]/g, "")

  // 环境/排版命令：先去掉不承载几何语义的包装。
  text = text.replace(/\\(?:left|right)\s*/g, "")
  text = text.replace(/\\(?:,|;|!|quad|qquad)\s*/g, "")
  text = text.replace(/~/g, "")

  // 常见符号。
  text = text.replace(/\\triangle\s*/g, "△")
  text = text.replace(/\\angle\s*/g, "∠")
  text = text.replace(/\\pi\b/g, "π")
  text = text.replace(/\\perp\b/g, "⊥")
  text = text.replace(/\\parallel\b/g, "∥")
  text = text.replace(/\\cdot\b/g, "·")
  text = text.replace(/\\times\b/g, "×")
  text = text.replace(/\\neq\b/g, "≠")
  text = text.replace(/\\leq\b/g, "≤")
  text = text.replace(/\\geq\b/g, "≥")
  text = text.replace(/\\infty\b/g, "∞")
  text = text.replace(/\\circ\b/g, "°")

  // A fraction in a function acts as one operand, including before a power.
  // Preserve the compact scalar notation expected by geometry readers.
  text = text.replace(/([fgh]\s*\(\s*x\s*\)\s*=\s*)([^，,。；;\n\u4e00-\u9fff]+)/g,
    (_match, prefix: string, expression: string) => prefix + lowerMathGroups(expression, true))
  text = lowerMathGroups(text, false)
  text = text.replace(/\\(?:mathrm|text|mathbf|operatorname)\s*\{([^{}]+)\}/g, "$1")
  text = text.replace(/\\overrightarrow\s*\{([^{}]+)\}/g, "$1")
  text = text.replace(/\\vec\s*\{([^{}]+)\}/g, "$1")
  text = text.replace(/\\arctan\b/g, "arctan")
  text = text.replace(/\\(sin|cos|tan)\s*x(?![\w(]|\s*\^)/g, "$1(x)")
  text = text.replace(/\\(sin|cos|tan)(?=\s*\()/g, "$1")

  // 上标/下标：只处理数字与常见 2 次方。
  text = text.replace(/\^\s*(?:\{\s*2\s*\}|2(?![\d.]))/g, "²")
  text = text.replace(/\^\s*\{?\s*°\s*\}?/g, "°")
  text = text.replace(/_\{?\s*([0-9]+)\s*\}?/g, (_match, digits: string) =>
    [...digits].map((digit) => SUBSCRIPTS[Number(digit)] ?? digit).join(""))

  // 数据集里的 OCR 错字。
  text = fixOcrText(text)

  // 等边三角形的“边长为 N”展开成三条边；链式相等展开成两条独立条件。
  text = expandExamShorthand(text)

  // A line break before a question number can be the only part boundary.
  return text.replace(/\s+/g, (spacing: string, offset: number) =>
    /[\r\n]/.test(spacing) && /^(?:[（(]\s*[1-9]\d*\s*[）)]|[①-⑳])/.test(text.slice(offset + spacing.length))
      ? "\n"
      : ""
  ).trim()
}
