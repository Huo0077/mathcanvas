interface GuidanceHintProps {
  text: string
  onDismiss: () => void
}

/**
 * 画布左下角的一次性指引：只在点击功能键后出现，尺寸刻意压到一行到两行，避免挡住画布。
 * `role="status"` 让读屏软件在出现时播报，闭合按钮保留键盘可达的关闭方式。
 */
export function GuidanceHint({ text, onDismiss }: GuidanceHintProps) {
  return <div className="guidance-hint" data-guidance="true" role="status" aria-live="polite" aria-label="操作指引">
    <span className="guidance-hint-mark" aria-hidden="true">?</span>
    <span className="guidance-hint-text">{text}</span>
    <button type="button" className="guidance-hint-close" aria-label="关闭操作指引" title="关闭指引（Esc）" onClick={onDismiss}>×</button>
  </div>
}
