import { useMemo, useState } from "react"

import {
  formatFriendlyMathError,
  formatPrettyMath,
  normalizeHigherMathInput,
  parseExpression,
  type HigherMathExpressionMode
} from "@draw/geometry-kernel"

import { type MathKeypadToken } from "./calculusUxHelpers"

export interface MathFormulaInputProps {
  label: string
  prefix?: string
  value: string
  onChange: (next: string) => void
  mode?: HigherMathExpressionMode
  placeholder?: string
  ariaLabel?: string
}

/**
 * Natural math formula input with live Unicode math typesetting preview, clear button,
 * Chinese error diagnostics, and direct LaTeX/natural-syntax support.
 */
export function MathFormulaInput({
  label,
  prefix,
  value,
  onChange,
  mode = "expression",
  placeholder,
  ariaLabel
}: MathFormulaInputProps) {
  const preview = useMemo(() => {
    const trimmed = value.trim()
    if (!trimmed) return { ok: false as const, error: "请输入数学表达式" }
    try {
      const normalized = normalizeHigherMathInput(trimmed, mode)
      const ast = parseExpression(normalized)
      return { ok: true as const, pretty: formatPrettyMath(ast) }
    } catch (err) {
      return { ok: false as const, error: formatFriendlyMathError(err) }
    }
  }, [value, mode])

  return (
    <label className="calculus-field calculus-formula-field">
      <span className="calculus-formula-label-row">
        <span>{label}</span>
        {value.length > 0 && (
          <button
            type="button"
            className="calculus-formula-clear"
            aria-label={`清空${label}`}
            title="清空表达式"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange("")}
          >
            清空
          </button>
        )}
      </span>
      <div className="calculus-formula-input-box" data-invalid={preview.ok ? "false" : "true"}>
        {prefix && <span className="calculus-formula-prefix" aria-hidden="true">{prefix}</span>}
        <input
          type="text"
          aria-label={ariaLabel ?? label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      {preview.ok ? (
        <span className="calculus-formula-preview" aria-label={`${label}数学排版预览`}>
          {prefix ? `${prefix} ` : ""}{preview.pretty}
        </span>
      ) : (
        <span className="calculus-formula-hint-err" role="alert">
          {preview.error}
        </span>
      )}
    </label>
  )
}

export interface MathKeyboardKey extends MathKeypadToken {
  action?: "backspace" | "clear"
  wide?: boolean
}

const KEYBOARD_BASIC_QUICK: MathKeyboardKey[] = [
  { label: "x²", insert: "^2", caretOffset: 2, title: "平方 (^2)" },
  { label: "^", insert: "^", caretOffset: 1, title: "任意幂 (^)" },
  { label: "√", insert: "sqrt()", caretOffset: 5, title: "平方根 sqrt()" },
  { label: "a/b", insert: "()/()", caretOffset: 1, title: "分式 ()/()" },
  { label: "π", insert: "pi", caretOffset: 2, title: "圆周率 pi" },
  { label: "eˣ", insert: "exp()", caretOffset: 4, title: "指数 exp()" },
  { label: "ln", insert: "ln()", caretOffset: 3, title: "自然对数 ln()" },
  { label: "sin", insert: "sin()", caretOffset: 4, title: "正弦 sin()" },
  { label: "cos", insert: "cos()", caretOffset: 4, title: "余弦 cos()" },
  { label: "|x|", insert: "abs()", caretOffset: 4, title: "绝对值 abs()" }
]

const KEYBOARD_EXTENDED_OPS: MathKeyboardKey[] = [
  { label: "x", insert: "x", caretOffset: 1, title: "变量 x" },
  { label: "y", insert: "y", caretOffset: 1, title: "变量 y" },
  { label: "t", insert: "t", caretOffset: 1, title: "参数 t" },
  { label: "θ", insert: "theta", caretOffset: 5, title: "极角 θ" },
  { label: "( )", insert: "()", caretOffset: 1, title: "括号 ()" },
  { label: "x³", insert: "^3", caretOffset: 2, title: "立方 (^3)" },
  { label: "∛", insert: "cbrt()", caretOffset: 5, title: "立方根 cbrt()" },
  { label: "e", insert: "e", caretOffset: 1, title: "自然常数 e" },
  { label: "+", insert: " + ", caretOffset: 3, title: "加号 (+)" },
  { label: "−", insert: " - ", caretOffset: 3, title: "减号 (-)" },
  { label: "×", insert: "*", caretOffset: 1, title: "乘号 (*)" },
  { label: "÷", insert: "/", caretOffset: 1, title: "除号 (/)" },
  { label: "⌫", insert: "", caretOffset: 0, title: "退格删除前一个字符", action: "backspace", wide: true }
]

