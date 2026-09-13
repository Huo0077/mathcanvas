interface FormulaKeyboardProps {
  logBase: string
  onLogBaseChange: (value: string) => void
  onInsert: (template: string) => void
}

const functionButtons = [
  { label: "sin", template: "sin()" },
  { label: "cos", template: "cos()" },
  { label: "tan", template: "tan()" },
  { label: "ln", template: "ln()" },
  { label: "√", template: "sqrt()" },
  { label: "|x|", template: "abs()" },
  { label: "sinh", template: "sinh()" },
  { label: "cosh", template: "cosh()" },
  { label: "tanh", template: "tanh()" },
  { label: "asin", template: "asin()" },
  { label: "acos", template: "acos()" },
  { label: "atan", template: "atan()" },
  { label: "eˣ", template: "e^()" },
  { label: "x²", template: "x^2" }
]

export function FormulaKeyboard({ logBase, onLogBaseChange, onInsert }: FormulaKeyboardProps) {
  return <div className="formula-keyboard" aria-label="公式函数键盘">
    <div className="formula-keyboard-header"><span>函数键盘</span><small>点击插入到光标位置</small></div>
    <div className="formula-keyboard-grid">{functionButtons.map((button) => <button key={button.label} type="button" aria-label={`插入 ${button.label}`} onClick={() => onInsert(button.template)}>{button.label}</button>)}</div>
    <div className="formula-log-row"><label htmlFor="log-base">log 底数</label><input id="log-base" aria-label="对数底数" type="number" min="0.01" step="0.1" value={logBase} onChange={(event) => onLogBaseChange(event.target.value)} /><button type="button" aria-label="插入对数" onClick={() => onInsert(`log_${logBase || "10"}()`)}>log<sub>{logBase || "10"}</sub></button></div>
  </div>
}
