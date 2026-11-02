import { useState, useRef, useEffect, type KeyboardEvent } from "react"

export interface InlineRenameInputProps {
  position: { x: number; y: number }
  initialValue: string
  primitiveId: string
  existingLabels?: string[]
  onCommit: (newLabel: string) => void
  onCancel: () => void
}

export function InlineRenameInput({
  position,
  initialValue,
  primitiveId,
  existingLabels = [],
  onCommit,
  onCancel,
}: InlineRenameInputProps) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const committedRef = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const validate = (val: string): { valid: boolean; trimmed: string; msg?: string } => {
    const trimmed = val.trim()
    if (!trimmed) {
      return { valid: false, trimmed: "", msg: "名称不能为空" }
    }
    if (trimmed !== initialValue && existingLabels.includes(trimmed)) {
      return { valid: false, trimmed, msg: `已存在名称为「${trimmed}」的图元` }
    }
    return { valid: true, trimmed }
  }

  const handleCommit = () => {
    if (committedRef.current) return
    const { valid, trimmed, msg } = validate(value)
    if (!valid) {
      setError(msg ?? "名称不合法")
      inputRef.current?.focus()
      return
    }
    committedRef.current = true
    if (trimmed !== initialValue) {
      onCommit(trimmed)
    } else {
      onCancel()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      handleCommit()
    } else if (event.key === "Escape") {
      event.preventDefault()
      committedRef.current = true
      onCancel()
    }
  }

  const handleBlur = () => {
    if (committedRef.current) return
    const { valid, trimmed } = validate(value)
    if (valid && trimmed !== initialValue) {
      committedRef.current = true
      onCommit(trimmed)
    } else {
      committedRef.current = true
      onCancel()
    }
  }

  // Clamp within viewport
  const inputWidth = 140
  const clampedX = Math.max(10, Math.min(position.x - 20, window.innerWidth - inputWidth - 20))
  const clampedY = Math.max(10, Math.min(position.y - 16, window.innerHeight - 50))

  return (
    <div
      className="inline-rename-container"
      role="dialog"
      aria-label="重命名图元"
      style={{
        left: `${clampedX}px`,
        top: `${clampedY}px`,
      }}
    >
      <input
        ref={inputRef}
        type="text"
        className={`inline-rename-input${error ? " has-error" : ""}`}
        value={value}
        data-primitive-id={primitiveId}
        aria-label="图元新名称"
        onChange={(e) => {
          setValue(e.target.value)
          if (error) setError(null)
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
      {error && (
        <div className="inline-rename-error-bubble" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