const KEYBOARD_FUNCTIONS: MathKeyboardKey[] = [
  { label: "sin", insert: "sin()", caretOffset: 4, title: "正弦 sin()" },
  { label: "cos", insert: "cos()", caretOffset: 4, title: "余弦 cos()" },
  { label: "tan", insert: "tan()", caretOffset: 4, title: "正切 tan()" },
  { label: "cot", insert: "cot()", caretOffset: 4, title: "余切 cot()" },
  { label: "sec", insert: "sec()", caretOffset: 4, title: "正割 sec()" },
  { label: "arcsin", insert: "arcsin()", caretOffset: 7, title: "反正弦 arcsin()" },
  { label: "arccos", insert: "arccos()", caretOffset: 7, title: "反余弦 arccos()" },
  { label: "arctan", insert: "arctan()", caretOffset: 7, title: "反正切 arctan()" },
  { label: "ln", insert: "ln()", caretOffset: 3, title: "自然对数 ln()" },
  { label: "lg", insert: "lg()", caretOffset: 3, title: "常用对数 lg()" },
  { label: "log₂", insert: "log2()", caretOffset: 5, title: "以2为底对数 log2()" },
  { label: "sinh", insert: "sinh()", caretOffset: 5, title: "双曲正弦 sinh()" },
  { label: "cosh", insert: "cosh()", caretOffset: 5, title: "双曲余弦 cosh()" },
  { label: "tanh", insert: "tanh()", caretOffset: 5, title: "双曲正切 tanh()" },
  { label: "sgn", insert: "sgn()", caretOffset: 4, title: "符号函数 sgn()" }
]

const KEYBOARD_SNIPPETS: MathKeyboardKey[] = [
  { label: "sin(x)/x", insert: "sin(x)/x", caretOffset: 8, title: "重要极限 sinc 函数", wide: true },
  { label: "e^(-x²)", insert: "exp(-x^2)", caretOffset: 9, title: "高斯函数 exp(-x^2)", wide: true },
  { label: "1/(1+x²)", insert: "1/(1 + x^2)", caretOffset: 11, title: "阿涅西女巫 / arctan 导数", wide: true },
  { label: "x·ln(x)", insert: "x*ln(x)", caretOffset: 7, title: "x*ln(x)", wide: true },
  { label: "√(x²+y²)", insert: "sqrt(x^2 + y^2)", caretOffset: 15, title: "欧氏距离 sqrt(x^2+y^2)", wide: true },
  { label: "sin²(x)", insert: "sin^2(x)", caretOffset: 8, title: "sin^2(x)", wide: true }
]

export interface MathKeyboardDockProps {
  onInsert: (token: MathKeypadToken) => void
  onBackspace: () => void
}

export function MathKeyboardDock({ onInsert, onBackspace }: MathKeyboardDockProps) {
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState<"ops" | "funcs" | "snippets">("ops")

  const renderKey = (key: MathKeyboardKey) => (
    <button
      key={key.label}
      type="button"
      className={`calculus-keypad-btn${key.wide ? " is-wide" : ""}`}
      title={key.title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (key.action === "backspace") onBackspace()
        else onInsert(key)
      }}
    >
      {key.label}
    </button>
  )

  return (
    <div className="calculus-keypad" role="toolbar" aria-label="常用数学符号快捷输入">
      <div className="calculus-keypad-head">
        <span className="calculus-keypad-label">数学键盘（支持 2x / sin²(x) / 粘贴 LaTeX）</span>
        <button
          type="button"
          className="calculus-keypad-toggle"
          aria-expanded={expanded}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起键盘 ▴" : "完整键盘 ▾"}
        </button>
      </div>

      <div className="calculus-keypad-keys">
        {KEYBOARD_BASIC_QUICK.map(renderKey)}
      </div>

      {expanded && (
        <div className="calculus-keypad-expanded">
          <div className="calculus-keypad-tabs" role="group" aria-label="数学键盘分类">
            <button
              type="button"
              aria-pressed={tab === "ops"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTab("ops")}
            >
              变量与运算
            </button>
            <button
              type="button"
              aria-pressed={tab === "funcs"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTab("funcs")}
            >
              三角与对数
            </button>
            <button
              type="button"
              aria-pressed={tab === "snippets"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTab("snippets")}
            >
              高频片段
            </button>
          </div>
          <div className="calculus-keypad-keys">
            {(tab === "ops" ? KEYBOARD_EXTENDED_OPS : tab === "funcs" ? KEYBOARD_FUNCTIONS : KEYBOARD_SNIPPETS).map(renderKey)}
          </div>
        </div>
      )}
    </div>
  )
}
