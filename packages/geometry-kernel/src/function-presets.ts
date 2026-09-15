import { compileExpression } from "./expression"

export type FunctionPresetCategory = "basic" | "exponential" | "logarithmic" | "trigonometric" | "hyperbolic" | "composite"

export interface FunctionPreset {
  id: string
  label: string
  expression: string
  category: FunctionPresetCategory
  defaultDomain: [number, number]
  helperText: string
}

/** Labels and helper text are UI copy: the workbench is Chinese, and the preset picker shows them verbatim. */
export const functionPresets: readonly FunctionPreset[] = [
  { id: "linear", label: "一次函数 y = x", expression: "x", category: "basic", defaultDomain: [-6, 6], helperText: "恒等函数" },
  { id: "quadratic", label: "二次函数 y = x²", expression: "x^2", category: "basic", defaultDomain: [-6, 6], helperText: "抛物线 y = x²" },
  { id: "absolute", label: "绝对值 |x|", expression: "abs(x)", category: "basic", defaultDomain: [-6, 6], helperText: "V 形绝对值函数" },
  { id: "square-root", label: "平方根 √x", expression: "sqrt(x)", category: "basic", defaultDomain: [0, 9], helperText: "定义域 x ≥ 0" },
  { id: "exponential", label: "指数函数 e^x", expression: "e^x", category: "exponential", defaultDomain: [-4, 4], helperText: "自然指数 eˣ" },
  { id: "decay", label: "指数衰减 e^(-x)", expression: "e^(-x)", category: "exponential", defaultDomain: [-4, 8], helperText: "自然指数衰减" },
  { id: "logarithm", label: "自然对数 ln(x)", expression: "ln(x)", category: "logarithmic", defaultDomain: [0.05, 8], helperText: "定义域 x > 0" },
  { id: "common-logarithm", label: "常用对数 log10(x)", expression: "log10(x)", category: "logarithmic", defaultDomain: [0.05, 100], helperText: "以 10 为底的对数" },
  { id: "sine", label: "正弦 sin(x)", expression: "sin(x)", category: "trigonometric", defaultDomain: [-2 * Math.PI, 2 * Math.PI], helperText: "周期正弦曲线" },
  { id: "cosine", label: "余弦 cos(x)", expression: "cos(x)", category: "trigonometric", defaultDomain: [-2 * Math.PI, 2 * Math.PI], helperText: "周期余弦曲线" },
  { id: "tangent", label: "正切 tan(x)", expression: "tan(x)", category: "trigonometric", defaultDomain: [-Math.PI * 0.45, Math.PI * 0.45], helperText: "在竖直渐近线处分段" },
  { id: "sinh", label: "双曲正弦 sinh(x)", expression: "sinh(x)", category: "hyperbolic", defaultDomain: [-4, 4], helperText: "双曲正弦" },
  { id: "cosh", label: "双曲余弦 cosh(x)", expression: "cosh(x)", category: "hyperbolic", defaultDomain: [-4, 4], helperText: "双曲余弦" },
  { id: "tanh", label: "双曲正切 tanh(x)", expression: "tanh(x)", category: "hyperbolic", defaultDomain: [-4, 4], helperText: "有界双曲正切" },
  { id: "damped-cosine", label: "阻尼余弦 exp(-0.15x)·cos(2x)", expression: "exp(-0.15*x) * cos(2*x)", category: "composite", defaultDomain: [0, 20], helperText: "指数与余弦的复合" },
  { id: "gaussian", label: "高斯钟形 exp(-x²)", expression: "exp(-x^2)", category: "composite", defaultDomain: [-4, 4], helperText: "钟形复合函数" }
]

export function getFunctionPreset(id: string): FunctionPreset | undefined {
  return functionPresets.find((preset) => preset.id === id)
}

export function validateFunctionPresets(): void {
  for (const preset of functionPresets) compileExpression(preset.expression)
}
