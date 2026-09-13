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

export const functionPresets: readonly FunctionPreset[] = [
  { id: "linear", label: "Linear", expression: "x", category: "basic", defaultDomain: [-6, 6], helperText: "Identity function" },
  { id: "quadratic", label: "Quadratic", expression: "x^2", category: "basic", defaultDomain: [-6, 6], helperText: "Parabola y = x²" },
  { id: "absolute", label: "Absolute value", expression: "abs(x)", category: "basic", defaultDomain: [-6, 6], helperText: "V-shaped absolute value function" },
  { id: "square-root", label: "Square root", expression: "sqrt(x)", category: "basic", defaultDomain: [0, 9], helperText: "Defined for x ≥ 0" },
  { id: "exponential", label: "Exponential", expression: "e^x", category: "exponential", defaultDomain: [-4, 4], helperText: "Natural exponential eˣ" },
  { id: "decay", label: "Exponential decay", expression: "e^(-x)", category: "exponential", defaultDomain: [-4, 8], helperText: "Natural exponential decay" },
  { id: "logarithm", label: "Natural logarithm", expression: "ln(x)", category: "logarithmic", defaultDomain: [0.05, 8], helperText: "Defined for x > 0" },
  { id: "common-logarithm", label: "Common logarithm", expression: "log10(x)", category: "logarithmic", defaultDomain: [0.05, 100], helperText: "Base-10 logarithm" },
  { id: "sine", label: "Sine", expression: "sin(x)", category: "trigonometric", defaultDomain: [-2 * Math.PI, 2 * Math.PI], helperText: "Periodic sine wave" },
  { id: "cosine", label: "Cosine", expression: "cos(x)", category: "trigonometric", defaultDomain: [-2 * Math.PI, 2 * Math.PI], helperText: "Periodic cosine wave" },
  { id: "tangent", label: "Tangent", expression: "tan(x)", category: "trigonometric", defaultDomain: [-Math.PI * 0.45, Math.PI * 0.45], helperText: "Segmented at vertical asymptotes" },
  { id: "sinh", label: "Hyperbolic sine", expression: "sinh(x)", category: "hyperbolic", defaultDomain: [-4, 4], helperText: "Hyperbolic sine" },
  { id: "cosh", label: "Hyperbolic cosine", expression: "cosh(x)", category: "hyperbolic", defaultDomain: [-4, 4], helperText: "Hyperbolic cosine" },
  { id: "tanh", label: "Hyperbolic tangent", expression: "tanh(x)", category: "hyperbolic", defaultDomain: [-4, 4], helperText: "Bounded hyperbolic tangent" },
  { id: "damped-cosine", label: "Damped cosine", expression: "exp(-0.15*x) * cos(2*x)", category: "composite", defaultDomain: [0, 20], helperText: "Composite exponential and cosine" },
  { id: "gaussian", label: "Gaussian", expression: "exp(-x^2)", category: "composite", defaultDomain: [-4, 4], helperText: "Bell-shaped composite function" }
]

export function getFunctionPreset(id: string): FunctionPreset | undefined {
  return functionPresets.find((preset) => preset.id === id)
}

export function validateFunctionPresets(): void {
  for (const preset of functionPresets) compileExpression(preset.expression)
}
