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

/**
 * 把“等边三角形边长为 N”展开成三条边，把 `PA=PB=2` 展开成两条独立条件。
 * 这是**语法展开**，不猜题意；只在解析/核验内部用，原文与 span 保持不变时不要调用。
 */
export function expandExamShorthand(text: string): string {
  return text
    .replace(/△?([A-Z])([A-Z])([A-Z])是边长为([0-9.]+)的等边三角形/g, "$1$2=$4，$1$3=$4，$2$3=$4")
    .replace(/([A-Z])([A-Z])=([A-Z])([A-Z])=([0-9.]+|√[0-9.]+)/g, "$1$2=$5，$3$4=$5")
}

export function normalizeGeometryPrompt(prompt: string): string {
  if (!LATEX_MARKER.test(prompt)) return prompt

  let text = prompt.replace(/\$/g, "")

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

  // 结构化命令：先 sqrt / frac，再拆包装。
  text = text.replace(/\\sqrt\s*\{([^{}]+)\}/g, "√$1")
  text = text.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "$1/$2")
  text = text.replace(/\\(?:mathrm|text|mathbf|operatorname)\s*\{([^{}]+)\}/g, "$1")
  text = text.replace(/\\overrightarrow\s*\{([^{}]+)\}/g, "$1")
  text = text.replace(/\\arctan\b/g, "arctan")

  // 上标/下标：只处理数字与常见 2 次方。
  text = text.replace(/\^\s*\{?\s*2\s*\}?/g, "²")
  text = text.replace(/\^\s*\{?\s*°\s*\}?/g, "°")
  text = text.replace(/_\{?\s*([0-9]+)\s*\}?/g, (_match, digits: string) =>
    [...digits].map((digit) => SUBSCRIPTS[Number(digit)] ?? digit).join(""))

  // 数据集里的 OCR 错字。
  text = text.replace(/棱雉/g, "棱锥").replace(/圆雉/g, "圆锥")

  // 等边三角形的“边长为 N”展开成三条边；链式相等展开成两条独立条件。
  text = expandExamShorthand(text)

  // 数学点名的空格不影响语义；中文本身不需要空格。
  return text.replace(/\s+/g, "").trim()
}
