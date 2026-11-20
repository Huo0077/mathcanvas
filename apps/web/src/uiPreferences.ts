export type UiFontScale = "normal" | "comfortable"

function safeReadBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw === "true") return true
    if (raw === "false") return false
    return fallback
  } catch {
    return fallback
  }
}

function safeWriteString(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 存储受限时保留当前会话生效
  }
}

export function loadReducedMotion(): boolean {
  return safeReadBool("mathcanvas.ui.reducedMotion", false)
}

export function applyReducedMotion(enabled: boolean) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.reducedMotion = String(enabled)
  }
}

export function saveReducedMotion(enabled: boolean) {
  applyReducedMotion(enabled)
  safeWriteString("mathcanvas.ui.reducedMotion", String(enabled))
}

export function loadFontScale(): UiFontScale {
  try {
    return localStorage.getItem("mathcanvas.ui.fontScale") === "comfortable" ? "comfortable" : "normal"
  } catch {
    return "normal"
  }
}

export function applyFontScale(scale: UiFontScale) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.fontScale = scale
  }
}

export function saveFontScale(scale: UiFontScale) {
  applyFontScale(scale)
  safeWriteString("mathcanvas.ui.fontScale", scale)
}

export function loadAgentAutoClear(): boolean {
  return safeReadBool("mathcanvas.agent.autoClearOld", true)
}

export function saveAgentAutoClear(enabled: boolean) {
  safeWriteString("mathcanvas.agent.autoClearOld", String(enabled))
}

export function loadAutoOpenProperties(): boolean {
  return safeReadBool("mathcanvas.ui.autoOpenProperties", true)
}

export function saveAutoOpenProperties(enabled: boolean) {
  safeWriteString("mathcanvas.ui.autoOpenProperties", String(enabled))
}
