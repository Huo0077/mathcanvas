export interface FormulaInsertion {
  value: string
  cursorStart: number
  cursorEnd: number
}

export function insertFormulaTemplate(value: string, selectionStart: number, selectionEnd: number, template: string): FormulaInsertion {
  const start = Math.max(0, Math.min(selectionStart, value.length))
  const end = Math.max(start, Math.min(selectionEnd, value.length))
  const selected = value.slice(start, end)
  const openingParenthesis = template.indexOf("(")
  const closingParenthesis = template.endsWith(")")
  const insertion = selected && openingParenthesis >= 0 && closingParenthesis
    ? `${template.slice(0, openingParenthesis + 1)}${selected}${template.slice(openingParenthesis + 1)}`
    : template
  const nextValue = `${value.slice(0, start)}${insertion}${value.slice(end)}`
  const cursor = selected && openingParenthesis >= 0 && closingParenthesis
    ? start + openingParenthesis + 1 + selected.length
    : start + (openingParenthesis >= 0 && closingParenthesis ? openingParenthesis + 1 : insertion.length)
  return { value: nextValue, cursorStart: cursor, cursorEnd: cursor }
}
